"""
Product Agent — Autonomous Digital Product Creator
====================================================
Handles the full lifecycle: ideate → build → package → launch.

Task types:
  product_ideate  — Generate 3-5 product ideas for a niche
  product_create  — Full creation: content + sales page + funnel + ads
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

# xhtml2pdf is optional — PDF export skipped gracefully if not installed
try:
    from xhtml2pdf import pisa
    _PDF_OK = True
except Exception:
    _PDF_OK = False

import httpx
from loguru import logger
from slugify import slugify

from core.prompting import compose_system_prompt
from core.runtime_settings import get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent

# ─────────────────────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────────────────────

IDEATION_SYSTEM = """
You are a world-class digital product strategist. Given a niche, audience, and pain point,
generate 5 high-converting digital product ideas. Each idea should have a clear transformation,
obvious value, and be priced correctly for its type.

Respond ONLY with valid JSON — a list of 5 objects:
[
  {
    "name": "Product Name",
    "tagline": "One-line promise",
    "product_type": "ebook | mini_course | template_pack | checklist | prompt_pack | swipe_file",
    "offer_type": "lead_magnet | low_ticket | core_offer | high_ticket",
    "price": "$0 | $7 | $17 | $27 | $47 | $97 | $197 | $497 | $997",
    "pain_point": "The specific pain this solves",
    "transformation": "Before → After transformation in one sentence",
    "why_this_sells": "The key reason this will convert",
    "chapters": ["Chapter 1 title", "Chapter 2 title", "..."],
    "target_audience": "Who exactly buys this",
    "urgency_hook": "Why they need it now"
  }
]

Rules:
- lead_magnet = $0 (free giveaway to build list)
- low_ticket = $7–$47 (impulse buy, quick win)
- core_offer = $97–$497 (main product, deep transformation)
- high_ticket = $997+ (coaching, done-for-you, community)
- Be SPECIFIC about the transformation — not "get healthier" but "lose 12 lbs in 6 weeks without cardio"
- Name should be compelling and include a number or specific result when possible
"""

CONTENT_SYSTEM = """
You are an expert ghostwriter who creates high-value digital products that people love and
recommend. You write with clarity, specificity, and actionable depth. No fluff, no filler.

Given a product brief, write the full content for each chapter/section.
Respond ONLY with valid JSON:
{
  "title": "Full product title",
  "subtitle": "Subtitle / tagline",
  "introduction": "Compelling intro (300-500 words) — open with a story or bold claim",
  "chapters": [
    {
      "title": "Chapter title",
      "body": "Full chapter content (400-800 words, specific + actionable)"
    }
  ],
  "conclusion": "Powerful close with call to action (200-300 words)",
  "key_takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],
  "bonus_tip": "One surprising, high-value bonus insight"
}

Rules:
- Write in second person (you/your) — talk directly to the reader
- Every chapter must have at least one concrete action step
- Use specifics: numbers, timeframes, examples
- Avoid generic advice — give the EXACT method, framework, or system
- Chapters should flow: Problem → Why → Method → Action → Result
"""

PRODUCT_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>{title}</title>
<style>
  :root {{
    --accent: {accent};
    --bg: {bg};
    --text: {text_color};
    --muted: #8b949e;
    --card: #161b22;
    --border: #30363d;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Georgia', serif; background: var(--bg); color: var(--text); line-height: 1.85; max-width: 720px; margin: 0 auto; padding: 40px 24px; }}
  h1 {{ font-size: 2.6em; font-weight: 900; line-height: 1.15; margin-bottom: 12px; font-family: 'Arial Black', sans-serif; color: var(--accent); }}
  h2 {{ font-size: 1.6em; font-weight: 800; margin: 52px 0 16px; font-family: Arial, sans-serif; color: var(--text); border-left: 4px solid var(--accent); padding-left: 14px; }}
  h3 {{ font-size: 1.1em; font-weight: 700; margin: 28px 0 10px; font-family: Arial, sans-serif; color: var(--accent); }}
  p {{ margin-bottom: 18px; }}
  .cover {{ text-align: center; padding: 80px 0 60px; border-bottom: 1px solid var(--border); margin-bottom: 60px; }}
  .cover .badge {{ display: inline-block; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); padding: 5px 16px; border-radius: 99px; font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 24px; font-family: Arial, sans-serif; }}
  .cover .subtitle {{ font-size: 1.15em; color: var(--muted); margin-top: 16px; font-style: italic; }}
  .cover .author {{ margin-top: 28px; font-size: 0.85em; color: var(--muted); font-family: Arial, sans-serif; }}
  .intro {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 32px; margin-bottom: 48px; font-size: 1.05em; }}
  .chapter {{ margin-bottom: 60px; }}
  .chapter-body {{ font-size: 1.02em; }}
  .chapter-body p {{ margin-bottom: 20px; }}
  .takeaways {{ background: color-mix(in srgb, var(--accent) 8%, var(--card)); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); border-radius: 12px; padding: 28px 32px; margin: 48px 0; }}
  .takeaways h3 {{ margin-top: 0; margin-bottom: 16px; }}
  .takeaways ul {{ list-style: none; padding: 0; }}
  .takeaways li {{ padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.96em; }}
  .takeaways li:before {{ content: "✓ "; color: var(--accent); font-weight: 800; }}
  .takeaways li:last-child {{ border-bottom: none; }}
  .conclusion {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 32px; margin-top: 60px; }}
  .bonus {{ background: color-mix(in srgb, #3fb950 10%, var(--card)); border: 1px solid rgba(63,185,80,0.3); border-radius: 12px; padding: 24px 28px; margin-top: 32px; }}
  .bonus-label {{ font-family: Arial, sans-serif; font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #3fb950; margin-bottom: 10px; }}
</style>
</head>
<body>

<div class="cover">
  <div class="badge">{product_type_label}</div>
  <h1>{title}</h1>
  <p class="subtitle">{subtitle}</p>
  <p class="author">By {author}</p>
</div>

<div class="intro">
{introduction}
</div>

{chapters_html}

<div class="takeaways">
  <h3>Key Takeaways</h3>
  <ul>
    {takeaways_html}
  </ul>
</div>

<div class="conclusion">
  <h2>Final Thoughts</h2>
  {conclusion}
</div>

<div class="bonus">
  <div class="bonus-label">⚡ Bonus Insight</div>
  <p>{bonus_tip}</p>
</div>

</body>
</html>
"""

PRODUCT_TYPE_LABELS = {
    "ebook":         "Digital eBook",
    "mini_course":   "Mini Course",
    "template_pack": "Template Pack",
    "checklist":     "Action Checklist",
    "prompt_pack":   "AI Prompt Pack",
    "swipe_file":    "Swipe File",
}


def _write_pdf(html_path: Path, pdf_path: Path, content: dict, product: dict, accent: str) -> str:
    """
    Convert product HTML to PDF using xhtml2pdf (pure Python, no system libs).
    Returns the relative URL string on success, empty string on failure.
    Uses a simplified light-mode stylesheet since xhtml2pdf does not support
    CSS variables or color-mix().
    """
    if not _PDF_OK:
        return ""

    # Build a print-friendly HTML with inlined, xhtml2pdf-compatible CSS
    chapters_html = ""
    for i, ch in enumerate(content.get("chapters", []), 1):
        body = ch.get("body", "").replace("\n\n", "</p><p>").replace("\n", "<br/>")
        chapters_html += f"<div class='chapter'><h2>Chapter {i}: {ch.get('title','')}</h2><p>{body}</p></div>"

    takeaways = "".join(f"<li>{t}</li>" for t in content.get("key_takeaways", []))
    author = product.get("brand_name", "Autonomous Prime")

    pdf_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/>
<style>
  @page {{ size: A4; margin: 2.5cm 2cm; }}
  body {{ font-family: Georgia, serif; color: #1a1a1a; line-height: 1.7; font-size: 11pt; }}
  h1 {{ font-size: 24pt; color: {accent}; margin-bottom: 8pt; }}
  h2 {{ font-size: 15pt; color: #1a1a1a; border-left: 4pt solid {accent}; padding-left: 10pt; margin-top: 28pt; }}
  h3 {{ font-size: 12pt; color: {accent}; margin-top: 16pt; }}
  p  {{ margin-bottom: 10pt; }}
  .cover {{ text-align: center; padding: 60pt 0 40pt; border-bottom: 1pt solid #ddd; margin-bottom: 40pt; }}
  .cover .badge {{ font-size: 8pt; font-weight: bold; letter-spacing: 2pt; text-transform: uppercase; color: {accent}; }}
  .cover .subtitle {{ font-size: 13pt; color: #666; font-style: italic; margin-top: 10pt; }}
  .cover .author  {{ font-size: 9pt; color: #888; margin-top: 16pt; }}
  .chapter {{ margin-bottom: 32pt; page-break-inside: avoid; }}
  .takeaways {{ background: #f5f5f5; padding: 18pt; margin: 24pt 0; }}
  .takeaways ul {{ margin: 0; padding-left: 14pt; }}
  .takeaways li {{ margin-bottom: 6pt; }}
  .conclusion {{ background: #f9f9f9; padding: 18pt; margin-top: 32pt; }}
  .bonus {{ background: #f0fff4; border-left: 4pt solid #22c55e; padding: 14pt; margin-top: 20pt; }}
  .bonus-label {{ font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #16a34a; margin-bottom: 6pt; }}
</style>
</head>
<body>
<div class="cover">
  <div class="badge">{PRODUCT_TYPE_LABELS.get(product.get('product_type','ebook'), 'Digital Product')}</div>
  <h1>{content.get('title', product.get('name',''))}</h1>
  <div class="subtitle">{content.get('subtitle', product.get('tagline',''))}</div>
  <div class="author">By {author}</div>
</div>
<div>{content.get('introduction','').replace(chr(10)+chr(10),'</p><p>')}</div>
{chapters_html}
<div class="takeaways"><h3>Key Takeaways</h3><ul>{takeaways}</ul></div>
<div class="conclusion"><h2>Final Thoughts</h2><p>{content.get('conclusion','').replace(chr(10)+chr(10),'</p><p>')}</p></div>
<div class="bonus"><div class="bonus-label">Bonus Insight</div><p>{content.get('bonus_tip','')}</p></div>
</body></html>"""

    folder_name = html_path.parent.name
    with open(str(pdf_path), "wb") as f:
        result = pisa.CreatePDF(pdf_html, dest=f)
    if result.err:
        return ""
    return f"/outputs/products/{folder_name}/product.pdf"


# ─────────────────────────────────────────────────────────────────────────────
# Agent
# ─────────────────────────────────────────────────────────────────────────────

class ProductAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("product_agent", llm, max_concurrent=2)
        self._data_dir    = Path(os.getenv("DATA_DIR", "./data"))
        self._outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._db_path = self._data_dir / "products.db"
        self._init_db()

    # ── Init ─────────────────────────────────────────────────────────────────

    def _init_db(self) -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL,
                tagline         TEXT DEFAULT '',
                product_type    TEXT DEFAULT 'ebook',
                offer_type      TEXT DEFAULT 'low_ticket',
                niche           TEXT DEFAULT '',
                target_audience TEXT DEFAULT '',
                pain_point      TEXT DEFAULT '',
                transformation  TEXT DEFAULT '',
                price_point     TEXT DEFAULT '',
                why_it_sells    TEXT DEFAULT '',
                urgency_hook    TEXT DEFAULT '',
                status          TEXT DEFAULT 'ideated',
                ebook_path      TEXT DEFAULT '',
                ebook_url       TEXT DEFAULT '',
                pdf_url         TEXT DEFAULT '',
                sales_page_slug TEXT DEFAULT '',
                sales_page_url  TEXT DEFAULT '',
                funnel_slug     TEXT DEFAULT '',
                funnel_url      TEXT DEFAULT '',
                stripe_url      TEXT DEFAULT '',
                ad_copy_path    TEXT DEFAULT '',
                chapters_json   TEXT DEFAULT '[]',
                meta_json       TEXT DEFAULT '{}',
                created_at      TEXT DEFAULT (datetime('now')),
                launched_at     TEXT,
                revenue_total   REAL DEFAULT 0,
                units_sold      INTEGER DEFAULT 0
            );
        """)
        conn.commit()
        # Migration: add pdf_url to existing databases that predate this column
        try:
            conn.execute("ALTER TABLE products ADD COLUMN pdf_url TEXT DEFAULT ''")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
        conn.close()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def skill_summary(self) -> dict:
        return {
            "name": "ProductAgent",
            "capabilities": ["product_ideate", "product_create"],
            "description": "Autonomously ideates, writes, and packages digital products — ebooks, mini-courses, template packs, prompt packs, checklists.",
        }

    # ── Dispatch ─────────────────────────────────────────────────────────────

    async def _execute(self, task: "Task") -> dict:
        if task.type == "product_ideate":
            return await self._ideate(task)
        if task.type == "product_create":
            return await self._create(task)
        return {"error": f"Unknown task type: {task.type}"}

    # ── Ideate ────────────────────────────────────────────────────────────────

    async def _ideate(self, task: "Task") -> dict:  # type: ignore[override]
        p = task.payload
        niche           = p.get("niche", "")
        target_audience = p.get("target_audience", p.get("audience", ""))
        pain_point      = p.get("pain_point", "")
        offer_type      = p.get("offer_type", "")

        user_prompt = (
            f"Niche: {niche}\n"
            f"Target audience: {target_audience}\n"
            f"Primary pain point: {pain_point}\n"
            f"Preferred offer type: {offer_type or 'any'}\n\n"
            "Generate 5 highly specific, pain-driven digital product ideas."
        )

        system = compose_system_prompt("product_agent", IDEATION_SYSTEM)
        raw = await self.llm.complete(user_prompt, system=system, max_tokens=3000, cache=True)
        ideas = self._parse_json(raw, list)

        if not ideas:
            return {"error": "LLM returned invalid ideas JSON", "raw": raw}

        # Save each idea as an 'ideated' product record
        conn = self._get_conn()
        saved = []
        for idea in ideas:
            cur = conn.execute(
                """INSERT INTO products
                   (name, tagline, product_type, offer_type, niche, target_audience,
                    pain_point, transformation, price_point, why_it_sells, urgency_hook,
                    chapters_json, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    idea.get("name", ""),
                    idea.get("tagline", ""),
                    idea.get("product_type", "ebook"),
                    idea.get("offer_type", "low_ticket"),
                    niche,
                    idea.get("target_audience", target_audience),
                    idea.get("pain_point", pain_point),
                    idea.get("transformation", ""),
                    idea.get("price", ""),
                    idea.get("why_this_sells", ""),
                    idea.get("urgency_hook", ""),
                    json.dumps(idea.get("chapters", [])),
                    "ideated",
                ],
            )
            idea["id"] = cur.lastrowid
            saved.append(idea)
        conn.commit()
        conn.close()

        logger.info(f"[ProductAgent] Ideated {len(saved)} product ideas for niche: {niche}")
        return {"ideas": saved, "count": len(saved)}

    # ── Create ────────────────────────────────────────────────────────────────

    async def _create(self, task: "Task") -> dict:
        p = task.payload
        product_id = p.get("product_id")

        # Load existing product record or build from payload
        if product_id:
            product = self._load_product(int(product_id))
            if not product:
                return {"error": f"Product #{product_id} not found"}
            # Merge any overrides from the payload
            product.update({k: v for k, v in p.items() if k not in ("product_id",) and v})
        else:
            product = {
                "name":            p.get("name", p.get("topic", "Untitled Product")),
                "tagline":         p.get("tagline", ""),
                "product_type":    p.get("product_type", "ebook"),
                "offer_type":      p.get("offer_type", "low_ticket"),
                "niche":           p.get("niche", ""),
                "target_audience": p.get("target_audience", ""),
                "pain_point":      p.get("pain_point", ""),
                "transformation":  p.get("transformation", ""),
                "price_point":     p.get("price_point", p.get("price", "")),
                "chapters_json":   json.dumps(p.get("chapters", [])),
                "stripe_url":      p.get("stripe_url", ""),
            }
            # Save initial record
            conn = self._get_conn()
            cur = conn.execute(
                """INSERT INTO products (name,tagline,product_type,offer_type,niche,
                   target_audience,pain_point,transformation,price_point,chapters_json,stripe_url,status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,'building')""",
                [product[k] for k in ("name","tagline","product_type","offer_type","niche",
                                      "target_audience","pain_point","transformation",
                                      "price_point","chapters_json","stripe_url")],
            )
            product["id"] = cur.lastrowid
            conn.commit()
            conn.close()

        self._update_status(product["id"], "building")
        logger.info(f"[ProductAgent] Building product #{product['id']}: {product['name']}")

        # 1. Write the product content
        ebook_path, ebook_url, pdf_url = await self._write_content(product)
        self._update_field(product["id"], "ebook_path", str(ebook_path))
        self._update_field(product["id"], "ebook_url", ebook_url)
        if pdf_url:
            self._update_field(product["id"], "pdf_url", pdf_url)

        # 2. Submit marketing tasks (fire-and-forget via orchestrator API)
        await self._submit_marketing(product)

        self._update_status(product["id"], "complete")
        logger.success(f"[ProductAgent] ✓ Product #{product['id']} complete: {product['name']}")

        return {
            "product_id":  product["id"],
            "name":        product["name"],
            "ebook_path":  str(ebook_path),
            "ebook_url":   ebook_url,
            "pdf_url":     pdf_url,
            "status":      "complete",
        }

    # ── Content writer ────────────────────────────────────────────────────────

    async def _write_content(self, product: dict) -> tuple[Path, str, str]:
        chapters = json.loads(product.get("chapters_json", "[]")) if isinstance(product.get("chapters_json"), str) else product.get("chapters", [])

        user_prompt = (
            f"Product name: {product['name']}\n"
            f"Tagline: {product.get('tagline','')}\n"
            f"Product type: {product.get('product_type','ebook')}\n"
            f"Target audience: {product.get('target_audience','')}\n"
            f"Core pain: {product.get('pain_point','')}\n"
            f"Transformation: {product.get('transformation','')}\n"
            f"Chapter outline: {json.dumps(chapters)}\n\n"
            "Write the complete product content now. Be specific, actionable, and valuable."
        )

        system = compose_system_prompt("product_agent", CONTENT_SYSTEM)
        raw = await self.llm.complete(user_prompt, system=system, max_tokens=8000)
        content = self._parse_json(raw, dict)

        if not content:
            # Graceful fallback — save raw text
            content = {
                "title":        product["name"],
                "subtitle":     product.get("tagline", ""),
                "introduction": raw[:2000],
                "chapters":     [{"title": "Full Content", "body": raw}],
                "conclusion":   "",
                "key_takeaways": [],
                "bonus_tip":    "",
            }

        return self._render_html(product, content)

    def _render_html(self, product: dict, content: dict) -> tuple[Path, str, str]:
        slug      = slugify(product["name"])[:60]
        ts        = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        folder    = self._outputs_dir / "products" / f"{ts}_{slug}"
        folder.mkdir(parents=True, exist_ok=True)
        out_path  = folder / "product.html"

        accent     = product.get("accent_color", "#58a6ff")
        bg         = product.get("bg_color", "#0d1117")
        text_color = "#e6edf3"
        author     = product.get("brand_name", get_setting("brand", "name", "Autonomous Prime"))
        ptype      = product.get("product_type", "ebook")

        # Build chapters HTML
        chapters_html = ""
        for i, ch in enumerate(content.get("chapters", []), 1):
            body = ch.get("body", "").replace("\n\n", "</p><p>").replace("\n", "<br/>")
            chapters_html += f"""
            <div class="chapter">
              <h2>Chapter {i}: {ch.get('title','')}</h2>
              <div class="chapter-body"><p>{body}</p></div>
            </div>
            """

        # Key takeaways
        takeaways_html = "".join(
            f"<li>{t}</li>" for t in content.get("key_takeaways", [])
        )

        html = PRODUCT_HTML_TEMPLATE.format(
            title            = content.get("title", product["name"]),
            subtitle         = content.get("subtitle", product.get("tagline", "")),
            introduction     = content.get("introduction", "").replace("\n\n", "</p><p>"),
            chapters_html    = chapters_html,
            takeaways_html   = takeaways_html,
            conclusion       = content.get("conclusion", "").replace("\n\n", "</p><p>"),
            bonus_tip        = content.get("bonus_tip", ""),
            author           = author,
            product_type_label = PRODUCT_TYPE_LABELS.get(ptype, ptype.replace("_", " ").title()),
            accent           = accent,
            bg               = bg,
            text_color       = text_color,
        )

        out_path.write_text(html, encoding="utf-8")

        # Save a JSON meta file alongside — includes full content so PDF can be regenerated later
        meta = {
            **product,
            "content_keys":  list(content.keys()),
            "chapter_count": len(content.get("chapters", [])),
            # Full written content (needed for on-demand PDF generation)
            "title":         content.get("title", product.get("name", "")),
            "subtitle":      content.get("subtitle", product.get("tagline", "")),
            "introduction":  content.get("introduction", ""),
            "chapters":      content.get("chapters", []),
            "conclusion":    content.get("conclusion", ""),
            "key_takeaways": content.get("key_takeaways", []),
            "bonus_tip":     content.get("bonus_tip", ""),
            "accent_color":  accent,
        }
        (folder / "product_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        ebook_url = f"/outputs/products/{folder.name}/product.html"
        logger.info(f"[ProductAgent] Product HTML saved → {out_path}")

        # ── PDF export (optional, requires xhtml2pdf) ─────────────────────
        pdf_url = ""
        if _PDF_OK:
            try:
                pdf_path = out_path.with_suffix(".pdf")
                pdf_url = _write_pdf(out_path, pdf_path, content, product, accent)
                if pdf_url:
                    logger.info(f"[ProductAgent] PDF saved → {pdf_path}")
            except Exception as exc:
                logger.warning(f"[ProductAgent] PDF conversion failed (continuing without PDF): {exc}")
        else:
            logger.warning("[ProductAgent] xhtml2pdf not installed — skipping PDF. Run: pip install xhtml2pdf")

        return out_path, ebook_url, pdf_url

    # ── Marketing orchestration ───────────────────────────────────────────────

    async def _submit_marketing(self, product: dict) -> None:
        """Submit sales page + funnel + ads as tasks via the Python API."""
        api_base = os.getenv("PYTHON_API_URL", "http://localhost:8000")
        internal = os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal")
        headers  = {"x-internal-token": internal, "Content-Type": "application/json"}

        shared = {
            "topic":            product["name"],
            "keywords":         [product.get("niche",""), product.get("pain_point","")],
            "target_audience":  product.get("target_audience", ""),
            "product_offer":    product["name"],
            "price_point":      product.get("price_point", ""),
            "stripe_url":       product.get("stripe_url", ""),
            "brand_name":       product.get("brand_name", ""),
            "pain_point":       product.get("pain_point", ""),
            "transformation":   product.get("transformation", ""),
            "offer_type":       product.get("offer_type", "low_ticket"),
            "product_id":       product.get("id"),
            "ebook_url":        product.get("ebook_url", ""),
        }

        tasks = [
            ("sales_page_gen", {**shared}),
            ("funnel_gen",     {**shared}),
            ("ads_gen",        {**shared}),
        ]

        async with httpx.AsyncClient(timeout=15) as client:
            for task_type, payload in tasks:
                try:
                    r = await client.post(
                        f"{api_base}/api/tasks",
                        headers=headers,
                        json={"type": task_type, "payload": payload},
                    )
                    if r.status_code in (200, 201):
                        tid = r.json().get("task_id", "")
                        logger.info(f"[ProductAgent] Queued {task_type} → task {tid}")
                    else:
                        logger.warning(f"[ProductAgent] {task_type} submit failed: {r.text}")
                except Exception as exc:
                    logger.warning(f"[ProductAgent] Could not submit {task_type}: {exc}")

    # ── DB helpers ────────────────────────────────────────────────────────────

    def _load_product(self, product_id: int) -> dict | None:
        conn = self._get_conn()
        row  = conn.execute("SELECT * FROM products WHERE id=?", [product_id]).fetchone()
        conn.close()
        return dict(row) if row else None

    def _update_status(self, product_id: int, status: str) -> None:
        conn = self._get_conn()
        conn.execute("UPDATE products SET status=? WHERE id=?", [status, product_id])
        conn.commit()
        conn.close()

    def _update_field(self, product_id: int, field: str, value: str) -> None:
        conn = self._get_conn()
        conn.execute(f"UPDATE products SET {field}=? WHERE id=?", [value, product_id])
        conn.commit()
        conn.close()

    @staticmethod
    def _parse_json(raw: str, expected_type: type) -> Any:
        try:
            raw = raw.strip()
            # Strip markdown fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw.strip())
            if isinstance(result, expected_type):
                return result
        except Exception:
            pass
        # Try extracting first JSON block
        import re
        pattern = r"\[.*\]" if expected_type is list else r"\{.*\}"
        m = re.search(pattern, raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
        return None
