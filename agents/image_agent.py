"""
Image Agent — Pexels stock photo + cloud fallback image generation

Provider priority:
  1. Pexels API    — free stock photos searched by topic keywords (primary)
  2. Replicate API — cloud Flux generation (if REPLICATE_API_TOKEN set)
  3. Abacus AI     — secondary cloud fallback (if ABACUS_ENABLED)
  4. Placeholder   — PIL stub when all providers are unavailable
"""
from __future__ import annotations

import asyncio
import base64
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

from core.storage import upload_file as _storage_upload

import httpx
from loguru import logger

from core.prompting import compose_system_prompt, get_prompt_override
from core.runtime_settings import get_setting

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient

from .base_agent import BaseAgent

# Replicate model identifiers — override via env if needed
REPLICATE_FLUX_MODEL  = "black-forest-labs/flux-schnell"

PROMPT_SYSTEM = """You are an expert Stable Diffusion prompt engineer specializing in blog hero images.
Your job: create a vivid, on-topic image prompt that VISUALLY represents the article topic.

Rules:
- The image must clearly relate to the article topic
- NEVER include people, humans, faces, or body parts — describe ONLY objects, environments, and abstract concepts
- Good visuals: clean desks, glowing brain renders, stacked notebooks, light beams, geometric shapes, digital UI screens, nature scenes, product flat-lays, abstract textures
- Style: professional, clean, modern, editorial — soft cinematic lighting, shallow depth of field
- Always include: lighting description, composition, color palette, mood
- Keep prompts under 120 words
- No NSFW content
- Output ONLY the prompt, no preamble or explanation"""

SAFE_FOR_WORK_POSITIVE = (
    "safe-for-work, fully clothed, non-sexual, non-erotic, PG-rated, "
    "professional editorial image, age-appropriate adult presentation"
)
SAFE_FOR_WORK_NEGATIVE = (
    "nsfw, nude, nudity, naked, erotic, sexual, explicit, fetish, porn, lingerie, underwear, bikini, swimsuit, "
    "cleavage focus, nipple, areola, thong, transparent clothing, cameltoe, butt focus, crotch focus, suggestive pose, "
    "bedroom eyes, boudoir, pinup, provocative framing, "
    "people, person, human, man, woman, face, hands, body, portrait, figure, character, anime, cartoon"
)
NSFW_RISK_TERMS = (
    "nsfw", "nude", "nudity", "naked", "erotic", "sexual", "explicit", "fetish", "porn",
    "lingerie", "underwear", "bikini", "swimsuit", "cleavage", "nipple", "areola", "thong",
    "cameltoe", "seductive", "provocative", "boudoir", "pinup",
)


class ImageAgent(BaseAgent):
    def __init__(self, llm: "LLMClient"):
        super().__init__("image_agent", llm, max_concurrent=2)
        self._images_dir = Path(os.getenv("OUTPUTS_DIR", "./outputs")) / "images"
        self._images_dir.mkdir(parents=True, exist_ok=True)

        # --- Pexels (primary free stock photo provider) ---
        self._pexels_api_key = os.getenv("PEXELS_API_KEY", "")
        self._pexels_per_page = int(os.getenv("PEXELS_PER_PAGE", "30"))
        self._pexels_used_ids: set = set()  # track used photo IDs to avoid duplicates

        # --- DALL-E 3 via OpenAI (AI-generated, topic-accurate) ---
        self._openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self._dalle_model = os.getenv("DALLE_MODEL", "dall-e-3")
        self._dalle_quality = os.getenv("DALLE_QUALITY", "standard")  # standard or hd

        # --- Replicate (cloud Flux generation) ---
        self._replicate_api_key = os.getenv("REPLICATE_API_KEY", "")
        self._replicate_model = os.getenv(
            "REPLICATE_IMAGE_MODEL",
            get_setting("replicate", "image_model", REPLICATE_FLUX_MODEL),
        )

        self._allow_placeholder = str(os.getenv("ALLOW_PLACEHOLDER_MEDIA", "false")).lower() in {"true", "1", "yes"}

    def skill_summary(self) -> dict:
        provider = "pexels" if self._pexels_api_key else ("dalle3" if self._openai_api_key else ("replicate" if self._replicate_api_key else "unconfigured"))
        return {
            "name": "ImageAgent",
            "capabilities": ["image_gen", "image_variation"],
            "description": "Cloud-first image generation with strict provider failure handling",
            "primary_provider": provider,
            "replicate_model": self._replicate_model,
            "skills_loaded": len(self.skill_inventory()),
            "profile_dir": str(self._profile_dir),
        }

    def refresh_settings(self) -> None:
        self._pexels_api_key = os.getenv("PEXELS_API_KEY", self._pexels_api_key)
        self._pexels_per_page = int(os.getenv("PEXELS_PER_PAGE", str(self._pexels_per_page)))
        self._openai_api_key = os.getenv("OPENAI_API_KEY", self._openai_api_key)
        self._dalle_model = os.getenv("DALLE_MODEL", self._dalle_model)
        self._dalle_quality = os.getenv("DALLE_QUALITY", self._dalle_quality)
        self._replicate_api_key = os.getenv("REPLICATE_API_KEY", self._replicate_api_key)
        self._replicate_model = os.getenv(
            "REPLICATE_IMAGE_MODEL",
            get_setting("replicate", "image_model", self._replicate_model),
        )
        self._allow_placeholder = str(os.getenv("ALLOW_PLACEHOLDER_MEDIA", str(self._allow_placeholder).lower())).lower() in {"true", "1", "yes"}

    async def _execute(self, task: "Task") -> dict[str, Any]:
        topic = task.payload.get("topic", "technology")
        keywords: list = task.payload.get("keywords") or []
        visual_prompt = str(task.payload.get("prompt") or task.payload.get("scene") or topic).strip()
        style = task.payload.get("style", "professional editorial")
        aspect_ratio = task.payload.get("aspect_ratio") or get_setting("video", "default_aspect_ratio", "16:9")
        # Use explicit dimensions from payload if provided, else derive from aspect ratio
        explicit_w = task.payload.get("width")
        explicit_h = task.payload.get("height")
        if explicit_w and explicit_h:
            width, height = int(explicit_w), int(explicit_h)
        else:
            width, height = self._dimensions_for_ratio(aspect_ratio)
        skill_context = self.skill_context("image_gen")

        try:
            # Generate SD prompt via LLM
            prompt_system = get_prompt_override("image_prompt_system", PROMPT_SYSTEM)
            visual_prompt = self._sanitize_visual_prompt(visual_prompt, topic, style)
            kw_line = f"Keywords: {', '.join(keywords)}\n" if keywords else ""
            prompt_text = await self.llm.complete(
                f"""Article topic: {topic}
{kw_line}Style: {style}

Write a Stable Diffusion image prompt using ONLY this format:
[2-3 physical objects directly related to the topic] on [surface/setting], [lighting], [color palette], [mood], product photography, no people, clean background, sharp focus, 8k

Examples:
- Topic "Sleep Tips": white pillow and lavender essential oil bottle on linen sheets, soft warm candlelight, muted beige tones, calm serene mood
- Topic "ADHD Focus": open planner notebook with colorful sticky notes and a timer, clean wooden desk, soft morning light, crisp blue and white tones, focused productive mood
- Topic "Investing": stack of gold coins beside a small green plant in a glass jar, marble surface, bright studio lighting, gold and white tones, confident growth mood

Now write ONE prompt for: {topic}
Output only the prompt text, nothing else.""",
                system=compose_system_prompt(prompt_system, skill_context),
                max_tokens=300,
            )
            prompt_text = self._normalize_prompt_text(prompt_text, visual_prompt, style)
            negative_prompt = str(task.payload.get("negative_prompt") or "").strip()
            logger.info(f"[ImageAgent] Prompt: {prompt_text[:100]}...")

            # --- Provider waterfall ---
            # 1. Pexels (free stock photos, keyword search)
            if self._pexels_api_key:
                try:
                    return await self._generate_pexels(topic, keywords, aspect_ratio, width, height, prompt_text)
                except Exception as e:
                    logger.warning(f"[ImageAgent] Pexels failed ({e}), trying DALL-E 3")

            # 2. DALL-E 3 (OpenAI, AI-generated, topic-accurate)
            if self._openai_api_key:
                try:
                    return await self._generate_dalle(prompt_text, topic, aspect_ratio, width, height)
                except Exception as e:
                    logger.warning(f"[ImageAgent] DALL-E 3 failed ({e}), trying Replicate")

            # 3. Replicate (cloud Flux generation)
            if self._replicate_api_key:
                try:
                    return await self._generate_replicate(prompt_text, negative_prompt, topic, aspect_ratio, width, height)
                except Exception as e:
                    logger.warning(f"[ImageAgent] Replicate failed ({e}), using placeholder")

            if self._allow_placeholder:
                return await self._placeholder_image(topic, prompt_text, aspect_ratio, width, height)

            raise RuntimeError("No image provider is available. Configure PEXELS_API_KEY or OPENAI_API_KEY.")
        finally:
            logger.debug("[ImageAgent] _execute complete — in-memory prompt data released")

    async def _generate_pexels(self, topic: str, keywords: list, aspect_ratio: str, width: int, height: int, fallback_prompt: str) -> dict:
        """Search Pexels for a relevant stock photo by topic keywords."""
        # Build search query from topic + keywords
        query_parts = [topic] + [str(k) for k in (keywords or [])][:2]
        query = " ".join(query_parts)[:100]

        orientation = "landscape"
        if aspect_ratio in ("9:16", "4:5"):
            orientation = "portrait"
        elif aspect_ratio == "1:1":
            orientation = "square"

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                "https://api.pexels.com/v1/search",
                headers={"Authorization": self._pexels_api_key},
                params={
                    "query": query,
                    "per_page": self._pexels_per_page,
                    "orientation": orientation,
                },
            )
            r.raise_for_status()
            data = r.json()

        photos = data.get("photos", [])
        if not photos:
            raise RuntimeError(f"Pexels returned no results for query: {query!r}")

        import random
        # Prefer unused photos; fallback to any if all used
        unused = [p for p in photos if p.get("id") not in self._pexels_used_ids]
        pool = unused if unused else photos
        photo = random.choice(pool)
        self._pexels_used_ids.add(photo.get("id"))
        src = photo.get("src", {})
        # Pick best size for our dimensions
        img_url = src.get("large2x") or src.get("large") or src.get("original")
        if not img_url:
            raise RuntimeError("Pexels photo has no usable URL")

        async with httpx.AsyncClient(timeout=60) as client:
            img_r = await client.get(img_url)
            img_r.raise_for_status()

        filename = f"pexels_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.jpg"
        local_path = self._images_dir / filename
        local_path.write_bytes(img_r.content)

        # Resize/crop to exact target dimensions using PIL
        try:
            from PIL import Image as PILImage
            import io
            img = PILImage.open(io.BytesIO(img_r.content))
            img = img.convert("RGB")
            # Smart crop: resize to cover then center crop
            img_ratio = img.width / img.height
            target_ratio = width / height
            if img_ratio > target_ratio:
                new_h = height
                new_w = int(img.width * height / img.height)
            else:
                new_w = width
                new_h = int(img.height * width / img.width)
            img = img.resize((new_w, new_h), PILImage.LANCZOS)
            left = (new_w - width) // 2
            top = (new_h - height) // 2
            img = img.crop((left, top, left + width, top + height))
            img.save(str(local_path))
        except Exception as e:
            logger.warning(f"[ImageAgent] Pexels resize failed ({e}), using original")

        logger.success(f"[ImageAgent] Image saved via Pexels: {local_path} (query: {query!r})")
        storage_url = await _storage_upload("images", local_path, filename)
        return {
            "type": "image",
            "topic": topic,
            "filepath": str(local_path),
            "filename": filename,
            "storage_url": storage_url,
            "sd_prompt": fallback_prompt,
            "negative_prompt": "",
            "source": "pexels",
            "pexels_id": photo.get("id"),
            "pexels_photographer": photo.get("photographer", ""),
            "pexels_query": query,
            "aspect_ratio": aspect_ratio,
            "width": width,
            "height": height,
        }

    async def _generate_dalle(self, prompt: str, topic: str, aspect_ratio: str, width: int, height: int) -> dict:
        """Generate image via DALL-E 3 (OpenAI). Topic-accurate, no people issues."""
        # DALL-E 3 supports only specific sizes
        if aspect_ratio in ("9:16", "4:5"):
            size = "1024x1792"
        elif aspect_ratio == "1:1":
            size = "1024x1024"
        else:
            size = "1792x1024"  # 16:9 landscape

        safe_prompt = f"{prompt}, no people, no humans, objects only, professional photography"

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={
                    "Authorization": f"Bearer {self._openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._dalle_model,
                    "prompt": safe_prompt,
                    "n": 1,
                    "size": size,
                    "quality": self._dalle_quality,
                    "response_format": "url",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        img_url = data["data"][0]["url"]
        async with httpx.AsyncClient(timeout=60) as client:
            img_r = await client.get(img_url)
            img_r.raise_for_status()

        filename = f"dalle_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.png"
        local_path = self._images_dir / filename
        local_path.write_bytes(img_r.content)
        logger.success(f"[ImageAgent] Image saved via DALL-E 3: {local_path}")
        storage_url = await _storage_upload("images", local_path, filename)
        return {
            "type": "image",
            "topic": topic,
            "filepath": str(local_path),
            "filename": filename,
            "storage_url": storage_url,
            "sd_prompt": prompt,
            "negative_prompt": "",
            "source": "dalle3",
            "model": self._dalle_model,
            "aspect_ratio": aspect_ratio,
            "width": width,
            "height": height,
        }

    async def _generate_replicate(
        self,
        sd_prompt: str,
        negative_prompt: str,
        topic: str,
        aspect_ratio: str,
        width: int,
        height: int,
    ) -> dict:
        """Generate image via Replicate API (cloud, no local hardware required).

        Supports any model exposed via Replicate's prediction API.
        Model is selected by REPLICATE_IMAGE_MODEL env var (default: flux-schnell).
        """
        positive = self._build_positive_prompt(sd_prompt)
        model = self._replicate_model.strip()

        # Build input payload — Flux and SDXL have slightly different field names
        is_flux = "flux" in model.lower()
        if is_flux:
            input_payload: dict[str, Any] = {
                "prompt": positive,
                "aspect_ratio": aspect_ratio if aspect_ratio in ("1:1", "16:9", "9:16", "4:3", "3:4") else "16:9",
                "output_format": "png",
                "output_quality": 90,
                "num_outputs": 1,
            }
        else:
            # SDXL-style
            input_payload = {
                "prompt": positive,
                "negative_prompt": self._build_negative_prompt(negative_prompt),
                "width": width,
                "height": height,
                "num_outputs": 1,
                "guidance_scale": 7.5,
                "num_inference_steps": 30,
                "scheduler": "DPMSolverMultistep",
            }

        headers = {
            "Authorization": f"Token {self._replicate_api_key}",
            "Content-Type": "application/json",
            "Prefer": "wait",  # synchronous response — waits up to 60s
        }

        async with httpx.AsyncClient(timeout=120) as client:
            # Submit prediction
            resp = await client.post(
                f"https://api.replicate.com/v1/models/{model}/predictions",
                headers=headers,
                json={"input": input_payload},
            )
            if resp.status_code == 404:
                # Fallback: versioned model endpoint
                resp = await client.post(
                    f"https://api.replicate.com/v1/predictions",
                    headers=headers,
                    json={"version": model, "input": input_payload},
                )
            resp.raise_for_status()
            prediction = resp.json()

            # Poll if not already succeeded (Prefer: wait may not be supported on all models)
            prediction_id = prediction.get("id")
            for _ in range(60):
                status = prediction.get("status")
                if status == "succeeded":
                    break
                if status in ("failed", "canceled"):
                    raise RuntimeError(f"Replicate prediction {prediction_id} {status}: {prediction.get('error')}")
                if status not in ("starting", "processing"):
                    break
                await asyncio.sleep(2)
                poll = await client.get(
                    f"https://api.replicate.com/v1/predictions/{prediction_id}",
                    headers=headers,
                )
                poll.raise_for_status()
                prediction = poll.json()

            output = prediction.get("output")
            if not output:
                raise RuntimeError(f"Replicate returned no output for prediction {prediction_id}")

            image_url = output[0] if isinstance(output, list) else output

            # Download image
            img_resp = await client.get(str(image_url), timeout=60)
            img_resp.raise_for_status()

        filename = f"replicate_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.png"
        local_path = self._images_dir / filename
        local_path.write_bytes(img_resp.content)
        logger.success(f"[ImageAgent] Image saved via Replicate: {local_path}")
        storage_url = await _storage_upload("images", local_path, filename)
        return {
            "type": "image",
            "topic": topic,
            "filepath": str(local_path),
            "filename": filename,
            "storage_url": storage_url,
            "sd_prompt": sd_prompt,
            "negative_prompt": self._build_negative_prompt(negative_prompt),
            "source": "replicate",
            "model": model,
            "prediction_id": prediction_id,
            "aspect_ratio": aspect_ratio,
            "width": width,
            "height": height,
        }

    async def _placeholder_image(self, topic: str, prompt: str, aspect_ratio: str, width: int, height: int) -> dict:
        """Creates a simple placeholder when all providers are unavailable."""
        try:
            from PIL import Image, ImageDraw, ImageFont
            img = Image.new("RGB", (1200, 630), color=(30, 30, 50))
            draw = ImageDraw.Draw(img)
            draw.rectangle([0, 0, 1200, 630], fill=(20, 20, 40))
            draw.text((60, 280), topic[:60], fill=(200, 200, 255), font=None)
            filename = f"placeholder_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
            filepath = self._images_dir / filename
            img.save(str(filepath))
        except ImportError:
            filename = "placeholder.png"
            filepath = self._images_dir / filename
            filepath.write_bytes(b"")  # empty stub

        return {
            "type": "image",
            "topic": topic,
            "filepath": str(filepath),
            "filename": filename,
            "sd_prompt": prompt,
            "source": "placeholder",
            "aspect_ratio": aspect_ratio,
            "width": width,
            "height": height,
        }

    async def _generate_abacus(self, sd_prompt: str, negative_prompt: str, topic: str, aspect_ratio: str, width: int, height: int) -> dict:
        payload = {
            "model": self._abacus_image_model,
            "prompt": self._build_positive_prompt(sd_prompt),
            "negative_prompt": self._build_negative_prompt(negative_prompt),
            "size": f"{width}x{height}",
            "response_format": "b64_json",
        }
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                f"{self._abacus_api_url.rstrip('/')}/images/generations",
                headers={
                    "Authorization": f"Bearer {self._abacus_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        image_bytes = self._extract_abacus_image_bytes(data)
        filename = f"abacus_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
        local_path = self._images_dir / filename
        size = len(image_bytes)
        local_path.write_bytes(image_bytes)
        del image_bytes
        logger.debug(f"[ImageAgent] Freed {size:,} bytes of b64 image data from memory after writing {filename}")
        logger.success(f"[ImageAgent] Image saved via Abacus AI: {local_path}")
        storage_url = await _storage_upload("images", local_path, filename)
        return {
            "type": "image",
            "topic": topic,
            "filepath": str(local_path),
            "filename": filename,
            "storage_url": storage_url,
            "sd_prompt": sd_prompt,
            "negative_prompt": self._build_negative_prompt(negative_prompt),
            "source": "abacus",
            "aspect_ratio": aspect_ratio,
            "width": width,
            "height": height,
        }

    def _extract_abacus_image_bytes(self, data: dict[str, Any]) -> bytes:
        image_items = data.get("data") or data.get("images") or []
        if not image_items:
            raise RuntimeError("Abacus AI returned no images")
        first = image_items[0]
        if isinstance(first, dict):
            b64_value = first.get("b64_json") or first.get("base64") or first.get("image_base64")
            if b64_value:
                return base64.b64decode(b64_value)
            image_url = first.get("url") or first.get("image_url")
            if image_url:
                downloaded = httpx.get(str(image_url), timeout=120)
                downloaded.raise_for_status()
                return downloaded.content
        raise RuntimeError("Abacus AI returned an unsupported image payload")

    def _dimensions_for_ratio(self, aspect_ratio: str) -> tuple[int, int]:
        if str(aspect_ratio).strip() == "1:1":
            return (1024, 1024)
        if str(aspect_ratio).strip() == "9:16":
            return (
                int(get_setting("video", "portrait_width", "720")),
                int(get_setting("video", "portrait_height", "1280")),
            )
        return (
            int(get_setting("video", "landscape_width", "1280")),
            int(get_setting("video", "landscape_height", "720")),
        )

    def _normalize_prompt_text(self, generated: str, visual_prompt: str, style: str) -> str:
        prompt_text = (generated or "").strip()
        prompt_text = prompt_text.replace("**Prompt:**", "").replace("Prompt:", "").strip()
        if prompt_text.startswith("```"):
            prompt_text = prompt_text.strip("`").strip()
        if prompt_text:
            return self._sanitize_generated_prompt(prompt_text)
        return (
            f"{visual_prompt}, {style}, highly detailed, clean composition, cinematic lighting, "
            "professional editorial photography, sharp focus, natural colors, no text, no watermark"
        )

    def _build_positive_prompt(self, prompt_text: str) -> str:
        layers = [
            "no people, no humans, objects only, product photography, still life, concept art",
            "single coherent subject, realistic object relationships, grounded scene composition",
            SAFE_FOR_WORK_POSITIVE,
            self._sanitize_generated_prompt(prompt_text).strip(),
        ]
        return ", ".join(part for part in layers if part)

    def _build_negative_prompt(self, prompt_text: str) -> str:
        extra = str(prompt_text or "").strip()
        no_humans = "person, people, human, man, woman, boy, girl, face, hands, fingers, body, portrait, figure, character, anime, cartoon, illustration of person"
        return ", ".join(part for part in [no_humans, SAFE_FOR_WORK_NEGATIVE, extra] if part)

    def _contains_nsfw_risk(self, text: str) -> bool:
        lowered = str(text or "").lower()
        return any(term in lowered for term in NSFW_RISK_TERMS)

    def _sanitize_visual_prompt(self, visual_prompt: str, topic: str, style: str) -> str:
        text = str(visual_prompt or "").strip()
        if not self._contains_nsfw_risk(text):
            return text
        logger.warning("[ImageAgent] NSFW-risk prompt detected. Rewriting to a safe editorial interpretation.")
        safe_topic = str(topic or "brand").strip() or "brand"
        safe_style = str(style or "professional editorial").strip() or "professional editorial"
        return (
            f"safe-for-work editorial concept related to {safe_topic}, "
            f"{safe_style}, fully clothed subject presentation, professional brand-safe composition"
        )

    # Words that indicate a human subject — strip them from LLM-generated prompts
    _HUMAN_TERMS = re.compile(
        r'\b(person|people|man|men|woman|women|boy|girl|human|figure|portrait|face|'
        r'hands?|fingers?|body|character|individual|someone|anybody|worker|professional|'
        r'student|doctor|expert|coach|entrepreneur|athlete|he|she|his|her|him)\b',
        re.IGNORECASE,
    )

    def _strip_human_terms(self, prompt_text: str) -> str:
        """Remove human/person references from a generated SD prompt."""
        cleaned = self._HUMAN_TERMS.sub('', prompt_text)
        # Collapse multiple commas/spaces left behind
        cleaned = re.sub(r',\s*,', ',', cleaned)
        cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' ,')
        return cleaned

    def _sanitize_generated_prompt(self, prompt_text: str) -> str:
        text = str(prompt_text or "").strip()
        text = self._strip_human_terms(text)
        if not self._contains_nsfw_risk(text):
            return text
        logger.warning("[ImageAgent] NSFW-risk generated prompt detected. Enforcing brand-safe rewrite.")
        return (
            "professional editorial brand-safe concept image, clean objects, "
            "clean background, sharp focus, natural lighting, no text, no people"
        )
