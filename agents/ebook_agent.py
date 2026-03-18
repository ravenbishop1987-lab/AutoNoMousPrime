"""
Ebook Agent — Generates styled HTML/PDF ebooks from a topic.

Pipeline:
  1. LLM outlines chapters based on topic + style
  2. LLM writes each chapter (full prose)
  3. ImageAgent generates cover + optional chapter images
  4. Jinja2 assembles a styled HTML ebook
  5. WeasyPrint converts to PDF if available; falls back to HTML

Task types handled:
  - ebook_gen  (full generation)
  - ebook_outline (outline only, returns chapter list)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

from loguru import logger
from slugify import slugify

from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent

# ── HTML template ──────────────────────────────────────────────────────────────

EBOOK_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{{ title }}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap');
  :root {
    --accent: {{ accent }};
    --bg: {{ bg }};
    --text: {{ text_color }};
    --muted: {{ muted }};
    --card: {{ card }};
    --border: {{ border }};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Merriweather', Georgia, serif; background: var(--bg); color: var(--text); line-height: 1.8; }

  /* Cover page */
  .cover {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    padding: 60px 48px;
    background: linear-gradient(160deg, var(--card) 0%, var(--bg) 100%);
    border-bottom: 4px solid var(--accent);
    page-break-after: always;
  }
  .cover-badge {
    font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700;
    letter-spacing: 2px; text-transform: uppercase;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    padding: 5px 16px; border-radius: 99px; margin-bottom: 32px;
    display: inline-block;
  }
  .cover-img { width: 100%; max-width: 480px; border-radius: 16px; margin-bottom: 40px; box-shadow: 0 24px 64px rgba(0,0,0,.25); }
  .cover h1 { font-size: clamp(32px, 6vw, 58px); font-weight: 900; font-family: 'Inter', sans-serif; line-height: 1.1; margin-bottom: 20px; }
  .cover h1 em { font-style: normal; color: var(--accent); }
  .cover .subtitle { font-size: 18px; color: var(--muted); max-width: 520px; margin: 0 auto 40px; line-height: 1.6; font-family: 'Inter', sans-serif; }
  .cover .author { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--muted); }

  /* TOC */
  .toc { padding: 80px 64px; max-width: 800px; margin: 0 auto; page-break-after: always; }
  .toc h2 { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); margin-bottom: 32px; }
  .toc-item { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 15px; }
  .toc-item .ch-num { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; color: var(--muted); margin-right: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .toc-item .ch-title { flex: 1; font-weight: 700; }
  .toc-item .ch-page { font-family: 'Inter', sans-serif; font-size: 12px; color: var(--muted); }

  /* Chapters */
  .chapter { padding: 80px 64px; max-width: 800px; margin: 0 auto; page-break-before: always; }
  .chapter-header { margin-bottom: 40px; }
  .chapter-label { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; }
  .chapter h2 { font-family: 'Inter', sans-serif; font-size: clamp(24px, 4vw, 38px); font-weight: 900; line-height: 1.2; margin-bottom: 16px; }
  .chapter .chapter-intro { font-size: 18px; color: var(--muted); line-height: 1.7; margin-bottom: 32px; font-style: italic; }
  .chapter-img { width: 100%; border-radius: 12px; margin: 32px 0; box-shadow: 0 8px 32px rgba(0,0,0,.15); }
  .chapter p { font-size: 16px; line-height: 1.9; margin-bottom: 20px; }
  .chapter h3 { font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 700; margin: 36px 0 12px; color: var(--text); }
  .chapter h4 { font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700; margin: 24px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .chapter ul, .chapter ol { padding-left: 24px; margin-bottom: 20px; }
  .chapter li { font-size: 16px; line-height: 1.8; margin-bottom: 6px; }
  .chapter blockquote { border-left: 4px solid var(--accent); padding: 16px 24px; margin: 28px 0; background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 0 8px 8px 0; font-style: italic; font-size: 17px; }
  .key-takeaway { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; margin: 32px 0; }
  .key-takeaway h4 { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; }
  .key-takeaway ul { margin-bottom: 0; }

  /* CTA page */
  .cta-page { padding: 80px 64px; text-align: center; max-width: 700px; margin: 0 auto; page-break-before: always; }
  .cta-page h2 { font-family: 'Inter', sans-serif; font-size: 36px; font-weight: 900; margin-bottom: 16px; }
  .cta-page p { font-size: 18px; color: var(--muted); margin-bottom: 32px; line-height: 1.7; }
  .cta-btn { display: inline-block; padding: 16px 40px; background: var(--accent); color: #fff; font-family: 'Inter', sans-serif; font-weight: 800; font-size: 16px; border-radius: 10px; text-decoration: none; }

  @media print {
    .cover, .chapter, .toc, .cta-page { page-break-after: always; }
  }
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-badge">{{ style_label }}</div>
  {% if cover_image %}
  <img class="cover-img" src="{{ cover_image }}" alt="{{ title }}" />
  {% endif %}
  <h1>{{ cover_headline }}</h1>
  <p class="subtitle">{{ subtitle }}</p>
  <div class="author">By {{ author_name }}</div>
</div>

<!-- TABLE OF CONTENTS -->
<div class="toc">
  <h2>Contents</h2>
  {% for ch in chapters %}
  <div class="toc-item">
    <span class="ch-num">{{ loop.index | string | zfill(2) }}</span>
    <span class="ch-title">{{ ch.title }}</span>
  </div>
  {% endfor %}
</div>

<!-- CHAPTERS -->
{% for ch in chapters %}
<div class="chapter">
  <div class="chapter-header">
    <div class="chapter-label">Chapter {{ loop.index }}</div>
    <h2>{{ ch.title }}</h2>
    {% if ch.intro %}
    <div class="chapter-intro">{{ ch.intro }}</div>
    {% endif %}
  </div>
  {% if ch.image %}
  <img class="chapter-img" src="{{ ch.image }}" alt="{{ ch.title }}" />
  {% endif %}
  {{ ch.html_body | safe }}
  {% if ch.takeaways %}
  <div class="key-takeaway">
    <h4>Key Takeaways</h4>
    <ul>
      {% for t in ch.takeaways %}
      <li>{{ t }}</li>
      {% endfor %}
    </ul>
  </div>
  {% endif %}
</div>
{% endfor %}

<!-- CTA PAGE -->
{% if cta_text %}
<div class="cta-page">
  <h2>Ready to take action?</h2>
  <p>{{ cta_text }}</p>
  {% if cta_url %}
  <a class="cta-btn" href="{{ cta_url }}">{{ cta_button }} →</a>
  {% endif %}
</div>
{% endif %}

</body>
</html>
"""

# ── Theme palettes ─────────────────────────────────────────────────────────────

THEMES = {
    "dark": {
        "accent": "#58a6ff", "bg": "#0d1117", "text_color": "#e6edf3",
        "muted": "#8b949e", "card": "#161b22", "border": "rgba(255,255,255,.1)",
    },
    "light": {
        "accent": "#0550ae", "bg": "#ffffff", "text_color": "#1c2128",
        "muted": "#656d76", "card": "#f6f8fa", "border": "#d0d7de",
    },
    "warm": {
        "accent": "#d97706", "bg": "#fffbf0", "text_color": "#1c1917",
        "muted": "#78716c", "card": "#fef3c7", "border": "#fde68a",
    },
    "purple": {
        "accent": "#a78bfa", "bg": "#0f0a1e", "text_color": "#ede9fe",
        "muted": "#7c6e9e", "card": "#1a1030", "border": "rgba(167,139,250,.2)",
    },
    "green": {
        "accent": "#059669", "bg": "#f0fdf4", "text_color": "#14532d",
        "muted": "#4d7c0f", "card": "#dcfce7", "border": "#bbf7d0",
    },
}

STYLE_LABELS = {
    "lead_magnet": "Free Lead Magnet",
    "how_to_guide": "How-To Guide",
    "ultimate_guide": "Ultimate Guide",
    "case_study": "Case Study Collection",
    "mini_course": "Mini Course",
}


class EbookAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("ebook_agent", llm, max_concurrent=2)
        self._outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "ebook"
        self._outputs_dir.mkdir(parents=True, exist_ok=True)

    def skill_summary(self) -> dict:
        return {
            "name": "EbookAgent",
            "description": "Generates styled PDF/HTML ebooks from a topic with chapters, images, and themes.",
            "capabilities": ["ebook_gen", "ebook_outline"],
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        if task.type == "ebook_outline":
            return await self._generate_outline(task)
        return await self._generate_ebook(task)

    # ── Outline only ──────────────────────────────────────────────────────────

    async def _generate_outline(self, task: "Task") -> dict[str, Any]:
        topic      = str(task.payload.get("topic", "")).strip()
        style      = str(task.payload.get("style", "how_to_guide"))
        chapters   = int(task.payload.get("chapter_count", 8))
        keywords   = task.payload.get("keywords", [])

        outline = await self._ai_outline(topic, style, chapters, keywords)
        return {"ok": True, "outline": outline, "topic": topic}

    # ── Full ebook generation ─────────────────────────────────────────────────

    async def _generate_ebook(self, task: "Task") -> dict[str, Any]:
        p = task.payload
        topic          = str(p.get("topic", "")).strip()
        style          = str(p.get("style", "how_to_guide"))
        chapter_count  = int(p.get("chapter_count", 8))
        words_per_ch   = int(p.get("words_per_chapter", 400))
        theme          = str(p.get("theme", "dark"))
        cover_prompt   = str(p.get("cover_prompt", "") or p.get("cover_image_prompt", "") or "")
        chapter_images = bool(p.get("chapter_images", False))
        cta_text       = str(p.get("cta_text", "") or "")
        cta_url        = str(p.get("cta_url", "") or "")
        cta_button     = str(p.get("cta_button", "Get Started") or "Get Started")
        author_name    = str(p.get("author_name", "") or get_setting("branding", "brand_name", "Autonomous Prime") or "Autonomous Prime")
        keywords       = p.get("keywords", [])
        outline        = p.get("outline")  # pre-generated outline if provided

        if not topic:
            return {"ok": False, "error": "topic is required"}

        slug = slugify(topic)
        ts   = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out_dir = self._outputs_dir / f"{ts}_{slug}"
        out_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"[EbookAgent] Starting ebook: '{topic}' | {chapter_count} chapters | {style}")

        # 1 — Outline
        if not outline:
            outline = await self._ai_outline(topic, style, chapter_count, keywords)
        chapters_data = outline.get("chapters", [])[:chapter_count]

        # 2 — Cover image
        cover_image_path = ""
        if not cover_prompt:
            cover_prompt = f"Book cover for '{topic}', professional, modern design, high quality illustration"
        cover_image_path = await self._generate_image(
            cover_prompt, out_dir / "cover.png", task
        )

        # 3 — Write chapters (with optional images) — run concurrently in batches of 3
        sem = asyncio.Semaphore(3)
        async def write_chapter(i: int, ch: dict) -> dict:
            async with sem:
                return await self._write_chapter(
                    topic, ch, i + 1, style, words_per_ch,
                    out_dir, chapter_images, task
                )

        chapters_written = await asyncio.gather(*[
            write_chapter(i, ch) for i, ch in enumerate(chapters_data)
        ])

        # 4 — Build HTML
        theme_vars = THEMES.get(theme, THEMES["dark"])
        html = self._render_html(
            title=outline.get("title", topic),
            cover_headline=outline.get("cover_headline", topic),
            subtitle=outline.get("subtitle", ""),
            author_name=author_name,
            style_label=STYLE_LABELS.get(style, style.replace("_", " ").title()),
            cover_image=Path(cover_image_path).name if cover_image_path else "",
            chapters=[{**ch, "image": Path(ch["image"]).name if ch.get("image") else ""} for ch in chapters_written],
            cta_text=cta_text,
            cta_url=cta_url,
            cta_button=cta_button,
            theme_vars=theme_vars,
        )

        # 5 — Save HTML (primary output)
        html_path = out_dir / f"{slug}.html"
        html_path.write_text(html, encoding="utf-8")
        logger.success(f"[EbookAgent] HTML saved: {html_path}")

        # 6 — Save metadata (PDF generated on demand via /api/ebook/export-pdf)
        meta = {
            "topic": topic, "title": outline.get("title", topic),
            "style": style, "theme": theme,
            "chapter_count": len(chapters_written),
            "html_path": str(html_path),
            "pdf_path": "",
            "cover_image": str(cover_image_path),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        def _web_url(p: str) -> str:
            """Convert a local path like outputs/ebook/... → /outputs/ebook/..."""
            if not p:
                return ""
            norm = p.replace("\\", "/")
            idx = norm.find("outputs/")
            return "/" + norm[idx:] if idx >= 0 else ""

        return {
            "ok": True,
            "filepath": str(html_path),
            "html_path": str(html_path),
            "html_url": _web_url(str(html_path)),
            "pdf_path": "",
            "pdf_url": "",
            "cover_image": str(cover_image_path),
            "cover_url": _web_url(str(cover_image_path)),
            "title": outline.get("title", topic),
            "chapter_count": len(chapters_written),
            "slug": slug,
            "out_dir": str(out_dir),
        }

    # ── AI helpers ────────────────────────────────────────────────────────────

    async def _ai_outline(self, topic: str, style: str, chapter_count: int, keywords: list) -> dict:
        kw_str = ", ".join(str(k) for k in keywords if k) if keywords else ""
        system = (
            f"{compose_system_prompt()}\n\n"
            "You are an expert ebook author and content strategist. "
            "Generate outlines that are specific, actionable, and valuable to the reader."
        )
        prompt = (
            f"Create a {STYLE_LABELS.get(style, style)} ebook outline for the topic: '{topic}'\n"
            + (f"Target keywords: {kw_str}\n" if kw_str else "")
            + f"Number of chapters: {chapter_count}\n\n"
            "Return ONLY valid JSON:\n"
            "{\n"
            '  "title": "Full ebook title",\n'
            '  "cover_headline": "Punchy 6-10 word headline for the cover",\n'
            '  "subtitle": "One sentence value proposition",\n'
            '  "chapters": [\n'
            '    {\n'
            '      "title": "Chapter title",\n'
            '      "intro": "1-2 sentence teaser for this chapter",\n'
            '      "sections": ["Section 1 heading", "Section 2 heading", "Section 3 heading"],\n'
            '      "image_prompt": "Visual prompt for chapter image",\n'
            '      "takeaways": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"]\n'
            "    }\n"
            "  ]\n"
            "}"
        )
        result = await self.llm.complete_json(prompt, system=system)
        if not isinstance(result, dict) or "chapters" not in result:
            # fallback simple outline
            result = {
                "title": topic,
                "cover_headline": topic,
                "subtitle": f"Everything you need to know about {topic}",
                "chapters": [
                    {
                        "title": f"Chapter {i+1}: {topic} — Part {i+1}",
                        "intro": "",
                        "sections": ["Introduction", "Core concepts", "Implementation"],
                        "image_prompt": f"Professional illustration for chapter {i+1} about {topic}",
                        "takeaways": [],
                    }
                    for i in range(chapter_count)
                ],
            }
        return result

    async def _write_chapter(
        self, topic: str, ch: dict, num: int, style: str,
        words: int, out_dir: Path, gen_image: bool, task: "Task"
    ) -> dict:
        title    = str(ch.get("title", f"Chapter {num}"))
        intro    = str(ch.get("intro", ""))
        sections = ch.get("sections", [])
        takeaways = ch.get("takeaways", [])
        img_prompt = str(ch.get("image_prompt", ""))

        # Write chapter prose
        sections_str = "\n".join(f"- {s}" for s in sections)
        system = (
            f"{compose_system_prompt()}\n\n"
            f"You are writing chapter {num} of a {STYLE_LABELS.get(style, style)} ebook about '{topic}'. "
            "Write in a clear, engaging, practical voice. Use markdown for structure (## subheadings, bullet points, blockquotes for key insights)."
        )
        prompt = (
            f"Write chapter {num}: '{title}'\n\n"
            f"Chapter intro: {intro}\n\n"
            f"Cover these sections:\n{sections_str}\n\n"
            f"Target length: approximately {words} words.\n"
            "Start directly with the content (no 'Chapter X:' header — that's added separately).\n"
            "Use ## for section headings, bullet points where helpful, and > for key insights/quotes."
        )
        prose = await self.llm.complete(prompt, system=system, max_tokens=max(1500, words * 2))

        # Convert markdown to HTML
        html_body = self._md_to_html(prose)

        # Optional chapter image
        image_path = ""
        if gen_image and img_prompt:
            image_path = await self._generate_image(
                img_prompt, out_dir / f"ch{num:02d}.png", task
            )

        return {
            "title": title,
            "intro": intro,
            "html_body": html_body,
            "image": str(image_path) if image_path else "",
            "takeaways": takeaways,
        }

    def _md_to_html(self, text: str) -> str:
        """Simple markdown → HTML converter (no extra deps needed)."""
        lines = text.split("\n")
        html_lines = []
        in_ul = False
        in_ol = False
        in_blockquote = False

        for line in lines:
            # blockquote
            if line.startswith("> "):
                if in_ul: html_lines.append("</ul>"); in_ul = False
                if in_ol: html_lines.append("</ol>"); in_ol = False
                if not in_blockquote:
                    html_lines.append("<blockquote>"); in_blockquote = True
                html_lines.append(f"<p>{line[2:]}</p>")
                continue
            if in_blockquote:
                html_lines.append("</blockquote>"); in_blockquote = False

            # headings
            if line.startswith("### "):
                if in_ul: html_lines.append("</ul>"); in_ul = False
                html_lines.append(f"<h4>{line[4:]}</h4>")
            elif line.startswith("## "):
                if in_ul: html_lines.append("</ul>"); in_ul = False
                html_lines.append(f"<h3>{line[3:]}</h3>")
            elif line.startswith("# "):
                if in_ul: html_lines.append("</ul>"); in_ul = False
                html_lines.append(f"<h3>{line[2:]}</h3>")
            # unordered list
            elif line.startswith("- ") or line.startswith("* "):
                if in_ol: html_lines.append("</ol>"); in_ol = False
                if not in_ul: html_lines.append("<ul>"); in_ul = True
                html_lines.append(f"<li>{line[2:]}</li>")
            # ordered list
            elif re.match(r"^\d+\. ", line):
                if in_ul: html_lines.append("</ul>"); in_ul = False
                if not in_ol: html_lines.append("<ol>"); in_ol = True
                html_lines.append(f"<li>{re.sub(r'^\d+\. ', '', line)}</li>")
            # blank line
            elif line.strip() == "":
                if in_ul: html_lines.append("</ul>"); in_ul = False
                if in_ol: html_lines.append("</ol>"); in_ol = False
                html_lines.append("")
            else:
                if in_ul: html_lines.append("</ul>"); in_ul = False
                if in_ol: html_lines.append("</ol>"); in_ol = False
                # inline bold/italic
                p = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
                p = re.sub(r"\*(.+?)\*", r"<em>\1</em>", p)
                html_lines.append(f"<p>{p}</p>")

        if in_ul: html_lines.append("</ul>")
        if in_ol: html_lines.append("</ol>")
        if in_blockquote: html_lines.append("</blockquote>")
        return "\n".join(html_lines)

    def _render_html(self, title: str, cover_headline: str, subtitle: str,
                     author_name: str, style_label: str, cover_image: str,
                     chapters: list[dict], cta_text: str, cta_url: str,
                     cta_button: str, theme_vars: dict) -> str:
        from jinja2 import Environment
        env = Environment(autoescape=False)
        env.filters["zfill"] = lambda v, w: str(v).zfill(w)

        tmpl = env.from_string(EBOOK_HTML_TEMPLATE)
        return tmpl.render(
            title=title,
            cover_headline=cover_headline,
            subtitle=subtitle,
            author_name=author_name,
            style_label=style_label,
            cover_image=cover_image,
            chapters=chapters,
            cta_text=cta_text,
            cta_url=cta_url,
            cta_button=cta_button,
            **theme_vars,
        )

    async def _generate_image(self, prompt: str, out_path: Path, task: "Task") -> str:
        """Generate an image via the image_agent submit pattern."""
        try:
            from agents.image_agent import ImageAgent
            agent = ImageAgent(self.llm)
            from core.task_queue import Task as TQ
            import uuid
            img_task = TQ(
                id=str(uuid.uuid4()),
                type="image_gen",
                payload={"topic": prompt, "prompt": prompt, "width": 1024, "height": 1024},
            )
            result = await agent._execute(img_task)
            src = result.get("filepath") or result.get("image_path", "")
            if src and Path(src).exists():
                import shutil
                shutil.copy2(src, out_path)
                return str(out_path)
        except Exception as exc:
            logger.warning(f"[EbookAgent] Image generation failed: {exc}")
        return ""

    async def _export_pdf(self, html_path: Path, pdf_path: Path) -> str:
        """Export HTML to PDF. Tries WeasyPrint → headless Chrome → Playwright."""

        # 1 — WeasyPrint
        try:
            import weasyprint  # type: ignore
            wp = weasyprint.HTML(filename=str(html_path))
            wp.write_pdf(str(pdf_path))
            logger.success(f"[EbookAgent] PDF via WeasyPrint: {pdf_path}")
            return str(pdf_path)
        except ImportError:
            pass
        except Exception as exc:
            logger.warning(f"[EbookAgent] WeasyPrint failed: {exc}")

        # 2 — Headless Chrome (no extra install needed)
        chrome_path = self._find_chrome()
        if chrome_path:
            try:
                proc = await asyncio.create_subprocess_exec(
                    chrome_path,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--run-all-compositor-stages-before-draw",
                    f"--print-to-pdf={pdf_path.resolve()}",
                    "--no-pdf-header-footer",
                    html_path.resolve().as_uri(),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await asyncio.wait_for(proc.communicate(), timeout=60)
                if pdf_path.exists() and pdf_path.stat().st_size > 1024:
                    logger.success(f"[EbookAgent] PDF via Chrome: {pdf_path}")
                    return str(pdf_path)
            except Exception as exc:
                logger.warning(f"[EbookAgent] Chrome PDF failed: {exc}")

        # 3 — Playwright
        try:
            from playwright.async_api import async_playwright  # type: ignore
            async with async_playwright() as pw:
                browser = await pw.chromium.launch()
                page = await browser.new_page()
                await page.goto(html_path.resolve().as_uri(), wait_until="networkidle")
                await page.pdf(path=str(pdf_path), format="A4", print_background=True)
                await browser.close()
            if pdf_path.exists():
                logger.success(f"[EbookAgent] PDF via Playwright: {pdf_path}")
                return str(pdf_path)
        except ImportError:
            pass
        except Exception as exc:
            logger.warning(f"[EbookAgent] Playwright PDF failed: {exc}")

        logger.warning("[EbookAgent] PDF export unavailable — HTML ebook saved instead")
        return ""

    @staticmethod
    def _find_chrome() -> str:
        """Locate the Chrome/Chromium executable on common paths."""
        import sys
        candidates = []
        if sys.platform == "win32":
            candidates = [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files\Chromium\Application\chrome.exe",
            ]
        elif sys.platform == "darwin":
            candidates = [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ]
        else:
            candidates = [
                "/usr/bin/google-chrome",
                "/usr/bin/chromium-browser",
                "/usr/bin/chromium",
            ]
        for path in candidates:
            if Path(path).exists():
                return path
        return ""
