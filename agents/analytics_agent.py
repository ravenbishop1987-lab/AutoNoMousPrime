"""
Analytics Agent — Generates tracking setup + A/B test plans
1. GA4 event tracking code (ready to paste into site)
2. A/B test variants for headline, CTA, layout
3. KPI dashboard guide (what to measure and why)
Outputs: analytics_setup.html + ab_tests.json + kpi_guide.md
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


AB_TEST_SYSTEM = """You are a CRO (conversion rate optimization) expert and data analyst.
Generate A/B test plans as a JSON array. Output ONLY valid JSON, no markdown, no preamble.

Each test object:
{
  "test_name": "Short descriptive name",
  "element": "What is being tested (headline, CTA button, form position, etc.)",
  "hypothesis": "If we change X then Y will improve because Z",
  "control": "The original version (variant A)",
  "variant": "The challenger version (variant B)",
  "primary_metric": "The one number that decides the winner",
  "secondary_metrics": ["list", "of", "supporting", "metrics"],
  "min_sample_size": 500,
  "test_duration_days": 14,
  "priority": "high/medium/low"
}

Generate 5 A/B tests covering:
1. Landing page headline
2. CTA button text/color
3. Form position (above fold vs below benefits)
4. Email subject line for Email 4 (the pitch email)
5. Ad hook/angle"""


KPI_SYSTEM = """You are a digital marketing analytics expert.
Generate a KPI tracking guide as a JSON object. Output ONLY valid JSON.

{
  "funnel_kpis": [
    {
      "metric": "Metric name",
      "target": "Benchmark target (e.g. > 35%)",
      "formula": "How to calculate it",
      "where_to_find": "Where in GA4 / ad platform",
      "action_if_low": "What to do if below target"
    }
  ],
  "ad_kpis": [...same structure for paid ads...],
  "email_kpis": [...same structure for email...],
  "weekly_review_checklist": [
    "Check 1",
    "Check 2",
    "Check 3",
    "Check 4",
    "Check 5"
  ]
}

Include 4 funnel KPIs, 4 ad KPIs, and 4 email KPIs."""


GA4_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Analytics Setup — {topic}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#f0f0f0;padding:32px 16px}}
  h1{{font-size:1.5rem;margin-bottom:8px;color:#e6edf3}}
  .subtitle{{color:#8b949e;margin-bottom:40px;font-size:.9rem}}
  .section{{margin-bottom:48px}}
  .section-title{{font-size:1.1rem;font-weight:700;color:#58a6ff;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #21262d}}
  .card{{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:16px}}
  .card h3{{font-size:.95rem;color:#e6edf3;margin-bottom:8px}}
  .label{{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6e7681;margin-bottom:4px;margin-top:12px}}
  pre{{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:16px;overflow-x:auto;font-size:.85rem;color:#79c0ff;line-height:1.6;white-space:pre-wrap;word-break:break-word}}
  .copy-note{{font-size:.8rem;color:#6e7681;margin-top:8px}}
  .kpi-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}}
  .kpi-card{{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px}}
  .kpi-metric{{font-size:1rem;font-weight:700;color:#3fb950;margin-bottom:4px}}
  .kpi-target{{font-size:.85rem;color:#58a6ff;margin-bottom:8px}}
  .kpi-detail{{font-size:.82rem;color:#8b949e;line-height:1.5}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600;margin-bottom:8px}}
  .high{{background:#f7811620;color:#f78166;border:1px solid #f7816630}}
  .medium{{background:#e3b34120;color:#e3b341;border:1px solid #e3b34130}}
  .low{{background:#3fb95020;color:#3fb950;border:1px solid #3fb95030}}
  .checklist li{{color:#c9d1d9;font-size:.9rem;margin-bottom:8px;list-style:none;padding-left:4px}}
  .checklist li::before{{content:'☐ ';color:#58a6ff}}
</style>
</head>
<body>
<h1>Analytics Setup — {topic}</h1>
<p class="subtitle">Generated {date} · GA4 Tracking · A/B Tests · KPI Guide</p>

<div class="section">
  <div class="section-title">GA4 Tracking Code</div>
  <div class="card">
    <h3>Step 1 — Paste this in the &lt;head&gt; of every page</h3>
    <pre>{ga4_head_code}</pre>
    <p class="copy-note">Replace G-XXXXXXXXXX with your GA4 Measurement ID (found in GA4 → Admin → Data Streams)</p>
  </div>
  <div class="card">
    <h3>Step 2 — Landing page conversion event (paste before &lt;/body&gt; on landing page)</h3>
    <pre>{ga4_conversion_code}</pre>
  </div>
  <div class="card">
    <h3>Step 3 — Thank-you page confirmation event (paste before &lt;/body&gt; on thank-you page)</h3>
    <pre>{ga4_thankyou_code}</pre>
  </div>
</div>

<div class="section">
  <div class="section-title">A/B Tests</div>
  {ab_tests_html}
</div>

<div class="section">
  <div class="section-title">KPIs to Track</div>
  <div class="label" style="margin-bottom:12px">Funnel KPIs</div>
  <div class="kpi-grid">{funnel_kpis_html}</div>
  <div class="label" style="margin:20px 0 12px">Ad KPIs</div>
  <div class="kpi-grid">{ad_kpis_html}</div>
  <div class="label" style="margin:20px 0 12px">Email KPIs</div>
  <div class="kpi-grid">{email_kpis_html}</div>
</div>

<div class="section">
  <div class="section-title">Weekly Review Checklist</div>
  <div class="card">
    <ul class="checklist">
      {checklist_html}
    </ul>
  </div>
</div>

</body>
</html>"""


class AnalyticsAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("analytics_agent", llm, max_concurrent=2)
        self._output_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "analytics"
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def skill_summary(self) -> dict:
        return {
            "name": "AnalyticsAgent",
            "capabilities": ["analytics_gen"],
            "description": "Generates GA4 tracking setup, A/B test plans, and KPI dashboards",
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "")
        keywords = task.payload.get("keywords", [])
        funnel_headline = task.payload.get("funnel_headline", "")
        landing_url = task.payload.get("cta_url") or task.payload.get("landing_url", "yoursite.com/landing")
        target_audience = task.payload.get("target_audience", "")
        product_offer = task.payload.get("product_offer", "")
        price_point = task.payload.get("price_point", "")
        brand_name = task.payload.get("brand_name", "")

        logger.info(f"[AnalyticsAgent] Generating analytics setup for: '{topic}'")

        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:50]
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        project_dir = self._output_dir / f"{timestamp}_{slug}"
        project_dir.mkdir(parents=True, exist_ok=True)

        kw_str = ", ".join(keywords) if keywords else topic
        context = (
            f"Topic/Product: {topic}\n"
            f"Keywords: {kw_str}\n"
            + (f"Offer: {product_offer}\n" if product_offer else "")
            + (f"Price point: {price_point}\n" if price_point else "")
            + (f"Target audience: {target_audience}\n" if target_audience else "")
            + (f"Brand/Author: {brand_name}\n" if brand_name else "")
            + (f"Landing page headline: {funnel_headline}\n" if funnel_headline else "")
            + f"Landing page URL: {landing_url}\n"
        )

        # --- A/B tests ---
        logger.info("[AnalyticsAgent] Generating A/B test plans...")
        raw_ab = await self.llm.complete(
            context + "Generate 5 A/B tests for this funnel.",
            system=AB_TEST_SYSTEM,
            max_tokens=3000,
        )
        ab_tests = self._parse_json_list(raw_ab)
        ab_path = project_dir / "ab_tests.json"
        ab_path.write_text(json.dumps(ab_tests, indent=2), encoding="utf-8")

        # --- KPIs ---
        logger.info("[AnalyticsAgent] Generating KPI guide...")
        raw_kpi = await self.llm.complete(
            context + "Generate KPI tracking guide for this funnel and ad campaign.",
            system=KPI_SYSTEM,
            max_tokens=3000,
        )
        kpis = self._parse_json_dict(raw_kpi)
        kpi_path = project_dir / "kpis.json"
        kpi_path.write_text(json.dumps(kpis, indent=2), encoding="utf-8")

        # --- Build HTML ---
        html = self._render_html(topic, ab_tests, kpis, landing_url)
        html_path = project_dir / "analytics_setup.html"
        html_path.write_text(html, encoding="utf-8")

        logger.success(f"[AnalyticsAgent] Analytics ready: {project_dir}")
        return {
            "type": "analytics",
            "topic": topic,
            "analytics_html": str(html_path),
            "ab_tests_json": str(ab_path),
            "kpis_json": str(kpi_path),
            "ab_test_count": len(ab_tests),
        }

    def _parse_json_list(self, raw: str) -> list:
        text = raw.strip()
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            text = text[start:end + 1]
        try:
            return json.loads(text)
        except Exception:
            return []

    def _parse_json_dict(self, raw: str) -> dict:
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
            return {}

    def _render_html(self, topic: str, ab_tests: list, kpis: dict, landing_url: str) -> str:
        ga4_head = (
            '<!-- Google tag (gtag.js) -->\n'
            '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>\n'
            '<script>\n'
            '  window.dataLayer = window.dataLayer || [];\n'
            '  function gtag(){dataLayer.push(arguments);}\n'
            '  gtag("js", new Date());\n'
            '  gtag("config", "G-XXXXXXXXXX");\n'
            '</script>'
        )
        ga4_conversion = (
            '<script>\n'
            '  // Fire when user submits the opt-in form\n'
            '  document.querySelector("form").addEventListener("submit", function() {\n'
            '    gtag("event", "generate_lead", {\n'
            '      event_category: "funnel",\n'
            '      event_label: "landing_page_optin"\n'
            '    });\n'
            '  });\n'
            '</script>'
        )
        ga4_thankyou = (
            '<script>\n'
            '  // Fires automatically when thank-you page loads\n'
            '  gtag("event", "sign_up", {\n'
            '    event_category: "funnel",\n'
            '    event_label: "confirmed_optin",\n'
            '    value: 1\n'
            '  });\n'
            '</script>'
        )

        ab_parts = []
        for t in ab_tests:
            priority = t.get("priority", "medium").lower()
            badge_class = "high" if priority == "high" else ("low" if priority == "low" else "medium")
            secondaries = ", ".join(t.get("secondary_metrics", []))
            ab_parts.append(f"""
<div class="card">
  <span class="badge {badge_class}">{priority.upper()} PRIORITY</span>
  <h3>{t.get('test_name', 'Test')}</h3>
  <div class="label">Element</div><div class="kpi-detail">{t.get('element','')}</div>
  <div class="label">Hypothesis</div><div class="kpi-detail">{t.get('hypothesis','')}</div>
  <div class="label">Control (A)</div><div class="kpi-detail">{t.get('control','')}</div>
  <div class="label">Variant (B)</div><div class="kpi-detail">{t.get('variant','')}</div>
  <div class="label">Primary Metric</div><div class="kpi-detail">{t.get('primary_metric','')}</div>
  <div class="label">Secondary Metrics</div><div class="kpi-detail">{secondaries}</div>
  <div class="label">Min Sample / Duration</div><div class="kpi-detail">{t.get('min_sample_size',500):,} visitors · {t.get('test_duration_days',14)} days</div>
</div>""")

        def render_kpis(items: list) -> str:
            parts = []
            for k in items:
                parts.append(f"""
<div class="kpi-card">
  <div class="kpi-metric">{k.get('metric','')}</div>
  <div class="kpi-target">Target: {k.get('target','')}</div>
  <div class="kpi-detail"><b>Formula:</b> {k.get('formula','')}</div>
  <div class="kpi-detail"><b>Find it:</b> {k.get('where_to_find','')}</div>
  <div class="kpi-detail"><b>If low:</b> {k.get('action_if_low','')}</div>
</div>""")
            return "\n".join(parts)

        checklist_items = kpis.get("weekly_review_checklist", [
            "Review landing page conversion rate",
            "Check email open rates and click rates",
            "Review ad CTR and CPC by platform",
            "Check A/B test results — pause losers",
            "Review revenue and lead volume vs last week",
        ])
        checklist_html = "\n".join(f"<li>{item}</li>" for item in checklist_items)

        return GA4_TEMPLATE.format(
            topic=topic,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            ga4_head_code=ga4_head,
            ga4_conversion_code=ga4_conversion,
            ga4_thankyou_code=ga4_thankyou,
            ab_tests_html="\n".join(ab_parts) if ab_parts else "<p style='color:#6e7681'>No tests generated.</p>",
            funnel_kpis_html=render_kpis(kpis.get("funnel_kpis", [])),
            ad_kpis_html=render_kpis(kpis.get("ad_kpis", [])),
            email_kpis_html=render_kpis(kpis.get("email_kpis", [])),
            checklist_html=checklist_html,
        )
