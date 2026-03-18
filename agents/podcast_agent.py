"""
Podcast Agent — Generates multi-speaker AI podcasts
1. Uses LLM to write a full conversation script with speaker turns
2. Synthesizes each turn via ElevenLabs or Edge TTS
3. Merges all audio clips into a single MP3 with FFmpeg
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

import httpx
from loguru import logger

from core.runtime_settings import get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent

# Edge TTS voice map (free, no API key needed)
EDGE_VOICE_MAP: dict[str, str] = {
    "alloy":   "en-US-AriaNeural",
    "echo":    "en-US-GuyNeural",
    "fable":   "en-GB-RyanNeural",
    "onyx":    "en-US-DavisNeural",
    "nova":    "en-US-JennyNeural",
    "shimmer": "en-US-SaraNeural",
}

SCRIPT_SYSTEM = """You are a professional podcast script writer.
Write a natural, engaging conversation between the specified speakers on the given topic.
Output ONLY a JSON array of turns — no markdown, no preamble.

Format:
[
  {"speaker": "SpeakerName", "text": "What they say..."},
  {"speaker": "OtherSpeaker", "text": "Their response..."}
]

Rules:
- Each turn should be 1-4 sentences (conversational, not lecture-style)
- Alternate between speakers naturally
- Include follow-up questions, agreements, pushbacks
- Start with a brief intro, end with a wrap-up
- Do NOT include stage directions, sound effects, or music cues
- Output valid JSON only"""


class PodcastAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("podcast_agent", llm, max_concurrent=1)
        self._audio_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "podcasts"
        self._audio_dir.mkdir(parents=True, exist_ok=True)
        self._ffmpeg = os.getenv("FFMPEG_BIN", os.getenv("FFMPEG_PATH", get_setting("ffmpeg", "path", "ffmpeg")))
        self._elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", get_setting("elevenlabs", "api_key", ""))
        self._elevenlabs_url = os.getenv("ELEVENLABS_API_URL", get_setting("elevenlabs", "api_url", "https://api.elevenlabs.io"))
        self._elevenlabs_model = os.getenv("ELEVENLABS_MODEL_ID", get_setting("elevenlabs", "model_id", "eleven_multilingual_v2"))

    def skill_summary(self) -> dict:
        return {
            "name": "PodcastAgent",
            "capabilities": ["podcast_gen"],
            "description": "Generates multi-speaker AI podcasts with scripted conversation and synthesized voices",
            "tts_backend": "elevenlabs" if self._elevenlabs_api_key else "edge-tts",
        }

    async def _execute(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "AI and the future")
        description = task.payload.get("description", "")
        duration_minutes = int(task.payload.get("duration_minutes", 10))
        speakers = task.payload.get("speakers", [
            {"name": "Host", "voice": "nova", "role": "host"},
            {"name": "Guest", "voice": "echo", "role": "guest"},
        ])

        logger.info(f"[PodcastAgent] Generating podcast: '{topic}' ({duration_minutes} min, {len(speakers)} speakers)")

        # Estimate turn count from duration (~130 words/min, ~40 words/turn)
        words_total = duration_minutes * 130
        turns_estimate = max(10, words_total // 40)

        # Build speaker descriptions
        speaker_desc = "\n".join(
            f"- {s['name']} ({s.get('role', 'speaker')})" for s in speakers
        )

        prompt = (
            f"Topic: {topic}\n"
            + (f"Context: {description}\n" if description else "")
            + f"Speakers:\n{speaker_desc}\n"
            f"Target: approximately {turns_estimate} turns total\n"
            f"Write the full podcast conversation as a JSON array."
        )

        # Generate script
        logger.info("[PodcastAgent] Writing script...")
        raw = await self.llm.complete(prompt, system=SCRIPT_SYSTEM, max_tokens=8000)
        script = self._parse_script(raw, speakers)
        logger.info(f"[PodcastAgent] Script ready: {len(script)} turns")

        # Synthesize audio for each turn
        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:50]
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        project_dir = self._audio_dir / f"{timestamp}_{slug}"
        project_dir.mkdir(parents=True, exist_ok=True)

        # Build a speaker→voice map that handles LLM using different names
        # First pass: collect unique speaker names in order of appearance
        seen_speakers: list[str] = []
        for turn in script:
            name = turn["speaker"]
            if name not in seen_speakers:
                seen_speakers.append(name)

        # Map each unique LLM speaker name to a configured speaker by position
        speaker_voice_map: dict[str, str] = {}
        for idx, llm_name in enumerate(seen_speakers):
            # Try exact match first
            exact = next((s for s in speakers if s["name"].lower() == llm_name.lower()), None)
            if exact:
                speaker_voice_map[llm_name] = exact.get("voice", "nova")
            elif idx < len(speakers):
                # Positional fallback: 1st unique speaker → speakers[0], 2nd → speakers[1], etc.
                speaker_voice_map[llm_name] = speakers[idx].get("voice", "nova")
            else:
                # Cycle through speakers if more LLM speakers than configured
                speaker_voice_map[llm_name] = speakers[idx % len(speakers)].get("voice", "nova")

        logger.info(f"[PodcastAgent] Voice map: {speaker_voice_map}")

        clip_paths: list[Path] = []
        for i, turn in enumerate(script):
            speaker_name = turn["speaker"]
            text = turn["text"]
            voice = speaker_voice_map.get(speaker_name, "nova")
            clip_path = project_dir / f"turn_{i:03d}.mp3"

            logger.info(f"[PodcastAgent] TTS turn {i+1}/{len(script)}: {speaker_name} → voice={voice}")
            await self._synthesize(text, voice, clip_path)
            clip_paths.append(clip_path)

        # Merge all clips
        output_path = project_dir / "podcast.mp3"
        await self._merge_clips(clip_paths, output_path)

        # Save script as JSON
        script_path = project_dir / "script.json"
        script_path.write_text(json.dumps({"topic": topic, "turns": script}, indent=2), encoding="utf-8")

        logger.success(f"[PodcastAgent] Podcast ready: {output_path}")
        return {
            "type": "podcast",
            "topic": topic,
            "filepath": str(output_path),
            "script_path": str(script_path),
            "duration_minutes": duration_minutes,
            "turn_count": len(script),
            "speakers": [s["name"] for s in speakers],
        }

    def _parse_script(self, raw: str, speakers: list) -> list[dict]:
        """Parse LLM output into list of {speaker, text} turns."""
        text = raw.strip()
        # Strip markdown code fences
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()

        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [{"speaker": t.get("speaker", "Speaker"), "text": t.get("text", "")} for t in data if t.get("text")]
        except json.JSONDecodeError:
            pass

        # Fallback: parse "SpeakerName: text" lines
        logger.warning("[PodcastAgent] JSON parse failed, falling back to line parsing")
        turns = []
        speaker_names = [s["name"] for s in speakers]
        for line in text.split("\n"):
            line = line.strip()
            for name in speaker_names:
                if line.startswith(f"{name}:"):
                    turns.append({"speaker": name, "text": line[len(name)+1:].strip()})
                    break
        return turns or [{"speaker": speakers[0]["name"], "text": text}]

    def _is_elevenlabs_voice_id(self, voice: str) -> bool:
        """ElevenLabs voice IDs are 20-char alphanumeric strings."""
        return bool(re.match(r'^[A-Za-z0-9]{15,}$', voice))

    async def _synthesize(self, text: str, voice: str, output_path: Path) -> None:
        """Synthesize speech — ElevenLabs if key + real voice ID, else Edge TTS."""
        if self._elevenlabs_api_key and self._is_elevenlabs_voice_id(voice):
            await self._tts_elevenlabs(text, voice, output_path)
        else:
            await self._tts_edge(text, voice, output_path)

    async def _tts_elevenlabs(self, text: str, voice_id: str, output_path: Path) -> None:
        # If voice_id looks like a name key, map it; otherwise use as-is
        actual_voice = voice_id if len(voice_id) > 10 else voice_id
        url = f"{self._elevenlabs_url}/v1/text-to-speech/{actual_voice}"
        headers = {
            "xi-api-key": self._elevenlabs_api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "model_id": self._elevenlabs_model,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            output_path.write_bytes(r.content)

    async def _tts_edge(self, text: str, voice_key: str, output_path: Path) -> None:
        """Use Edge TTS (free, no API key). Runs in executor since edge-tts is sync-ish."""
        edge_voice = EDGE_VOICE_MAP.get(voice_key, "en-US-AriaNeural")

        async def _run():
            try:
                import edge_tts
                communicate = edge_tts.Communicate(text, edge_voice)
                await communicate.save(str(output_path))
            except ImportError:
                # Fallback: subprocess edge-tts CLI
                proc = await asyncio.create_subprocess_exec(
                    "edge-tts", "--voice", edge_voice, "--text", text, "--write-media", str(output_path),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                )
                _, err = await proc.communicate()
                if proc.returncode != 0:
                    raise RuntimeError(f"edge-tts failed: {err.decode()}")

        await _run()

    async def _merge_clips(self, clip_paths: list[Path], output_path: Path) -> None:
        """Concatenate MP3 clips using FFmpeg concat demuxer."""
        if not clip_paths:
            raise ValueError("No clips to merge")

        if len(clip_paths) == 1:
            import shutil
            shutil.copy2(clip_paths[0], output_path)
            return

        # Write concat list file with absolute paths
        list_file = output_path.parent.resolve() / "concat_list.txt"
        lines = [f"file '{p.resolve()}'\n" for p in clip_paths]
        list_file.write_text("".join(lines), encoding="utf-8")

        cmd = [
            self._ffmpeg, "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(output_path.resolve()),
        ]
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: subprocess.run(cmd, capture_output=True)
        )
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg merge failed: {result.stderr.decode()[-300:]}")

        list_file.unlink(missing_ok=True)
        logger.info(f"[PodcastAgent] Merged {len(clip_paths)} clips → {output_path}")
