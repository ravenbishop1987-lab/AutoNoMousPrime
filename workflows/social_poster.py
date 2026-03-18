"""
social_poster.py — Standalone Social Media Scheduler
=====================================================
Reads from data/revenue.db::social_queue, posts at scheduled times,
logs success/failure back to the DB, and runs continuously.

Can run standalone OR be imported into the OpenClaw orchestrator.

Usage:
  python workflows/social_poster.py                       # daemon mode (every 15 min)
  python workflows/social_poster.py --once                # flush queue once and exit
  python workflows/social_poster.py --dry-run --once      # simulate, no real API calls
  python workflows/social_poster.py --platform twitter,linkedin --once
  python workflows/social_poster.py --tz "US/Eastern" --interval 30
  python workflows/social_poster.py --status              # show queue summary and exit

Config (env vars or data/settings.json take precedence in that order):
  SOCIAL_POSTER_TZ           UTC              Timezone for scheduled_at comparisons
  SOCIAL_POSTER_INTERVAL     15               Minutes between queue flushes
  SOCIAL_POSTER_LIMIT        20               Max posts per flush
  SOCIAL_POSTER_DRY_RUN      false            Simulate without posting
  SOCIAL_POSTER_PLATFORMS    all              Comma-separated platform filter
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import sqlite3
import sys
import time
import urllib.parse
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import aiofiles
import httpx
from loguru import logger

# ── Optional APScheduler ──────────────────────────────────────────────────────
try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    HAS_SCHEDULER = True
except ImportError:
    HAS_SCHEDULER = False


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR      = Path(os.getenv("DATA_DIR", "./data"))
DB_PATH       = DATA_DIR / "revenue.db"
SETTINGS_PATH = DATA_DIR / "settings.json"


def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {}
    except Exception:
        return {}


@dataclass
class PosterConfig:
    # Scheduler
    tz: str               = "UTC"
    interval_minutes: int = 15
    limit: int            = 20
    dry_run: bool         = False
    platforms: list[str]  = field(default_factory=lambda: ["all"])
    # Approval gate — when True, only posts with status='approved' are picked up.
    # Posts with status='pending' sit in the queue until approved via the API.
    require_approval: bool = False

    # Twitter / X
    twitter_api_key:       str = ""
    twitter_api_secret:    str = ""
    twitter_access_token:  str = ""
    twitter_access_secret: str = ""
    twitter_bearer:        str = ""

    # LinkedIn
    linkedin_access_token: str = ""
    linkedin_person_urn:   str = ""

    # Facebook
    facebook_page_id:      str = ""
    facebook_access_token: str = ""

    # Instagram (uses FB Graph + an IG account ID)
    instagram_account_id:  str = ""

    # TikTok
    tiktok_access_token:   str = ""
    tiktok_open_id:        str = ""

    # YouTube (OAuth2 refresh token flow)
    youtube_client_id:     str = ""
    youtube_client_secret: str = ""
    youtube_refresh_token: str = ""

    # Reddit
    reddit_client_id:      str = ""
    reddit_client_secret:  str = ""
    reddit_username:       str = ""
    reddit_refresh_token:  str = ""
    reddit_subreddit:      str = ""
    # Deprecated — password grant was removed by Reddit in 2023 for third-party apps.
    # Kept for a deprecation warning only; not used in auth.
    reddit_password:       str = ""

    # Threads
    threads_user_id:       str = ""
    threads_access_token:  str = ""

    @classmethod
    def from_env(cls) -> "PosterConfig":
        s  = _load_settings()
        tw = s.get("twitter",   {})
        li = s.get("linkedin",  {})
        fb = s.get("facebook",  {})
        ig = s.get("instagram", {})
        tt = s.get("tiktok",    {})
        yt = s.get("youtube",   {})
        rd = s.get("reddit",    {})
        th = s.get("threads",   {})
        so = s.get("social",    {})

        def e(key: str, fallback: str = "") -> str:
            return os.getenv(key) or fallback

        ap = s.get("approvals", {})
        _req_approval_raw = e(
            "SOCIAL_REQUIRE_APPROVAL",
            str(ap.get("require_social_approval", "false")),
        )
        return cls(
            tz=e("SOCIAL_POSTER_TZ", so.get("timezone", "UTC")),
            interval_minutes=int(e("SOCIAL_POSTER_INTERVAL", str(so.get("interval_minutes", 15)))),
            limit=int(e("SOCIAL_POSTER_LIMIT", "20")),
            dry_run=e("SOCIAL_POSTER_DRY_RUN", "false").lower() in ("1", "true", "yes"),
            require_approval=_req_approval_raw.lower() in ("1", "true", "yes"),
            # Twitter
            twitter_api_key=e("TWITTER_API_KEY", tw.get("api_key", "")),
            twitter_api_secret=e("TWITTER_API_SECRET", tw.get("api_secret", "")),
            twitter_access_token=e("TWITTER_ACCESS_TOKEN", tw.get("access_token", "")),
            twitter_access_secret=e("TWITTER_ACCESS_TOKEN_SECRET", tw.get("access_token_secret", "")),
            twitter_bearer=e("TWITTER_BEARER_TOKEN", tw.get("bearer_token", "")),
            # LinkedIn
            linkedin_access_token=e("LINKEDIN_ACCESS_TOKEN", li.get("access_token", "")),
            linkedin_person_urn=e("LINKEDIN_PERSON_URN", li.get("person_urn", "")),
            # Facebook
            facebook_page_id=e("FACEBOOK_PAGE_ID", fb.get("page_id", "")),
            facebook_access_token=e("FACEBOOK_ACCESS_TOKEN", fb.get("access_token", "")),
            # Instagram
            instagram_account_id=e("INSTAGRAM_ACCOUNT_ID", ig.get("account_id", "")),
            # TikTok
            tiktok_access_token=e("TIKTOK_ACCESS_TOKEN", tt.get("access_token", "")),
            tiktok_open_id=e("TIKTOK_OPEN_ID", tt.get("open_id", "")),
            # YouTube
            youtube_client_id=e("YOUTUBE_CLIENT_ID", yt.get("client_id", "")),
            youtube_client_secret=e("YOUTUBE_CLIENT_SECRET", yt.get("client_secret", "")),
            youtube_refresh_token=e("YOUTUBE_REFRESH_TOKEN", yt.get("refresh_token", "")),
            # Reddit
            reddit_client_id=e("REDDIT_CLIENT_ID", rd.get("client_id", "")),
            reddit_client_secret=e("REDDIT_CLIENT_SECRET", rd.get("client_secret", "")),
            reddit_username=e("REDDIT_USERNAME", rd.get("username", "")),
            reddit_refresh_token=e("REDDIT_REFRESH_TOKEN", rd.get("refresh_token", "")),
            reddit_subreddit=e("REDDIT_SUBREDDIT", rd.get("subreddit", "")),
            reddit_password=e("REDDIT_PASSWORD", rd.get("password", "")),
            # Threads
            threads_user_id=e("THREADS_USER_ID", th.get("user_id", "")),
            threads_access_token=e("THREADS_ACCESS_TOKEN", th.get("access_token", "")),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class QueueItem:
    id: int
    platform: str
    text: str
    image_path: str
    post_url: str
    media_url: str
    topic: str
    scheduled_at: str | None
    payload: dict


def _ensure_locked_at_column() -> None:
    """Add locked_at column to social_queue if it doesn't exist (one-time migration)."""
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("ALTER TABLE social_queue ADD COLUMN locked_at TEXT")
        conn.commit()
        logger.info("[SocialPoster] Migration: added locked_at column to social_queue")
    except sqlite3.OperationalError:
        pass  # column already exists
    finally:
        conn.close()


def _release_stale_locks() -> None:
    """
    Un-stick rows that were claimed by a previous run that crashed or was killed.
    Any row that has been 'processing' for more than 10 minutes is reset to 'pending'.
    """
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        cur = conn.execute(
            """UPDATE social_queue
               SET status    = 'pending',
                   locked_at = NULL
               WHERE status    = 'processing'
                 AND locked_at < datetime('now', '-10 minutes')"""
        )
        if cur.rowcount:
            logger.warning(f"[SocialPoster] Released {cur.rowcount} stale lock(s) from a previous crashed run")
        conn.commit()
    finally:
        conn.close()


def fetch_due_posts(cfg: PosterConfig) -> list[QueueItem]:
    """
    Atomically claim and return pending posts whose scheduled_at <= now (UTC).

    Uses a two-step UPDATE → SELECT pattern so two concurrent poster processes
    cannot claim the same row:
      1. UPDATE rows to status='processing' with a unique locked_at timestamp
      2. SELECT only the rows that match OUR locked_at timestamp
    """
    if not DB_PATH.exists():
        logger.warning(f"[SocialPoster] DB not found: {DB_PATH}")
        return []

    try:
        ZoneInfo(cfg.tz)  # validate TZ
    except ZoneInfoNotFoundError:
        logger.warning(f"[SocialPoster] Unknown TZ '{cfg.tz}', falling back to UTC")
        cfg.tz = "UTC"

    platform_filter = ""
    platform_params: list[Any] = []
    if "all" not in cfg.platforms:
        platform_filter = "AND platform IN (" + ",".join("?" * len(cfg.platforms)) + ")"
        platform_params = list(cfg.platforms)

    # When require_approval is True, only pick up explicitly approved posts.
    # When False (default), pick up both pending and approved posts.
    if cfg.require_approval:
        eligible_statuses = ["approved"]
    else:
        eligible_statuses = ["pending", "approved"]
    status_placeholders = ",".join("?" * len(eligible_statuses))

    # Use a microsecond-precision timestamp as the claim token so concurrent
    # processes each get a unique locked_at value.
    claim_ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")

    conn = sqlite3.connect(str(DB_PATH))
    conn.isolation_level = None  # autocommit off; we manage the transaction manually
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("BEGIN IMMEDIATE")  # exclusive write lock for the claim step

        # Step 1: atomically claim all due rows that are still unclaimed
        conn.execute(
            f"""UPDATE social_queue
                SET status    = 'processing',
                    locked_at = ?
                WHERE status IN ({status_placeholders})
                  AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))
                  {platform_filter}
                  AND id IN (
                      SELECT id FROM social_queue
                      WHERE status IN ({status_placeholders})
                        AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))
                        {platform_filter}
                      ORDER BY scheduled_at ASC NULLS LAST
                      LIMIT ?
                  )""",
            [claim_ts, *eligible_statuses, *platform_params, *eligible_statuses, *platform_params, cfg.limit],
        )

        # Step 2: fetch only the rows WE just claimed (matched by our unique timestamp)
        rows = conn.execute(
            """SELECT id, platform, text,
                      COALESCE(image_path, '') AS image_path,
                      COALESCE(post_url,   '') AS post_url,
                      COALESCE(media_url,  '') AS media_url,
                      COALESCE(topic,      '') AS topic,
                      scheduled_at, payload_json
               FROM social_queue
               WHERE status    = 'processing'
                 AND locked_at = ?
               ORDER BY scheduled_at ASC NULLS LAST""",
            [claim_ts],
        ).fetchall()

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        raise
    else:
        conn.close()

    items: list[QueueItem] = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"] or "{}")
        except Exception:
            payload = {}
        items.append(QueueItem(
            id=r["id"],
            platform=(r["platform"] or "").lower().strip(),
            text=r["text"] or "",
            image_path=r["image_path"] or payload.get("image_path", ""),
            post_url=r["post_url"]   or payload.get("post_url",   ""),
            media_url=r["media_url"] or payload.get("media_url",  ""),
            topic=r["topic"]         or payload.get("topic",      ""),
            scheduled_at=r["scheduled_at"],
            payload=payload,
        ))
    return items


def _write_result(item_id: int, status: str, result: dict) -> None:
    """Persist post outcome back to social_queue, clearing the lock."""
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute(
            """UPDATE social_queue
               SET status    = ?,
                   locked_at = NULL,
                   posted_at = datetime('now'),
                   log_json  = ?
               WHERE id      = ?
                 AND status  = 'processing'""",
            [status, json.dumps(result), item_id],
        )
        conn.commit()
    finally:
        conn.close()


def queue_status_summary() -> dict:
    """Return count of posts by status (for --status CLI flag)."""
    if not DB_PATH.exists():
        return {}
    conn = sqlite3.connect(str(DB_PATH))
    rows = conn.execute(
        "SELECT status, COUNT(*) AS n FROM social_queue GROUP BY status"
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


# ─────────────────────────────────────────────────────────────────────────────
# Platform adapters
# ─────────────────────────────────────────────────────────────────────────────

class PlatformPoster(ABC):
    """Base class every platform adapter extends."""
    platform: str = ""

    def __init__(self, cfg: PosterConfig):
        self.cfg = cfg

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if all required credentials are present."""
        ...

    @abstractmethod
    async def post(self, item: QueueItem) -> dict[str, Any]:
        """
        Send the item.  Must return a dict with at minimum:
          {"success": bool, "post_id": str, "url": str, "error": str}
        """
        ...

    async def health_check(self) -> dict[str, Any]:
        """
        Validate credentials with a lightweight API call.
        Returns {"platform": str, "ok": bool, "detail": str}.
        Subclasses override this; the default just confirms configuration.
        """
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured (missing credentials)"}
        return {"platform": self.platform, "ok": True, "detail": "configured (no live check implemented)"}


# ── Twitter / X ───────────────────────────────────────────────────────────────

class TwitterPoster(PlatformPoster):
    platform = "twitter"

    def is_configured(self) -> bool:
        return bool(
            self.cfg.twitter_api_key
            and self.cfg.twitter_api_secret
            and self.cfg.twitter_access_token
            and self.cfg.twitter_access_secret
        )

    def _oauth1_header(self, url: str, method: str = "POST", extra_params: dict | None = None) -> str:
        """Build an OAuth 1.0a Authorization header."""
        params: dict[str, str] = {
            "oauth_consumer_key":     self.cfg.twitter_api_key,
            "oauth_nonce":            uuid.uuid4().hex,
            "oauth_signature_method": "HMAC-SHA1",
            "oauth_timestamp":        str(int(time.time())),
            "oauth_token":            self.cfg.twitter_access_token,
            "oauth_version":          "1.0",
        }
        if extra_params:
            params.update(extra_params)

        sorted_params = sorted(params.items())
        param_str = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
            for k, v in sorted_params
        )
        base = "&".join([
            method.upper(),
            urllib.parse.quote(url, safe=""),
            urllib.parse.quote(param_str, safe=""),
        ])
        signing_key = (
            urllib.parse.quote(self.cfg.twitter_api_secret, safe="")
            + "&"
            + urllib.parse.quote(self.cfg.twitter_access_secret, safe="")
        )
        sig = base64.b64encode(
            hmac.new(signing_key.encode(), base.encode(), hashlib.sha1).digest()
        ).decode()
        params["oauth_signature"] = sig

        return "OAuth " + ", ".join(
            f'{k}="{urllib.parse.quote(str(v), safe="")}"'
            for k, v in sorted(params.items())
        )

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        url = "https://api.twitter.com/2/users/me"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers={"Authorization": self._oauth1_header(url, "GET")})
            if r.status_code == 200:
                username = r.json().get("data", {}).get("username", "")
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as @{username}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def _upload_media(self, image_path: str) -> str | None:
        try:
            img_bytes = Path(image_path).read_bytes()
            b64 = base64.b64encode(img_bytes).decode()
            upload_url = "https://upload.twitter.com/1.1/media/upload.json"
            auth = self._oauth1_header(upload_url)
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    upload_url,
                    data={"media_data": b64},
                    headers={"Authorization": auth},
                )
            if r.status_code == 200:
                return str(r.json().get("media_id_string", ""))
        except Exception as exc:
            logger.warning(f"[Twitter] Media upload failed: {exc}")
        return None

    async def post(self, item: QueueItem) -> dict[str, Any]:
        text = item.text[:280]
        media_id = None
        if item.image_path and Path(item.image_path).exists():
            media_id = await self._upload_media(item.image_path)

        tweet_url = "https://api.twitter.com/2/tweets"
        body: dict[str, Any] = {"text": text}
        if media_id:
            body["media"] = {"media_ids": [media_id]}

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                tweet_url,
                json=body,
                headers={
                    "Authorization": self._oauth1_header(tweet_url),
                    "Content-Type": "application/json",
                },
            )
        if r.status_code in (200, 201):
            post_id = r.json().get("data", {}).get("id", "")
            return {"success": True, "post_id": post_id,
                    "url": f"https://twitter.com/i/web/status/{post_id}"}
        return {"success": False, "error": r.text, "status_code": r.status_code}


# ── LinkedIn ──────────────────────────────────────────────────────────────────

class LinkedInPoster(PlatformPoster):
    platform = "linkedin"

    def is_configured(self) -> bool:
        return bool(self.cfg.linkedin_access_token and self.cfg.linkedin_person_urn)

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.linkedin.com/v2/userinfo",
                    headers={"Authorization": f"Bearer {self.cfg.linkedin_access_token}"},
                )
            if r.status_code == 200:
                name = r.json().get("name", r.json().get("sub", ""))
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as {name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def post(self, item: QueueItem) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.cfg.linkedin_access_token}",
            "Content-Type": "application/json",
            "LinkedIn-Version": "202401",
            "X-Restli-Protocol-Version": "2.0.0",
        }

        # ── New LinkedIn Posts API (released 2024-01, replaces ugcPosts) ──────
        body: dict[str, Any] = {
            "author": self.cfg.linkedin_person_urn,
            "commentary": item.text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        # Add link content block if a URL is provided
        if item.post_url:
            body["content"] = {
                "article": {
                    "source": item.post_url,
                }
            }

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.linkedin.com/rest/posts",
                json=body,
                headers=headers,
            )

        # New API returns 201; post URN is in x-restli-id response header
        if r.status_code == 201:
            post_urn = r.headers.get("x-restli-id", "")
            return {"success": True, "post_id": post_urn}
        return {"success": False, "error": r.text, "status_code": r.status_code}

        # ── DEPRECATED: ugcPosts endpoint (removed by LinkedIn Aug 2023) ──────
        # headers_old = {
        #     "Authorization": f"Bearer {self.cfg.linkedin_access_token}",
        #     "Content-Type": "application/json",
        #     "X-Restli-Protocol-Version": "2.0.0",
        # }
        # media_category = "ARTICLE" if item.post_url else "NONE"
        # share_content = {
        #     "shareCommentary": {"text": item.text},
        #     "shareMediaCategory": media_category,
        # }
        # if item.post_url:
        #     share_content["media"] = [{"status": "READY", "originalUrl": item.post_url}]
        # body_old = {
        #     "author": self.cfg.linkedin_person_urn,
        #     "lifecycleState": "PUBLISHED",
        #     "specificContent": {"com.linkedin.ugc.ShareContent": share_content},
        #     "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        # }
        # r = await client.post("https://api.linkedin.com/v2/ugcPosts",
        #                       json=body_old, headers=headers_old)
        # ── END DEPRECATED ────────────────────────────────────────────────────


# ── Facebook ──────────────────────────────────────────────────────────────────

class FacebookPoster(PlatformPoster):
    platform = "facebook"

    def is_configured(self) -> bool:
        return bool(self.cfg.facebook_page_id and self.cfg.facebook_access_token)

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://graph.facebook.com/me",
                    params={"access_token": self.cfg.facebook_access_token, "fields": "name,id"},
                )
            if r.status_code == 200:
                name = r.json().get("name", r.json().get("id", ""))
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as {name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def post(self, item: QueueItem) -> dict[str, Any]:
        data: dict[str, Any] = {
            "message": item.text,
            "access_token": self.cfg.facebook_access_token,
        }
        if item.post_url:
            data["link"] = item.post_url

        url = f"https://graph.facebook.com/v18.0/{self.cfg.facebook_page_id}/feed"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, data=data)
        if r.status_code == 200:
            return {"success": True, "post_id": r.json().get("id", "")}
        return {"success": False, "error": r.text, "status_code": r.status_code}


# ── Instagram ─────────────────────────────────────────────────────────────────

class InstagramPoster(PlatformPoster):
    platform = "instagram"

    def is_configured(self) -> bool:
        return bool(self.cfg.instagram_account_id and self.cfg.facebook_access_token)

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"https://graph.facebook.com/{self.cfg.instagram_account_id}",
                    params={"access_token": self.cfg.facebook_access_token, "fields": "name,username,id"},
                )
            if r.status_code == 200:
                data = r.json()
                name = data.get("username") or data.get("name") or data.get("id", "")
                return {"platform": self.platform, "ok": True, "detail": f"account {name} reachable"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def post(self, item: QueueItem) -> dict[str, Any]:
        image_url = item.image_path or item.media_url
        if not image_url:
            return {"success": False, "error": "Instagram requires image_url"}

        token      = self.cfg.facebook_access_token
        account_id = self.cfg.instagram_account_id
        async with httpx.AsyncClient(timeout=60) as client:
            r1 = await client.post(
                f"https://graph.facebook.com/v18.0/{account_id}/media",
                data={"image_url": image_url, "caption": item.text, "access_token": token},
            )
            if r1.status_code != 200:
                return {"success": False, "error": r1.text, "status_code": r1.status_code}

            container_id = r1.json().get("id")
            await asyncio.sleep(2)  # let container process

            r2 = await client.post(
                f"https://graph.facebook.com/v18.0/{account_id}/media_publish",
                data={"creation_id": container_id, "access_token": token},
            )
        if r2.status_code == 200:
            return {"success": True, "post_id": r2.json().get("id", "")}
        return {"success": False, "error": r2.text, "status_code": r2.status_code}


# ── TikTok ───────────────────────────────────────────────────────────────────

class TikTokPoster(PlatformPoster):
    platform = "tiktok"

    def is_configured(self) -> bool:
        return bool(self.cfg.tiktok_access_token and self.cfg.tiktok_open_id)

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://open.tiktokapis.com/v2/user/info/",
                    params={"fields": "display_name,open_id"},
                    headers={"Authorization": f"Bearer {self.cfg.tiktok_access_token}"},
                )
            if r.status_code == 200:
                name = r.json().get("data", {}).get("user", {}).get("display_name", "")
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as {name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def post(self, item: QueueItem) -> dict[str, Any]:
        video_path = item.image_path or item.media_url
        if not video_path or not Path(video_path).exists():
            return {"success": False, "error": "TikTok requires a local video file"}

        CHUNK_SIZE = 64 * 1024 * 1024  # 64 MB
        size = os.path.getsize(video_path)
        total_chunk_count = math.ceil(size / CHUNK_SIZE)
        chunk_size = CHUNK_SIZE if total_chunk_count > 1 else size

        headers = {
            "Authorization": f"Bearer {self.cfg.tiktok_access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        }

        async with httpx.AsyncClient(timeout=60) as client:
            r_init = await client.post(
                "https://open.tiktokapis.com/v2/post/publish/video/init/",
                headers=headers,
                json={
                    "post_info": {
                        "title": item.text[:150],
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False, "disable_comment": False, "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": size,
                        "chunk_size": chunk_size,
                        "total_chunk_count": total_chunk_count,
                    },
                },
            )
        if r_init.status_code != 200:
            return {"success": False, "error": r_init.text}

        upload_url = r_init.json().get("data", {}).get("upload_url", "")
        publish_id = r_init.json().get("data", {}).get("publish_id", "")

        async with httpx.AsyncClient(timeout=600) as client:
            async with aiofiles.open(video_path, "rb") as fh:
                offset = 0
                for chunk_idx in range(total_chunk_count):
                    chunk_data = await fh.read(CHUNK_SIZE)
                    end = offset + len(chunk_data) - 1
                    r_upload = await client.put(
                        upload_url,
                        content=chunk_data,
                        headers={
                            "Content-Range": f"bytes {offset}-{end}/{size}",
                            "Content-Type": "video/mp4",
                            "Content-Length": str(len(chunk_data)),
                        },
                    )
                    if r_upload.status_code not in (200, 201, 206):
                        return {"success": False, "error": r_upload.text}
                    offset += len(chunk_data)

        return {"success": True, "post_id": publish_id}


# ── YouTube ───────────────────────────────────────────────────────────────────

class YouTubePoster(PlatformPoster):
    platform = "youtube"

    def __init__(self, cfg: PosterConfig):
        super().__init__(cfg)
        self._token: str = ""
        self._token_exp: float = 0.0

    def is_configured(self) -> bool:
        return bool(
            self.cfg.youtube_refresh_token
            and self.cfg.youtube_client_id
            and self.cfg.youtube_client_secret
        )

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            token = await self._refresh_access_token()
            if not token:
                return {"platform": self.platform, "ok": False, "detail": "token refresh failed — check client_id/secret/refresh_token"}
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {token}"},
                )
            if r.status_code == 200:
                name = r.json().get("name") or r.json().get("email", "")
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as {name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def _refresh_access_token(self) -> str | None:
        if self._token and time.time() < self._token_exp - 30:
            return self._token
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id":     self.cfg.youtube_client_id,
                "client_secret": self.cfg.youtube_client_secret,
                "refresh_token": self.cfg.youtube_refresh_token,
                "grant_type":    "refresh_token",
            })
        if r.status_code != 200:
            return None
        data = r.json()
        self._token = data.get("access_token", "")
        self._token_exp = time.time() + data.get("expires_in", 3600)
        return self._token or None

    async def post(self, item: QueueItem) -> dict[str, Any]:
        video_path = item.image_path or item.media_url
        if not video_path or not Path(video_path).exists():
            return {"success": False, "error": "YouTube requires a local video file"}

        access_token = await self._refresh_access_token()
        if not access_token:
            return {"success": False, "error": "Could not refresh YouTube access token"}

        title = (item.topic or item.text)[:100]
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        # Resumable upload — init
        async with httpx.AsyncClient(timeout=30) as client:
            r_init = await client.post(
                "https://www.googleapis.com/upload/youtube/v3/videos"
                "?uploadType=resumable&part=snippet,status",
                headers={**headers, "X-Upload-Content-Type": "video/mp4"},
                json={
                    "snippet": {
                        "title":       title,
                        "description": item.text,
                        "tags":        item.payload.get("tags", []),
                    },
                    "status": {"privacyStatus": "public"},
                },
            )
        if r_init.status_code != 200:
            return {"success": False, "error": r_init.text}

        upload_url = r_init.headers.get("Location", "")
        file_size = os.path.getsize(video_path)

        async def _stream_file():
            async with aiofiles.open(video_path, "rb") as fh:
                while True:
                    chunk = await fh.read(8 * 1024 * 1024)  # 8 MB
                    if not chunk:
                        break
                    yield chunk

        async with httpx.AsyncClient(timeout=600) as client:
            r_upload = await client.put(
                upload_url,
                content=_stream_file(),
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(file_size),
                },
            )
        if r_upload.status_code in (200, 201):
            video_id = r_upload.json().get("id", "")
            return {"success": True, "post_id": video_id,
                    "url": f"https://youtube.com/watch?v={video_id}"}
        return {"success": False, "error": r_upload.text}


# ── Reddit ────────────────────────────────────────────────────────────────────
#
# How to obtain a refresh token:
#   1. Go to https://www.reddit.com/prefs/apps and create a "web app" (or "installed app").
#   2. Set the redirect URI to http://localhost:8080 (or any URI you control).
#   3. Direct the account owner to:
#        https://www.reddit.com/api/v1/authorize?client_id=CLIENT_ID&response_type=code
#          &state=random&redirect_uri=REDIRECT_URI&duration=permanent&scope=submit
#   4. After approval, Reddit redirects to REDIRECT_URI?code=AUTH_CODE.
#   5. Exchange AUTH_CODE for tokens:
#        curl -X POST https://www.reddit.com/api/v1/access_token \
#          -u CLIENT_ID:CLIENT_SECRET \
#          -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=REDIRECT_URI"
#   6. Store the returned refresh_token in REDDIT_REFRESH_TOKEN (or data/settings.json).
#      The refresh token is permanent (until revoked) and replaces the deprecated password grant.

class RedditPoster(PlatformPoster):
    platform = "reddit"

    def __init__(self, cfg: PosterConfig):
        super().__init__(cfg)
        self._token: str = ""
        self._token_exp: float = 0.0
        if cfg.reddit_password:
            logger.warning(
                "[RedditPoster] REDDIT_PASSWORD / reddit.password is deprecated and ignored. "
                "Reddit removed password-grant support for third-party apps in 2023. "
                "Set REDDIT_REFRESH_TOKEN instead (see social_poster.py for instructions)."
            )

    def is_configured(self) -> bool:
        return bool(
            self.cfg.reddit_client_id
            and self.cfg.reddit_client_secret
            and self.cfg.reddit_refresh_token
            and self.cfg.reddit_subreddit
        )

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            token = await self._get_token()
            if not token:
                return {"platform": self.platform, "ok": False, "detail": "token fetch failed — check client_id/secret/refresh_token"}
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://oauth.reddit.com/api/v1/me",
                    headers={
                        "Authorization": f"bearer {token}",
                        "User-Agent": "AutonomousPrime/1.0",
                    },
                )
            if r.status_code == 200:
                name = r.json().get("name", "")
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as u/{name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def _get_token(self) -> str | None:
        if self._token and time.time() < self._token_exp - 30:
            return self._token
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=(self.cfg.reddit_client_id, self.cfg.reddit_client_secret),
                data={
                    "grant_type":    "refresh_token",
                    "refresh_token": self.cfg.reddit_refresh_token,
                },
                headers={"User-Agent": "AutonomousPrime/1.0"},
            )
        if r.status_code != 200:
            logger.error(f"[RedditPoster] Token refresh failed ({r.status_code}): {r.text}")
            return None
        data = r.json()
        self._token = data.get("access_token", "")
        self._token_exp = time.time() + data.get("expires_in", 3600)
        return self._token or None

    async def post(self, item: QueueItem) -> dict[str, Any]:
        token = await self._get_token()
        if not token:
            return {"success": False, "error": "Reddit authentication failed"}

        headers = {
            "Authorization": f"bearer {token}",
            "User-Agent": "AutonomousPrime/1.0",
        }
        kind = "link" if item.post_url else "self"
        data: dict[str, Any] = {
            "sr":        self.cfg.reddit_subreddit,
            "kind":      kind,
            "title":     (item.topic or item.text)[:300],
            "resubmit":  True,
            "nsfw":      False,
        }
        if kind == "link":
            data["url"] = item.post_url
        else:
            data["text"] = item.text

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://oauth.reddit.com/api/submit",
                headers=headers,
                data=data,
            )
        result = r.json()
        errors = result.get("json", {}).get("errors", [])
        if r.status_code == 200 and not errors:
            post_url = result.get("json", {}).get("data", {}).get("url", "")
            return {"success": True, "url": post_url}
        return {"success": False, "error": str(errors or result)}


# ── Threads ───────────────────────────────────────────────────────────────────

class ThreadsPoster(PlatformPoster):
    platform = "threads"

    def is_configured(self) -> bool:
        return bool(self.cfg.threads_user_id and self.cfg.threads_access_token)

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured():
            return {"platform": self.platform, "ok": False, "detail": "not configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://graph.threads.net/v1.0/me",
                    params={"access_token": self.cfg.threads_access_token, "fields": "id,username"},
                )
            if r.status_code == 200:
                name = r.json().get("username") or r.json().get("id", "")
                return {"platform": self.platform, "ok": True, "detail": f"authenticated as @{name}"}
            return {"platform": self.platform, "ok": False, "detail": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as exc:
            return {"platform": self.platform, "ok": False, "detail": str(exc)}

    async def post(self, item: QueueItem) -> dict[str, Any]:
        token   = self.cfg.threads_access_token
        user_id = self.cfg.threads_user_id

        async with httpx.AsyncClient(timeout=30) as client:
            r1 = await client.post(
                f"https://graph.threads.net/v1.0/{user_id}/threads",
                data={"media_type": "TEXT", "text": item.text, "access_token": token},
            )
            if r1.status_code != 200:
                return {"success": False, "error": r1.text}

            container_id = r1.json().get("id")
            await asyncio.sleep(3)  # Threads API needs a moment before publish

            r2 = await client.post(
                f"https://graph.threads.net/v1.0/{user_id}/threads_publish",
                data={"creation_id": container_id, "access_token": token},
            )
        if r2.status_code == 200:
            return {"success": True, "post_id": r2.json().get("id", "")}
        return {"success": False, "error": r2.text, "status_code": r2.status_code}


# ─────────────────────────────────────────────────────────────────────────────
# Platform registry — maps every alias to the correct adapter
# ─────────────────────────────────────────────────────────────────────────────

PLATFORM_REGISTRY: dict[str, type[PlatformPoster]] = {
    "twitter":        TwitterPoster,
    "x":              TwitterPoster,
    "linkedin":       LinkedInPoster,
    "facebook":       FacebookPoster,
    "facebook_groups": FacebookPoster,
    "instagram":      InstagramPoster,
    "instagram_posts": InstagramPoster,
    "tiktok":         TikTokPoster,
    "youtube":        YouTubePoster,
    "reddit":         RedditPoster,
    "threads":        ThreadsPoster,
}


# ─────────────────────────────────────────────────────────────────────────────
# Core processor
# ─────────────────────────────────────────────────────────────────────────────

class SocialPoster:
    """
    Main engine.  Instantiate once, call run_once() to flush the queue,
    or run_daemon() to loop indefinitely.
    """

    def __init__(self, cfg: PosterConfig):
        self.cfg = cfg
        self._posters: dict[str, PlatformPoster] = {}

        for name, cls in PLATFORM_REGISTRY.items():
            instance = cls(cfg)
            if instance.is_configured():
                self._posters[name] = instance

        configured = sorted(set(
            cls.platform for cls in [self._posters[k].__class__ for k in self._posters]
        ))
        if configured:
            logger.info(f"[SocialPoster] Configured platforms: {', '.join(configured)}")
        else:
            logger.warning("[SocialPoster] No platforms configured — check credentials in .env or data/settings.json")

    def configured_platforms(self) -> list[str]:
        """Unique platform names that have valid credentials."""
        return sorted({p.platform for p in self._posters.values()})

    async def _post_one(
        self,
        item: QueueItem,
        counts: dict[str, int],
        lock: asyncio.Lock,
    ) -> None:
        """Post a single queue item and update shared counts under lock."""
        poster = self._posters.get(item.platform)

        if not poster:
            logger.warning(
                f"[SocialPoster] Platform '{item.platform}' not configured "
                f"(item #{item.id}) — skipping"
            )
            _write_result(item.id, "skipped",
                          {"error": f"Platform '{item.platform}' not configured"})
            async with lock:
                counts["skipped"] += 1
            return

        preview = item.text[:70].replace("\n", " ")
        logger.info(f"[SocialPoster] → #{item.id} {item.platform.upper()} | {preview}…")

        if self.cfg.dry_run:
            logger.info(f"[SocialPoster] [DRY RUN] Skipping real API call for #{item.id}")
            _write_result(item.id, "dry_run", {"dry_run": True, "platform": item.platform})
            async with lock:
                counts["posted"] += 1
            return

        try:
            result = await poster.post(item)
        except Exception as exc:
            logger.exception(f"[SocialPoster] ✗ #{item.id} exception: {exc}")
            _write_result(item.id, "failed", {"error": str(exc)})
            async with lock:
                counts["failed"] += 1
            return

        if result.get("success"):
            logger.success(
                f"[SocialPoster] ✓ #{item.id} posted — "
                f"id={result.get('post_id', '')} url={result.get('url', '')}"
            )
            _write_result(item.id, "posted", result)
            async with lock:
                counts["posted"] += 1
        else:
            logger.error(
                f"[SocialPoster] ✗ #{item.id} failed — {result.get('error', 'unknown')}"
            )
            _write_result(item.id, "failed", result)
            async with lock:
                counts["failed"] += 1

    async def run_once(self) -> dict[str, int]:
        """
        Fetch all due posts and send them in parallel (up to 5 at a time).
        Returns {"posted": n, "skipped": n, "failed": n}.
        """
        # Ensure locked_at column exists (no-op after first run)
        _ensure_locked_at_column()
        # Release any rows stuck in 'processing' from a previous crashed run
        _release_stale_locks()

        items = fetch_due_posts(self.cfg)
        counts: dict[str, int] = {"posted": 0, "skipped": 0, "failed": 0}

        if not items:
            logger.debug("[SocialPoster] Queue empty — nothing due")
            return counts

        logger.info(f"[SocialPoster] Processing {len(items)} due post(s) (parallel, max 5)")

        # _write_result() opens a fresh sqlite3 connection per call, so concurrent
        # DB writes are safe without an additional lock.
        sem = asyncio.Semaphore(5)
        lock = asyncio.Lock()  # guards shared counts dict

        async def _bounded(item: QueueItem) -> None:
            async with sem:
                await self._post_one(item, counts, lock)

        await asyncio.gather(*[_bounded(i) for i in items])

        logger.info(
            f"[SocialPoster] Flush complete — "
            f"posted={counts['posted']} skipped={counts['skipped']} failed={counts['failed']}"
        )
        return counts

    async def run_daemon(self) -> None:
        """
        Loop forever, flushing the queue every cfg.interval_minutes.
        Uses APScheduler if available, otherwise plain asyncio sleep.
        """
        if HAS_SCHEDULER:
            scheduler = AsyncIOScheduler(timezone=self.cfg.tz)
            scheduler.add_job(
                self.run_once,
                trigger="interval",
                minutes=self.cfg.interval_minutes,
                id="social_poster_flush",
                name="Social Poster Queue Flush",
                next_run_time=datetime.now(),  # fire immediately on start
            )
            scheduler.start()
            logger.info(
                f"[SocialPoster] Daemon started (APScheduler) — "
                f"every {self.cfg.interval_minutes}m  TZ={self.cfg.tz}"
            )
            try:
                await asyncio.Event().wait()
            except (KeyboardInterrupt, SystemExit):
                scheduler.shutdown()
                logger.info("[SocialPoster] Shutdown complete")
        else:
            logger.info(
                f"[SocialPoster] Daemon started (asyncio loop) — "
                f"every {self.cfg.interval_minutes}m  TZ={self.cfg.tz}"
            )
            while True:
                await self.run_once()
                await asyncio.sleep(self.cfg.interval_minutes * 60)


# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw integration hook
# ─────────────────────────────────────────────────────────────────────────────

def setup_social_poster(openclaw: Any, scheduler: Any) -> "SocialPoster":
    """
    Register this poster with an existing APScheduler/OpenClaw scheduler.
    Replaces (or complements) the legacy social_scheduler.py hook.

    Usage in orchestrator startup:
        from workflows.social_poster import setup_social_poster
        poster = setup_social_poster(openclaw, scheduler)

    The poster runs directly against the DB — it does NOT submit tasks
    through OpenClaw, so it works even when the orchestrator is bypassed.
    """
    cfg    = PosterConfig.from_env()
    poster = SocialPoster(cfg)

    if HAS_SCHEDULER and hasattr(scheduler, "add_job"):
        scheduler.add_job(
            poster.run_once,
            trigger="interval",
            minutes=cfg.interval_minutes,
            id="social_poster_direct",
            name="Social Poster Direct (standalone)",
            replace_existing=True,
        )
        logger.info(
            f"[SocialPoster] Registered with orchestrator scheduler "
            f"(every {cfg.interval_minutes}m)"
        )

    return poster


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
        logger.add(
            log_file,
            rotation="10 MB",
            retention="14 days",
            level="DEBUG",
            format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}",
        )


async def _main(args: argparse.Namespace) -> None:
    cfg = PosterConfig.from_env()

    # Apply CLI overrides
    if args.tz:
        cfg.tz = args.tz
    if args.interval:
        cfg.interval_minutes = args.interval
    if args.limit:
        cfg.limit = args.limit
    if args.dry_run:
        cfg.dry_run = True
    if args.platform:
        cfg.platforms = [p.strip().lower() for p in args.platform.split(",")]

    # --status: show queue summary then exit
    if args.status:
        summary = queue_status_summary()
        if not summary:
            logger.info("[SocialPoster] Queue is empty or DB not found")
        else:
            total = sum(summary.values())
            logger.info(f"[SocialPoster] Queue summary (total={total})")
            for status, count in sorted(summary.items()):
                logger.info(f"  {status:<12} {count}")
        return

    # --health: validate all configured platform credentials then exit
    if args.health:
        cfg_health = PosterConfig.from_env()
        seen: set[type] = set()
        adapters: list[PlatformPoster] = []
        for cls in PLATFORM_REGISTRY.values():
            if cls not in seen:
                seen.add(cls)
                adapters.append(cls(cfg_health))

        print("\nAutonomous Prime — credential health check\n")
        results = await asyncio.gather(*[a.health_check() for a in adapters])
        all_ok = True
        for res in results:
            icon = "✓" if res["ok"] else "✗"
            label = f"{res['platform']:<16}"
            print(f"  {icon}  {label}  {res['detail']}")
            if not res["ok"]:
                all_ok = False
        print()
        sys.exit(0 if all_ok else 1)

    # --analytics: run the analytics poller and exit
    if args.analytics:
        from workflows.social_analytics import run_analytics, run_analytics_daemon, AnalyticsConfig
        analytics_cfg = AnalyticsConfig.from_env()
        if args.platform:
            analytics_cfg.platforms = [p.strip().lower() for p in args.platform.split(",")]
        if args.once:
            result = await run_analytics(analytics_cfg)
            logger.info(
                f"[Analytics] Done — fetched={result['fetched']} "
                f"skipped={result['skipped']} failed={result['failed']}"
            )
        else:
            await run_analytics_daemon(analytics_cfg)
        return

    poster = SocialPoster(cfg)

    if args.once:
        await poster.run_once()
    else:
        await poster.run_daemon()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Autonomous Prime — Standalone Social Media Poster",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python workflows/social_poster.py                       Run as daemon (every 15 min)
  python workflows/social_poster.py --once                Flush queue once and exit
  python workflows/social_poster.py --dry-run --once      Simulate — no real API calls
  python workflows/social_poster.py --platform twitter,linkedin --once
  python workflows/social_poster.py --tz US/Eastern --interval 30
  python workflows/social_poster.py --status              Show queue counts and exit
  python workflows/social_poster.py --log-file poster.log --interval 60
  python workflows/social_poster.py --analytics --once    Fetch analytics once and exit
  python workflows/social_poster.py --analytics           Run analytics daemon (every 24h)

Config:
  Set credentials in .env or data/settings.json under the platform key.
  e.g. data/settings.json:  {"twitter": {"api_key": "...", ...}}
        """,
    )
    parser.add_argument("--once",      action="store_true", help="Process queue once and exit")
    parser.add_argument("--dry-run",   action="store_true", help="Simulate posts, no real API calls")
    parser.add_argument("--status",    action="store_true", help="Print queue status summary and exit")
    parser.add_argument("--health",    action="store_true", help="Check credentials for all configured platforms and exit")
    parser.add_argument("--analytics", action="store_true", help="Run analytics poller (use --once to run once)")
    parser.add_argument("--platform",  default="",          help="Comma-separated platform filter")
    parser.add_argument("--tz",        default="",          help="Timezone  (e.g. US/Eastern, Asia/Tokyo)")
    parser.add_argument("--interval",  type=int, default=0, help="Flush interval in minutes (default: 15)")
    parser.add_argument("--limit",     type=int, default=0, help="Max posts per flush (default: 20)")
    parser.add_argument("--log-file",  default="",          help="Append logs to this file")

    parsed = parser.parse_args()
    _setup_logging(parsed.log_file or None)
    asyncio.run(_main(parsed))
