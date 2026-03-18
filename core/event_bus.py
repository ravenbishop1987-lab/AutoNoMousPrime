"""
OpenClaw Event Bus — Internal pub/sub for agent ↔ orchestrator communication
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Coroutine


@dataclass
class Event:
    type: str
    source: str
    data: dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)


Handler = Callable[[Event], Coroutine]


class EventBus:
    def __init__(self):
        self._handlers: dict[str, list[Handler]] = defaultdict(list)
        self._history: list[Event] = []
        self._max_history = 500

    def subscribe(self, event_type: str, handler: Handler) -> None:
        self._handlers[event_type].append(handler)

    def unsubscribe(self, event_type: str, handler: Handler) -> None:
        self._handlers[event_type] = [
            h for h in self._handlers[event_type] if h != handler
        ]

    async def emit(self, event: Event) -> None:
        self._history.append(event)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]
        handlers = self._handlers.get(event.type, []) + self._handlers.get("*", [])
        if handlers:
            await asyncio.gather(*[h(event) for h in handlers], return_exceptions=True)

    async def emit_simple(self, event_type: str, source: str, data: dict) -> None:
        await self.emit(Event(type=event_type, source=source, data=data))

    def recent(self, limit: int = 50, event_type: str | None = None) -> list[dict]:
        events = self._history
        if event_type:
            events = [e for e in events if e.type == event_type]
        return [
            {
                "type": e.type,
                "source": e.source,
                "data": e.data,
                "timestamp": e.timestamp.isoformat(),
            }
            for e in events[-limit:]
        ]
