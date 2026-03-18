"""
Video Agent - FFmpeg-based slide video assembly with per-slide image and narration.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import tempfile
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING
from urllib.parse import urlencode

import httpx
from loguru import logger

from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent

SAFE_FOR_WORK_SLIDE_POSITIVE = (
    "safe-for-work, fully clothed, non-sexual, non-erotic, PG-rated, brand-safe editorial image"
)
SAFE_FOR_WORK_SLIDE_NEGATIVE = (
    "nsfw, nude, nudity, naked, erotic, sexual, explicit, fetish, porn, lingerie, underwear, bikini, swimsuit, "
    "cleavage focus, nipple, areola, thong, transparent clothing, cameltoe, butt focus, crotch focus, suggestive pose, "
    "bedroom eyes, boudoir, pinup, provocative framing"
)
NSFW_RISK_TERMS = (
    "nsfw", "nude", "nudity", "naked", "erotic", "sexual", "explicit", "fetish", "porn",
    "lingerie", "underwear", "bikini", "swimsuit", "cleavage", "nipple", "areola", "thong",
    "cameltoe", "seductive", "provocative", "boudoir", "pinup",
)


STORYBOARD_PROMPT = """You are a short-form video storyboard editor.
Turn the article into a concise slide deck for a narrated social video.

Rules:
- Return ONLY valid JSON.
- Create 4 to 7 slides.
- Each slide must have:
  title: short slide title
  caption: plain text caption text for metadata only; it is not rendered into the final video
  narration: 1 short spoken paragraph, under 55 words
  image_prompt: a Stable Diffusion prompt describing ONLY physical objects and environments related to the slide topic — NO people, NO humans, NO faces; example: "open notebook with colorful sticky notes beside a timer on a wooden desk, soft morning light, clean minimal background"
  pause_after_s: integer seconds, usually 1 or 2
- Keep the sequence coherent and progressive.
- The first slide should hook attention.
- The last slide should end with a CTA.

JSON shape:
{{
  "title": "overall video title",
  "slides": [
    {{
      "title": "Slide 1",
      "caption": "On-screen caption",
      "narration": "Spoken script",
      "image_prompt": "Prompt for image generation",
      "pause_after_s": 1
    }}
  ]
}}

Article markdown:
{markdown}
"""


def _default_speaker_wav_path() -> str:
    fallback = Path.home() / "voice.wav"
    return str(fallback) if fallback.exists() else ""


class _NonRetryableError(Exception):
    """Raised for errors that should not be retried (missing assets, config)."""


class VideoAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("video_agent", llm, max_concurrent=1)
        self._video_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "video"
        self._video_dir.mkdir(parents=True, exist_ok=True)
        self._ffmpeg = os.getenv("FFMPEG_BIN", get_setting("ffmpeg", "path", "ffmpeg"))
        self._ffprobe = os.getenv("FFPROBE_BIN", get_setting("ffmpeg", "ffprobe_path", "ffprobe"))
        self._comfyui_url = os.getenv("COMFYUI_URL", "http://localhost:8188")
        self._checkpoint_name = os.getenv("COMFYUI_CHECKPOINT", "sd_xl_base_1.0.safetensors")
        self._abacus_enabled = str(os.getenv("ABACUS_ENABLED", get_setting("abacus", "enabled", "false"))).lower() in {"true", "1", "yes"}
        self._abacus_api_url = os.getenv("ABACUS_API_URL", get_setting("abacus", "api_url", "https://apps.abacus.ai/v1"))
        self._abacus_api_key = os.getenv("ABACUS_API_KEY", get_setting("abacus", "api_key", ""))
        self._abacus_image_model = os.getenv("ABACUS_IMAGE_MODEL", get_setting("abacus", "image_model", "flux.1-schnell"))
        self._elevenlabs_url = os.getenv("ELEVENLABS_API_URL", get_setting("elevenlabs", "api_url", "https://api.elevenlabs.io"))
        self._elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", get_setting("elevenlabs", "api_key", ""))
        self._elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", get_setting("elevenlabs", "voice_id", ""))
        self._elevenlabs_model_id = os.getenv("ELEVENLABS_MODEL_ID", get_setting("elevenlabs", "model_id", "eleven_multilingual_v2"))
        self._elevenlabs_output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", get_setting("elevenlabs", "output_format", "mp3_44100_128"))
        # SpeechRecognition — primary caption engine (free, no API key needed)
        self._sr_enabled = str(os.getenv("SR_ENABLED", get_setting("speech_recognition", "enabled", "true"))).lower() in {"true", "1", "yes"}
        self._sr_chunk_seconds = int(os.getenv("SR_CHUNK_SECONDS", get_setting("speech_recognition", "chunk_seconds", "30")))
        self._sr_language = os.getenv("SR_LANGUAGE", get_setting("speech_recognition", "language", "en-US"))
        self._sr_burn_in = str(os.getenv("SR_BURN_IN", get_setting("speech_recognition", "burn_in", "false"))).lower() in {"true", "1", "yes"}
        # Whisper — local fallback (higher accuracy, slower)
        self._whisper_enabled = str(os.getenv("WHISPER_ENABLED", get_setting("whisper", "enabled", "false"))).lower() in {"true", "1", "yes"}
        self._whisper_model = os.getenv("WHISPER_MODEL", get_setting("whisper", "model", "base"))
        self._whisper_burn_in = str(os.getenv("WHISPER_BURN_IN", get_setting("whisper", "burn_in", "false"))).lower() in {"true", "1", "yes"}
        self._allow_demo_video = str(os.getenv("ALLOW_DEMO_VIDEO_FALLBACK", "false")).lower() in {"true", "1", "yes"}
        self._resolved_checkpoint: str | None = None

    def skill_summary(self) -> dict:
        return {
            "name": "VideoAgent",
            "capabilities": ["video_caption", "video_assemble", "subtitle_export"],
            "description": "Builds narrated slide videos with image generation, TTS, FFmpeg assembly, and optional subtitle export",
            "backend": "ffmpeg + comfyui + elevenlabs",
            "skills_loaded": len(self.skill_inventory()),
            "profile_dir": str(self._profile_dir),
        }

    def refresh_settings(self) -> None:
        self._ffmpeg = os.getenv("FFMPEG_BIN", os.getenv("FFMPEG_PATH", get_setting("ffmpeg", "path", self._ffmpeg)))
        self._ffprobe = os.getenv("FFPROBE_BIN", os.getenv("FFPROBE_PATH", get_setting("ffmpeg", "ffprobe_path", self._ffprobe)))
        self._comfyui_url = os.getenv("COMFYUI_URL", get_setting("comfyui", "url", self._comfyui_url))
        self._checkpoint_name = os.getenv("COMFYUI_CHECKPOINT", self._checkpoint_name)
        self._abacus_enabled = str(os.getenv("ABACUS_ENABLED", get_setting("abacus", "enabled", str(self._abacus_enabled).lower()))).lower() in {"true", "1", "yes"}
        self._abacus_api_url = os.getenv("ABACUS_API_URL", get_setting("abacus", "api_url", self._abacus_api_url))
        self._abacus_api_key = os.getenv("ABACUS_API_KEY", get_setting("abacus", "api_key", self._abacus_api_key))
        self._abacus_image_model = os.getenv("ABACUS_IMAGE_MODEL", get_setting("abacus", "image_model", self._abacus_image_model))
        self._elevenlabs_url = os.getenv("ELEVENLABS_API_URL", get_setting("elevenlabs", "api_url", self._elevenlabs_url))
        self._elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", get_setting("elevenlabs", "api_key", self._elevenlabs_api_key))
        self._elevenlabs_voice_id = os.getenv("ELEVENLABS_VOICE_ID", get_setting("elevenlabs", "voice_id", self._elevenlabs_voice_id))
        self._elevenlabs_model_id = os.getenv("ELEVENLABS_MODEL_ID", get_setting("elevenlabs", "model_id", self._elevenlabs_model_id))
        self._elevenlabs_output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", get_setting("elevenlabs", "output_format", self._elevenlabs_output_format))
        self._sr_enabled = str(os.getenv("SR_ENABLED", get_setting("speech_recognition", "enabled", str(self._sr_enabled).lower()))).lower() in {"true", "1", "yes"}
        self._sr_chunk_seconds = int(os.getenv("SR_CHUNK_SECONDS", get_setting("speech_recognition", "chunk_seconds", str(self._sr_chunk_seconds))))
        self._sr_language = os.getenv("SR_LANGUAGE", get_setting("speech_recognition", "language", self._sr_language))
        self._sr_burn_in = str(os.getenv("SR_BURN_IN", get_setting("speech_recognition", "burn_in", str(self._sr_burn_in).lower()))).lower() in {"true", "1", "yes"}
        self._whisper_enabled = str(os.getenv("WHISPER_ENABLED", get_setting("whisper", "enabled", str(self._whisper_enabled).lower()))).lower() in {"true", "1", "yes"}
        self._whisper_model = os.getenv("WHISPER_MODEL", get_setting("whisper", "model", self._whisper_model))
        self._whisper_burn_in = str(os.getenv("WHISPER_BURN_IN", get_setting("whisper", "burn_in", str(self._whisper_burn_in).lower()))).lower() in {"true", "1", "yes"}
        self._allow_demo_video = str(os.getenv("ALLOW_DEMO_VIDEO_FALLBACK", str(self._allow_demo_video).lower())).lower() in {"true", "1", "yes"}
        self._resolved_checkpoint = None

    async def _execute(self, task: "Task") -> dict[str, Any]:
        # Some callers may accidentally pass a raw list of slides as the payload.
        # Normalize into a dict so downstream code can safely use .get().
        payload: Any = task.payload
        if isinstance(payload, list):
            payload = {"slides": payload}
        elif not isinstance(payload, dict):
            payload = {}

        topic = payload.get("topic", "content")
        blog_path = payload.get("blog_filepath", "") or self._resolve_blog_path(payload, topic)
        slides = payload.get("slides")
        aspect_ratio = payload.get("aspect_ratio") or get_setting("video", "default_aspect_ratio", "16:9")
        project_dir: Path | None = None

        try:
            if slides:
                output_path, manifest_path, full_audio_path, project_dir, subtitle_artifacts = await self._assemble_slide_video(topic, slides, aspect_ratio)
                return {
                    "type": "video",
                    "topic": topic,
                    "filepath": str(output_path),
                    "storyboard_path": str(manifest_path),
                    "full_audio_path": str(full_audio_path),
                    "project_dir": str(project_dir),
                    "slide_count": len(slides),
                    "aspect_ratio": aspect_ratio,
                    **subtitle_artifacts,
                }

            if blog_path and Path(blog_path).exists():
                markdown = Path(blog_path).read_text(encoding="utf-8")
                ip = payload.get("input_payload") or {}
                target_minutes = int(
                    task.payload.get("video_length_minutes")
                    or ip.get("video_length_minutes")
                    or ip.get("target_duration_seconds", 0) // 60
                    or 3
                )
                storyboard = await self._build_storyboard(topic, markdown, aspect_ratio, target_minutes)
                output_path, manifest_path, full_audio_path, project_dir, subtitle_artifacts = await self._assemble_slide_video(topic, storyboard["slides"], aspect_ratio)
                return {
                    "type": "video",
                    "topic": topic,
                    "filepath": str(output_path),
                    "storyboard_path": str(manifest_path),
                    "full_audio_path": str(full_audio_path),
                    "project_dir": str(project_dir),
                    "slide_count": len(storyboard["slides"]),
                    "title": storyboard.get("title", topic),
                    "aspect_ratio": aspect_ratio,
                    **subtitle_artifacts,
                }

            image_path = (
                task.payload.get("image_path", "")
                or task.payload.get("image_filepath", "")
                or self._resolve_latest_media_path("images")
            )
            audio_path = (
                task.payload.get("audio_path", "")
                or task.payload.get("audio_filepath", "")
                or task.payload.get("full_audio_path", "")
                or self._resolve_latest_media_path("audio")
            )
            captions = task.payload.get("captions", "")
            if not image_path or not audio_path:
                if self._allow_demo_video:
                    return await self._demo_video(topic)
                raise _NonRetryableError("Missing image or audio assets for video assembly — retries skipped.")

            output_path, project_dir, subtitle_artifacts = await self._assemble_single(image_path, audio_path, topic, captions, aspect_ratio)
            return {
                "type": "video",
                "topic": topic,
                "filepath": str(output_path),
                "project_dir": str(project_dir),
                "image_source": image_path,
                "audio_source": audio_path,
                "aspect_ratio": aspect_ratio,
                **subtitle_artifacts,
            }
        finally:
            if project_dir is not None:
                self._cleanup_temp_files(project_dir)

    async def _build_storyboard(self, topic: str, markdown: str, aspect_ratio: str, target_minutes: int = 3) -> dict[str, Any]:
        # Calculate slide count and words per narration from target duration
        # Speaking rate ~130 words/min; leave 1s pause per slide
        words_needed = target_minutes * 130
        # Cap slide count between 4 and 30; aim for ~100 words per slide narration
        words_per_slide = 100
        num_slides = max(4, min(30, round(words_needed / words_per_slide)))
        clipped = markdown[:12000]
        skill_context = self.skill_context("video_caption")
        storyboard_prompt = get_prompt_override("video_storyboard_prompt", STORYBOARD_PROMPT)
        duration_instruction = (
            f"\nTarget video length: {target_minutes} minutes. "
            f"Create exactly {num_slides} slides. "
            f"Each narration must be approximately {words_per_slide} words (spoken aloud — enough to fill its time slot). "
            f"Do not write short narrations — the viewer needs enough content to fill {target_minutes} minutes total."
        )
        # ~350 tokens per slide (title + narration + image_prompt + caption) + 512 overhead
        storyboard_max_tokens = max(4096, num_slides * 350 + 512)
        storyboard = await self.llm.complete_json(
            f"{storyboard_prompt.format(markdown=clipped)}\nAspect ratio: {aspect_ratio}{duration_instruction}\n\n{skill_context}".strip(),
            system=compose_system_prompt("You are designing a structured video production plan and storyboard."),
            use_local=True,
            max_tokens=storyboard_max_tokens,
        )
        slides = storyboard.get("slides") or []
        if not slides:
            raise RuntimeError("Storyboard generation returned no slides")
        return storyboard

    async def _assemble_slide_video(self, topic: str, slides: list[dict[str, Any]], aspect_ratio: str) -> tuple[Path, Path, Path, Path, dict[str, Any]]:
        project_dir = self._create_project_dir(topic)
        manifest_path = project_dir / "storyboard.json"
        manifest_path.write_text(json.dumps({"topic": topic, "aspect_ratio": aspect_ratio, "slides": slides}, indent=2), encoding="utf-8")

        enriched: list[dict[str, Any]] = []
        for index, slide in enumerate(slides, 1):
            title = str(slide.get("title", f"Slide {index}")).strip()
            caption = str(slide.get("caption", "")).strip()
            narration = self._clean_for_tts(str(slide.get("narration", caption or title)).strip())
            image_prompt = str(slide.get("image_prompt", f"Editorial illustration for {topic}: {title}")).strip()
            negative_prompt = str(slide.get("negative_prompt", "")).strip()
            provided_image_path = str(slide.get("image_path", "")).strip()
            provided_audio_path = str(slide.get("audio_path", "")).strip()
            pause_after_s = int(slide.get("pause_after_s", 1) or 1)

            image_path = (
                self._copy_slide_media(Path(provided_image_path), project_dir, index, "image")
                if provided_image_path and Path(provided_image_path).exists()
                else await self._generate_slide_image(project_dir, image_prompt, negative_prompt, index, aspect_ratio, topic)
            )
            audio_path = (
                await self._prepare_provided_audio(Path(provided_audio_path), project_dir, index)
                if provided_audio_path and Path(provided_audio_path).exists()
                else await self._generate_slide_audio(project_dir, narration, index)
            )
            enriched.append({
                "title": title,
                "caption": caption,
                "narration": narration,
                "image_prompt": image_prompt,
                "negative_prompt": negative_prompt,
                "pause_after_s": pause_after_s,
                "image_path": str(image_path),
                "audio_path": str(audio_path),
                "provided_image_path": provided_image_path,
                "provided_audio_path": provided_audio_path,
            })

        clip_paths: list[Path] = []
        for index, slide in enumerate(enriched, 1):
            clip_path = await self._compose_slide_clip(
                work_dir=project_dir,
                slide_index=index,
                title=slide["title"],
                caption=slide["caption"],
                image_path=Path(slide["image_path"]),
                audio_path=Path(slide["audio_path"]),
                pause_after_s=int(slide.get("pause_after_s", 1) or 1),
                aspect_ratio=aspect_ratio,
            )
            slide["clip_path"] = str(clip_path)
            clip_paths.append(clip_path)

        manifest_path.write_text(json.dumps({"topic": topic, "aspect_ratio": aspect_ratio, "slides": enriched}, indent=2), encoding="utf-8")
        full_audio_path = await self._concat_slide_audio(project_dir, enriched)
        output_path = await self._concat_clips(project_dir, clip_paths, full_audio_path)
        subtitle_artifacts = await self._build_subtitle_artifacts(project_dir, full_audio_path)
        srt_path = subtitle_artifacts.get("subtitle_srt_path")
        if (self._sr_burn_in or self._whisper_burn_in) and srt_path:
            burned_output = await self._burn_subtitles_into_video(output_path, Path(srt_path))
            if burned_output:
                output_path = burned_output
        logger.success(f"[VideoAgent] Slide video assembled: {output_path}")
        return output_path, manifest_path, full_audio_path, project_dir, subtitle_artifacts

    async def _compose_slide_clip(
        self,
        work_dir: Path,
        slide_index: int,
        title: str,
        caption: str,
        image_path: Path,
        audio_path: Path,
        pause_after_s: int,
        aspect_ratio: str,
    ) -> Path:
        duration = await self._probe_duration(audio_path)
        total_duration = max(duration + pause_after_s, 1.0)
        clip_path = work_dir / f"slide_{slide_index:02d}.mp4"
        width, height = self._dimensions_for_ratio(aspect_ratio)
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
        )
        cmd = [
            self._ffmpeg,
            "-y",
            "-loop", "1",
            "-i", str(image_path),
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "medium",
            "-tune", "stillimage",
            "-pix_fmt", "yuv420p",
            "-t", f"{total_duration:.3f}",
            str(clip_path),
        ]
        await self._run_subprocess(cmd, timeout=600, error_label="FFmpeg slide clip")
        return clip_path

    async def _concat_clips(self, work_dir: Path, clip_paths: list[Path], full_audio_path: Path) -> Path:
        list_path = work_dir / "concat.txt"
        lines = [f"file '{self._ffmpeg_concat_path(path)}'" for path in clip_paths]
        list_path.write_text("\n".join(lines), encoding="utf-8")
        video_only_output = work_dir / "video_only.mp4"
        concat_cmd = [
            self._ffmpeg,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-c", "copy",
            str(video_only_output),
        ]
        await self._run_subprocess(concat_cmd, timeout=600, error_label="FFmpeg concat")

        output = work_dir / "final_video.mp4"
        mux_cmd = [
            self._ffmpeg,
            "-y",
            "-i", str(video_only_output),
            "-i", str(full_audio_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            str(output),
        ]
        await self._run_subprocess(mux_cmd, timeout=600, error_label="FFmpeg mux")
        return output

    async def _concat_slide_audio(self, work_dir: Path, slides: list[dict[str, Any]]) -> Path:
        parts: list[Path] = []
        for index, slide in enumerate(slides, 1):
            audio_path = Path(slide["audio_path"])
            parts.append(audio_path)
            pause_after_s = int(slide.get("pause_after_s", 1) or 1)
            if pause_after_s > 0:
                silence_path = work_dir / f"silence_{index:02d}.wav"
                cmd = [
                    self._ffmpeg,
                    "-y",
                    "-f", "lavfi",
                    "-i", f"anullsrc=r=22050:cl=mono",
                    "-t", str(pause_after_s),
                    str(silence_path),
                ]
                await self._run_subprocess(cmd, timeout=60, error_label="FFmpeg silence")
                parts.append(silence_path)

        list_path = work_dir / "audio_concat.txt"
        lines = [f"file '{self._ffmpeg_concat_path(path)}'" for path in parts]
        list_path.write_text("\n".join(lines), encoding="utf-8")
        output = work_dir / "full_audio.wav"
        cmd = [
            self._ffmpeg,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-c:a", "pcm_s16le",
            "-ar", "22050",
            "-ac", "1",
            str(output),
        ]
        await self._run_subprocess(cmd, timeout=300, error_label="FFmpeg audio concat")
        return output

    def _resolve_blog_path(self, payload: dict[str, Any], topic: str) -> str:
        explicit = str(payload.get("blog_path") or "").strip()
        if explicit and Path(explicit).exists():
            return explicit

        blog_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "blog"
        if not blog_dir.exists():
            return ""

        slug = self._slugify(topic)
        candidates = sorted(blog_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            return ""
        if not slug:
            return str(candidates[0])

        slug_parts = [part for part in slug.split("-") if part]
        for path in candidates:
            name_slug = self._slugify(path.stem)
            if slug in name_slug or name_slug in slug:
                return str(path)
            if slug_parts and all(part in name_slug for part in slug_parts[: min(3, len(slug_parts))]):
                return str(path)
        return ""

    def _resolve_latest_media_path(self, media_type: str) -> str:
        outputs_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
        media_dir = outputs_dir / media_type
        if not media_dir.exists():
            return ""

        patterns = {
            "images": ["*.png", "*.jpg", "*.jpeg", "*.webp"],
            "audio": ["*.wav", "*.mp3", "*.m4a"],
        }.get(media_type, ["*"])

        candidates: list[Path] = []
        for pattern in patterns:
            candidates.extend(media_dir.glob(pattern))
        if not candidates:
            return ""

        latest = max(candidates, key=lambda path: path.stat().st_mtime)
        return str(latest)

    async def _assemble_single(self, image_path: str, audio_path: str, topic: str, captions: str, aspect_ratio: str) -> tuple[Path, Path, dict[str, Any]]:
        project_dir = self._create_project_dir(topic)
        output = project_dir / "final_video.mp4"
        width, height = self._dimensions_for_ratio(aspect_ratio)
        image_source = Path(image_path)
        audio_source = Path(audio_path)
        project_image = project_dir / f"source_image{image_source.suffix or '.png'}"
        project_audio = project_dir / f"source_audio{audio_source.suffix or '.wav'}"
        if image_source.resolve() != project_image.resolve():
            project_image.write_bytes(image_source.read_bytes())
        if audio_source.resolve() != project_audio.resolve():
            project_audio.write_bytes(audio_source.read_bytes())

        cmd = [
            self._ffmpeg, "-y",
            "-loop", "1",
            "-i", str(project_image),
            "-i", str(project_audio),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-c:a", "aac",
            "-b:a", "192k",
            "-pix_fmt", "yuv420p",
            "-shortest",
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
        ]
        cmd.append(str(output))
        await self._run_subprocess(cmd, timeout=600, error_label="FFmpeg single video")
        subtitle_artifacts = await self._build_subtitle_artifacts(project_dir, project_audio)
        srt_path = subtitle_artifacts.get("subtitle_srt_path")
        if (self._sr_burn_in or self._whisper_burn_in) and srt_path:
            burned_output = await self._burn_subtitles_into_video(output, Path(srt_path))
            if burned_output:
                output = burned_output
        return output, project_dir, subtitle_artifacts

    async def _build_subtitle_artifacts(self, project_dir: Path, audio_path: Path) -> dict[str, Any]:
        # Priority: SpeechRecognition (free, online) → Whisper (local, higher accuracy)
        entries: list[dict[str, Any]] = []
        engine = ""
        skipped_steps: list[dict[str, Any]] = []

        if self._sr_enabled:
            try:
                entries = await self._transcribe_with_sr(audio_path)
                engine = "speech_recognition"
            except Exception as exc:
                logger.warning(f"[VideoAgent] SpeechRecognition skipped: {exc}")
                skipped_steps.append({
                    "step": "transcription",
                    "engine": "speech_recognition",
                    "reason": str(exc),
                })

        if not entries and self._whisper_enabled:
            try:
                entries = await self._transcribe_with_whisper(audio_path)
                engine = "whisper"
            except Exception as exc:
                logger.warning(f"[VideoAgent] Whisper skipped: {exc}")
                skipped_steps.append({
                    "step": "transcription",
                    "engine": "whisper",
                    "reason": str(exc),
                })
                return {"subtitle_warning": str(exc), "skipped_steps": skipped_steps}

        if not entries:
            if skipped_steps:
                return {
                    "subtitle_warning": "Proceeding without subtitles due to transcription failure.",
                    "skipped_steps": skipped_steps,
                }
            return {}

        srt_path = project_dir / "captions.srt"
        vtt_path = project_dir / "captions.vtt"
        self._write_srt_file(srt_path, entries)
        self._write_vtt_file(vtt_path, entries)
        result: dict[str, Any] = {
            "subtitle_srt_path": str(srt_path),
            "subtitle_vtt_path": str(vtt_path),
            "subtitle_engine": engine,
        }
        if skipped_steps:
            result["skipped_steps"] = skipped_steps
        burn = self._sr_burn_in if engine == "speech_recognition" else self._whisper_burn_in
        if burn:
            captioned = await self._burn_subtitles_into_video(project_dir / "output.mp4", srt_path)
            if captioned:
                result["captioned_video_path"] = str(captioned)
        return result

    async def _transcribe_with_sr(self, audio_path: Path) -> list[dict[str, Any]]:
        """Transcribe audio using the SpeechRecognition library (Google backend).
        Splits audio into chunks to approximate timestamps. Runs in a thread executor."""
        import functools

        chunk_seconds = self._sr_chunk_seconds
        language = self._sr_language

        def _run() -> list[dict[str, Any]]:
            import speech_recognition as sr  # noqa: PLC0415

            recognizer = sr.Recognizer()
            entries: list[dict[str, Any]] = []

            with sr.AudioFile(str(audio_path)) as source:
                duration = source.DURATION

            offset = 0.0
            while offset < duration:
                end = min(offset + chunk_seconds, duration)
                try:
                    with sr.AudioFile(str(audio_path)) as source:
                        audio = recognizer.record(source, offset=offset, duration=end - offset)
                    text = recognizer.recognize_google(audio, language=language)
                    if text.strip():
                        # Split chunk text into ~5-word phrases and spread timing evenly
                        words = text.strip().split()
                        phrase_size = 5
                        phrases = [" ".join(words[i:i + phrase_size]) for i in range(0, len(words), phrase_size)]
                        chunk_dur = end - offset
                        phrase_dur = chunk_dur / len(phrases)
                        for j, phrase in enumerate(phrases):
                            p_start = offset + j * phrase_dur
                            p_end = p_start + phrase_dur
                            entries.append({"start": p_start, "end": p_end, "text": phrase})
                except sr.UnknownValueError:
                    pass  # silence or unintelligible chunk
                except sr.RequestError as exc:
                    raise RuntimeError(f"Google Speech API error: {exc}") from exc
                offset = end

            return entries

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, functools.partial(_run))

    async def _transcribe_with_whisper(self, audio_path: Path) -> list[dict[str, Any]]:
        """Transcribe audio using local OpenAI Whisper. Runs in a thread executor
        since Whisper is CPU-bound synchronous code."""
        import functools

        def _run() -> list[dict[str, Any]]:
            import whisper  # noqa: PLC0415
            model = whisper.load_model(self._whisper_model)
            result = model.transcribe(str(audio_path), word_timestamps=True)
            entries: list[dict[str, Any]] = []
            for seg in result.get("segments", []):
                text = str(seg.get("text", "")).strip()
                if not text:
                    continue
                entries.append({
                    "start": float(seg.get("start", 0.0)),
                    "end": float(seg.get("end", 0.0)),
                    "text": text,
                })
            return entries

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, functools.partial(_run))

    def _write_srt_file(self, path: Path, entries: list[dict[str, Any]]) -> None:
        blocks = []
        for index, entry in enumerate(entries, 1):
            blocks.append(
                "\n".join([
                    str(index),
                    f"{self._format_subtitle_timestamp(float(entry['start']), vtt=False)} --> {self._format_subtitle_timestamp(float(entry['end']), vtt=False)}",
                    str(entry["text"]).strip(),
                ])
            )
        path.write_text("\n\n".join(blocks).strip() + "\n", encoding="utf-8")

    def _write_vtt_file(self, path: Path, entries: list[dict[str, Any]]) -> None:
        blocks = ["WEBVTT"]
        for entry in entries:
            blocks.append(
                "\n".join([
                    "",
                    f"{self._format_subtitle_timestamp(float(entry['start']), vtt=True)} --> {self._format_subtitle_timestamp(float(entry['end']), vtt=True)}",
                    str(entry["text"]).strip(),
                ])
            )
        path.write_text("\n".join(blocks).strip() + "\n", encoding="utf-8")

    def _format_subtitle_timestamp(self, total_seconds: float, vtt: bool) -> str:
        safe_seconds = max(total_seconds, 0.0)
        hours = int(safe_seconds // 3600)
        minutes = int((safe_seconds % 3600) // 60)
        seconds = int(safe_seconds % 60)
        milliseconds = int(round((safe_seconds - int(safe_seconds)) * 1000))
        if milliseconds == 1000:
            milliseconds = 0
            seconds += 1
        separator = "." if vtt else ","
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{milliseconds:03d}"

    async def _burn_subtitles_into_video(self, video_path: Path, subtitle_path: Path) -> Path | None:
        if not subtitle_path.exists() or not video_path.exists():
            return None
        # Run FFmpeg from the project dir using just "captions.srt" filename — avoids
        # Windows path-with-spaces bug in the subtitles= filter (e.g. "Mark g" in user dir)
        project_dir = subtitle_path.parent
        output_path = video_path.with_name(f"{video_path.stem}_captioned{video_path.suffix}")
        subtitle_filter = (
            "subtitles=captions.srt:"
            "force_style='FontName=Arial,FontSize=14,Bold=1,PrimaryColour=&H0000FFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=25'"
        )
        cmd = [
            self._ffmpeg,
            "-y",
            "-i", str(video_path.resolve()),
            "-vf", subtitle_filter,
            "-c:v", "libx264",
            "-preset", "medium",
            "-c:a", "copy",
            str(output_path.resolve()),
        ]
        try:
            await self._run_subprocess(cmd, timeout=600, error_label="FFmpeg subtitle burn", cwd=project_dir)
            return output_path
        except Exception as exc:
            logger.warning(f"[VideoAgent] Subtitle burn-in skipped: {exc}")
            return None

    def _copy_slide_media(self, source: Path, project_dir: Path, slide_index: int, media_kind: str) -> Path:
        suffix = source.suffix or (".png" if media_kind == "image" else ".wav")
        target = project_dir / f"slide_{slide_index:02d}_{media_kind}{suffix}"
        if source.resolve() != target.resolve():
            target.write_bytes(source.read_bytes())
        return target

    async def _prepare_provided_audio(self, source: Path, project_dir: Path, slide_index: int) -> Path:
        copied_path = self._copy_slide_media(source, project_dir, slide_index, "audio")
        normalized_path = project_dir / f"slide_{slide_index:02d}_audio.wav"
        await self._normalize_audio_file(copied_path, normalized_path)
        return normalized_path

    async def _generate_slide_image(self, project_dir: Path, prompt: str, negative_prompt: str, slide_index: int, aspect_ratio: str, article_topic: str = "") -> Path:
        """Generate a slide image via ImageAgent (respects image_mode: Replicate → ComfyUI → Abacus → placeholder)."""
        width, height = self._dimensions_for_ratio(aspect_ratio)
        dest = project_dir / f"slide_{slide_index:02d}_image.png"
        try:
            from agents.image_agent import ImageAgent
            from core.task_queue import Task as TQ
            import uuid
            agent = ImageAgent(self.llm)
            img_task = TQ(
                id=str(uuid.uuid4()),
                type="image_gen",
                payload={
                    "topic": article_topic or prompt,
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "width": width,
                    "height": height,
                    "size": f"{width}x{height}",
                    "aspect_ratio": aspect_ratio,
                },
            )
            result = await agent._execute(img_task)
            src = result.get("filepath") or result.get("image_path", "")
            if src and Path(src).exists():
                import shutil
                shutil.copy2(src, dest)
                logger.info(f"[VideoAgent] Slide {slide_index} image → {dest.name}")
                return dest
        except Exception as exc:
            logger.warning(f"[VideoAgent] ImageAgent failed for slide {slide_index}: {exc}")
        raise RuntimeError(f"Could not generate image for slide {slide_index}")

    async def _generate_abacus_slide_image(self, project_dir: Path, prompt: str, negative_prompt: str, slide_index: int, aspect_ratio: str) -> Path:
        width, height = self._dimensions_for_ratio(aspect_ratio)
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                f"{self._abacus_api_url.rstrip('/')}/images/generations",
                headers={
                    "Authorization": f"Bearer {self._abacus_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._abacus_image_model,
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "size": f"{width}x{height}",
                    "response_format": "b64_json",
                },
            )
            response.raise_for_status()
            data = response.json()
        image_items = data.get("data") or data.get("images") or []
        if not image_items:
            raise RuntimeError("Abacus AI returned no slide image")
        first = image_items[0]
        if isinstance(first, dict) and first.get("b64_json"):
            image_bytes = base64.b64decode(first["b64_json"])
        elif isinstance(first, dict) and (first.get("url") or first.get("image_url")):
            download = httpx.get(str(first.get("url") or first.get("image_url")), timeout=120)
            download.raise_for_status()
            image_bytes = download.content
        else:
            raise RuntimeError("Abacus AI returned an unsupported slide image payload")
        local_path = project_dir / f"slide_{slide_index:02d}_image.png"
        local_path.write_bytes(image_bytes)
        return local_path

    async def _build_comfy_workflow(self, prompt: str, negative_prompt: str, slide_index: int, aspect_ratio: str) -> dict[str, Any]:
        checkpoint = await self._resolve_checkpoint()
        width, height = self._dimensions_for_ratio(aspect_ratio)
        safe_prompt = self._sanitize_visual_prompt(prompt)
        visual_prompt = (
            "Generate a detailed, high-quality image that matches this visual description exactly. "
            "Do not add text, captions, titles, logos, watermarks, UI, or layout elements. "
            f"Keep it safe-for-work, fully clothed, non-sexual, and brand-safe. Visual description: {safe_prompt}"
        )
        base_negative = (
            "blurry, text, watermark, logo, subtitles, captions, title card, low quality, extra limbs, "
            f"{SAFE_FOR_WORK_SLIDE_NEGATIVE}"
        )
        full_negative_prompt = ", ".join(part for part in [base_negative, negative_prompt] if part).strip(", ")
        return {
            "3": {
                "inputs": {
                    "seed": int(uuid.uuid4().int % 2**32),
                    "steps": 28,
                    "cfg": 7.0,
                    "sampler_name": "dpmpp_2m",
                    "scheduler": "karras",
                    "denoise": 1,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0],
                },
                "class_type": "KSampler",
            },
            "4": {"inputs": {"ckpt_name": checkpoint}, "class_type": "CheckpointLoaderSimple"},
            "5": {"inputs": {"width": width, "height": height, "batch_size": 1}, "class_type": "EmptyLatentImage"},
            "6": {"inputs": {"text": f"{SAFE_FOR_WORK_SLIDE_POSITIVE}, {visual_prompt}", "clip": ["4", 1]}, "class_type": "CLIPTextEncode"},
            "7": {"inputs": {"text": full_negative_prompt, "clip": ["4", 1]}, "class_type": "CLIPTextEncode"},
            "8": {"inputs": {"samples": ["3", 0], "vae": ["4", 2]}, "class_type": "VAEDecode"},
            "9": {
                "inputs": {
                    "filename_prefix": f"slide_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{slide_index:02d}",
                    "images": ["8", 0],
                },
                "class_type": "SaveImage",
            },
        }

    def _contains_nsfw_risk(self, text: str) -> bool:
        lowered = str(text or "").lower()
        return any(term in lowered for term in NSFW_RISK_TERMS)

    def _sanitize_visual_prompt(self, prompt: str) -> str:
        text = str(prompt or "").strip()
        if not self._contains_nsfw_risk(text):
            return text
        logger.warning("[VideoAgent] NSFW-risk slide prompt detected. Rewriting to a safe editorial interpretation.")
        return "safe-for-work editorial concept, fully clothed subject presentation, brand-safe composition"

    async def _resolve_checkpoint(self) -> str:
        if self._resolved_checkpoint:
            return self._resolved_checkpoint

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{self._comfyui_url}/object_info/CheckpointLoaderSimple")
            resp.raise_for_status()
            data = resp.json()

        available = (
            data.get("CheckpointLoaderSimple", {})
            .get("input", {})
            .get("required", {})
            .get("ckpt_name", [[]])[0]
        )
        if not available:
            raise RuntimeError("No ComfyUI checkpoints are available")

        if self._checkpoint_name in available:
            self._resolved_checkpoint = self._checkpoint_name
            return self._checkpoint_name

        preferred = next(
            (name for name in available if "realistic" in name.lower() or "cyber" in name.lower()),
            available[0],
        )
        self._resolved_checkpoint = preferred
        logger.warning(
            f"[VideoAgent] Checkpoint '{self._checkpoint_name}' not found, using '{preferred}'"
        )
        return preferred

    async def _generate_slide_audio(self, project_dir: Path, narration: str, slide_index: int) -> Path:
        voice_mode = str(get_setting("tool_routing", "voice_mode", "edge-tts")).strip().lower()
        filepath = project_dir / f"slide_{slide_index:02d}_audio.wav"
        clean_narration = self._clean_for_tts(narration)[:700]

        if voice_mode == "edge-tts":
            # Use Edge TTS (Microsoft neural voices, free)
            import edge_tts  # type: ignore[import]
            voice = str(get_setting("edge_tts", "voice", "en-US-AriaNeural") or "en-US-AriaNeural")
            speed = get_setting("edge_tts", "speed", "1.0") or "1.0"
            rate = f"+{int((float(speed) - 1.0) * 100)}%" if float(speed) != 1.0 else "+0%"
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
                tmp_path = Path(tmp.name)
            try:
                communicate = edge_tts.Communicate(clean_narration, voice=voice, rate=rate)
                await communicate.save(str(tmp_path))
                await self._normalize_audio_file(tmp_path, filepath)
            finally:
                tmp_path.unlink(missing_ok=True)
        else:
            if not self._elevenlabs_api_key:
                raise RuntimeError("ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in .env or Settings → ElevenLabs.")
            if not self._elevenlabs_voice_id:
                raise RuntimeError("ElevenLabs Voice ID not configured. Set ELEVENLABS_VOICE_ID in .env or Settings → ElevenLabs.")
            async with httpx.AsyncClient(timeout=180) as client:
                audio_bytes = await self._request_elevenlabs_audio(client, clean_narration)
                with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = Path(tmp.name)
                try:
                    await self._normalize_audio_file(tmp_path, filepath)
                finally:
                    tmp_path.unlink(missing_ok=True)
        return filepath

    async def _normalize_audio_file(self, source: Path, target: Path) -> None:
        cmd = [
            self._ffmpeg,
            "-y",
            "-i", str(source),
            "-af", "aresample=22050,asetpts=N/SR/TB",
            "-c:a", "pcm_s16le",
            "-ar", "22050",
            "-ac", "1",
            str(target),
        ]
        await self._run_subprocess(cmd, timeout=180, error_label="FFmpeg audio normalize")

    async def _request_elevenlabs_audio(self, client: httpx.AsyncClient, text: str) -> bytes:
        response = await client.post(
            f"{self._elevenlabs_url.rstrip('/')}/v1/text-to-speech/{self._elevenlabs_voice_id}",
            headers={
                "xi-api-key": self._elevenlabs_api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            params={"output_format": self._elevenlabs_output_format},
            json={
                "text": text,
                "model_id": self._elevenlabs_model_id,
            },
        )
        response.raise_for_status()
        return response.content

    async def _probe_duration(self, audio_path: Path) -> float:
        cmd = [
            self._ffprobe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {stderr.decode()[-300:]}")
        return max(float(stdout.decode().strip() or "0"), 0.1)

    async def _run_subprocess(self, cmd: list[str], timeout: int, error_label: str, cwd: Path | None = None) -> None:
        logger.info(f"[VideoAgent] Running command: {' '.join(cmd[:6])}...")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            raise RuntimeError(f"{error_label} failed: {stderr.decode()[-500:]}")

    async def _demo_video(self, topic: str) -> dict[str, Any]:
        logger.warning(f"[VideoAgent] No blog/image/audio for '{topic}', skipping assembly")
        return {
            "type": "video",
            "topic": topic,
            "filepath": None,
            "note": "Awaiting blog or media assets",
        }

    def _ffmpeg_path(path: Path) -> str:
        return str(path).replace("\\", "/").replace(":", "\\:")

    @staticmethod
    def _ffmpeg_concat_path(path: Path) -> str:
        return str(path.resolve()).replace("\\", "/").replace("'", r"'\''")

    @staticmethod
    def _ffmpeg_filter_path(path: Path) -> str:
        return str(path.resolve()).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")

    def _clean_for_tts(self, text: str) -> str:
        text = unicodedata.normalize("NFKD", str(text or ""))
        text = text.encode("ascii", "ignore").decode("ascii")
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
        text = re.sub(r"[^A-Za-z0-9 .,!?':;\n-]", " ", text)
        text = re.sub(r"\b([A-Z]{3,})\b", lambda m: " ".join(m.group(1).lower()), text)
        text = re.sub(r"\b(\d{4,})\b", "", text)
        text = re.sub(r"\s{2,}", " ", text)
        return text.strip()[:700]

    def _dimensions_for_ratio(self, aspect_ratio: str) -> tuple[int, int]:
        if str(aspect_ratio).strip() == "9:16":
            return (
                int(get_setting("video", "portrait_width", "720")),
                int(get_setting("video", "portrait_height", "1280")),
            )
        return (
            int(get_setting("video", "landscape_width", "1280")),
            int(get_setting("video", "landscape_height", "720")),
        )

    def _create_project_dir(self, topic: str) -> Path:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        slug = self._slugify(topic) or "video-project"
        project_dir = self._video_dir / f"{timestamp}_{slug[:48]}_{uuid.uuid4().hex[:6]}"
        project_dir.mkdir(parents=True, exist_ok=True)
        return project_dir

    def _cleanup_temp_files(self, project_dir: Path) -> None:
        """Delete intermediate build artifacts from a completed project directory.

        Keeps the final output (final_video.mp4, storyboard.json, captions, transcript)
        and removes files that are only needed during assembly.
        """
        deleted_count = 0
        freed_bytes = 0

        def _remove(path: Path) -> None:
            nonlocal deleted_count, freed_bytes
            try:
                freed_bytes += path.stat().st_size
                path.unlink()
                deleted_count += 1
            except OSError:
                pass

        # Named intermediate files
        for name in ("concat.txt", "audio_concat.txt", "video_only.mp4"):
            _remove(project_dir / name)

        # Silence padding files
        for path in project_dir.glob("silence_*.wav"):
            _remove(path)

        # MPEG-TS segment files (HLS-style intermediates)
        for path in project_dir.glob("*.ts"):
            _remove(path)

        # Per-slide intermediate audio parts (e.g. slide_01_audio_part_00.wav)
        for path in project_dir.glob("slide_*_audio_part_*.wav"):
            _remove(path)

        if deleted_count:
            logger.debug(
                f"[VideoAgent] Cleaned up {deleted_count} temp file(s) "
                f"({freed_bytes:,} bytes) from {project_dir.name}"
            )
        else:
            logger.debug(f"[VideoAgent] No temp files to clean in {project_dir.name}")

    @staticmethod
    def _slugify(value: str) -> str:
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value)).strip("-")
        return "-".join(part for part in slug.split("-") if part)
