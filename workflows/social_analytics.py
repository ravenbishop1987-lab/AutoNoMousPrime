"""
social_analytics.py — Post-Publish Engagement Poller
=====================================================
Fetches engagement metrics for posts that have been live for at least 24 hours
and writes the results back to social_queue.analytics_json.

Supported platforms:
  twitter   — Twitter v2 API (bearer token)
  facebook  — Meta Graph API page post insights
  instagram — Meta Graph API media insights
  linkedin  — LinkedIn /rest/posts/{id}/socialDetail
  tiktok    — TikTok video query API
  threads   — Meta Threads media fields
  reddit    — Reddit JSON API (public, no auth needed for basic metrics)

Usage:
  python workflows/social_analytics.py --once          # poll all due rows now
  python workflows/social_analytics.py                 # daemon: poll once per day
  python workflows/social_analytics.py --hours 48      # look back 48h instead of 24h
  python workflows/social_analytics.py --platform twitter,facebook --once
  python workflows/social_analytics.py --log-file analytics.log

Integrates with social_poster.py:
  python workflows/social_poster.py --analytics        # run analytics then exit
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    HAS_SCHEDULER = True
except ImportError:
    HAS_SCHEDULER = False

# Re-use config and DB path from social_poster
DATA_DIR      = Path(os.getenv("DATA_DIR", "./data"))
DB_PATH       = DATA_DIR / "revenue.db"
SETTINGS_PATH = DATA_DIR / "settings.json"


# ─────────────────────────────────────────────────────────────────────────────
# DB migration
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_analytics_columns() -> None:
    """Add analytics_json and analytics_fetched_at to social_queue if absent."""
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        for col, typ in [("analytics_json", "TEXT"), ("analytics_fetched_at", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE social_queue ADD COLUMN {col} {typ}")
                conn.commit()
                logger.info(f"[Analytics] Migration: added {col} to social_queue")
            except sqlite3.OperationalError:
                pass  # column already exists
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {}
    except Exception:
        return {}


@dataclass
class AnalyticsConfig:
    # How many hours after posting before we fetch analytics
    lookback_hours: int = 24
    # Platform filter — ['all'] means every platform
    platforms: list[str] = None  # type: ignore

    # Credentials (same source as PosterConfig)
    twitter_bearer:        str = ""
    facebook_access_token: str = ""
    facebook_page_id:      str = ""
    instagram_account_id:  str = ""
    linkedin_access_token: str = ""
    tiktok_access_token:   str = ""
    tiktok_open_id:        str = ""
    threads_access_token:  str = ""
    threads_user_id:       str = ""

    def __post_init__(self):
        if self.platforms is None:
            self.platforms = ["all"]

    @classmethod
    def from_env(cls) -> "AnalyticsConfig":
        s  = _load_settings()
        tw = s.get("twitter",   {})
        fb = s.get("facebook",  {})
        ig = s.get("instagram", {})
        li = s.get("linkedin",  {})
        tt = s.get("tiktok",    {})
        th = s.get("threads",   {})

        def e(key: str, fallback: str = "") -> str:
            return os.getenv(key) or fallback

        return cls(
            twitter_bearer        = e("TWITTER_BEARER_TOKEN",   tw.get("bearer_token",      "")),
            facebook_access_token = e("FACEBOOK_ACCESS_TOKEN",  fb.get("access_token",       "")),
            facebook_page_id      = e("FACEBOOK_PAGE_ID",       fb.get("page_id",            "")),
            instagram_account_id  = e("INSTAGRAM_ACCOUNT_ID",   ig.get("account_id",         "")),
            linkedin_access_token = e("LINKEDIN_ACCESS_TOKEN",  li.get("access_token",       "")),
            tiktok_access_token   = e("TIKTOK_ACCESS_TOKEN",    tt.get("access_token",       "")),
            tiktok_open_id        = e("TIKTOK_OPEN_ID",         tt.get("open_id",            "")),
            threads_access_token  = e("THREADS_ACCESS_TOKEN",   th.get("access_token",       "")),
            threads_user_id       = e("THREADS_USER_ID",        th.get("user_id",            "")),
        )


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PostedItem:
    id: int
    platform: str
    post_id: str          # platform-side post/tweet/share ID (from log_json)
    posted_at: str


def _fetch_due_analytics(cfg: AnalyticsConfig) -> list[PostedItem]:
    """
    Return rows that were posted ≥ lookback_hours ago and have no analytics yet.
    post_id is extracted from log_json.post_id (set by the poster on success).
    """
    if not DB_PATH.exists():
        logger.warning(f"[Analytics] DB not found: {DB_PATH}")
        return []

    platform_filter = ""
    platform_params: list[Any] = []
    if "all" not in cfg.platforms:
        platform_filter = "AND platform IN (" + ",".join("?" * len(cfg.platforms)) + ")"
        platform_params = list(cfg.platforms)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"""
            SELECT id, platform, log_json, posted_at
            FROM   social_queue
            WHERE  status             = 'posted'
              AND  analytics_json     IS NULL
              AND  posted_at          IS NOT NULL
              AND  datetime(posted_at) <= datetime('now', ? || ' hours')
              {platform_filter}
            ORDER  BY posted_at ASC
            """,
            [f"-{cfg.lookback_hours}", *platform_params],
        ).fetchall()
    finally:
        conn.close()

    items: list[PostedItem] = []
    for r in rows:
        try:
            log = json.loads(r["log_json"] or "{}")
        except Exception:
            log = {}
        post_id = str(log.get("post_id") or log.get("id") or "").strip()
        if not post_id:
            logger.debug(f"[Analytics] Row #{r['id']} has no post_id in log_json — skipping")
            continue
        items.append(PostedItem(
            id=r["id"],
            platform=(r["platform"] or "").lower().strip(),
            post_id=post_id,
            posted_at=r["posted_at"] or "",
        ))
    return items


def _save_analytics(row_id: int, data: dict) -> None:
    """Write analytics_json and analytics_fetched_at back to social_queue."""
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute(
            """UPDATE social_queue
               SET analytics_json       = ?,
                   analytics_fetched_at = datetime('now')
               WHERE id = ?""",
            [json.dumps(data), row_id],
        )
        conn.commit()
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Platform fetchers
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_twitter(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.twitter_bearer:
        logger.debug("[Analytics] Twitter bearer token not set — skipping")
        return None
    url = f"https://api.twitter.com/2/tweets/{item.post_id}"
    params = {"tweet.fields": "public_metrics,created_at,author_id"}
    headers = {"Authorization": f"Bearer {cfg.twitter_bearer}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=params, headers=headers)
    if r.status_code == 200:
        data = r.json().get("data", {})
        metrics = data.get("public_metrics", {})
        return {
            "platform": "twitter",
            "post_id": item.post_id,
            "likes": metrics.get("like_count", 0),
            "retweets": metrics.get("retweet_count", 0),
            "replies": metrics.get("reply_count", 0),
            "quotes": metrics.get("quote_count", 0),
            "impressions": metrics.get("impression_count", 0),
            "raw": data,
        }
    logger.warning(f"[Analytics] Twitter {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_facebook(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.facebook_access_token:
        logger.debug("[Analytics] Facebook access token not set — skipping")
        return None
    # Page post insights
    url = f"https://graph.facebook.com/v18.0/{item.post_id}/insights"
    params = {
        "metric": "post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks",
        "access_token": cfg.facebook_access_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=params)
    if r.status_code == 200:
        raw = r.json().get("data", [])
        metrics: dict[str, Any] = {"platform": "facebook", "post_id": item.post_id, "raw": raw}
        for entry in raw:
            metrics[entry.get("name", "unknown")] = entry.get("values", [{}])[-1].get("value", 0)
        return metrics
    logger.warning(f"[Analytics] Facebook {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_instagram(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.facebook_access_token:
        logger.debug("[Analytics] Instagram (FB token) not set — skipping")
        return None
    url = f"https://graph.facebook.com/v18.0/{item.post_id}/insights"
    params = {
        "metric": "impressions,reach,likes,comments,shares,saved",
        "access_token": cfg.facebook_access_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=params)
    if r.status_code == 200:
        raw = r.json().get("data", [])
        metrics: dict[str, Any] = {"platform": "instagram", "post_id": item.post_id, "raw": raw}
        for entry in raw:
            metrics[entry.get("name", "unknown")] = entry.get("values", [{}])[-1].get("value", 0)
        return metrics
    logger.warning(f"[Analytics] Instagram {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_linkedin(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.linkedin_access_token:
        logger.debug("[Analytics] LinkedIn access token not set — skipping")
        return None
    # post_id may be a full URN (urn:li:share:...) — URL-encode it
    import urllib.parse
    encoded_urn = urllib.parse.quote(item.post_id, safe="")
    url = f"https://api.linkedin.com/rest/posts/{encoded_urn}/socialDetail"
    headers = {
        "Authorization": f"Bearer {cfg.linkedin_access_token}",
        "LinkedIn-Version": "202401",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=headers)
    if r.status_code == 200:
        raw = r.json()
        counts = raw.get("reactionSummaries", {})
        return {
            "platform": "linkedin",
            "post_id": item.post_id,
            "likes": counts.get("LIKE", 0),
            "empathy": counts.get("EMPATHY", 0),
            "comments": raw.get("commentCount", 0),
            "shares": raw.get("shareCount", 0),
            "impressions": raw.get("impressionCount", 0),
            "raw": raw,
        }
    logger.warning(f"[Analytics] LinkedIn {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_tiktok(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.tiktok_access_token:
        logger.debug("[Analytics] TikTok access token not set — skipping")
        return None
    url = "https://open.tiktokapis.com/v2/video/query/"
    headers = {
        "Authorization": f"Bearer {cfg.tiktok_access_token}",
        "Content-Type": "application/json",
    }
    body = {
        "filters": {"video_ids": [item.post_id]},
        "fields": ["id", "like_count", "comment_count", "share_count", "view_count"],
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=body, headers=headers)
    if r.status_code == 200:
        videos = r.json().get("data", {}).get("videos", [])
        if videos:
            v = videos[0]
            return {
                "platform": "tiktok",
                "post_id": item.post_id,
                "views": v.get("view_count", 0),
                "likes": v.get("like_count", 0),
                "comments": v.get("comment_count", 0),
                "shares": v.get("share_count", 0),
                "raw": v,
            }
    logger.warning(f"[Analytics] TikTok {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_threads(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    if not cfg.threads_access_token:
        logger.debug("[Analytics] Threads access token not set — skipping")
        return None
    url = f"https://graph.threads.net/v1.0/{item.post_id}"
    params = {
        "fields": "id,text,timestamp,like_count,replies_count,reposts_count,views",
        "access_token": cfg.threads_access_token,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=params)
    if r.status_code == 200:
        raw = r.json()
        return {
            "platform": "threads",
            "post_id": item.post_id,
            "likes": raw.get("like_count", 0),
            "replies": raw.get("replies_count", 0),
            "reposts": raw.get("reposts_count", 0),
            "views": raw.get("views", 0),
            "raw": raw,
        }
    logger.warning(f"[Analytics] Threads {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


async def _fetch_reddit(item: PostedItem, cfg: AnalyticsConfig) -> dict | None:
    """Reddit public JSON API — no auth needed for basic post stats."""
    # post_id may be a full URL or just the ID (t3_xxxxxx or xxxxxx)
    post_id = item.post_id.split("_")[-1] if "_" in item.post_id else item.post_id
    url = f"https://www.reddit.com/api/info.json?id=t3_{post_id}"
    headers = {"User-Agent": "AutonomousPrime/1.0"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=headers)
    if r.status_code == 200:
        children = r.json().get("data", {}).get("children", [])
        if children:
            d = children[0].get("data", {})
            return {
                "platform": "reddit",
                "post_id": item.post_id,
                "upvotes": d.get("ups", 0),
                "downvotes": d.get("downs", 0),
                "score": d.get("score", 0),
                "comments": d.get("num_comments", 0),
                "upvote_ratio": d.get("upvote_ratio", 0),
                "raw": d,
            }
    logger.warning(f"[Analytics] Reddit {item.post_id}: {r.status_code} {r.text[:120]}")
    return None


# Map platform name → fetcher function
_FETCHERS = {
    "twitter":   _fetch_twitter,
    "x":         _fetch_twitter,
    "facebook":  _fetch_facebook,
    "instagram": _fetch_instagram,
    "linkedin":  _fetch_linkedin,
    "tiktok":    _fetch_tiktok,
    "threads":   _fetch_threads,
    "reddit":    _fetch_reddit,
}


# ─────────────────────────────────────────────────────────────────────────────
# Main poller
# ─────────────────────────────────────────────────────────────────────────────

async def run_analytics(cfg: AnalyticsConfig) -> dict[str, int]:
    """
    Fetch analytics for all eligible posted rows.
    Returns {"fetched": n, "skipped": n, "failed": n}.
    """
    _ensure_analytics_columns()

    items = _fetch_due_analytics(cfg)
    counts = {"fetched": 0, "skipped": 0, "failed": 0}

    if not items:
        logger.info("[Analytics] No posts ready for analytics (none posted or all already fetched)")
        return counts

    logger.info(f"[Analytics] Fetching metrics for {len(items)} post(s)")

    for item in items:
        fetcher = _FETCHERS.get(item.platform)
        if not fetcher:
            logger.debug(f"[Analytics] No fetcher for platform '{item.platform}' — skipping #{item.id}")
            counts["skipped"] += 1
            continue

        try:
            data = await fetcher(item, cfg)
        except Exception as exc:
            logger.warning(f"[Analytics] #{item.id} {item.platform} error: {exc}")
            counts["failed"] += 1
            continue

        if data:
            data["fetched_at"] = datetime.now(timezone.utc).isoformat()
            _save_analytics(item.id, data)
            logger.success(
                f"[Analytics] ✓ #{item.id} {item.platform.upper()} | "
                f"post={item.post_id[:20]} | "
                + ", ".join(f"{k}={v}" for k, v in data.items()
                            if k not in ("platform", "post_id", "raw", "fetched_at"))
            )
            counts["fetched"] += 1
        else:
            # API returned nothing useful — mark with empty dict so we don't retry forever
            _save_analytics(item.id, {"platform": item.platform, "post_id": item.post_id, "error": "no_data"})
            counts["skipped"] += 1

    logger.info(
        f"[Analytics] Done — fetched={counts['fetched']} "
        f"skipped={counts['skipped']} failed={counts['failed']}"
    )
    return counts


async def run_analytics_daemon(cfg: AnalyticsConfig, interval_hours: int = 24) -> None:
    """Run analytics poller once per day (or every interval_hours)."""
    if HAS_SCHEDULER:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_analytics,
            args=[cfg],
            trigger="interval",
            hours=interval_hours,
            id="social_analytics",
            name="Social Analytics Poller",
        )
        scheduler.start()
        logger.info(f"[Analytics] Daemon started — polling every {interval_hours}h via APScheduler")
        try:
            await asyncio.Event().wait()
        except (KeyboardInterrupt, SystemExit):
            scheduler.shutdown()
    else:
        logger.info(f"[Analytics] Daemon started — polling every {interval_hours}h (asyncio sleep)")
        while True:
            await run_analytics(cfg)
            await asyncio.sleep(interval_hours * 3600)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def _setup_logging(log_file: str | None = None) -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="INFO",
        format="<green>{time:HH:mm:ss}</green> | <level>{level:<8}</level> | {message}",
        colorize=True,
    )
    if log_file:
        logger.add(log_file, rotation="10 MB", retention="14 days", level="DEBUG",
                   format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}")


async def _main(args: argparse.Namespace) -> None:
    cfg = AnalyticsConfig.from_env()
    cfg.lookback_hours = args.hours
    if args.platform:
        cfg.platforms = [p.strip().lower() for p in args.platform.split(",") if p.strip()]

    if args.once:
        await run_analytics(cfg)
    else:
        await run_analytics_daemon(cfg, interval_hours=args.hours)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Autonomous Prime — Social Analytics Poller",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python workflows/social_analytics.py --once                 Poll now and exit
  python workflows/social_analytics.py                        Run daemon (every 24h)
  python workflows/social_analytics.py --hours 48 --once      Look back 48h
  python workflows/social_analytics.py --platform twitter,linkedin --once
  python workflows/social_analytics.py --log-file analytics.log
        """,
    )
    parser.add_argument("--once",      action="store_true", help="Run once and exit")
    parser.add_argument("--hours",     type=int, default=24, help="Hours after posting before fetching analytics (default: 24)")
    parser.add_argument("--platform",  default="",           help="Comma-separated platform filter")
    parser.add_argument("--log-file",  default="",           help="Append logs to this file")

    parsed = parser.parse_args()
    _setup_logging(parsed.log_file or None)
    asyncio.run(_main(parsed))
