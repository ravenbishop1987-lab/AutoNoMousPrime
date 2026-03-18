"""
Content Agent — SEO-optimized blog post generation + metadata extraction
Outputs structured SEO data compatible with WordPress + Yoast/RankMath
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

from loguru import logger
from slugify import slugify

from core.prompting import compose_system_prompt, get_prompt_override
if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent


BLOG_SYSTEM = """You are an expert SEO content writer and digital marketing strategist.
Output ONLY a complete Markdown document with YAML frontmatter. No preamble or explanation.

The frontmatter must include ALL of these fields:
  title, slug, meta_description, focus_keyword, secondary_keywords (list),
  category, tags (list), excerpt, estimated_read_time, schema_type

The body must include:
- H1 matching the title
- Introduction with primary keyword in first 100 words
- 4-6 H2 sections with supporting H3 subsections where useful
- Practical examples, statistics, and actionable advice
- Internal link placeholders: {{INTERNAL_LINK: topic}}
- FAQ section (3 Q&A pairs) targeting long-tail keywords
- Strong CTA conclusion
- Natural keyword density 1-2%
- No strikethrough formatting in any heading
- Keep the H1 clean plain text only
- Total article length should be about {word_count} words
"""

BLOG_PROMPT = """Write a comprehensive, SEO-optimized blog post about: {topic}

Keywords:
- Primary (focus): {primary_kw}
- Secondary: {secondary_kws}
- LSI/related: {lsi_kws}

Target audience: {audience}
Tone: professional but accessible
Word count target: about {word_count} words

Output the complete markdown document starting with --- frontmatter ---"""

TEMPLATE_GUIDANCE_PROMPT = """

Execution template selected:
- Name: {template_name}
- Kind: {template_kind}

Template body:
{template_body}

Apply this template as an execution constraint. Reuse its structure, placeholders, and tone where relevant, but still produce a complete final document instead of leaving placeholders unresolved.
"""

SEO_RESEARCH_PROMPT = """Perform detailed SEO keyword research for the topic: {topic}

Return ONLY a JSON object (no explanation) with this exact structure:
{{
  "primary_keyword": "main search term",
  "secondary_keywords": ["term1", "term2", "term3"],
  "lsi_keywords": ["related1", "related2", "related3", "related4", "related5"],
  "long_tail_keywords": ["long tail 1", "long tail 2", "long tail 3"],
  "search_intent": "informational",
  "monthly_search_volume_estimate": "high|medium|low",
  "keyword_difficulty_estimate": "hard|medium|easy",
  "recommended_title": "SEO optimized title with primary keyword",
  "meta_description": "Compelling 150-160 char description with primary keyword",
  "content_outline": ["H2: Section 1", "H2: Section 2", "H2: Section 3", "H2: Section 4", "H2: FAQ"],
  "internal_link_opportunities": ["related topic 1", "related topic 2"],
  "schema_type": "Article|HowTo|FAQPage",
  "target_audience": "description of ideal reader"
}}"""


class ContentAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("content_agent", llm, max_concurrent=2)
        self._blog_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "blog"
        self._blog_dir.mkdir(parents=True, exist_ok=True)

    def skill_summary(self) -> dict:
        return {
            "name": "ContentAgent",
            "capabilities": ["blog_post", "seo_research", "rewrite_post"],
            "description": "Generates SEO-optimized blog posts, performs keyword research, and rewrites social/blog copy",
            "model": "claude-sonnet-4-6 / ollama fallback",
            "skills_loaded": len(self.skill_inventory()),
            "profile_dir": str(self._profile_dir),
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        if task.type == "seo_research":
            return await self._seo_research(task)
        if task.type == "rewrite_post":
            return await self._rewrite_post(task)
        return await self._write_blog_post(task)

    async def _seo_research(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "")
        prompt_template = get_prompt_override("content_seo_research_prompt", SEO_RESEARCH_PROMPT)
        result = await self.llm.complete_json(
            f"{prompt_template.format(topic=topic)}\n\n{self.skill_context('seo_research')}".strip(),
            system=compose_system_prompt("You are performing SEO research and content planning."),
            use_local=False,
            cache=True,
        )
        logger.info(f"[ContentAgent] SEO research done for: {topic}")
        return {"type": "seo_research", "topic": topic, **result}

    async def _rewrite_post(self, task: "Task") -> dict[str, Any]:
        """
        Rewrite existing social or blog copy for a specific platform.
        Payload: { text: str, platform: str, tone?: str }
        Returns: { rewritten_text: str, platform: str }
        """
        text     = str(task.payload.get("text", "")).strip()
        platform = str(task.payload.get("platform", "x")).strip()
        tone     = str(task.payload.get("tone", "professional but engaging")).strip()

        platform_guides: dict[str, str] = {
            "x":               "Max 280 characters. Sharp hook in the first sentence. One clear CTA. No hashtag spam.",
            "linkedin":        "Professional tone. 3-5 punchy bullet points or short paragraphs. End with a question or CTA to drive comments.",
            "instagram":       "Conversational and visual. Short hook, story-driven body, 5-10 relevant hashtags at the end.",
            "instagram_posts": "Conversational and visual. Short hook, story-driven body, 5-10 relevant hashtags at the end.",
            "facebook":        "Two short paragraphs. Friendly tone. End with a question to encourage engagement.",
            "facebook_groups": "Discussion-style. Open with a question or insight. No promotional tone.",
            "youtube":         "High-energy hook in the first line. Benefit-focused description. Include timestamps if applicable.",
            "tiktok":          "Punchy and casual. Hook in first 3 words. Trend-aware. Short and direct.",
        }
        guide = platform_guides.get(platform, "Clear, concise, and engaging. Include a call to action.")

        prompt = f"""Rewrite the following social post for {platform}.

Platform guidelines: {guide}
Tone: {tone}

Original post:
{text}

Return ONLY the rewritten post text. No explanation, no quotes, no preamble."""

        rewritten = await self.llm.complete(
            prompt,
            system=compose_system_prompt("You are an expert social media copywriter specializing in platform-native content."),
            max_tokens=512,
        )
        rewritten = rewritten.strip().strip('"').strip("'").strip()
        logger.info(f"[ContentAgent] rewrite_post done for platform={platform} ({len(rewritten)} chars)")
        return {
            "type": "rewrite_post",
            "platform": platform,
            "original_text": text,
            "rewritten_text": rewritten,
        }

    async def _write_blog_post(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "")
        keywords = task.payload.get("keywords", [topic])
        seo_data = task.payload.get("seo_data", {})
        input_payload = task.payload.get("input_payload", {}) if isinstance(task.payload.get("input_payload"), dict) else {}

        primary_kw  = seo_data.get("primary_keyword") or (keywords[0] if keywords else topic)
        secondary   = seo_data.get("secondary_keywords") or keywords[1:]
        lsi         = seo_data.get("lsi_keywords", [])
        audience    = (
            task.payload.get("target_audience")
            or input_payload.get("target_audience")
            or seo_data.get("target_audience", "general audience")
        )
        tone        = task.payload.get("tone") or input_payload.get("tone", "professional but accessible")
        content_goal = task.payload.get("content_goal") or input_payload.get("content_goal", "inform")
        brand_name  = task.payload.get("brand_name") or input_payload.get("brand_name", "")
        cta_url     = task.payload.get("cta_url") or input_payload.get("cta_url", "")
        word_count  = int(input_payload.get("word_count") or task.payload.get("word_count") or 1500)

        extra_context = ""
        if brand_name:
            extra_context += f"\nAuthor/Brand: {brand_name}"
        if cta_url:
            extra_context += f"\nPrimary CTA URL: {cta_url}"
        if content_goal != "inform":
            extra_context += f"\nContent goal: {content_goal}"

        prompt = BLOG_PROMPT.format(
            topic=topic,
            primary_kw=primary_kw,
            secondary_kws=", ".join(secondary[:5]),
            lsi_kws=", ".join(lsi[:5]),
            audience=audience,
            word_count=word_count,
        ) + extra_context
        template_body = str(input_payload.get("template_body") or "").strip()
        if template_body:
            prompt += TEMPLATE_GUIDANCE_PROMPT.format(
                template_name=str(input_payload.get("template_name") or "Workspace template").strip() or "Workspace template",
                template_kind=str(input_payload.get("template_kind") or "content_preset").strip() or "content_preset",
                template_body=template_body,
            )
        blog_system = get_prompt_override("content_blog_system", BLOG_SYSTEM).format(word_count=word_count)
        blog_system += f"\nTone: {tone}"
        system_prompt = compose_system_prompt(blog_system)
        skill_context = self.skill_context("blog_post")
        if skill_context:
            system_prompt = compose_system_prompt(blog_system, f"Skill guidance:\n{skill_context}")

        logger.info(f"[ContentAgent] Writing blog post: {topic}")
        max_tokens = max(4096, word_count * 2)
        content = await self.llm.complete(prompt, system=system_prompt, max_tokens=max_tokens)
        content = self._sanitize_generated_markdown(content)

        meta = self._extract_meta(content)
        slug = meta.get("slug") or slugify(topic)
        title = meta.get("title", topic)
        word_count = len(re.sub(r"---[\s\S]*?---", "", content).split())

        # Save .md file
        filename = f"{datetime.utcnow().strftime('%Y%m%d')}_{slug}.md"
        filepath = self._blog_dir / filename
        filepath.write_text(content, encoding="utf-8")

        # Also save structured SEO JSON
        import json
        seo_out = {
            "title": title,
            "slug": slug,
            "meta_description": meta.get("meta_description", ""),
            "focus_keyword": meta.get("focus_keyword", primary_kw),
            "secondary_keywords": meta.get("secondary_keywords", secondary),
            "category": meta.get("category", "General"),
            "tags": meta.get("tags", []),
            "excerpt": meta.get("excerpt", ""),
            "schema_type": meta.get("schema_type", "Article"),
            "estimated_read_time": meta.get("estimated_read_time", f"{max(1, word_count // 200)} min"),
            "word_count": word_count,
            "internal_links": self._extract_internal_link_placeholders(content),
        }
        seo_path = self._blog_dir / f"{slug}_seo.json"
        seo_path.write_text(json.dumps(seo_out, indent=2), encoding="utf-8")

        logger.success(f"[ContentAgent] Blog saved: {filename} ({word_count} words)")
        return {
            "type": "blog_post",
            "topic": topic,
            "filepath": str(filepath),
            "seo_json_path": str(seo_path),
            "word_count": word_count,
            "aspect_ratio": task.payload.get("aspect_ratio", "16:9"),
            "template_name": input_payload.get("template_name", ""),
            "template_kind": input_payload.get("template_kind", ""),
            **seo_out,
            "content_preview": content[:600],
        }

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _extract_meta(self, content: str) -> dict:
        """Parse YAML frontmatter fields from the generated markdown."""
        result: dict = {}
        fm_match = re.search(r"^---\s*([\s\S]*?)\s*---", content, re.MULTILINE)
        if not fm_match:
            return result
        fm = fm_match.group(1)

        # Simple key: value
        for key in ("title", "slug", "meta_description", "focus_keyword",
                    "category", "excerpt", "schema_type", "estimated_read_time"):
            m = re.search(rf"^{key}:\s*['\"]?(.+?)['\"]?\s*$", fm, re.MULTILINE)
            if m:
                result[key] = m.group(1).strip()

        # Lists: tags, secondary_keywords
        for key in ("tags", "secondary_keywords"):
            # Inline list: key: [a, b, c]
            m = re.search(rf"^{key}:\s*\[(.+?)\]", fm, re.MULTILINE)
            if m:
                result[key] = [i.strip().strip("'\"") for i in m.group(1).split(",")]
            else:
                # Block list
                m2 = re.search(rf"^{key}:\s*\n((?:\s+-\s+.+\n?)+)", fm, re.MULTILINE)
                if m2:
                    result[key] = [
                        re.sub(r"^\s*-\s*", "", line).strip()
                        for line in m2.group(1).splitlines()
                        if line.strip()
                    ]
        return result

    def _extract_internal_link_placeholders(self, content: str) -> list[str]:
        return re.findall(r"\{\{INTERNAL_LINK:\s*([^}]+)\}\}", content)

    def _sanitize_generated_markdown(self, content: str) -> str:
        """Normalize heading formatting and trim noisy markdown artifacts."""
        lines = content.splitlines()
        cleaned: list[str] = []
        for line in lines:
            if re.match(r"^\s*#{1,6}\s+", line):
                line = re.sub(r"~~([^~]+)~~", r"\1", line)
                line = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", line)
                line = re.sub(r"_{1,2}([^_]+)_{1,2}", r"\1", line)
                line = re.sub(r"\s{2,}", " ", line).strip()
            cleaned.append(line.rstrip())
        normalized = "\n".join(cleaned)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip() + "\n"
        return normalized
