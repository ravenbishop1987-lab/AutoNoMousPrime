"""
core/storage.py — Supabase Storage upload helper.

Agents call `upload_file(bucket, local_path)` after writing to disk.
Returns the public URL on success, None if Supabase is not configured or upload fails.
"""
import os
import mimetypes
from pathlib import Path

import httpx
from loguru import logger

_SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _enabled() -> bool:
    return bool(
        _SUPABASE_URL
        and _SERVICE_KEY
        and "placeholder" not in _SUPABASE_URL
    )


def public_url(bucket: str, remote_name: str) -> str:
    return f"{_SUPABASE_URL}/storage/v1/object/public/{bucket}/{remote_name}"


async def upload_file(bucket: str, local_path: Path, remote_name: str | None = None) -> str | None:
    """
    Upload local_path to Supabase Storage bucket.
    Returns the public URL on success, None on failure or when not configured.
    """
    if not _enabled():
        return None

    if not local_path.exists():
        logger.warning(f"[Storage] File not found, skipping upload: {local_path}")
        return None

    remote_name = remote_name or local_path.name
    mime_type, _ = mimetypes.guess_type(str(local_path))
    mime_type = mime_type or "application/octet-stream"

    upload_url = f"{_SUPABASE_URL}/storage/v1/object/{bucket}/{remote_name}"
    headers = {
        "Authorization": f"Bearer {_SERVICE_KEY}",
        "apikey": _SERVICE_KEY,
        "Content-Type": mime_type,
    }

    try:
        data = local_path.read_bytes()
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(upload_url, content=data, headers=headers)

        if r.status_code in (200, 201):
            url = public_url(bucket, remote_name)
            logger.info(f"[Storage] ✓ {bucket}/{remote_name}")
            return url

        # 409 = already exists — upsert via PUT
        if r.status_code == 409:
            async with httpx.AsyncClient(timeout=120) as client:
                r = await client.put(upload_url, content=data, headers=headers)
            if r.status_code in (200, 201):
                url = public_url(bucket, remote_name)
                logger.info(f"[Storage] ✓ (upsert) {bucket}/{remote_name}")
                return url

        logger.warning(f"[Storage] Upload failed {r.status_code} for {bucket}/{remote_name}: {r.text[:200]}")
        return None

    except Exception as exc:
        logger.warning(f"[Storage] Upload error for {bucket}/{remote_name}: {exc}")
        return None
