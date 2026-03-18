"""
OpenClaw Router — Classifies tasks and selects the optimal agent
Uses LLM scoring + current agent load + historical performance
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from agents.base_agent import BaseAgent
    from .task_queue import Task

# Static map: task type → capable agents (in preference order)
TASK_AGENT_MAP: dict[str, list[str]] = {
    # Content generation
    "blog_post":        ["content_agent"],
    "seo_research":     ["content_agent"],
    "rewrite_post":     ["content_agent"],       # AI rewrite of social/blog copy
    # Image
    "image_gen":        ["image_agent"],
    "image_variation":  ["image_agent"],
    # Voice
    "tts":              ["voice_agent"],
    "voice_clone":      ["voice_agent"],
    # Video
    "video_caption":    ["video_agent"],
    "video_assemble":   ["video_agent"],
    # Distribution / publishing
    "post_content":     ["distribution_agent"],
    "video_publish":    ["distribution_agent"],
    "financial_report": ["distribution_agent"],
    "social_post":      ["distribution_agent"],  # quick social post (new post composer)
    "distribute_post":  ["distribution_agent"],  # approval-gated post (from publishing queue)
    "seo_track":        ["distribution_agent"],  # keyword rank tracking
    # Podcast
    "podcast_gen":      ["podcast_agent"],
    # Funnel / Ads / Analytics
    "funnel_gen":       ["funnel_agent"],
    "sales_page_gen":   ["funnel_agent"],
    "ads_gen":          ["ads_agent"],
    "analytics_gen":    ["analytics_agent"],
    # Products
    "product_ideate":   ["product_agent"],
    "product_create":   ["product_agent"],
    # Full pipeline
    "pipeline":         ["content_agent", "image_agent", "voice_agent", "video_agent", "distribution_agent"],
}


class Router:
    def __init__(self, agents: dict[str, "BaseAgent"]):
        self._agents = agents
        self._performance: dict[str, dict] = {aid: {"success": 0, "fail": 0, "avg_ms": 0.0}
                                               for aid in agents}

    def select_agent(self, task: "Task") -> "BaseAgent | None":
        # Honour explicit hint
        if task.agent_hint and task.agent_hint in self._agents:
            return self._agents[task.agent_hint]

        candidates = TASK_AGENT_MAP.get(task.type, list(self._agents.keys()))
        candidates = [c for c in candidates if c in self._agents]

        if not candidates:
            logger.warning(f"No agent found for task type '{task.type}'")
            return None

        # Score = success_rate × (1 / (1 + current_load))
        best, best_score = None, -1.0
        for aid in candidates:
            agent = self._agents[aid]
            perf = self._performance[aid]
            total = perf["success"] + perf["fail"]
            success_rate = perf["success"] / total if total > 0 else 1.0
            load_penalty = 1.0 / (1 + agent.current_load)
            score = success_rate * load_penalty
            if score > best_score:
                best, best_score = agent, score

        return best

    def record_success(self, agent_id: str, elapsed_ms: float) -> None:
        p = self._performance[agent_id]
        p["success"] += 1
        n = p["success"] + p["fail"]
        p["avg_ms"] = (p["avg_ms"] * (n - 1) + elapsed_ms) / n

    def record_failure(self, agent_id: str) -> None:
        self._performance[agent_id]["fail"] += 1

    def performance_report(self) -> dict:
        return {
            aid: {
                **perf,
                "success_rate": (
                    perf["success"] / (perf["success"] + perf["fail"])
                    if (perf["success"] + perf["fail"]) > 0 else 1.0
                ),
            }
            for aid, perf in self._performance.items()
        }
