"""
Ads Agent — Generates ad copy for all major platforms
Platforms: Facebook/Instagram, TikTok, Twitter/X, Google Ads (RSA)
Outputs: ads.json + ads_preview.html
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent


ADS_SYSTEM = """You are a world-class paid advertising copywriter specializing in direct response.
Generate ad copy for all platforms as a single JSON object. Output ONLY valid JSON, no markdown, no preamble.

JSON structure:
{
  "facebook_instagram": {
    "variations": [
      {
        "primary_text": "The main ad body (up to 125 chars for feed, punchy hook first)",
        "headline": "Ad headline (27 chars max)",
        "description": "Link description (27 chars max)",
        "cta": "Button label (e.g. Learn More, Sign Up, Get Started)"
      }
    ]
  },
  "tiktok": {
    "variations": [
      {
        "hook": "First 3 seconds — the scroll-stopper line (under 10 words)",
        "script_15s": "Full 15-second spoken script (about 35-40 words)",
        "script_30s": "Full 30-second spoken script (about 70-80 words)",
        "caption": "Post caption with emojis (under 100 chars)",
        "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]
      }
    ]
  },
  "twitter_x": {
    "single_ads": [
      "Tweet ad (under 280 chars, punchy, ends with CTA or link placeholder)"
    ],
    "thread": [
      "Tweet 1 — Hook (the big claim or question)",
      "Tweet 2 — The problem",
      "Tweet 3 — The insight",
      "Tweet 4 — The solution",
      "Tweet 5 — CTA"
    ]
  },
  "google": {
    "headlines": [
      "Headline 1 (30 chars max)",
      "Headline 2 (30 chars max)",
      "Headline 3 (30 chars max)",
      "Headline 4 (30 chars max)",
      "Headline 5 (30 chars max)",
      "Headline 6 (30 chars max)",
      "Headline 7 (30 chars max)",
      "Headline 8 (30 chars max)",
      "Headline 9 (30 chars max)",
      "Headline 10 (30 chars max)",
      "Headline 11 (30 chars max)",
      "Headline 12 (30 chars max)",
      "Headline 13 (30 chars max)",
      "Headline 14 (30 chars max)",
      "Headline 15 (30 chars max)"
    ],
    "descriptions": [
      "Description 1 (90 chars max)",
      "Description 2 (90 chars max)",
      "Description 3 (90 chars max)",
      "Description 4 (90 chars max)"
    ],
    "display_paths": ["/path1", "/path2"]
  }
}

Rules:
- Write 3 variations for Facebook/Instagram
- Write 3 variations for TikTok
- Write 5 single tweet ads for Twitter/X
- Write exactly 15 Google headlines and 4 descriptions
- All copy must be benefit-focused and direct-response
- Facebook primary text: lead with the pain point or bold claim
- TikTok hooks must be shocking, curious, or contrarian
- Google headlines: mix of keywords, benefits, and CTAs"""


PREVIEW_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ad Preview — {topic}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#f0f0f0;padding:32px 16px}}
  h1{{font-size:1.5rem;margin-bottom:8px;color:#e6edf3}}
  .subtitle{{color:#8b949e;margin-bottom:40px;font-size:.9rem}}
  .platform{{margin-bottom:48px}}
  .platform-title{{font-size:1.2rem;font-weight:700;margin-bottom:16px;padding:8px 16px;border-radius:8px;display:inline-block}}
  .fb{{background:#1877f215;color:#1877f2;border:1px solid #1877f230}}
  .tiktok{{background:#ff004f15;color:#ff004f;border:1px solid #ff004f30}}
  .twitter{{background:#1da1f215;color:#1da1f2;border:1px solid #1da1f230}}
  .google{{background:#4285f415;color:#4285f4;border:1px solid #4285f430}}
  .card{{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:16px}}
  .label{{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6e7681;margin-bottom:6px}}
  .value{{font-size:.95rem;color:#c9d1d9;line-height:1.5}}
  .variation-num{{font-size:.75rem;color:#58a6ff;font-weight:600;margin-bottom:12px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}}
  .headline-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}}
  .headline-pill{{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:.85rem;color:#c9d1d9}}
  .tag{{display:inline-block;background:#21262d;border-radius:4px;padding:2px 8px;font-size:.8rem;color:#8b949e;margin:2px}}
</style>
</head>
<body>
<h1>Ad Copy — {topic}</h1>
<p class="subtitle">Generated {date} · Facebook/Instagram · TikTok · Twitter/X · Google Ads</p>

<div class="platform">
  <span class="platform-title fb">Facebook / Instagram</span>
  {fb_html}
</div>

<div class="platform">
  <span class="platform-title tiktok">TikTok</span>
  {tiktok_html}
</div>

<div class="platform">
  <span class="platform-title twitter">Twitter / X</span>
  {twitter_html}
</div>

<div class="platform">
  <span class="platform-title google">Google Ads (RSA)</span>
  {google_html}
</div>

</body>
</html>"""


class AdsAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("ads_agent", llm, max_concurrent=2)
        self._output_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "ads"
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def skill_summary(self) -> dict:
        return {
            "name": "AdsAgent",
            "capabilities": ["ads_gen"],
            "description": "Generates ad copy for Facebook/Instagram, TikTok, Twitter/X, and Google Ads",
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "")
        keywords = task.payload.get("keywords", [])
        funnel_headline = task.payload.get("funnel_headline", "")
        landing_url = task.payload.get("cta_url") or task.payload.get("landing_url", "[YOUR_LANDING_PAGE_URL]")
        target_audience = task.payload.get("target_audience", "")
        product_offer = task.payload.get("product_offer", "")
        price_point = task.payload.get("price_point", "")
        tone = task.payload.get("tone", "professional")
        brand_name = task.payload.get("brand_name", "")
        content_goal = task.payload.get("content_goal", "")

        logger.info(f"[AdsAgent] Generating ads for: '{topic}'")

        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:50]
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        project_dir = self._output_dir / f"{timestamp}_{slug}"
        project_dir.mkdir(parents=True, exist_ok=True)

        kw_str = ", ".join(keywords) if keywords else topic
        prompt = (
            f"Topic/Product: {topic}\n"
            f"Keywords: {kw_str}\n"
            + (f"Offer: {product_offer}\n" if product_offer else "")
            + (f"Price point: {price_point}\n" if price_point else "")
            + (f"Target audience: {target_audience}\n" if target_audience else "")
            + (f"Brand/Author: {brand_name}\n" if brand_name else "")
            + (f"Tone: {tone}\n" if tone else "")
            + (f"Goal: {content_goal}\n" if content_goal else "")
            + (f"Landing page headline: {funnel_headline}\n" if funnel_headline else "")
            + f"Landing page URL: {landing_url}\n"
            "Generate the complete ad copy JSON for all platforms."
        )

        logger.info("[AdsAgent] Writing ad copy...")
        raw = await self.llm.complete(prompt, system=ADS_SYSTEM, max_tokens=6000)
        ads = self._parse_json(raw)

        # Save JSON
        ads_path = project_dir / "ads.json"
        ads_path.write_text(json.dumps(ads, indent=2), encoding="utf-8")

        # Save HTML preview
        preview_html = self._render_preview(ads, topic)
        preview_path = project_dir / "ads_preview.html"
        preview_path.write_text(preview_html, encoding="utf-8")

        logger.success(f"[AdsAgent] Ads ready: {project_dir}")
        return {
            "type": "ads",
            "topic": topic,
            "ads_json": str(ads_path),
            "ads_preview": str(preview_path),
            "platforms": ["facebook_instagram", "tiktok", "twitter_x", "google"],
            "fb_variations": len(ads.get("facebook_instagram", {}).get("variations", [])),
            "tiktok_variations": len(ads.get("tiktok", {}).get("variations", [])),
            "google_headlines": len(ads.get("google", {}).get("headlines", [])),
        }

    def _parse_json(self, raw: str) -> dict:
        text = raw.strip()
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            text = text[start:end + 1]
        try:
            return json.loads(text)
        except Exception:
            logger.warning("[AdsAgent] JSON parse failed, returning empty structure")
            return {}

    def _render_preview(self, ads: dict, topic: str) -> str:
        fb_html = self._render_fb(ads.get("facebook_instagram", {}))
        tiktok_html = self._render_tiktok(ads.get("tiktok", {}))
        twitter_html = self._render_twitter(ads.get("twitter_x", {}))
        google_html = self._render_google(ads.get("google", {}))

        return PREVIEW_TEMPLATE.format(
            topic=topic,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            fb_html=fb_html,
            tiktok_html=tiktok_html,
            twitter_html=twitter_html,
            google_html=google_html,
        )

    def _render_fb(self, data: dict) -> str:
        variations = data.get("variations", [])
        if not variations:
            return "<p style='color:#6e7681'>No variations generated.</p>"
        parts = []
        for i, v in enumerate(variations, 1):
            parts.append(f"""
<div class="card">
  <div class="variation-num">Variation {i}</div>
  <div class="label">Primary Text</div><div class="value">{v.get('primary_text','')}</div>
  <br>
  <div class="label">Headline</div><div class="value">{v.get('headline','')}</div>
  <br>
  <div class="label">Description</div><div class="value">{v.get('description','')}</div>
  <br>
  <div class="label">CTA Button</div><div class="value">{v.get('cta','')}</div>
</div>""")
        return "\n".join(parts)

    def _render_tiktok(self, data: dict) -> str:
        variations = data.get("variations", [])
        if not variations:
            return "<p style='color:#6e7681'>No variations generated.</p>"
        parts = []
        for i, v in enumerate(variations, 1):
            tags = "".join(f'<span class="tag">#{h}</span>' for h in v.get("hashtags", []))
            parts.append(f"""
<div class="card">
  <div class="variation-num">Variation {i}</div>
  <div class="label">Hook (first 3 seconds)</div><div class="value">{v.get('hook','')}</div>
  <br>
  <div class="label">15-Second Script</div><div class="value">{v.get('script_15s','')}</div>
  <br>
  <div class="label">30-Second Script</div><div class="value">{v.get('script_30s','')}</div>
  <br>
  <div class="label">Caption</div><div class="value">{v.get('caption','')}</div>
  <br>
  <div class="label">Hashtags</div><div class="value">{tags}</div>
</div>""")
        return "\n".join(parts)

    def _render_twitter(self, data: dict) -> str:
        singles = data.get("single_ads", [])
        thread = data.get("thread", [])
        parts = []
        if singles:
            parts.append('<div class="label" style="margin-bottom:10px">Single Tweet Ads</div>')
            for t in singles:
                parts.append(f'<div class="card"><div class="value">{t}</div></div>')
        if thread:
            parts.append('<div class="label" style="margin:16px 0 10px">Thread</div>')
            for i, t in enumerate(thread, 1):
                parts.append(f'<div class="card"><div class="variation-num">Tweet {i}</div><div class="value">{t}</div></div>')
        return "\n".join(parts) if parts else "<p style='color:#6e7681'>No content generated.</p>"

    def _render_google(self, data: dict) -> str:
        headlines = data.get("headlines", [])
        descriptions = data.get("descriptions", [])
        paths = data.get("display_paths", [])
        parts = []
        if headlines:
            pills = "".join(f'<div class="headline-pill">{h}</div>' for h in headlines)
            parts.append(f'<div class="label" style="margin-bottom:10px">Headlines ({len(headlines)})</div>')
            parts.append(f'<div class="headline-grid">{pills}</div>')
        if descriptions:
            parts.append('<div class="label" style="margin:16px 0 10px">Descriptions</div>')
            for d in descriptions:
                parts.append(f'<div class="card"><div class="value">{d}</div></div>')
        if paths:
            path_str = " / ".join(p.strip("/") for p in paths)
            parts.append(f'<div class="label" style="margin-top:16px">Display URL Path</div>')
            parts.append(f'<div class="card"><div class="value">yourdomain.com{chr(47)}{path_str}</div></div>')
        return "\n".join(parts) if parts else "<p style='color:#6e7681'>No content generated.</p>"
