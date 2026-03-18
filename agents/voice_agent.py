"""
Voice Agent — Text-to-speech via ElevenLabs
Converts blog post content to narrated audio
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import unicodedata
import wave
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

import httpx
from loguru import logger

from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import get_setting

_SAAS_API_URL = os.getenv("SAAS_API_URL", "http://localhost:3001")
_INTERNAL_TOKEN = os.getenv("INTERNAL_API_TOKEN", "autonomous-prime-internal")

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent


class _NonRetryableError(Exception):
    """Raised for errors that should not be retried (payment, auth, config)."""


class VoiceAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("voice_agent", llm, max_concurrent=2)
        self._audio_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "audio"
        self._audio_dir.mkdir(parents=True, exist_ok=True)
        self._ffmpeg = os.getenv("FFMPEG_BIN", os.getenv("FFMPEG_PATH", get_setting("ffmpeg", "path", "ffmpeg")))
        self._elevenlabs_url = os.getenv("ELEVENLABS_API_URL", get_setting("elevenlabs", "api_url", "https://api.elevenlabs.io"))
        self._elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", get_setting("elevenlabs", "api_key", ""))
        self._elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", get_setting("elevenlabs", "voice_id", ""))
        self._elevenlabs_model_id = os.getenv("ELEVENLABS_MODEL_ID", get_setting("elevenlabs", "model_id", "eleven_multilingual_v2"))
        self._elevenlabs_output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", get_setting("elevenlabs", "output_format", "mp3_44100_128"))

    def skill_summary(self) -> dict:
        configured = bool(self._elevenlabs_api_key and self._elevenlabs_voice_id)
        return {
            "name": "VoiceAgent",
            "capabilities": ["tts", "voice_clone"],
            "description": "Synthesizes speech from text using ElevenLabs",
            "backend": "elevenlabs",
            "configured": configured,
            "skills_loaded": len(self.skill_inventory()),
        }

    def refresh_settings(self) -> None:
        self._ffmpeg = os.getenv("FFMPEG_BIN", os.getenv("FFMPEG_PATH", get_setting("ffmpeg", "path", self._ffmpeg)))
        self._elevenlabs_url = os.getenv("ELEVENLABS_API_URL", get_setting("elevenlabs", "api_url", self._elevenlabs_url))
        self._elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", get_setting("elevenlabs", "api_key", self._elevenlabs_api_key))
        self._elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", get_setting("elevenlabs", "voice_id", self._elevenlabs_voice_id))
        self._elevenlabs_model_id = os.getenv("ELEVENLABS_MODEL_ID", get_setting("elevenlabs", "model_id", self._elevenlabs_model_id))
        self._elevenlabs_output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", get_setting("elevenlabs", "output_format", self._elevenlabs_output_format))

    async def _execute(self, task: "Task") -> dict[str, Any]:
        voice_mode = str(get_setting("tool_routing", "voice_mode", "elevenlabs")).strip().lower()

        org_id = task.payload.get("org_id", "")
        if org_id:
            credit_info = await self._check_tts_credits(org_id)
            if not credit_info.get("allowed", True):
                reason = credit_info.get("reason", "unknown")
                if reason == "plan_not_included":
                    raise _NonRetryableError(
                        "TTS skipped — your plan does not include voice generation. "
                        "Upgrade your plan or add your ElevenLabs API key in Settings → ElevenLabs."
                    )
                raise _NonRetryableError(
                    f"TTS skipped — system voice credits exhausted "
                    f"({credit_info.get('minutes_used', 0)}/{credit_info.get('minutes_limit', 0)} min used). "
                    "Add your ElevenLabs API key in Settings → ElevenLabs to continue."
                )

        topic = task.payload.get("topic", "content")
        text = task.payload.get("text", "")

        blog_filepath = task.payload.get("blog_filepath", "")
        logger.debug(f"[VoiceAgent] payload keys: {list(task.payload.keys())}")
        logger.debug(f"[VoiceAgent] blog_filepath={blog_filepath!r} exists={Path(blog_filepath).exists() if blog_filepath else False}")

        if not text:
            text = await self._get_narration_text(task)

        clean = self._clean_for_tts(text)
        if not clean.strip():
            raise RuntimeError(f"TTS skipped — no speakable text found for topic: {topic}")
        logger.info(f"[VoiceAgent] Synthesizing {len(clean)} chars for: {topic} via {voice_mode}")

        if voice_mode == "edge-tts":
            filepath = await self._edge_tts(clean, topic)
            provider = "edge-tts"
            chunk_count = 1
        else:
            if not self._elevenlabs_api_key:
                raise RuntimeError("ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in .env or Settings → ElevenLabs.")
            if not self._elevenlabs_voice_id:
                raise RuntimeError("ElevenLabs Voice ID not configured. Set ELEVENLABS_VOICE_ID in .env or Settings → ElevenLabs.")
            chunks = self._chunk_tts_text(clean)
            filepath = await self._elevenlabs_tts(chunks, topic)
            provider = "elevenlabs"
            chunk_count = len(chunks)

        duration_s = len(clean) / 15

        if org_id:
            asyncio.create_task(self._record_tts_asset(task, filepath, duration_s, provider))

        return {
            "type": "audio",
            "topic": topic,
            "filepath": str(filepath),
            "char_count": len(clean),
            "chunk_count": chunk_count,
            "duration_estimate_s": duration_s,
            "aspect_ratio": task.payload.get("aspect_ratio", "16:9"),
            "provider": provider,
        }

    async def _check_tts_credits(self, org_id: str) -> dict:
        """Check if org has system TTS credits remaining. Fails open on error."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{_SAAS_API_URL}/saas/internal/orgs/{org_id}/tts-check",
                    headers={"x-internal-token": _INTERNAL_TOKEN},
                )
                if resp.status_code == 200:
                    return resp.json()
        except Exception as exc:
            logger.warning(f"[VoiceAgent] Credit check failed (fail-open): {exc}")
        return {"allowed": True}

    async def _record_tts_asset(self, task: "Task", filepath: Path, duration_s: float, provider: str = "elevenlabs") -> None:
        """Record synthesized audio as an asset for usage tracking."""
        org_id = task.payload.get("org_id", "")
        job_id = task.payload.get("job_id", "")
        if not org_id or not job_id:
            return
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{_SAAS_API_URL}/saas/internal/assets/upsert",
                    headers={"x-internal-token": _INTERNAL_TOKEN},
                    json={
                        "org_id": org_id,
                        "job_id": job_id,
                        "job_run_id": task.payload.get("job_run_id"),
                        "brand_id": task.payload.get("brand_id"),
                        "type": "audio",
                        "provider": provider,
                        "local_path": str(filepath),
                        "metadata": {"duration_seconds": round(duration_s), "source": "tts"},
                    },
                )
        except Exception as exc:
            logger.warning(f"[VoiceAgent] Failed to record TTS asset: {exc}")

    # ------------------------------------------------------------------
    # Edge TTS (Microsoft neural voices, free)
    # ------------------------------------------------------------------

    async def _edge_tts(self, text: str, topic: str) -> Path:
        """Generate audio using Microsoft Edge TTS (free, no API key)."""
        import edge_tts  # type: ignore[import]
        filename = f"audio_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.mp3"
        filepath = self._audio_dir / filename
        voice = str(get_setting("edge_tts", "voice", "en-US-AriaNeural") or "en-US-AriaNeural")
        speed = get_setting("edge_tts", "speed", "1.0") or "1.0"
        rate = f"+{int((float(speed) - 1.0) * 100)}%" if float(speed) != 1.0 else "+0%"
        communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
        await communicate.save(str(filepath))
        logger.success(f"[VoiceAgent] Audio saved via Edge TTS: {filepath}")
        return filepath

    # ------------------------------------------------------------------

    async def _get_narration_text(self, task: "Task") -> str:
        """Return full blog text for narration, or generate a short intro if none found."""
        topic = task.payload.get("topic", "")
        blog_path = task.payload.get("blog_filepath", "")

        # 1. Explicit path from payload
        if blog_path and Path(blog_path).exists():
            raw = Path(blog_path).read_text(encoding="utf-8")
            raw = re.sub(r"^---[\s\S]*?---\n?", "", raw, count=1).strip()
            if raw:
                return raw

        # 2. Find most recent blog file matching the topic slug
        blog_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "blog"
        if blog_dir.exists():
            slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:40]
            candidates = sorted(blog_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
            for f in candidates:
                if slug in f.name.lower() or any(w in f.name.lower() for w in slug.split("-")[:3] if len(w) > 3):
                    raw = f.read_text(encoding="utf-8")
                    raw = re.sub(r"^---[\s\S]*?---\n?", "", raw, count=1).strip()
                    if raw:
                        logger.info(f"[VoiceAgent] Audiobook using blog file: {f.name}")
                        return raw
        prompt_template = get_prompt_override(
            "voice_narration_prompt",
            """Write a 60-second spoken narration intro (about 150 words) for a blog post about: {topic}

Write in a warm, professional podcast style. No markdown, no special characters. Plain spoken text only.""",
        )
        prompt = prompt_template.format(topic=topic)
        skill_context = self.skill_context("tts")
        return await self.llm.complete(
            prompt,
            system=compose_system_prompt("You are writing narration for spoken audio delivery.", skill_context),
            max_tokens=300,
        )

    async def _elevenlabs_tts(self, chunks: list[str], topic: str) -> Path:
        filename = f"audio_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.mp3"
        filepath = self._audio_dir / filename
        if len(chunks) == 1:
            await self._request_elevenlabs_audio(chunks[0], filepath)
        else:
            part_paths: list[Path] = []
            for index, chunk in enumerate(chunks, 1):
                part_path = self._audio_dir / f"{filepath.stem}_part_{index:02d}.mp3"
                await self._request_elevenlabs_audio(chunk, part_path)
                part_paths.append(part_path)
            self._concat_mp3_files(part_paths, filepath)
        logger.success(f"[VoiceAgent] Audio saved via ElevenLabs: {filepath}")
        return filepath

    async def _request_elevenlabs_audio(self, text: str, output_path: Path) -> None:
        """Stream audio from ElevenLabs and write directly to output_path."""
        url = f"{self._elevenlabs_url.rstrip('/')}/v1/text-to-speech/{self._elevenlabs_voice_id}"
        headers = {
            "xi-api-key": self._elevenlabs_api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": self._elevenlabs_model_id,
        }
        async with httpx.AsyncClient(timeout=180) as client:
            async with client.stream(
                "POST", url,
                headers=headers,
                params={"output_format": self._elevenlabs_output_format},
                json=payload,
            ) as response:
                if response.status_code != 200:
                    # Drain body so we can read the error detail
                    await response.aread()
                    self._raise_elevenlabs_error(response)
                with output_path.open("wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)

    def _raise_elevenlabs_error(self, response: httpx.Response) -> None:
        """Raise a descriptive _NonRetryableError for known ElevenLabs error codes."""
        try:
            detail = response.json().get("detail", {})
            api_msg = detail.get("message") if isinstance(detail, dict) else str(detail)
        except Exception:
            api_msg = response.text[:300]

        status = response.status_code
        voice = self._elevenlabs_voice_id
        model = self._elevenlabs_model_id

        if status == 401:
            raise _NonRetryableError(
                f"ElevenLabs 401 Unauthorized — your API key is invalid or expired. "
                f"Check ELEVENLABS_API_KEY in .env or Settings → ElevenLabs. Detail: {api_msg}"
            )
        if status == 402:
            raise _NonRetryableError(
                f"ElevenLabs 402 Payment Required — your ElevenLabs account has run out of characters. "
                f"Upgrade your ElevenLabs plan or add more credits. Detail: {api_msg}"
            )
        if status == 403:
            raise _NonRetryableError(
                f"ElevenLabs 403 Forbidden — access denied for voice '{voice}'. "
                f"The voice may belong to another account or require a higher plan tier. Detail: {api_msg}"
            )
        if status == 422:
            raise _NonRetryableError(
                f"ElevenLabs 422 Unprocessable — request was rejected. "
                f"Check that voice_id='{voice}' and model_id='{model}' are valid. Detail: {api_msg}"
            )
        # All other errors are retryable
        raise httpx.HTTPStatusError(
            f"ElevenLabs {status}: {api_msg}",
            request=response.request,
            response=response,
        )

    def _concat_mp3_files(self, part_paths: list[Path], output_path: Path) -> None:
        """Concatenate MP3 parts using FFmpeg concat demuxer."""
        concat_list = output_path.with_name(f"{output_path.stem}_concat.txt")
        concat_list.write_text(
            "".join(f"file '{self._ffmpeg_concat_path(p)}'\n" for p in part_paths),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                self._ffmpeg, "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_list),
                "-c:a", "copy",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=240,
        )
        concat_list.unlink(missing_ok=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-500:] or "ffmpeg mp3 concat failed")

    def _chunk_tts_text(self, text: str, max_chars: int = 240, min_chars: int = 90) -> list[str]:
        text = " ".join(text.split())
        if len(text) <= max_chars:
            return [text]

        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks: list[str] = []
        current = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            candidate = f"{current} {sentence}".strip() if current else sentence
            if len(candidate) <= max_chars:
                current = candidate
                continue
            if current:
                chunks.append(current)
            while len(sentence) > max_chars:
                split_at = max(
                    sentence.rfind(", ", min_chars, max_chars),
                    sentence.rfind("; ", min_chars, max_chars),
                    sentence.rfind(": ", min_chars, max_chars),
                    sentence.rfind(" ", min_chars, max_chars),
                )
                if split_at <= 0:
                    split_at = max_chars
                chunk = sentence[:split_at].strip(" ,;:")
                if chunk:
                    chunks.append(chunk)
                sentence = sentence[split_at:].strip(" ,;:")
            current = sentence
        if current:
            chunks.append(current)
        merged: list[str] = []
        for chunk in chunks:
            if merged and len(merged[-1]) < min_chars and len(merged[-1]) + 1 + len(chunk) <= max_chars:
                merged[-1] = f"{merged[-1]} {chunk}".strip()
            else:
                merged.append(chunk)
        return merged or [text[:max_chars]]

    def _clean_for_tts(self, text: str) -> str:
        """Strip markdown, code blocks, URLs, etc."""
        text = unicodedata.normalize("NFKC", str(text or ""))
        text = re.sub(r"```[\s\S]*?```", "", text)
        text = re.sub(r"`[^`]+`", "", text)
        text = re.sub(r"#{1,6}\s*", "", text)
        text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
        text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
        text = re.sub(r"https?://\S+", "", text)
        text = re.sub(r"\b(?:www\.)\S+\b", "", text)
        text = re.sub(r"\b\S+@\S+\.\S+\b", "", text)
        text = re.sub(r"---+", "", text)
        text = text.replace("&", " and ")
        text = text.replace("@", " at ")
        text = text.replace("%", " percent ")
        text = text.replace("+", " plus ")
        text = text.replace("=", " equals ")
        text = re.sub(r"\b([A-Z])\.([A-Z])\.([A-Z])\.\b", r"\1 \2 \3", text)
        text = re.sub(r"\b([A-Z])\.([A-Z])\.\b", r"\1 \2", text)
        text = re.sub(r"\s*/\s*", ", ", text)
        text = re.sub(r"\s+[|]+\s+", ", ", text)
        text = re.sub(r"([a-z0-9])[:;]([A-Z])", r"\1. \2", text)
        text = re.sub(r"([a-z0-9])\s*-\s*([a-zA-Z0-9])", r"\1, \2", text)
        text = re.sub(r"\(([^)]{1,40})\)", r", \1,", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"([.!?])([A-Z])", r"\1 \2", text)
        text = re.sub(r"\b[A-Z0-9_-]{20,}\b", "", text)
        text = re.sub(r"[^\w\s.,!?':;\-]", " ", text, flags=re.UNICODE)
        text = re.sub(r"\b([A-Z]{3,})\b", lambda m: " ".join(m.group(1).lower()), text)
        text = re.sub(r"\b(\d{4,})\b", "", text)
        text = re.sub(r"\s{2,}", " ", text)
        text = text.strip()
        words = text.split()
        if len(words) > 600:
            text = " ".join(words[:600]) + "..."
        return text

    @staticmethod
    def _ffmpeg_concat_path(path: Path) -> str:
        return str(path.resolve()).replace("\\", "/").replace("'", r"'\''")
