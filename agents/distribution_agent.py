"""
Distribution Agent — WordPress publishing (SEO meta, Yoast/RankMath, categories, links)
+ Social media scheduling + Revenue tracking
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup
from loguru import logger
from slugify import slugify

from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import as_bool, get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent


class DistributionAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("distribution_agent", llm, max_concurrent=3)
        # Prefer runtime settings.json; fall back to env vars only if needed.
        self._wp_url = get_setting("wordpress", "url", os.getenv("WP_URL", "")).rstrip("/")
        self._wp_user = get_setting("wordpress", "username", os.getenv("WP_USER", ""))
        self._wp_pass = get_setting("wordpress", "app_password", os.getenv("WP_APP_PASSWORD", ""))
        self._outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        self._data_dir  = Path(os.getenv("DATA_DIR", "./data"))
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._outputs_dir.mkdir(parents=True, exist_ok=True)
        self._db_path   = self._data_dir / "revenue.db"
        self._init_db()

    def skill_summary(self) -> dict:
        return {
            "name": "DistributionAgent",
            "capabilities": [
                "post_content", "social_post", "distribute_post",
                "financial_report", "video_publish", "seo_track",
            ],
            "description": "Publishes to WordPress, distributes approved social content, uploads finished videos, tracks revenue and SEO rankings",
            "channels": ["wordpress", "x", "facebook", "facebook_groups", "linkedin", "instagram_posts", "youtube", "tiktok", "instagram", "reddit", "threads"],
            "skills_loaded": len(self.skill_inventory()),
            "profile_dir": str(self._profile_dir),
        }

    def refresh_settings(self) -> None:
        # Runtime settings (Settings → Publishing (WordPress)) take precedence over env.
        self._wp_url = get_setting("wordpress", "url", os.getenv("WP_URL", self._wp_url)).rstrip("/")
        self._wp_user = get_setting("wordpress", "username", os.getenv("WP_USER", self._wp_user))
        self._wp_pass = get_setting("wordpress", "app_password", os.getenv("WP_APP_PASSWORD", self._wp_pass))

    def _init_db(self) -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS revenue_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            currency TEXT DEFAULT 'USD',
            description TEXT,
            metadata TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            post_id TEXT,
            topic TEXT,
            title TEXT,
            url TEXT,
            slug TEXT,
            status TEXT,
            seo_score INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS seo_rankings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            url TEXT,
            position INTEGER,
            checked_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS social_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            text TEXT NOT NULL,
            scheduled_at TEXT,
            posted_at TEXT,
            status TEXT DEFAULT 'pending',
            post_id TEXT,
            payload_json TEXT
        );
        CREATE TABLE IF NOT EXISTS publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            title TEXT,
            topic TEXT,
            video_path TEXT NOT NULL,
            payload_json TEXT,
            status TEXT DEFAULT 'pending_approval',
            approved_at TEXT,
            published_at TEXT,
            result_json TEXT
        );
        CREATE TABLE IF NOT EXISTS calendar_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            content_type TEXT NOT NULL,
            title TEXT,
            text TEXT,
            scheduled_at TEXT NOT NULL,
            posted_at TEXT,
            status TEXT DEFAULT 'scheduled',
            payload_json TEXT,
            result_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        """)
        # ── Migrate older databases missing new columns ───────────────────────
        existing = {r[1] for r in conn.execute("PRAGMA table_info(posts)")}
        for col, defn in [("title", "TEXT"), ("slug", "TEXT"), ("seo_score", "INTEGER")]:
            if col not in existing:
                conn.execute(f"ALTER TABLE posts ADD COLUMN {col} {defn}")
        social_existing = {r[1] for r in conn.execute("PRAGMA table_info(social_queue)")}
        if "payload_json" not in social_existing:
            conn.execute("ALTER TABLE social_queue ADD COLUMN payload_json TEXT")
        if "title" not in social_existing:
            conn.execute("ALTER TABLE social_queue ADD COLUMN title TEXT")
        conn.commit()
        conn.close()

    # ─────────────────────────────────────────────────────────────────────────
    async def _execute(self, task: "Task") -> dict[str, Any]:
        if task.type == "financial_report":
            return self._generate_financial_report()
        if task.type == "social_post":
            return await self._execute_social_post(task)
        if task.type == "distribute_post":
            return await self._execute_distribute_post(task)
        if task.type == "seo_track":
            return await self._execute_seo_track(task)
        if task.type == "video_publish":
            return await self._publish_video(task)
        return await self._post_content(task)

    async def _execute_distribute_post(self, task: "Task") -> dict[str, Any]:
        """
        Handle approval-gated posts from the Publishing Queue.
        Respects dispatch mode: 'immediate' posts now, 'scheduled' waits for scheduled_at,
        no dispatch defaults to immediate (post was just approved).
        Only runs if the post has been approved upstream.
        """
        dispatch     = str(task.payload.get("dispatch", "immediate")).strip()
        scheduled_at = str(task.payload.get("scheduled_at", "") or "").strip()
        platform     = str(task.payload.get("platform", "x")).strip()
        text         = str(task.payload.get("text", "") or task.payload.get("caption", "")).strip()
        topic        = str(task.payload.get("topic", text[:80]) or text[:80]).strip()
        approval_id  = task.payload.get("approval_id")
        kind         = str(task.payload.get("kind", "social")).strip()

        # For scheduled dispatch, check if it's time yet; if not, defer
        if dispatch == "scheduled" and scheduled_at:
            try:
                scheduled_dt = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
                now = datetime.now(tz=timezone.utc)
                if now < scheduled_dt:
                    delay = (scheduled_dt - now).total_seconds()
                    logger.info(
                        f"[DistributionAgent] distribute_post deferred {delay:.0f}s "
                        f"until {scheduled_at} for platform={platform}"
                    )
                    # Re-queue with a delay so the orchestrator retries at the right time
                    await asyncio.sleep(min(delay, 60))  # re-check in ≤60s slices
                    raise RuntimeError(f"Not yet scheduled_at={scheduled_at}; will retry")
            except ValueError:
                logger.warning(f"[DistributionAgent] Invalid scheduled_at '{scheduled_at}'; posting now")

        logger.info(
            f"[DistributionAgent] distribute_post -> platform={platform} "
            f"dispatch={dispatch} approval_id={approval_id} kind={kind}"
        )

        # Build a synthetic task payload that _execute_social_post understands
        task.payload.setdefault("text", text)
        task.payload.setdefault("topic", topic)
        result = await self._execute_social_post(task)

        logger.info(
            f"[DistributionAgent] distribute_post result: "
            f"platform={platform} status={result.get('status')} approval_id={approval_id}"
        )
        return {"type": "distribute_post", "approval_id": approval_id, "kind": kind, **result}

    async def _execute_seo_track(self, task: "Task") -> dict[str, Any]:
        """
        Add a keyword to SEO tracking and immediately check its current ranking.
        Payload: { keyword: str, url: str }
        """
        from core.seo_tracker import SEOTracker
        keyword = str(task.payload.get("keyword", "")).strip()
        url     = str(task.payload.get("url", "")).strip()
        if not keyword:
            return {"type": "seo_track", "status": "skipped", "reason": "no keyword provided"}
        tracker = SEOTracker(db_path=self._db_path)
        tracker.add_keyword(keyword, url)
        results = await tracker.check_rankings(keywords=[keyword])
        position = results[0].get("position") if results else None
        logger.info(f"[DistributionAgent] seo_track keyword='{keyword}' url='{url}' position={position}")
        return {
            "type": "seo_track",
            "keyword": keyword,
            "url": url,
            "position": position,
            "status": "tracked",
        }

    # ─────────────────────────── WordPress ───────────────────────────────────

    async def _post_content(self, task: "Task") -> dict[str, Any]:
        topic        = task.payload.get("topic", "")
        calendar_entry_id = task.payload.get("calendar_entry_id")
        blog_path    = task.payload.get("blog_filepath") or task.payload.get("filepath", "")
        image_path   = task.payload.get("image_filepath", "")
        title        = task.payload.get("title", topic)
        slug         = task.payload.get("slug", "")
        meta_desc    = task.payload.get("meta_description", "")
        focus_kw     = task.payload.get("focus_keyword", "")
        category_name= task.payload.get("category", "AI Content")
        tags         = task.payload.get("tags", [])
        schema_type  = task.payload.get("schema_type", "Article")
        excerpt      = task.payload.get("excerpt", "")
        seo_json_path= task.payload.get("seo_json_path", "")
        image_filename = task.payload.get("image_filename", "")
        # Capture page URL — social posts drive traffic here instead of just the blog
        ip = task.payload.get("input_payload", {}) or {}
        capture_page_url = task.payload.get("cta_url") or ip.get("cta_url", "")

        # Load seo.json if available
        if seo_json_path and Path(seo_json_path).exists():
            seo = json.loads(Path(seo_json_path).read_text(encoding="utf-8"))
            title      = seo.get("title", title)
            slug       = seo.get("slug", slug)
            meta_desc  = seo.get("meta_description", meta_desc)
            focus_kw   = seo.get("focus_keyword", focus_kw)
            tags       = seo.get("tags", tags)
            category_name = seo.get("category", category_name)
            schema_type   = seo.get("schema_type", schema_type)
            excerpt    = seo.get("excerpt", excerpt)

        if not blog_path or not Path(blog_path).exists():
            result = {"status": "skipped", "reason": "No blog file"}
            if calendar_entry_id:
                self.update_calendar_entry_status(int(calendar_entry_id), "failed", result)
            return result

        raw_md = Path(blog_path).read_text(encoding="utf-8")
        # Strip YAML frontmatter; convert placeholder links
        html_content = self._md_to_wp_html(raw_md)
        html_content = self._ensure_image_alt_text(html_content, focus_kw or title)

        results: dict[str, Any] = {"type": "distribution", "topic": topic}

        if self._wp_url and self._wp_user and self._wp_pass:
            wp_result: dict[str, Any] = {}
            last_wp_error: str = ""
            for wp_attempt in range(3):
                try:
                    wp_result = await self._wp_publish(
                        title=title,
                        html_content=html_content,
                        slug=slug,
                        excerpt=excerpt,
                        meta_description=meta_desc,
                        focus_keyword=focus_kw,
                        category_name=category_name,
                        tags=tags,
                        schema_type=schema_type,
                        image_path=image_path,
                        image_filename=image_filename,
                    )
                    last_wp_error = ""
                    break
                except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                    last_wp_error = f"Network error (attempt {wp_attempt + 1}/3): {e}"
                    logger.warning(f"[DistributionAgent] WP network error, retrying: {e}")
                    if wp_attempt < 2:
                        await asyncio.sleep(2 ** wp_attempt)
                except Exception as e:
                    last_wp_error = str(e)
                    logger.error(f"[DistributionAgent] WP publish failed: {e}")
                    break  # Non-network errors don't benefit from retry
            if wp_result.get("id"):
                results["wordpress"] = wp_result
                results["wordpress"]["retry_attempts"] = wp_attempt
                seo_score = self._estimate_seo_score(focus_kw, html_content, meta_desc)
                self._log_post(
                    "wordpress",
                    wp_result.get("id"),
                    topic,
                    title,
                    slug,
                    wp_result.get("link"),
                    seo_score,
                    status=wp_result.get("status", "draft"),
                )
            else:
                results["wordpress"] = {
                    "error": last_wp_error or "WordPress publish failed",
                    "retry_attempts": wp_attempt,
                    "wp_url": self._wp_url,
                    "hint": "Check WP_URL, WP_USER, and WP_APP_PASSWORD in your .env file",
                }
        else:
            logger.warning("[DistributionAgent] WordPress not configured — skipping publish")
            results["wordpress"] = {"status": "skipped", "reason": "Not configured"}

        wp_url = results.get("wordpress", {}).get("link", "")
        # Prefer capture page URL — that's what we want people to visit
        social_url = capture_page_url or wp_url
        social_posts = await self._generate_social_posts(
            title=title,
            excerpt=excerpt or meta_desc,
            content=html_content[:2000],
            keyword=focus_kw,
            url=social_url,
            capture_page_url=capture_page_url,
        )
        social_images = self._build_social_images(
            topic=topic,
            title=title,
            excerpt=excerpt or meta_desc,
            base_image_path=image_path,
        )
        results["social_posts"] = social_posts
        results["social_images"] = social_images
        results["distribution_package"] = {
            "topic": topic,
            "title": title,
            "slug": slug,
            "focus_keyword": focus_kw,
            "meta_description": meta_desc,
            "excerpt": excerpt or meta_desc,
            "tags": tags,
            "schema_type": schema_type,
            "wordpress_url": results.get("wordpress", {}).get("link", ""),
            "wordpress_status": results.get("wordpress", {}).get("status", ""),
            "social_posts": social_posts,
            "social_images": social_images,
        }
        for platform, text in social_posts.items():
            if text:
                self._queue_social_post(
                    platform,
                    text,
                    topic,
                    payload={
                        "topic": topic,
                        "title": title,
                        "post_url": results.get("wordpress", {}).get("link", ""),
                        "excerpt": excerpt or meta_desc,
                        "image_path": social_images.get(platform, ""),
                        "hero_image_path": image_path,
                    },
                )

        if calendar_entry_id:
            wordpress = results.get("wordpress", {}) if isinstance(results.get("wordpress"), dict) else {}
            final_status = "posted" if wordpress.get("link") else ("blocked_config" if wordpress.get("status") == "skipped" else "failed")
            self.update_calendar_entry_status(int(calendar_entry_id), final_status, results)
        return results

    async def _wp_publish(
        self,
        title: str, html_content: str, slug: str, excerpt: str,
        meta_description: str, focus_keyword: str, category_name: str,
        tags: list, schema_type: str, image_path: str, image_filename: str = "",
    ) -> dict:
        token = base64.b64encode(f"{self._wp_user}:{self._wp_pass}".encode()).decode()
        headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}

        # Resolve against existing site categories only. Do not create new categories.
        cat_id = await self._wp_resolve_category_id(category_name, headers)

        # Resolve / create tags
        tag_ids = []
        for tag in tags[:10]:
            tid = await self._wp_get_or_create_term("tags", tag, headers)
            if tid:
                tag_ids.append(tid)

        # Upload featured image
        media: dict[str, Any] | None = None
        if image_path and Path(image_path).exists():
            media = await self._wp_upload_media(
                image_path=image_path,
                title=title,
                headers=headers,
                alt_text=focus_keyword or title,
            )
        media_id = media.get("id") if media else None
        media_url = media.get("source_url", "") if media else ""
        html_content = self._inject_feature_image(html_content, media_url, title) if media_url else html_content

        # Build post payload
        seo_meta_payload = {
            # Yoast SEO fields
            "_yoast_wpseo_title": title,
            "_yoast_wpseo_metadesc": meta_description,
            "_yoast_wpseo_focuskw": focus_keyword,
            "_yoast_wpseo_schema_article_type": schema_type,
            # RankMath fields (fallback)
            "rank_math_title": title,
            "rank_math_description": meta_description,
            "rank_math_focus_keyword": focus_keyword,
        }

        payload: dict[str, Any] = {
            "title":          title,
            "content":        html_content,
            "status":         "draft",
            "slug":           slug or None,
            "excerpt":        excerpt,
            "categories":     [cat_id] if cat_id else [],
            "tags":           tag_ids,
            "comment_status": "open",
        }

        async with httpx.AsyncClient(timeout=60) as client:
            create_url = f"{self._wp_url}/wp-json/wp/v2/posts"
            try:
                resp = await client.post(
                    create_url,
                    headers=headers,
                    json={**payload, "meta": seo_meta_payload},
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code if exc.response is not None else 0
                detail = exc.response.text[:400] if exc.response is not None else str(exc)
                # 401/403 is always a permissions issue — retrying won't help.
                if status_code in (401, 403):
                    raise RuntimeError(
                        f"WordPress post create failed (HTTP {status_code}): user '{self._wp_user}' "
                        f"does not have permission to create posts. "
                        f"Check: (1) the WP user has Author/Editor/Administrator role, "
                        f"(2) the Application Password was generated for this user in WP Admin → Users → Profile. "
                        f"Raw: {detail}"
                    ) from exc
                logger.warning(
                    "[DistributionAgent] WordPress post create rejected SEO meta, "
                    f"retrying without meta: {detail}"
                )
                resp = await client.post(
                    create_url,
                    headers=headers,
                    json=payload,
                )
                try:
                    resp.raise_for_status()
                except httpx.HTTPStatusError as retry_exc:
                    retry_detail = retry_exc.response.text[:400] if retry_exc.response is not None else str(retry_exc)
                    raise RuntimeError(f"WordPress post create failed: {retry_detail}") from retry_exc
            data = resp.json()

        post_id = data.get("id")
        if post_id:
            if media_id:
                await self._wp_attach_media_to_post(media_id, post_id, headers)
                data = await self._wp_update_post(post_id, {"featured_media": media_id}, headers)
            await self._wp_update_seo_meta(
                post_id=post_id,
                headers=headers,
                title=title,
                slug=slug,
                excerpt=excerpt,
                meta_description=meta_description,
                focus_keyword=focus_keyword,
                schema_type=schema_type,
            )

        logger.success(f"[DistributionAgent] WP draft created: {data.get('link')}")
        return {
            "id": data.get("id"),
            "link": data.get("link"),
            "status": data.get("status", "draft"),
            "featured_media": media_id,
            "image_url": media_url,
            "image_filename": image_filename or (Path(image_path).name if image_path else ""),
        }

    async def _wp_update_seo_meta(
        self,
        post_id: int,
        headers: dict[str, str],
        title: str,
        slug: str,
        excerpt: str,
        meta_description: str,
        focus_keyword: str,
        schema_type: str,
    ) -> None:
        yoast_rank_math_meta = {
            "_yoast_wpseo_title": title,
            "_yoast_wpseo_metadesc": meta_description,
            "_yoast_wpseo_focuskw": focus_keyword,
            "_yoast_wpseo_schema_article_type": schema_type,
            "rank_math_title": title,
            "rank_math_description": meta_description,
            "rank_math_focus_keyword": focus_keyword,
            "_aioseo_title": title,
            "_aioseo_description": meta_description,
            "_aioseo_keywords": focus_keyword,
            "aioseo_title": title,
            "aioseo_description": meta_description,
            "aioseo_keywords": focus_keyword,
        }
        aioseo_meta_data: dict[str, Any] = {
            "title": title,
            "description": meta_description,
            "og_title": title,
            "og_description": meta_description,
            "twitter_title": title,
            "twitter_description": meta_description,
        }
        if focus_keyword:
            aioseo_meta_data["focus_keyword"] = focus_keyword
            aioseo_meta_data["keywords"] = focus_keyword
            aioseo_meta_data["keyphrases"] = json.dumps({
                "focus": {"keyphrase": focus_keyword},
                "additional": [],
            })

        payloads = [
            {"slug": slug or None, "excerpt": excerpt, "meta": yoast_rank_math_meta},
            {"slug": slug or None, "excerpt": excerpt, "meta": yoast_rank_math_meta, "aioseo_meta_data": aioseo_meta_data},
            {
                "slug": slug or None,
                "excerpt": excerpt,
                "meta": yoast_rank_math_meta,
                "aioseo_title": title,
                "aioseo_description": meta_description,
                "aioseo_keywords": focus_keyword,
                "aioseo_meta_data": aioseo_meta_data,
            },
        ]

        updated = False
        last_error: Exception | None = None
        try:
            for payload in payloads:
                try:
                    await self._wp_update_post(post_id, payload, headers)
                    updated = True
                except Exception as exc:
                    last_error = exc
            if updated:
                logger.success(f"[DistributionAgent] SEO meta updated for post {post_id}")
                return
        except Exception as exc:
            last_error = exc

        if last_error:
            logger.warning(
                "[DistributionAgent] SEO meta update skipped or failed for "
                f"post {post_id}: {last_error}"
            )

    async def _wp_get_or_create_term(self, endpoint: str, name: str, headers: dict) -> int | None:
        """Get existing WP term by name or create it, return term ID."""
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(
                    f"{self._wp_url}/wp-json/wp/v2/{endpoint}",
                    headers=headers, params={"search": name, "per_page": 5},
                )
                r.raise_for_status()
                matches = [t for t in r.json() if t["name"].lower() == name.lower()]
                if matches:
                    return matches[0]["id"]
                # Some hosts (LiteSpeed/WAF) block term creation via REST (403) even for admins.
                # In that case, skip creating the term instead of failing the whole publish.
                try:
                    cr = await client.post(
                        f"{self._wp_url}/wp-json/wp/v2/{endpoint}",
                        headers=headers, json={"name": name},
                    )
                    cr.raise_for_status()
                    return cr.json().get("id")
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code if exc.response is not None else None
                    if status in {401, 403}:
                        logger.warning(
                            f"[DistributionAgent] Term '{name}' creation blocked (status={status}) "
                            f"at endpoint '{endpoint}'. Skipping term create."
                        )
                        return None
                    raise
        except Exception as e:
            logger.warning(f"[DistributionAgent] Term '{name}' error: {e}")
            return None

    async def _wp_get_existing_term(self, endpoint: str, name: str, headers: dict) -> dict[str, Any] | None:
        if not name:
            return None
        try:
            search_value = name.strip()
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    f"{self._wp_url}/wp-json/wp/v2/{endpoint}",
                    headers=headers,
                    params={"search": search_value, "per_page": 20},
                )
                response.raise_for_status()
                terms = response.json()
        except Exception as exc:
            logger.warning(f"[DistributionAgent] Existing term lookup failed for '{name}': {exc}")
            return None

        target_slug = slugify(search_value)
        for term in terms:
            term_name = str(term.get("name", "")).strip().lower()
            term_slug = str(term.get("slug", "")).strip().lower()
            if term_name == search_value.lower() or term_slug == target_slug:
                return term
        return None

    def _wp_category_map(self) -> dict[str, str]:
        raw = str(get_setting("wordpress", "category_map", "") or "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return {str(k).strip().lower(): str(v).strip() for k, v in parsed.items() if str(v).strip()}
        except Exception:
            pass

        mapped: dict[str, str] = {}
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                source, target = line.split("=", 1)
            elif "->" in line:
                source, target = line.split("->", 1)
            elif ":" in line:
                source, target = line.split(":", 1)
            else:
                continue
            source = source.strip().lower()
            target = target.strip()
            if source and target:
                mapped[source] = target
        return mapped

    async def _wp_resolve_category_id(self, generated_category: str, headers: dict[str, str]) -> int | None:
        desired = (generated_category or "").strip()
        fallback = str(get_setting("wordpress", "default_category", "Uncategorized") or "Uncategorized").strip()
        mapped_target = self._wp_category_map().get(desired.lower(), "")

        candidates: list[str] = []
        for value in (mapped_target, desired, fallback):
            cleaned = value.strip()
            if cleaned and cleaned not in candidates:
                candidates.append(cleaned)

        for candidate in candidates:
            term = await self._wp_get_existing_term("categories", candidate, headers)
            if term and term.get("id"):
                if candidate != desired:
                    logger.info(
                        f"[DistributionAgent] Using existing WordPress category '{term.get('name')}' "
                        f"for generated category '{desired or 'n/a'}'"
                    )
                return int(term["id"])

        logger.warning(
            "[DistributionAgent] No matching existing WordPress category found for "
            f"'{desired or 'n/a'}'. Post will be created without a category."
        )
        return None

    async def _wp_upload_media(
        self,
        image_path: str,
        title: str,
        headers: dict,
        alt_text: str = "",
    ) -> dict[str, Any] | None:
        try:
            img_bytes = Path(image_path).read_bytes()
            fname = Path(image_path).name
            ext = Path(image_path).suffix.lower()
            ct_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                      ".png": "image/png", ".webp": "image/webp"}
            content_type = ct_map.get(ext, "image/png")
            # HTTP headers must be ASCII — strip/replace any curly quotes or
            # other Unicode that comes from LLM-generated titles.
            safe_title = title.encode("ascii", errors="replace").decode("ascii")
            safe_fname = fname.encode("ascii", errors="replace").decode("ascii")
            media_headers = {
                **headers,
                "Content-Disposition": f'attachment; filename="{safe_fname}"',
                "Content-Type": content_type,
                "title": safe_title,
            }
            media_headers.pop("Content-Type", None)
            media_headers["Content-Type"] = content_type
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"{self._wp_url}/wp-json/wp/v2/media",
                    headers=media_headers, content=img_bytes,
                )
                r.raise_for_status()
                media = r.json()
                media_id = media.get("id")
                if media_id:
                    media_slug = self._build_image_slug(title, image_path)
                    try:
                        await self._wp_update_media(
                            media_id,
                            {
                                "title": title,
                                "slug": media_slug,
                                "alt_text": alt_text or title,
                                "caption": "",
                                "description": title,
                            },
                            headers,
                        )
                    except Exception as exc:
                        logger.warning(f"[DistributionAgent] Media meta update failed for {media_id}: {exc}")
                return media
        except Exception as e:
            logger.warning(f"[DistributionAgent] Media upload failed: {e}")
            return None

    async def _wp_update_post(self, post_id: int, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        cleaned_payload = {k: v for k, v in payload.items() if v is not None}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self._wp_url}/wp-json/wp/v2/posts/{post_id}",
                headers=headers,
                json=cleaned_payload,
            )
            response.raise_for_status()
            return response.json()

    async def _wp_update_media(self, media_id: int, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        cleaned_payload = {k: v for k, v in payload.items() if v is not None}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self._wp_url}/wp-json/wp/v2/media/{media_id}",
                headers=headers,
                json=cleaned_payload,
            )
            response.raise_for_status()
            return response.json()

    async def _wp_attach_media_to_post(self, media_id: int, post_id: int, headers: dict[str, str]) -> None:
        await self._wp_update_media(media_id, {"post": post_id}, headers)

    # ─────────────────────────── Social Media ────────────────────────────────

    async def _execute_social_post(self, task: "Task") -> dict[str, Any]:
        text     = task.payload.get("text", "")
        platform = task.payload.get("platform", "x")
        topic    = task.payload.get("topic", "")
        keywords = task.payload.get("keywords", [])
        capture_page_url = task.payload.get("cta_url", "")
        link     = capture_page_url or task.payload.get("url", "") or task.payload.get("post_url", "")
        media_url = task.payload.get("media_url", "")
        queue_id = task.payload.get("queue_id")
        calendar_entry_id = task.payload.get("calendar_entry_id")

        # If no pre-written text, generate social copy from topic + capture page
        if not text and topic:
            logger.info(f"[DistributionAgent] Generating social copy for: {topic}")
            posts = await self._generate_social_posts(
                title=topic,
                excerpt=", ".join(keywords) if keywords else topic,
                content="",
                keyword=keywords[0] if keywords else topic,
                url=link,
                capture_page_url=capture_page_url,
            )
            # Queue all platforms and return the package
            for plt, plt_text in posts.items():
                if plt_text:
                    self._queue_social_post(plt, plt_text, topic, {"topic": topic, "cta_url": capture_page_url})
            return {"type": "social_package", "topic": topic, "posts": posts, "capture_page_url": capture_page_url}

        logger.info(f"[DistributionAgent] Social post -> {platform}: {text[:80]}")
        result = await self._post_to_social_platform(platform, text, topic, link=link, media_url=media_url)
        if result.get("status") == "posted":
            self._mark_social_post_status(platform, text, queue_id)
            self._log_post(platform, result.get("post_id"), topic, topic, "", result.get("url", link), 0)
        if calendar_entry_id:
            status = "posted" if result.get("status") == "posted" else ("blocked_config" if result.get("status") == "skipped" else "failed")
            self.update_calendar_entry_status(int(calendar_entry_id), status, result)
        return {"type": "social", "platform": platform, "text": text, **result}

    async def _generate_social_posts(
        self,
        title: str,
        excerpt: str,
        content: str,
        keyword: str,
        url: str,
        capture_page_url: str = "",
    ) -> dict[str, str]:
        capture_line = (
            f"Free guide landing page (PRIMARY CTA — drive people here): {capture_page_url}\n"
            if capture_page_url else ""
        )
        prompt_template = get_prompt_override(
            "distribution_social_prompt",
            """Write platform-specific social promo copy for this blog post.
The goal is to drive traffic to the FREE GUIDE capture page — every post should tease the content and push people to claim the free guide.

Title: {{title}}
Keyword: {{keyword}}
Excerpt: {{excerpt}}
Content excerpt: {{content_excerpt}}
{capture_line}Blog URL (secondary — use only if no capture page): {{url}}

Return ONLY valid JSON with keys:
- x: max 280 chars, sharp hook, tease the free guide, include capture page URL
- facebook: 2 short paragraphs — hook the pain, offer the free guide as the solution, include capture page URL
- facebook_groups: organic community-style post, share insight from the article, soft CTA to the free guide
- linkedin: professional post with 3-5 bullet points from the article, CTA to download the free guide
- instagram_posts: punchy caption with hook, tease the free guide, 5-8 hashtags
- reddit: sounds like a genuine community member sharing useful info, subtle mention of the free resource
- threads: short punchy post, conversational, mention the free guide

{{skill_context}}""".format(capture_line=capture_line),
        )
        prompt = prompt_template.format(
            title=title,
            keyword=keyword,
            excerpt=excerpt,
            content_excerpt=content[:300],
            url=url,
            skill_context=self.skill_context("social_post"),
        )
        data = await self.llm.complete_json(
            prompt,
            system=compose_system_prompt("You are creating platform-specific promotional distribution copy."),
            use_local=True,
        )
        return {
            "x": str(data.get("x", "")).strip(),
            "facebook": str(data.get("facebook", "")).strip(),
            "facebook_groups": str(data.get("facebook_groups", "")).strip(),
            "linkedin": str(data.get("linkedin", "")).strip(),
            "instagram_posts": str(data.get("instagram_posts", "")).strip(),
            "reddit": str(data.get("reddit", "")).strip(),
            "threads": str(data.get("threads", "")).strip(),
        }

    async def _post_to_social_platform(
        self,
        platform: str,
        text: str,
        topic: str,
        link: str = "",
        media_url: str = "",
    ) -> dict[str, Any]:
        # Twitter/X uses native API v2 — bypass the generic webhook path
        if platform in ("x", "twitter"):
            if not as_bool(get_setting("x", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_twitter(text=text, image_path=media_url)

        # LinkedIn uses native UGC Posts API v2 — bypass the generic webhook path
        if platform == "linkedin":
            if not as_bool(get_setting("linkedin", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_linkedin(text=text, image_path=media_url)

        # Facebook Page — native Graph API
        if platform == "facebook":
            if not as_bool(get_setting("facebook", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_facebook(text=text, link=link, image_path=media_url)

        # Facebook Groups — native Graph API
        if platform == "facebook_groups":
            if not as_bool(get_setting("facebook_groups", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_facebook_group(text=text, link=link, image_path=media_url)

        # Instagram — native Graph API (Business/Creator account required)
        if platform in ("instagram", "instagram_posts"):
            cfg_key = "instagram_posts" if platform == "instagram_posts" else "instagram"
            if not as_bool(get_setting(cfg_key, "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            media_type = str(get_setting(cfg_key, "media_type", "IMAGE")).upper()
            return await self._post_to_instagram(text=text, image_path=media_url, media_type=media_type)

        # TikTok — Content Posting API
        if platform == "tiktok":
            if not as_bool(get_setting("tiktok", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_tiktok(text=text, video_path=media_url)

        # YouTube — Data API v3 video upload
        if platform == "youtube":
            if not as_bool(get_setting("youtube", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_youtube(title=topic, description=text, video_path=media_url)

        # Reddit — OAuth2 Script API
        if platform == "reddit":
            if not as_bool(get_setting("reddit", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_reddit(title=text, link=link, selftext=topic)

        # Threads — Meta Threads Graph API
        if platform == "threads":
            if not as_bool(get_setting("threads", "enabled", "false")):
                return {"status": "skipped", "reason": "disabled in settings"}
            return await self._post_to_threads(text=text, link=link, image_path=media_url)

        return {"status": "skipped", "reason": f"unknown platform: {platform}"}

    async def _post_to_twitter(self, text: str, image_path: str = "") -> dict[str, Any]:
        """Post a tweet via Twitter API v2 (POST /2/tweets).

        Credentials are read from settings key x.twitter_bearer_token (env: TWITTER_BEARER_TOKEN).
        This is the OAuth 2.0 user access token — stored as a Bearer token in the
        Authorization header.  App-only tokens cannot create tweets; ensure the stored
        token was obtained via the OAuth 2.0 Authorization Code + PKCE flow.

        Media is uploaded first via the v1.1 media upload endpoint
        (https://upload.twitter.com/1.1/media/upload.json), which is the only
        upload surface available as of Twitter API v2.
        """
        bearer_token = str(
            os.getenv("TWITTER_BEARER_TOKEN")
            or get_setting("x", "twitter_bearer_token", "")
        ).strip()
        if not bearer_token or "****" in bearer_token:
            return {"status": "skipped", "reason": "twitter_bearer_token not configured"}

        tweet_text = text[:280]
        headers = {
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any] = {"text": tweet_text}

        if image_path:
            try:
                media_id = await self._upload_twitter_media(bearer_token, image_path)
                if media_id:
                    body["media"] = {"media_ids": [media_id]}
            except Exception as exc:
                logger.warning(f"[DistributionAgent] Twitter media upload failed, posting without image: {exc}")

        async with httpx.AsyncClient(timeout=30) as client:
            for attempt in range(5):
                try:
                    resp = await client.post(
                        "https://api.twitter.com/2/tweets",
                        headers=headers,
                        json=body,
                    )
                    if resp.status_code == 429:
                        retry_after = int(resp.headers.get("retry-after", 0))
                        wait = retry_after if retry_after > 0 else (2 ** attempt) * 5
                        logger.warning(
                            f"[DistributionAgent] Twitter rate limited (429), "
                            f"waiting {wait}s (attempt {attempt + 1}/5)"
                        )
                        await asyncio.sleep(wait)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    tweet_id = data.get("data", {}).get("id")
                    account = str(get_setting("x", "account_id", "")).strip() or "i"
                    tweet_url = f"https://twitter.com/{account}/status/{tweet_id}" if tweet_id else ""
                    logger.success(f"[DistributionAgent] Tweet posted: {tweet_url or tweet_id}")
                    return {
                        "status": "posted",
                        "post_id": tweet_id,
                        "url": tweet_url,
                        "response": data,
                    }
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 429:
                        # Handled above via resp.status_code check; shouldn't reach here
                        wait = (2 ** attempt) * 5
                        await asyncio.sleep(wait)
                        continue
                    logger.error(f"[DistributionAgent] Twitter API error: {exc}")
                    return {"status": "error", "error": str(exc)}
                except Exception as exc:
                    logger.error(f"[DistributionAgent] Twitter post failed: {exc}")
                    return {"status": "error", "error": str(exc)}

        return {"status": "error", "error": "Twitter rate limit exceeded after 5 attempts"}

    async def _upload_twitter_media(self, bearer_token: str, image_path: str) -> str | None:
        """Upload an image to Twitter and return its media_id_string.

        Uses the v1.1 media upload endpoint — the only available upload surface.
        Handles a single 429 retry with the Retry-After header value.
        """
        path = Path(image_path)
        if not path.exists():
            logger.warning(f"[DistributionAgent] Twitter media file not found: {image_path}")
            return None

        suffix = path.suffix.lower()
        mime_type = "image/gif" if suffix == ".gif" else ("image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png")
        image_data = path.read_bytes()
        headers = {"Authorization": f"Bearer {bearer_token}"}

        async with httpx.AsyncClient(timeout=120) as client:
            for attempt in range(2):
                resp = await client.post(
                    "https://upload.twitter.com/1.1/media/upload.json",
                    headers=headers,
                    files={"media": (path.name, image_data, mime_type)},
                )
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("retry-after", 15))
                    logger.warning(
                        f"[DistributionAgent] Twitter media upload rate limited, "
                        f"waiting {retry_after}s"
                    )
                    await asyncio.sleep(retry_after)
                    continue
                resp.raise_for_status()
                media_id = str(resp.json().get("media_id_string", ""))
                logger.info(f"[DistributionAgent] Twitter media uploaded: media_id={media_id}")
                return media_id or None

        return None

    async def _post_to_linkedin(self, text: str, image_path: str = "") -> dict[str, Any]:
        """Post to LinkedIn via the UGC Posts API v2 (POST /v2/ugcPosts).

        Credentials:
          access_token — OAuth 2.0 user token (env: LINKEDIN_ACCESS_TOKEN or
                         settings linkedin.access_token)
          author_urn   — full URN of the author, e.g. urn:li:person:ABC123 or
                         urn:li:organization:123456 (settings linkedin.author_urn
                         or constructed from linkedin.author_id as a fallback)

        Images are registered and uploaded via /v2/assets?action=registerUpload
        before the post is created.
        """
        access_token = str(
            os.getenv("LINKEDIN_ACCESS_TOKEN")
            or get_setting("linkedin", "access_token", "")
        ).strip()
        author_urn = str(get_setting("linkedin", "author_urn", "") or "").strip()

        # Backward-compat: build URN from bare author_id if author_urn not set
        if not author_urn:
            author_id = str(get_setting("linkedin", "author_id", "") or "").strip()
            if author_id:
                author_urn = f"urn:li:person:{author_id}"

        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "linkedin access_token not configured"}
        if not author_urn:
            return {"status": "skipped", "reason": "linkedin author_urn not configured"}

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }

        share_content: dict[str, Any] = {
            "shareCommentary": {"text": text},
            "shareMediaCategory": "NONE",
        }

        if image_path:
            try:
                asset_urn = await self._upload_linkedin_image(access_token, author_urn, image_path)
                if asset_urn:
                    share_content["shareMediaCategory"] = "IMAGE"
                    share_content["media"] = [{"status": "READY", "media": asset_urn}]
            except Exception as exc:
                logger.warning(
                    f"[DistributionAgent] LinkedIn image upload failed, posting without image: {exc}"
                )

        body = {
            "author": author_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": share_content,
            },
            "visibility": {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.linkedin.com/v2/ugcPosts",
                    headers=headers,
                    json=body,
                )
                resp.raise_for_status()

            # LinkedIn returns the post URN in the x-restli-id response header
            post_urn = resp.headers.get("x-restli-id", "")
            # Encode the URN for use in the public share URL
            encoded = post_urn.replace(":", "%3A") if post_urn else ""
            post_url = f"https://www.linkedin.com/feed/update/{encoded}/" if encoded else ""
            logger.success(f"[DistributionAgent] LinkedIn post created: {post_url or post_urn}")
            return {
                "status": "posted",
                "post_id": post_urn,
                "url": post_url,
                "response": resp.json() if resp.content else {},
            }
        except Exception as exc:
            logger.error(f"[DistributionAgent] LinkedIn post failed: {exc}")
            return {"status": "error", "error": str(exc)}

    async def _upload_linkedin_image(
        self, access_token: str, author_urn: str, image_path: str
    ) -> str | None:
        """Register and upload an image to LinkedIn, returning the asset URN.

        Uses the two-step flow:
          1. POST /v2/assets?action=registerUpload  → get uploadUrl + asset URN
          2. PUT <uploadUrl> with raw image bytes
        """
        path = Path(image_path)
        if not path.exists():
            logger.warning(f"[DistributionAgent] LinkedIn image file not found: {image_path}")
            return None

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            # Step 1: register the upload
            reg_resp = await client.post(
                "https://api.linkedin.com/v2/assets?action=registerUpload",
                headers=headers,
                json={
                    "registerUploadRequest": {
                        "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
                        "owner": author_urn,
                        "serviceRelationships": [{
                            "relationshipType": "OWNER",
                            "identifier": "urn:li:userGeneratedContent",
                        }],
                    }
                },
            )
            reg_resp.raise_for_status()
            reg_data = reg_resp.json()

            upload_mechanism = (
                reg_data.get("value", {})
                .get("uploadMechanism", {})
                .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {})
            )
            upload_url = upload_mechanism.get("uploadUrl", "")
            asset_urn = reg_data.get("value", {}).get("asset", "")

            if not upload_url or not asset_urn:
                raise RuntimeError(
                    f"LinkedIn registerUpload response missing uploadUrl or asset: {reg_data}"
                )

            # Step 2: upload the image bytes
            image_data = path.read_bytes()
            put_resp = await client.put(
                upload_url,
                content=image_data,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            put_resp.raise_for_status()

        logger.info(f"[DistributionAgent] LinkedIn image uploaded: {asset_urn}")
        return asset_urn

    def _queue_social_post(self, platform: str, text: str, topic: str, payload: dict[str, Any] | None = None) -> None:
        # Check automation section first, fall back to approvals section
        _require = get_setting("automation", "require_social_approval", None)
        if _require is None:
            _require = get_setting("approvals", "require_social_approval", "true")
        status = "pending_approval" if as_bool(_require) else "pending"
        conn = sqlite3.connect(str(self._db_path))
        # Dedup: skip if an identical platform+text post is already pending
        existing = conn.execute(
            "SELECT id FROM social_queue WHERE platform=? AND text=? AND status IN ('pending','pending_approval') LIMIT 1",
            (platform, text),
        ).fetchone()
        if existing:
            conn.close()
            return
        conn.execute(
            "INSERT INTO social_queue (platform, text, title, status, payload_json) VALUES (?,?,?,?,?)",
            (platform, text, topic or "", status, json.dumps(payload or {})),
        )
        conn.commit()
        conn.close()

    def _mark_social_posted(self, platform: str, text: str) -> None:
        conn = sqlite3.connect(str(self._db_path))
        # SQLite does not support LIMIT in UPDATE — use rowid subquery instead
        conn.execute(
            """UPDATE social_queue SET status='posted', posted_at=datetime('now')
               WHERE id = (
                   SELECT id FROM social_queue
                   WHERE platform=? AND text=? AND status='pending'
                   LIMIT 1
               )""",
            (platform, text),
        )
        conn.commit()
        conn.close()

    # ─────────────────────────── Revenue ─────────────────────────────────────

    def _mark_social_post_status(self, platform: str, text: str, queue_id: int | str | None = None) -> None:
        conn = sqlite3.connect(str(self._db_path))
        if queue_id:
            conn.execute(
                "UPDATE social_queue SET status='posted', posted_at=datetime('now') WHERE id=?",
                (int(queue_id),),
            )
        else:
            conn.execute(
                """UPDATE social_queue SET status='posted', posted_at=datetime('now')
                   WHERE id = (
                       SELECT id FROM social_queue
                       WHERE platform=? AND text=? AND status IN ('pending', 'approved')
                       LIMIT 1
                   )""",
                (platform, text),
            )
        conn.commit()
        conn.close()

    # ------------------------------------------------------------------
    # Facebook Page — Graph API v19
    # ------------------------------------------------------------------

    async def _post_to_facebook(self, text: str, link: str = "", image_path: str = "") -> dict[str, Any]:
        """Post to a Facebook Page via Graph API."""
        access_token = str(os.getenv("FACEBOOK_ACCESS_TOKEN") or get_setting("facebook", "access_token", "")).strip()
        page_id = str(get_setting("facebook", "page_id", "") or "").strip()
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "facebook access_token not configured"}
        if not page_id:
            return {"status": "skipped", "reason": "facebook page_id not configured"}

        base = "https://graph.facebook.com/v19.0"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                if image_path and Path(image_path).exists():
                    # Upload photo with caption
                    with open(image_path, "rb") as f:
                        resp = await client.post(
                            f"{base}/{page_id}/photos",
                            params={"access_token": access_token},
                            data={"caption": text[:2000], "url": link or None},
                            files={"source": f},
                        )
                else:
                    payload: dict[str, Any] = {"message": text[:2000], "access_token": access_token}
                    if link:
                        payload["link"] = link
                    resp = await client.post(f"{base}/{page_id}/feed", data=payload)
                resp.raise_for_status()
                data = resp.json()
            post_id = data.get("post_id") or data.get("id", "")
            logger.success(f"[DistributionAgent] Facebook page post: {post_id}")
            return {"status": "posted", "post_id": post_id, "platform": "facebook"}
        except Exception as exc:
            logger.error(f"[DistributionAgent] Facebook post failed: {exc}")
            return {"status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Facebook Groups — Graph API v19
    # ------------------------------------------------------------------

    async def _post_to_facebook_group(self, text: str, link: str = "", image_path: str = "") -> dict[str, Any]:
        """Post to a Facebook Group via Graph API."""
        access_token = str(os.getenv("FACEBOOK_GROUPS_ACCESS_TOKEN") or get_setting("facebook_groups", "access_token", "")).strip()
        group_id = str(get_setting("facebook_groups", "group_id", "") or "").strip()
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "facebook_groups access_token not configured"}
        if not group_id:
            return {"status": "skipped", "reason": "facebook_groups group_id not configured"}

        base = "https://graph.facebook.com/v19.0"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                if image_path and Path(image_path).exists():
                    with open(image_path, "rb") as f:
                        resp = await client.post(
                            f"{base}/{group_id}/photos",
                            params={"access_token": access_token},
                            data={"caption": text[:2000]},
                            files={"source": f},
                        )
                else:
                    payload = {"message": text[:2000], "access_token": access_token}
                    if link:
                        payload["link"] = link
                    resp = await client.post(f"{base}/{group_id}/feed", data=payload)
                resp.raise_for_status()
                data = resp.json()
            post_id = data.get("post_id") or data.get("id", "")
            logger.success(f"[DistributionAgent] Facebook group post: {post_id}")
            return {"status": "posted", "post_id": post_id, "platform": "facebook_groups"}
        except Exception as exc:
            logger.error(f"[DistributionAgent] Facebook group post failed: {exc}")
            return {"status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Instagram — Graph API (Business/Creator account via Facebook)
    # ------------------------------------------------------------------

    async def _post_to_instagram(self, text: str, image_path: str = "", media_type: str = "IMAGE") -> dict[str, Any]:
        """Post to Instagram via Facebook Graph API.

        Requires an Instagram Business or Creator account linked to a Facebook Page.
        account_id = Instagram User ID (not the Facebook Page ID).
        access_token = Page access token with instagram_basic + publish_to_page permissions.
        """
        cfg_key = "instagram_posts" if media_type != "REELS" else "instagram"
        access_token = str(os.getenv("INSTAGRAM_ACCESS_TOKEN") or get_setting(cfg_key, "access_token", "")).strip()
        ig_user_id = str(get_setting(cfg_key, "account_id", "") or "").strip()
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "instagram access_token not configured"}
        if not ig_user_id:
            return {"status": "skipped", "reason": "instagram account_id not configured"}

        base = "https://graph.facebook.com/v19.0"
        caption = text[:2200]

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                # Step 1: create media container
                container_payload: dict[str, Any] = {
                    "caption": caption,
                    "access_token": access_token,
                }
                if media_type == "REELS" and image_path:
                    container_payload["media_type"] = "REELS"
                    container_payload["video_url"] = image_path  # must be public URL for Reels
                elif image_path and Path(image_path).exists():
                    # Upload image bytes first to get a hosted URL via /photos endpoint
                    with open(image_path, "rb") as f:
                        upload_resp = await client.post(
                            f"{base}/{ig_user_id}/media",
                            params={"access_token": access_token},
                            data=container_payload,
                            files={"image": f},
                        )
                    upload_resp.raise_for_status()
                    container_id = upload_resp.json().get("id", "")
                else:
                    create_resp = await client.post(f"{base}/{ig_user_id}/media", data=container_payload)
                    create_resp.raise_for_status()
                    container_id = create_resp.json().get("id", "")

                if not container_id:
                    return {"status": "error", "error": "Instagram media container creation failed — no id returned"}

                # Step 2: publish the container
                pub_resp = await client.post(
                    f"{base}/{ig_user_id}/media_publish",
                    data={"creation_id": container_id, "access_token": access_token},
                )
                pub_resp.raise_for_status()
                post_id = pub_resp.json().get("id", "")

            logger.success(f"[DistributionAgent] Instagram post published: {post_id}")
            return {"status": "posted", "post_id": post_id, "platform": "instagram"}
        except Exception as exc:
            logger.error(f"[DistributionAgent] Instagram post failed: {exc}")
            return {"status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # TikTok — Content Posting API v2
    # ------------------------------------------------------------------

    async def _post_to_tiktok(self, text: str, video_path: str = "") -> dict[str, Any]:
        """Post a video to TikTok via Content Posting API v2.

        Requires:
          access_token  — OAuth 2.0 user token (scope: video.publish)
          creator_id    — Open ID of the creator (returned during OAuth)
          privacy_status — SELF_ONLY | PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS
        """
        access_token = str(os.getenv("TIKTOK_ACCESS_TOKEN") or get_setting("tiktok", "access_token", "")).strip()
        creator_id = str(get_setting("tiktok", "creator_id", "") or "").strip()
        privacy = str(get_setting("tiktok", "privacy_status", "SELF_ONLY") or "SELF_ONLY").upper()
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "tiktok access_token not configured"}
        if not creator_id:
            return {"status": "skipped", "reason": "tiktok creator_id not configured"}
        if not video_path or not Path(video_path).exists():
            return {"status": "skipped", "reason": "no video file available for TikTok"}

        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"}
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                # Step 1: init upload
                video_bytes = Path(video_path).read_bytes()
                init_resp = await client.post(
                    "https://open.tiktokapis.com/v2/post/publish/video/init/",
                    headers=headers,
                    json={
                        "post_info": {
                            "title": text[:150],
                            "privacy_level": privacy,
                            "disable_duet": False,
                            "disable_comment": False,
                            "disable_stitch": False,
                        },
                        "source_info": {
                            "source": "FILE_UPLOAD",
                            "video_size": len(video_bytes),
                            "chunk_size": len(video_bytes),
                            "total_chunk_count": 1,
                        },
                    },
                )
                init_resp.raise_for_status()
                init_data = init_resp.json().get("data", {})
                publish_id = init_data.get("publish_id", "")
                upload_url = init_data.get("upload_url", "")
                if not upload_url:
                    return {"status": "error", "error": f"TikTok init missing upload_url: {init_data}"}

                # Step 2: upload video chunk
                upload_resp = await client.put(
                    upload_url,
                    content=video_bytes,
                    headers={
                        "Content-Type": "video/mp4",
                        "Content-Range": f"bytes 0-{len(video_bytes)-1}/{len(video_bytes)}",
                        "Content-Length": str(len(video_bytes)),
                    },
                )
                upload_resp.raise_for_status()

            logger.success(f"[DistributionAgent] TikTok video uploaded: publish_id={publish_id}")
            return {"status": "posted", "post_id": publish_id, "platform": "tiktok"}
        except Exception as exc:
            logger.error(f"[DistributionAgent] TikTok post failed: {exc}")
            return {"status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # YouTube — Data API v3
    # ------------------------------------------------------------------

    async def _post_to_youtube(self, title: str, description: str = "", video_path: str = "") -> dict[str, Any]:
        """Upload a video to YouTube via Data API v3 (resumable upload).

        Requires:
          access_token   — OAuth 2.0 user token (scope: youtube.upload)
          channel_id     — YouTube channel ID (used for verification only; upload goes to authed account)
          privacy_status — private | unlisted | public
        """
        access_token = str(os.getenv("YOUTUBE_ACCESS_TOKEN") or get_setting("youtube", "access_token", "")).strip()
        privacy = str(get_setting("youtube", "privacy_status", "private") or "private").lower()
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "youtube access_token not configured"}
        if not video_path or not Path(video_path).exists():
            return {"status": "skipped", "reason": "no video file available for YouTube"}

        video_bytes = Path(video_path).read_bytes()
        metadata = {
            "snippet": {"title": title[:100], "description": description[:5000]},
            "status": {"privacyStatus": privacy},
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(len(video_bytes)),
            "Content-Type": "application/json; charset=UTF-8",
        }
        try:
            async with httpx.AsyncClient(timeout=600) as client:
                # Step 1: initiate resumable upload session
                init_resp = await client.post(
                    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
                    headers=headers,
                    json=metadata,
                )
                init_resp.raise_for_status()
                upload_url = init_resp.headers.get("Location", "")
                if not upload_url:
                    return {"status": "error", "error": "YouTube did not return upload Location URL"}

                # Step 2: upload video bytes
                upload_resp = await client.put(
                    upload_url,
                    content=video_bytes,
                    headers={"Content-Type": "video/mp4", "Content-Length": str(len(video_bytes))},
                )
                upload_resp.raise_for_status()
                video_id = upload_resp.json().get("id", "")

            logger.success(f"[DistributionAgent] YouTube video uploaded: {video_id}")
            return {
                "status": "posted",
                "post_id": video_id,
                "url": f"https://youtu.be/{video_id}" if video_id else "",
                "platform": "youtube",
            }
        except Exception as exc:
            logger.error(f"[DistributionAgent] YouTube upload failed: {exc}")
            return {"status": "error", "error": str(exc)}

    # ------------------------------------------------------------------
    # Reddit — OAuth2 Script API
    # ------------------------------------------------------------------

    async def _post_to_reddit(self, title: str, link: str = "", selftext: str = "") -> dict[str, Any]:
        """Post to one or more Reddit subreddits via OAuth2 Script authentication.

        Credentials (settings section: reddit):
          client_id     — Reddit app Client ID (Script type app at reddit.com/prefs/apps)
          client_secret — Reddit app Client Secret
          username      — Reddit account username
          password      — Reddit account password
          subreddit     — Target subreddit(s), comma-separated (e.g. "programming,webdev")
          post_type     — "link" (URL post) or "self" (text post), default "link"
        """
        client_id     = str(os.getenv("REDDIT_CLIENT_ID")     or get_setting("reddit", "client_id",     "")).strip()
        client_secret = str(os.getenv("REDDIT_CLIENT_SECRET") or get_setting("reddit", "client_secret", "")).strip()
        username      = str(os.getenv("REDDIT_USERNAME")      or get_setting("reddit", "username",      "")).strip()
        password      = str(os.getenv("REDDIT_PASSWORD")      or get_setting("reddit", "password",      "")).strip()
        subreddit_raw = str(get_setting("reddit", "subreddit", "")).strip()
        post_type     = str(get_setting("reddit", "post_type", "link")).strip().lower()

        for field, val in [("client_id", client_id), ("client_secret", client_secret),
                           ("username", username), ("password", password), ("subreddit", subreddit_raw)]:
            if not val or val.startswith("****"):
                return {"status": "error", "error": f"Reddit {field} not configured"}

        subreddits = [s.strip().lstrip("r/") for s in subreddit_raw.split(",") if s.strip()]
        if not subreddits:
            return {"status": "error", "error": "No subreddits configured"}

        # Determine post kind
        kind = "link" if post_type == "link" and link else "self"

        user_agent = f"python:autonomous_prime:v1.0 (by /u/{username})"

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1 — get access token via password grant
            token_resp = await client.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=(client_id, client_secret),
                data={"grant_type": "password", "username": username, "password": password},
                headers={"User-Agent": user_agent},
            )
            if token_resp.status_code != 200:
                return {"status": "error", "error": f"Reddit token fetch failed: {token_resp.status_code} {token_resp.text[:200]}"}

            token_data = token_resp.json()
            access_token = token_data.get("access_token", "")
            if not access_token:
                return {"status": "error", "error": f"Reddit token missing: {token_data}"}

            headers = {
                "Authorization": f"bearer {access_token}",
                "User-Agent": user_agent,
            }

            results = []
            for sr in subreddits:
                payload: dict[str, Any] = {
                    "sr": sr,
                    "title": title[:300],
                    "kind": kind,
                    "resubmit": True,
                    "nsfw": False,
                    "spoiler": False,
                    "api_type": "json",
                }
                if kind == "link":
                    payload["url"] = link
                else:
                    payload["text"] = selftext or title

                try:
                    resp = await client.post(
                        "https://oauth.reddit.com/api/submit",
                        data=payload,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    json_data = data.get("json", {})
                    errors = json_data.get("errors", [])
                    if errors:
                        results.append({"subreddit": sr, "status": "error", "error": str(errors)})
                        logger.warning(f"[DistributionAgent] Reddit post to r/{sr} failed: {errors}")
                        continue
                    post_url = json_data.get("data", {}).get("url", "")
                    post_id  = json_data.get("data", {}).get("id", "")
                    results.append({"subreddit": sr, "status": "posted", "url": post_url, "id": post_id})
                    logger.info(f"[DistributionAgent] Reddit posted to r/{sr}: {post_url}")
                except Exception as exc:
                    results.append({"subreddit": sr, "status": "error", "error": str(exc)})
                    logger.error(f"[DistributionAgent] Reddit r/{sr} post error: {exc}")

        posted = [r for r in results if r["status"] == "posted"]
        if posted:
            first = posted[0]
            return {
                "status": "posted",
                "post_id": first.get("id", ""),
                "url": first.get("url", ""),
                "platform": "reddit",
                "subreddits": results,
            }
        return {"status": "error", "error": "All subreddit posts failed", "subreddits": results}

    # ------------------------------------------------------------------
    # Threads — Meta Threads Graph API v1.0
    # ------------------------------------------------------------------

    async def _post_to_threads(self, text: str, link: str = "", image_path: str = "") -> dict[str, Any]:
        """Post to Threads via the Meta Threads Graph API.

        Credentials (settings section: threads):
          access_token — Threads user access token (OAuth2, scopes: threads_basic, threads_content_publish)
          user_id      — Threads user ID (numeric string)

        Flow:
          1. Create a media container (POST /{user_id}/threads)
          2. Publish the container (POST /{user_id}/threads_publish)
        """
        access_token = str(os.getenv("THREADS_ACCESS_TOKEN") or get_setting("threads", "access_token", "")).strip()
        user_id      = str(get_setting("threads", "user_id", "")).strip()

        if not access_token or access_token.startswith("****"):
            return {"status": "error", "error": "Threads access_token not configured"}
        if not user_id:
            return {"status": "error", "error": "Threads user_id not configured"}

        base = "https://graph.threads.net/v1.0"

        # Build the post body — append link if provided
        body = text
        if link:
            body = f"{text}\n\n{link}" if text else link
        body = body[:500]  # Threads character limit

        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1 — create container
            create_params: dict[str, Any] = {
                "media_type": "TEXT",
                "text": body,
                "access_token": access_token,
            }
            if image_path and image_path.startswith("http"):
                # Threads requires a publicly accessible URL — local paths are skipped
                create_params["media_type"] = "IMAGE"
                create_params["image_url"] = image_path

            cr = await client.post(f"{base}/{user_id}/threads", params=create_params)
            cr.raise_for_status()
            creation_id = cr.json().get("id", "")
            if not creation_id:
                return {"status": "error", "error": f"Threads container creation failed: {cr.text}"}

            # Brief pause — Meta recommends waiting ~30s for media processing, but text is instant
            await asyncio.sleep(1)

            # Step 2 — publish container
            pub = await client.post(
                f"{base}/{user_id}/threads_publish",
                params={"creation_id": creation_id, "access_token": access_token},
            )
            pub.raise_for_status()
            post_id = pub.json().get("id", "")

        logger.success(f"[DistributionAgent] Threads post published: {post_id}")
        return {
            "status": "posted",
            "post_id": post_id,
            "url": f"https://www.threads.net/@me/post/{post_id}" if post_id else "",
            "platform": "threads",
        }

    # ------------------------------------------------------------------

    def record_revenue(self, source: str, amount_cents: int,
                       description: str = "", metadata: dict | None = None) -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute(
            "INSERT INTO revenue_events (source, amount_cents, description, metadata) VALUES (?,?,?,?)",
            (source, amount_cents, description, json.dumps(metadata or {})),
        )
        conn.commit()
        conn.close()

    def _generate_financial_report(self) -> dict:
        conn = sqlite3.connect(str(self._db_path))
        total = conn.execute("SELECT SUM(amount_cents) FROM revenue_events").fetchone()[0] or 0
        by_source = conn.execute(
            "SELECT source, SUM(amount_cents), COUNT(*) FROM revenue_events GROUP BY source"
        ).fetchall()
        monthly = conn.execute(
            """SELECT strftime('%Y-%m', created_at) m, SUM(amount_cents)
               FROM revenue_events GROUP BY m ORDER BY m DESC LIMIT 12"""
        ).fetchall()
        post_counts = conn.execute("SELECT platform, COUNT(*) FROM posts GROUP BY platform").fetchall()
        social_counts = conn.execute("SELECT platform, COUNT(*) FROM social_queue GROUP BY platform").fetchall()
        conn.close()
        return {
            "type": "financial_report",
            "generated_at": datetime.utcnow().isoformat(),
            "total_revenue_usd": round(total / 100, 2),
            "by_source": [{"source": r[0], "usd": round(r[1]/100,2), "count": r[2]} for r in by_source],
            "monthly": [{"month": r[0], "usd": round(r[1]/100,2)} for r in monthly],
            "posts_by_platform": {r[0]: r[1] for r in post_counts},
            "social_by_platform": {r[0]: r[1] for r in social_counts},
        }

    def revenue_summary(self) -> dict:
        conn = sqlite3.connect(str(self._db_path))
        total = conn.execute("SELECT COALESCE(SUM(amount_cents),0) FROM revenue_events").fetchone()[0]
        count = conn.execute("SELECT COUNT(*) FROM revenue_events").fetchone()[0]
        monthly = conn.execute(
            """SELECT strftime('%Y-%m', created_at) m, COALESCE(SUM(amount_cents),0)
               FROM revenue_events GROUP BY m ORDER BY m DESC LIMIT 12"""
        ).fetchall()
        recent_posts = conn.execute(
            """SELECT COALESCE(title,''), COALESCE(url,''), platform,
                      created_at, COALESCE(seo_score,0)
               FROM posts ORDER BY created_at DESC LIMIT 10"""
        ).fetchall()
        social_pending = conn.execute(
            "SELECT COUNT(*) FROM social_queue WHERE status='pending'"
        ).fetchone()[0]
        conn.close()
        return {
            "total_usd": round(total / 100, 2),
            "transaction_count": count,
            "monthly": [{"month": r[0], "usd": round(r[1] / 100, 2)} for r in monthly],
            "recent_posts": [
                {"title": r[0], "url": r[1], "platform": r[2], "at": r[3], "seo_score": r[4]}
                for r in recent_posts
            ],
            "social_pending": social_pending,
        }

    def social_queue_data(self) -> list[dict]:
        conn = sqlite3.connect(str(self._db_path))
        rows = conn.execute(
            "SELECT id, platform, text, scheduled_at, posted_at, status, payload_json, COALESCE(title,'') FROM social_queue ORDER BY id DESC LIMIT 50"
        ).fetchall()
        conn.close()
        items = []
        for row in rows:
            payload = json.loads(row[6]) if row[6] else {}
            stored_title = row[7] or ""
            items.append({
                "id": row[0],
                "platform": row[1],
                "text": row[2],
                "scheduled_at": row[3],
                "posted_at": row[4],
                "status": row[5],
                "payload": payload,
                "title": stored_title or str(payload.get("title", "") or payload.get("topic", "")),
            })
        return items

    def create_calendar_entry(
        self,
        platform: str,
        content_type: str,
        scheduled_at: str,
        title: str = "",
        text: str = "",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        conn = sqlite3.connect(str(self._db_path))
        cur = conn.execute(
            """INSERT INTO calendar_entries
               (platform, content_type, title, text, scheduled_at, status, payload_json)
               VALUES (?,?,?,?,?,?,?)""",
            (
                platform,
                content_type,
                title,
                text,
                scheduled_at,
                "scheduled",
                json.dumps(payload or {}),
            ),
        )
        conn.commit()
        row_id = int(cur.lastrowid)
        conn.close()
        return {
            "id": row_id,
            "platform": platform,
            "content_type": content_type,
            "title": title,
            "text": text,
            "scheduled_at": scheduled_at,
            "status": "scheduled",
            "payload": payload or {},
        }

    def next_schedule_slot(self, platform: str) -> str:
        eastern = ZoneInfo("America/New_York")
        now_utc = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        now_local = now_utc.astimezone(eastern)
        slot_text = str(get_setting("social_scheduler", "posting_times_est", "9:00 AM, 1:00 PM, 5:00 PM") or "")
        slot_times = self._parse_posting_times(slot_text)
        max_posts_per_day = max(1, int(get_setting("social_scheduler", "max_posts_per_day", "4") or 4))
        max_per_platform_per_day = max(1, int(get_setting("social_scheduler", "max_per_platform_per_day", "2") or 2))
        min_gap_minutes = max(15, int(get_setting("social_scheduler", "min_gap_minutes", "90") or 90))
        if not slot_times:
            slot_times = [(9, 0), (13, 0), (17, 0)]

        existing = self.calendar_entries_data(include_posted=False)
        scheduled_times: list[tuple[datetime, str]] = []
        for item in existing:
            try:
                when = datetime.fromisoformat(str(item.get("scheduled_at", "")).replace("Z", ""))
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                when = when.astimezone(eastern)
            except Exception:
                continue
            scheduled_times.append((when, str(item.get("platform", ""))))

        day_cursor = now_local.date()
        for _ in range(60):
            for hour, minute in slot_times[:max_posts_per_day]:
                candidate = datetime(
                    day_cursor.year,
                    day_cursor.month,
                    day_cursor.day,
                    hour,
                    minute,
                    tzinfo=eastern,
                )
                if candidate < now_local:
                    continue

                day_items = [(dt, p) for dt, p in scheduled_times if dt.date() == candidate.date()]
                platform_items = [(dt, p) for dt, p in day_items if p == platform]
                too_many_day = len(day_items) >= max_posts_per_day
                too_many_platform = len(platform_items) >= max_per_platform_per_day
                too_close = any(abs((dt - candidate).total_seconds()) < (min_gap_minutes * 60) for dt, _ in day_items)

                if not too_many_day and not too_many_platform and not too_close:
                    return candidate.astimezone(timezone.utc).isoformat()

            day_cursor = day_cursor + timedelta(days=1)

        return now_utc.isoformat()

    def _parse_posting_times(self, value: str) -> list[tuple[int, int]]:
        times: list[tuple[int, int]] = []
        for chunk in str(value or "").split(","):
            part = chunk.strip()
            if not part:
                continue
            match = re.match(r"(?i)^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$", part)
            if not match:
                continue
            hour = int(match.group(1))
            minute = int(match.group(2) or "00")
            meridiem = match.group(3).upper()
            if hour < 1 or hour > 12 or minute < 0 or minute > 59:
                continue
            if meridiem == "AM":
                hour = 0 if hour == 12 else hour
            else:
                hour = 12 if hour == 12 else hour + 12
            times.append((hour, minute))
        return sorted(set(times))

    def calendar_entries_data(self, include_posted: bool = False) -> list[dict]:
        conn = sqlite3.connect(str(self._db_path))
        where = "" if include_posted else "WHERE status != 'posted'"
        rows = conn.execute(
            f"""SELECT id, platform, content_type, title, text, scheduled_at, posted_at, status, payload_json, result_json, created_at
                FROM calendar_entries {where}
                ORDER BY scheduled_at ASC, id ASC LIMIT 200"""
        ).fetchall()
        conn.close()
        items = []
        for row in rows:
            items.append({
                "id": row[0],
                "platform": row[1],
                "content_type": row[2],
                "title": row[3],
                "text": row[4],
                "scheduled_at": row[5],
                "posted_at": row[6],
                "status": row[7],
                "payload": json.loads(row[8]) if row[8] else {},
                "result": json.loads(row[9]) if row[9] else {},
                "created_at": row[10],
            })
        return items

    def due_calendar_entries(self, limit: int = 20) -> list[dict]:
        conn = sqlite3.connect(str(self._db_path))
        rows = conn.execute(
            """SELECT id, platform, content_type, title, text, scheduled_at, payload_json
               FROM calendar_entries
               WHERE status='scheduled'
                 AND datetime(scheduled_at) <= datetime('now')
               ORDER BY scheduled_at ASC, id ASC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        conn.close()
        return [
            {
                "id": row[0],
                "platform": row[1],
                "content_type": row[2],
                "title": row[3],
                "text": row[4],
                "scheduled_at": row[5],
                "payload": json.loads(row[6]) if row[6] else {},
            }
            for row in rows
        ]

    def update_calendar_entry_status(self, entry_id: int, status: str, result: dict[str, Any] | None = None) -> dict[str, Any] | None:
        conn = sqlite3.connect(str(self._db_path))
        row = conn.execute(
            "SELECT id, platform, content_type, title, text, scheduled_at, payload_json FROM calendar_entries WHERE id=?",
            (entry_id,),
        ).fetchone()
        if not row:
            conn.close()
            return None
        result_json = json.dumps(result or {})
        posted_at = "datetime('now')" if status == "posted" else None
        if posted_at:
            conn.execute(
                f"UPDATE calendar_entries SET status=?, posted_at={posted_at}, result_json=? WHERE id=?",
                (status, result_json, entry_id),
            )
        else:
            conn.execute(
                "UPDATE calendar_entries SET status=?, result_json=? WHERE id=?",
                (status, result_json, entry_id),
            )
        conn.commit()
        conn.close()
        return {
            "id": row[0],
            "platform": row[1],
            "content_type": row[2],
            "title": row[3],
            "text": row[4],
            "scheduled_at": row[5],
            "payload": json.loads(row[6]) if row[6] else {},
            "status": status,
            "result": result or {},
        }

    def video_approval_queue_data(self) -> list[dict]:
        conn = sqlite3.connect(str(self._db_path))
        rows = conn.execute(
            "SELECT id, platform, title, topic, video_path, status, approved_at, published_at, payload_json, result_json FROM publish_queue ORDER BY id DESC LIMIT 50"
        ).fetchall()
        conn.close()
        items = []
        for row in rows:
            items.append({
                "id": row[0],
                "platform": row[1],
                "title": row[2],
                "topic": row[3],
                "video_path": row[4],
                "status": row[5],
                "approved_at": row[6],
                "published_at": row[7],
                "payload": json.loads(row[8]) if row[8] else {},
                "result": json.loads(row[9]) if row[9] else {},
            })
        return items

    def approve_social_queue_item(self, queue_id: int, approved: bool) -> dict[str, Any] | None:
        conn = sqlite3.connect(str(self._db_path))
        row = conn.execute(
            "SELECT id, platform, text, status, payload_json FROM social_queue WHERE id=?",
            (queue_id,),
        ).fetchone()
        if not row:
            conn.close()
            return None
        conn.execute(
            "UPDATE social_queue SET status=?, scheduled_at=datetime('now') WHERE id=?",
            ("approved" if approved else "rejected", queue_id),
        )
        conn.commit()
        conn.close()
        return {
            "id": row[0],
            "platform": row[1],
            "text": row[2],
            "status": "approved" if approved else "rejected",
            "payload": json.loads(row[4]) if row[4] else {},
        }

    def delete_social_queue_item(self, queue_id: int) -> bool:
        conn = sqlite3.connect(str(self._db_path))
        cur = conn.execute("DELETE FROM social_queue WHERE id=?", (queue_id,))
        conn.commit()
        conn.close()
        return cur.rowcount > 0

    def delete_video_queue_item(self, queue_id: int) -> bool:
        conn = sqlite3.connect(str(self._db_path))
        cur = conn.execute("DELETE FROM publish_queue WHERE id=?", (queue_id,))
        conn.commit()
        conn.close()
        return cur.rowcount > 0

    def update_social_queue_status(self, queue_id: int, status: str, message: str = "") -> dict[str, Any] | None:
        conn = sqlite3.connect(str(self._db_path))
        row = conn.execute(
            "SELECT id, platform, text, payload_json FROM social_queue WHERE id=?",
            (queue_id,),
        ).fetchone()
        if not row:
            conn.close()
            return None
        payload = json.loads(row[3]) if row[3] else {}
        if message:
            payload["error_message"] = message
        conn.execute(
            "UPDATE social_queue SET status=?, payload_json=? WHERE id=?",
            (status, json.dumps(payload), queue_id),
        )
        conn.commit()
        conn.close()
        return {
            "id": row[0],
            "platform": row[1],
            "text": row[2],
            "status": status,
            "payload": payload,
        }

    def _build_social_images(
        self,
        topic: str,
        title: str,
        excerpt: str,
        base_image_path: str,
    ) -> dict[str, str]:
        if not base_image_path or not Path(base_image_path).exists():
            return {}

        targets = {
            "x": (1600, 900),
            "facebook": (1200, 630),
            "facebook_groups": (1200, 630),
            "linkedin": (1200, 627),
            "instagram_posts": (1080, 1080),
        }
        slug = slugify(title or topic) or datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        out_dir = self._outputs_dir / "social"
        out_dir.mkdir(parents=True, exist_ok=True)

        try:
            from PIL import Image, ImageDraw
        except Exception as exc:
            logger.warning(f"[DistributionAgent] PIL unavailable for social image generation: {exc}")
            return {}

        created: dict[str, str] = {}
        for platform, (width, height) in targets.items():
            try:
                with Image.open(base_image_path) as src:
                    src = src.convert("RGB")
                    fitted = self._cover_image(src, width, height)
                    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                    draw = ImageDraw.Draw(overlay)
                    draw.rectangle((0, 0, width, height), fill=(0, 0, 0, 72))
                    draw.rectangle((0, int(height * 0.58), width, height), fill=(8, 12, 20, 180))

                    title_text = (title or topic).strip()[:120]
                    excerpt_text = (excerpt or "").strip()[:180]
                    draw.text((48, int(height * 0.64)), title_text, fill=(255, 255, 255, 255))
                    if excerpt_text:
                        draw.text((48, int(height * 0.77)), excerpt_text, fill=(220, 228, 240, 255))
                    draw.text((48, height - 54), platform.replace("_", " ").upper(), fill=(135, 206, 255, 255))

                    composed = Image.alpha_composite(fitted.convert("RGBA"), overlay).convert("RGB")
                    filename = f"{slug}_{platform}.png"
                    path = out_dir / filename
                    composed.save(path, format="PNG", optimize=True)
                    created[platform] = str(path)
            except Exception as exc:
                logger.warning(f"[DistributionAgent] Failed to create social image for {platform}: {exc}")
        return created

    @staticmethod
    def _cover_image(image, width: int, height: int):
        scale = max(width / image.width, height / image.height)
        resized = image.resize((int(image.width * scale), int(image.height * scale)))
        left = max((resized.width - width) // 2, 0)
        top = max((resized.height - height) // 2, 0)
        return resized.crop((left, top, left + width, top + height))

    def approve_video_queue_item(self, queue_id: int, approved: bool) -> dict[str, Any] | None:
        conn = sqlite3.connect(str(self._db_path))
        row = conn.execute(
            "SELECT payload_json FROM publish_queue WHERE id=?",
            (queue_id,),
        ).fetchone()
        if not row:
            conn.close()
            return None
        conn.execute(
            "UPDATE publish_queue SET status=?, approved_at=datetime('now') WHERE id=?",
            ("approved" if approved else "rejected", queue_id),
        )
        conn.commit()
        conn.close()
        payload = json.loads(row[0]) if row[0] else {}
        payload["approval_queue_id"] = queue_id
        payload["approval_granted"] = approved
        return payload

    def update_video_queue_status(self, queue_id: int, status: str, message: str = "") -> dict[str, Any] | None:
        conn = sqlite3.connect(str(self._db_path))
        row = conn.execute(
            "SELECT id, platform, title, topic, video_path, payload_json, result_json FROM publish_queue WHERE id=?",
            (queue_id,),
        ).fetchone()
        if not row:
            conn.close()
            return None
        payload = json.loads(row[5]) if row[5] else {}
        result = json.loads(row[6]) if row[6] else {}
        if message:
            result["error"] = message
        conn.execute(
            "UPDATE publish_queue SET status=?, result_json=? WHERE id=?",
            (status, json.dumps(result), queue_id),
        )
        conn.commit()
        conn.close()
        return {
            "id": row[0],
            "platform": row[1],
            "title": row[2],
            "topic": row[3],
            "video_path": row[4],
            "status": status,
            "payload": payload,
            "result": result,
        }

    def mark_video_queue_uploaded(self, queue_id: int, result: dict[str, Any]) -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute(
            "UPDATE publish_queue SET status='uploaded', published_at=datetime('now'), result_json=? WHERE id=?",
            (json.dumps(result), queue_id),
        )
        conn.commit()
        conn.close()

    # ─────────────────────────── Helpers ─────────────────────────────────────

    def _md_to_wp_html(self, md: str) -> str:
        """Convert markdown to WordPress-ready HTML."""
        # Remove frontmatter
        md = re.sub(r"^---[\s\S]*?---\n?", "", md, count=1).strip()
        # Replace internal link placeholders with span markers
        md = re.sub(r"\{\{INTERNAL_LINK:\s*([^}]+)\}\}",
                    r'<span class="ap-internal-link" data-topic="\1">\1</span>', md)
        try:
            import markdown as md_lib
            html = md_lib.markdown(
                md,
                extensions=["extra", "toc", "meta"],
                extension_configs={"toc": {"toc_depth": "2-4"}},
            )
        except Exception:
            # Fallback: minimal conversion
            html = re.sub(r"^## (.+)$", r"<h2>\1</h2>", md, flags=re.MULTILINE)
            html = re.sub(r"^# (.+)$", r"<h1>\1</h1>", html, flags=re.MULTILINE)
            html = "<p>" + re.sub(r"\n\n", "</p><p>", html) + "</p>"
        return self._normalize_post_html(html)

    def _inject_feature_image(self, html: str, image_url: str, alt_text: str) -> str:
        if not image_url:
            return html

        soup = BeautifulSoup(html, "html.parser")
        if soup.find("img"):
            return html

        figure = soup.new_tag("figure")
        figure["class"] = "ap-featured-image"
        figure["style"] = "margin:24px auto;text-align:center;"

        img = soup.new_tag("img", src=image_url, alt=alt_text or "")
        img["style"] = "display:block;max-width:100%;height:auto;margin:0 auto;"
        figure.append(img)

        first_heading = soup.find(["h1", "h2"])
        if first_heading:
            first_heading.insert_after(figure)
        else:
            soup.insert(0, figure)
        return str(soup)

    def _ensure_image_alt_text(self, html: str, alt_text: str) -> str:
        if not html:
            return html
        soup = BeautifulSoup(html, "html.parser")
        updated = False
        for img in soup.find_all("img"):
            current = (img.get("alt") or "").strip()
            if not current:
                img["alt"] = alt_text or ""
                updated = True
        return str(soup) if updated else html

    def _build_image_slug(self, title: str, image_path: str) -> str:
        base = Path(image_path).stem if image_path else title
        candidate = slugify(base) or slugify(title) or "autonomous-prime-image"
        return candidate[:190]

    def _estimate_seo_score(self, keyword: str, html: str, meta: str) -> int:
        """Simple 0-100 SEO score heuristic."""
        score = 0
        kw = keyword.lower()
        content_lower = html.lower()
        if kw and kw in content_lower[:200]:  score += 20  # keyword in intro
        if kw and kw in meta.lower():          score += 20  # keyword in meta
        if "<h2>" in html:                      score += 15  # has subheadings
        if len(meta) >= 140:                    score += 15  # meta length
        if len(html.split()) >= 1000:           score += 15  # word count
        if "faq" in content_lower:             score += 15  # FAQ section
        return min(score, 100)

    def _log_post(self, platform, post_id, topic, title, slug, url, seo_score, status: str = "published") -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute(
            "INSERT INTO posts (platform, post_id, topic, title, slug, url, status, seo_score) VALUES (?,?,?,?,?,?,?,?)",
            (platform, str(post_id) if post_id else None, topic, title, slug, url, status, seo_score),
        )
        conn.commit()
        conn.close()

    def _normalize_post_html(self, html: str) -> str:
        """Apply light post-layout cleanup before WordPress publish."""
        html = re.sub(r"<h1>\s*(.*?)\s*</h1>", lambda m: f"<h1>{self._strip_heading_markup(m.group(1))}</h1>", html, flags=re.IGNORECASE)
        html = re.sub(r"<h2>\s*(.*?)\s*</h2>", lambda m: f"<h2>{self._strip_heading_markup(m.group(1))}</h2>", html, flags=re.IGNORECASE)
        html = re.sub(r"<h3>\s*(.*?)\s*</h3>", lambda m: f"<h3>{self._strip_heading_markup(m.group(1))}</h3>", html, flags=re.IGNORECASE)
        html = re.sub(
            r"<img([^>]+)>",
            r'<figure class="ap-image-wrap" style="text-align:center;margin:24px auto;"><img\1 style="display:block;max-width:100%;height:auto;margin:0 auto;" /></figure>',
            html,
            flags=re.IGNORECASE,
        )
        return html

    @staticmethod
    def _strip_heading_markup(text: str) -> str:
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"~~([^~]+)~~", r"\1", text)
        text = re.sub(r"\*{1,2}([^*]+)\*{1,2}", r"\1", text)
        text = re.sub(r"_{1,2}([^_]+)_{1,2}", r"\1", text)
        return re.sub(r"\s{2,}", " ", text).strip()

    async def _publish_video(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "")
        calendar_entry_id = task.payload.get("calendar_entry_id")
        video_path = task.payload.get("video_filepath", "")
        title = task.payload.get("title", topic)
        description = task.payload.get("excerpt") or task.payload.get("meta_description") or topic
        tags = task.payload.get("tags", [])
        post_url = task.payload.get("post_url", "")
        approval_queue_id = task.payload.get("approval_queue_id")
        aspect_ratio = task.payload.get("aspect_ratio", "16:9")
        targets = task.payload.get("publish_targets", ["youtube", "tiktok", "instagram"])

        if not video_path or not Path(video_path).exists():
            result = {"type": "video_publish", "topic": topic, "status": "skipped", "reason": "No final video file"}
            if calendar_entry_id:
                self.update_calendar_entry_status(int(calendar_entry_id), "failed", result)
            return result

        results: dict[str, Any] = {
            "type": "video_publish",
            "topic": topic,
            "video_filepath": video_path,
            "aspect_ratio": aspect_ratio,
            "platforms": {},
        }
        require_approval = as_bool(get_setting("approvals", "require_video_approval", "true"))
        if require_approval and not task.payload.get("approval_granted"):
            approval_ids: list[int] = []
            for platform in targets:
                approval_ids.append(
                    self._queue_video_publish_approval(
                        platform=platform,
                        video_path=video_path,
                        title=title,
                        description=description,
                        topic=topic,
                        tags=tags,
                        post_url=post_url,
                        aspect_ratio=aspect_ratio,
                    )
                )
                results["platforms"][platform] = {"status": "pending_approval", "aspect_ratio": aspect_ratio}
            results["approval_ids"] = approval_ids
            if calendar_entry_id:
                self.update_calendar_entry_status(int(calendar_entry_id), "blocked_config", results)
            return results
        for platform in targets:
            results["platforms"][platform] = await self._upload_to_platform(
                platform=platform,
                video_path=Path(video_path),
                title=title,
                description=description,
                tags=tags,
                post_url=post_url,
                topic=topic,
                aspect_ratio=aspect_ratio,
            )
            if approval_queue_id and results["platforms"][platform].get("status") == "uploaded":
                self.mark_video_queue_uploaded(int(approval_queue_id), results["platforms"][platform])
        if calendar_entry_id:
            posted = any(platform_result.get("status") == "uploaded" for platform_result in results["platforms"].values())
            blocked = all(platform_result.get("status") == "skipped" for platform_result in results["platforms"].values())
            self.update_calendar_entry_status(
                int(calendar_entry_id),
                "posted" if posted else ("blocked_config" if blocked else "failed"),
                results,
            )
        return results

    def _queue_video_publish_approval(
        self,
        platform: str,
        video_path: str,
        title: str,
        description: str,
        topic: str,
        tags: list[str],
        post_url: str,
        aspect_ratio: str,
    ) -> int:
        payload = {
            "platform": platform,
            "video_path": video_path,
            "title": title,
            "description": description,
            "topic": topic,
            "tags": tags,
            "post_url": post_url,
            "aspect_ratio": aspect_ratio,
        }
        conn = sqlite3.connect(str(self._db_path))
        cur = conn.execute(
            "INSERT INTO publish_queue (platform, title, topic, video_path, payload_json, status) VALUES (?,?,?,?,?,?)",
            (platform, title, topic, video_path, json.dumps(payload), "pending_approval"),
        )
        conn.commit()
        row_id = int(cur.lastrowid)
        conn.close()
        return row_id

    async def _upload_to_platform(
        self,
        platform: str,
        video_path: Path,
        title: str,
        description: str,
        tags: list[str],
        post_url: str,
        topic: str,
        aspect_ratio: str,
    ) -> dict[str, Any]:
        enabled = as_bool(get_setting(platform, "enabled", "false"))
        upload_url = str(get_setting(platform, "upload_url", "") or "").strip()
        access_token = str(get_setting(platform, "access_token", "") or "").strip()
        if not enabled:
            return {"status": "skipped", "reason": "disabled in settings", "aspect_ratio": aspect_ratio}
        if not upload_url:
            return {"status": "skipped", "reason": "missing upload_url", "aspect_ratio": aspect_ratio}
        if not access_token or "****" in access_token:
            return {"status": "skipped", "reason": "missing access token", "aspect_ratio": aspect_ratio}

        headers = {"Authorization": f"Bearer {access_token}"}
        data = {
            "title": title,
            "description": description,
            "tags": ",".join(str(tag).strip() for tag in tags if str(tag).strip()),
            "post_url": post_url,
            "topic": topic,
            "aspect_ratio": aspect_ratio,
            "channel_id": str(get_setting("youtube", "channel_id", "")),
            "creator_id": str(get_setting("tiktok", "creator_id", "")),
            "account_id": str(get_setting("instagram", "account_id", "")),
            "privacy_status": str(get_setting(platform, "privacy_status", "private")),
            "media_type": str(get_setting("instagram", "media_type", "REELS")),
        }
        files = {"video": (video_path.name, video_path.read_bytes(), "video/mp4")}
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.post(upload_url, headers=headers, data=data, files=files)
                response.raise_for_status()
                payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"raw": response.text[:500]}
            logger.success(f"[DistributionAgent] {platform} upload succeeded for {video_path.name}")
            return {"status": "uploaded", "aspect_ratio": aspect_ratio, "response": payload}
        except Exception as exc:
            logger.error(f"[DistributionAgent] {platform} upload failed: {exc}")
            return {"status": "error", "aspect_ratio": aspect_ratio, "error": str(exc)}


    # ─────────────────────────────────────────────────────────────────────────
    # AUTO COMMENT REPLY ENGINE
    # ─────────────────────────────────────────────────────────────────────────

    # ── Reply log (in-memory ring buffer, persisted to JSON) ─────────────────
    _reply_log: list[dict] = []
    _reply_log_path: Path = Path("data/comment_replies.json")
    _MAX_LOG = 500

    def _save_reply_log(self) -> None:
        try:
            self._reply_log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._reply_log_path, "w", encoding="utf-8") as f:
                json.dump(self._reply_log[-self._MAX_LOG:], f, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.warning(f"[CommentReply] Could not save reply log: {exc}")

    def _load_reply_log(self) -> None:
        try:
            if self._reply_log_path.exists():
                with open(self._reply_log_path, encoding="utf-8") as f:
                    self._reply_log = json.load(f)
        except Exception:
            self._reply_log = []

    def get_reply_log(self, limit: int = 100) -> list[dict]:
        if not self._reply_log:
            self._load_reply_log()
        return list(reversed(self._reply_log[-self._MAX_LOG:]))[:limit]

    def _record_reply(self, platform: str, comment_text: str, reply_text: str, comment_id: str) -> None:
        entry = {
            "id": f"{platform}_{comment_id}",
            "platform": platform,
            "comment": comment_text,
            "reply": reply_text,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        self._reply_log.append(entry)
        self._save_reply_log()

    async def run_comment_reply_cycle(self) -> dict[str, Any]:
        """
        Poll all enabled platforms for new comments and auto-reply using LLM.
        Called by the APScheduler every N minutes.
        """
        if not as_bool(get_setting("comment_reply", "enabled", "false")):
            return {"skipped": True, "reason": "comment_reply disabled"}

        platforms_raw = str(get_setting("comment_reply", "platforms", "") or "")
        platforms = [p.strip().lower() for p in platforms_raw.split(",") if p.strip()]
        if not platforms:
            return {"skipped": True, "reason": "no platforms configured"}

        tone         = str(get_setting("comment_reply", "tone", "friendly") or "friendly")
        brand_name   = str(get_setting("comment_reply", "brand_name", "") or "")
        instructions = str(get_setting("comment_reply", "custom_instructions", "") or "")
        max_replies  = int(get_setting("comment_reply", "max_replies_per_poll", "10") or 10)
        min_len      = int(get_setting("comment_reply", "min_comment_length", "5") or 5)
        skip_raw     = str(get_setting("comment_reply", "skip_keywords", "") or "")
        skip_words   = [s.strip().lower() for s in skip_raw.split(",") if s.strip()]

        results: dict[str, Any] = {}
        total_replied = 0

        for platform in platforms:
            if total_replied >= max_replies:
                break
            try:
                comments = await self._fetch_unanswered_comments(platform)
                replied = 0
                for c in comments:
                    if total_replied >= max_replies:
                        break
                    text = str(c.get("text", "")).strip()
                    if len(text) < min_len:
                        continue
                    if any(kw in text.lower() for kw in skip_words):
                        logger.debug(f"[CommentReply] Skipping spam comment on {platform}: {text[:60]}")
                        continue
                    reply = await self._generate_comment_reply(text, platform, tone, brand_name, instructions)
                    if reply:
                        ok = await self._post_comment_reply(platform, c, reply)
                        if ok:
                            self._record_reply(platform, text, reply, str(c.get("id", "")))
                            replied += 1
                            total_replied += 1
                results[platform] = {"replied": replied, "fetched": len(comments)}
            except Exception as exc:
                logger.error(f"[CommentReply] {platform} error: {exc}")
                results[platform] = {"error": str(exc)}

        logger.info(f"[CommentReply] Cycle done — {total_replied} replies across {platforms}")
        return {"total_replied": total_replied, "platforms": results}

    async def _generate_comment_reply(
        self, comment: str, platform: str, tone: str, brand_name: str, custom: str
    ) -> str:
        brand_str = f" You represent {brand_name}." if brand_name else ""
        custom_str = f"\n\nExtra instructions: {custom}" if custom else ""
        system = (
            f"You are a social media community manager.{brand_str} "
            f"Reply to comments in a {tone} tone. Keep replies short (1-3 sentences), natural, and engaging. "
            f"Never be promotional or spammy. Match the energy of the comment."
            f"{custom_str}"
        )
        prompt = (
            f"Platform: {platform}\n"
            f"Comment: {comment}\n\n"
            f"Write a reply to this comment. Output the reply text only, no quotes, no labels."
        )
        try:
            reply = await self.llm.complete(prompt, system=system, max_tokens=200)
            return reply.strip()
        except Exception as exc:
            logger.error(f"[CommentReply] LLM generation failed: {exc}")
            return ""

    # ── Fetchers ──────────────────────────────────────────────────────────────

    async def _fetch_unanswered_comments(self, platform: str) -> list[dict]:
        if platform == "facebook":
            return await self._fetch_facebook_comments()
        if platform == "instagram":
            return await self._fetch_instagram_comments()
        if platform == "twitter":
            return await self._fetch_twitter_mentions()
        if platform == "youtube":
            return await self._fetch_youtube_comments()
        if platform == "wordpress":
            return await self._fetch_wordpress_comments()
        if platform == "reddit":
            return await self._fetch_reddit_comments()
        if platform == "threads":
            return await self._fetch_threads_replies()
        return []

    async def _fetch_facebook_comments(self) -> list[dict]:
        token   = str(get_setting("facebook", "page_access_token", "") or "")
        page_id = str(get_setting("facebook", "page_id", "") or "")
        if not token or not page_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Get recent posts
                r = await client.get(
                    f"https://graph.facebook.com/v19.0/{page_id}/posts",
                    params={"access_token": token, "limit": 5, "fields": "id"}
                )
                r.raise_for_status()
                posts = r.json().get("data", [])
                comments = []
                for post in posts:
                    cr = await client.get(
                        f"https://graph.facebook.com/v19.0/{post['id']}/comments",
                        params={"access_token": token, "fields": "id,message,from,can_reply_privately", "filter": "stream"}
                    )
                    cr.raise_for_status()
                    for c in cr.json().get("data", []):
                        comments.append({"id": c["id"], "text": c.get("message", ""), "platform": "facebook", "post_id": post["id"]})
            return comments
        except Exception as exc:
            logger.error(f"[CommentReply] Facebook fetch error: {exc}")
            return []

    async def _fetch_instagram_comments(self) -> list[dict]:
        token   = str(get_setting("instagram_posts", "page_access_token", "") or "")
        user_id = str(get_setting("instagram_posts", "instagram_user_id", "") or "")
        if not token or not user_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(
                    f"https://graph.facebook.com/v19.0/{user_id}/media",
                    params={"access_token": token, "limit": 5, "fields": "id"}
                )
                r.raise_for_status()
                media_list = r.json().get("data", [])
                comments = []
                for media in media_list:
                    cr = await client.get(
                        f"https://graph.facebook.com/v19.0/{media['id']}/comments",
                        params={"access_token": token, "fields": "id,text,username"}
                    )
                    cr.raise_for_status()
                    for c in cr.json().get("data", []):
                        comments.append({"id": c["id"], "text": c.get("text", ""), "platform": "instagram", "media_id": media["id"]})
            return comments
        except Exception as exc:
            logger.error(f"[CommentReply] Instagram fetch error: {exc}")
            return []

    async def _fetch_twitter_mentions(self) -> list[dict]:
        bearer = str(get_setting("twitter", "bearer_token", "") or "")
        user_id = str(get_setting("twitter", "user_id", "") or "")
        if not bearer or not user_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(
                    f"https://api.twitter.com/2/users/{user_id}/mentions",
                    params={"max_results": 10, "tweet.fields": "author_id,conversation_id,in_reply_to_user_id"},
                    headers={"Authorization": f"Bearer {bearer}"}
                )
                r.raise_for_status()
                tweets = r.json().get("data", [])
                return [{"id": t["id"], "text": t["text"], "platform": "twitter", "conversation_id": t.get("conversation_id", t["id"])} for t in tweets]
        except Exception as exc:
            logger.error(f"[CommentReply] Twitter fetch error: {exc}")
            return []

    async def _fetch_youtube_comments(self) -> list[dict]:
        api_key = str(get_setting("youtube", "api_key", "") or "")
        channel_id = str(get_setting("youtube", "channel_id", "") or "")
        if not api_key or not channel_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Get recent videos
                vr = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={"part": "id", "channelId": channel_id, "maxResults": 3, "order": "date", "type": "video", "key": api_key}
                )
                vr.raise_for_status()
                video_ids = [i["id"]["videoId"] for i in vr.json().get("items", [])]
                comments = []
                for vid in video_ids:
                    cr = await client.get(
                        "https://www.googleapis.com/youtube/v3/commentThreads",
                        params={"part": "snippet", "videoId": vid, "maxResults": 10, "key": api_key}
                    )
                    cr.raise_for_status()
                    for item in cr.json().get("items", []):
                        top = item["snippet"]["topLevelComment"]["snippet"]
                        comments.append({"id": item["id"], "text": top["textDisplay"], "platform": "youtube", "video_id": vid})
            return comments
        except Exception as exc:
            logger.error(f"[CommentReply] YouTube fetch error: {exc}")
            return []

    # ── Repliers ──────────────────────────────────────────────────────────────

    async def _post_comment_reply(self, platform: str, comment: dict, reply_text: str) -> bool:
        try:
            if platform == "facebook":
                return await self._reply_facebook_comment(comment["id"], reply_text)
            if platform == "instagram":
                return await self._reply_instagram_comment(comment["id"], reply_text)
            if platform == "twitter":
                return await self._reply_twitter_comment(comment["id"], reply_text)
            if platform == "youtube":
                return await self._reply_youtube_comment(comment["id"], reply_text)
            if platform == "wordpress":
                return await self._reply_wordpress_comment(comment["id"], comment.get("post_id", 0), reply_text)
            if platform == "reddit":
                return await self._reply_reddit_comment(comment["id"], reply_text)
            if platform == "threads":
                return await self._reply_threads_comment(comment["id"], reply_text)
        except Exception as exc:
            logger.error(f"[CommentReply] Post reply failed on {platform}: {exc}")
        return False

    async def _fetch_wordpress_comments(self) -> list[dict]:
        """Fetch unanswered comments from WordPress — skips any that already have a reply from the admin."""
        wp_url  = str(get_setting("wordpress", "url", "") or "").rstrip("/")
        wp_user = str(get_setting("wordpress", "username", "") or "")
        wp_pass = str(get_setting("wordpress", "app_password", "") or "")
        if not wp_url or not wp_user or not wp_pass:
            return []
        auth = (wp_user, wp_pass)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Fetch 20 most recent approved comments
                r = await client.get(
                    f"{wp_url}/wp-json/wp/v2/comments",
                    params={"status": "approve", "per_page": 20, "orderby": "date", "order": "desc"},
                    auth=auth,
                )
                r.raise_for_status()
                all_comments = r.json()

                # Find which comment IDs already have a child reply
                replied_parents: set[int] = set()
                for c in all_comments:
                    parent = c.get("parent", 0)
                    if parent:
                        replied_parents.add(parent)

                # Also fetch current user to avoid replying to own comments
                me_r = await client.get(f"{wp_url}/wp-json/wp/v2/users/me", auth=auth)
                my_id = me_r.json().get("id", -1) if me_r.is_success else -1

                unanswered = []
                for c in all_comments:
                    if c.get("parent", 0) != 0:
                        continue  # skip — it's itself a reply
                    if c["id"] in replied_parents:
                        continue  # already has a reply
                    if c.get("author", 0) == my_id:
                        continue  # skip own comments
                    content_raw = c.get("content", {}).get("rendered", "")
                    # strip HTML tags
                    import re as _re
                    text = _re.sub(r"<[^>]+>", "", content_raw).strip()
                    if text:
                        unanswered.append({
                            "id": c["id"],
                            "post_id": c.get("post", 0),
                            "text": text,
                            "platform": "wordpress",
                            "author": c.get("author_name", ""),
                        })
            return unanswered
        except Exception as exc:
            logger.error(f"[CommentReply] WordPress fetch error: {exc}")
            return []

    async def _reply_wordpress_comment(self, comment_id: int, post_id: int, text: str) -> bool:
        wp_url  = str(get_setting("wordpress", "url", "") or "").rstrip("/")
        wp_user = str(get_setting("wordpress", "username", "") or "")
        wp_pass = str(get_setting("wordpress", "app_password", "") or "")
        auth = (wp_user, wp_pass)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{wp_url}/wp-json/wp/v2/comments",
                auth=auth,
                json={
                    "post": post_id,
                    "parent": comment_id,
                    "content": text,
                    "status": "approve",
                },
            )
            r.raise_for_status()
        logger.success(f"[CommentReply] WordPress reply posted to comment {comment_id}")
        return True

    async def _reply_facebook_comment(self, comment_id: str, text: str) -> bool:
        token = str(get_setting("facebook", "page_access_token", "") or "")
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"https://graph.facebook.com/v19.0/{comment_id}/comments",
                json={"message": text, "access_token": token}
            )
            r.raise_for_status()
        logger.success(f"[CommentReply] Facebook reply posted to {comment_id}")
        return True

    async def _reply_instagram_comment(self, comment_id: str, text: str) -> bool:
        token   = str(get_setting("instagram_posts", "page_access_token", "") or "")
        user_id = str(get_setting("instagram_posts", "instagram_user_id", "") or "")
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"https://graph.facebook.com/v19.0/{user_id}/replies",
                json={"comment_id": comment_id, "message": text, "access_token": token}
            )
            r.raise_for_status()
        logger.success(f"[CommentReply] Instagram reply posted to {comment_id}")
        return True

    async def _reply_twitter_comment(self, tweet_id: str, text: str) -> bool:
        api_key    = str(get_setting("twitter", "api_key", "") or "")
        api_secret = str(get_setting("twitter", "api_secret", "") or "")
        access_token  = str(get_setting("twitter", "access_token", "") or "")
        access_secret = str(get_setting("twitter", "access_secret", "") or "")
        if not all([api_key, api_secret, access_token, access_secret]):
            logger.warning("[CommentReply] Twitter OAuth keys missing for reply")
            return False
        # Use OAuth 1.0a via requests_oauthlib (sync — run in executor)
        import asyncio
        def _post_sync():
            from requests_oauthlib import OAuth1Session
            session = OAuth1Session(api_key, api_secret, access_token, access_secret)
            resp = session.post(
                "https://api.twitter.com/2/tweets",
                json={"text": text, "reply": {"in_reply_to_tweet_id": tweet_id}}
            )
            resp.raise_for_status()
            return True
        await asyncio.get_event_loop().run_in_executor(None, _post_sync)
        logger.success(f"[CommentReply] Twitter reply posted to {tweet_id}")
        return True

    async def _reply_youtube_comment(self, comment_thread_id: str, text: str) -> bool:
        oauth_token = str(get_setting("youtube", "oauth_access_token", "") or "")
        if not oauth_token:
            logger.warning("[CommentReply] YouTube OAuth token missing for reply")
            return False
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://www.googleapis.com/youtube/v3/comments",
                params={"part": "snippet"},
                headers={"Authorization": f"Bearer {oauth_token}"},
                json={"snippet": {"parentId": comment_thread_id, "textOriginal": text}}
            )
            r.raise_for_status()
        logger.success(f"[CommentReply] YouTube reply posted to {comment_thread_id}")
        return True

    async def _reddit_oauth_token(self) -> tuple[str, str]:
        """Return (access_token, username) for Reddit Script OAuth2, or ('', '') on failure."""
        client_id     = str(os.getenv("REDDIT_CLIENT_ID")     or get_setting("reddit", "client_id",     "")).strip()
        client_secret = str(os.getenv("REDDIT_CLIENT_SECRET") or get_setting("reddit", "client_secret", "")).strip()
        username      = str(os.getenv("REDDIT_USERNAME")      or get_setting("reddit", "username",      "")).strip()
        password      = str(os.getenv("REDDIT_PASSWORD")      or get_setting("reddit", "password",      "")).strip()
        if not all([client_id, client_secret, username, password]):
            return "", ""
        user_agent = f"python:autonomous_prime:v1.0 (by /u/{username})"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=(client_id, client_secret),
                data={"grant_type": "password", "username": username, "password": password},
                headers={"User-Agent": user_agent},
            )
            r.raise_for_status()
            token = r.json().get("access_token", "")
        return token, username

    async def _fetch_reddit_comments(self) -> list[dict]:
        """Fetch unanswered top-level comments on the authenticated user's recent Reddit submissions."""
        token, username = await self._reddit_oauth_token()
        if not token:
            logger.warning("[CommentReply] Reddit credentials not configured")
            return []
        user_agent = f"python:autonomous_prime:v1.0 (by /u/{username})"
        replied_ids = {e["id"].removeprefix("reddit_") for e in self._reply_log if e.get("platform") == "reddit"}
        comments: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                headers = {"Authorization": f"bearer {token}", "User-Agent": user_agent}
                # Get user's recent submissions
                r = await client.get(
                    f"https://oauth.reddit.com/user/{username}/submitted",
                    params={"limit": 10, "sort": "new"},
                    headers=headers,
                )
                r.raise_for_status()
                posts = r.json().get("data", {}).get("children", [])
                for post in posts:
                    post_data = post.get("data", {})
                    post_id   = post_data.get("id", "")
                    subreddit = post_data.get("subreddit", "")
                    if not post_id:
                        continue
                    # Fetch comment tree for this submission
                    cr = await client.get(
                        f"https://oauth.reddit.com/r/{subreddit}/comments/{post_id}",
                        params={"limit": 20, "depth": 1, "sort": "new"},
                        headers=headers,
                    )
                    cr.raise_for_status()
                    listing = cr.json()
                    # listing[1] is the comment listing
                    if len(listing) < 2:
                        continue
                    for child in listing[1].get("data", {}).get("children", []):
                        c = child.get("data", {})
                        cid    = c.get("id", "")
                        author = c.get("author", "")
                        body   = c.get("body", "").strip()
                        if not cid or not body or author == username or author == "[deleted]":
                            continue
                        if cid in replied_ids:
                            continue
                        comments.append({
                            "id":        cid,
                            "text":      body,
                            "platform":  "reddit",
                            "post_id":   post_id,
                            "subreddit": subreddit,
                            "author":    author,
                        })
        except Exception as exc:
            logger.error(f"[CommentReply] Reddit fetch error: {exc}")
        return comments

    async def _reply_reddit_comment(self, comment_id: str, text: str) -> bool:
        """Reply to a Reddit comment using the t1_ fullname via the OAuth2 API."""
        token, username = await self._reddit_oauth_token()
        if not token:
            logger.warning("[CommentReply] Reddit credentials missing for reply")
            return False
        user_agent = f"python:autonomous_prime:v1.0 (by /u/{username})"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://oauth.reddit.com/api/comment",
                data={"thing_id": f"t1_{comment_id}", "text": text, "api_type": "json"},
                headers={"Authorization": f"bearer {token}", "User-Agent": user_agent},
            )
            r.raise_for_status()
            errors = r.json().get("json", {}).get("errors", [])
            if errors:
                logger.warning(f"[CommentReply] Reddit reply errors: {errors}")
                return False
        logger.success(f"[CommentReply] Reddit reply posted to t1_{comment_id}")
        return True

    async def _fetch_threads_replies(self) -> list[dict]:
        """Fetch unanswered top-level replies on the authenticated user's recent Threads posts."""
        access_token = str(os.getenv("THREADS_ACCESS_TOKEN") or get_setting("threads", "access_token", "")).strip()
        user_id      = str(get_setting("threads", "user_id", "")).strip()
        if not access_token or not user_id:
            logger.warning("[CommentReply] Threads credentials not configured")
            return []
        replied_ids = {e["id"].removeprefix("threads_") for e in self._reply_log if e.get("platform") == "threads"}
        base = "https://graph.threads.net/v1.0"
        comments: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                params_base = {"access_token": access_token}
                # Get user's recent posts
                r = await client.get(
                    f"{base}/{user_id}/threads",
                    params={**params_base, "fields": "id,text,timestamp", "limit": 10},
                )
                r.raise_for_status()
                posts = r.json().get("data", [])
                for post in posts:
                    post_id = post.get("id", "")
                    if not post_id:
                        continue
                    # Fetch replies on this post
                    rr = await client.get(
                        f"{base}/{post_id}/replies",
                        params={**params_base, "fields": "id,text,timestamp,username", "limit": 20},
                    )
                    rr.raise_for_status()
                    for reply in rr.json().get("data", []):
                        rid      = reply.get("id", "")
                        text     = reply.get("text", "").strip()
                        username = reply.get("username", "")
                        if not rid or not text or rid in replied_ids:
                            continue
                        comments.append({
                            "id":       rid,
                            "text":     text,
                            "platform": "threads",
                            "post_id":  post_id,
                            "author":   username,
                        })
        except Exception as exc:
            logger.error(f"[CommentReply] Threads fetch error: {exc}")
        return comments

    async def _reply_threads_comment(self, reply_id: str, text: str) -> bool:
        """Reply to a Threads post/comment by creating a reply container and publishing it."""
        access_token = str(os.getenv("THREADS_ACCESS_TOKEN") or get_setting("threads", "access_token", "")).strip()
        user_id      = str(get_setting("threads", "user_id", "")).strip()
        if not access_token or not user_id:
            logger.warning("[CommentReply] Threads credentials missing for reply")
            return False
        base = "https://graph.threads.net/v1.0"
        async with httpx.AsyncClient(timeout=30) as client:
            # Create reply container
            cr = await client.post(
                f"{base}/{user_id}/threads",
                params={
                    "media_type": "TEXT",
                    "text": text[:500],
                    "reply_to_id": reply_id,
                    "access_token": access_token,
                },
            )
            cr.raise_for_status()
            creation_id = cr.json().get("id", "")
            if not creation_id:
                return False
            await asyncio.sleep(1)
            # Publish reply
            pub = await client.post(
                f"{base}/{user_id}/threads_publish",
                params={"creation_id": creation_id, "access_token": access_token},
            )
            pub.raise_for_status()
        logger.success(f"[CommentReply] Threads reply posted to {reply_id}")
        return True
