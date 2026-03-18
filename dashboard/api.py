"""
Autonomous Prime — FastAPI Dashboard API
Serves React UI + WebSocket live updates + all REST endpoints
"""
import asyncio
import base64
import csv
import json
import os
import re
import subprocess
import wave
from datetime import datetime
from io import BytesIO, StringIO
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import httpx
from loguru import logger
from pydantic import BaseModel, Field

from core.commerce_client import CommerceClient
from core.member_store import MemberStore
from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import SECRET_MASK, apply_settings_to_env, as_bool, get_setting, load_settings, save_settings as persist_settings
from core.supabase_auth import get_user_from_token, is_configured as supabase_is_configured


def _normalize_service_url(value: str | None, default: str) -> str:
    raw = str(value or default).strip().rstrip("/")
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


def _coqui_model_supports_voice_clone(model_name: str) -> bool:
    model = str(model_name or "").strip().lower()
    return any(token in model for token in ("xtts", "your_tts", "tortoise", "bark"))


def _find_funnel_folder(funnels_dir: Path, slug: str) -> Path | None:
    """Find the most recent funnel folder whose name contains the given slug."""
    if not funnels_dir.exists():
        return None
    candidates = sorted(funnels_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    for folder in candidates:
        if not folder.is_dir():
            continue
        # Strip timestamp prefix to get the slug portion
        name_slug = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
        if name_slug == slug or folder.name == slug:
            return folder
    # Fuzzy fallback — slug words present in folder name
    slug_words = [w for w in slug.split("-") if len(w) > 3]
    for folder in candidates:
        if not folder.is_dir():
            continue
        if slug_words and all(w in folder.name for w in slug_words[:2]):
            return folder
    return None


def _build_test_wav_bytes(duration_ms: int = 300) -> bytes:
    frame_rate = 16000
    frame_count = max(int(frame_rate * (duration_ms / 1000.0)), 1)
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(frame_rate)
        wav.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()

# ── Request models MUST be at module level so FastAPI can resolve type hints ──
class TaskReq(BaseModel):
    type: str
    payload: dict = Field(default_factory=dict)
    priority: int = 2
    agent_hint: str | None = None

class PipelineReq(BaseModel):
    topic: str
    keywords: list[str] = Field(default_factory=list)
    aspect_ratio: str = "16:9"
    job_id: str = ""
    job_run_id: str = ""
    workspace_id: str = ""
    brand_id: str | None = ""
    input_payload: dict = Field(default_factory=dict)

class SlideItemReq(BaseModel):
    title: str = ""
    image_prompt: str = ""
    negative_prompt: str = ""
    image_path: str = ""
    voiceover_text: str = ""
    audio_path: str = ""
    caption: str = ""
    pause_after_s: int = 1

class SlidePipelineReq(BaseModel):
    topic: str
    aspect_ratio: str = "16:9"
    slides: list[SlideItemReq] = Field(default_factory=list)

class SlideMediaUploadReq(BaseModel):
    filename: str
    slide_index: int
    media_kind: str
    content_base64: str

class RevenueReq(BaseModel):
    source: str = "manual"
    amount_cents: int = 0
    description: str = ""
    metadata: dict | None = None

class CtaPreviewReq(BaseModel):
    platform: str
    cta_text: str
    cta_link: str
    cta_type: str = "direct_link"
    pinned_comment_enabled: bool = False

class CommerceTrackClickReq(BaseModel):
    post_id: str = ""
    platform: str = ""
    cta_id: str = ""
    landing_page_id: str = ""
    offer_id: str = ""

class CheckoutReq(BaseModel):
    price_id: str
    post_id: str = ""
    platform: str = ""
    cta_id: str = ""
    landing_page_id: str = ""
    offer_id: str = ""
    success_url: str = ""
    cancel_url: str = ""


class OfferReq(BaseModel):
    name: str
    stripe_product_id: str = ""
    stripe_price_id: str = ""
    landing_page_id: str = ""


class LandingPageReq(BaseModel):
    id: str = ""
    name: str
    slug: str
    url: str
    template: str = "offer"
    content: dict = Field(default_factory=dict)
    hero_title: str = ""
    hero_subtitle: str = ""
    cta_text: str = ""
    cta_link: str = ""
    offer_summary: str = ""
    benefits: list[str] = Field(default_factory=list)
    includes: list[str] = Field(default_factory=list)
    faq_items: list[dict] = Field(default_factory=list)
    proof_points: list[str] = Field(default_factory=list)
    theme: dict = Field(default_factory=dict)


class PublicLandingCheckoutReq(BaseModel):
    post_id: str = ""
    platform: str = ""
    cta_id: str = ""
    offer_id: str = ""
    success_url: str = ""
    cancel_url: str = ""

class SocialPostReq(BaseModel):
    platform: str = "twitter"
    text: str = ""
    topic: str = ""

class EbookChapterReq(BaseModel):
    title: str
    description: str = ""
    image_prompt: str = ""

class EbookReq(BaseModel):
    topic: str
    style: str = "how_to_guide"
    theme: str = "dark"
    chapter_count: int = 5
    words_per_chapter: int = 400
    keywords: list[str] = Field(default_factory=list)
    cover_prompt: str = ""
    author_name: str = ""
    cta_text: str = ""
    cta_url: str = ""
    cta_button: str = ""
    chapter_images: bool = False
    chapters: list[EbookChapterReq] = Field(default_factory=list)

class EbookOutlineReq(BaseModel):
    topic: str
    style: str = "how_to_guide"
    chapter_count: int = 5
    keywords: list[str] = Field(default_factory=list)

class CalendarEntryReq(BaseModel):
    platform: str
    content_type: str
    scheduled_at: str
    title: str = ""
    text: str = ""
    payload: dict = Field(default_factory=dict)

class ApprovalReq(BaseModel):
    id: int
    approved: bool = True

class SeoTrackReq(BaseModel):
    keyword: str
    url: str

class SeoCheckReq(BaseModel):
    keywords: list[str] | None = None

class AgentChatReq(BaseModel):
    agent_id: str
    message: str
    use_local: bool = True

class UnifiedChatReq(BaseModel):
    message: str
    history: list[dict] = Field(default_factory=list)

class SettingsReq(BaseModel):
    openclaw: dict = Field(default_factory=dict)
    wordpress: dict = Field(default_factory=dict)
    tool_routing: dict = Field(default_factory=dict)
    comfyui: dict = Field(default_factory=dict)
    coqui: dict = Field(default_factory=dict)
    elevenlabs: dict = Field(default_factory=dict)
    edge_tts: dict = Field(default_factory=dict)
    deepgram: dict = Field(default_factory=dict)
    abacus: dict = Field(default_factory=dict)
    ffmpeg: dict = Field(default_factory=dict)
    serpapi: dict = Field(default_factory=dict)
    commerce: dict = Field(default_factory=dict)
    social_calendar: dict = Field(default_factory=dict)
    social_scheduler: dict = Field(default_factory=dict)
    prompts: dict = Field(default_factory=dict)
    approvals: dict = Field(default_factory=dict)
    automation: dict = Field(default_factory=dict)
    video: dict = Field(default_factory=dict)
    x: dict = Field(default_factory=dict)
    facebook: dict = Field(default_factory=dict)
    facebook_groups: dict = Field(default_factory=dict)
    linkedin: dict = Field(default_factory=dict)
    instagram_posts: dict = Field(default_factory=dict)
    youtube: dict = Field(default_factory=dict)
    tiktok: dict = Field(default_factory=dict)
    instagram: dict = Field(default_factory=dict)


# ── Provider verification persistence ─────────────────────────────────────────
PROVIDER_VERIFICATIONS_FILE = Path("data/provider_verifications.json")


def _load_provider_verifications() -> dict:
    try:
        if PROVIDER_VERIFICATIONS_FILE.exists():
            return json.loads(PROVIDER_VERIFICATIONS_FILE.read_text(encoding="utf-8") or "{}")
    except Exception:
        return {}
    return {}


def _save_provider_verifications(data: dict) -> None:
    PROVIDER_VERIFICATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROVIDER_VERIFICATIONS_FILE.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

# ─────────────────────────────────────────────────────────────────────────────

_openclaw = None


def create_app(openclaw) -> FastAPI:
    global _openclaw
    _openclaw = openclaw

    app = FastAPI(
        title="Autonomous Prime API",
        description="OpenClaw business orchestrator — REST + WebSocket",
        version="1.0.0",
    )
    saas_base_url = _normalize_service_url(os.getenv("SAAS_API_URL"), "http://localhost:3001/saas")

    # ── CORS ─────────────────────────────────────────────────────────────────
    _allowed_origins = [
        "http://localhost:5173",   # Vite dev server
        "http://localhost:5174",   # Vite alt port
        "http://localhost:3001",   # Node SaaS API
    ]
    _prod_url = os.getenv("PRODUCTION_URL", "").strip().rstrip("/")
    if _prod_url:
        _allowed_origins.append(_prod_url)

    logger.info("CORS allowed origins: %s", _allowed_origins)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "x-internal-token"],
    )

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        path = request.url.path
        exempt_prefixes = (
            "/api/auth/config",
            "/api/status",
            "/api/internal/",
            "/api/commerce/public/landing/",
            "/api/subscribe/",
            "/outputs/",
            "/assets/",
            "/p/",
        )
        if not path.startswith("/api") or path.startswith(exempt_prefixes):
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        # Internal service calls (funnel agent, etc.) — bypass auth
        _internal_token = os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal")
        if request.headers.get("x-internal-token") == _internal_token:
            request.state.user = {"id": "internal", "email": "internal@localhost", "role": "admin"}
            return await call_next(request)

        if not supabase_is_configured():
            # Dev stub — no auth configured, pass through with a local dev user
            request.state.user = {"id": "dev-user", "email": "dev@localhost", "role": "admin"}
            return await call_next(request)

        auth_header = str(request.headers.get("authorization", "") or "").strip()
        if not auth_header.lower().startswith("bearer "):
            return JSONResponse(status_code=401, content={"detail": "Missing bearer token"})

        token = auth_header.split(" ", 1)[1].strip()
        user = await get_user_from_token(token)
        if not user:
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired Supabase token"})

        request.state.user = user
        return await call_next(request)

    # ── Static assets (React build) ───────────────────────────────────────────
    static_dir = Path(__file__).parent / "static"
    assets_dir = static_dir / "assets"
    outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    if outputs_dir.exists():
        app.mount("/outputs", StaticFiles(directory=str(outputs_dir)), name="outputs")

    # ── Funnel page server (/p/{slug} and /p/{slug}/thankyou) ─────────────────
    funnels_dir = outputs_dir / "funnels"

    @app.get("/p/{slug}", response_class=HTMLResponse, include_in_schema=False)
    async def serve_landing_page(slug: str):
        if not funnels_dir.exists():
            raise HTTPException(status_code=404, detail="No pages found")
        # Find the most recent funnel folder matching the slug
        folder = _find_funnel_folder(funnels_dir, slug)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Page '{slug}' not found")
        page = folder / "landing_page.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="Landing page not found")
        return HTMLResponse(content=page.read_text(encoding="utf-8"))

    @app.get("/p/{slug}/thankyou", response_class=HTMLResponse, include_in_schema=False)
    async def serve_thankyou_page(slug: str):
        if not funnels_dir.exists():
            raise HTTPException(status_code=404, detail="No pages found")
        folder = _find_funnel_folder(funnels_dir, slug)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Page '{slug}' not found")
        page = folder / "thankyou_page.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="Thank-you page not found")
        return HTMLResponse(content=page.read_text(encoding="utf-8"))

    # ── Sales page server (/s/{slug} and /s/{slug}/thankyou) ──────────────────

    def _find_sales_folder(slug: str) -> Path | None:
        """Find the most recent sales folder matching the slug."""
        if not funnels_dir.exists():
            return None
        candidates = sorted(
            [p for p in funnels_dir.iterdir() if p.is_dir() and p.name.endswith("_sales")],
            key=lambda p: p.stat().st_mtime, reverse=True,
        )
        for folder in candidates:
            # Strip timestamp prefix and _sales suffix to get slug
            name = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
            name_slug = name[:-6] if name.endswith("_sales") else name  # remove _sales
            if name_slug == slug or folder.name == slug:
                return folder
        # Fuzzy: slug words present
        slug_words = [w for w in slug.split("-") if len(w) > 3]
        for folder in candidates:
            if slug_words and all(w in folder.name for w in slug_words[:2]):
                return folder
        return None

    @app.get("/s/{slug}", response_class=HTMLResponse, include_in_schema=False)
    async def serve_sales_page(slug: str):
        folder = _find_sales_folder(slug)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Sales page '{slug}' not found")
        page = folder / "sales_page.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="Sales page not found")
        return HTMLResponse(content=page.read_text(encoding="utf-8"))

    @app.get("/s/{slug}/thankyou", response_class=HTMLResponse, include_in_schema=False)
    async def serve_sales_thankyou_page(slug: str):
        folder = _find_sales_folder(slug)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Sales page '{slug}' not found")
        page = folder / "sales_thankyou_page.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="Sales thank-you page not found")
        return HTMLResponse(content=page.read_text(encoding="utf-8"))

    # ── Products ──────────────────────────────────────────────────────────────

    _products_db = Path(os.getenv("DATA_DIR", "./data")) / "products.db"

    def _get_products_conn():
        import sqlite3 as _sq
        if not _products_db.exists():
            return None
        conn = _sq.connect(str(_products_db))
        conn.row_factory = _sq.Row
        return conn

    @app.get("/api/products")
    async def list_products(status: str = ""):
        """List all products from the product catalog."""
        conn = _get_products_conn()
        if not conn:
            return {"products": []}
        try:
            if status:
                rows = conn.execute(
                    "SELECT * FROM products WHERE status=? ORDER BY created_at DESC", [status]
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM products ORDER BY created_at DESC"
                ).fetchall()
            products = []
            for r in rows:
                d = dict(r)
                try:
                    d["chapters"] = json.loads(d.get("chapters_json") or "[]")
                except Exception:
                    d["chapters"] = []
                products.append(d)
            return {"products": products}
        finally:
            conn.close()

    @app.post("/api/products/ideate")
    async def ideate_products(request: Request):
        """Generate product ideas for a niche via the product agent."""
        body = await request.json()
        task_id = await openclaw.submit(
            "product_ideate",
            {
                "niche":           body.get("niche", ""),
                "target_audience": body.get("target_audience", ""),
                "pain_point":      body.get("pain_point", ""),
                "offer_type":      body.get("offer_type", ""),
            },
            agent_hint="product_agent",
        )
        return {"task_id": task_id, "status": "queued"}

    @app.post("/api/products/{product_id}/build")
    async def build_product(product_id: int, request: Request):
        """Trigger full product creation for an ideated product."""
        body = await request.json()
        result = await openclaw.submit(
            "product_create",
            {"product_id": product_id, **body},
            agent_hint="product_agent",
        )
        return result or {"queued": True, "product_id": product_id}

    @app.delete("/api/products/{product_id}")
    async def delete_product(product_id: int):
        """Delete a product record."""
        conn = _get_products_conn()
        if not conn:
            raise HTTPException(status_code=404, detail="Products DB not found")
        try:
            conn.execute("DELETE FROM products WHERE id=?", [product_id])
            conn.commit()
        finally:
            conn.close()
        return {"deleted": product_id}

    @app.patch("/api/products/{product_id}")
    async def update_product(product_id: int, request: Request):
        """Update product fields (e.g. stripe_url, status)."""
        body = await request.json()
        allowed = {"stripe_url", "price_point", "status", "tagline", "name"}
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            return {"updated": 0}
        conn = _get_products_conn()
        if not conn:
            raise HTTPException(status_code=404, detail="Products DB not found")
        try:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(f"UPDATE products SET {sets} WHERE id=?",
                         [*updates.values(), product_id])
            conn.commit()
        finally:
            conn.close()
        return {"updated": product_id}

    @app.post("/api/products/{product_id}/generate-pdf")
    async def generate_product_pdf(product_id: int):
        """Generate (or re-generate) the PDF for an existing built product."""
        conn = _get_products_conn()
        if not conn:
            raise HTTPException(status_code=404, detail="Products DB not found")
        try:
            row = conn.execute("SELECT * FROM products WHERE id=?", [product_id]).fetchone()
        finally:
            conn.close()

        if not row:
            raise HTTPException(status_code=404, detail="Product not found")

        ebook_url = row["ebook_url"] if hasattr(row, "__getitem__") else dict(row).get("ebook_url", "")
        if not ebook_url:
            raise HTTPException(status_code=400, detail="Product has no HTML file yet — build it first")

        # Resolve the HTML file path from the URL  (/outputs/products/…/product.html)
        html_path = Path(".") / ebook_url.lstrip("/")
        if not html_path.exists():
            raise HTTPException(status_code=404, detail=f"HTML file not found at {html_path}")

        try:
            from xhtml2pdf import pisa
        except ImportError:
            raise HTTPException(status_code=501, detail="xhtml2pdf is not installed. Run: pip install xhtml2pdf")

        try:
            import json as _json
            import re as _re
            from agents.product_agent import _write_pdf, PRODUCT_TYPE_LABELS

            meta_path = html_path.parent / "product_meta.json"
            meta = _json.loads(meta_path.read_text()) if meta_path.exists() else {}
            accent = meta.get("accent_color", "#58a6ff")
            pdf_path = html_path.with_suffix(".pdf")

            # If full content was saved in meta (products built after the fix), use it
            if meta.get("introduction") or meta.get("chapters"):
                content = {k: meta.get(k, "") for k in
                           ("title", "subtitle", "introduction", "chapters",
                            "conclusion", "key_takeaways", "bonus_tip")}
                pdf_url_result = _write_pdf(html_path, pdf_path, content, meta, accent)
            else:
                # Older products: strip the dark-mode <style> block entirely and
                # inject a clean xhtml2pdf-compatible print stylesheet instead.
                raw_html = html_path.read_text(encoding="utf-8")

                print_css = f"""<style>
@page {{ size: A4; margin: 2.5cm 2cm; }}
body {{ font-family: Georgia, serif; color: #1a1a1a; line-height: 1.7; font-size: 11pt; background: #fff; }}
h1 {{ font-size: 24pt; color: {accent}; margin-bottom: 8pt; font-family: Arial, sans-serif; }}
h2 {{ font-size: 15pt; color: #1a1a1a; border-left: 4pt solid {accent}; padding-left: 10pt; margin-top: 28pt; font-family: Arial, sans-serif; }}
h3 {{ font-size: 12pt; color: {accent}; margin-top: 16pt; font-family: Arial, sans-serif; }}
p  {{ margin-bottom: 10pt; }}
.cover {{ text-align: center; padding: 60pt 0 40pt; border-bottom: 1pt solid #ccc; margin-bottom: 40pt; }}
.cover .badge {{ font-size: 8pt; font-weight: bold; letter-spacing: 2pt; text-transform: uppercase; color: {accent}; display: block; margin-bottom: 16pt; }}
.cover .subtitle {{ font-size: 13pt; color: #555; font-style: italic; margin-top: 10pt; }}
.cover .author {{ font-size: 9pt; color: #888; margin-top: 16pt; }}
.intro {{ background: #f7f7f7; padding: 18pt; margin-bottom: 28pt; }}
.chapter {{ margin-bottom: 28pt; }}
.chapter-body {{ font-size: 11pt; }}
.takeaways {{ background: #f3f3f3; padding: 16pt; margin: 20pt 0; }}
.takeaways h3 {{ margin-top: 0; margin-bottom: 10pt; }}
.takeaways ul {{ margin: 0; padding-left: 14pt; }}
.takeaways li {{ margin-bottom: 5pt; }}
.conclusion {{ background: #f7f7f7; padding: 18pt; margin-top: 24pt; }}
.bonus {{ background: #f0fff4; border-left: 4pt solid #22c55e; padding: 12pt; margin-top: 16pt; }}
.bonus-label {{ font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #16a34a; margin-bottom: 6pt; display: block; }}
</style>"""

                # Strip the original <style> block completely
                clean_html = _re.sub(r'<style[\s\S]*?</style>', print_css, raw_html, count=1)

                with open(str(pdf_path), "wb") as _f:
                    from xhtml2pdf import pisa as _pisa
                    result = _pisa.CreatePDF(clean_html, dest=_f, encoding="utf-8")
                if result.err:
                    raise ValueError(f"xhtml2pdf reported {result.err} error(s)")
                pdf_url_result = str(row["ebook_url"]).replace("product.html", "product.pdf")

            if not pdf_url_result:
                raise ValueError("PDF generation returned empty — check xhtml2pdf logs")
            pdf_url = pdf_url_result

            # Save back to DB
            conn2 = _get_products_conn()
            try:
                conn2.execute("UPDATE products SET pdf_url=? WHERE id=?", [pdf_url, product_id])
                conn2.commit()
            finally:
                conn2.close()
            return {"pdf_url": pdf_url, "product_id": product_id}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}")

    # ── End Products ──────────────────────────────────────────────────────────

    @app.get("/api/sales-pages")
    async def list_sales_pages():
        """List all generated sales pages."""
        if not funnels_dir.exists():
            return JSONResponse({"pages": []})
        pages = []
        for folder in sorted(funnels_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not folder.is_dir() or not folder.name.endswith("_sales"):
                continue
            sales_page = folder / "sales_page.html"
            if not sales_page.exists():
                continue
            name = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
            slug = name[:-6] if name.endswith("_sales") else name
            html = sales_page.read_text(encoding="utf-8", errors="ignore")
            title_match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
            title_tag   = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
            title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else (title_tag.group(1).strip() if title_tag else slug)
            meta: dict = {}
            meta_file = folder / "sales_meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            pages.append({
                "slug": slug,
                "folder": folder.name,
                "title": title,
                "product_name": meta.get("product_name", slug),
                "price_point": meta.get("price_point", ""),
                "stripe_url": meta.get("stripe_url", ""),
                "created_at": datetime.fromtimestamp(folder.stat().st_mtime).isoformat(),
                "sales_url": f"/s/{slug}",
                "thankyou_url": f"/s/{slug}/thankyou",
                "has_thankyou": (folder / "sales_thankyou_page.html").exists(),
            })
        return JSONResponse({"pages": pages})

    @app.delete("/api/sales-pages/{folder_name}")
    async def delete_sales_page(folder_name: str):
        import shutil
        safe_name = Path(folder_name).name
        target = funnels_dir / safe_name
        if not target.exists() or not target.is_dir() or not target.name.endswith("_sales"):
            raise HTTPException(status_code=404, detail="Sales page not found")
        try:
            shutil.rmtree(target)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        return JSONResponse({"ok": True, "deleted": safe_name})

    # ── Email Sequences (SQLite-backed, no Supabase required) ─────────────────

    import sqlite3 as _sqlite3
    import uuid as _uuid

    _email_db_path = Path(os.getenv("DATA_DIR", "./data")) / "email_sequences.db"

    def _get_email_db() -> "_sqlite3.Connection":
        conn = _sqlite3.connect(str(_email_db_path))
        conn.row_factory = _sqlite3.Row
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS email_sequences (
                id TEXT PRIMARY KEY,
                org_id TEXT NOT NULL DEFAULT 'dev-org',
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                trigger_type TEXT DEFAULT 'new_subscriber',
                trigger_tag TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_steps (
                id TEXT PRIMARY KEY,
                sequence_id TEXT NOT NULL,
                org_id TEXT NOT NULL DEFAULT 'dev-org',
                step_number INTEGER NOT NULL DEFAULT 1,
                subject TEXT NOT NULL DEFAULT '',
                body_html TEXT DEFAULT '',
                body_plain TEXT DEFAULT '',
                delay_days INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                FOREIGN KEY (sequence_id) REFERENCES email_sequences(id) ON DELETE CASCADE
            );
        """)
        conn.commit()
        return conn

    def _seq_row_to_dict(row, steps=None) -> dict:
        d = dict(row)
        d["is_active"] = bool(d.get("is_active", 1))
        if steps is not None:
            d["steps"] = [dict(s) | {"is_active": bool(s["is_active"])} for s in steps]
        return d

    @app.get("/api/email-sequences")
    async def list_email_sequences():
        conn = _get_email_db()
        try:
            rows = conn.execute(
                "SELECT s.*, (SELECT COUNT(*) FROM email_steps e WHERE e.sequence_id=s.id) as step_count "
                "FROM email_sequences s ORDER BY s.created_at DESC"
            ).fetchall()
            sequences = []
            for row in rows:
                d = dict(row)
                # Fetch steps summary
                steps = conn.execute(
                    "SELECT id, step_number, subject, delay_days, is_active FROM email_steps WHERE sequence_id=? ORDER BY step_number",
                    (d["id"],)
                ).fetchall()
                d["steps"] = [dict(s) | {"is_active": bool(s["is_active"])} for s in steps]
                sequences.append(d)
            return JSONResponse({"ok": True, "sequences": sequences})
        finally:
            conn.close()

    @app.post("/api/email-sequences")
    async def create_email_sequence(req: Request):
        body = await req.json()
        name = str(body.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        now = datetime.utcnow().isoformat()
        seq_id = str(_uuid.uuid4())
        org_id = str(body.get("org_id", "dev-org"))
        steps = body.get("steps", [])
        conn = _get_email_db()
        try:
            conn.execute(
                "INSERT INTO email_sequences (id, org_id, name, description, trigger_type, trigger_tag, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (seq_id, org_id, name, body.get("description", ""), body.get("trigger_type", "new_subscriber"),
                 body.get("trigger_tag", ""), body.get("status", "active"), now, now)
            )
            for i, step in enumerate(steps):
                conn.execute(
                    "INSERT INTO email_steps (id, sequence_id, org_id, step_number, subject, body_html, body_plain, delay_days, is_active) VALUES (?,?,?,?,?,?,?,?,?)",
                    (str(_uuid.uuid4()), seq_id, org_id, i + 1, step.get("subject", f"Email {i+1}"),
                     step.get("body_html", ""), step.get("body_plain", ""),
                     int(step.get("delay_days", i * 2)), 1)
                )
            conn.commit()
            seq = dict(conn.execute("SELECT * FROM email_sequences WHERE id=?", (seq_id,)).fetchone())
            return JSONResponse({"ok": True, "sequence": seq}, status_code=201)
        finally:
            conn.close()

    @app.get("/api/email-sequences/{seq_id}")
    async def get_email_sequence(seq_id: str):
        conn = _get_email_db()
        try:
            row = conn.execute("SELECT * FROM email_sequences WHERE id=?", (seq_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Sequence not found")
            steps = conn.execute(
                "SELECT * FROM email_steps WHERE sequence_id=? ORDER BY step_number", (seq_id,)
            ).fetchall()
            return JSONResponse({"ok": True, "sequence": _seq_row_to_dict(row, steps)})
        finally:
            conn.close()

    @app.patch("/api/email-sequences/{seq_id}")
    async def update_email_sequence(seq_id: str, req: Request):
        body = await req.json()
        allowed = {"name", "description", "trigger_type", "trigger_tag", "status"}
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        updates["updated_at"] = datetime.utcnow().isoformat()
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn = _get_email_db()
        try:
            conn.execute(f"UPDATE email_sequences SET {set_clause} WHERE id=?", (*updates.values(), seq_id))
            conn.commit()
            row = conn.execute("SELECT * FROM email_sequences WHERE id=?", (seq_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Sequence not found")
            steps = conn.execute("SELECT * FROM email_steps WHERE sequence_id=? ORDER BY step_number", (seq_id,)).fetchall()
            return JSONResponse({"ok": True, "sequence": _seq_row_to_dict(row, steps)})
        finally:
            conn.close()

    @app.delete("/api/email-sequences/{seq_id}")
    async def delete_email_sequence(seq_id: str):
        conn = _get_email_db()
        try:
            conn.execute("DELETE FROM email_steps WHERE sequence_id=?", (seq_id,))
            conn.execute("DELETE FROM email_sequences WHERE id=?", (seq_id,))
            conn.commit()
            return JSONResponse({"ok": True})
        finally:
            conn.close()

    @app.post("/api/email-sequences/{seq_id}/steps")
    async def create_email_step(seq_id: str, req: Request):
        body = await req.json()
        conn = _get_email_db()
        try:
            seq = conn.execute("SELECT * FROM email_sequences WHERE id=?", (seq_id,)).fetchone()
            if not seq:
                raise HTTPException(status_code=404, detail="Sequence not found")
            max_num = conn.execute("SELECT MAX(step_number) FROM email_steps WHERE sequence_id=?", (seq_id,)).fetchone()[0] or 0
            step_id = str(_uuid.uuid4())
            conn.execute(
                "INSERT INTO email_steps (id, sequence_id, org_id, step_number, subject, body_html, body_plain, delay_days, is_active) VALUES (?,?,?,?,?,?,?,?,?)",
                (step_id, seq_id, dict(seq)["org_id"], max_num + 1,
                 body.get("subject", ""), body.get("body_html", ""), body.get("body_plain", ""),
                 int(body.get("delay_days", 0)), 1 if body.get("is_active", True) else 0)
            )
            conn.commit()
            step = dict(conn.execute("SELECT * FROM email_steps WHERE id=?", (step_id,)).fetchone())
            return JSONResponse({"ok": True, "step": step}, status_code=201)
        finally:
            conn.close()

    @app.patch("/api/email-sequences/{seq_id}/steps/{step_id}")
    async def update_email_step(seq_id: str, step_id: str, req: Request):
        body = await req.json()
        allowed = {"subject", "body_html", "body_plain", "delay_days", "is_active", "step_number"}
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn = _get_email_db()
        try:
            conn.execute(f"UPDATE email_steps SET {set_clause} WHERE id=? AND sequence_id=?", (*updates.values(), step_id, seq_id))
            conn.commit()
            step = conn.execute("SELECT * FROM email_steps WHERE id=?", (step_id,)).fetchone()
            return JSONResponse({"ok": True, "step": dict(step) if step else {}})
        finally:
            conn.close()

    @app.delete("/api/email-sequences/{seq_id}/steps/{step_id}")
    async def delete_email_step(seq_id: str, step_id: str):
        conn = _get_email_db()
        try:
            conn.execute("DELETE FROM email_steps WHERE id=? AND sequence_id=?", (step_id, seq_id))
            conn.commit()
            return JSONResponse({"ok": True})
        finally:
            conn.close()

    class SubscribeReq(BaseModel):
        name: str = ""
        email: str = ""

    @app.post("/api/subscribe/{slug}")
    async def subscribe(slug: str, req: SubscribeReq):
        """Capture opt-in from landing page form, store locally, and enroll in sequence."""
        if not req.email or "@" not in req.email:
            raise HTTPException(status_code=422, detail="Valid email required")
        folder = _find_funnel_folder(funnels_dir, slug) if funnels_dir.exists() else None
        subscriber = {
            "name": req.name.strip(),
            "email": req.email.strip().lower(),
            "subscribed_at": datetime.utcnow().isoformat(),
            "slug": slug,
        }
        # Save locally to subscribers.json
        subs_file = (folder / "subscribers.json") if folder else (outputs_dir / "subscribers.json")
        existing: list = []
        if subs_file.exists():
            try:
                existing = json.loads(subs_file.read_text(encoding="utf-8"))
            except Exception:
                existing = []
        if not any(s.get("email") == subscriber["email"] for s in existing):
            existing.append(subscriber)
            subs_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")

        # Read funnel metadata to get org_id + sequence_id
        org_id = "dev-org"
        sequence_id = ""
        if folder:
            meta_file = folder / "funnel_meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    org_id = meta.get("org_id") or org_id
                    sequence_id = meta.get("sequence_id") or ""
                except Exception:
                    pass

        # Enroll via internal SaaS API
        saas_url = os.getenv("SAAS_API_URL", "http://localhost:3001/saas")
        internal_token = os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{saas_url}/internal/opt-in",
                    headers={"x-internal-token": internal_token},
                    json={"email": subscriber["email"], "name": subscriber["name"], "org_id": org_id, "sequence_id": sequence_id},
                )
        except Exception as e:
            logger.warning(f"[subscribe] Internal opt-in call failed: {e}")

        return {"ok": True}

    @app.get("/api/pages")
    async def list_pages():
        """List all generated funnel pages."""
        if not funnels_dir.exists():
            return JSONResponse({"pages": []})
        pages = []
        for folder in sorted(funnels_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not folder.is_dir():
                continue
            landing = folder / "landing_page.html"
            thankyou = folder / "thankyou_page.html"
            email_seq = folder / "email_sequence.json"
            if not landing.exists():
                continue
            # Extract slug from folder name (strip timestamp prefix YYYYMMDD_HHMMSS_)
            name = folder.name
            slug = re.sub(r"^\d{8}_\d{6}_", "", name)
            # Try to extract headline from HTML
            html = landing.read_text(encoding="utf-8", errors="ignore")
            title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
            headline_match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
            title = re.sub(r"<[^>]+>", "", headline_match.group(1)).strip() if headline_match else (title_match.group(1).strip() if title_match else slug)
            email_count = 0
            if email_seq.exists():
                try:
                    emails = json.loads(email_seq.read_text(encoding="utf-8"))
                    email_count = len(emails) if isinstance(emails, list) else 0
                except Exception:
                    pass
            pages.append({
                "slug": slug,
                "folder": folder.name,
                "title": title,
                "created_at": datetime.fromtimestamp(folder.stat().st_mtime).isoformat(),
                "landing_url": f"/p/{slug}",
                "thankyou_url": f"/p/{slug}/thankyou",
                "has_thankyou": thankyou.exists(),
                "email_count": email_count,
            })
        return JSONResponse({"pages": pages})

    @app.delete("/api/pages/{folder_name}")
    async def delete_page(folder_name: str):
        """Delete a funnel page folder by its folder name."""
        import shutil
        # Sanitize — folder name must not escape the funnels directory
        safe_name = Path(folder_name).name
        target = funnels_dir / safe_name
        if not target.exists() or not target.is_dir():
            raise HTTPException(status_code=404, detail="Page not found")
        try:
            shutil.rmtree(target)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        return JSONResponse({"ok": True, "deleted": safe_name})

    # ── Content Review endpoints ──────────────────────────────────────────────

    @app.get("/api/review/outputs")
    async def review_outputs():
        """Return recent outputs grouped by type for the review panel."""
        items = []

        # Blog posts
        blog_dir = outputs_dir / "blog"
        if blog_dir.exists():
            for f in sorted(blog_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]:
                items.append({
                    "type": "blog",
                    "title": f.stem.replace("-", " ").replace("_", " ").title(),
                    "file": str(f).replace("\\", "/"),
                    "created_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                    "preview_url": None,
                })

        # Funnels
        if funnels_dir.exists():
            for folder in sorted(funnels_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
                if not folder.is_dir(): continue
                lp = folder / "landing_page.html"
                if not lp.exists(): continue
                slug = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
                html = lp.read_text(encoding="utf-8", errors="ignore")
                h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
                title = re.sub(r"<[^>]+>", "", h1.group(1)).strip() if h1 else slug
                items.append({
                    "type": "funnel",
                    "title": title,
                    "slug": slug,
                    "folder": folder.name,
                    "file": str(lp).replace("\\", "/"),
                    "created_at": datetime.fromtimestamp(folder.stat().st_mtime).isoformat(),
                    "preview_url": f"/p/{slug}",
                    "thankyou_url": f"/p/{slug}/thankyou",
                    "email_file": str(folder / "email_sequence.json").replace("\\", "/") if (folder / "email_sequence.json").exists() else None,
                })

        # Ads
        ads_dir = outputs_dir / "ads"
        if ads_dir.exists():
            for folder in sorted(ads_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
                if not folder.is_dir(): continue
                preview = folder / "ads_preview.html"
                if not preview.exists(): continue
                slug = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
                norm = str(preview).replace("\\", "/")
                idx = norm.find("outputs/")
                preview_url = "/" + norm[idx:] if idx >= 0 else None
                items.append({
                    "type": "ads",
                    "title": slug.replace("-", " ").title(),
                    "folder": folder.name,
                    "file": str(preview).replace("\\", "/"),
                    "created_at": datetime.fromtimestamp(folder.stat().st_mtime).isoformat(),
                    "preview_url": preview_url,
                })

        # Analytics
        analytics_dir = outputs_dir / "analytics"
        if analytics_dir.exists():
            for folder in sorted(analytics_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
                if not folder.is_dir(): continue
                html_f = folder / "analytics_setup.html"
                if not html_f.exists(): continue
                slug = re.sub(r"^\d{8}_\d{6}_", "", folder.name)
                norm = str(html_f).replace("\\", "/")
                idx = norm.find("outputs/")
                preview_url = "/" + norm[idx:] if idx >= 0 else None
                items.append({
                    "type": "analytics",
                    "title": slug.replace("-", " ").title(),
                    "folder": folder.name,
                    "file": str(html_f).replace("\\", "/"),
                    "created_at": datetime.fromtimestamp(folder.stat().st_mtime).isoformat(),
                    "preview_url": preview_url,
                })

        # Sort all by created_at descending
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return JSONResponse({"items": items})

    @app.get("/api/review/file")
    async def review_file(path: str):
        """Return raw text content of a file (blog markdown, email JSON)."""
        try:
            p = Path(path)
            # Security: only allow files inside outputs_dir
            p.resolve().relative_to(outputs_dir)
            if not p.exists():
                raise HTTPException(status_code=404, detail="File not found")
            content = p.read_text(encoding="utf-8", errors="replace")
            return JSONResponse({"content": content, "name": p.name})
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")

    # ── WebSocket live updates ────────────────────────────────────────────────
    _ws_clients: list[WebSocket] = []

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()

        # ── Auth handshake ────────────────────────────────────────────────────
        # Dev mode: no Supabase configured — skip token validation entirely.
        # Production: expect {"type": "auth", "token": "<bearer>"} within 5 s.
        async def _ws_reject():
            try:
                await ws.close(code=4001)
            except Exception:
                pass

        if supabase_is_configured():
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
                msg = json.loads(raw)
                if msg.get("type") != "auth" or not msg.get("token"):
                    await _ws_reject()
                    return
                user = await get_user_from_token(str(msg["token"]))
                if not user:
                    await _ws_reject()
                    return
            except asyncio.TimeoutError:
                await _ws_reject()
                return
            except Exception:
                await _ws_reject()
                return

        _ws_clients.append(ws)
        last_pipeline_states: dict = {}
        try:
            while True:
                await asyncio.sleep(2)
                status_payload = _openclaw.status()
                await ws.send_text(json.dumps(status_payload))

                # Detect pipeline state changes and emit job_update events
                for pipeline in status_payload.get("pipelines", []):
                    pid = pipeline.get("pipeline_id", "")
                    current_status = pipeline.get("status", "")
                    if pid and last_pipeline_states.get(pid) != current_status:
                        last_pipeline_states[pid] = current_status
                        event = json.dumps({
                            "type": "job_update",
                            "pipeline_id": pid,
                            "topic": pipeline.get("topic", ""),
                            "status": current_status,
                            "job_id": pipeline.get("job_id", ""),
                        })
                        for client in list(_ws_clients):
                            try:
                                await client.send_text(event)
                            except Exception:
                                pass
        except (WebSocketDisconnect, Exception):
            if ws in _ws_clients:
                _ws_clients.remove(ws)

    # ── Read-only status ──────────────────────────────────────────────────────
    @app.get("/api/status")
    async def get_status(limit: int = 50, offset: int = 0):
        return _openclaw.status(limit=limit, offset=offset)

    @app.get("/api/agents")
    async def get_agents():
        return {
            aid: {**a.metrics(), **a.skill_summary()}
            for aid, a in _openclaw._agents.items()
        }

    @app.get("/api/auth/config")
    async def get_auth_config():
        return {"configured": supabase_is_configured()}

    @app.get("/api/auth/me")
    async def get_auth_me(request: Request):
        user = request.state.user
        profile = MemberStore().ensure_member(str(user.get("id", "")), str(user.get("email", "") or ""))
        return {
            "ok": True,
            "user": {
                "id": str(user.get("id", "")),
                "email": str(user.get("email", "") or ""),
            },
            "profile": profile,
            "onboarding_required": not bool(profile.get("onboarded")),
        }

    @app.post("/api/auth/profile")
    async def save_auth_profile(request: Request, payload: dict = Body(...)):
        user = request.state.user
        email = str(payload.get("email", "") or user.get("email", "") or "").strip()
        display_name = str(payload.get("display_name", "") or "").strip()
        org_name = str(payload.get("org_name", "") or "").strip()
        profile = MemberStore().save_profile(
            str(user.get("id", "")),
            email,
            display_name=display_name,
            org_name=org_name,
        )
        return {
            "ok": True,
            "user": {
                "id": str(user.get("id", "")),
                "email": str(user.get("email", "") or ""),
            },
            "profile": profile,
            "onboarding_required": not bool(profile.get("onboarded")),
        }

    @app.get("/api/chat/agents")
    async def get_chat_agents():
        return [
            {
                "agent_id": aid,
                "name": agent.skill_summary().get("name", aid),
                "capabilities": agent.skill_summary().get("capabilities", []),
                "description": agent.skill_summary().get("description", ""),
            }
            for aid, agent in _openclaw._agents.items()
        ]

    @app.get("/api/queue")
    async def get_queue():
        return {
            "stats": _openclaw.queue.stats(),
            "recent": _openclaw.queue.recent_tasks(20),
        }

    @app.get("/api/events")
    async def get_events(limit: int = 50):
        return _openclaw.bus.recent(limit=limit)

    @app.get("/api/performance")
    async def get_performance():
        return {
            "router": _openclaw.router.performance_report(),
            "optimizer": _openclaw.optimizer.latest_recommendations(),
        }

    # ── LLM cache management ──────────────────────────────────────────────────
    @app.get("/api/llm-cache")
    async def llm_cache_stats():
        """Return the number of cached entries and total size on disk."""
        import glob as _glob
        cache_dir = Path("data/llm_cache")
        files = list(cache_dir.glob("*.txt")) if cache_dir.exists() else []
        total_bytes = sum(f.stat().st_size for f in files)
        return {"entries": len(files), "size_bytes": total_bytes}

    @app.delete("/api/llm-cache")
    async def clear_llm_cache():
        """Delete all cached LLM responses."""
        import glob as _glob
        cache_dir = Path("data/llm_cache")
        if not cache_dir.exists():
            return {"deleted": 0}
        files = list(cache_dir.glob("*.txt"))
        for f in files:
            try:
                f.unlink()
            except OSError:
                pass
        logger.info(f"[LLMCache] Cleared {len(files)} cache entries via API")
        return {"deleted": len(files)}

    # ── Task submission ───────────────────────────────────────────────────────
    @app.get("/api/tasks/{task_id}")
    async def get_task_status(task_id: str):
        """Poll the status of a single task. Includes retry_count so the UI
        can display 'Retrying (2/3)' while a task is in backoff."""
        task = _openclaw.queue.get_task(task_id)
        if not task:
            # Also check history for completed/failed tasks
            for t in _openclaw.queue._history:
                if t.id == task_id:
                    task = t
                    break
        if not task:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        d = task.to_dict()
        # Friendly retry label for the UI
        if task.status.value == "retrying":
            d["retry_label"] = f"Retrying ({task.retries}/{task.max_retries})"
        else:
            d["retry_label"] = None
        return d

    @app.post("/api/tasks")
    async def submit_task(req: TaskReq, request: Request):
        from core.task_queue import TaskPriority
        req.payload["user_id"] = str(request.state.user.get("id", ""))
        task_id = await _openclaw.submit(
            req.type, req.payload,
            priority=TaskPriority(req.priority),
            agent_hint=req.agent_hint,
        )
        return {"task_id": task_id, "status": "queued"}

    @app.post("/api/pipeline")
    async def submit_pipeline(req: PipelineReq, request: Request):
        ids = await _openclaw.submit_pipeline(
            req.topic,
            req.keywords,
            aspect_ratio=req.aspect_ratio,
            user_id=str(request.state.user.get("id", "")),
            job_id=req.job_id,
            job_run_id=req.job_run_id,
            workspace_id=req.workspace_id,
            brand_id=req.brand_id,
            input_payload=req.input_payload,
        )
        return {"task_ids": ids, "count": len(ids), "status": "queued"}

    @app.post("/api/ebook")
    async def submit_ebook(req: EbookReq):
        """Submit a full ebook generation job."""
        payload = {
            "topic": req.topic,
            "style": req.style,
            "theme": req.theme,
            "chapter_count": req.chapter_count,
            "words_per_chapter": req.words_per_chapter,
            "keywords": req.keywords,
            "cover_prompt": req.cover_prompt,
            "author_name": req.author_name,
            "cta_text": req.cta_text,
            "cta_url": req.cta_url,
            "cta_button": req.cta_button,
            "chapter_images": req.chapter_images,
        }
        if req.chapters:
            payload["chapters"] = [{"title": c.title, "description": c.description, "image_prompt": c.image_prompt} for c in req.chapters]
        task_id = await _openclaw.submit("ebook_gen", payload, agent_hint="ebook_agent")
        return {"task_id": task_id, "status": "queued"}

    @app.post("/api/email-newsletter")
    async def generate_email_newsletter(body: dict = Body(default={})):
        """Generate an email newsletter synchronously via LLM."""
        import math

        email_type  = str(body.get("email_type", "newsletter"))
        niche       = str(body.get("niche", "")).strip()
        audience    = str(body.get("audience", "")).strip()
        topic       = str(body.get("topic", "")).strip()
        tones       = body.get("tones", ["conversational"])
        options     = body.get("options", [])
        length      = str(body.get("length", "medium")).strip()
        sender_name = str(body.get("sender_name", "")).strip()
        cta_text    = str(body.get("cta_text", "")).strip()
        cta_url     = str(body.get("cta_url", "#")).strip() or "#"
        ps_text     = str(body.get("ps_text", "")).strip()

        if not topic:
            raise HTTPException(status_code=400, detail="topic is required")

        tone_str    = ", ".join(tones) if tones else "conversational"
        opt_subject = "generate_subject_lines" in options
        opt_cta     = "include_cta" in options
        opt_ps      = "add_ps" in options
        opt_plain   = "plain_text" in options

        length_guidance = {"short": "~150 words", "medium": "~300 words", "long": "~500 words"}.get(length, "~300 words")

        system = (
            "You are an expert email copywriter who writes high-converting, engaging newsletters. "
            "Write in the requested tone. Be specific and avoid generic filler. "
            "Use short paragraphs (2-3 sentences max). Always output valid JSON."
        )

        type_guidance = {
            "newsletter":    "a value-packed newsletter update",
            "promotional":   "a promotional email driving sales or signups",
            "welcome":       "a warm welcome email for new subscribers",
            "reengagement":  "a re-engagement email to win back inactive subscribers",
            "abandoned_cart":"an abandoned cart recovery email",
            "event_invite":  "an event invitation email",
        }.get(email_type, "an email newsletter")

        cta_button_text = cta_text or "Click here"
        cta_html_note = (
            f'IMPORTANT: place the CTA as a standalone block OUTSIDE any list, directly inside the body: '
            f'<div class="cta-block"><a href="{cta_url}">{cta_button_text}</a></div>. '
            f'Never put this inside a <li> or any other element.'
        ) if opt_cta else ""
        cta_instruction = (
            f'Include a clear standalone CTA button (not inside any list) with the text "{cta_button_text}".'
        ) if opt_cta else ""
        ps_instruction = (
            f'Add this exact P.S. line at the end as a <p> tag: "{ps_text}"' if ps_text else
            "Add a relevant P.S. line at the end as a <p> tag."
        ) if opt_ps else ""
        audience_line = f"Target Audience: {audience}" if audience else ""
        sender_line = f"Sender Name: {sender_name}" if sender_name else ""
        subject_lines_placeholder = json.dumps(["alt subject 1", "alt subject 2", "alt subject 3"]) if opt_subject else "[]"
        ps_placeholder = "the PS line text" if opt_ps else '""'

        prompt = f"""Write {type_guidance} for the following:
Niche/Industry: {niche or "general"}
{audience_line}
Topic/Goal: {topic}
Tone: {tone_str}
Length: {length_guidance}
{sender_line}
{cta_instruction}
{ps_instruction}

Return ONLY a JSON object with these exact keys:
{{
  "subject": "the email subject line",
  "preview_text": "email preview/preheader text (max 90 chars)",
  "body_html": "the full email body as valid HTML. Allowed tags: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>. {cta_html_note} Do NOT nest block elements inside <li> tags.",
  "body_plain": "plain text version of the email",
  "subject_lines": {subject_lines_placeholder},
  "ps_line": {ps_placeholder}
}}"""

        try:
            llm = _openclaw.llm
            raw = await llm.complete(prompt, system=system, max_tokens=2000)
            # Extract JSON from response
            import re as _re
            match = _re.search(r'\{[\s\S]*\}', raw)
            if not match:
                raise ValueError("No JSON in response")
            data = json.loads(match.group())
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Generation failed: {exc}")

        body_plain = data.get("body_plain", "")
        words = len(body_plain.split())
        sentences = max(1, len([s for s in body_plain.replace("!", ".").replace("?", ".").split(".") if s.strip()]))
        avg_words = words / sentences
        # Rough readability score (higher = easier)
        readability = max(0, min(100, round(206 - 1.015 * avg_words - 84.6 * (avg_words / max(words, 1)))))
        read_time = max(1, round(words / 200))
        subject = data.get("subject", "")
        subject_grade = "A" if 30 <= len(subject) <= 55 else "B" if len(subject) <= 70 else "C"

        return {
            "ok": True,
            "subject": subject,
            "preview_text": data.get("preview_text", ""),
            "body_html": data.get("body_html", ""),
            "body_plain": body_plain,
            "subject_lines": data.get("subject_lines", []),
            "ps_line": data.get("ps_line", ""),
            "stats": {
                "readability": readability,
                "subject_grade": subject_grade,
                "read_time": read_time,
                "word_count": words,
            },
        }

    @app.post("/api/translate")
    async def translate_content(body: dict = Body(default={})):
        """Translate text or HTML into multiple languages with tone adaptation."""
        content       = str(body.get("content", "")).strip()
        content_type  = str(body.get("content_type", "text"))   # 'text' | 'html'
        target_langs  = body.get("target_languages", [])
        formality     = str(body.get("formality", "neutral"))
        adapt_tone    = bool(body.get("adapt_tone", True))
        custom_instr  = str(body.get("custom_instructions", "")).strip()
        source_lang   = str(body.get("source_language", "auto-detect")).strip() or "auto-detect"

        if not content:
            raise HTTPException(status_code=400, detail="content is required")
        if not target_langs:
            raise HTTPException(status_code=400, detail="Select at least one target language")
        if len(target_langs) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 languages at a time")

        # Trim to safe size
        content = content[:20000]

        formality_map = {
            "formal":   "Use formal, professional language suitable for business contexts.",
            "informal": "Use casual, conversational language.",
            "neutral":  "Use clear, neutral language for a general audience.",
        }
        formality_note = formality_map.get(formality, formality_map["neutral"])

        llm = _openclaw.llm

        async def translate_one(language: str) -> dict:
            tone_note   = f" Adapt the tone, idioms, and cultural references to feel completely natural for {language} speakers." if adapt_tone else ""
            custom_note = f"\n\nAdditional instructions: {custom_instr}" if custom_instr else ""

            if content_type == "html":
                system = (
                    f"You are a professional HTML translator and localizer. Translate the HTML into {language}. "
                    f"Rules: (1) Preserve ALL HTML tags, attributes, classes, and structure exactly. "
                    f"(2) Only translate visible text between tags. "
                    f"(3) Never translate: URLs, href/src values, CSS class names, data-* attributes, code, brand names, email addresses. "
                    f"(4) {formality_note}{tone_note} "
                    f"(5) Return ONLY the translated HTML — no explanation, no markdown.{custom_note}"
                )
                user_msg = f"Translate this HTML into {language}:\n\n{content}"
            else:
                system = (
                    f"You are a professional translator and localizer. Translate the content into {language}. "
                    f"Rules: (1) Preserve all paragraph breaks, bullet points, and formatting. "
                    f"(2) Do not translate: URLs, email addresses, brand names, code snippets, or proper nouns without standard translations. "
                    f"(3) {formality_note}{tone_note} "
                    f"(4) Return ONLY the translated text — no explanation, no extra commentary.{custom_note}"
                )
                user_msg = f"Translate into {language}:\n\n{content}"

            try:
                translated = await llm.complete(user_msg, system=system, max_tokens=8000)
                translated = translated.strip()
                return {
                    "language":    language,
                    "content":     translated,
                    "char_count":  len(translated),
                    "word_count":  len(translated.split()),
                    "error":       None,
                }
            except Exception as exc:
                return {"language": language, "content": "", "char_count": 0, "word_count": 0, "error": str(exc)}

        translations = await asyncio.gather(*[translate_one(lang) for lang in target_langs])

        return {
            "ok":                   True,
            "translations":         list(translations),
            "source_language":      source_lang,
            "original_char_count":  len(content),
            "original_word_count":  len(content.split()),
        }

    @app.post("/api/ebook/outline")
    async def generate_ebook_outline(req: EbookOutlineReq):
        """Generate an ebook outline synchronously (fast, no task queue)."""
        try:
            agent = _openclaw._agents.get("ebook_agent")
            if agent is None:
                raise HTTPException(status_code=503, detail="ebook_agent not registered")
            outline = await agent._ai_outline(req.topic, req.style, req.chapter_count, req.keywords)
            return {"ok": True, "outline": outline}
        except Exception as exc:
            logger.error(f"[API] ebook outline error: {exc}")
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/ebook/export-pdf")
    async def export_ebook_pdf(body: dict = Body(default={})):
        """Generate a PDF from an existing ebook HTML file on demand."""
        html_path_str = str(body.get("html_path", "")).strip()
        if not html_path_str:
            raise HTTPException(status_code=400, detail="html_path is required")

        html_path = Path(html_path_str)
        if not html_path.exists():
            raise HTTPException(status_code=404, detail="HTML file not found")

        pdf_path = html_path.with_suffix(".pdf")

        agent = _openclaw._agents.get("ebook_agent")
        if agent is None:
            raise HTTPException(status_code=503, detail="ebook_agent not registered")

        try:
            result = await agent._export_pdf(html_path, pdf_path)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

        if not result or not pdf_path.exists():
            raise HTTPException(status_code=500, detail="PDF export failed — Chrome may not be available")

        # Update meta.json if it exists
        meta_file = html_path.parent / "meta.json"
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                meta["pdf_path"] = str(pdf_path)
                meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            except Exception:
                pass

        outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
        try:
            rel = pdf_path.resolve().relative_to(outputs_dir)
            pdf_url = f"/outputs/{rel.as_posix()}"
        except ValueError:
            pdf_url = ""

        return {"ok": True, "pdf_path": str(pdf_path), "pdf_url": pdf_url}

    @app.post("/api/audiobook")
    async def create_audiobook(file: UploadFile = File(...)):
        """Convert an uploaded HTML (or text) file to an audiobook via the voice agent."""
        import html as html_lib
        from html.parser import HTMLParser

        class _Stripper(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts: list[str] = []
                self._skip_tags = {"script", "style", "head"}
                self._skip = 0
            def handle_starttag(self, tag, attrs):
                if tag in self._skip_tags: self._skip += 1
                if tag in {"p", "h1", "h2", "h3", "h4", "li", "br", "div"}:
                    self.parts.append("\n")
            def handle_endtag(self, tag):
                if tag in self._skip_tags: self._skip = max(0, self._skip - 1)
            def handle_data(self, data):
                if not self._skip:
                    self.parts.append(data)

        raw = await file.read()
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            content = raw.decode("latin-1")

        # Strip HTML if it looks like HTML
        if "<html" in content.lower() or "<body" in content.lower() or "<p" in content.lower():
            stripper = _Stripper()
            stripper.feed(content)
            text = html_lib.unescape(" ".join(stripper.parts))
        else:
            text = content

        # Collapse whitespace
        import re as _re
        text = _re.sub(r"\n{3,}", "\n\n", text).strip()

        if len(text) < 20:
            raise HTTPException(status_code=400, detail="Could not extract readable text from the file")

        topic = Path(file.filename or "audiobook").stem
        task_id = await _openclaw.submit("tts", {"topic": topic, "text": text}, agent_hint="voice_agent")
        return {"task_id": task_id, "status": "queued", "char_count": len(text), "topic": topic}

    @app.get("/api/ebook/list")
    async def list_ebooks():
        """Return list of generated ebooks from outputs/ebook/."""
        ebook_dir = Path("outputs/ebook")
        if not ebook_dir.exists():
            return {"ebooks": []}
        ebooks = []
        for subdir in sorted(ebook_dir.iterdir(), reverse=True):
            meta_file = subdir / "meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    html_exists = Path(meta.get("html_path", "")).exists() if meta.get("html_path") else False
                    pdf_exists = Path(meta.get("pdf_path", "")).exists() if meta.get("pdf_path") else False
                    ebooks.append({**meta, "dir": str(subdir), "has_html": html_exists, "has_pdf": pdf_exists})
                except Exception:
                    pass
        return {"ebooks": ebooks}

    @app.post("/api/internal/pipeline")
    async def submit_internal_pipeline(req: PipelineReq, request: Request):
        token = str(request.headers.get("x-internal-token", "") or "")
        expected = str(os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal"))
        if token != expected:
            raise HTTPException(status_code=401, detail="Invalid internal token")

        ids = await _openclaw.submit_pipeline(
            req.topic,
            req.keywords,
            aspect_ratio=req.aspect_ratio,
            user_id="internal",
            job_id=req.job_id,
            job_run_id=req.job_run_id,
            workspace_id=req.workspace_id,
            brand_id=req.brand_id,
            input_payload=req.input_payload,
        )
        return {
            "task_ids": ids,
            "count": len(ids),
            "status": "queued",
            "pipeline_id": ids[0] if ids else "",
        }

    @app.post("/api/internal/tasks")
    async def submit_internal_task(req: TaskReq, request: Request):
        token = str(request.headers.get("x-internal-token", "") or "")
        expected = str(os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal"))
        if token != expected:
            raise HTTPException(status_code=401, detail="Invalid internal token")

        from core.task_queue import TaskPriority

        task_id = await _openclaw.submit(
            req.type,
            req.payload,
            priority=TaskPriority(req.priority),
            agent_hint=req.agent_hint,
        )
        return {"task_id": task_id, "status": "queued"}

    @app.post("/api/internal/jobs/{job_id}/cancel")
    async def cancel_internal_job(job_id: str, request: Request):
        token = str(request.headers.get("x-internal-token", "") or "")
        expected = str(os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal"))
        if token != expected:
            raise HTTPException(status_code=401, detail="Invalid internal token")
        return {"ok": True, **_openclaw.cancel_job(job_id)}

    @app.post("/api/pipeline/slides")
    async def submit_slide_pipeline(req: SlidePipelineReq, request: Request):
        slides = []
        for index, slide in enumerate(req.slides, 1):
            title = slide.title.strip() or f"Slide {index}"
            image_prompt = slide.image_prompt.strip()
            negative_prompt = slide.negative_prompt.strip()
            image_path = slide.image_path.strip()
            voiceover_text = slide.voiceover_text.strip()
            audio_path = slide.audio_path.strip()
            caption = slide.caption.strip() or voiceover_text
            if not image_prompt and not image_path:
                raise HTTPException(status_code=400, detail=f"Slide {index} needs an image prompt or an image file")
            if not voiceover_text and not audio_path:
                raise HTTPException(status_code=400, detail=f"Slide {index} needs voiceover text or an audio file path")
            slides.append({
                "title": title,
                "image_prompt": image_prompt,
                "negative_prompt": negative_prompt,
                "image_path": image_path,
                "narration": voiceover_text,
                "audio_path": audio_path,
                "caption": caption,
                "pause_after_s": max(int(slide.pause_after_s or 1), 0),
            })

        if not slides:
            raise HTTPException(status_code=400, detail="At least one slide is required")

        task_id = await _openclaw.submit(
            "video_caption",
            {
                "topic": req.topic.strip() or "custom-slide-video",
                "slides": slides,
                "aspect_ratio": req.aspect_ratio,
                "user_id": str(request.state.user.get("id", "")),
            },
            agent_hint="video_agent",
        )
        return {"task_id": task_id, "count": len(slides), "status": "queued"}

    @app.post("/api/uploads/slide-media")
    async def upload_slide_media(req: SlideMediaUploadReq, request: Request):
        kind = req.media_kind.strip().lower()
        if kind not in {"image", "audio"}:
            raise HTTPException(status_code=400, detail="media_kind must be 'image' or 'audio'")

        ext = Path(req.filename or "").suffix.lower()
        allowed = {
            "image": {".png", ".jpg", ".jpeg", ".webp"},
            "audio": {".wav", ".mp3", ".m4a"},
        }
        if ext not in allowed[kind]:
            raise HTTPException(status_code=400, detail=f"Unsupported {kind} file type: {ext or 'unknown'}")

        upload_dir = (
            Path(os.getenv("OUTPUTS_DIR", "./outputs"))
            / "users"
            / str(request.state.user.get("id", "anonymous"))
            / "uploads"
            / "video_editor"
        )
        upload_dir.mkdir(parents=True, exist_ok=True)
        slide_index = max(int(req.slide_index or 1), 1)
        filename = f"slide_{slide_index:02d}_{kind}{ext}"
        target = upload_dir / filename
        try:
            content = base64.b64decode(req.content_base64)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid base64 upload payload: {exc}") from exc
        target.write_bytes(content)
        return {
            "status": "saved",
            "path": str(target),
            "filename": filename,
            "slide_index": slide_index,
            "media_kind": kind,
        }

    # ── Output preview (for review screen) ───────────────────────────────────
    @app.get("/api/outputs/preview")
    async def get_output_preview(topic: str = "", pipeline_id: str = ""):
        """Return the most recent blog content + image URL for a topic or pipeline_id."""
        from slugify import slugify as _slugify

        outputs_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
        blog_dir = outputs_base / "blog"
        image_dir = outputs_base / "images"

        if not blog_dir.exists():
            return {"found": False, "content": "", "image_url": "", "filename": ""}

        md_files = sorted(blog_dir.glob("*.md"), key=lambda f: f.stat().st_mtime, reverse=True)
        if not md_files:
            return {"found": False, "content": "", "image_url": "", "filename": ""}

        matched = None
        if topic.strip():
            needle = _slugify(topic.strip())[:30].lower()
            for f in md_files:
                if needle and needle[:15] in f.stem.lower():
                    matched = f
                    break
        if not matched:
            matched = md_files[0]

        content = matched.read_text(encoding="utf-8", errors="replace")

        # Strip YAML frontmatter for preview
        stripped = content
        if stripped.startswith("---"):
            end = stripped.find("---", 3)
            if end != -1:
                stripped = stripped[end + 3:].lstrip()

        img_url = ""
        stem = matched.stem.replace("_seo", "")
        if image_dir.exists():
            for ext in (".png", ".jpg", ".jpeg", ".webp"):
                candidate = image_dir / f"{stem}{ext}"
                if candidate.exists():
                    img_url = f"/outputs/images/{candidate.name}"
                    break
            if not img_url:
                imgs = sorted(image_dir.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
                if imgs:
                    img_url = f"/outputs/images/{imgs[0].name}"

        return {
            "found": True,
            "filename": matched.name,
            "content": stripped[:4000],
            "image_url": img_url,
        }

    # ── Latest output by type (for Create panel preview) ─────────────────────
    @app.get("/api/outputs/latest")
    async def get_latest_output(type: str = "blog", topic: str = ""):
        """Return URL of most recent output file by type, optionally matched to topic."""
        outputs_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
        type_map = {
            "blog":  ("blog",   ["*.md", "*.html"]),
            "audio": ("audio",  ["*.mp3", "*.wav", "*.ogg", "*.m4a"]),
            "video": ("video",  ["*.mp4", "*.webm", "*.mov"]),
            "image": ("images", ["*.png", "*.jpg", "*.jpeg", "*.webp"]),
        }
        if type not in type_map:
            return {"found": False}
        subdir, globs = type_map[type]
        target_dir = outputs_base / subdir
        if not target_dir.exists():
            return {"found": False}
        files: list = []
        for g in globs:
            files.extend(target_dir.glob(g))
        files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        if not files:
            return {"found": False}
        matched = files[0]
        if topic.strip():
            try:
                from slugify import slugify as _slugify
                needle = _slugify(topic.strip())[:20].lower()
                for f in files:
                    if needle and needle[:10] in f.stem.lower():
                        matched = f
                        break
            except ImportError:
                pass
        url = f"/outputs/{subdir}/{matched.name}"
        result: dict = {"found": True, "url": url, "filename": matched.name}
        # For blog, also include content + image_url
        if type == "blog":
            try:
                content = matched.read_text(encoding="utf-8", errors="replace")
                if content.startswith("---"):
                    end = content.find("---", 3)
                    if end != -1:
                        content = content[end + 3:].lstrip()
                result["content"] = content[:5000]
            except Exception:
                result["content"] = ""
            img_dir = outputs_base / "images"
            img_url = ""
            if img_dir.exists():
                stem = matched.stem.replace("_seo", "")
                for ext in (".png", ".jpg", ".jpeg", ".webp"):
                    c = img_dir / f"{stem}{ext}"
                    if c.exists():
                        img_url = f"/outputs/images/{c.name}"
                        break
                if not img_url:
                    imgs = sorted(img_dir.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
                    if imgs:
                        img_url = f"/outputs/images/{imgs[0].name}"
            result["image_url"] = img_url
        return result

    # ── Local asset library ───────────────────────────────────────────────────
    @app.get("/api/assets/local")
    async def get_local_assets(search: str = "", type: str = ""):
        outputs_base = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
        scan_dirs = {
            "images": ("image",  ["*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif"]),
            "audio":  ("audio",  ["*.mp3", "*.wav", "*.ogg", "*.m4a"]),
            "video":  ("video",  ["*.mp4", "*.mov", "*.webm", "*.mkv"]),
            "blog":   ("blog",   ["*.md"]),
        }
        assets = []
        for folder, (asset_type, patterns) in scan_dirs.items():
            if type and asset_type != type:
                continue
            d = outputs_base / folder
            if not d.exists():
                continue
            files: list[Path] = []
            for pattern in patterns:
                files.extend(d.glob(pattern))
            # skip seo json sidecars
            for f in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True):
                if f.name.endswith("_seo.json"):
                    continue
                name = f.stem
                if search and search.lower() not in name.lower():
                    continue
                stat = f.stat()
                url = f"/outputs/{folder}/{f.name}"
                # Try to read blog title from frontmatter
                title = name
                if asset_type == "blog":
                    try:
                        first = f.read_text(encoding="utf-8", errors="replace")[:400]
                        m = re.search(r"^title:\s*['\"]?(.+?)['\"]?\s*$", first, re.MULTILINE)
                        if m:
                            title = m.group(1).strip()
                    except Exception:
                        pass
                # Find matching seo json for blog
                seo_slug = None
                if asset_type == "blog":
                    parts = name.split("_", 1)
                    seo_slug = parts[1] if len(parts) > 1 else name
                assets.append({
                    "id": f"local-{folder}-{f.name}",
                    "job_id": seo_slug or name,
                    "type": asset_type,
                    "name": title,
                    "filename": f.name,
                    "local_path": str(f),
                    "url": url,
                    "size_bytes": stat.st_size,
                    "created_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat(),
                    "workspace_id": "local",
                })
        return {"ok": True, "assets": assets}

    # ── Stripe Sales Analytics ────────────────────────────────────────────────
    @app.get("/api/stripe/analytics")
    async def stripe_analytics():
        from collections import defaultdict
        import stripe as _stripe
        stripe_key = os.getenv("STRIPE_SECRET_KEY", "")
        if not stripe_key or stripe_key.startswith("****"):
            return JSONResponse({"error": "STRIPE_SECRET_KEY not configured"}, status_code=503)

        _stripe.api_key = stripe_key
        now_ts  = int(datetime.utcnow().timestamp())
        today_s = now_ts - 86400
        month_s = now_ts - 86400 * 30

        try:
            # Fetch in parallel threads (stripe SDK is sync)
            import asyncio as _aio
            import concurrent.futures as _cf

            def _fetch():
                bt      = list(_stripe.BalanceTransaction.list(limit=100, type="charge").auto_paging_iter())
                charges = list(_stripe.Charge.list(limit=100).auto_paging_iter())
                products= list(_stripe.Product.list(limit=100, active=True).auto_paging_iter())
                prices  = list(_stripe.Price.list(limit=100, active=True, expand=["data.product"]).auto_paging_iter())
                return bt, charges, products, prices

            loop = _aio.get_event_loop()
            with _cf.ThreadPoolExecutor() as pool:
                bt_data, charges, products, prices = await loop.run_in_executor(pool, _fetch)

        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)

        product_map = {p.id: p for p in products}

        # Revenue totals
        total_rev  = sum(bt.amount for bt in bt_data if bt.amount > 0)
        month_rev  = sum(bt.amount for bt in bt_data if bt.amount > 0 and bt.created >= month_s)
        today_rev  = sum(bt.amount for bt in bt_data if bt.amount > 0 and bt.created >= today_s)
        total_fees = sum(bt.fee    for bt in bt_data)

        # Daily revenue chart
        daily: dict = defaultdict(int)
        for bt in bt_data:
            if bt.amount > 0 and bt.created >= month_s:
                day = datetime.utcfromtimestamp(bt.created).strftime("%m/%d")
                daily[day] += bt.amount
        daily_chart = [{"date": d, "revenue": round(v / 100, 2)} for d, v in sorted(daily.items())]

        # Per-product revenue
        prod_revenue: dict = defaultdict(lambda: {"revenue": 0, "count": 0, "name": "Other"})
        for ch in charges:
            if ch.status != "succeeded":
                continue
            amt  = ch.amount or 0
            desc = ch.description or ""
            # Try metadata → product_id, then payment_intent metadata, then description
            pid  = (ch.metadata or {}).get("product_id") or desc or "uncategorized"
            name = product_map.get(pid, type("", (), {"name": None})()).name or desc or "Other"
            prod_revenue[pid]["revenue"] += amt
            prod_revenue[pid]["count"]   += 1
            prod_revenue[pid]["name"]     = name

        # Fallback: show product catalog when no charge metadata
        if not prod_revenue:
            for price in prices:
                prod = price.product if isinstance(price.product, _stripe.Product) else None
                if prod:
                    prod_revenue[prod.id]["name"]    = prod.name or "Unknown"
                    prod_revenue[prod.id]["revenue"] = 0
                    prod_revenue[prod.id]["count"]   = 0
                    prod_revenue[prod.id]["unit_amount"] = price.unit_amount or 0
                    prod_revenue[prod.id]["currency"]    = (price.currency or "usd").upper()

        products_list = sorted(
            [{"id": k, **v, "revenue_usd": round(v["revenue"] / 100, 2)} for k, v in prod_revenue.items()],
            key=lambda x: x["revenue"], reverse=True
        )

        # Recent successful charges
        recent = []
        for ch in [c for c in charges if c.status == "succeeded"][:20]:
            bd = ch.billing_details or {}
            recent.append({
                "id":             ch.id,
                "amount":         round((ch.amount or 0) / 100, 2),
                "currency":       (ch.currency or "usd").upper(),
                "description":    ch.description or "Payment",
                "customer_email": (bd.get("email") if isinstance(bd, dict) else getattr(bd, "email", None)) or ch.receipt_email or "—",
                "created":        datetime.utcfromtimestamp(ch.created).strftime("%b %d, %Y %H:%M"),
                "receipt_url":    ch.receipt_url or "",
            })

        return {
            "ok": True,
            "summary": {
                "total_revenue": round(total_rev  / 100, 2),
                "month_revenue": round(month_rev  / 100, 2),
                "today_revenue": round(today_rev  / 100, 2),
                "total_fees":    round(total_fees / 100, 2),
                "charge_count":  len([c for c in charges if c.status == "succeeded"]),
            },
            "daily_chart":    daily_chart,
            "products":       products_list,
            "recent_charges": recent,
        }

    # ── Revenue ───────────────────────────────────────────────────────────────
    @app.get("/api/revenue")
    async def get_revenue():
        return _get_dist().revenue_summary()

    @app.get("/api/commerce/revenue")
    async def get_commerce_revenue():
        return await CommerceClient().revenue_summary()

    @app.post("/api/commerce/cta/preview")
    async def preview_cta(req: CtaPreviewReq):
        return await CommerceClient().preview_cta(req.model_dump())

    @app.post("/api/commerce/checkout-session")
    async def create_checkout_session(req: CheckoutReq):
        return await CommerceClient().create_checkout_session(req.model_dump())

    @app.post("/api/commerce/track/click")
    async def track_commerce_click(req: CommerceTrackClickReq):
        return await CommerceClient().track_click(req.model_dump())

    @app.get("/api/commerce/offers")
    async def get_commerce_offers():
        return await CommerceClient().list_offers()

    @app.post("/api/commerce/offers")
    async def create_commerce_offer(req: OfferReq):
        return await CommerceClient().create_offer(req.model_dump())

    @app.get("/api/commerce/landing-pages")
    async def get_commerce_landing_pages():
        return await CommerceClient().list_landing_pages()

    @app.post("/api/commerce/landing-pages")
    async def create_commerce_landing_page(req: LandingPageReq):
        return await CommerceClient().create_landing_page(req.model_dump())

    @app.patch("/api/commerce/landing-pages/{landing_page_id}")
    async def update_commerce_landing_page(landing_page_id: str, req: LandingPageReq):
        payload = req.model_dump()
        payload["id"] = landing_page_id
        return await CommerceClient().update_landing_page(landing_page_id, payload)

    @app.get("/api/commerce/public/landing/{slug}")
    async def get_public_landing_page(slug: str):
        return await CommerceClient().get_public_landing_page(slug)

    @app.post("/api/commerce/public/landing/{slug}/checkout")
    async def create_public_landing_checkout(slug: str, req: PublicLandingCheckoutReq):
        return await CommerceClient().create_public_landing_checkout(slug, req.model_dump())

    @app.post("/api/revenue")
    async def record_revenue(req: RevenueReq):
        _get_dist().record_revenue(
            source=req.source,
            amount_cents=req.amount_cents,
            description=req.description,
            metadata=req.metadata,
        )
        return {"status": "recorded"}

    # ── Social media ──────────────────────────────────────────────────────────
    @app.get("/api/social/queue")
    async def get_social_queue():
        rows = _get_dist().social_queue_data()
        for row in rows:
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            image_path = str(payload.get("image_path", "") or payload.get("hero_image_path", "")).strip()
            payload["image_preview_url"] = _outputs_preview_url(image_path)
            row["payload"] = payload
        return rows

    @app.get("/api/calendar/entries")
    async def get_calendar_entries(include_posted: bool = False):
        rows = _get_dist().calendar_entries_data(include_posted=include_posted)
        for row in rows:
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            payload["image_preview_url"] = _outputs_preview_url(str(payload.get("image_path", "") or payload.get("hero_image_path", "")))
            payload["video_preview_url"] = _outputs_preview_url(str(payload.get("video_path", "") or payload.get("video_filepath", "")))
            row["payload"] = payload
        return rows

    @app.post("/api/calendar/entries")
    async def create_calendar_entry(req: CalendarEntryReq):
        entry = _get_dist().create_calendar_entry(
            platform=req.platform.strip(),
            content_type=req.content_type.strip(),
            scheduled_at=req.scheduled_at.strip(),
            title=req.title.strip(),
            text=req.text.strip(),
            payload=req.payload if isinstance(req.payload, dict) else {},
        )
        payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
        payload["image_preview_url"] = _outputs_preview_url(str(payload.get("image_path", "") or payload.get("hero_image_path", "")))
        payload["video_preview_url"] = _outputs_preview_url(str(payload.get("video_path", "") or payload.get("video_filepath", "")))
        entry["payload"] = payload
        return {"status": "created", "entry": entry}

    @app.get("/api/social/calendar")
    async def get_social_calendar():
        import httpx as _httpx

        sheet_url = str(get_setting("social_calendar", "sheet_url", "") or "").strip()
        if not sheet_url:
            return {"items": [], "source": "", "message": "Add a Google Sheet URL in Settings to enable the calendar."}

        csv_url = _normalize_google_sheet_url(sheet_url)
        try:
            async with _httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                response = await client.get(csv_url)
                response.raise_for_status()
                content = response.text
        except Exception as exc:
            return {"items": [], "source": csv_url, "message": f"Could not load Google Sheet: {exc}"}

        reader = csv.DictReader(StringIO(content))
        queue_rows = _get_dist().social_queue_data()
        posted_keys = {
            (
                _normalize_platform(str(row.get("platform", ""))),
                _normalize_text(str(row.get("text", ""))),
            )
            for row in queue_rows
            if str(row.get("status", "")).strip().lower() == "posted"
        }

        items: list[dict] = []
        for index, raw_row in enumerate(reader, 1):
            row = {str(k).strip(): str(v).strip() for k, v in raw_row.items() if k}
            if not row:
                continue
            platform = _normalize_platform(_row_value(row, "platform", "channel", "network"))
            date_value = _row_value(row, "date", "scheduled_at", "publish_date", "publish_at")
            text = _row_value(row, "text", "caption", "post", "copy", "content")
            title = _row_value(row, "title", "name", "topic")
            status = _normalize_text(_row_value(row, "status", "state"))
            image_url = _row_value(row, "image_url", "image", "image path", "image_path")
            video_url = _row_value(row, "video_url", "video", "video_path")

            if status in {"posted", "published", "done", "complete", "completed"}:
                continue
            if (platform, _normalize_text(text or title)) in posted_keys:
                continue
            if not date_value:
                continue

            items.append({
                "id": f"sheet-{index}",
                "date": date_value,
                "platform": platform or "scheduled",
                "title": title,
                "text": text,
                "status": status or "scheduled",
                "image_url": image_url,
                "video_url": video_url,
            })

        items.sort(key=lambda item: item.get("date", ""))
        return {
            "items": items,
            "source": csv_url,
            "message": "" if items else "No upcoming sheet items found.",
        }

    @app.get("/api/social/approvals")
    async def get_social_approvals():
        rows = _get_dist().social_queue_data()
        items = []
        for row in rows:
            if row.get("status") not in {"pending_approval", "blocked_config"}:
                continue
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            image_path = str(payload.get("image_path", "") or payload.get("hero_image_path", "")).strip()
            preview_url = _outputs_preview_url(image_path)
            if not preview_url:
                title = str(row.get("title") or payload.get("title") or payload.get("topic") or "")
                preview_url = _resolve_social_image(title, str(row.get("platform", "")), int(row.get("id", 0)))
            payload["image_preview_url"] = preview_url
            row["payload"] = payload
            items.append(row)
        return items

    @app.post("/api/social/approve")
    async def approve_social(req: ApprovalReq):
        row = _get_dist().approve_social_queue_item(req.id, req.approved)
        if not row:
            raise HTTPException(status_code=404, detail="Approval item not found")
        if req.approved:
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            entry = _get_dist().create_calendar_entry(
                platform=str(row["platform"]),
                content_type="social",
                scheduled_at=_get_dist().next_schedule_slot(str(row["platform"])),
                title=str(payload.get("title", "") or payload.get("topic", "")),
                text=str(row["text"]),
                payload={
                    **payload,
                    "topic": payload.get("topic", ""),
                    "image_path": payload.get("image_path", ""),
                    "post_url": payload.get("post_url", ""),
                },
            )
            blocker = _social_publish_blocker(str(row["platform"]))
            if blocker:
                entry = _get_dist().update_calendar_entry_status(int(entry["id"]), "blocked_config", {"error": blocker}) or entry
            entry_payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
            image_path = str(entry_payload.get("image_path", "") or entry_payload.get("hero_image_path", "")).strip()
            entry_payload["image_preview_url"] = _outputs_preview_url(image_path)
            entry["payload"] = entry_payload
            return {
                "status": "blocked_config" if blocker else "scheduled",
                "message": blocker or f"{row['platform']} post approved and added to the planner.",
                "item": row,
                "calendar_entry": entry,
            }
        return {
            "status": "approved" if req.approved else "rejected",
            "message": "" if req.approved else f"{row['platform']} post rejected.",
            "item": row,
        }

    @app.get("/api/video/approvals")
    async def get_video_approvals():
        rows = _get_dist().video_approval_queue_data()
        items = []
        for row in rows:
            if row.get("status") not in {"pending_approval", "blocked_config"}:
                continue
            row["preview_url"] = _outputs_preview_url(row.get("video_path", ""))
            payload = row.get("payload", {}) if isinstance(row.get("payload"), dict) else {}
            payload["preview_url"] = _outputs_preview_url(str(payload.get("video_path", "") or payload.get("video_filepath", "")))
            row["payload"] = payload
            items.append(row)
        return items

    @app.post("/api/video/approve")
    async def approve_video(req: ApprovalReq):
        payload = _get_dist().approve_video_queue_item(req.id, req.approved)
        if payload is None:
            raise HTTPException(status_code=404, detail="Approval item not found")
        if req.approved:
            platform = str(payload.get("platform", "")).strip()
            entry = _get_dist().create_calendar_entry(
                platform=platform,
                content_type="video",
                scheduled_at=_get_dist().next_schedule_slot(platform),
                title=str(payload.get("title", "") or payload.get("topic", "")),
                text=str(payload.get("description", "") or payload.get("excerpt", "") or ""),
                payload=payload,
            )
            blocker = _video_publish_blocker(platform)
            if blocker:
                entry = _get_dist().update_calendar_entry_status(int(entry["id"]), "blocked_config", {"error": blocker}) or entry
            entry["preview_url"] = _outputs_preview_url(str(payload.get("video_path", "") or payload.get("video_filepath", "")))
            entry_payload = entry.get("payload", {}) if isinstance(entry.get("payload"), dict) else {}
            entry_payload["video_preview_url"] = _outputs_preview_url(str(entry_payload.get("video_path", "") or entry_payload.get("video_filepath", "")))
            entry["payload"] = entry_payload
            return {
                "status": "blocked_config" if blocker else "scheduled",
                "message": blocker or f"{platform or 'Video'} approved and added to the planner.",
                "payload": payload,
                "calendar_entry": entry,
            }
        return {
            "status": "approved" if req.approved else "rejected",
            "message": "" if req.approved else f"{payload.get('platform', 'video')} publish rejected.",
            "payload": payload,
        }

    # ── Social queue approval endpoints ──────────────────────────────────────
    # These operate on social_queue rows with status='pending'.
    # Distinct from /api/social/approvals which handles the distribution_agent
    # pending_approval workflow. These power the SocialQueuePanel approval tab.

    def _social_queue_db():
        import sqlite3 as _sq
        data_dir = Path(os.getenv("DATA_DIR", "./data"))
        db_path  = data_dir / "revenue.db"
        if not db_path.exists():
            raise HTTPException(status_code=503, detail="Social queue database not found")
        conn = _sq.connect(str(db_path))
        conn.row_factory = _sq.Row
        return conn

    @app.get("/api/social-queue/pending")
    async def social_queue_pending():
        """Posts with status='pending' awaiting manual approval."""
        conn = _social_queue_db()
        try:
            rows = conn.execute(
                """SELECT id, platform, text, scheduled_at, status, payload_json
                   FROM social_queue
                   WHERE status = 'pending'
                   ORDER BY scheduled_at ASC NULLS LAST"""
            ).fetchall()
        finally:
            conn.close()
        items = []
        for r in rows:
            try:
                payload = json.loads(r["payload_json"] or "{}")
            except Exception:
                payload = {}
            items.append({
                "id":           r["id"],
                "platform":     r["platform"],
                "text":         r["text"],
                "image_path":   payload.get("image_path", ""),
                "post_url":     payload.get("post_url", ""),
                "topic":        payload.get("topic", ""),
                "scheduled_at": r["scheduled_at"],
                "status":       r["status"],
                "payload":      payload,
            })
        return items

    @app.post("/api/social-queue/{item_id}/approve")
    async def social_queue_approve(item_id: int):
        """Set a pending post's status to 'approved' so the poster picks it up."""
        conn = _social_queue_db()
        try:
            cur = conn.execute(
                "UPDATE social_queue SET status='approved' WHERE id=? AND status='pending'",
                [item_id],
            )
            conn.commit()
        finally:
            conn.close()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found or not pending")
        return {"ok": True, "id": item_id, "status": "approved"}

    @app.post("/api/social-queue/{item_id}/reject")
    async def social_queue_reject(item_id: int):
        """Set a pending post's status to 'rejected' so it is not posted."""
        conn = _social_queue_db()
        try:
            cur = conn.execute(
                "UPDATE social_queue SET status='rejected' WHERE id=? AND status='pending'",
                [item_id],
            )
            conn.commit()
        finally:
            conn.close()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found or not pending")
        return {"ok": True, "id": item_id, "status": "rejected"}

    @app.patch("/api/social-queue/{item_id}")
    async def social_queue_update(item_id: int, body: dict = Body(...)):
        """Update the text of a pending post before approving."""
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(status_code=422, detail="'text' field required")
        conn = _social_queue_db()
        try:
            cur = conn.execute(
                "UPDATE social_queue SET text=? WHERE id=? AND status='pending'",
                [text.strip(), item_id],
            )
            conn.commit()
        finally:
            conn.close()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found or not pending")
        return {"ok": True, "id": item_id, "text": text.strip()}

    @app.delete("/api/social/approvals/{item_id}")
    async def delete_social_approval(item_id: int):
        ok = _get_dist().delete_social_queue_item(item_id)
        if not ok:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Item not found")
        return {"ok": True}

    @app.delete("/api/video/approvals/{item_id}")
    async def delete_video_approval(item_id: int):
        ok = _get_dist().delete_video_queue_item(item_id)
        if not ok:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Item not found")
        return {"ok": True}

    @app.post("/api/social/post")
    async def manual_social_post(req: SocialPostReq):
        task_id = await _openclaw.submit(
            "social_post",
            {"platform": req.platform, "text": req.text, "topic": req.topic},
            agent_hint="distribution_agent",
        )
        return {"task_id": task_id, "status": "queued"}

    @app.post("/api/chat/message")
    async def chat_with_agent(req: AgentChatReq):
        agent = _openclaw._agents.get(req.agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail=f"Unknown agent: {req.agent_id}")

        message = req.message.strip()
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")

        summary = agent.skill_summary()
        capabilities = ", ".join(summary.get("capabilities", []))
        planner_body = get_prompt_override(
            "chat_planner_prompt",
            """You are converting a dashboard chat message into either:
1. a task execution request, or
2. a normal reply.

Agent ID: {agent_id}
Agent name: {agent_name}
Allowed capabilities: {capabilities}

Return ONLY valid JSON with this exact shape:
{{
  "mode": "task" | "reply",
  "task_type": "blog_post | seo_research | image_gen | tts | video_caption | social_post | financial_report | post_content | video_publish | pipeline | null",
  "payload": {{}},
  "reply": "short direct response to the user",
  "missing_fields": ["field1", "field2"],
  "confidence": 0.0
}}

Rules:
- Choose "task" only if the user is clearly asking you to do work now.
- Only choose task types that match the agent capabilities.
- If required fields are missing, keep mode="reply", list missing_fields, and explain what is missing.
- For pipeline requests, payload should include topic, keywords, and aspect_ratio when stated.
- For blog_post / seo_research / image_gen / tts / video_caption, include topic when available.
- For image_gen, preserve the full visual request in payload.prompt. Example: "make an image of a dog on a chair" should set payload.prompt to "dog on a chair", not just "dog".
- For tts, include text if the user gave specific text to narrate.
- For social_post, include platform and text when available.
- For financial_report, payload may be empty.
- Keep reply concise.""",
        )
        planner_prompt = f"""
{compose_system_prompt("You are converting a dashboard chat message into either task execution or a normal reply.")}

{planner_body.format(
    agent_id=req.agent_id,
    agent_name=summary.get('name', req.agent_id),
    capabilities=capabilities or 'none listed',
)}
""".strip()
        plan = await agent.llm.complete_json(
            f"{planner_prompt}\n\nUser message: {message}",
            use_local=True,
        )

        normalized_capabilities = set(summary.get("capabilities", []))
        task_type = str(plan.get("task_type") or "").strip()
        payload = plan.get("payload") if isinstance(plan.get("payload"), dict) else {}
        if task_type == "image_gen":
            prompt_text = str(payload.get("prompt") or "").strip()
            topic_text = str(payload.get("topic") or "").strip()
            if prompt_text and not topic_text:
                payload["topic"] = prompt_text
            elif topic_text and not prompt_text:
                payload["prompt"] = topic_text
        missing_fields = plan.get("missing_fields") if isinstance(plan.get("missing_fields"), list) else []
        confidence = float(plan.get("confidence") or 0)

        executable_task_types = {
            "blog_post": "blog_post" in normalized_capabilities,
            "seo_research": "seo_research" in normalized_capabilities,
            "image_gen": "image_gen" in normalized_capabilities,
            "tts": "tts" in normalized_capabilities,
            "video_caption": "video_caption" in normalized_capabilities,
            "social_post": "social_post" in normalized_capabilities,
            "financial_report": "financial_report" in normalized_capabilities,
            "post_content": "post_content" in normalized_capabilities,
            "video_publish": "video_publish" in normalized_capabilities,
            "pipeline": req.agent_id == "content_agent",
        }

        should_execute = (
            str(plan.get("mode") or "").strip() == "task"
            and task_type in executable_task_types
            and executable_task_types.get(task_type, False)
            and not missing_fields
            and confidence >= 0.55
        )

        if should_execute:
            if task_type == "pipeline":
                topic = str(payload.get("topic") or "").strip()
                if not topic:
                    raise HTTPException(status_code=400, detail="Pipeline task requires a topic")
                keywords = payload.get("keywords") if isinstance(payload.get("keywords"), list) else []
                aspect_ratio = str(payload.get("aspect_ratio") or "16:9")
                task_ids = await _openclaw.submit_pipeline(topic, [str(k).strip() for k in keywords if str(k).strip()], aspect_ratio=aspect_ratio)
                reply = str(plan.get("reply") or f"Pipeline queued for '{topic}'.").strip()
                return {
                    "agent_id": req.agent_id,
                    "reply": reply,
                    "agent_name": summary.get("name", req.agent_id),
                    "timestamp": datetime.utcnow().isoformat(),
                    "executed": True,
                    "task_type": task_type,
                    "task_ids": task_ids,
                }

            task_id = await _openclaw.submit(
                task_type,
                payload,
                agent_hint=req.agent_id,
            )
            reply = str(plan.get("reply") or f"{task_type} queued.").strip()
            return {
                "agent_id": req.agent_id,
                "reply": reply,
                "agent_name": summary.get("name", req.agent_id),
                "timestamp": datetime.utcnow().isoformat(),
                "executed": True,
                "task_type": task_type,
                "task_id": task_id,
            }

        system = (
            f"{compose_system_prompt()}\n\n"
            f"You are {summary.get('name', req.agent_id)} inside Autonomous Prime.\n"
            f"Agent ID: {req.agent_id}\n"
            f"Capabilities: {capabilities or 'none listed'}\n"
            f"Description: {summary.get('description', '')}\n\n"
            "Answer as this agent. Be direct and practical. If the request requires a workflow "
            "you cannot execute from chat alone, say what task or tab the user should use.\n\n"
            f"{agent.skill_context('chat')}"
        ).strip()
        prompt = (
            "The user is talking to you from the dashboard chat room.\n"
            f"User message: {message}"
        )
        reply = await agent.llm.complete(prompt, system=system, max_tokens=1200, use_local=True)
        return {
            "agent_id": req.agent_id,
            "reply": reply.strip(),
            "agent_name": summary.get("name", req.agent_id),
            "timestamp": datetime.utcnow().isoformat(),
            "executed": False,
            "task_type": task_type or None,
        }

    # ── Unified chat ──────────────────────────────────────────────────────────
    @app.post("/api/chat")
    async def unified_chat(req: UnifiedChatReq):
        message = req.message.strip()
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")

        agents_map = _openclaw._agents

        # Build capability → agent_id map
        cap_to_agent: dict[str, str] = {}
        all_caps: list[str] = []
        for aid, agent in agents_map.items():
            for cap in agent.skill_summary().get("capabilities", []):
                cap_to_agent[cap] = aid
                all_caps.append(cap)

        # Router prompt — pick agent + task
        router_prompt = get_prompt_override(
            "unified_chat_router_prompt",
            """You are a router for an AI automation platform called Autonomous Prime.
A user sent a message from the unified chat. Decide:
1. Which agent should handle this (agent_id).
2. Whether to execute a task or just reply conversationally.

Available agents and their capabilities:
{agents_summary}

Return ONLY valid JSON:
{{
  "agent_id": "content_agent | image_agent | voice_agent | video_agent | distribution_agent | financial_agent",
  "mode": "task" | "reply",
  "task_type": "blog_post | seo_research | image_gen | tts | video_caption | social_post | financial_report | post_content | video_publish | pipeline | null",
  "payload": {{}},
  "reply": "short confirmation or answer",
  "missing_fields": [],
  "confidence": 0.0
}}

Rules:
- Use "task" mode only when the user clearly wants something done now.
- Use "reply" for questions, advice, status checks, or anything conversational.
- For blog_post/seo_research: agent_id = content_agent
- For image_gen: agent_id = image_agent, put full visual description in payload.prompt
- For tts: agent_id = voice_agent, put text in payload.text
- For video_caption/video_publish: agent_id = video_agent
- For social_post/post_content/distribution: agent_id = distribution_agent
- For financial_report: agent_id = financial_agent
- For full pipeline: agent_id = content_agent, task_type = pipeline
- If the user is just asking a question, set mode=reply and pick the most relevant agent to answer.
- Keep reply concise and direct."""
        )

        agents_summary_lines = []
        for aid, agent in agents_map.items():
            s = agent.skill_summary()
            caps = ", ".join(s.get("capabilities", []))
            agents_summary_lines.append(f"  {aid}: {s.get('description','')} [{caps}]")
        agents_summary = "\n".join(agents_summary_lines)

        # Include recent history for context
        history_text = ""
        if req.history:
            recent = req.history[-6:]  # last 3 exchanges
            history_text = "\n\nConversation so far:\n" + "\n".join(
                f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('text', '')}"
                for m in recent
            )

        # Pick the first available agent for routing (use content_agent as default)
        router_agent = agents_map.get("content_agent") or next(iter(agents_map.values()), None)
        if not router_agent:
            raise HTTPException(status_code=503, detail="No agents available")

        plan = await router_agent.llm.complete_json(
            f"{router_prompt.format(agents_summary=agents_summary)}{history_text}\n\nUser message: {message}",
            use_local=True,
        )

        agent_id   = str(plan.get("agent_id") or "content_agent").strip()
        task_type  = str(plan.get("task_type") or "").strip()
        payload    = plan.get("payload") if isinstance(plan.get("payload"), dict) else {}
        mode       = str(plan.get("mode") or "reply").strip()
        confidence = float(plan.get("confidence") or 0)
        missing    = plan.get("missing_fields") if isinstance(plan.get("missing_fields"), list) else []

        agent = agents_map.get(agent_id) or router_agent
        summary = agent.skill_summary()

        # Fix image_gen payload
        if task_type == "image_gen":
            prompt_text = str(payload.get("prompt") or "").strip()
            topic_text  = str(payload.get("topic") or "").strip()
            if prompt_text and not topic_text:
                payload["topic"] = prompt_text
            elif topic_text and not prompt_text:
                payload["prompt"] = topic_text

        should_execute = (
            mode == "task"
            and task_type
            and task_type != "null"
            and not missing
            and confidence >= 0.55
        )

        if should_execute:
            if task_type == "pipeline":
                topic = str(payload.get("topic") or "").strip()
                if not topic:
                    return {
                        "agent_id": agent_id,
                        "agent_name": summary.get("name", agent_id),
                        "reply": "What topic should I run the pipeline for?",
                        "timestamp": datetime.utcnow().isoformat(),
                        "executed": False,
                    }
                keywords = payload.get("keywords") if isinstance(payload.get("keywords"), list) else []
                aspect_ratio = str(payload.get("aspect_ratio") or "16:9")
                task_ids = await _openclaw.submit_pipeline(topic, [str(k).strip() for k in keywords if str(k).strip()], aspect_ratio=aspect_ratio)
                return {
                    "agent_id": agent_id,
                    "agent_name": summary.get("name", agent_id),
                    "reply": str(plan.get("reply") or f"Pipeline queued for '{topic}'. I've kicked off research, content, and asset generation.").strip(),
                    "timestamp": datetime.utcnow().isoformat(),
                    "executed": True,
                    "task_type": task_type,
                    "task_ids": task_ids,
                }

            task_id = await _openclaw.submit(task_type, payload, agent_hint=agent_id)
            return {
                "agent_id": agent_id,
                "agent_name": summary.get("name", agent_id),
                "reply": str(plan.get("reply") or f"{task_type} queued.").strip(),
                "timestamp": datetime.utcnow().isoformat(),
                "executed": True,
                "task_type": task_type,
                "task_id": task_id,
            }

        # Conversational reply — use the chosen agent's persona
        capabilities = ", ".join(summary.get("capabilities", []))
        system = (
            f"{compose_system_prompt()}\n\n"
            f"You are {summary.get('name', agent_id)} inside Autonomous Prime, an AI automation platform.\n"
            f"Capabilities: {capabilities or 'general assistant'}\n"
            f"Description: {summary.get('description', '')}\n\n"
            "Be direct, practical, and helpful. If the user wants to trigger a workflow, "
            "tell them exactly what to say or do. Keep answers concise."
        ).strip()

        history_prompt = ""
        if req.history:
            recent = req.history[-6:]
            history_prompt = "\n\nPrevious messages:\n" + "\n".join(
                f"{'User' if m.get('role') == 'user' else 'You'}: {m.get('text', '')}"
                for m in recent
            ) + "\n"

        full_prompt = f"{history_prompt}\nUser: {message}"
        reply_text = await agent.llm.complete(full_prompt, system=system, max_tokens=1200, use_local=True)
        return {
            "agent_id": agent_id,
            "agent_name": summary.get("name", agent_id),
            "reply": reply_text.strip(),
            "timestamp": datetime.utcnow().isoformat(),
            "executed": False,
            "task_type": task_type or None,
        }

    def _infer_type(path: str) -> str:
        ext = Path(path).suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".webp"):  return "image"
        if ext in (".mp3", ".wav", ".ogg"):             return "audio"
        if ext in (".mp4", ".webm", ".mov"):            return "video"
        if ext == ".pdf":                               return "pdf"
        return "blog"

    @app.get("/api/chat/task-result/{task_id}")
    async def chat_task_result(task_id: str):
        """Poll a task by ID. When done, return its status + any output files."""
        outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))

        # Look up via queue.get_task() — covers active + history
        task = _openclaw.queue.get_task(task_id) if hasattr(_openclaw, "queue") else None

        if task is None:
            return {"ok": True, "status": "pending", "files": []}

        done_statuses   = {"completed", "failed", "cancelled"}
        is_done  = task.status.value in done_statuses if hasattr(task.status, "value") else str(task.status) in done_statuses
        is_error = task.status.value in {"failed", "cancelled"} if hasattr(task.status, "value") else str(task.status) in {"failed", "cancelled"}

        if not is_done:
            return {"ok": True, "status": "pending", "files": []}

        found_files: list[dict] = []
        result = task.result or {}

        def add_file(path_str: str, ftype: str) -> None:
            if not path_str:
                return
            p = Path(path_str)
            if not p.exists():
                return
            try:
                rel = p.relative_to(outputs_dir)
                url = f"/api/outputs/file/{rel.as_posix()}"
            except ValueError:
                return
            found_files.append({
                "name": p.name,
                "type": ftype,
                "url": url,
                "size_kb": round(p.stat().st_size / 1024, 1),
            })

        # Pull filepaths directly from the task result
        add_file(result.get("filepath", ""),        _infer_type(result.get("filepath", "")))
        add_file(result.get("image_path", ""),      "image")
        add_file(result.get("image_filepath", ""),  "image")
        add_file(result.get("audio_filepath", ""),  "audio")
        add_file(result.get("full_audio_path", ""), "audio")
        add_file(result.get("video_filepath", ""),  "video")
        add_file(result.get("blog_filepath", ""),   "blog")
        add_file(result.get("pdf_path", ""),        "pdf")
        add_file(result.get("html_path", ""),       "blog")

        # Fallback: scan outputs for files modified in last 3 min
        if not found_files:
            cutoff = datetime.utcnow().timestamp() - 180
            for folder, ftype in [("images", "image"), ("audio", "audio"), ("video", "video"), ("blog", "blog")]:
                fp = outputs_dir / folder
                if not fp.exists():
                    continue
                for f in fp.iterdir():
                    if f.is_file() and f.stat().st_mtime >= cutoff:
                        rel = f.relative_to(outputs_dir)
                        found_files.append({
                            "name": f.name,
                            "type": ftype,
                            "url": f"/api/outputs/file/{rel.as_posix()}",
                            "size_kb": round(f.stat().st_size / 1024, 1),
                        })

        found_files = [dict(t) for t in {tuple(d.items()) for d in found_files}]  # deduplicate
        found_files.sort(key=lambda x: x["name"], reverse=True)
        return {
            "ok": True,
            "status": "error" if is_error else "done",
            "files": found_files[:8],
            # Pass raw paths for ebook PDF-on-demand export
            "html_path": result.get("html_path", ""),
        }

    @app.get("/api/outputs/file/{file_path:path}")
    async def serve_output_file(file_path: str):
        """Serve any file from the outputs directory."""
        outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        full_path = (outputs_dir / file_path).resolve()
        # Security: ensure path stays within outputs_dir
        if not str(full_path).startswith(str(outputs_dir.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(str(full_path))

    # ── SEO rankings ──────────────────────────────────────────────────────────
    @app.get("/api/seo/rankings")
    async def get_seo_rankings():
        from core.seo_tracker import SEOTracker
        return SEOTracker().ranking_history()

    @app.post("/api/seo/check")
    async def check_seo(req: SeoCheckReq):
        from core.seo_tracker import SEOTracker
        return await SEOTracker().check_rankings(req.keywords)

    @app.post("/api/seo/track")
    async def track_keyword(req: SeoTrackReq):
        from core.seo_tracker import SEOTracker
        SEOTracker().add_keyword(req.keyword, req.url)
        return {"status": "tracking"}

    @app.get("/api/seo/top")
    async def top_keywords():
        from core.seo_tracker import SEOTracker
        return SEOTracker().top_keywords()

    @app.get("/api/seo/audit")
    async def get_seo_audit():
        from core.seo_tracker import SEOTracker
        return SEOTracker().seo_audit()

    @app.get("/api/seo/report.pdf")
    async def download_seo_report():
        from core.seo_tracker import SEOTracker
        tracker = SEOTracker()
        pdf_path = tracker.export_audit_pdf()
        return FileResponse(str(pdf_path), media_type="application/pdf", filename=pdf_path.name)

    # ── Settings ──────────────────────────────────────────────────────────────
    @app.get("/api/settings")
    async def get_settings(request: Request):
        return load_settings(mask_secrets=True, user_id=str(request.state.user.get("id", "")))

    def resolve_secret_value(request: Request, section: str, key: str, incoming: str) -> str:
        value = str(incoming or "").strip()
        if SECRET_MASK not in value:
            return value
        saved = load_settings(mask_secrets=False, user_id=str(request.state.user.get("id", "")))
        return str(saved.get(section, {}).get(key, "") or "")

    @app.post("/api/settings")
    async def save_settings_endpoint(req: SettingsReq, request: Request):
        user_id = str(request.state.user.get("id", ""))
        data = req.model_dump()
        # Sync automation toggles → approvals so all code paths stay consistent
        if data.get("automation"):
            auto = data["automation"]
            if not data.get("approvals"):
                data["approvals"] = {}
            if "require_social_approval" in auto:
                data["approvals"]["require_social_approval"] = auto["require_social_approval"]
            if "require_video_approval" in auto:
                data["approvals"]["require_video_approval"] = auto["require_video_approval"]
        persist_settings(data, user_id=user_id)

        refresh_warning = ""
        try:
            apply_settings_to_env(user_id=user_id)
            _openclaw.refresh_runtime_config()
        except Exception as exc:
            refresh_warning = str(exc)

        try:
            masked_settings = load_settings(mask_secrets=True, user_id=user_id)
        except Exception as exc:
            logger.exception("[Settings] Saved, but failed to reload masked settings")
            return {
                "status": "saved",
                "warning": refresh_warning or f"Settings saved, but reload failed: {exc}",
            }

        if refresh_warning:
            logger.warning(f"[Settings] Saved with runtime refresh warning: {refresh_warning}")
            return {
                "status": "saved",
                "warning": refresh_warning,
                "settings": masked_settings,
            }

        return {
            "status": "saved",
            "settings": masked_settings,
        }

    def _deep_merge_dict(base: dict, patch: dict) -> dict:
        out = dict(base or {})
        for k, v in (patch or {}).items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = _deep_merge_dict(out.get(k, {}), v)
            else:
                out[k] = v
        return out

    def _replace_secret_masks(patch: object, saved: object) -> object:
        # Walk a nested dict and replace masked secret strings ("****") with saved values.
        if isinstance(patch, dict) and isinstance(saved, dict):
            out: dict = {}
            for k, v in patch.items():
                out[k] = _replace_secret_masks(v, saved.get(k))
            return out
        if isinstance(patch, list) and isinstance(saved, list):
            return [
                _replace_secret_masks(v, saved[i] if i < len(saved) else None)
                for i, v in enumerate(patch)
            ]
        if isinstance(patch, str) and SECRET_MASK in patch:
            return saved if isinstance(saved, str) else ""
        return patch

    @app.patch("/api/settings")
    async def patch_settings_endpoint(request: Request, req: dict = Body(...)):
        """
        Partial settings update: deep-merge provided sections into existing saved settings.
        This avoids wiping unrelated sections when the UI saves a single tab.
        """
        user_id = str(request.state.user.get("id", ""))
        incoming = req or {}
        if not isinstance(incoming, dict):
            raise HTTPException(status_code=400, detail="Invalid settings payload")

        saved_full = load_settings(mask_secrets=False, user_id=user_id)
        incoming = _replace_secret_masks(incoming, saved_full)
        merged = _deep_merge_dict(saved_full, incoming)

        # Sync automation toggles → approvals so all code paths stay consistent
        if merged.get("automation"):
            auto = merged["automation"]
            if not merged.get("approvals"):
                merged["approvals"] = {}
            if "require_social_approval" in auto:
                merged["approvals"]["require_social_approval"] = auto["require_social_approval"]
            if "require_video_approval" in auto:
                merged["approvals"]["require_video_approval"] = auto["require_video_approval"]

        persist_settings(merged, user_id=user_id)

        refresh_warning = ""
        try:
            apply_settings_to_env(user_id=user_id)
            _openclaw.refresh_runtime_config()
        except Exception as exc:
            refresh_warning = str(exc)

        masked_settings = load_settings(mask_secrets=True, user_id=user_id)
        if refresh_warning:
            logger.warning(f"[Settings] Patched with runtime refresh warning: {refresh_warning}")
            return {"status": "saved", "warning": refresh_warning, "settings": masked_settings}

        return {"status": "saved", "settings": masked_settings}

    @app.get("/api/provider-verifications")
    async def get_provider_verifications(request: Request, workspace_id: str = ""):
        user_id = str(request.state.user.get("id", ""))
        workspace_id = str(workspace_id or "").strip() or "default"
        data = _load_provider_verifications()
        user_bucket = data.get(user_id, {})
        ws_bucket = user_bucket.get(workspace_id, {})
        items = []
        for service, entry in (ws_bucket or {}).items():
            items.append({
                "workspace_id": workspace_id,
                "service": str(service),
                "state": str(entry.get("state") or "needs_attention"),
                "message": str(entry.get("message") or ""),
                "checked_at": str(entry.get("checked_at") or ""),
            })
        return {"ok": True, "items": items}

    @app.post("/api/provider-verifications")
    async def save_provider_verification(request: Request, req: dict = Body(...)):
        user_id = str(request.state.user.get("id", ""))
        workspace_id = str(req.get("workspace_id") or "").strip() or "default"
        service = str(req.get("service") or "").strip().lower()
        state = str(req.get("state") or "").strip()
        message = str(req.get("message") or "")
        checked_at = str(req.get("checked_at") or "").strip() or datetime.utcnow().isoformat() + "Z"

        if not service:
            raise HTTPException(status_code=400, detail="service is required")
        if state not in ("connected", "needs_attention", "not_configured"):
            raise HTTPException(status_code=400, detail="state must be one of connected|needs_attention|not_configured")

        data = _load_provider_verifications()
        if user_id not in data:
            data[user_id] = {}
        if workspace_id not in data[user_id]:
            data[user_id][workspace_id] = {}
        data[user_id][workspace_id][service] = {
            "state": state,
            "message": message,
            "checked_at": checked_at,
        }
        _save_provider_verifications(data)

        return {"ok": True, "item": {"workspace_id": workspace_id, "service": service, "state": state, "message": message, "checked_at": checked_at}}

    @app.post("/api/settings/test/wordpress")
    async def test_wordpress(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        url = req.get("url", "").rstrip("/")
        user = req.get("username", "")
        pw = resolve_secret_value(request, "wordpress", "app_password", req.get("app_password", ""))
        if not url:
            return {"ok": False, "message": "URL is required"}
        try:
            r = _httpx.get(f"{url}/wp-json/wp/v2/users/me",
                           auth=(user, pw), timeout=8)
            if r.status_code == 200:
                name = r.json().get("name", "unknown")
                return {"ok": True, "message": f"Connected as {name}"}
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/comfyui")
    async def test_comfyui(req: dict = Body(...)):
        import httpx as _httpx
        url = req.get("url", "").rstrip("/")
        if not url:
            return {"ok": False, "message": "URL is required"}
        try:
            r = _httpx.get(f"{url}/system_stats", timeout=6)
            if r.status_code == 200:
                return {"ok": True, "message": "ComfyUI reachable"}
            return {"ok": False, "message": f"HTTP {r.status_code}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/coqui")
    async def test_coqui(req: dict = Body(...)):
        import httpx as _httpx
        url = _normalize_service_url(req.get("url", ""), "http://localhost:5002").rstrip("/")
        model = str(req.get("model", "") or "").strip()
        language = str(req.get("language", "") or "").strip()
        speaker = str(req.get("speaker", "") or "").strip()
        speaker_wav = str(req.get("speaker_wav", "") or "").strip()
        default_speaker_wav = Path.home() / "voice.wav"
        used_default_voice = False
        if not speaker_wav and default_speaker_wav.exists():
            speaker_wav = str(default_speaker_wav)
            used_default_voice = True
        if not url:
            return {"ok": False, "message": "URL is required"}
        if speaker_wav:
            wav_path = Path(speaker_wav).expanduser()
            if not wav_path.exists():
                return {"ok": False, "message": f"Speaker WAV not found: {wav_path}"}
            if model and not _coqui_model_supports_voice_clone(model):
                return {
                    "ok": False,
                    "message": f"The current model `{model}` does not use `speaker_wav`. Use an XTTS model such as `tts_models/multilingual/multi-dataset/xtts_v2` for voice cloning.",
                }
        try:
            timeout = _httpx.Timeout(90.0, connect=5.0)
            with _httpx.Client(timeout=timeout, follow_redirects=True) as client:
                try:
                    client.get(url, timeout=_httpx.Timeout(5.0, connect=5.0))
                except Exception:
                    pass

                payload = {"text": "Voice test."}
                if model:
                    payload["model_name"] = model
                if language:
                    payload["language"] = language
                    payload["language_id"] = language
                if speaker_wav:
                    payload["speaker_wav"] = str(Path(speaker_wav).expanduser())
                elif speaker:
                    payload["speaker"] = speaker
                    payload["speaker_id"] = speaker

                r = client.post(f"{url}/api/tts", data=payload)
                if r.status_code >= 400:
                    r = client.get(f"{url}/api/tts", params=payload)
            content_type = (r.headers.get("content-type") or "").lower()
            if r.status_code == 200 and (content_type.startswith("audio/") or r.content[:4] == b"RIFF"):
                model_label = model or "default model"
                if speaker_wav:
                    source_label = f" and speaker WAV `{Path(speaker_wav).name}`"
                    if used_default_voice:
                        source_label += " from your home directory"
                    return {"ok": True, "message": f"Coqui reachable with {model_label}{source_label}"}
                return {"ok": True, "message": f"Coqui reachable with {model_label}"}
            snippet = r.text[:120] if "text" in content_type or "json" in content_type else f"content-type={content_type or 'unknown'}"
            return {"ok": False, "message": f"Unexpected Coqui response ({r.status_code}): {snippet}"}
        except _httpx.ReadTimeout:
            model_label = model or "default model"
            return {
                "ok": False,
                "message": f"Coqui reached the server, but synthesis timed out while loading or running `{model_label}`. XTTS can take longer on first load.",
            }
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/ollama")
    async def test_ollama(req: dict = Body(...)):
        import httpx as _httpx
        url = req.get("url", "").rstrip("/")
        if not url:
            return {"ok": False, "message": "URL is required"}
        try:
            r = _httpx.get(f"{url}/api/tags", timeout=6)
            if r.status_code == 200:
                models = [m["name"] for m in r.json().get("models", [])]
                return {"ok": True, "message": f"Ollama OK — models: {', '.join(models[:5]) or 'none'}"}
            return {"ok": False, "message": f"HTTP {r.status_code}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/ffmpeg")
    async def test_ffmpeg(req: dict = Body(...)):
        import subprocess as _sp
        path = req.get("path", "ffmpeg") or "ffmpeg"
        try:
            r = _sp.run([path, "-version"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                version = r.stdout.splitlines()[0] if r.stdout else "ffmpeg found"
                return {"ok": True, "message": version}
            return {"ok": False, "message": r.stderr[:120]}
        except FileNotFoundError:
            return {"ok": False, "message": f"'{path}' not found in PATH"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/serpapi")
    async def test_serpapi(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        key = resolve_secret_value(request, "serpapi", "key", req.get("key", ""))
        if not key:
            return {"ok": False, "message": "Enter a real API key"}
        try:
            r = _httpx.get("https://serpapi.com/account", params={"api_key": key}, timeout=8)
            if r.status_code == 200:
                plan = r.json().get("plan_name", "unknown")
                return {"ok": True, "message": f"SerpAPI OK — plan: {plan}"}
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/claude")
    async def test_claude(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        key = resolve_secret_value(request, "openclaw", "claude_api_key", req.get("claude_api_key", ""))
        model = str(req.get("claude_model", "") or "claude-sonnet-4-6").strip()
        if not key:
            return {"ok": False, "message": "Enter a real Claude API key"}
        try:
            r = _httpx.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                },
                timeout=8,
            )
            if r.status_code == 200:
                return {"ok": True, "message": f"Claude API OK - model: {model}"}
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/groq")
    async def test_groq(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        api_url = _normalize_service_url(req.get("groq_api_url", "") or req.get("api_url", ""), "https://api.groq.com/openai/v1").rstrip("/")
        api_key = resolve_secret_value(request, "openclaw", "groq_api_key", req.get("groq_api_key", ""))
        model = str(req.get("groq_model", "") or "llama-3.1-8b-instant").strip()
        if not api_key:
            return {"ok": False, "message": "Enter a real Groq API key"}
        try:
            r = _httpx.post(
                f"{api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Reply with OK"}],
                    "max_tokens": 8,
                },
                timeout=12,
            )
            if r.status_code == 200:
                return {"ok": True, "message": f"Groq API OK - model: {model}"}
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:160]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/elevenlabs")
    async def test_elevenlabs(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        enabled = as_bool(req.get("enabled", "false"))
        api_url = str(req.get("api_url", "") or "").rstrip("/")
        api_key = resolve_secret_value(request, "elevenlabs", "api_key", req.get("api_key", ""))
        if not enabled:
            return {"ok": False, "message": "ElevenLabs is disabled in Settings"}
        if not api_url:
            return {"ok": False, "message": "API URL is required"}
        if not api_key:
            return {"ok": False, "message": "Enter a real ElevenLabs API key"}
        try:
            r = _httpx.get(f"{api_url}/v1/models", headers={"xi-api-key": api_key}, timeout=8)
            if r.status_code == 200:
                return {"ok": True, "message": "ElevenLabs reachable"}
            safe_text = r.text[:120].encode("utf-8", errors="replace").decode("utf-8", errors="replace")
            return {"ok": False, "message": f"HTTP {r.status_code}: {safe_text}"}
        except Exception as e:
            return {"ok": False, "message": str(e).encode("utf-8", errors="replace").decode("utf-8", errors="replace")}

    @app.post("/api/settings/test/deepgram")
    async def test_deepgram(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        enabled = as_bool(req.get("enabled", "false"))
        api_url = _normalize_service_url(req.get("api_url", ""), "https://api.deepgram.com").rstrip("/")
        api_key = resolve_secret_value(request, "deepgram", "api_key", req.get("api_key", ""))
        model = str(req.get("model", "") or "nova-3").strip()
        language = str(req.get("language", "") or "en").strip()
        smart_format = as_bool(req.get("smart_format", "true"))
        if not enabled:
            return {"ok": False, "message": "Deepgram is disabled in Settings"}
        if not api_url:
            return {"ok": False, "message": "API URL is required"}
        if not api_key:
            return {"ok": False, "message": "Enter a real Deepgram API key"}
        try:
            params = {
                "model": model,
                "language": language,
                "smart_format": "true" if smart_format else "false",
                "utterances": "true",
                "punctuate": "true",
            }
            response = _httpx.post(
                f"{api_url}/v1/listen",
                params=params,
                headers={
                    "Authorization": f"Token {api_key}",
                    "Content-Type": "audio/wav",
                },
                content=_build_test_wav_bytes(),
                timeout=20,
            )
            if response.status_code != 200:
                return {"ok": False, "message": f"HTTP {response.status_code}: {response.text[:160]}"}
            payload = response.json()
            metadata = payload.get("metadata") or {}
            model_used = metadata.get("model_info", {}).get("name") or model
            return {"ok": True, "message": f"Deepgram reachable - model: {model_used}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/abacus")
    async def test_abacus(request: Request, req: dict = Body(...)):
        import httpx as _httpx
        enabled = as_bool(req.get("enabled", "false"))
        api_url = str(req.get("api_url", "") or "").rstrip("/")
        api_key = resolve_secret_value(request, "abacus", "api_key", req.get("api_key", ""))
        llm_model = str(req.get("llm_model", "") or "gpt-4.1-mini").strip()
        if not enabled:
            return {"ok": False, "message": "Abacus AI is disabled in Settings"}
        if not api_url:
            return {"ok": False, "message": "API URL is required"}
        if not api_key:
            return {"ok": False, "message": "Enter a real Abacus API key"}
        try:
            r = _httpx.post(
                f"{api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": llm_model,
                    "messages": [{"role": "user", "content": "Reply with OK"}],
                    "max_tokens": 8,
                },
                timeout=12,
            )
            if r.status_code == 200:
                return {"ok": True, "message": f"Abacus AI reachable - model: {llm_model}"}
            return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:120]}"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    @app.post("/api/settings/test/{service}")
    async def test_generic_service(service: str, req: dict = Body(...)):
        import httpx as _httpx

        service = str(service or "").strip().lower()

        def _masked(value: str) -> bool:
            return not value or "****" in value

        def _enabled_message(name: str) -> dict:
            return {"ok": False, "message": f"{name} is disabled in Settings"}

        if service in {"openclaw", "ollama"}:
            url = str(req.get("ollama_url", "") or req.get("url", "")).rstrip("/")
            if not url:
                return {"ok": False, "message": "Ollama URL is required"}
            try:
                r = _httpx.get(f"{url}/api/tags", timeout=6)
                if r.status_code == 200:
                    models = [m.get("name", "") for m in r.json().get("models", []) if m.get("name")]
                    return {"ok": True, "message": f"Ollama OK — models: {', '.join(models[:5]) or 'none'}"}
                return {"ok": False, "message": f"HTTP {r.status_code}"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        if service == "commerce":
            url = str(req.get("api_url", "") or req.get("url", "")).rstrip("/")
            if not url:
                return {"ok": False, "message": "Commerce API URL is required"}
            try:
                r = _httpx.get(f"{url}/health", timeout=8)
                if r.status_code == 200:
                    return {"ok": True, "message": "Commerce API reachable"}
                return {"ok": False, "message": f"HTTP {r.status_code}"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        if service == "groq":
            api_url = _normalize_service_url(req.get("groq_api_url", "") or req.get("api_url", ""), "https://api.groq.com/openai/v1").rstrip("/")
            api_key = str(req.get("groq_api_key", "") or req.get("api_key", "") or "")
            model = str(req.get("groq_model", "") or req.get("model", "") or "llama-3.1-8b-instant").strip()
            if not api_url:
                return {"ok": False, "message": "Groq API URL is required"}
            if _masked(api_key):
                return {"ok": False, "message": "Groq API key is required"}
            try:
                r = _httpx.post(
                    f"{api_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Reply with OK"}],
                        "max_tokens": 8,
                    },
                    timeout=12,
                )
                if r.status_code == 200:
                    return {"ok": True, "message": f"Groq reachable - model: {model}"}
                return {"ok": False, "message": f"HTTP {r.status_code}: {r.text[:160]}"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        if service == "deepgram":
            enabled = as_bool(req.get("enabled", "false"))
            api_url = _normalize_service_url(req.get("api_url", ""), "https://api.deepgram.com").rstrip("/")
            api_key = str(req.get("api_key", "") or "")
            model = str(req.get("model", "") or "nova-3").strip()
            language = str(req.get("language", "") or "en").strip()
            smart_format = as_bool(req.get("smart_format", "true"))
            if not enabled:
                return _enabled_message("Deepgram")
            if not api_url:
                return {"ok": False, "message": "API URL is required"}
            if _masked(api_key):
                return {"ok": False, "message": "API key is required"}
            try:
                params = {
                    "model": model,
                    "language": language,
                    "smart_format": "true" if smart_format else "false",
                    "utterances": "true",
                    "punctuate": "true",
                }
                response = _httpx.post(
                    f"{api_url}/v1/listen",
                    params=params,
                    headers={
                        "Authorization": f"Token {api_key}",
                        "Content-Type": "audio/wav",
                    },
                    content=_build_test_wav_bytes(),
                    timeout=20,
                )
                if response.status_code != 200:
                    return {"ok": False, "message": f"HTTP {response.status_code}: {response.text[:160]}"}
                payload = response.json()
                metadata = payload.get("metadata") or {}
                model_used = metadata.get("model_info", {}).get("name") or model
                return {"ok": True, "message": f"Deepgram reachable - model: {model_used}"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        if service == "ffmpeg":
            path = req.get("path", "ffmpeg") or "ffmpeg"
            try:
                r = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=5)
                if r.returncode == 0:
                    version = r.stdout.splitlines()[0] if r.stdout else "ffmpeg found"
                    return {"ok": True, "message": version}
                return {"ok": False, "message": (r.stderr or "ffmpeg failed")[:120]}
            except FileNotFoundError:
                return {"ok": False, "message": f"'{path}' not found in PATH"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        if service in {
            "x", "facebook", "facebook_groups", "linkedin", "instagram_posts",
            "youtube", "tiktok", "instagram",
        }:
            enabled = as_bool(req.get("enabled", "false"))
            if not enabled:
                return _enabled_message(service)

            url_key = "post_url" if service in {"x", "facebook", "facebook_groups", "linkedin", "instagram_posts"} else "upload_url"
            url = str(req.get(url_key, "")).rstrip("/")
            token = str(req.get("access_token", "") or "")

            id_field_map = {
                "x": "account_id",
                "facebook": "page_id",
                "facebook_groups": "group_id",
                "linkedin": "author_id",
                "instagram_posts": "account_id",
                "youtube": "channel_id",
                "tiktok": "creator_id",
                "instagram": "account_id",
            }
            entity_id = str(req.get(id_field_map[service], "") or "")

            if not url:
                label = "post URL" if url_key == "post_url" else "upload URL"
                return {"ok": False, "message": f"{label} is required"}
            if _masked(token):
                return {"ok": False, "message": "Access token is required"}
            if not entity_id:
                return {"ok": False, "message": f"{id_field_map[service]} is required"}

            try:
                parsed = _httpx.URL(url)
                if parsed.scheme not in {"http", "https"} or not parsed.host:
                    return {"ok": False, "message": "URL must be a valid http or https address"}
                return {"ok": True, "message": f"{service} configuration looks valid"}
            except Exception as e:
                return {"ok": False, "message": str(e)}

        return {"ok": False, "message": f"No test handler for service '{service}'"}

    # ── Content browser ───────────────────────────────────────────────────────
    @app.get("/api/analytics/local")
    async def local_analytics():
        """Real analytics built from local files and the SQLite database."""
        import sqlite3 as _sq
        import json as _json
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td

        outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        data_dir    = Path(os.getenv("DATA_DIR", "./data"))
        db_path     = data_dir / "revenue.db"

        # ── Outputs counts ────────────────────────────────────────────────
        def count_files(folder: Path, *exts) -> list[dict]:
            if not folder.exists():
                return []
            files = []
            for f in sorted(folder.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if not exts or f.suffix.lower() in exts:
                    files.append({"name": f.name, "mtime": f.stat().st_mtime})
            return files

        blogs  = count_files(outputs_dir / "blog",   ".md")
        images = count_files(outputs_dir / "images", ".png", ".jpg", ".webp")
        audios = count_files(outputs_dir / "audio",  ".mp3", ".wav")
        videos = count_files(outputs_dir / "video")

        # ── Per-day content created (last 14 days) ────────────────────────
        now = _dt.now(_tz.utc)
        daily: dict[str, dict] = {}
        for i in range(14):
            d = (now - _td(days=i)).strftime("%Y-%m-%d")
            daily[d] = {"date": d, "blogs": 0, "images": 0, "videos": 0}

        for f in blogs:
            d = _dt.fromtimestamp(f["mtime"], _tz.utc).strftime("%Y-%m-%d")
            if d in daily:
                daily[d]["blogs"] += 1
        for f in images:
            d = _dt.fromtimestamp(f["mtime"], _tz.utc).strftime("%Y-%m-%d")
            if d in daily:
                daily[d]["images"] += 1
        for f in videos:
            d = _dt.fromtimestamp(f["mtime"], _tz.utc).strftime("%Y-%m-%d")
            if d in daily:
                daily[d]["videos"] += 1

        daily_chart = list(reversed(list(daily.values())))

        # ── Social queue stats from SQLite ───────────────────────────────
        social_stats = {"pending": 0, "posted": 0, "failed": 0, "approved": 0, "by_platform": {}}
        if db_path.exists():
            try:
                conn = _sq.connect(str(db_path))
                rows = conn.execute("SELECT platform, status FROM social_queue").fetchall()
                conn.close()
                for platform, status in rows:
                    p = str(platform or "unknown").lower()
                    s = str(status or "").lower()
                    if s in social_stats:
                        social_stats[s] += 1
                    bp = social_stats["by_platform"]
                    if p not in bp:
                        bp[p] = {"posted": 0, "pending": 0, "failed": 0}
                    if s in bp[p]:
                        bp[p][s] += 1
            except Exception:
                pass

        # ── Comment replies ───────────────────────────────────────────────
        reply_log_path = data_dir / "comment_replies.json"
        replies: list[dict] = []
        if reply_log_path.exists():
            try:
                with open(reply_log_path, encoding="utf-8") as f:
                    replies = _json.load(f)
            except Exception:
                pass
        reply_by_platform: dict[str, int] = {}
        for r in replies:
            p = str(r.get("platform", "unknown"))
            reply_by_platform[p] = reply_by_platform.get(p, 0) + 1

        # ── SEO data from seo.json files ──────────────────────────────────
        seo_scores: list[int] = []
        seo_dir = outputs_dir / "blog"
        if seo_dir.exists():
            for f in seo_dir.glob("*_seo.json"):
                try:
                    with open(f, encoding="utf-8") as fp:
                        data = _json.load(fp)
                    score = data.get("seo_score") or data.get("score")
                    if score:
                        seo_scores.append(int(score))
                except Exception:
                    pass

        avg_seo = round(sum(seo_scores) / len(seo_scores), 1) if seo_scores else 0

        return {
            "ok": True,
            "totals": {
                "blogs": len(blogs),
                "images": len(images),
                "audios": len(audios),
                "videos": len(videos),
                "social_posted": social_stats["posted"],
                "social_pending": social_stats["pending"],
                "comment_replies": len(replies),
            },
            "daily_chart": daily_chart,
            "social": social_stats,
            "reply_by_platform": reply_by_platform,
            "seo": {
                "avg_score": avg_seo,
                "scored_posts": len(seo_scores),
            },
        }

    @app.get("/api/outputs/blog")
    async def list_blog_posts():
        blog_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "blog"
        if not blog_dir.exists():
            return []
        files = sorted(blog_dir.glob("*"), key=lambda f: f.stat().st_mtime, reverse=True)
        return [
            {
                "filename": f.name,
                "size_kb": round(f.stat().st_size / 1024, 1),
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            }
            for f in files[:30]
        ]

    @app.get("/api/outputs/seo-report")
    async def seo_report_html(slug: str = ""):
        """Generate a printable HTML SEO report for a blog post by slug."""
        import json as _json
        blog_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "blog"
        # Find the SEO JSON — by slug or the most recent one
        if slug:
            seo_path = blog_dir / f"{slug}_seo.json"
            md_path = next(blog_dir.glob(f"*_{slug}.md"), None) or blog_dir / f"{slug}.md"
        else:
            candidates = sorted(blog_dir.glob("*_seo.json"), key=lambda f: f.stat().st_mtime, reverse=True)
            seo_path = candidates[0] if candidates else None
            md_path = None
        if not seo_path or not seo_path.exists():
            raise HTTPException(status_code=404, detail="SEO report not found")
        seo = _json.loads(seo_path.read_text(encoding="utf-8"))
        word_count = seo.get("word_count", "—")
        read_time = seo.get("estimated_read_time", "—")
        tags = ", ".join(seo.get("tags", [])) or "—"
        secondary = ", ".join(seo.get("secondary_keywords", [])) if isinstance(seo.get("secondary_keywords"), list) else str(seo.get("secondary_keywords", "—"))
        internal_links = seo.get("internal_links", [])
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SEO Report — {seo.get('title','')}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #111; background: #fff; padding: 40px; max-width: 860px; margin: 0 auto; }}
  h1 {{ font-size: 22px; font-weight: 700; margin-bottom: 4px; }}
  .subtitle {{ font-size: 13px; color: #555; margin-bottom: 32px; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }}
  .card {{ border: 1px solid #ddd; border-radius: 8px; padding: 16px; }}
  .card h2 {{ font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #888; margin-bottom: 10px; }}
  .field {{ margin-bottom: 10px; }}
  .label {{ font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: .05em; }}
  .value {{ font-size: 13px; color: #111; margin-top: 3px; word-break: break-word; }}
  .badge {{ display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background: #e8f5e9; color: #1b5e20; margin: 2px; }}
  .links {{ list-style: none; }}
  .links li {{ padding: 5px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; }}
  .links li:last-child {{ border-bottom: none; }}
  .stat {{ text-align: center; }}
  .stat .num {{ font-size: 28px; font-weight: 700; color: #1a73e8; }}
  .stat .lbl {{ font-size: 11px; color: #888; margin-top: 4px; }}
  @media print {{ body {{ padding: 20px; }} button {{ display: none; }} }}
</style>
</head>
<body>
<button onclick="window.print()" style="float:right;padding:8px 18px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:16px;">Print / Save PDF</button>
<h1>{seo.get('title','Untitled')}</h1>
<div class="subtitle">SEO Report &nbsp;·&nbsp; Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}</div>

<div class="grid" style="grid-template-columns: repeat(4, 1fr);">
  <div class="card stat"><div class="num">{word_count}</div><div class="lbl">Words</div></div>
  <div class="card stat"><div class="num">{read_time}</div><div class="lbl">Read Time</div></div>
  <div class="card stat"><div class="num">{len(internal_links)}</div><div class="lbl">Internal Links</div></div>
  <div class="card stat"><div class="num">{len(seo.get('tags', []))}</div><div class="lbl">Tags</div></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Content</h2>
    <div class="field"><div class="label">Slug</div><div class="value">/{seo.get('slug','')}</div></div>
    <div class="field"><div class="label">Category</div><div class="value">{seo.get('category','—')}</div></div>
    <div class="field"><div class="label">Schema Type</div><div class="value">{seo.get('schema_type','Article')}</div></div>
    <div class="field"><div class="label">Excerpt</div><div class="value">{seo.get('excerpt','—')}</div></div>
  </div>
  <div class="card">
    <h2>Keywords</h2>
    <div class="field"><div class="label">Focus Keyword</div><div class="value"><strong>{seo.get('focus_keyword','—')}</strong></div></div>
    <div class="field"><div class="label">Secondary Keywords</div><div class="value">{secondary}</div></div>
    <div class="field"><div class="label">Tags</div><div class="value">{' '.join(f'<span class="badge">{t}</span>' for t in seo.get('tags',[]))}</div></div>
  </div>
</div>

<div class="card" style="margin-bottom:20px;">
  <h2>Meta Description</h2>
  <div class="value" style="font-size:14px; line-height:1.6;">{seo.get('meta_description','—')}</div>
  <div style="margin-top:8px; font-size:11px; color:#888;">Length: {len(seo.get('meta_description',''))} chars (ideal: 150–160)</div>
</div>

{'<div class="card"><h2>Internal Link Placeholders (' + str(len(internal_links)) + ')</h2><ul class="links">' + ''.join(f"<li>→ {lnk}</li>" for lnk in internal_links) + '</ul></div>' if internal_links else ''}
</body>
</html>"""
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html)

    @app.get("/api/comment-replies")
    async def get_comment_replies(limit: int = 100):
        """Return the auto-reply log."""
        dist = oc.agents.get("distribution_agent") if oc else None
        if dist is None:
            return {"ok": True, "replies": []}
        return {"ok": True, "replies": dist.get_reply_log(limit=limit)}

    @app.post("/api/comment-replies/run")
    async def trigger_comment_reply_cycle():
        """Manually trigger one comment reply cycle."""
        dist = oc.agents.get("distribution_agent") if oc else None
        if dist is None:
            return {"ok": False, "error": "distribution_agent not running"}
        result = await dist.run_comment_reply_cycle()
        return {"ok": True, "result": result}

    @app.api_route("/saas", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    @app.api_route("/saas/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def proxy_saas(request: Request, full_path: str = ""):
        if not saas_base_url:
            raise HTTPException(status_code=503, detail="SaaS API URL is not configured")

        query = f"?{request.url.query}" if request.url.query else ""
        path_suffix = f"/{full_path}" if full_path else ""
        target_url = f"{saas_base_url}{path_suffix}{query}"
        body = await request.body()
        forward_headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() not in {"host", "content-length", "connection"}
        }

        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
                upstream = await client.request(
                    request.method,
                    target_url,
                    headers=forward_headers,
                    content=body or None,
                )
        except httpx.HTTPError as exc:
            logger.error(f"[SaaS Proxy] FAILED {request.method} {target_url} — {type(exc).__name__}: {exc}")
            raise HTTPException(status_code=502, detail=f"Could not reach SaaS API: {type(exc).__name__}: {exc}") from exc

        response_headers = {
            key: value
            for key, value in upstream.headers.items()
            if key.lower() not in {"content-length", "connection", "transfer-encoding", "content-encoding"}
        }
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=upstream.headers.get("content-type"),
        )

    # ── React SPA catch-all (must be last) ────────────────────────────────────
    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def serve_react(full_path: str):
        index_html = static_dir / "index.html"
        if index_html.exists():
            return HTMLResponse(content=index_html.read_text(encoding="utf-8"))
        return HTMLResponse(content=_fallback_html())

    return app


def _get_dist():
    dist = _openclaw._agents.get("distribution_agent")
    if not dist:
        raise HTTPException(404, "Distribution agent not registered")
    return dist


def _outputs_preview_url(path_value: str | None) -> str:
    raw = str(path_value or "").strip()
    if not raw:
        return ""
    normalized = raw.replace("\\", "/")
    lower = normalized.lower()
    marker = "/outputs/"
    index = lower.rfind(marker)
    if index >= 0:
        return "/" + "/".join(part for part in normalized[index + 1:].split("/") if part)
    if lower.startswith("outputs/"):
        return "/" + "/".join(part for part in normalized.split("/") if part)
    return ""


def _resolve_social_image(title: str, platform: str, row_id: int) -> str:
    """
    Fallback image resolver for social posts that have no image_path in payload.
    1. Try outputs/social/{slug}_{platform}.png (exact match)
    2. Try any outputs/social/{slug}_*.png (any platform crop of same topic)
    3. Pick a stable image from outputs/images/ based on row_id % total
    """
    outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")).resolve()
    social_dir = outputs_dir / "social"
    images_dir = outputs_dir / "images"

    if title:
        try:
            from python_slugify import slugify as _slugify
            slug = _slugify(title)
        except Exception:
            import re as _re
            slug = _re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")

        if slug and social_dir.exists():
            # Exact platform match
            candidate = social_dir / f"{slug}_{platform}.png"
            if candidate.exists():
                return f"/outputs/social/{slug}_{platform}.png"
            # Any platform crop of same topic
            for f in social_dir.glob(f"{slug}_*.png"):
                return f"/outputs/social/{f.name}"

    # Fallback: pick a deterministic image from outputs/images/
    if images_dir.exists():
        imgs = sorted(
            [f for f in images_dir.iterdir()
             if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}],
            key=lambda f: f.name,
        )
        if imgs:
            pick = imgs[row_id % len(imgs)]
            return f"/outputs/images/{pick.name}"

    return ""


def _normalize_google_sheet_url(sheet_url: str) -> str:
    url = str(sheet_url or "").strip()
    if not url:
        return ""
    if "/export?" in url and "format=csv" in url:
        return url
    if "/gviz/tq?" in url:
        if "tqx=out:csv" in url:
            return url
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}tqx=out:csv"
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    if not match:
        return url
    sheet_id = match.group(1)
    gid_match = re.search(r"[?&]gid=([0-9]+)", url)
    gid = gid_match.group(1) if gid_match else "0"
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"


def _row_value(row: dict[str, str], *keys: str) -> str:
    lowered = {str(k).strip().lower(): str(v).strip() for k, v in row.items()}
    for key in keys:
        value = lowered.get(key.lower(), "")
        if value:
            return value
    return ""


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _normalize_platform(value: str) -> str:
    raw = _normalize_text(value)
    mapping = {
        "twitter": "x",
        "x/twitter": "x",
        "fb": "facebook",
        "facebook page": "facebook",
        "facebook group": "facebook_groups",
        "facebook groups": "facebook_groups",
        "instagram post": "instagram_posts",
        "instagram posts": "instagram_posts",
    }
    return mapping.get(raw, raw)


def _social_publish_blocker(platform: str) -> str:
    enabled = as_bool(get_setting(platform, "enabled", "false"))
    post_url = str(get_setting(platform, "post_url", "") or "").strip()
    access_token = str(get_setting(platform, "access_token", "") or "").strip()
    if not enabled:
        return f"Cannot post to {platform}: enable this platform in Settings."
    if not post_url:
        return f"Cannot post to {platform}: add the platform post URL in Settings."
    if not access_token or "****" in access_token:
        return f"Cannot post to {platform}: add your API key or access token in Settings."
    return ""


def _video_publish_blocker(platform: str) -> str:
    enabled = as_bool(get_setting(platform, "enabled", "false"))
    upload_url = str(get_setting(platform, "upload_url", "") or "").strip()
    access_token = str(get_setting(platform, "access_token", "") or "").strip()
    if not enabled:
        return f"Cannot publish to {platform}: enable this platform in Settings."
    if not upload_url:
        return f"Cannot publish to {platform}: add the upload URL in Settings."
    if not access_token or "****" in access_token:
        return f"Cannot publish to {platform}: add your API key or access token in Settings."
    return ""


def _fallback_html() -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Autonomous Prime</title>
<style>
  body{background:#0d1117;color:#c9d1d9;font-family:system-ui;display:flex;
       align-items:center;justify-content:center;height:100vh;margin:0;
       flex-direction:column;gap:16px;text-align:center}
  h1{color:#58a6ff;font-size:1.5rem}
  code{background:#161b22;padding:8px 16px;border-radius:6px;
       border:1px solid #30363d;font-size:13px}
  p{color:#8b949e;font-size:14px}
  a{color:#58a6ff}
</style></head>
<body>
<h1>Autonomous Prime</h1>
<p>API running. Build the React UI:</p>
<code>cd ui &amp;&amp; npm run build</code>
<p>Or dev mode: <code>cd ui &amp;&amp; npm run dev</code>
   then open <a href="http://localhost:5173">localhost:5173</a></p>
</body></html>"""
