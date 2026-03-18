from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

SETTINGS_FILE = Path("data/settings.json")
SECRET_MASK = "****"

DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    "openclaw": {
        "ollama_url": "http://localhost:11434",  # default, always this
        "ollama_model": "llama3",
        "claude_api_key": "",
        "claude_model": "claude-sonnet-4-6",
        "groq_api_url": "https://api.groq.com/openai/v1",
        "groq_api_key": "",
        "groq_model": "llama-3.1-8b-instant",
        "mode": "auto",
        "max_concurrent_tasks": "2",
    },
    "wordpress": {
        "url": "",
        "username": "",
        "app_password": "",
        "default_category": "Uncategorized",
        "category_map": "",
    },
    "tool_routing": {
        "image_mode": "cloud",
        "voice_mode": "edge-tts",
    },
    "comfyui": {
        "url": "http://localhost:8188",
        "positive_prompt_prefix": "highly detailed, anatomically correct, realistic proportions, coherent subject, clean composition, natural lighting, sharp focus, professional editorial photography, safe-for-work, fully clothed, non-sexual, non-erotic, PG-rated",
        "negative_prompt": "blurry, low quality, watermark, text, nsfw, nude, nudity, naked, erotic, sexual, explicit, fetish, porn, lingerie, underwear, bikini, swimsuit, cleavage focus, nipple, areola, thong, transparent clothing, cameltoe, butt focus, crotch focus, suggestive pose, ugly, deformed, malformed, detached body parts, duplicate subject, extra limbs, extra head, cropped head, severed head, floating objects, mutated anatomy, bad paws, bad hands, distorted face",
    },
    "coqui": {
        "url": "http://localhost:5002",
        "model": "tts_models/multilingual/multi-dataset/xtts_v2",
        "language": "en",
        "speaker": "",
        "speaker_wav": "",
    },
    "elevenlabs": {
        "enabled": "false",
        "api_url": "https://api.elevenlabs.io",
        "api_key": "",
        "voice_id": "",
        "model_id": "eleven_multilingual_v2",
        "output_format": "mp3_44100_128",
    },
    "edge_tts": {
        "voice": "en-US-AriaNeural",
        "speed": "1.0",
        "lang_code": "a",
    },
    "deepgram": {
        "enabled": "false",
        "api_url": "https://api.deepgram.com",
        "api_key": "",
        "model": "nova-3",
        "language": "en",
        "smart_format": "true",
        "burn_in": "false",
    },
    "abacus": {
        "enabled": "false",
        "api_url": "https://apps.abacus.ai/v1",
        "api_key": "",
        "llm_model": "gpt-4.1-mini",
        "image_model": "flux.1-schnell",
    },
    "ffmpeg": {
        "path": "ffmpeg",
        "ffprobe_path": "ffprobe",
    },
    "serpapi": {
        "key": "",
    },
    "commerce": {
        "api_url": "http://localhost:3010",
        "site_url": "http://localhost:5173",
    },
    "social_calendar": {
        "sheet_url": "",
    },
    "social_scheduler": {
        "posting_times_est": "9:00 AM, 1:00 PM, 5:00 PM",
        "max_posts_per_day": "4",
        "max_per_platform_per_day": "2",
        "min_gap_minutes": "90",
    },
    "prompts": {
        "autonomous_prime_system": "",
        "content_blog_system": "",
        "content_seo_research_prompt": "",
        "image_prompt_system": "",
        "voice_narration_prompt": "",
        "video_storyboard_prompt": "",
        "distribution_social_prompt": "",
        "chat_planner_prompt": "",
    },
    "approvals": {
        "require_social_approval": "true",
        "require_video_approval": "true",
    },
    "automation": {
        "require_social_approval": "true",
        "require_video_approval": "true",
        "auto_publish_blog": "false",
        "dynamic_topics": "false",
        "daily_topic_niche": "",
        "daily_topic_keywords": "",
        "daily_topic_count": "3",
        "preset_topics": "",
    },
    "comment_reply": {
        "enabled": "false",
        "platforms": "",
        "tone": "friendly",
        "brand_name": "",
        "custom_instructions": "",
        "poll_interval_minutes": "15",
        "max_replies_per_poll": "10",
        "skip_keywords": "spam,promo,buy,click here",
        "min_comment_length": "5",
    },
    "video": {
        "default_aspect_ratio": "16:9",
        "landscape_width": "1280",
        "landscape_height": "720",
        "portrait_width": "720",
        "portrait_height": "1280",
        "publish_to_youtube": "true",
        "publish_to_tiktok": "true",
        "publish_to_instagram": "true",
    },
    "x": {
        "enabled": "false",
        "post_url": "",
        "access_token": "",
        "account_id": "",
        "twitter_bearer_token": "",
        "twitter_api_key": "",
    },
    "facebook": {
        "enabled": "false",
        "post_url": "",
        "access_token": "",
        "page_id": "",
    },
    "facebook_groups": {
        "enabled": "false",
        "post_url": "",
        "access_token": "",
        "group_id": "",
    },
    "linkedin": {
        "enabled": "false",
        "post_url": "",
        "access_token": "",
        "author_id": "",
        "author_urn": "",
    },
    "instagram_posts": {
        "enabled": "false",
        "post_url": "",
        "access_token": "",
        "account_id": "",
        "media_type": "IMAGE",
    },
    "youtube": {
        "enabled": "false",
        "upload_url": "",
        "access_token": "",
        "channel_id": "",
        "privacy_status": "private",
    },
    "tiktok": {
        "enabled": "false",
        "upload_url": "",
        "access_token": "",
        "creator_id": "",
        "privacy_status": "private",
    },
    "instagram": {
        "enabled": "false",
        "upload_url": "",
        "access_token": "",
        "account_id": "",
        "media_type": "REELS",
    },
    "reddit": {
        "enabled": "false",
        "client_id": "",
        "client_secret": "",
        "username": "",
        "password": "",
        "subreddit": "",
        "post_type": "link",
    },
    "threads": {
        "enabled": "false",
        "access_token": "",
        "user_id": "",
    },
}

ENV_MAP: dict[tuple[str, str], str] = {
    ("openclaw", "ollama_url"): "OLLAMA_BASE_URL",
    ("openclaw", "ollama_model"): "OLLAMA_MODEL",
    ("openclaw", "claude_api_key"): "ANTHROPIC_API_KEY",
    ("openclaw", "claude_model"): "CLAUDE_MODEL",
    ("openclaw", "groq_api_url"): "GROQ_API_URL",
    ("openclaw", "groq_api_key"): "GROQ_API_KEY",
    ("openclaw", "groq_model"): "GROQ_MODEL",
    ("openclaw", "mode"): "LLM_MODE",
    ("openclaw", "max_concurrent_tasks"): "MAX_CONCURRENT_TASKS",
    ("wordpress", "url"): "WP_URL",
    ("wordpress", "username"): "WP_USER",
    ("wordpress", "app_password"): "WP_APP_PASSWORD",
    ("wordpress", "default_category"): "WP_DEFAULT_CATEGORY",
    ("wordpress", "category_map"): "WP_CATEGORY_MAP",
    ("tool_routing", "image_mode"): "TOOL_IMAGE_MODE",
    ("tool_routing", "voice_mode"): "TOOL_VOICE_MODE",
    ("comfyui", "url"): "COMFYUI_URL",
    ("comfyui", "positive_prompt_prefix"): "COMFYUI_POSITIVE_PROMPT_PREFIX",
    ("comfyui", "negative_prompt"): "COMFYUI_NEGATIVE_PROMPT",
    ("coqui", "url"): "COQUI_URL",
    ("coqui", "model"): "COQUI_MODEL",
    ("coqui", "language"): "COQUI_LANGUAGE",
    ("coqui", "speaker"): "COQUI_SPEAKER",
    ("coqui", "speaker_wav"): "COQUI_SPEAKER_WAV",
    ("elevenlabs", "enabled"): "ELEVENLABS_ENABLED",
    ("elevenlabs", "api_url"): "ELEVENLABS_API_URL",
    ("elevenlabs", "api_key"): "ELEVENLABS_API_KEY",
    ("elevenlabs", "voice_id"): "ELEVENLABS_VOICE_ID",
    ("elevenlabs", "model_id"): "ELEVENLABS_MODEL_ID",
    ("elevenlabs", "output_format"): "ELEVENLABS_OUTPUT_FORMAT",
    ("edge_tts", "voice"): "EDGE_TTS_VOICE",
    ("edge_tts", "speed"): "EDGE_TTS_SPEED",
    ("edge_tts", "lang_code"): "EDGE_TTS_LANG_CODE",
    ("deepgram", "enabled"): "DEEPGRAM_ENABLED",
    ("deepgram", "api_url"): "DEEPGRAM_API_URL",
    ("deepgram", "api_key"): "DEEPGRAM_API_KEY",
    ("deepgram", "model"): "DEEPGRAM_MODEL",
    ("deepgram", "language"): "DEEPGRAM_LANGUAGE",
    ("deepgram", "smart_format"): "DEEPGRAM_SMART_FORMAT",
    ("deepgram", "burn_in"): "DEEPGRAM_BURN_IN",
    ("abacus", "enabled"): "ABACUS_ENABLED",
    ("abacus", "api_url"): "ABACUS_API_URL",
    ("abacus", "api_key"): "ABACUS_API_KEY",
    ("abacus", "llm_model"): "ABACUS_LLM_MODEL",
    ("abacus", "image_model"): "ABACUS_IMAGE_MODEL",
    ("ffmpeg", "path"): "FFMPEG_PATH",
    ("ffmpeg", "ffprobe_path"): "FFPROBE_PATH",
    ("serpapi", "key"): "SERPAPI_KEY",
    ("commerce", "api_url"): "COMMERCE_API_URL",
    ("commerce", "site_url"): "COMMERCE_SITE_URL",
    ("social_calendar", "sheet_url"): "SOCIAL_CALENDAR_SHEET_URL",
    ("social_scheduler", "posting_times_est"): "SOCIAL_SCHEDULER_POSTING_TIMES_EST",
    ("social_scheduler", "max_posts_per_day"): "SOCIAL_SCHEDULER_MAX_POSTS_PER_DAY",
    ("social_scheduler", "max_per_platform_per_day"): "SOCIAL_SCHEDULER_MAX_PER_PLATFORM_PER_DAY",
    ("social_scheduler", "min_gap_minutes"): "SOCIAL_SCHEDULER_MIN_GAP_MINUTES",
    ("video", "default_aspect_ratio"): "VIDEO_DEFAULT_ASPECT_RATIO",
    ("video", "landscape_width"): "VIDEO_LANDSCAPE_WIDTH",
    ("video", "landscape_height"): "VIDEO_LANDSCAPE_HEIGHT",
    ("video", "portrait_width"): "VIDEO_PORTRAIT_WIDTH",
    ("video", "portrait_height"): "VIDEO_PORTRAIT_HEIGHT",
    ("video", "publish_to_youtube"): "PUBLISH_TO_YOUTUBE",
    ("video", "publish_to_tiktok"): "PUBLISH_TO_TIKTOK",
    ("video", "publish_to_instagram"): "PUBLISH_TO_INSTAGRAM",
    ("x", "enabled"): "X_ENABLED",
    ("x", "post_url"): "X_POST_URL",
    ("x", "access_token"): "X_ACCESS_TOKEN",
    ("x", "account_id"): "X_ACCOUNT_ID",
    ("x", "twitter_bearer_token"): "TWITTER_BEARER_TOKEN",
    ("x", "twitter_api_key"): "TWITTER_API_KEY",
    ("facebook", "enabled"): "FACEBOOK_ENABLED",
    ("facebook", "post_url"): "FACEBOOK_POST_URL",
    ("facebook", "access_token"): "FACEBOOK_ACCESS_TOKEN",
    ("facebook", "page_id"): "FACEBOOK_PAGE_ID",
    ("facebook_groups", "enabled"): "FACEBOOK_GROUPS_ENABLED",
    ("facebook_groups", "post_url"): "FACEBOOK_GROUPS_POST_URL",
    ("facebook_groups", "access_token"): "FACEBOOK_GROUPS_ACCESS_TOKEN",
    ("facebook_groups", "group_id"): "FACEBOOK_GROUPS_GROUP_ID",
    ("linkedin", "enabled"): "LINKEDIN_ENABLED",
    ("linkedin", "post_url"): "LINKEDIN_POST_URL",
    ("linkedin", "access_token"): "LINKEDIN_ACCESS_TOKEN",
    ("linkedin", "author_id"): "LINKEDIN_AUTHOR_ID",
    ("linkedin", "author_urn"): "LINKEDIN_AUTHOR_URN",
    ("instagram_posts", "enabled"): "INSTAGRAM_POSTS_ENABLED",
    ("instagram_posts", "post_url"): "INSTAGRAM_POSTS_POST_URL",
    ("instagram_posts", "access_token"): "INSTAGRAM_POSTS_ACCESS_TOKEN",
    ("instagram_posts", "account_id"): "INSTAGRAM_POSTS_ACCOUNT_ID",
    ("instagram_posts", "media_type"): "INSTAGRAM_POSTS_MEDIA_TYPE",
    ("youtube", "enabled"): "YOUTUBE_ENABLED",
    ("youtube", "upload_url"): "YOUTUBE_UPLOAD_URL",
    ("youtube", "access_token"): "YOUTUBE_ACCESS_TOKEN",
    ("youtube", "channel_id"): "YOUTUBE_CHANNEL_ID",
    ("youtube", "privacy_status"): "YOUTUBE_PRIVACY_STATUS",
    ("tiktok", "enabled"): "TIKTOK_ENABLED",
    ("tiktok", "upload_url"): "TIKTOK_UPLOAD_URL",
    ("tiktok", "access_token"): "TIKTOK_ACCESS_TOKEN",
    ("tiktok", "creator_id"): "TIKTOK_CREATOR_ID",
    ("tiktok", "privacy_status"): "TIKTOK_PRIVACY_STATUS",
    ("instagram", "enabled"): "INSTAGRAM_ENABLED",
    ("instagram", "upload_url"): "INSTAGRAM_UPLOAD_URL",
    ("instagram", "access_token"): "INSTAGRAM_ACCESS_TOKEN",
    ("instagram", "account_id"): "INSTAGRAM_ACCOUNT_ID",
    ("instagram", "media_type"): "INSTAGRAM_MEDIA_TYPE",
    ("reddit", "enabled"): "REDDIT_ENABLED",
    ("reddit", "client_id"): "REDDIT_CLIENT_ID",
    ("reddit", "client_secret"): "REDDIT_CLIENT_SECRET",
    ("reddit", "username"): "REDDIT_USERNAME",
    ("reddit", "password"): "REDDIT_PASSWORD",
    ("reddit", "subreddit"): "REDDIT_SUBREDDIT",
    ("reddit", "post_type"): "REDDIT_POST_TYPE",
    ("threads", "enabled"): "THREADS_ENABLED",
    ("threads", "access_token"): "THREADS_ACCESS_TOKEN",
    ("threads", "user_id"): "THREADS_USER_ID",
}

SECRET_KEYS = {
    ("openclaw", "claude_api_key"),
    ("openclaw", "groq_api_key"),
    ("elevenlabs", "api_key"),
    ("deepgram", "api_key"),
    ("abacus", "api_key"),
    ("wordpress", "app_password"),
    ("serpapi", "key"),
    ("x", "access_token"),
    ("x", "twitter_bearer_token"),
    ("x", "twitter_api_key"),
    ("facebook", "access_token"),
    ("facebook_groups", "access_token"),
    ("linkedin", "access_token"),
    ("instagram_posts", "access_token"),
    ("youtube", "access_token"),
    ("tiktok", "access_token"),
    ("instagram", "access_token"),
    ("reddit", "client_secret"),
    ("reddit", "password"),
    ("threads", "access_token"),
}

# Substrings that indicate a settings key likely holds a credential.
# Used as a fallback for keys not explicitly listed in SECRET_KEYS.
_SECRET_SUBSTRINGS = frozenset(("key", "secret", "password", "token"))


def _is_secret(section: str, key: str) -> bool:
    """Return True if this (section, key) pair looks like a credential."""
    return (section, key) in SECRET_KEYS or any(sub in key.lower() for sub in _SECRET_SUBSTRINGS)


def mask_secret(value: str) -> str:
    if not value:
        return ""
    return value[:4] + SECRET_MASK if len(value) > 4 else SECRET_MASK


def _settings_file_for_user(user_id: str | None = None) -> Path:
    raw_user_id = str(user_id or "").strip()
    if raw_user_id:
        safe_user_id = "".join(ch for ch in raw_user_id if ch.isalnum() or ch in {"-", "_"})
        return Path("data") / "users" / safe_user_id / "settings.json"
    # No user_id — use global settings if it exists, otherwise fall back to the
    # most recently modified per-user settings file (single-tenant local deployment)
    if SETTINGS_FILE.exists():
        return SETTINGS_FILE
    user_files = sorted(
        Path("data/users").glob("*/settings.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ) if Path("data/users").exists() else []
    return user_files[0] if user_files else SETTINGS_FILE


def load_settings(mask_secrets: bool = False, user_id: str | None = None) -> dict[str, dict[str, Any]]:
    settings = deepcopy(DEFAULT_SETTINGS)
    for (section, key), env_name in ENV_MAP.items():
        env_value = os.getenv(env_name)
        if env_value not in (None, ""):
            settings[section][key] = env_value

    settings_file = _settings_file_for_user(user_id)

    if settings_file.exists():
        try:
            saved = json.loads(settings_file.read_text(encoding="utf-8"))
        except Exception:
            saved = {}
        for section, values in saved.items():
            if section not in settings or not isinstance(values, dict):
                continue
            settings[section].update(values)

    if mask_secrets:
        masked = deepcopy(settings)
        for section, key in SECRET_KEYS:
            value = str(masked.get(section, {}).get(key, "") or "")
            masked[section][key] = mask_secret(value)
        return masked
    return settings


def save_settings(data: dict[str, dict[str, Any]], user_id: str | None = None) -> None:
    existing = load_settings(mask_secrets=False, user_id=user_id)
    for section, values in data.items():
        if section not in existing or not isinstance(values, dict):
            continue
        for key, value in values.items():
            if isinstance(value, str) and SECRET_MASK in value:
                continue
            existing[section][key] = value
    settings_file = _settings_file_for_user(user_id)
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")


def apply_settings_to_env(user_id: str | None = None) -> None:
    # ── Step 1: read the raw on-disk settings.json (no env merging yet) ──────
    # This lets us warn about secrets stored there without being confused by
    # values that actually came from os.environ.
    settings_file = _settings_file_for_user(user_id)
    raw_saved: dict = {}
    if settings_file.exists():
        try:
            raw_saved = json.loads(settings_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    for (section, key) in SECRET_KEYS:
        raw_value = str(raw_saved.get(section, {}).get(key, "") or "")
        if raw_value and SECRET_MASK not in raw_value:
            env_name = ENV_MAP.get((section, key), f"{section}.{key}")
            _log.warning(
                "WARNING: %s (%s.%s) found in settings.json — "
                "move to .env for security. settings.json should only "
                "store non-sensitive config (UI preferences, feature flags, "
                "intervals). API keys, tokens, and passwords belong in .env.",
                env_name, section, key,
            )

    # ── Step 2: apply merged settings to os.environ ───────────────────────────
    # For secret keys: if the env var is already set (meaning .env or the shell
    # provided it), do NOT let settings.json override it — .env takes precedence.
    settings = load_settings(mask_secrets=False, user_id=user_id)
    for (section, key), env_name in ENV_MAP.items():
        value = settings.get(section, {}).get(key)
        if value in (None, ""):
            continue
        if _is_secret(section, key) and os.environ.get(env_name, ""):
            # .env already set this credential — keep it, ignore settings.json
            continue
        os.environ[env_name] = str(value)


def get_setting(section: str, key: str, default: Any = None, user_id: str | None = None) -> Any:
    return load_settings(mask_secrets=False, user_id=user_id).get(section, {}).get(key, default)


def as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
