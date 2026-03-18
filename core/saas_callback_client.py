from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


def _normalize_service_url(value: str, default: str) -> str:
    raw = str(value or default).strip().rstrip("/")
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"http://{raw}"
    return raw


class SaaSCallbackClient:
    def __init__(self) -> None:
        self.base_url = _normalize_service_url(
            os.getenv("SAAS_API_URL", "http://localhost:3001/saas"),
            "http://localhost:3001/saas",
        )
        self.token = str(os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal"))

    def configured(self) -> bool:
        return bool(self.base_url and self.token)

    async def _post(self, path: str, payload: dict[str, Any]) -> None:
        if not self.configured():
            return
        url = f"{self.base_url}{path}"
        try:
          async with httpx.AsyncClient(timeout=8) as client:
              response = await client.post(url, json=payload, headers={"x-internal-token": self.token})
              response.raise_for_status()
        except Exception as exc:
            logger.warning(f"[SaaSCallback] Failed POST {url}: {exc}")

    async def update_run_status(self, job_id: str, run_id: str, payload: dict[str, Any]) -> None:
        await self._post(f"/internal/jobs/{job_id}/runs/{run_id}/status", payload)

    async def update_step(self, job_id: str, run_id: str, payload: dict[str, Any]) -> None:
        await self._post(f"/internal/jobs/{job_id}/runs/{run_id}/steps", payload)

    async def create_asset(self, job_id: str, run_id: str, payload: dict[str, Any]) -> None:
        await self._post(f"/internal/jobs/{job_id}/runs/{run_id}/assets", payload)

    async def upsert_asset(self, payload: dict[str, Any]) -> None:
        await self._post("/internal/assets/upsert", payload)

    async def update_queue_state(self, job_id: str, payload: dict[str, Any]) -> None:
        await self._post(f"/internal/jobs/{job_id}/queue-state", payload)

    async def publish_result(self, job_id: str, payload: dict[str, Any]) -> None:
        await self._post(f"/internal/jobs/{job_id}/publish-result", payload)


def _asset_type_from_path(path_value: str) -> str | None:
    suffix = Path(str(path_value or "")).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return "image"
    if suffix in {".wav", ".mp3", ".m4a"}:
        return "audio"
    if suffix in {".mp4", ".mov"}:
        return "video"
    return None


def _asset_metadata(path_value: str, source_key: str, result_payload: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(path_value or ""))
    metadata: dict[str, Any] = {
        "source_key": source_key,
    }
    if path.exists():
        try:
            stat = path.stat()
            metadata["byte_size"] = stat.st_size
            metadata["file_ext"] = path.suffix.lower()
            metadata["filename"] = path.name
        except Exception:
            pass
    for key in ("aspect_ratio", "title", "topic"):
        value = result_payload.get(key)
        if value not in (None, ""):
            metadata[key] = value
    return metadata


def install_saas_callbacks(bus) -> SaaSCallbackClient:
    client = SaaSCallbackClient()

    async def handler(event) -> None:
        data = event.data or {}
        job_id = str(data.get("job_id") or "").strip()
        run_id = str(data.get("job_run_id") or "").strip()
        if not job_id:
            return

        stage_name = str(data.get("stage_name") or "").strip()
        agent = str(data.get("agent") or "").strip() or str(data.get("type") or "").strip()
        payload = data.get("result") if isinstance(data.get("result"), dict) else {}

        if event.type == "task.started":
            if run_id:
                await client.update_run_status(job_id, run_id, {
                    "status": "running",
                    "message": f"Task started: {stage_name or data.get('type', 'unknown')}",
                    "python_pipeline_id": data.get("pipeline_id"),
                })
            if stage_name and run_id:
                await client.update_step(job_id, run_id, {
                    "step_key": stage_name,
                    "provider": agent,
                    "status": "running",
                    "input_payload": {},
                })
            return

        if event.type == "task.blocked":
            await client.update_queue_state(job_id, {
                "job_run_id": run_id,
                "queue_state": "blocked",
                "blocked_reasons": data.get("blocked_reasons") or [],
                "next_action": data.get("next_action") or "Wait for dependency",
                "latest_run_status": "running",
                "review_status": None,
            })
            if stage_name and run_id:
                await client.update_step(job_id, run_id, {
                    "step_key": stage_name,
                    "provider": agent,
                    "status": "running",
                    "output_payload": {
                        "blocked_on": data.get("blocked_on"),
                        "blocked_reasons": data.get("blocked_reasons") or [],
                        "next_action": data.get("next_action"),
                    },
                })
            return

        if event.type == "task.completed":
            if stage_name:
                await client.update_step(job_id, run_id, {
                    "step_key": stage_name,
                    "provider": agent,
                    "status": "completed",
                    "output_payload": payload,
                })

            for key in ("filepath", "image_filepath", "audio_filepath", "video_filepath", "full_audio_path"):
                path_value = payload.get(key)
                asset_type = _asset_type_from_path(str(path_value or ""))
                if asset_type:
                    if run_id:
                        await client.create_asset(job_id, run_id, {
                            "type": asset_type,
                            "provider": agent,
                            "local_path": path_value,
                            "metadata": _asset_metadata(str(path_value), key, payload),
                        })
                    else:
                        await client.upsert_asset({
                            "org_id": data.get("workspace_id"),
                            "job_id": job_id,
                            "brand_id": data.get("brand_id"),
                            "type": asset_type,
                            "provider": agent,
                            "local_path": path_value,
                            "metadata": _asset_metadata(str(path_value), key, payload),
                        })

            if stage_name in {"publish", "manual_publish"}:
                platforms = payload.get("platforms") if isinstance(payload.get("platforms"), dict) else {}
                wordpress = payload.get("wordpress") if isinstance(payload.get("wordpress"), dict) else {}
                awaiting = any(str(item.get("status")) == "pending_approval" for item in platforms.values())
                blocked = all(str(item.get("status")) == "skipped" for item in platforms.values()) if platforms else False
                if awaiting:
                    await client.update_queue_state(job_id, {
                        "job_run_id": run_id,
                        "queue_state": "awaiting_approval",
                        "blocked_reasons": ["approval_required"],
                        "next_action": "Approve publish",
                        "latest_run_status": "completed",
                        "review_status": "pending",
                    })
                elif blocked:
                    await client.update_queue_state(job_id, {
                        "job_run_id": run_id,
                        "queue_state": "blocked",
                        "blocked_reasons": ["provider_unconfigured"],
                        "next_action": "Fix publishing configuration",
                        "latest_run_status": "completed",
                        "review_status": None,
                    })
                else:
                    await client.update_queue_state(job_id, {
                        "job_run_id": run_id,
                        "queue_state": "completed",
                        "blocked_reasons": [],
                        "next_action": "Published",
                        "latest_run_status": "completed",
                        "review_status": "approved",
                    })
                await client.publish_result(job_id, {
                    "platforms": platforms,
                    "wordpress": wordpress,
                })

            if stage_name == "publish" and run_id:
                await client.update_run_status(job_id, run_id, {
                    "status": "completed",
                    "message": "Pipeline completed",
                    "python_pipeline_id": data.get("pipeline_id"),
                })
            return

        if event.type == "task.failed":
            step_status = "failed" if not data.get("requeued") else "running"
            if stage_name and run_id:
                await client.update_step(job_id, run_id, {
                    "step_key": stage_name,
                    "provider": agent,
                    "status": step_status,
                    "error_message": data.get("error"),
                })
            await client.update_run_status(job_id, run_id, {
                "status": "retrying" if data.get("requeued") else "failed",
                "message": data.get("error") or "Task failed",
                "python_pipeline_id": data.get("pipeline_id"),
                "error_message": data.get("error"),
            })
            await client.update_queue_state(job_id, {
                "job_run_id": run_id,
                "queue_state": "running" if data.get("requeued") else "failed",
                "blocked_reasons": [] if data.get("requeued") else ["run_failed"],
                "next_action": "Wait for retry" if data.get("requeued") else "Retry failed run",
                "latest_run_status": "retrying" if data.get("requeued") else "failed",
                "review_status": None,
            })

    bus.subscribe("task.started", handler)
    bus.subscribe("task.blocked", handler)
    bus.subscribe("task.completed", handler)
    bus.subscribe("task.failed", handler)
    return client
