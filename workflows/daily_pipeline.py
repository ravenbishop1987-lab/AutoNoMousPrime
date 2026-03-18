"""
Daily Content Pipeline Workflow + Scheduler Setup
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

from .social_scheduler import setup_social_scheduler
from core.runtime_settings import get_setting, as_bool

if TYPE_CHECKING:
    from core.orchestrator import OpenClaw

DAILY_TOPICS = [
    {"topic": "AI productivity tools for remote teams",
     "keywords": ["ai productivity", "remote work tools", "team collaboration"]},
    {"topic": "How to automate your small business with AI",
     "keywords": ["business automation", "ai for small business", "workflow automation"]},
    {"topic": "Best free AI writing tools in 2026",
     "keywords": ["free ai writing tools", "ai content creation", "writing assistant ai"]},
    {"topic": "ChatGPT alternatives for content creators",
     "keywords": ["chatgpt alternatives", "ai content tools", "best llm for creators"]},
    {"topic": "How to make money with AI-generated content",
     "keywords": ["monetize ai content", "ai content business", "passive income ai"]},
    {"topic": "SEO strategies for AI-generated blog posts",
     "keywords": ["ai seo strategy", "seo for ai content", "rank ai blog posts"]},
    {"topic": "Building a digital product business with AI",
     "keywords": ["digital products ai", "ai business ideas", "sell digital products online"]},
]

_topic_index = 0


async def _generate_dynamic_topics(openclaw: "OpenClaw") -> list[dict]:
    """Use the LLM to generate fresh daily topics based on niche + keywords."""
    niche    = str(get_setting("automation", "daily_topic_niche", "AI tools and automation") or "AI tools and automation").strip()
    kws      = str(get_setting("automation", "daily_topic_keywords", "") or "").strip()
    count    = max(1, int(get_setting("automation", "daily_topic_count", "3") or 3))

    kw_line = f"\nTarget keywords: {kws}" if kws else ""
    prompt = (
        f"Generate {count} fresh, high-traffic blog topic ideas for the niche: {niche}.{kw_line}\n"
        f"Return ONLY a JSON array with exactly {count} objects, each with:\n"
        '  {"topic": "Full topic title", "keywords": ["kw1", "kw2", "kw3"]}\n'
        "Make topics specific, timely, and SEO-friendly. No duplicates."
    )

    agent = openclaw._agents.get("content_agent")
    if not agent:
        return []

    try:
        result = await agent.llm.complete_json(prompt, use_local=False)
        if isinstance(result, list):
            return [
                {"topic": str(t.get("topic", "")), "keywords": list(t.get("keywords", []))}
                for t in result if t.get("topic")
            ]
        # Some LLMs wrap the array in a dict
        for v in result.values():
            if isinstance(v, list):
                return [
                    {"topic": str(t.get("topic", "")), "keywords": list(t.get("keywords", []))}
                    for t in v if isinstance(t, dict) and t.get("topic")
                ]
    except Exception as exc:
        logger.warning(f"[DailyPipeline] Dynamic topic generation failed: {exc}")
    return []


async def run_daily_pipeline(openclaw: "OpenClaw") -> None:
    global _topic_index

    use_dynamic  = as_bool(get_setting("automation", "dynamic_topics", "false"))
    publish_blog = as_bool(get_setting("automation", "auto_publish_blog", "false"))

    if use_dynamic:
        topics = await _generate_dynamic_topics(openclaw)
        if not topics:
            logger.warning("[DailyPipeline] Dynamic topic generation returned nothing — falling back to preset")
            use_dynamic = False

    if not use_dynamic:
        # Load from settings if available, otherwise fall back to hardcoded list
        preset_raw = str(get_setting("automation", "preset_topics", "") or "").strip()
        if preset_raw:
            preset_list = [t.strip() for t in preset_raw.splitlines() if t.strip()]
        else:
            preset_list = [t["topic"] for t in DAILY_TOPICS]
        topic_str = preset_list[_topic_index % len(preset_list)]
        _topic_index += 1
        topics = [{"topic": topic_str, "keywords": []}]

    for topic_data in topics:
        logger.info(f"[DailyPipeline] → {topic_data['topic']} (publish_blog={publish_blog})")
        await openclaw.submit_pipeline(
            topic_data["topic"],
            topic_data["keywords"],
            input_payload={"publish_blog": publish_blog},
        )


async def run_financial_report(openclaw: "OpenClaw") -> None:
    await openclaw.submit("financial_report", {}, agent_hint="distribution_agent")
    logger.info("[WeeklyReport] Financial report task queued")


def setup_scheduler(openclaw: "OpenClaw") -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")

    # Daily 08:00 UTC — content pipeline
    scheduler.add_job(
        run_daily_pipeline, "cron",
        hour=8, minute=0,
        args=[openclaw],
        id="daily_pipeline",
        name="Daily Content Pipeline",
    )

    # Weekly Monday 09:00 UTC — financial report
    scheduler.add_job(
        run_financial_report, "cron",
        day_of_week="mon", hour=9, minute=0,
        args=[openclaw],
        id="weekly_report",
        name="Weekly Financial Report",
    )

    # Social media flush every 15 min
    setup_social_scheduler(openclaw, scheduler)

    # Comment reply poll — interval driven by settings
    poll_minutes = int(get_setting("comment_reply", "poll_interval_minutes", "15") or 15)
    scheduler.add_job(
        _run_comment_reply_cycle, "interval",
        minutes=poll_minutes,
        args=[openclaw],
        id="comment_reply_poll",
        name="Comment Auto-Reply",
    )

    logger.info("[Scheduler] All jobs registered: daily pipeline + weekly report + social flush + comment replies")
    return scheduler


async def _run_comment_reply_cycle(openclaw: "OpenClaw") -> None:
    try:
        dist = openclaw.agents.get("distribution_agent")
        if dist is None:
            return
        result = await dist.run_comment_reply_cycle()
        if not result.get("skipped"):
            logger.info(f"[CommentReply] {result}")
    except Exception as exc:
        logger.error(f"[CommentReply] Scheduler cycle error: {exc}")
