"""
OpenClaw LLM client.
Supports OpenAI (primary), Ollama (local), and Abacus with explicit provider mode control.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

# ── LLM response cache ────────────────────────────────────────────────────────
_CACHE_DIR = Path("data/llm_cache")


def _cache_key(prompt: str, system: str, max_tokens: int) -> str:
    payload = json.dumps({"prompt": prompt, "system": system, "max_tokens": max_tokens},
                         ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _read_cache(key: str, ttl_hours: float) -> str | None:
    path = _CACHE_DIR / f"{key}.txt"
    if not path.exists():
        return None
    age_seconds = time.time() - path.stat().st_mtime
    if age_seconds > ttl_hours * 3600:
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _write_cache(key: str, value: str) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        (_CACHE_DIR / f"{key}.txt").write_text(value, encoding="utf-8")
    except OSError as exc:
        logger.warning(f"[LLMCache] Could not write cache entry: {exc}")

PREFERRED_OLLAMA_MODELS = [
    "qwen3:8b",
    "qwen2.5:7b-instruct",
    "qwen2.5:14b",
    "qwen3:14b",
    "gpt-oss:20b",
    "gpt-oss:latest",
    "qwen3-coder:latest",
]


class LLMClient:
    def __init__(
        self,
        openai_api_key: str = "",
        openai_model: str = "gpt-4o",
        ollama_url: str = "http://localhost:11434",
        ollama_model: str = "llama3.2",
        provider_mode: str = "hybrid",
        prefer_local: bool = False,
    ):
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY", "")
        self.openai_model = openai_model or os.getenv("OPENAI_MODEL", "gpt-4o")
        self.openai_api_url = os.getenv("OPENAI_API_URL", "https://api.openai.com/v1")
        self.ollama_url = ollama_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.ollama_model = ollama_model or os.getenv("OLLAMA_MODEL", "llama3")
        self.provider_mode = (provider_mode or os.getenv("LLM_MODE", "hybrid")).strip().lower()
        self.prefer_local = prefer_local
        self._resolved_ollama_model: Optional[str] = None

    def refresh_settings(self) -> None:
        self.openai_api_key = os.getenv("OPENAI_API_KEY", self.openai_api_key)
        self.openai_model = os.getenv("OPENAI_MODEL", self.openai_model)
        self.openai_api_url = os.getenv("OPENAI_API_URL", self.openai_api_url)
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", self.ollama_url)
        self.ollama_model = os.getenv("OLLAMA_MODEL", self.ollama_model)
        self.provider_mode = os.getenv("LLM_MODE", self.provider_mode).strip().lower()
        self._resolved_ollama_model = None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def complete(
        self,
        prompt: str,
        system: str = "",
        max_tokens: int = 4096,
        use_local: bool = False,
        json_mode: bool = False,
        cache: bool = False,
        cache_ttl_hours: float = 24.0,
    ) -> str:
        if cache:
            key = _cache_key(prompt, system, max_tokens)
            cached = _read_cache(key, cache_ttl_hours)
            if cached is not None:
                logger.debug(f"[LLMCache] Hit {key[:12]}…")
                return cached

        errors: list[str] = []
        for provider in self._provider_order(use_local):
            if provider == "openai" and not self.openai_api_key:
                continue
            try:
                if provider == "ollama":
                    result = await self._ollama(prompt, system, max_tokens, json_mode)
                elif provider == "openai":
                    result = await self._openai(prompt, system, max_tokens, json_mode)
                else:
                    continue
                if cache:
                    _write_cache(key, result)
                return result
            except Exception as exc:
                logger.warning(f"{provider.title()} failed ({exc})")
                errors.append(f"{provider}: {exc}")
        raise RuntimeError(f"All LLM providers failed: {'; '.join(errors) or 'no configured providers'}")

    def _provider_order(self, use_local: bool) -> list[str]:
        if use_local or self.prefer_local or self.provider_mode == "local":
            return ["ollama", "openai"]
        if self.provider_mode in {"remote", "cloud"}:
            return ["openai", "ollama"]
        # hybrid: openai first if key set
        order: list[str] = []
        if self.openai_api_key:
            order.append("openai")
        order.append("ollama")
        return order

    async def _openai(self, prompt: str, system: str, max_tokens: int, json_mode: bool) -> str:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload: dict[str, Any] = {
            "model": self.openai_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        timeout = max(60, min(300, max_tokens // 8 if max_tokens else 60))
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self.openai_api_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI returned no choices")
        content = choices[0].get("message", {}).get("content", "")
        if isinstance(content, list):
            return "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return str(content)

    async def _ollama(self, prompt: str, system: str, max_tokens: int, json_mode: bool) -> str:
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        model_name = await self._resolve_ollama_model()
        payload: dict[str, Any] = {
            "model": model_name,
            "prompt": full_prompt,
            "stream": False,
            "options": {"num_predict": max_tokens},
        }
        if json_mode:
            payload["format"] = "json"
        timeout_seconds = max(120, min(600, max_tokens // 8 if max_tokens else 120))
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.post(f"{self.ollama_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "")

    async def _resolve_ollama_model(self) -> str:
        if self._resolved_ollama_model:
            return self._resolved_ollama_model

        configured = self.ollama_model
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{self.ollama_url}/api/tags")
            resp.raise_for_status()
            models = [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]

        if configured in models:
            self._resolved_ollama_model = configured
            return configured

        configured_base = configured.split(":", 1)[0]
        for name in models:
            if name == configured_base or name.split(":", 1)[0] == configured_base:
                self._resolved_ollama_model = name
                logger.warning(f"Ollama model '{configured}' not found, using '{name}'")
                return name

        for preferred in PREFERRED_OLLAMA_MODELS:
            if preferred in models:
                self._resolved_ollama_model = preferred
                logger.warning(f"Ollama model '{configured}' not found, using preferred installed model '{preferred}'")
                return preferred

        if models:
            self._resolved_ollama_model = models[0]
            logger.warning(f"Ollama model '{configured}' not found, using installed model '{models[0]}'")
            return models[0]

        raise RuntimeError(
            f"No Ollama models are installed at {self.ollama_url}. Configure OLLAMA_MODEL or pull a model first."
        )

    async def complete_json(
        self,
        prompt: str,
        system: str = "",
        use_local: bool = False,
        max_tokens: int = 8192,
        cache: bool = False,
        cache_ttl_hours: float = 24.0,
    ) -> dict:
        raw = await self.complete(
            prompt, system,
            max_tokens=max_tokens, json_mode=True, use_local=use_local,
            cache=cache, cache_ttl_hours=cache_ttl_hours,
        )
        raw = raw.strip()

        # Strip markdown code fences
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
            raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)
            raw = raw.strip()

        # Direct parse
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # Depth-counting bracket extraction — handles truncated responses
        for open_ch, close_ch in [('{', '}'), ('[', ']')]:
            start = raw.find(open_ch)
            if start == -1:
                continue
            depth = 0
            in_string = False
            escape_next = False
            for i, ch in enumerate(raw[start:], start):
                if escape_next:
                    escape_next = False
                    continue
                if ch == '\\' and in_string:
                    escape_next = True
                    continue
                if ch == '"':
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        candidate = raw[start:i + 1]
                        try:
                            return json.loads(candidate)
                        except json.JSONDecodeError:
                            break

        # Last resort: strip trailing commas then retry
        cleaned = re.sub(r",\s*([}\]])", r"\1", raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        raise ValueError(f"Could not parse JSON from LLM response: {raw[:300]}")
