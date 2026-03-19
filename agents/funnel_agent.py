"""
Funnel Agent — Generates complete lead-generation funnels
1. Landing page (opt-in HTML, self-contained, ready to deploy)
2. Email sequence (welcome → nurture → offer → close)
3. Thank-you page HTML
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

import httpx
from loguru import logger

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent
from core.storage import upload_file as _storage_upload


LANDING_PAGE_SYSTEM = """You are a world-class conversion copywriter and funnel designer specializing in high-converting opt-in pages.

CRITICAL RULES:
- Output ONLY a single valid JSON object. No markdown, no code fences, no preamble, no explanation.
- Every field MUST reference the specific topic, audience, brand, and keywords provided. NEVER use generic placeholder text.
- Headlines must be specific to the topic — never generic phrases like "Unlock the Secrets to Success".
- Benefit titles and descriptions must be concrete and topic-specific — never "Benefit One" or "Short title".
- The offer is always a FREE downloadable report/guide.

Output this exact JSON structure (all fields required):
{
  "headline": "Specific, punchy headline (8-14 words) that names the topic and outcome — e.g. 'The 5-Step Focus System That Doubles Your Output Without Working More Hours'",
  "subheadline": "One clear sentence (15-25 words) expanding the promise with a specific result tied to the topic and audience",
  "hero_body": "2-3 compelling sentences that name the specific pain the audience feels, then promise relief via the free report. Be vivid and specific.",
  "what_youll_get": [
    "Specific thing they will learn or get from the report (start with a verb)",
    "Another specific actionable takeaway",
    "Another specific result or insight",
    "Another quick win or strategy",
    "A surprising insight or framework they haven't heard before"
  ],
  "benefit_1": {
    "title": "Specific benefit title (3-5 words, topic-specific, compelling)",
    "desc": "2 full sentences explaining what this benefit is and why it matters to this specific audience. Be concrete."
  },
  "benefit_2": {
    "title": "Specific benefit title (3-5 words, topic-specific, compelling)",
    "desc": "2 full sentences explaining what this benefit is and why it matters to this specific audience. Be concrete."
  },
  "benefit_3": {
    "title": "Specific benefit title (3-5 words, topic-specific, compelling)",
    "desc": "2 full sentences explaining what this benefit is and why it matters to this specific audience. Be concrete."
  },
  "social_proof": "A realistic, specific testimonial (2-3 sentences) from a real-sounding person that names a specific result related to the topic. Include a first name and role.",
  "social_proof_name": "First name and short role/title of the testimonial person",
  "author_name": "The brand/author name provided, or a realistic expert name if none given",
  "author_bio": "2 sentences establishing the author as a credible expert on this specific topic",
  "cta_primary": "Action-oriented button text (4-6 words) specific to the offer — not just 'Get Instant Access'",
  "cta_secondary": "Trust-building line below the button (e.g. 'Join 3,400+ readers. No credit card. Unsubscribe anytime.')",
  "opt_in_label": "Email field placeholder that feels personal and safe",
  "urgency_line": "Short, specific scarcity or urgency line (not generic — tie it to the topic or a real constraint)",
  "footer_tagline": "Short brand tagline specific to the topic/niche"
}"""


EMAIL_SEQUENCE_SYSTEM = """You are an email marketing expert who writes high-converting, deeply personal email sequences.

CRITICAL RULES:
- Output ONLY a valid JSON array. No markdown, no code fences, no preamble.
- Every email MUST be specific to the topic, audience, and product provided — no generic copy.
- Bodies must be full-length (150-300 words). Write like a real person, not a robot.
- Use the subscriber's name placeholder [First Name] naturally in each email.
- Each [CTA_BUTTON] placeholder will be replaced with a real HTML button — write the surrounding text to set it up naturally.

Write exactly 6 emails as a JSON array:

[
  {
    "subject": "Specific subject line (not generic) that teases value or creates curiosity",
    "preview_text": "Preview text 40-60 chars — complements the subject",
    "body": "Full email body. Start with 'Hi [First Name],' — then 150-250 words of specific, warm, personal copy. End with a natural lead-in sentence before the CTA. Sign off with the author name and brand.",
    "cta_text": "Specific CTA button text (4-7 words)",
    "send_day": 0
  }
]

Email sequence brief:
- Email 1 (day 0): Welcome + deliver the free report. Warm tone, set expectations for the series, one quick win from the report.
- Email 2 (day 2): Teach one specific tip/strategy from the topic. Pure value, no selling. Make them feel smart.
- Email 3 (day 4): Another specific tip + soft bridge to paid offer. Plant the seed.
- Email 4 (day 6): Main pitch. Name the paid product, price, what they get, key benefit, risk reversal.
- Email 5 (day 8): Handle the #1 real objection for this audience. Empathize then overcome.
- Email 6 (day 11): Final close. Urgency/scarcity. Short and punchy. Last chance frame."""


SALES_PAGE_SYSTEM = """You are a world-class direct-response copywriter specializing in high-converting sales pages.
Output ONLY a single valid JSON object. No markdown, no code fences, no preamble.

{
  "headline": "Power headline (10-16 words) naming the product and the #1 transformation it delivers",
  "subheadline": "Expanding sentence (15-25 words) adding urgency or specificity to the headline promise",
  "hero_body": "3-4 sentences: describe the pain the buyer has right now, then pivot to the solution this product delivers. Be vivid and specific.",
  "features": [
    "Feature/benefit item (start with a verb, be specific about what they get)",
    "Another specific feature or outcome",
    "Another specific feature or outcome",
    "Another specific feature or outcome",
    "Another specific feature or outcome",
    "Another specific feature or outcome"
  ],
  "bonuses": [
    {"title": "Bonus name (short, compelling)", "desc": "1 sentence describing the bonus value"},
    {"title": "Bonus name", "desc": "1 sentence"}
  ],
  "testimonials": [
    {"body": "2-3 sentence specific result testimonial from a real-sounding person", "name": "First Last, short role"},
    {"body": "2-3 sentence specific result testimonial", "name": "First Last, short role"},
    {"body": "2-3 sentence specific result testimonial", "name": "First Last, short role"}
  ],
  "price_display": "The price as it should appear on the page, e.g. '$197' or '$47/mo'",
  "cta_text": "Buy button text (5-8 words, action-oriented, include price if it fits)",
  "cta_secondary": "Trust line below the button (guarantee, security, format)",
  "guarantee": "Guarantee headline (e.g. '30-Day Money-Back Guarantee')",
  "guarantee_body": "2 sentences explaining the guarantee clearly and warmly",
  "faq": [
    {"q": "Specific question this audience really asks", "a": "Clear, reassuring 2-3 sentence answer"},
    {"q": "Objection framed as a question", "a": "Empathetic, specific answer"},
    {"q": "Another common question", "a": "Answer"}
  ]
}"""


SALES_THANKYOU_SYSTEM = """You are a conversion copywriter. Generate a post-purchase thank-you page as JSON.
Output ONLY valid JSON — no markdown, no code fences, no preamble.

{
  "headline": "Warm, celebratory confirmation headline (e.g. 'Welcome! You Made a Great Decision.')",
  "subheadline": "15-20 words: confirm the purchase went through and tell them exactly what happens next",
  "next_steps": [
    "Step 1 — what to do RIGHT NOW (check email, click link, etc.)",
    "Step 2 — first action inside the product to get a quick win",
    "Step 3 — how to get the most out of the product long-term"
  ],
  "support_line": "1 sentence: how to contact support if they have questions"
}"""


SALES_PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{headline}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:{bg_color};color:#e6edf3;line-height:1.65}}
  a{{color:{accent_color};text-decoration:none}}

  /* Hero */
  .hero{{padding:72px 24px 64px;text-align:center;background:{bg_color};border-bottom:1px solid #21262d}}
  .hero h1{{font-size:clamp(1.9rem,4vw,3rem);font-weight:800;line-height:1.18;max-width:860px;margin:0 auto 18px;color:#fff}}
  .hero h1 em{{font-style:normal;color:{accent_color}}}
  .hero-sub{{font-size:clamp(1rem,2vw,1.18rem);color:#8b949e;max-width:680px;margin:0 auto 28px}}
  .hero-body{{font-size:1rem;color:#c9d1d9;max-width:680px;margin:0 auto 40px;line-height:1.8}}

  /* CTA button */
  .cta-btn{{display:inline-block;padding:18px 44px;background:{button_color};color:#fff;border-radius:10px;font-size:1.08rem;font-weight:800;letter-spacing:.02em;cursor:pointer;border:none;text-decoration:none;transition:background .18s,transform .1s}}
  .cta-btn:hover{{background:{btn_hover};transform:translateY(-2px)}}
  .cta-secondary{{display:block;margin-top:12px;font-size:.85rem;color:#8b949e}}

  /* Sections */
  .section{{padding:64px 24px;max-width:960px;margin:0 auto}}
  .section-title{{font-size:1.5rem;font-weight:800;color:#fff;margin-bottom:32px;text-align:center}}

  /* Features */
  .features-list{{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}}
  .features-list li{{background:{card_bg};border:1px solid #21262d;border-radius:10px;padding:16px 18px;display:flex;gap:12px;align-items:flex-start;font-size:.97rem;color:#c9d1d9}}
  .feat-icon{{color:{accent_color};font-size:1.1rem;flex-shrink:0;margin-top:2px}}

  /* Testimonials */
  .testimonials{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}}
  .testimonial{{background:{card_bg};border:1px solid #21262d;border-radius:10px;padding:22px}}
  .testi-body{{font-size:.97rem;color:#c9d1d9;line-height:1.7;margin-bottom:12px;font-style:italic}}
  .testi-name{{font-size:.88rem;color:{accent_color};font-weight:700}}

  /* Bonuses */
  .bonus-card{{background:{card_bg};border:1px solid {accent_color}44;border-radius:10px;padding:20px 22px;margin-bottom:14px}}
  .bonus-label{{display:inline-block;background:{accent_color};color:#0d1117;font-size:.72rem;font-weight:800;padding:2px 8px;border-radius:4px;letter-spacing:.06em;margin-bottom:8px}}
  .bonus-card strong{{display:block;font-size:1.05rem;color:#fff;margin-bottom:6px}}
  .bonus-card p{{font-size:.93rem;color:#8b949e}}

  /* Guarantee */
  .guarantee-box{{background:{card_bg};border:2px solid {button_color}66;border-radius:12px;padding:36px;text-align:center;max-width:680px;margin:0 auto}}
  .guarantee-box h3{{font-size:1.25rem;font-weight:800;color:#fff;margin-bottom:12px}}
  .guarantee-box p{{font-size:.97rem;color:#c9d1d9}}

  /* FAQ */
  .faq-item{{background:{card_bg};border:1px solid #21262d;border-radius:10px;margin-bottom:10px;overflow:hidden}}
  .faq-item summary{{padding:18px 20px;cursor:pointer;font-size:1rem;font-weight:600;color:#e6edf3;list-style:none;display:flex;justify-content:space-between;align-items:center}}
  .faq-item summary::-webkit-details-marker{{display:none}}
  .faq-item summary::after{{content:"+";font-size:1.4rem;color:{accent_color};font-weight:400}}
  .faq-item[open] summary::after{{content:"−"}}
  .faq-item p{{padding:0 20px 18px;font-size:.95rem;color:#8b949e;line-height:1.7}}

  /* Price box */
  .price-box{{background:{card_bg};border:2px solid {accent_color}55;border-radius:14px;padding:40px;text-align:center;max-width:540px;margin:0 auto}}
  .price-display{{font-size:3rem;font-weight:900;color:{accent_color};margin-bottom:8px}}

  /* Sticky CTA bar */
  .sticky-bar{{position:fixed;bottom:0;left:0;right:0;background:{bg_color}f0;backdrop-filter:blur(8px);border-top:1px solid #21262d;padding:14px 24px;display:flex;justify-content:center;gap:20px;align-items:center;z-index:999}}
  .sticky-bar .cta-btn{{padding:12px 32px;font-size:.97rem}}

  @media(max-width:640px){{
    .hero h1{{font-size:1.7rem}}
    .sticky-bar{{flex-direction:column;gap:10px}}
  }}
</style>
</head>
<body>

<!-- Hero -->
<section class="hero">
  <h1>{headline}</h1>
  <p class="hero-sub">{subheadline}</p>
  <p class="hero-body">{hero_body}</p>
  <a href="{stripe_url}" class="cta-btn">{cta_text}</a>
  <span class="cta-secondary">{cta_secondary}</span>
</section>

<!-- Features -->
<div class="section">
  <h2 class="section-title">Everything You Get</h2>
  <ul class="features-list">{features_html}</ul>
</div>

<!-- Testimonials -->
<div class="section" style="background:{card_bg};max-width:100%;padding:64px 24px">
  <div style="max-width:960px;margin:0 auto">
    <h2 class="section-title">What People Are Saying</h2>
    <div class="testimonials">{testimonials_html}</div>
  </div>
</div>

<!-- Bonuses -->
{bonus_section}

<!-- Price + CTA -->
<div class="section">
  <h2 class="section-title">Get Instant Access Today</h2>
  <div class="price-box">
    <div class="price-display">{price_display}</div>
    <a href="{stripe_url}" class="cta-btn" style="margin-bottom:12px">{cta_text}</a>
    <span class="cta-secondary">{cta_secondary}</span>
  </div>
</div>

<!-- Guarantee -->
<div class="section">
  <div class="guarantee-box">
    <h3>🛡 {guarantee}</h3>
    <p>{guarantee_body}</p>
  </div>
</div>

<!-- FAQ -->
<div class="section">
  <h2 class="section-title">Frequently Asked Questions</h2>
  {faq_html}
</div>

<!-- Sticky bar -->
<div class="sticky-bar">
  <span style="font-size:.97rem;color:#8b949e">{price_display}</span>
  <a href="{stripe_url}" class="cta-btn">{cta_text}</a>
</div>

</body>
</html>"""


SALES_THANKYOU_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Thank You — Purchase Confirmed</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 24px}}
  .card{{background:#161b22;border:1px solid #21262d;border-radius:16px;padding:48px 40px;max-width:640px;width:100%;text-align:center}}
  .check{{font-size:3.5rem;margin-bottom:20px}}
  h1{{font-size:clamp(1.5rem,3vw,2.2rem);font-weight:800;color:#fff;margin-bottom:12px;line-height:1.25}}
  .sub{{font-size:1rem;color:#8b949e;margin-bottom:28px;line-height:1.7}}
  .download-box{{background:linear-gradient(135deg,rgba(35,134,54,.18),rgba(35,134,54,.06));border:1px solid rgba(63,185,80,.35);border-radius:12px;padding:24px 28px;margin-bottom:32px}}
  .download-label{{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#3fb950;margin-bottom:10px;display:block}}
  .download-title{{font-size:1rem;font-weight:700;color:#e6edf3;margin-bottom:16px}}
  .download-btn{{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:#238636;color:#fff;border-radius:9px;font-size:1rem;font-weight:800;text-decoration:none;transition:background .18s,transform .1s;cursor:pointer;border:none}}
  .download-btn:hover{{background:#2ea043;transform:translateY(-2px)}}
  .download-btn svg{{flex-shrink:0}}
  .steps{{text-align:left;list-style:none;border-top:1px solid #21262d;padding-top:28px;margin-bottom:28px}}
  .steps li{{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid #21262d;font-size:.97rem;color:#c9d1d9}}
  .steps li:last-child{{border-bottom:none}}
  .step-num{{width:28px;height:28px;border-radius:50%;background:#238636;color:#fff;font-weight:800;font-size:.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}}
  .support{{font-size:.88rem;color:#8b949e;margin-top:16px}}
</style>
</head>
<body>
<div class="card">
  <div class="check">🎉</div>
  <h1>{headline}</h1>
  <p class="sub">{subheadline}</p>

  {download_block}

  <ul class="steps">
    <li><span class="step-num">1</span>{step_1}</li>
    <li><span class="step-num">2</span>{step_2}</li>
    <li><span class="step-num">3</span>{step_3}</li>
  </ul>
  <p class="support">{support_line}</p>
</div>
</body>
</html>"""


THANKYOU_SYSTEM = """You are a conversion copywriter specializing in post-optin thank-you pages.
Generate a thank-you page as a JSON object. Output ONLY valid JSON — no markdown, no code fences, no preamble.

CRITICAL: All copy must be specific to the topic, brand, and audience. No generic placeholder text.

{
  "headline": "Celebratory, specific confirmation headline — e.g. 'You're In! Your [Topic] Report Is On Its Way'",
  "subheadline": "15-20 words: tell them exactly what happens next and tease one quick win from the report",
  "next_steps": [
    "Specific step 1 — what to do right now with the report",
    "Specific step 2 — one quick win to try today from the content",
    "Specific step 3 — how to get even faster results (bridge to paid offer)"
  ],
  "upsell_headline": "Compelling paid offer headline that references the free report and promises a bigger/faster result",
  "upsell_body": "2-3 punchy sentences: what the paid product is, the #1 transformation it delivers, and why now is the right time. Be specific.",
  "upsell_cta": "Action-oriented button text for the upsell (5-7 words)"
}"""


def _lighten(hex_color: str, amount: int = 22) -> str:
    """Return a slightly lighter shade of a hex color for card backgrounds."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return "#161b22"
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"#{min(255,r+amount):02x}{min(255,g+amount):02x}{min(255,b+amount):02x}"


def _darken(hex_color: str, amount: int = 10) -> str:
    """Return a slightly darker shade for hover states."""
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return "#2ea043"
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"#{max(0,r-amount):02x}{max(0,g-amount):02x}{max(0,b-amount):02x}"


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{headline}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:{bg_color};color:#e6edf3;line-height:1.6}}

  /* ── Hero ── */
  .hero{{background:{bg_color};padding:60px 24px 56px;border-bottom:1px solid #21262d}}
  .hero-top{{max-width:860px;margin:0 auto 44px;text-align:center}}
  .hero h1{{font-size:clamp(2rem,4.2vw,3rem);font-weight:800;line-height:1.18;margin-bottom:16px;color:#fff}}
  .hero h1 span{{background:linear-gradient(135deg,{accent_color},{accent_color}cc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
  .hero-sub{{font-size:clamp(.95rem,1.8vw,1.1rem);color:#8b949e;line-height:1.65;font-weight:400}}
  .hero-cols{{max-width:1060px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}}
  .hero-left p{{font-size:1rem;color:#c9d1d9;line-height:1.8;margin-bottom:28px}}
  .checklist{{list-style:none}}
  .checklist li{{display:flex;align-items:flex-start;gap:10px;padding:8px 0;font-size:.97rem;color:#c9d1d9;border-bottom:1px solid #21262d}}
  .checklist li:last-child{{border-bottom:none}}
  .checklist li::before{{content:"✓";color:{button_color};font-weight:700;font-size:1rem;flex-shrink:0;margin-top:1px}}
  .form-box{{background:{bg_card};border:1px solid #30363d;border-radius:14px;padding:32px}}
  .urgency{{color:#f0883e;font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:18px;line-height:1.4}}
  .form-box input{{display:block;width:100%;padding:13px 16px;border-radius:8px;border:1px solid #30363d;background:{bg_color};color:#e6edf3;font-size:.97rem;margin-bottom:12px;outline:none}}
  .form-box input::placeholder{{color:#484f58}}
  .form-box input:focus{{border-color:{accent_color}}}
  .cta-btn{{display:block;width:100%;padding:16px;border-radius:8px;border:none;background:{button_color};color:#fff;font-size:1.05rem;font-weight:700;cursor:pointer;letter-spacing:.3px;margin-top:4px}}
  .cta-btn:hover{{background:{button_hover};opacity:.92}}
  .cta-note{{color:#6e7681;font-size:.8rem;margin-top:10px;display:block;text-align:center;line-height:1.5}}
  @media(max-width:740px){{
    .hero-cols{{grid-template-columns:1fr;gap:32px}}
    .hero h1{{font-size:1.9rem}}
  }}

  /* ── Benefits ── */
  .benefits-wrap{{background:{bg_card};border-top:1px solid #21262d;border-bottom:1px solid #21262d;padding:72px 24px}}
  .benefits-inner{{max-width:980px;margin:0 auto}}
  .section-title{{text-align:center;font-size:1.75rem;font-weight:800;color:#e6edf3;margin-bottom:8px}}
  .section-sub{{text-align:center;color:#8b949e;font-size:.97rem;margin-bottom:44px}}
  .benefits-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px}}
  .benefit-card{{background:{bg_color};border:1px solid #21262d;border-radius:12px;padding:28px}}
  .benefit-card h4{{font-size:1rem;color:{accent_color};font-weight:700;margin-bottom:10px;line-height:1.4}}
  .benefit-card p{{color:#8b949e;font-size:.92rem;line-height:1.7}}

  /* ── Testimonial ── */
  .testimonial-wrap{{background:{bg_color};padding:72px 24px;text-align:center;border-bottom:1px solid #21262d}}
  .testimonial{{font-size:1.15rem;color:#c9d1d9;font-style:italic;max-width:660px;margin:0 auto 16px;line-height:1.8}}
  .testimonial-attr{{color:#6e7681;font-size:.88rem;font-weight:600}}

  /* ── Author ── */
  .author-wrap{{background:{bg_card};padding:56px 24px;text-align:center;border-bottom:1px solid #21262d}}
  .author-name{{font-size:1.05rem;font-weight:700;color:#e6edf3;margin-bottom:10px}}
  .author-bio{{font-size:.93rem;color:#8b949e;max-width:540px;margin:0 auto;line-height:1.75}}

  /* ── Footer ── */
  footer{{background:{bg_color};text-align:center;padding:28px 20px;color:#484f58;font-size:.8rem}}
  footer p+p{{margin-top:6px}}
</style>
</head>
<body>

<section class="hero">
  <div class="hero-top">
    <h1>{headline}</h1>
    <p class="hero-sub">{subheadline}</p>
  </div>
  <div class="hero-cols">
    <div class="hero-left">
      <p>{hero_body}</p>
      <ul class="checklist">
{checklist_items}      </ul>
    </div>
    <div class="hero-right">
      <div class="form-box">
        <p class="urgency">{urgency_line}</p>
        <form id="opt-in-form">
          <input id="f-name" type="text" placeholder="Your First Name" required>
          <input id="f-email" type="email" placeholder="{opt_in_label}" required>
          <button class="cta-btn" type="submit" id="f-btn">{cta_primary}</button>
          <span class="cta-note">{cta_secondary}</span>
        </form>
      </div>
    </div>
  </div>
</section>
<script>
document.getElementById('opt-in-form').addEventListener('submit', function(e) {{
  e.preventDefault();
  var btn = document.getElementById('f-btn');
  btn.textContent = 'Sending\u2026';
  btn.disabled = true;
  var name = document.getElementById('f-name').value.trim();
  var email = document.getElementById('f-email').value.trim();
  // keepalive ensures the request completes even as the page navigates away
  try {{
    fetch('{subscribe_url}', {{
      method: 'POST',
      headers: {{'Content-Type': 'application/json'}},
      body: JSON.stringify({{name: name, email: email}}),
      keepalive: true
    }});
  }} catch(err) {{}}
  // Short delay so the browser dispatches the request before navigating
  setTimeout(function() {{
    window.location.href = '{thankyou_url}';
  }}, 150);
}});
</script>

<div class="benefits-wrap">
  <div class="benefits-inner">
    <h2 class="section-title">What You'll Discover Inside</h2>
    <p class="section-sub">Everything inside is immediately actionable — no fluff, no filler</p>
    <div class="benefits-grid">
      <div class="benefit-card"><h4>{benefit_1_title}</h4><p>{benefit_1_desc}</p></div>
      <div class="benefit-card"><h4>{benefit_2_title}</h4><p>{benefit_2_desc}</p></div>
      <div class="benefit-card"><h4>{benefit_3_title}</h4><p>{benefit_3_desc}</p></div>
    </div>
  </div>
</div>

<div class="testimonial-wrap">
  <p class="testimonial">"{social_proof}"</p>
  <p class="testimonial-attr">— {social_proof_name}</p>
</div>

<div class="author-wrap">
  <p class="author-name">{author_name}</p>
  <p class="author-bio">{author_bio}</p>
</div>

<footer>
  <p>{footer_tagline}</p>
  <p>© {year} · All Rights Reserved</p>
</footer>

</body>
</html>"""


THANKYOU_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're In! Download Your Free Report</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}}
  .card{{background:#161b22;border:1px solid #21262d;border-radius:16px;padding:48px;max-width:580px;width:100%;text-align:center}}
  .check{{font-size:3rem;margin-bottom:16px}}
  h1{{font-size:2rem;font-weight:800;margin-bottom:8px;color:#3fb950}}
  h2{{font-size:1.05rem;color:#8b949e;font-weight:400;margin-bottom:32px}}
  .download-box{{background:linear-gradient(135deg,#0d1117,#161b22);border:2px solid #238636;border-radius:14px;padding:28px;margin-bottom:28px}}
  .download-box h3{{font-size:1.1rem;color:#e6edf3;margin-bottom:6px}}
  .download-box p{{color:#8b949e;font-size:.9rem;margin-bottom:18px}}
  .download-btn{{display:inline-flex;align-items:center;gap:10px;padding:16px 32px;border-radius:10px;border:none;background:linear-gradient(135deg,#238636,#2ea043);color:#fff;font-size:1.1rem;font-weight:800;cursor:pointer;text-decoration:none;letter-spacing:.03em}}
  .download-btn:hover{{background:linear-gradient(135deg,#2ea043,#3fb950)}}
  .steps{{text-align:left;margin:0 auto 28px;max-width:400px}}
  .step{{display:flex;gap:12px;margin-bottom:12px;align-items:flex-start}}
  .step-num{{background:#1f6feb;color:#fff;border-radius:50%;width:24px;height:24px;min-width:24px;font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center}}
  .step p{{color:#c9d1d9;font-size:.9rem;padding-top:3px}}
  .upsell{{background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:24px;margin-top:8px}}
  .upsell h3{{font-size:1.1rem;margin-bottom:8px;color:#58a6ff}}
  .upsell p{{color:#8b949e;font-size:.88rem;margin-bottom:16px;line-height:1.65}}
  .upsell-btn{{padding:14px 28px;border-radius:8px;border:none;background:linear-gradient(135deg,#1f6feb,#388bfd);color:#fff;font-size:.95rem;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block}}
  .note{{font-size:.78rem;color:#6e7681;margin-top:14px}}
</style>
</head>
<body>
<div class="card">
  <div class="check">🎉</div>
  <h1>{headline}</h1>
  <h2>{subheadline}</h2>

  <div class="download-box">
    <h3>📄 Your Free Report Is Ready</h3>
    <p>{ebook_title}</p>
    <a class="download-btn" href="{ebook_url}" target="_blank">
      ⬇ Download Your Free Report
    </a>
    <p class="note">Opens in a new tab · No password required</p>
  </div>

  <div class="steps">
    <div class="step"><div class="step-num">1</div><p>{step_1}</p></div>
    <div class="step"><div class="step-num">2</div><p>{step_2}</p></div>
    <div class="step"><div class="step-num">3</div><p>{step_3}</p></div>
  </div>

  <div class="upsell">
    <h3>{upsell_headline}</h3>
    <p>{upsell_body}</p>
    <a class="upsell-btn" href="{stripe_url}" target="_blank">{upsell_cta}</a>
  </div>
</div>
</body>
</html>"""


class FunnelAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("funnel_agent", llm, max_concurrent=2)
        self._output_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "funnels"
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def skill_summary(self) -> dict:
        return {
            "name": "FunnelAgent",
            "capabilities": ["funnel_gen", "sales_page_gen"],
            "description": "Generates landing pages, email sequences, thank-you pages, and direct-sales pages for lead generation and direct sales",
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        if task.type == "sales_page_gen":
            return await self._generate_sales_page(task)
        topic = task.payload.get("topic", "")
        keywords = task.payload.get("keywords", [])
        product_offer = task.payload.get("product_offer") or task.payload.get("product_type", "")
        price_point = task.payload.get("price_point", "")
        stripe_url = task.payload.get("stripe_url", "")
        target_audience = task.payload.get("target_audience", "")
        brand_name = task.payload.get("brand_name", "")
        tone = task.payload.get("tone", "professional")
        content_goal = task.payload.get("content_goal", "leads")
        org_id = task.payload.get("workspace_id") or task.payload.get("org_id") or os.getenv("INTERNAL_ORG_ID", "dev-org")

        logger.info(f"[FunnelAgent] Generating funnel for: '{topic}'")

        # Use ebook_url from payload (product agent passes this) — fallback to file search
        payload_ebook_url = task.payload.get("ebook_url", "")
        if payload_ebook_url and payload_ebook_url != "#":
            ebook_url = payload_ebook_url
            ebook_title = task.payload.get("name", topic)
            logger.info(f"[FunnelAgent] Using product ebook_url from payload: {ebook_url}")
        else:
            ebook_url, ebook_title = await self._find_ebook(topic)

        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:50]
        cta_url = f"/p/{slug}"
        # Auto-resolve upsell URL: prefer the matching sales page, then stripe_url
        sales_page_url = self._find_sales_page_url(slug)
        upsell_url = sales_page_url or stripe_url or ""
        if sales_page_url:
            logger.info(f"[FunnelAgent] Linking upsell → sales page: {sales_page_url}")
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        project_dir = self._output_dir / f"{timestamp}_{slug}"
        project_dir.mkdir(parents=True, exist_ok=True)

        kw_str = ", ".join(keywords) if keywords else topic

        prompt_context = f"""Topic: {topic}
Keywords: {kw_str}
Free offer (the giveaway): "{ebook_title}"
Target audience: {target_audience or 'busy professionals and entrepreneurs'}
Brand / Author name: {brand_name or 'the author'}
Tone: {tone}
Content goal: {content_goal}
""" + (f"Paid upsell product: {product_offer}\n" if product_offer else "") \
  + (f"Paid upsell price: {price_point}\n" if price_point else "") \
  + (f"Checkout URL: {stripe_url}\n" if stripe_url else "") + f"""
IMPORTANT: Every field in your output MUST be specific to "{topic}" and the audience above.
Do NOT use any generic placeholder text. The headline must mention the topic or a direct outcome.
Benefit titles and descriptions must name specific strategies, frameworks, or results from this topic."""

        # --- Landing page ---
        logger.info("[FunnelAgent] Generating landing page copy...")
        raw_lp = await self.llm.complete(
            prompt_context + "\n\nGenerate the landing page JSON now.",
            system=LANDING_PAGE_SYSTEM,
            max_tokens=2500,
        )
        lp = self._parse_json(raw_lp, {}, label="landing_page")
        accent_color = str(task.payload.get("accent_color") or "#58a6ff").strip()
        button_color = str(task.payload.get("button_color") or "#238636").strip()
        bg_color     = str(task.payload.get("bg_color")     or "#0d1117").strip()
        landing_html = self._render_landing_page(lp, brand_name=brand_name, topic=topic, slug=slug,
                                                  accent_color=accent_color, button_color=button_color, bg_color=bg_color)
        lp_path = project_dir / "landing_page.html"
        lp_path.write_text(landing_html, encoding="utf-8")

        # --- Email sequence ---
        logger.info("[FunnelAgent] Generating email sequence...")
        raw_email = await self.llm.complete(
            prompt_context + f"\nLanding page URL: {cta_url}\nStripe checkout: {stripe_url or cta_url}\n\nGenerate the 6-email sequence JSON array now.",
            system=EMAIL_SEQUENCE_SYSTEM,
            max_tokens=6000,
        )
        emails = self._parse_json(raw_email, [], label="email_sequence")
        email_path = project_dir / "email_sequence.json"
        email_path.write_text(json.dumps(emails, indent=2), encoding="utf-8")

        # --- Thank-you page ---
        logger.info("[FunnelAgent] Generating thank-you page...")
        raw_ty = await self.llm.complete(
            prompt_context + "\n\nGenerate the thank-you page JSON now.",
            system=THANKYOU_SYSTEM,
            max_tokens=1000,
        )
        ty = self._parse_json(raw_ty, {}, label="thankyou_page")
        ty_html = self._render_thankyou_page(ty, ebook_url=ebook_url, ebook_title=ebook_title, stripe_url=upsell_url, price_point=price_point)
        ty_path = project_dir / "thankyou_page.html"
        ty_path.write_text(ty_html, encoding="utf-8")

        sequence_id = await self._import_email_sequence(
            topic=topic,
            emails=emails if isinstance(emails, list) else [],
            stripe_url=upsell_url,
            cta_url=cta_url,
            org_id=org_id,
        )

        # Save metadata so the subscribe endpoint can find the sequence
        import json as _json
        meta = {
            "topic": topic,
            "slug": slug,
            "org_id": org_id or "dev-org",
            "sequence_id": sequence_id or "",
        }
        (project_dir / "funnel_meta.json").write_text(_json.dumps(meta, indent=2), encoding="utf-8")

        logger.success(f"[FunnelAgent] Funnel ready: {project_dir}")
        lp_storage = await _storage_upload("funnels", lp_path, f"{slug}/landing_page.html")
        return {
            "type": "funnel",
            "topic": topic,
            "landing_page": str(lp_path),
            "landing_page_storage_url": lp_storage,
            "email_sequence": str(email_path),
            "thankyou_page": str(ty_path),
            "email_count": len(emails) if isinstance(emails, list) else 0,
            "headline": lp.get("headline", ""),
            "autoresponder_sequence_id": sequence_id,
        }

    async def _import_email_sequence(self, topic: str, emails: list, stripe_url: str, cta_url: str, org_id: str = "") -> str:
        """Import the generated email sequence into the local Python API (SQLite-backed, no Supabase required)."""
        python_api_url = os.getenv("PYTHON_API_URL", "http://localhost:8000")
        internal_token = os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal")
        if not emails:
            return ""
        try:
            link = stripe_url or cta_url or "#"
            steps = []
            for i, email in enumerate(emails):
                body_plain = str(email.get("body", "")).strip()
                cta_text = email.get("cta_text", "Get Instant Access →")
                body_plain_with_cta = body_plain + f"\n\n→ {cta_text}:\n{link}"
                body_html = body_plain.replace("\n", "<br>") + f"""
<br><br>
<div style="text-align:center;margin:24px 0">
  <a href="{link}"
     style="display:inline-block;padding:14px 28px;background:#238636;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;font-family:sans-serif">
    {cta_text}
  </a>
</div>"""
                steps.append({
                    "subject": email.get("subject", f"Email {i + 1}"),
                    "body_plain": body_plain_with_cta,
                    "body_html": body_html,
                    "delay_days": int(email.get("send_day", i * 2)),
                })

            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{python_api_url}/api/email-sequences",
                    headers={"x-internal-token": internal_token},
                    json={
                        "org_id": org_id or "dev-org",
                        "name": f"Funnel: {topic[:60]}",
                        "description": f"Auto-generated sequence for funnel: {topic}",
                        "trigger_type": "new_subscriber",
                        "status": "active",
                        "steps": steps,
                    },
                )
                if resp.status_code not in (200, 201):
                    logger.warning(f"[FunnelAgent] Could not create email sequence: {resp.text[:200]}")
                    return ""
                seq_id = resp.json().get("sequence", {}).get("id", "")
                logger.success(f"[FunnelAgent] Email sequence saved → ID: {seq_id} ({len(emails)} steps)")
                return seq_id

        except Exception as e:
            logger.warning(f"[FunnelAgent] Auto-import email sequence failed: {e}")
            return ""

    def _find_sales_page_url(self, slug: str) -> str:
        """Return /s/{slug} if a matching sales page folder exists, else empty string."""
        funnel_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "funnels"
        if not funnel_base.exists():
            return ""
        slug_words = [w for w in slug.split("-") if len(w) > 3]
        for d in sorted(funnel_base.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not d.is_dir() or not d.name.endswith("_sales"):
                continue
            name = d.name.lower()
            if slug in name or any(w in name for w in slug_words[:4]):
                sales_meta = d / "sales_meta.json"
                if sales_meta.exists():
                    try:
                        meta = json.loads(sales_meta.read_text(encoding="utf-8"))
                        found_slug = meta.get("slug", "")
                        if found_slug:
                            return f"/s/{found_slug}"
                    except Exception:
                        pass
                # Derive slug from folder name: strip timestamp prefix and _sales suffix
                folder_slug = re.sub(r"^\d{8}_\d{6}_", "", d.name).removesuffix("_sales")
                return f"/s/{folder_slug}"
        return ""

    async def _find_ebook(self, topic: str) -> tuple[str, str]:
        """Find the most recently generated eBook matching this topic.
        Retries up to 3 times with a short wait to handle ebooks still being written.
        Returns (url, title)."""
        import asyncio as _aio
        ebook_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "ebook"

        # Clean slug: strip trailing/leading dashes from special chars in topic
        slug = re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", topic.lower())).strip("-")[:40]
        slug_words = [w for w in slug.split("-") if len(w) > 3]

        for attempt in range(4):
            if not ebook_base.exists():
                await _aio.sleep(3)
                continue
            candidates = sorted(ebook_base.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            for d in candidates:
                if not d.is_dir():
                    continue
                name = d.name.lower()
                if slug in name or any(w in name for w in slug_words[:4]):
                    meta_json = d / "meta.json"
                    title = "Your Free Report"
                    if meta_json.exists():
                        try:
                            meta = json.loads(meta_json.read_text(encoding="utf-8"))
                            title = meta.get("title", title)
                        except Exception:
                            pass
                    html_files = sorted(d.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True)
                    if html_files:
                        ebook_html = html_files[0]
                        norm = str(ebook_html).replace("\\", "/")
                        idx = norm.find("outputs/")
                        url = "/" + norm[idx:] if idx >= 0 else "#"
                        logger.info(f"[FunnelAgent] Found eBook: {url}")
                        return (url, title)
            if attempt < 3:
                logger.info(f"[FunnelAgent] eBook not found yet (attempt {attempt+1}/4) — waiting 5s...")
                await _aio.sleep(5)

        # Also search outputs/products/ (created by product_agent)
        products_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "products"
        if products_base.exists():
            candidates = sorted(products_base.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            for d in candidates:
                if not d.is_dir():
                    continue
                name = d.name.lower()
                if slug in name or any(w in name for w in slug_words[:4]):
                    html_files = sorted(d.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True)
                    if html_files:
                        norm = str(html_files[0]).replace("\\", "/")
                        idx = norm.find("outputs/")
                        url = "/" + norm[idx:] if idx >= 0 else "#"
                        logger.info(f"[FunnelAgent] Found product file: {url}")
                        return (url, topic)

        # Fallback: return # so the button is visible but non-broken
        logger.info(f"[FunnelAgent] No matching product/ebook found for '{topic}' — download link set to #")
        return ("#", "Your Free Report")

    def _parse_json(self, raw: str, default, label: str = "") -> Any:
        """Robustly extract and parse JSON from an LLM response."""
        text = raw.strip()

        # Strip markdown code fences
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
        text = re.sub(r"\s*```\s*$", "", text, flags=re.MULTILINE)
        text = text.strip()

        # Try direct parse first
        try:
            return json.loads(text)
        except Exception:
            pass

        # Find the outermost JSON object or array
        for open_char, close_char in [('{', '}'), ('[', ']')]:
            start = text.find(open_char)
            if start == -1:
                continue
            # Find matching close by counting depth
            depth = 0
            for i, ch in enumerate(text[start:], start):
                if ch == open_char:
                    depth += 1
                elif ch == close_char:
                    depth -= 1
                    if depth == 0:
                        candidate = text[start:i + 1]
                        try:
                            return json.loads(candidate)
                        except Exception:
                            break

        # Last resort: strip trailing commas and retry
        cleaned = re.sub(r",\s*([}\]])", r"\1", text)
        try:
            return json.loads(cleaned)
        except Exception:
            pass

        logger.error(f"[FunnelAgent] JSON parse failed for {label}. Raw output (first 500 chars):\n{raw[:500]}")
        return default

    def _render_landing_page(self, data: dict, brand_name: str = "", topic: str = "", slug: str = "",
                             accent_color: str = "#58a6ff", button_color: str = "#238636", bg_color: str = "#0d1117") -> str:
        b1 = data.get("benefit_1", {})
        b2 = data.get("benefit_2", {})
        b3 = data.get("benefit_3", {})

        # Build checklist from what_youll_get array
        items = data.get("what_youll_get", [])
        if not items:
            items = [
                f"The core framework behind {topic}",
                "Step-by-step action plan you can start today",
                "Common mistakes to avoid",
                "How to get results faster with less effort",
                "Real-world examples and case studies",
            ]
        checklist_html = "".join(f"    <li>{item}</li>\n" for item in items[:6])

        author = data.get("author_name") or brand_name or "The Author"
        author_bio = data.get("author_bio") or f"A leading expert on {topic} with years of experience helping people achieve real results."

        _slug = slug or re.sub(r"[^a-z0-9]+", "-", topic.lower())[:50]
        bg_card = _lighten(bg_color, 22)
        button_hover = _darken(button_color, 10)
        return HTML_TEMPLATE.format(
            bg_color=bg_color,
            bg_card=bg_card,
            accent_color=accent_color,
            button_color=button_color,
            button_hover=button_hover,
            headline=data.get("headline") or f"The Complete Guide to {topic}",
            subheadline=data.get("subheadline") or "Get the free report and start seeing results this week.",
            hero_body=data.get("hero_body") or f"Discover proven strategies for {topic} inside this free report.",
            checklist_items=checklist_html,
            urgency_line=data.get("urgency_line") or "Free for a limited time — download now",
            opt_in_label=data.get("opt_in_label") or "Your best email address",
            cta_primary=data.get("cta_primary") or f"Send Me the Free Report →",
            cta_secondary=data.get("cta_secondary") or "100% free. No spam. Unsubscribe anytime.",
            benefit_1_title=b1.get("title") if isinstance(b1, dict) else f"{topic} Foundation",
            benefit_1_desc=b1.get("desc") if isinstance(b1, dict) else f"Learn the fundamentals of {topic} that most people miss.",
            benefit_2_title=b2.get("title") if isinstance(b2, dict) else "Actionable System",
            benefit_2_desc=b2.get("desc") if isinstance(b2, dict) else "A step-by-step process you can implement immediately.",
            benefit_3_title=b3.get("title") if isinstance(b3, dict) else "Proven Results",
            benefit_3_desc=b3.get("desc") if isinstance(b3, dict) else "Strategies backed by real-world results and experience.",
            social_proof=data.get("social_proof") or f"This report completely changed how I approach {topic}. The results were immediate.",
            social_proof_name=data.get("social_proof_name") or "Verified Reader",
            author_name=author,
            author_bio=author_bio,
            footer_tagline=data.get("footer_tagline") or f"Your {topic} journey starts here.",
            year=datetime.utcnow().year,
            subscribe_url=f"/api/subscribe/{_slug}",
            thankyou_url=f"/p/{_slug}/thankyou",
        )

    def _render_thankyou_page(self, data: dict, ebook_url: str = "#", ebook_title: str = "Your Free Report", stripe_url: str = "", price_point: str = "") -> str:
        steps = data.get("next_steps", [])
        s1 = steps[0] if len(steps) > 0 else "Click the download button above to get your free report"
        s2 = steps[1] if len(steps) > 1 else "Read through the report and pick one strategy to try today"
        s3 = steps[2] if len(steps) > 2 else "Check out the full program below for faster, deeper results"

        upsell_cta = data.get("upsell_cta") or "Yes, I Want Faster Results →"
        if price_point and price_point not in upsell_cta:
            upsell_cta = f"{upsell_cta} — {price_point}"

        return THANKYOU_TEMPLATE.format(
            headline=data.get("headline") or "You're In! Your Report Is Ready",
            subheadline=data.get("subheadline") or "Click the button below to download your free report instantly.",
            ebook_url=ebook_url,
            ebook_title=ebook_title,
            step_1=s1,
            step_2=s2,
            step_3=s3,
            upsell_headline=data.get("upsell_headline") or "Want to go deeper?",
            upsell_body=data.get("upsell_body") or "Take the next step and accelerate your results with the full program.",
            upsell_cta=upsell_cta,
            stripe_url=stripe_url or "#",
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Sales page generation
    # ─────────────────────────────────────────────────────────────────────────

    async def _generate_sales_page(self, task: "Task") -> dict[str, Any]:
        topic         = task.payload.get("topic", "")
        product_name  = task.payload.get("product_name") or task.payload.get("product_offer", topic)
        price_point   = task.payload.get("price_point", "")
        stripe_url    = task.payload.get("stripe_url", "#")
        target_audience = task.payload.get("target_audience", "")
        brand_name    = task.payload.get("brand_name", "")
        keywords      = task.payload.get("keywords", [])
        tone          = task.payload.get("tone", "professional")
        accent_color  = str(task.payload.get("accent_color") or "#58a6ff").strip()
        button_color  = str(task.payload.get("button_color") or "#238636").strip()
        bg_color      = str(task.payload.get("bg_color")     or "#0d1117").strip()
        org_id        = task.payload.get("workspace_id") or task.payload.get("org_id") or os.getenv("INTERNAL_ORG_ID", "dev-org")

        logger.info(f"[FunnelAgent] Generating sales page for: '{product_name}'")

        slug = re.sub(r"[^a-z0-9]+", "-", (product_name or topic).lower())[:50]
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        project_dir = self._output_dir / f"{timestamp}_{slug}_sales"
        project_dir.mkdir(parents=True, exist_ok=True)

        kw_str = ", ".join(keywords) if keywords else topic
        context = f"""Product: {product_name}
Topic/Niche: {topic}
Keywords: {kw_str}
Price: {price_point}
Stripe checkout URL: {stripe_url}
Target audience: {target_audience or 'motivated buyers ready to invest in themselves'}
Brand / Author: {brand_name or 'the creator'}
Tone: {tone}
IMPORTANT: All copy must be specific to this product and audience. No generic filler."""

        # Generate sales page copy
        raw_sp = await self.llm.complete(
            context + "\n\nGenerate the sales page JSON now.",
            system=SALES_PAGE_SYSTEM,
            max_tokens=3000,
        )
        sp = self._parse_json(raw_sp, {}, label="sales_page")
        sales_html = self._render_sales_page(
            sp, product_name=product_name, price_point=price_point,
            stripe_url=stripe_url, slug=slug,
            accent_color=accent_color, button_color=button_color, bg_color=bg_color,
        )
        sp_path = project_dir / "sales_page.html"
        sp_path.write_text(sales_html, encoding="utf-8")

        # Generate sales thank-you page
        raw_sty = await self.llm.complete(
            context + "\n\nGenerate the sales thank-you page JSON now.",
            system=SALES_THANKYOU_SYSTEM,
            max_tokens=1000,
        )
        sty = self._parse_json(raw_sty, {}, label="sales_thankyou")
        sty_html = self._render_sales_thankyou(sty, product_name=product_name, brand_name=brand_name, slug=slug)
        sty_path = project_dir / "sales_thankyou_page.html"
        sty_path.write_text(sty_html, encoding="utf-8")

        meta = {
            "type": "sales",
            "topic": topic,
            "product_name": product_name,
            "slug": slug,
            "price_point": price_point,
            "stripe_url": stripe_url,
            "org_id": org_id,
        }
        (project_dir / "sales_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        logger.success(f"[FunnelAgent] Sales page ready: {project_dir}")
        sp_storage = await _storage_upload("funnels", sp_path, f"{slug}/sales_page.html")
        return {
            "type": "sales_page",
            "topic": topic,
            "product_name": product_name,
            "sales_page": str(sp_path),
            "sales_page_storage_url": sp_storage,
            "sales_thankyou_page": str(sty_path),
            "sales_url": f"/s/{slug}",
            "thankyou_url": f"/s/{slug}/thankyou",
            "headline": sp.get("headline", ""),
        }

    def _render_sales_page(
        self, data: dict, *, product_name: str, price_point: str, stripe_url: str,
        slug: str, accent_color: str, button_color: str, bg_color: str,
    ) -> str:
        btn_hover = _darken(button_color)
        card_bg   = _lighten(bg_color)

        features = data.get("features", [])
        feat_items = "".join(
            f'<li><span class="feat-icon">✦</span>{f}</li>'
            for f in (features or ["Feature details coming soon"])
        )
        bonuses = data.get("bonuses", [])
        bonus_items = "".join(
            f'<div class="bonus-card"><span class="bonus-label">BONUS</span><strong>{b.get("title","")}</strong><p>{b.get("desc","")}</p></div>'
            for b in (bonuses if isinstance(bonuses, list) else [])
        )
        bonus_section = (
            f'<div class="section"><h2 class="section-title">Exclusive Bonuses</h2>{bonus_items}</div>'
            if bonus_items else ""
        )
        faq_items = data.get("faq", [])
        faq_html = "".join(
            f'<details class="faq-item"><summary>{q.get("q","")}</summary><p>{q.get("a","")}</p></details>'
            for q in (faq_items if isinstance(faq_items, list) else [])
        )
        testimonials = data.get("testimonials", [])
        testi_html = "".join(
            f'<div class="testimonial"><p class="testi-body">"{t.get("body","")}"</p><p class="testi-name">— {t.get("name","")}</p></div>'
            for t in (testimonials if isinstance(testimonials, list) else [])
        )

        price_display = price_point or data.get("price_display", "")
        cta_text = data.get("cta_text") or f"Get Instant Access {('— ' + price_display) if price_display else '→'}"

        return SALES_PAGE_TEMPLATE.format(
            headline=data.get("headline") or f"Introducing {product_name}",
            subheadline=data.get("subheadline") or "",
            hero_body=data.get("hero_body") or "",
            features_html=feat_items,
            bonus_section=bonus_section,
            faq_html=faq_html,
            testimonials_html=testi_html,
            price_display=price_display,
            cta_text=cta_text,
            cta_secondary=data.get("cta_secondary") or "30-day money-back guarantee · Instant access",
            guarantee=data.get("guarantee") or "30-Day Money-Back Guarantee",
            guarantee_body=data.get("guarantee_body") or "If you're not completely satisfied within 30 days, we'll refund every penny. No questions asked.",
            stripe_url=stripe_url or "#",
            slug=slug,
            accent_color=accent_color,
            button_color=button_color,
            btn_hover=btn_hover,
            bg_color=bg_color,
            card_bg=card_bg,
        )

    def _render_sales_thankyou(self, data: dict, *, product_name: str, brand_name: str, slug: str = "") -> str:
        steps = data.get("next_steps", [])
        s1 = steps[0] if len(steps) > 0 else "Check your email — your receipt and access link are on their way"
        s2 = steps[1] if len(steps) > 1 else "Click the access link in your email to log in instantly"
        s3 = steps[2] if len(steps) > 2 else "Start with Module 1 and complete your first action today"

        sales_url = f"/s/{slug}" if slug else "#"
        download_block = (
            f'<div class="download-box">'
            f'<span class="download-label">Your Purchase</span>'
            f'<div class="download-title">{product_name}</div>'
            f'<a href="{sales_url}" class="download-btn">&#11015; Access Your Product</a>'
            f'</div>'
        )

        return SALES_THANKYOU_TEMPLATE.format(
            headline=data.get("headline") or f"Welcome to {product_name}!",
            subheadline=data.get("subheadline") or "Your purchase was successful. Check your email for your receipt and access details.",
            download_block=download_block,
            step_1=s1,
            step_2=s2,
            step_3=s3,
            support_line=data.get("support_line") or f"Questions? Reply to your receipt email and {brand_name or 'our team'} will help within 24 hours.",
        )
