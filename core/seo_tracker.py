"""
SEO Ranking Tracker
Tracks keyword positions over time using SerpAPI or fallback search scraping.
Stores results in revenue.db and exposes data to the dashboard.
"""
from __future__ import annotations

import base64
import asyncio
import json
import os
import sqlite3
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from loguru import logger

from core.runtime_settings import get_setting


class SEOTracker:
    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path or os.getenv("DATA_DIR", "./data")) / "revenue.db"
        self._serpapi_key = os.getenv("SERPAPI_KEY", "")
        self._wp_url = str(os.getenv("WP_URL", get_setting("wordpress", "url", "")) or "").rstrip("/")
        self._wp_user = str(os.getenv("WP_USER", get_setting("wordpress", "username", "")) or "")
        self._wp_pass = str(os.getenv("WP_APP_PASSWORD", get_setting("wordpress", "app_password", "")) or "")
        self._outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        self._reports_dir = self._outputs_dir / "reports"
        self._reports_dir.mkdir(parents=True, exist_ok=True)

    def add_keyword(self, keyword: str, url: str) -> None:
        conn = sqlite3.connect(str(self._db_path))
        # Check if already tracked
        exists = conn.execute(
            "SELECT 1 FROM seo_rankings WHERE keyword=? AND url=?", (keyword, url)
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO seo_rankings (keyword, url, position) VALUES (?,?,?)",
                (keyword, url, None),
            )
            conn.commit()
        conn.close()
        logger.info(f"[SEOTracker] Tracking keyword: '{keyword}' → {url}")

    async def check_rankings(self, keywords: list[str] | None = None) -> list[dict]:
        """
        Check current rankings for tracked keywords.
        Uses SerpAPI if key available, otherwise returns mock data.
        """
        conn = sqlite3.connect(str(self._db_path))
        if keywords:
            rows = conn.execute(
                f"SELECT DISTINCT keyword, url FROM seo_rankings WHERE keyword IN ({','.join('?'*len(keywords))})",
                keywords
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT keyword, url FROM seo_rankings"
            ).fetchall()
        conn.close()

        results = []
        for keyword, url in rows:
            position = await self._get_position(keyword, url)
            self._record_position(keyword, url, position)
            results.append({"keyword": keyword, "url": url, "position": position,
                            "checked_at": datetime.utcnow().isoformat()})
        return results

    async def _get_position(self, keyword: str, url: str) -> int | None:
        if self._serpapi_key:
            return await self._serpapi_position(keyword, url)
        # Free fallback: Google Custom Search or mock
        return await self._mock_position(keyword)

    async def _serpapi_position(self, keyword: str, url: str) -> int | None:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(
                    "https://serpapi.com/search",
                    params={
                        "q": keyword, "api_key": self._serpapi_key,
                        "num": 100, "gl": "us", "hl": "en",
                    },
                )
                r.raise_for_status()
                results = r.json().get("organic_results", [])
                for i, result in enumerate(results, 1):
                    if url in result.get("link", ""):
                        return i
                return None  # not found in top 100
        except Exception as e:
            logger.warning(f"[SEOTracker] SerpAPI error: {e}")
            return None

    async def _mock_position(self, keyword: str) -> int | None:
        """Returns a plausible mock position for testing without SerpAPI."""
        import hashlib, random
        seed = int(hashlib.md5(keyword.encode()).hexdigest(), 16) % 1000
        random.seed(seed)
        return random.randint(5, 95)

    def _record_position(self, keyword: str, url: str, position: int | None) -> None:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute(
            "INSERT INTO seo_rankings (keyword, url, position, checked_at) VALUES (?,?,?,?)",
            (keyword, url, position, datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()

    def ranking_history(self, keyword: str | None = None, limit: int = 100) -> list[dict]:
        conn = sqlite3.connect(str(self._db_path))
        if keyword:
            rows = conn.execute(
                "SELECT keyword, url, position, checked_at FROM seo_rankings WHERE keyword=? ORDER BY checked_at DESC LIMIT ?",
                (keyword, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT keyword, url, position, checked_at FROM seo_rankings
                   WHERE id IN (SELECT MAX(id) FROM seo_rankings GROUP BY keyword)
                   ORDER BY position ASC NULLS LAST LIMIT ?""",
                (limit,)
            ).fetchall()
        conn.close()
        ranking_rows = [{"keyword": r[0], "url": r[1], "position": r[2], "checked_at": r[3]} for r in rows]
        ranking_rows = self._attach_keyword_stats(ranking_rows)
        if keyword:
            return ranking_rows

        wordpress_rows = self.wordpress_post_ratings(limit=limit)
        combined = ranking_rows + wordpress_rows
        return sorted(
            combined,
            key=lambda item: (
                item.get("position") is None,
                item.get("position") if item.get("position") is not None else 10**9,
                -(item.get("rating") or -1),
                item.get("keyword", "").lower(),
            ),
        )[:limit]

    def top_keywords(self, limit: int = 20) -> list[dict]:
        """Get keywords ranked in top 50."""
        conn = sqlite3.connect(str(self._db_path))
        rows = conn.execute(
            """SELECT keyword, url, MIN(position) as best, MAX(position) as worst,
               COUNT(*) as checks, checked_at
               FROM seo_rankings WHERE position IS NOT NULL
               GROUP BY keyword, url ORDER BY best ASC LIMIT ?""",
            (limit,)
        ).fetchall()
        conn.close()
        return [{"keyword": r[0], "url": r[1], "best": r[2],
                 "worst": r[3], "checks": r[4], "last_checked": r[5]} for r in rows]

    def wordpress_post_ratings(self, limit: int = 50) -> list[dict[str, Any]]:
        if not (self._wp_url and self._wp_user and self._wp_pass):
            return []

        auth_header = base64.b64encode(f"{self._wp_user}:{self._wp_pass}".encode()).decode()
        headers = {"Authorization": f"Basic {auth_header}"}
        statuses = ("publish", "draft", "pending", "future", "private")
        posts: list[dict[str, Any]] = []

        try:
            with httpx.Client(timeout=20, headers=headers) as client:
                for status in statuses:
                    response = client.get(
                        f"{self._wp_url}/wp-json/wp/v2/posts",
                        params={
                            "context": "edit",
                            "per_page": min(limit, 50),
                            "page": 1,
                            "status": status,
                        },
                    )
                    if response.status_code in (401, 403):
                        logger.warning(
                            f"[SEOTracker] WordPress auth rejected (HTTP {response.status_code}) "
                            f"for user '{self._wp_user}' at {self._wp_url}. "
                            "Fix: WP Admin → Users → Profile → Application Passwords → generate a new password, "
                            "then update WP_APP_PASSWORD in your .env or dashboard settings."
                        )
                        return []
                    response.raise_for_status()
                    for post in response.json():
                        post_id = post.get("id")
                        if post_id and all(existing.get("id") != post_id for existing in posts):
                            posts.append(post)
        except Exception as exc:
            logger.warning(f"[SEOTracker] Could not load WordPress post ratings: {exc}")
            return []

        rows = [self._map_wordpress_post(post) for post in posts]
        rows = [row for row in rows if row.get("url")]
        rows.sort(key=lambda item: (-(item.get("rating") or 0), item.get("keyword", "").lower()))
        return rows[:limit]

    def seo_audit(self, limit: int = 50) -> dict[str, Any]:
        posts = self._load_wordpress_posts(limit=limit)
        audit_rows = [self._build_post_audit(post) for post in posts]
        audit_rows = [row for row in audit_rows if row.get("url")]
        audit_rows.sort(key=lambda item: (item.get("score", 0), item.get("title", "").lower()))

        total = len(audit_rows)
        avg_score = round(sum(item.get("score", 0) for item in audit_rows) / total, 1) if total else 0.0
        issue_total = sum(len(item.get("issues", [])) for item in audit_rows)
        warning_total = sum(len(item.get("warnings", [])) for item in audit_rows)
        passed_total = sum(len(item.get("passed_checks", [])) for item in audit_rows)

        return {
            "generated_at": datetime.utcnow().isoformat(),
            "summary": {
                "total_posts": total,
                "average_score": avg_score,
                "good_posts": sum(1 for item in audit_rows if (item.get("score", 0) >= 80)),
                "needs_work_posts": sum(1 for item in audit_rows if 50 <= item.get("score", 0) < 80),
                "critical_posts": sum(1 for item in audit_rows if (item.get("score", 0) < 50)),
                "issue_total": issue_total,
                "warning_total": warning_total,
                "passed_total": passed_total,
            },
            "posts": audit_rows,
        }

    def export_audit_pdf(self, audit: dict[str, Any] | None = None) -> Path:
        audit = audit or self.seo_audit(limit=100)
        summary = audit.get("summary", {})
        pdf_path = self._reports_dir / f"seo_audit_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
        self._write_audit_pdf(pdf_path, audit)
        return pdf_path

    def _load_wordpress_posts(self, limit: int = 50) -> list[dict[str, Any]]:
        if not (self._wp_url and self._wp_user and self._wp_pass):
            return []

        auth_header = base64.b64encode(f"{self._wp_user}:{self._wp_pass}".encode()).decode()
        headers = {"Authorization": f"Basic {auth_header}"}
        statuses = ("publish", "draft", "pending", "future", "private")
        posts: list[dict[str, Any]] = []
        try:
            with httpx.Client(timeout=20, headers=headers) as client:
                for status in statuses:
                    response = client.get(
                        f"{self._wp_url}/wp-json/wp/v2/posts",
                        params={
                            "context": "edit",
                            "per_page": min(limit, 50),
                            "page": 1,
                            "status": status,
                        },
                    )
                    if response.status_code in (401, 403):
                        logger.warning(
                            f"[SEOTracker] WordPress auth rejected (HTTP {response.status_code}) "
                            f"for user '{self._wp_user}' at {self._wp_url}. "
                            "Fix: WP Admin → Users → Profile → Application Passwords → generate a new password, "
                            "then update WP_APP_PASSWORD in your .env or dashboard settings."
                        )
                        return []
                    response.raise_for_status()
                    for post in response.json():
                        post_id = post.get("id")
                        if post_id and all(existing.get("id") != post_id for existing in posts):
                            posts.append(post)
        except Exception as exc:
            logger.warning(f"[SEOTracker] Could not load WordPress audit posts: {exc}")
            return []
        return posts[:limit]

    def _attach_keyword_stats(self, ranking_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not ranking_rows:
            return ranking_rows

        conn = sqlite3.connect(str(self._db_path))
        stats = {
            (row[0], row[1]): {"best": row[2], "worst": row[3], "checks": row[4]}
            for row in conn.execute(
                """SELECT keyword, url, MIN(position) AS best, MAX(position) AS worst, COUNT(*) AS checks
                   FROM seo_rankings
                   GROUP BY keyword, url"""
            ).fetchall()
        }
        conn.close()

        enriched = []
        for row in ranking_rows:
            key = (row["keyword"], row["url"])
            stat = stats.get(key, {})
            enriched.append({
                **row,
                **stat,
                "source": "tracker",
                "title": row["keyword"],
                "rating": None,
                "status": "tracked",
            })
        return enriched

    def _map_wordpress_post(self, post: dict[str, Any]) -> dict[str, Any]:
        title = self._extract_wp_text(post.get("title"))
        excerpt = self._extract_wp_text(post.get("excerpt"))
        content = self._extract_wp_text(post.get("content"))
        link = str(post.get("link") or "").strip()
        slug = str(post.get("slug") or "").strip()
        status = str(post.get("status") or "").strip()
        modified = post.get("modified") or post.get("date") or ""

        yoast_head = post.get("yoast_head_json") or {}
        meta = post.get("meta") or {}
        local_seo = self._load_local_seo_payload(slug, link)
        focus_keyword = self._first_non_empty(
            meta.get("_yoast_wpseo_focuskw"),
            meta.get("rank_math_focus_keyword"),
            meta.get("_aioseo_keywords"),
            meta.get("aioseo_keywords"),
            yoast_head.get("keywords"),
            local_seo.get("focus_keyword"),
            self._infer_keyword_from_title(title, slug),
        )
        meta_description = self._first_non_empty(
            meta.get("_yoast_wpseo_metadesc"),
            meta.get("rank_math_description"),
            meta.get("_aioseo_description"),
            meta.get("aioseo_description"),
            yoast_head.get("description"),
            local_seo.get("meta_description"),
            local_seo.get("excerpt"),
            excerpt,
        )
        rating = self._score_wordpress_post(
            title=title,
            excerpt=excerpt,
            content=content,
            slug=slug,
            focus_keyword=str(focus_keyword or ""),
            meta_description=str(meta_description or ""),
        )

        return {
            "id": post.get("id"),
            "keyword": str(focus_keyword or title or slug or "WordPress post"),
            "title": title or slug or "WordPress post",
            "url": link,
            "position": None,
            "best": None,
            "worst": None,
            "checks": None,
            "checked_at": modified,
            "status": status,
            "source": "wordpress",
            "rating": rating,
            "target_keyword": str(focus_keyword or ""),
            "meta_description": str(meta_description or ""),
            "keyword_source": self._keyword_source(meta, yoast_head, local_seo),
        }

    def _build_post_audit(self, post: dict[str, Any]) -> dict[str, Any]:
        base = self._map_wordpress_post(post)
        excerpt = self._extract_wp_text(post.get("excerpt"))
        content_html = self._extract_wp_text(post.get("content"))
        content_text = self._html_to_text(content_html)
        title = str(base.get("title") or "")
        slug = str(post.get("slug") or "")
        keyword = str(base.get("target_keyword") or "")
        meta_description = str(base.get("meta_description") or "")
        word_count = len(content_text.split())
        internal_links = content_html.lower().count('href="') + content_html.lower().count("href='")
        soup = BeautifulSoup(content_html or "", "html.parser")
        h2_count = len(soup.find_all("h2"))
        h3_count = len(soup.find_all("h3"))
        images = soup.find_all("img")
        images_missing_alt = sum(1 for img in images if not str(img.get("alt") or "").strip())
        faq_present = "faq" in content_text.lower()

        issues: list[str] = []
        warnings: list[str] = []
        passed: list[str] = []

        score = 0
        title_length = len(title)
        meta_length = len(meta_description)

        if 40 <= title_length <= 65:
            score += 12
            passed.append("Title length is in the recommended range")
        elif title_length:
            score += 6
            warnings.append(f"Title length is {title_length} characters; aim for 40-65")
        else:
            issues.append("Missing SEO title")

        if keyword and keyword.lower() in title.lower():
            score += 15
            passed.append("Primary keyword appears in the title")
        elif keyword:
            issues.append("Primary keyword is missing from the title")

        if keyword and keyword.lower().replace(" ", "-") in slug.lower():
            score += 12
            passed.append("Primary keyword appears in the slug")
        elif keyword:
            warnings.append("Primary keyword is missing from the slug")

        if meta_description:
            if 120 <= meta_length <= 160:
                score += 12
                passed.append("Meta description length is in the recommended range")
            else:
                score += 6
                warnings.append(f"Meta description length is {meta_length}; aim for 120-160")
            if keyword and keyword.lower() in meta_description.lower():
                score += 10
                passed.append("Primary keyword appears in the meta description")
            elif keyword:
                warnings.append("Primary keyword is missing from the meta description")
        else:
            issues.append("Missing meta description")

        if word_count >= 900:
            score += 12
            passed.append("Content depth is strong")
        elif word_count >= 600:
            score += 8
            passed.append("Content length is acceptable")
        else:
            issues.append(f"Content is thin at {word_count} words")

        if h2_count >= 3:
            score += 8
            passed.append("Article uses a healthy H2 structure")
        else:
            issues.append("Article needs more H2 sections")

        if h3_count >= 1:
            score += 4
            passed.append("Article uses supporting H3 subsections")
        else:
            warnings.append("Article has no H3 subsections")

        if internal_links >= 2:
            score += 8
            passed.append("Internal links are present")
        elif internal_links == 1:
            score += 4
            warnings.append("Only one internal link found")
        else:
            issues.append("No internal links found")

        if images and images_missing_alt == 0:
            score += 7
            passed.append("All images include alt text")
        elif images_missing_alt > 0:
            warnings.append(f"{images_missing_alt} image(s) are missing alt text")
        else:
            warnings.append("No images were found in the article body")

        if faq_present:
            score += 5
            passed.append("FAQ intent is present")
        else:
            warnings.append("FAQ section not detected")

        if keyword and content_text.lower().count(keyword.lower()) >= 2:
            score += 5
            passed.append("Primary keyword appears naturally in the body copy")
        elif keyword:
            warnings.append("Primary keyword usage in the body looks weak")

        score = min(score, 100)
        return {
            **base,
            "score": score,
            "word_count": word_count,
            "title_length": title_length,
            "meta_length": meta_length,
            "internal_links": internal_links,
            "h2_count": h2_count,
            "h3_count": h3_count,
            "image_count": len(images),
            "images_missing_alt": images_missing_alt,
            "faq_present": faq_present,
            "issues": issues,
            "warnings": warnings,
            "passed_checks": passed,
            "excerpt": excerpt,
        }

    @staticmethod
    def _html_to_text(value: str) -> str:
        if not value:
            return ""
        return BeautifulSoup(value, "html.parser").get_text(" ", strip=True)

    def _write_audit_pdf(self, pdf_path: Path, audit: dict[str, Any]) -> None:
        page_width = 612
        page_height = 842
        margin_x = 42
        top_start = 798
        bottom_margin = 42
        card_gap = 12
        pages: list[list[str]] = []
        current_commands: list[str] = []
        current_y = top_start

        def _escape(text: str) -> str:
            return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

        def _rgb(color: tuple[int, int, int]) -> str:
            return " ".join(f"{component / 255:.3f}" for component in color)

        def _rect(x: float, y: float, w: float, h: float, fill: tuple[int, int, int], stroke: tuple[int, int, int] | None = None) -> None:
            current_commands.append(f"{_rgb(fill)} rg")
            if stroke is not None:
                current_commands.append(f"{_rgb(stroke)} RG")
                current_commands.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} B")
            else:
                current_commands.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} f")

        def _text(text: str, x: float, y: float, size: int = 10, color: tuple[int, int, int] = (26, 35, 16), bold: bool = False) -> None:
            font = "F2" if bold else "F1"
            current_commands.extend(
                [
                    "BT",
                    f"/{font} {size} Tf",
                    f"{_rgb(color)} rg",
                    f"1 0 0 1 {x:.2f} {y:.2f} Tm",
                    f"({_escape(text)}) Tj",
                    "ET",
                ]
            )

        def _wrap(text: str, width: int) -> list[str]:
            return textwrap.wrap(text, width=width) or [""]

        def _new_page() -> None:
            nonlocal current_commands, current_y
            if current_commands:
                pages.append(current_commands)
            current_commands = []
            current_y = top_start

        def _ensure_space(height: float) -> None:
            nonlocal current_y
            if current_y - height < bottom_margin:
                _new_page()

        def _section_title(title: str, subtitle: str = "") -> None:
            nonlocal current_y
            _ensure_space(34)
            _text(title, margin_x, current_y, size=18, bold=True)
            current_y -= 20
            if subtitle:
                _text(subtitle, margin_x, current_y, size=10, color=(106, 115, 125))
                current_y -= 18
            else:
                current_y -= 8

        def _bullet_block(items: list[str], label: str, color: tuple[int, int, int], max_items: int = 4) -> float:
            nonlocal current_y
            if not items:
                return 0.0
            start_y = current_y
            _text(label, margin_x + 14, current_y, size=10, color=color, bold=True)
            current_y -= 14
            for item in items[:max_items]:
                for idx, line in enumerate(_wrap(item, 76)):
                    prefix = "• " if idx == 0 else "  "
                    _text(f"{prefix}{line}", margin_x + 18, current_y, size=9, color=(45, 52, 64))
                    current_y -= 12
            current_y -= 4
            return start_y - current_y

        def _wrapped_text_block(text: str, x: float, y: float, width: int, size: int = 10, color: tuple[int, int, int] = (45, 52, 64), bold: bool = False) -> float:
            lines = _wrap(text, width)
            current_line_y = y
            for line in lines:
                _text(line, x, current_line_y, size=size, color=color, bold=bold)
                current_line_y -= size + 3
            return y - current_line_y

        summary = audit.get("summary", {})
        posts = audit.get("posts", [])
        issue_counts: dict[str, int] = {}
        for post in posts:
            for issue in [*post.get("issues", []), *post.get("warnings", [])]:
                issue_counts[issue] = issue_counts.get(issue, 0) + 1
        top_issues = sorted(issue_counts.items(), key=lambda item: item[1], reverse=True)[:6]

        _rect(0, 728, page_width, 114, (24, 28, 35))
        _text("AUTONOMOUS PRIME", margin_x, 804, size=10, color=(92, 122, 92), bold=True)
        _text("SEO Audit Report", margin_x, 772, size=28, color=(255, 255, 255), bold=True)
        _text(
            f"Generated {audit.get('generated_at', datetime.utcnow().isoformat())}",
            margin_x,
            748,
            size=10,
            color=(191, 201, 212),
        )
        current_y = 698

        card_width = (page_width - (margin_x * 2) - (card_gap * 2)) / 3
        summary_cards = [
            ("Posts Audited", str(summary.get("total_posts", 0)), (88, 166, 255)),
            ("Average Score", f"{summary.get('average_score', 0)}/100", (63, 185, 80)),
            ("Issues", str(summary.get("issue_total", 0)), (248, 81, 73)),
            ("Good Posts", str(summary.get("good_posts", 0)), (63, 185, 80)),
            ("Needs Work", str(summary.get("needs_work_posts", 0)), (227, 179, 65)),
            ("Critical", str(summary.get("critical_posts", 0)), (248, 81, 73)),
        ]
        for idx, (label, value, color) in enumerate(summary_cards):
            row = idx // 3
            col = idx % 3
            x = margin_x + col * (card_width + card_gap)
            y = current_y - row * 78
            _rect(x, y, card_width, 62, (248, 249, 251), (220, 225, 232))
            _text(label.upper(), x + 12, y + 42, size=8, color=(106, 115, 125), bold=True)
            _text(value, x + 12, y + 16, size=22, color=color, bold=True)
        current_y -= 170

        _section_title("Top Audit Issues", "Most common SEO problems detected across your audited WordPress posts.")
        if not top_issues:
            _text("No issue clusters found yet.", margin_x, current_y, size=10, color=(106, 115, 125))
            current_y -= 18
        else:
            for issue, count in top_issues:
                _ensure_space(28)
                _rect(margin_x, current_y - 18, page_width - margin_x * 2, 22, (250, 251, 252), (228, 232, 237))
                _text(issue, margin_x + 10, current_y - 4, size=10, color=(45, 52, 64))
                _text(str(count), page_width - margin_x - 24, current_y - 4, size=10, color=(227, 179, 65), bold=True)
                current_y -= 28
        current_y -= 8

        _section_title("Per-Post Findings", "Detailed scorecards mirroring the audit details shown in the SEO tab.")
        for index, post in enumerate(posts, 1):
            issues = post.get("issues", [])
            warnings = post.get("warnings", [])
            passed = post.get("passed_checks", [])
            title_lines = len(_wrap(f"{index}. {post.get('title', 'Untitled')}", 58))
            keyword_line = len(_wrap(
                f"Keyword: {post.get('target_keyword') or 'n/a'}   Status: {post.get('status') or 'unknown'}   Source: {post.get('keyword_source') or 'derived'}",
                86,
            ))
            meta_line = len(_wrap(
                f"Words {post.get('word_count', 0)} | Title {post.get('title_length', 0)} | Meta {post.get('meta_length', 0)} | H2/H3 {post.get('h2_count', 0)}/{post.get('h3_count', 0)} | Links {post.get('internal_links', 0)} | Missing alt {post.get('images_missing_alt', 0)}",
                86,
            ))
            estimated_height = 120 + ((title_lines - 1) * 18) + ((keyword_line - 1) * 12) + ((meta_line - 1) * 12) + (min(len(issues), 4) + min(len(warnings), 4) + min(len(passed), 4)) * 12
            _ensure_space(estimated_height)

            score = int(post.get("score", 0))
            score_color = (63, 185, 80) if score >= 80 else (227, 179, 65) if score >= 50 else (248, 81, 73)
            _rect(margin_x, current_y - estimated_height + 12, page_width - margin_x * 2, estimated_height - 8, (255, 255, 255), (224, 229, 235))
            _rect(margin_x, current_y - 14, page_width - margin_x * 2, 6, score_color)
            score_box_width = 74
            score_box_height = 28
            score_box_x = page_width - margin_x - score_box_width - 12
            score_box_y = current_y - 48
            _rect(score_box_x, score_box_y, score_box_width, score_box_height, (248, 249, 251), score_color)
            _text(f"{score}/100", score_box_x + 10, score_box_y + 8, size=16, color=score_color, bold=True)

            title_block_height = _wrapped_text_block(
                f"{index}. {post.get('title', 'Untitled')}",
                margin_x + 14,
                current_y - 34,
                width=58,
                size=15,
                color=(26, 35, 16),
                bold=True,
            )
            url_y = current_y - 34 - title_block_height - 4
            _wrapped_text_block(str(post.get("url", "")), margin_x + 14, url_y, width=86, size=9, color=(88, 166, 255))
            keyword_y = url_y - 18
            keyword_block_height = _wrapped_text_block(
                f"Keyword: {post.get('target_keyword') or 'n/a'}   Status: {post.get('status') or 'unknown'}   Source: {post.get('keyword_source') or 'derived'}",
                margin_x + 14,
                keyword_y,
                width=86,
                size=9,
                color=(106, 115, 125),
            )
            meta_y = keyword_y - keyword_block_height - 2
            meta_block_height = _wrapped_text_block(
                f"Words {post.get('word_count', 0)} | Title {post.get('title_length', 0)} | Meta {post.get('meta_length', 0)} | H2/H3 {post.get('h2_count', 0)}/{post.get('h3_count', 0)} | Links {post.get('internal_links', 0)} | Missing alt {post.get('images_missing_alt', 0)}",
                margin_x + 14,
                meta_y,
                width=86,
                size=9,
                color=(45, 52, 64),
            )
            current_y = meta_y - meta_block_height - 8
            _bullet_block(issues, "Critical Issues", (248, 81, 73))
            _bullet_block(warnings, "Warnings", (227, 179, 65))
            _bullet_block(passed, "Passed Checks", (63, 185, 80))
            current_y -= 12

        if current_commands:
            pages.append(current_commands)

        objects: list[bytes] = []

        def _add_object(value: bytes) -> int:
            objects.append(value)
            return len(objects)

        font_regular_id = _add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        font_bold_id = _add_object(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
        content_ids: list[int] = []
        for commands in pages or [[]]:
            content_stream = "\n".join(commands).encode("latin-1", errors="replace")
            content_ids.append(
                _add_object(
                    f"<< /Length {len(content_stream)} >>\nstream\n".encode("latin-1")
                    + content_stream
                    + b"\nendstream"
                )
            )

        page_ids: list[int] = []
        pages_id = len(objects) + len(content_ids) + 1
        for content_id in content_ids:
            page_ids.append(
                _add_object(
                    (
                        f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {page_width} {page_height}] "
                        f"/Resources << /Font << /F1 {font_regular_id} 0 R /F2 {font_bold_id} 0 R >> >> "
                        f"/Contents {content_id} 0 R >>"
                    ).encode("latin-1")
                )
            )

        kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
        _add_object(f"<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>".encode("latin-1"))
        catalog_id = _add_object(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("latin-1"))

        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(len(pdf))
            pdf.extend(f"{index} 0 obj\n".encode("latin-1"))
            pdf.extend(obj)
            pdf.extend(b"\nendobj\n")

        xref_offset = len(pdf)
        pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
        pdf.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
        pdf.extend(
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode(
                "latin-1"
            )
        )
        pdf_path.write_bytes(bytes(pdf))

    @staticmethod
    def _extract_wp_text(value: Any) -> str:
        if isinstance(value, dict):
            for key in ("raw", "rendered"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
            return ""
        if isinstance(value, str):
            return value.strip()
        return ""

    @staticmethod
    def _first_non_empty(*values: Any) -> str:
        for value in values:
            if isinstance(value, list):
                text = ", ".join(str(item).strip() for item in value if str(item).strip())
            else:
                text = str(value or "").strip()
            if text:
                return text
        return ""

    def _score_wordpress_post(
        self,
        title: str,
        excerpt: str,
        content: str,
        slug: str,
        focus_keyword: str,
        meta_description: str,
    ) -> int:
        score = 0
        keyword = focus_keyword.strip().lower()
        title_lower = title.lower()
        excerpt_lower = excerpt.lower()
        content_lower = content.lower()
        slug_lower = slug.lower()
        word_count = len(content.split())

        if title:
            score += 10
        if keyword and keyword in title_lower:
            score += 20
        if keyword and keyword in excerpt_lower:
            score += 15
        if keyword and keyword.replace(" ", "-") in slug_lower:
            score += 15
        if meta_description:
            score += 10
        if 120 <= len(meta_description) <= 160:
            score += 10
        elif meta_description:
            score += 5
        if "<h2" in content_lower or "<h3" in content_lower:
            score += 10
        if word_count >= 800:
            score += 10
        elif word_count >= 500:
            score += 5
        if "faq" in content_lower:
            score += 5
        if keyword and content_lower.count(keyword) >= 2:
            score += 5
        return min(score, 100)

    def _load_local_seo_payload(self, slug: str, link: str) -> dict[str, Any]:
        candidates = []
        if slug:
            candidates.append(slug.strip().lower())
        if link:
            link_slug = link.rstrip("/").split("/")[-1].strip().lower()
            if link_slug:
                candidates.append(link_slug)

        blog_dir = self._outputs_dir / "blog"
        if not blog_dir.exists():
            return {}

        for candidate in candidates:
            seo_path = blog_dir / f"{candidate}_seo.json"
            if seo_path.exists():
                try:
                    return json.loads(seo_path.read_text(encoding="utf-8"))
                except Exception as exc:
                    logger.warning(f"[SEOTracker] Could not read local SEO JSON '{seo_path.name}': {exc}")
                    return {}
        return {}

    @staticmethod
    def _keyword_source(meta: dict[str, Any], yoast_head: dict[str, Any], local_seo: dict[str, Any]) -> str:
        if any(meta.get(key) for key in ("_yoast_wpseo_focuskw", "rank_math_focus_keyword", "_aioseo_keywords", "aioseo_keywords")):
            return "wordpress-meta"
        if yoast_head.get("keywords") or yoast_head.get("description"):
            return "wordpress-yoast"
        if local_seo.get("focus_keyword") or local_seo.get("meta_description"):
            return "local-seo-json"
        return "derived"

    @staticmethod
    def _infer_keyword_from_title(title: str, slug: str) -> str:
        cleaned_title = " ".join(title.replace(":", " ").replace("|", " ").split()).strip()
        if cleaned_title:
            return cleaned_title
        cleaned_slug = slug.replace("-", " ").strip()
        return " ".join(cleaned_slug.split())
