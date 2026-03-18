"""
Social Media Auto-Scheduler
Reads pending social_queue entries and posts them on schedule.
Supports Twitter/X and LinkedIn (extendable to YouTube, Facebook).
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

if TYPE_CHECKING:
    from core.orchestrator import OpenClaw


async def flush_social_queue(openclaw: "OpenClaw") -> None:
    """
    Grabs up to 10 pending social posts and submits them as tasks.
    Runs every 15 minutes via scheduler.
    """
    dist = openclaw._agents.get("distribution_agent")
    if not dist:
        return

    db = Path(os.getenv("DATA_DIR", "./data")) / "revenue.db"
    conn = sqlite3.connect(str(db))
    pending = conn.execute(
        """SELECT id, platform, text, payload_json
           FROM social_queue
           WHERE status IN ('pending', 'approved')
             AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))
           LIMIT 10"""
    ).fetchall()
    conn.close()

    if not pending:
        logger.debug("[SocialScheduler] No pending posts")
        return

    logger.info(f"[SocialScheduler] Processing {len(pending)} pending social posts")
    for row_id, platform, text, payload_json in pending:
        payload = {}
        if payload_json:
            try:
                import json
                payload = json.loads(payload_json)
            except Exception:
                payload = {}
        await openclaw.submit(
            "social_post",
            {
                "platform": platform,
                "text": text,
                "queue_id": row_id,
                "topic": payload.get("topic", ""),
                "post_url": payload.get("post_url", ""),
                "media_url": payload.get("media_url", ""),
                "image_path": payload.get("image_path", ""),
            },
            agent_hint="distribution_agent",
        )

    due_calendar = dist.due_calendar_entries(limit=20)
    if due_calendar:
        logger.info(f"[SocialScheduler] Processing {len(due_calendar)} due calendar entries")
    for entry in due_calendar:
        entry_id = int(entry["id"])
        platform = str(entry.get("platform", "")).strip()
        content_type = str(entry.get("content_type", "")).strip()
        payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
        dist.update_calendar_entry_status(entry_id, "queued", {"message": "Queued by scheduler"})

        if content_type == "social":
            await openclaw.submit(
                "social_post",
                {
                    "platform": platform,
                    "text": entry.get("text", ""),
                    "topic": payload.get("topic", ""),
                    "post_url": payload.get("post_url", ""),
                    "media_url": payload.get("media_url", ""),
                    "calendar_entry_id": entry_id,
                },
                agent_hint="distribution_agent",
            )
            continue

        if content_type == "video":
            await openclaw.submit(
                "video_publish",
                {
                    "platform": platform,
                    "publish_targets": [platform],
                    "video_filepath": payload.get("video_path", "") or payload.get("video_filepath", ""),
                    "title": entry.get("title", "") or payload.get("title", ""),
                    "excerpt": entry.get("text", "") or payload.get("description", ""),
                    "post_url": payload.get("post_url", ""),
                    "tags": payload.get("tags", []),
                    "aspect_ratio": payload.get("aspect_ratio", "16:9"),
                    "approval_granted": True,
                    "calendar_entry_id": entry_id,
                    "topic": payload.get("topic", "") or entry.get("title", ""),
                },
                agent_hint="distribution_agent",
            )
            continue

        if content_type == "wordpress":
            await openclaw.submit(
                "post_content",
                {
                    "topic": payload.get("topic", "") or entry.get("title", ""),
                    "blog_filepath": payload.get("blog_filepath", ""),
                    "image_filepath": payload.get("image_path", ""),
                    "title": entry.get("title", "") or payload.get("title", ""),
                    "excerpt": entry.get("text", "") or payload.get("excerpt", ""),
                    "meta_description": payload.get("meta_description", ""),
                    "focus_keyword": payload.get("focus_keyword", ""),
                    "tags": payload.get("tags", []),
                    "calendar_entry_id": entry_id,
                },
                agent_hint="distribution_agent",
            )
            continue

        dist.update_calendar_entry_status(entry_id, "failed", {"error": f"Unsupported content_type: {content_type}"})


async def schedule_post_from_pipeline(
    openclaw: "OpenClaw", platform: str, text: str, delay_hours: float = 1.0
) -> None:
    """Schedule a social post N hours after a pipeline completes."""
    await asyncio.sleep(delay_hours * 3600)
    await openclaw.submit(
        "social_post",
        {"platform": platform, "text": text},
        agent_hint="distribution_agent",
    )


def setup_social_scheduler(openclaw: "OpenClaw", scheduler: AsyncIOScheduler) -> None:
    """Add social posting jobs to an existing scheduler."""
    scheduler.add_job(
        flush_social_queue,
        "interval", minutes=15,
        args=[openclaw],
        id="social_queue_flush",
        name="Social Queue Flush",
    )
    logger.info("[SocialScheduler] Social queue flush every 15 min registered")
