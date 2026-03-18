from __future__ import annotations

import os
from typing import Any

import httpx

from .runtime_settings import get_setting


def _normalize_service_url(value: str, default: str) -> str:
    raw = str(value or default).strip().rstrip("/")
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


class CommerceClient:
    def __init__(self) -> None:
        self._base_url = _normalize_service_url(
            os.getenv("COMMERCE_API_URL", get_setting("commerce", "api_url", "http://localhost:3010")),
            "http://localhost:3010",
        )

    async def _request(self, method: str, path: str, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self._base_url:
            return {"ok": False, "error": "Commerce API URL is not configured"}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.request(method, f"{self._base_url}{path}", json=json_body)
                response.raise_for_status()
                return response.json() if response.content else {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def _raw_request(self, method: str, path: str, json_body: dict[str, Any] | None = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20) as client:
            return await client.request(method, f"{self._base_url}{path}", json=json_body)

    async def preview_cta(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/ctas/preview", payload)

    async def create_checkout_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/stripe/checkout-session", payload)

    async def revenue_summary(self) -> dict[str, Any]:
        return await self._request("GET", "/api/revenue/summary")

    async def track_click(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/track/click", payload)

    async def list_offers(self) -> dict[str, Any]:
        return await self._request("GET", "/api/catalog/offers")

    async def create_offer(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/catalog/offers", payload)

    async def list_landing_pages(self) -> dict[str, Any]:
        return await self._request("GET", "/api/catalog/landing-pages")

    async def create_landing_page(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/catalog/landing-pages", payload)

    async def update_landing_page(self, landing_page_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/api/catalog/landing-pages/{landing_page_id}", payload)

    async def get_public_landing_page(self, slug: str) -> dict[str, Any]:
        if not self._base_url:
            return {"ok": False, "error": "Commerce API URL is not configured"}
        try:
            response = await self._raw_request("GET", f"/api/public/landing/{slug}")
            if response.status_code == 200:
                return response.json()
            if response.status_code != 404:
                response.raise_for_status()
        except Exception as exc:
            fallback_error = str(exc)
        else:
            fallback_error = ""

        fallback = await self._request("GET", "/api/catalog/landing-pages")
        items = fallback.get("items") if isinstance(fallback, dict) else None
        if isinstance(items, list):
            for item in items:
                if str(item.get("slug", "")).strip() == slug:
                    normalized = {
                        "id": str(item.get("id", "")).strip(),
                        "name": str(item.get("name", "")).strip(),
                        "slug": str(item.get("slug", "")).strip(),
                        "url": str(item.get("url", "")).strip(),
                        "template": str(item.get("template", "offer") or "offer").strip(),
                        "hero_title": str(item.get("hero_title", "")).strip(),
                        "hero_subtitle": str(item.get("hero_subtitle", "")).strip(),
                        "cta_text": str(item.get("cta_text", "")).strip(),
                        "cta_link": str(item.get("cta_link", "")).strip(),
                        "offer_summary": str(item.get("offer_summary", "")).strip(),
                        "benefits": item.get("benefits_json") if isinstance(item.get("benefits_json"), list) else [],
                        "includes": item.get("includes_json") if isinstance(item.get("includes_json"), list) else [],
                        "faq_items": item.get("faq_json") if isinstance(item.get("faq_json"), list) else [],
                        "proof_points": item.get("proof_json") if isinstance(item.get("proof_json"), list) else [],
                        "theme": item.get("theme_json") if isinstance(item.get("theme_json"), dict) else {},
                        "offer": {
                            "id": "",
                            "name": "",
                            "stripe_price_id": "",
                            "stripe_product_id": "",
                        },
                    }
                    return {"ok": True, "item": normalized, "fallback": "catalog"}
        error = fallback.get("error") if isinstance(fallback, dict) else ""
        return {"ok": False, "error": error or fallback_error or f"Landing page '{slug}' was not found"}

    async def create_public_landing_checkout(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", f"/api/public/landing/{slug}/checkout", payload)
