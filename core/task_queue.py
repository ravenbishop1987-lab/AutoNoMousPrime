"""
OpenClaw Task Queue — Priority async queue with workload balancing
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum, Enum
from typing import Any, Optional

from loguru import logger


class TaskPriority(IntEnum):
    CRITICAL = 0
    HIGH = 1
    NORMAL = 2
    LOW = 3
    BACKGROUND = 4


class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    RETRYING = "retrying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Task:
    type: str                             # e.g. "blog_post", "image_gen", "tts", "video", "post"
    payload: dict[str, Any]
    priority: TaskPriority = TaskPriority.NORMAL
    agent_hint: Optional[str] = None      # preferred agent override
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    retries: int = 0
    max_retries: int = 3
    parent_id: Optional[str] = None       # for chained tasks
    assigned_agent_id: Optional[str] = None

    def __lt__(self, other: "Task") -> bool:
        return self.priority < other.priority

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "payload": self.payload,
            "priority": int(self.priority),
            "agent_hint": self.agent_hint,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "result": self.result,
            "error": self.error,
            "retries": self.retries,
            "max_retries": self.max_retries,
            "parent_id": self.parent_id,
            "assigned_agent_id": self.assigned_agent_id,
        }


class TaskQueue:
    """Priority queue with per-agent load balancing."""

    def __init__(self, max_concurrent: int = 5):
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._tasks: dict[str, Task] = {}
        self._agent_load: dict[str, int] = {}
        self._max_concurrent = max_concurrent
        self._running = 0
        self._lock = asyncio.Lock()
        self._slot_cond = asyncio.Condition()
        self._history: list[Task] = []

    async def enqueue(self, task: Task) -> str:
        task.status = TaskStatus.QUEUED
        self._tasks[task.id] = task
        # (priority, timestamp, task) — stable ordering
        await self._queue.put((task.priority, task.created_at.timestamp(), task))
        return task.id

    async def dequeue(self) -> Task:
        _, _, task = await self._queue.get()
        async with self._slot_cond:
            await self._slot_cond.wait_for(lambda: self._running < self._max_concurrent)
            task.status = TaskStatus.RUNNING
            task.started_at = datetime.utcnow()
            self._running += 1
        return task

    async def complete(self, task: Task, result: dict) -> None:
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        task.result = result
        async with self._slot_cond:
            self._running = max(0, self._running - 1)
            self._decrement_agent_load(task.assigned_agent_id)
            self._slot_cond.notify_all()
        self._history.append(task)

    async def defer(self, task: Task, delay_seconds: float = 2.0) -> None:
        """Put a running task back on the queue without counting it as a failure."""
        task.status = TaskStatus.QUEUED
        async with self._slot_cond:
            self._running = max(0, self._running - 1)
            self._decrement_agent_load(task.assigned_agent_id)
            self._slot_cond.notify_all()
        task.assigned_agent_id = None
        await asyncio.sleep(delay_seconds)
        await self._queue.put((task.priority, datetime.utcnow().timestamp(), task))

    async def fail(self, task: Task, error: str) -> bool:
        """Returns True if task was re-queued for retry, False if exhausted."""
        async with self._slot_cond:
            self._running = max(0, self._running - 1)
            self._decrement_agent_load(task.assigned_agent_id)
            self._slot_cond.notify_all()
        task.error = error
        task.retries += 1
        if task.retries <= task.max_retries:
            task.status = TaskStatus.RETRYING
            task.assigned_agent_id = None
            # Exponential backoff: attempt 1→5s, 2→30s, 3→120s
            _backoff = [5, 30, 120]
            delay = _backoff[min(task.retries - 1, len(_backoff) - 1)]
            logger.warning(
                f"[TaskQueue] Task {task.id[:8]} ({task.type}) failed "
                f"(attempt {task.retries}/{task.max_retries}) — retrying in {delay}s. Error: {error}"
            )
            await asyncio.sleep(delay)
            await self._queue.put((task.priority, task.created_at.timestamp(), task))
            return True
        task.status = TaskStatus.FAILED
        task.completed_at = datetime.utcnow()
        self._history.append(task)
        return False

    def agent_load(self, agent_id: str) -> int:
        return self._agent_load.get(agent_id, 0)

    def increment_agent_load(self, agent_id: str) -> None:
        self._agent_load[agent_id] = self._agent_load.get(agent_id, 0) + 1

    def _decrement_agent_load(self, agent_id: str | None) -> None:
        if not agent_id:
            return
        self._agent_load[agent_id] = max(0, self._agent_load.get(agent_id, 0) - 1)

    @property
    def running(self) -> int:
        return self._running

    @property
    def pending(self) -> int:
        return self._queue.qsize()

    def stats(self) -> dict:
        completed = [t for t in self._history if t.status == TaskStatus.COMPLETED]
        failed = [t for t in self._history if t.status == TaskStatus.FAILED]
        return {
            "pending": self.pending,
            "running": self._running,
            "completed": len(completed),
            "failed": len(failed),
            "agent_load": dict(self._agent_load),
        }

    def recent_tasks(self, limit: int = 20) -> list[dict]:
        return [t.to_dict() for t in self._history[-limit:]]

    def get_task(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def set_max_concurrent(self, value: int) -> None:
        self._max_concurrent = max(1, int(value))

    def cancel_by_job_id(self, job_id: str) -> int:
        cancelled = 0
        for task in self._tasks.values():
            if str(task.payload.get("job_id") or "").strip() != str(job_id or "").strip():
                continue
            if task.status in {TaskStatus.QUEUED, TaskStatus.PENDING, TaskStatus.RETRYING}:
                task.status = TaskStatus.CANCELLED
                task.completed_at = datetime.utcnow()
                self._history.append(task)
                cancelled += 1
        return cancelled
