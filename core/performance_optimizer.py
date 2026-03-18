"""
OpenClaw Performance Optimizer
Continuously monitors metrics and adjusts agent priorities / task routing.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from .orchestrator import OpenClaw


class PerformanceOptimizer:
    """Runs every N seconds, analyses metrics, emits strategy adjustments."""

    def __init__(self, orchestrator: "OpenClaw", interval_seconds: int = 300):
        self._oc = orchestrator
        self._interval = interval_seconds
        self._running = False
        self._recommendations: list[dict] = []

    async def start(self) -> None:
        self._running = True
        logger.info("PerformanceOptimizer started")
        while self._running:
            await asyncio.sleep(self._interval)
            await self._optimize()

    def stop(self) -> None:
        self._running = False

    async def _optimize(self) -> None:
        try:
            report = self._oc.router.performance_report()
            queue_stats = self._oc.queue.stats()
            recommendations = []

            for agent_id, perf in report.items():
                sr = perf["success_rate"]
                avg_ms = perf["avg_ms"]

                if sr < 0.5 and (perf["success"] + perf["fail"]) > 5:
                    recommendations.append({
                        "action": "reduce_load",
                        "agent": agent_id,
                        "reason": f"Success rate {sr:.0%} is below 50%",
                    })

                if avg_ms > 30_000:
                    recommendations.append({
                        "action": "check_timeout",
                        "agent": agent_id,
                        "reason": f"Average task time {avg_ms/1000:.1f}s is high",
                    })

            if queue_stats["pending"] > 20:
                recommendations.append({
                    "action": "scale_up",
                    "reason": f"{queue_stats['pending']} tasks queued — consider adding capacity",
                })

            self._recommendations = recommendations

            if recommendations:
                await self._oc.bus.emit_simple(
                    "optimizer.recommendations",
                    "performance_optimizer",
                    {"recommendations": recommendations, "timestamp": datetime.utcnow().isoformat()},
                )
                for r in recommendations:
                    logger.warning(f"[Optimizer] {r['action']}: {r['reason']}")
            else:
                logger.info("[Optimizer] All systems nominal")
        except Exception as e:
            logger.error(f"[Optimizer] Error during optimization cycle: {e}")

    def latest_recommendations(self) -> list[dict]:
        return self._recommendations
