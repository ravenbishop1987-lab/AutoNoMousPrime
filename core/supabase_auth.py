from __future__ import annotations

import os
from typing import Any

import httpx


def supabase_url() -> str:
    return str(os.getenv("SUPABASE_URL", "") or "").rstrip("/")


def supabase_anon_key() -> str:
    return str(os.getenv("SUPABASE_ANON_KEY", "") or "")


def is_configured() -> bool:
    import os
    if os.getenv("DISABLE_AUTH", "").strip().lower() in ("1", "true", "yes"):
        return False
    url = supabase_url()
    key = supabase_anon_key()
    if not url or not key:
        return False
    # Reject placeholder values from .env.example
    if "your-project" in url or len(key) < 32:
        return False
    return True


async def get_user_from_token(access_token: str) -> dict[str, Any] | None:
    token = str(access_token or "").strip()
    if not token or not is_configured():
        return None

    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {token}",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{supabase_url()}/auth/v1/user", headers=headers)
            if response.status_code != 200:
                return None
            payload = response.json()
    except Exception:
        return None

    if not isinstance(payload, dict) or not payload.get("id"):
        return None
    return payload
