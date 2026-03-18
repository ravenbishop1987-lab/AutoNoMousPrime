"""
Base Agent — Abstract foundation for all Autonomous Prime agents
"""
from __future__ import annotations

import asyncio
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, TYPE_CHECKING

from loguru import logger

from core.skill_loader import load_skill_packs, render_skill_context

if TYPE_CHECKING:
    from core.task_queue import Task
    from core.llm_client import LLMClient


class NonRetryableError(Exception):
    """
    Raise this from _execute() for permanent failures that should NOT be retried.
    Examples: missing required field, invalid config, auth rejected, content policy block.
    The orchestrator will exhaust retries immediately when it catches this.
    """


# Exception types that indicate transient / infrastructure failures worth retrying.
# Anything not in this list that propagates out of _execute() will be retried by
# the task queue's normal backoff logic.
_TRANSIENT_BASE = (
    ConnectionError,
    TimeoutError,
    OSError,
)
try:
    import httpx as _httpx
    _TRANSIENT_HTTPX = (_httpx.TimeoutException, _httpx.ConnectError, _httpx.RemoteProtocolError)
except ImportError:
    _TRANSIENT_HTTPX = ()  # type: ignore

TRANSIENT_EXCEPTIONS: tuple = _TRANSIENT_BASE + _TRANSIENT_HTTPX


@dataclass
class AgentMetrics:
    tasks_run: int = 0
    tasks_ok: int = 0
    tasks_failed: int = 0
    total_ms: float = 0.0
    last_run: datetime | None = None

    @property
    def success_rate(self) -> float:
        return self.tasks_ok / self.tasks_run if self.tasks_run else 1.0

    @property
    def avg_ms(self) -> float:
        return self.total_ms / self.tasks_run if self.tasks_run else 0.0


class BaseAgent(ABC):
    """All agents inherit from this. Provides metrics, concurrency control, and lifecycle."""

    def __init__(self, agent_id: str, llm: "LLMClient", max_concurrent: int = 3):
        self.agent_id = agent_id
        self.llm = llm
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._metrics = AgentMetrics()
        self._outputs_dir = os.getenv("OUTPUTS_DIR", "./outputs")
        self._profile_dir, self._skill_packs = load_skill_packs(agent_id)

    @property
    def current_load(self) -> int:
        return self._max_concurrent - self._semaphore._value

    @abstractmethod
    async def _execute(self, task: "Task") -> dict[str, Any]:
        """Core task logic. Implemented by each agent."""
        ...

    @abstractmethod
    def skill_summary(self) -> dict:
        """Returns a brief description of the agent's capabilities."""
        ...

    async def run(self, task: "Task") -> dict[str, Any]:
        async with self._semaphore:
            start = asyncio.get_event_loop().time()
            self._metrics.tasks_run += 1
            self._metrics.last_run = datetime.utcnow()
            try:
                result = await self._execute(task)
                self._metrics.tasks_ok += 1
                elapsed = (asyncio.get_event_loop().time() - start) * 1000
                self._metrics.total_ms += elapsed
                logger.debug(f"[{self.agent_id}] Task {task.id[:8]} done in {elapsed:.0f}ms")
                return result
            except NonRetryableError:
                # Permanent failure — exhaust retries immediately so the orchestrator
                # does not re-queue this task.
                self._metrics.tasks_failed += 1
                task.retries = task.max_retries
                raise
            except Exception as exc:
                self._metrics.tasks_failed += 1
                # If the error is NOT a known transient type, treat it as non-retryable
                # to avoid burning retries on bugs, missing fields, or auth failures.
                if not isinstance(exc, TRANSIENT_EXCEPTIONS):
                    logger.warning(
                        f"[{self.agent_id}] Task {task.id[:8]} raised non-transient "
                        f"{type(exc).__name__} — exhausting retries: {exc}"
                    )
                    task.retries = task.max_retries
                raise

    def metrics(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "tasks_run": self._metrics.tasks_run,
            "tasks_ok": self._metrics.tasks_ok,
            "tasks_failed": self._metrics.tasks_failed,
            "success_rate": round(self._metrics.success_rate, 3),
            "avg_ms": round(self._metrics.avg_ms, 1),
            "last_run": self._metrics.last_run.isoformat() if self._metrics.last_run else None,
            "current_load": self.current_load,
        }

    def skill_context(self, task_type: str | None = None) -> str:
        return render_skill_context(self.agent_id, task_type)

    def skill_inventory(self) -> list[dict[str, Any]]:
        return [
            {
                "name": pack.name,
                "path": str(pack.path),
                "task_types": pack.task_types,
            }
            for pack in self._skill_packs
        ]

    def refresh_settings(self) -> None:
        """Reload runtime configuration after settings changes."""
        return None
