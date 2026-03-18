"""
OpenClaw Orchestrator — The central brain of Autonomous Prime
Routes tasks → agents, manages lifecycle, drives continuous optimization.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime
from typing import Any, Optional

from loguru import logger

from .event_bus import EventBus
from .llm_client import LLMClient
from .performance_optimizer import PerformanceOptimizer
from .router import Router
from .runtime_settings import get_setting
from .task_queue import Task, TaskPriority, TaskQueue, TaskStatus

from agents.base_agent import NonRetryableError as _BaseNonRetryable

try:
    from agents.voice_agent import _NonRetryableError as _VoiceNonRetryable
except Exception:
    _VoiceNonRetryable = None  # type: ignore

try:
    from agents.video_agent import _NonRetryableError as _VideoNonRetryable
except Exception:
    _VideoNonRetryable = None  # type: ignore


class OpenClaw:
    """
    OpenClaw is the workflow brain.
    - Accepts task submissions from schedulers, APIs, and webhooks
    - Routes tasks to the best available agent via Router
    - Monitors results and feeds PerformanceOptimizer
    - Publishes all events on EventBus for the dashboard
    """

    def __init__(
        self,
        agents: dict | None = None,
        max_concurrent: int = 5,
        optimizer_interval: int = 300,
    ):
        self.bus = EventBus()
        self.queue = TaskQueue(max_concurrent=max_concurrent)
        self.llm = LLMClient(
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            ollama_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            ollama_model=os.getenv("OLLAMA_MODEL", "llama3"),
        )
        self._agents: dict = agents or {}
        self.router = Router(self._agents)
        self.optimizer = PerformanceOptimizer(self, interval_seconds=optimizer_interval)
        self._worker_tasks: list[asyncio.Task] = []
        self._active_tasks: dict[str, dict[str, Any]] = {}
        self._pipeline_runs: dict[str, dict[str, Any]] = {}
        self._running = False
        self._max_concurrent = max_concurrent
        self._worker_count = max_concurrent

    def register_agent(self, agent_id: str, agent) -> None:
        self._agents[agent_id] = agent
        self.router._agents[agent_id] = agent
        self.router._performance[agent_id] = {"success": 0, "fail": 0, "avg_ms": 0.0}
        logger.info(f"[OpenClaw] Agent registered: {agent_id}")

    async def submit(
        self,
        task_type: str,
        payload: dict[str, Any],
        priority: TaskPriority = TaskPriority.NORMAL,
        agent_hint: Optional[str] = None,
        parent_id: Optional[str] = None,
    ) -> str:
        task = Task(
            type=task_type,
            payload=payload,
            priority=priority,
            agent_hint=agent_hint,
            parent_id=parent_id,
        )
        task_id = await self.queue.enqueue(task)
        await self.bus.emit_simple("task.queued", "openclaw", task.to_dict())
        logger.info(f"[OpenClaw] Task queued: {task_type} ({task_id[:8]})")
        return task_id

    async def submit_pipeline(
        self,
        topic: str,
        keywords: list[str] | None = None,
        aspect_ratio: str = "16:9",
        user_id: str = "",
        job_id: str = "",
        job_run_id: str = "",
        workspace_id: str = "",
        brand_id: str = "",
        input_payload: dict[str, Any] | None = None,
    ) -> list[str]:
        """
        Submit a full content pipeline:
        blog_post -> image_gen -> tts -> video_caption -> post_content -> video_publish
        """
        # Validate topic at the pipeline entry point (prevents silent bad runs).
        if not topic or not isinstance(topic, str):
            raise ValueError("Pipeline topic is required")
        topic = topic.strip()
        if not topic:
            raise ValueError("Pipeline topic cannot be empty")
        if len(topic) > 500:
            raise ValueError(f"Pipeline topic too long ({len(topic)} chars, max 500)")

        # Normalize keywords
        normalized_keywords: list[str] = []
        if keywords:
            normalized_keywords = [k.strip() for k in keywords if k and str(k).strip()]

        ip = input_payload or {}
        generate_video = bool(ip.get("generate_video", True))
        content_type = str(ip.get("content_type", "video"))
        # Blog-only mode: skip audio, video, and publish stages
        blog_only = not generate_video or content_type == "blog"

        pipeline_id = str(uuid.uuid4())
        stages = [
            {"key": "blog", "task_type": "blog_post", "agent": "content_agent", "label": "Generate SEO article", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None},
            {"key": "image", "task_type": "image_gen", "agent": "image_agent", "label": "Generate article-aligned image", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None},
        ]
        if not blog_only:
            publish_blog = bool(ip.get("publish_blog", False))
            video_stages = [
                {"key": "audio", "task_type": "tts", "agent": "voice_agent", "label": "Generate narration audio", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None},
                {"key": "video", "task_type": "video_caption", "agent": "video_agent", "label": "Assemble slide video", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None},
            ]
            if publish_blog:
                video_stages.append({"key": "post", "task_type": "post_content", "agent": "distribution_agent", "label": "Publish article and package outputs", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None})
            video_stages.append({"key": "publish", "task_type": "video_publish", "agent": "distribution_agent", "label": "Publish final video", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None})
            stages += video_stages
        else:
            stages += [
                {"key": "post", "task_type": "post_content", "agent": "distribution_agent", "label": "Publish article", "status": "queued", "task_id": None, "error": None, "blocked_on": None, "result": None},
            ]

        self._pipeline_runs[pipeline_id] = {
            "pipeline_id": pipeline_id,
            "topic": topic,
            "aspect_ratio": aspect_ratio,
            "created_at": datetime.utcnow().isoformat(),
            "status": "queued",
            "errors": [],
            "stages": stages,
        }
        ids = []
        shared_payload = {
            "aspect_ratio": aspect_ratio,
            "pipeline_id": pipeline_id,
            "user_id": user_id,
            "job_id": job_id,
            "job_run_id": job_run_id,
            "workspace_id": workspace_id,
            "brand_id": brand_id,
            "input_payload": ip,
        }
        blog_id = await self.submit(
            "blog_post",
            {"topic": topic, "keywords": normalized_keywords, "stage_name": "blog", **shared_payload},
            priority=TaskPriority.HIGH,
        )
        ids.append(blog_id)
        self._assign_pipeline_task(pipeline_id, "blog", blog_id)
        img_id = await self.submit(
            "image_gen",
            {"topic": topic, "keywords": normalized_keywords, "blog_task_id": blog_id, "stage_name": "image", **shared_payload},
            priority=TaskPriority.NORMAL,
            parent_id=blog_id,
        )
        ids.append(img_id)
        self._assign_pipeline_task(pipeline_id, "image", img_id)

        if blog_only:
            post_id = await self.submit(
                "post_content",
                {"topic": topic, "blog_task_id": blog_id, "image_task_id": img_id, "stage_name": "post", **shared_payload},
                priority=TaskPriority.LOW,
                parent_id=img_id,
            )
            ids.append(post_id)
            self._assign_pipeline_task(pipeline_id, "post", post_id)
        else:
            # Video-only mode: generate content internally for narration but skip WordPress publish
            publish_blog = bool(ip.get("publish_blog", False))
            audio_id = await self.submit(
                "tts",
                {"topic": topic, "blog_task_id": blog_id, "stage_name": "audio", **shared_payload},
                priority=TaskPriority.NORMAL,
                parent_id=blog_id,
            )
            ids.append(audio_id)
            self._assign_pipeline_task(pipeline_id, "audio", audio_id)
            video_id = await self.submit(
                "video_caption",
                {"topic": topic, "keywords": normalized_keywords, "blog_task_id": blog_id, "image_task_id": img_id, "audio_task_id": audio_id, "stage_name": "video", **shared_payload},
                priority=TaskPriority.LOW,
                parent_id=audio_id,
            )
            ids.append(video_id)
            self._assign_pipeline_task(pipeline_id, "video", video_id)
            if publish_blog:
                post_id = await self.submit(
                    "post_content",
                    {"topic": topic, "blog_task_id": blog_id, "image_task_id": img_id, "video_task_id": video_id, "stage_name": "post", **shared_payload},
                    priority=TaskPriority.LOW,
                    parent_id=blog_id,
                )
                ids.append(post_id)
                self._assign_pipeline_task(pipeline_id, "post", post_id)
                publish_id = await self.submit(
                    "video_publish",
                    {"topic": topic, "blog_task_id": blog_id, "audio_task_id": audio_id, "video_task_id": video_id, "post_task_id": post_id, "publish_targets": ["youtube", "tiktok", "instagram"], "stage_name": "publish", **shared_payload},
                    priority=TaskPriority.LOW,
                    parent_id=video_id,
                )
            else:
                publish_id = await self.submit(
                    "video_publish",
                    {"topic": topic, "blog_task_id": blog_id, "audio_task_id": audio_id, "video_task_id": video_id, "publish_targets": ["youtube", "tiktok", "instagram"], "stage_name": "publish", **shared_payload},
                    priority=TaskPriority.LOW,
                    parent_id=video_id,
                )
            ids.append(publish_id)
            self._assign_pipeline_task(pipeline_id, "publish", publish_id)

        logger.info(f"[OpenClaw] Pipeline submitted for '{topic}' ({len(ids)} tasks, blog_only={blog_only})")
        return ids

    async def start(self, num_workers: int | None = None) -> None:
        self._running = True
        workers = num_workers or self._max_concurrent
        self._worker_count = workers
        logger.info(f"[OpenClaw] Starting with {workers} workers")
        self._worker_tasks = [
            asyncio.create_task(self._worker(i)) for i in range(workers)
        ]
        asyncio.create_task(self.optimizer.start())
        await self.bus.emit_simple("openclaw.started", "openclaw", {"workers": workers})

    async def stop(self) -> None:
        self._running = False
        self.optimizer.stop()
        for t in self._worker_tasks:
            t.cancel()
        await self.bus.emit_simple("openclaw.stopped", "openclaw", {})
        logger.info("[OpenClaw] Stopped")

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        cancelled = self.queue.cancel_by_job_id(job_id)
        for task in list(self._active_tasks.values()):
            if str(task.get("job_id") or "").strip() == str(job_id or "").strip():
                task["cancel_requested"] = True
        return {"job_id": job_id, "cancelled_tasks": cancelled}

    def refresh_runtime_config(self) -> None:
        self.llm.refresh_settings()
        try:
            limit = int(str(get_setting("openclaw", "max_concurrent_tasks", self._max_concurrent) or self._max_concurrent))
        except Exception:
            limit = self._max_concurrent
        limit = max(1, limit)
        self._max_concurrent = limit
        self.queue.set_max_concurrent(limit)
        for agent in self._agents.values():
            refresh = getattr(agent, "refresh_settings", None)
            if callable(refresh):
                refresh()
        logger.info(f"[OpenClaw] Runtime configuration refreshed (global concurrent tasks: {limit})")

    async def _worker(self, worker_id: int) -> None:
        logger.debug(f"[Worker-{worker_id}] Ready")
        while self._running:
            try:
                task = await asyncio.wait_for(self.queue.dequeue(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            if not await self._prepare_task(task):
                continue

            agent = self.router.select_agent(task)
            if not agent:
                await self.queue.fail(task, f"No agent available for task type: {task.type}")
                continue

            agent_id = agent.agent_id
            task.assigned_agent_id = agent_id
            self.queue.increment_agent_load(agent_id)
            start = asyncio.get_event_loop().time()
            self._active_tasks[task.id] = {
                "task_id": task.id,
                "type": task.type,
                "agent": agent_id,
                "topic": task.payload.get("topic", ""),
                "aspect_ratio": task.payload.get("aspect_ratio", ""),
                "pipeline_id": task.payload.get("pipeline_id"),
                "stage_name": task.payload.get("stage_name"),
                "job_id": task.payload.get("job_id"),
                "job_run_id": task.payload.get("job_run_id"),
                "started_at": datetime.utcnow().isoformat(),
                "payload": {
                    "blog_task_id": task.payload.get("blog_task_id"),
                    "image_task_id": task.payload.get("image_task_id"),
                    "audio_task_id": task.payload.get("audio_task_id"),
                    "video_task_id": task.payload.get("video_task_id"),
                },
            }
            self._mark_pipeline_stage(task, "running")

            await self.bus.emit_simple("task.started", "openclaw", {
                "task_id": task.id,
                "agent": agent_id,
                "type": task.type,
                "pipeline_id": task.payload.get("pipeline_id"),
                "stage_name": task.payload.get("stage_name"),
                "job_id": task.payload.get("job_id"),
                "job_run_id": task.payload.get("job_run_id"),
                "workspace_id": task.payload.get("workspace_id"),
                "brand_id": task.payload.get("brand_id"),
            })

            try:
                # Inject resolved file paths from completed parent tasks
                self._inject_task_results(task)
                result = await agent.run(task)
                elapsed_ms = (asyncio.get_event_loop().time() - start) * 1000
                await self.queue.complete(task, result)
                self.router.record_success(agent_id, elapsed_ms)
                # Surface partial-step skips (e.g. subtitle transcription) to the dashboard.
                if isinstance(result, dict):
                    skipped_steps = result.get("skipped_steps")
                    if isinstance(skipped_steps, list):
                        for item in skipped_steps:
                            if not isinstance(item, dict):
                                continue
                            step = str(item.get("step") or "").strip()
                            if not step:
                                continue
                            await self.bus.emit_simple("task.step.skipped", "openclaw", {
                                "task_id": task.id,
                                "agent": agent_id,
                                "type": task.type,
                                "pipeline_id": task.payload.get("pipeline_id"),
                                "stage_name": task.payload.get("stage_name"),
                                "job_id": task.payload.get("job_id"),
                                "job_run_id": task.payload.get("job_run_id"),
                                "workspace_id": task.payload.get("workspace_id"),
                                "brand_id": task.payload.get("brand_id"),
                                "step": step,
                                "engine": item.get("engine"),
                                "reason": item.get("reason"),
                            })
                await self.bus.emit_simple("task.completed", "openclaw", {
                    "task_id": task.id, "agent": agent_id,
                    "type": task.type,
                    "elapsed_ms": elapsed_ms,
                    "result": result,
                    "pipeline_id": task.payload.get("pipeline_id"),
                    "stage_name": task.payload.get("stage_name"),
                    "job_id": task.payload.get("job_id"),
                    "job_run_id": task.payload.get("job_run_id"),
                    "workspace_id": task.payload.get("workspace_id"),
                    "brand_id": task.payload.get("brand_id"),
                })
                self._mark_pipeline_stage(task, "completed", result=result)
                self._active_tasks.pop(task.id, None)
                logger.success(f"[Worker-{worker_id}] {task.type} ✓ via {agent_id} ({elapsed_ms:.0f}ms)")
            except Exception as e:
                self.router.record_failure(agent_id)
                # Non-retryable errors (e.g. payment/auth failures) should not be retried
                if isinstance(e, _BaseNonRetryable) or \
                   (_VoiceNonRetryable and isinstance(e, _VoiceNonRetryable)) or \
                   (_VideoNonRetryable and isinstance(e, _VideoNonRetryable)):
                    task.retries = task.max_retries  # exhaust retries immediately
                requeued = await self.queue.fail(task, str(e))
                await self.bus.emit_simple("task.failed", "openclaw", {
                    "task_id": task.id, "agent": agent_id,
                    "type": task.type,
                    "error": str(e),
                    "requeued": requeued,
                    "pipeline_id": task.payload.get("pipeline_id"),
                    "stage_name": task.payload.get("stage_name"),
                    "job_id": task.payload.get("job_id"),
                    "job_run_id": task.payload.get("job_run_id"),
                    "workspace_id": task.payload.get("workspace_id"),
                    "brand_id": task.payload.get("brand_id"),
                })
                self._mark_pipeline_stage(task, "retrying" if requeued else "failed", error=str(e))
                self._active_tasks.pop(task.id, None)
                logger.error(f"[Worker-{worker_id}] {task.type} ✗: {e}")

    async def _prepare_task(self, task: Task) -> bool:
        """Resolve task dependencies before execution."""
        if task.type not in {"tts", "post_content", "video_caption", "video_publish"}:
            return True

        blog_task_id = task.payload.get("blog_task_id")
        if not blog_task_id:
            return True

        blog_task = self.queue.get_task(blog_task_id)
        if blog_task and blog_task.status == TaskStatus.FAILED:
            logger.warning(f"[OpenClaw] Skipping {task.type} — upstream blog_post {str(blog_task_id)[:8]} failed")
            task.status = TaskStatus.FAILED
            task.error = f"Upstream blog_post task failed: {blog_task.error}"
            task.completed_at = datetime.utcnow()
            self.queue._history.append(task)
            self._mark_pipeline_stage(task, "failed", error=task.error)
            return False
        if not blog_task or blog_task.status != TaskStatus.COMPLETED or not blog_task.result:
            logger.info(
                f"[OpenClaw] Delaying {task.type} until blog_post {str(blog_task_id)[:8]} completes"
            )
            self._mark_pipeline_stage(task, "blocked", blocked_on="blog")
            await self.bus.emit_simple("task.blocked", "openclaw", {
                "task_id": task.id,
                "agent": task.assigned_agent_id or task.agent_hint or "",
                "type": task.type,
                "pipeline_id": task.payload.get("pipeline_id"),
                "stage_name": task.payload.get("stage_name"),
                "job_id": task.payload.get("job_id"),
                "job_run_id": task.payload.get("job_run_id"),
                "workspace_id": task.payload.get("workspace_id"),
                "brand_id": task.payload.get("brand_id"),
                "blocked_on": "blog",
                "blocked_reasons": ["missing_blog_output"],
                "next_action": "Wait for blog generation",
            })
            await self.queue.defer(task, delay_seconds=2.0)
            return False

        result = blog_task.result
        payload = task.payload
        payload.setdefault("blog_filepath", result.get("filepath", ""))
        payload.setdefault("seo_json_path", result.get("seo_json_path", ""))
        payload.setdefault("title", result.get("title", ""))
        payload.setdefault("slug", result.get("slug", ""))
        payload.setdefault("meta_description", result.get("meta_description", ""))
        payload.setdefault("focus_keyword", result.get("focus_keyword", ""))
        payload.setdefault("category", result.get("category", ""))
        payload.setdefault("tags", result.get("tags", []))
        payload.setdefault("schema_type", result.get("schema_type", "Article"))
        payload.setdefault("excerpt", result.get("excerpt", ""))
        payload.setdefault("aspect_ratio", result.get("aspect_ratio", payload.get("aspect_ratio", "16:9")))

        image_task_id = payload.get("image_task_id")
        if image_task_id:
            image_task = self.queue.get_task(image_task_id)
            if image_task and image_task.status == TaskStatus.FAILED:
                logger.warning(f"[OpenClaw] Skipping {task.type} — upstream image task {str(image_task_id)[:8]} failed (proceeding without image)")
                # Image failure is non-fatal — continue without it
            elif not image_task or image_task.status != TaskStatus.COMPLETED or not image_task.result:
                if task.type in {"post_content", "video_caption"}:
                    logger.info(
                        f"[OpenClaw] Delaying {task.type} until image task {str(image_task_id)[:8]} completes"
                    )
                    self._mark_pipeline_stage(task, "blocked", blocked_on="image")
                    await self.bus.emit_simple("task.blocked", "openclaw", {
                        "task_id": task.id,
                        "agent": task.assigned_agent_id or task.agent_hint or "",
                        "type": task.type,
                        "pipeline_id": task.payload.get("pipeline_id"),
                        "stage_name": task.payload.get("stage_name"),
                        "job_id": task.payload.get("job_id"),
                        "job_run_id": task.payload.get("job_run_id"),
                        "workspace_id": task.payload.get("workspace_id"),
                        "brand_id": task.payload.get("brand_id"),
                        "blocked_on": "image",
                        "blocked_reasons": ["missing_primary_image"],
                        "next_action": "Wait for image generation",
                    })
                    await self.queue.defer(task, delay_seconds=2.0)
                    return False
            else:
                payload.setdefault("image_filepath", image_task.result.get("filepath", ""))
                payload.setdefault("image_filename", image_task.result.get("filename", ""))

        audio_task_id = payload.get("audio_task_id")
        if audio_task_id:
            audio_task = self.queue.get_task(audio_task_id)
            if audio_task and audio_task.status == TaskStatus.FAILED:
                logger.warning(f"[OpenClaw] Audio task failed — {task.type} will proceed without audio")
                # TTS is non-fatal: blog post and WordPress publish still succeed without audio
                payload["audio_filepath"] = ""
                payload["full_audio_path"] = ""
                payload["audio_skipped"] = True
            if not audio_task or audio_task.status != TaskStatus.COMPLETED or not audio_task.result:
                if task.type == "video_caption":
                    logger.info(
                        f"[OpenClaw] Delaying video_caption until audio task {str(audio_task_id)[:8]} completes"
                    )
                    self._mark_pipeline_stage(task, "blocked", blocked_on="audio")
                    await self.bus.emit_simple("task.blocked", "openclaw", {
                        "task_id": task.id,
                        "agent": task.assigned_agent_id or task.agent_hint or "",
                        "type": task.type,
                        "pipeline_id": task.payload.get("pipeline_id"),
                        "stage_name": task.payload.get("stage_name"),
                        "job_id": task.payload.get("job_id"),
                        "job_run_id": task.payload.get("job_run_id"),
                        "workspace_id": task.payload.get("workspace_id"),
                        "brand_id": task.payload.get("brand_id"),
                        "blocked_on": "audio",
                        "blocked_reasons": ["missing_audio"],
                        "next_action": "Wait for audio generation",
                    })
                    await self.queue.defer(task, delay_seconds=2.0)
                    return False
            else:
                payload.setdefault("audio_filepath", audio_task.result.get("filepath", ""))
                payload.setdefault("full_audio_path", audio_task.result.get("filepath", ""))

        if task.type == "video_publish":
            video_task_id = payload.get("video_task_id")
            if not video_task_id:
                await self.bus.emit_simple("task.blocked", "openclaw", {
                    "task_id": task.id,
                    "agent": task.assigned_agent_id or task.agent_hint or "",
                    "type": task.type,
                    "pipeline_id": task.payload.get("pipeline_id"),
                    "stage_name": task.payload.get("stage_name"),
                    "job_id": task.payload.get("job_id"),
                    "job_run_id": task.payload.get("job_run_id"),
                    "workspace_id": task.payload.get("workspace_id"),
                    "brand_id": task.payload.get("brand_id"),
                    "blocked_on": "video",
                    "blocked_reasons": ["missing_video"],
                    "next_action": "Wait for video generation",
                })
                await self.queue.defer(task, delay_seconds=2.0)
                return False
            video_task = self.queue.get_task(video_task_id)
            if not video_task or video_task.status != TaskStatus.COMPLETED or not video_task.result:
                logger.info(
                    f"[OpenClaw] Delaying video_publish until video task {str(video_task_id)[:8]} completes"
                )
                self._mark_pipeline_stage(task, "blocked", blocked_on="video")
                await self.bus.emit_simple("task.blocked", "openclaw", {
                    "task_id": task.id,
                    "agent": task.assigned_agent_id or task.agent_hint or "",
                    "type": task.type,
                    "pipeline_id": task.payload.get("pipeline_id"),
                    "stage_name": task.payload.get("stage_name"),
                    "job_id": task.payload.get("job_id"),
                    "job_run_id": task.payload.get("job_run_id"),
                    "workspace_id": task.payload.get("workspace_id"),
                    "brand_id": task.payload.get("brand_id"),
                    "blocked_on": "video",
                    "blocked_reasons": ["missing_video"],
                    "next_action": "Wait for video generation",
                })
                await self.queue.defer(task, delay_seconds=2.0)
                return False
            video_result = video_task.result
            payload.setdefault("video_filepath", video_result.get("filepath", ""))
            payload.setdefault("storyboard_path", video_result.get("storyboard_path", ""))
            payload.setdefault("full_audio_path", video_result.get("full_audio_path", ""))
            payload["aspect_ratio"] = video_result.get("aspect_ratio", payload.get("aspect_ratio", "16:9"))
            post_task_id = payload.get("post_task_id")
            if post_task_id:
                post_task = self.queue.get_task(post_task_id)
                if not post_task or post_task.status != TaskStatus.COMPLETED or not post_task.result:
                    logger.info(
                        f"[OpenClaw] Delaying video_publish until post task {str(post_task_id)[:8]} completes"
                    )
                    self._mark_pipeline_stage(task, "blocked", blocked_on="post")
                    await self.bus.emit_simple("task.blocked", "openclaw", {
                        "task_id": task.id,
                        "agent": task.assigned_agent_id or task.agent_hint or "",
                        "type": task.type,
                        "pipeline_id": task.payload.get("pipeline_id"),
                        "stage_name": task.payload.get("stage_name"),
                        "job_id": task.payload.get("job_id"),
                        "job_run_id": task.payload.get("job_run_id"),
                        "workspace_id": task.payload.get("workspace_id"),
                        "brand_id": task.payload.get("brand_id"),
                        "blocked_on": "post",
                        "blocked_reasons": ["missing_post_package"],
                        "next_action": "Wait for post packaging",
                    })
                    await self.queue.defer(task, delay_seconds=2.0)
                    return False
                post_result = post_task.result if isinstance(post_task.result, dict) else {}
                wordpress = post_result.get("wordpress", {})
                package = post_result.get("distribution_package", {}) if isinstance(post_result.get("distribution_package"), dict) else {}
                payload.setdefault("post_url", wordpress.get("link", "") or package.get("wordpress_url", ""))
                payload.setdefault("title", package.get("title", payload.get("title", "")))
                payload.setdefault("excerpt", package.get("excerpt", payload.get("excerpt", "")))
                payload.setdefault("meta_description", package.get("meta_description", payload.get("meta_description", "")))
                payload.setdefault("focus_keyword", package.get("focus_keyword", payload.get("focus_keyword", "")))
                payload.setdefault("tags", package.get("tags", payload.get("tags", [])))
        return True

    def _inject_task_results(self, task: Task) -> None:
        """Resolve file paths from completed parent tasks and inject into payload."""
        payload = task.payload

        # audio_task_id → audio_filepath
        audio_task_id = payload.get("audio_task_id", "")
        if audio_task_id and not payload.get("audio_filepath"):
            audio_task = self.queue.get_task(audio_task_id)
            if audio_task and audio_task.result:
                fp = audio_task.result.get("filepath") or audio_task.result.get("full_audio_path", "")
                if fp:
                    payload["audio_filepath"] = fp

        # image_task_id → image_filepath
        image_task_id = payload.get("image_task_id", "")
        if image_task_id and not payload.get("image_filepath"):
            image_task = self.queue.get_task(image_task_id)
            if image_task and image_task.result:
                fp = image_task.result.get("filepath") or image_task.result.get("image_path", "")
                if fp:
                    payload["image_filepath"] = fp

        # blog_task_id → blog_filepath
        blog_task_id = payload.get("blog_task_id", "")
        if blog_task_id and not payload.get("blog_filepath"):
            blog_task = self.queue.get_task(blog_task_id)
            if blog_task and blog_task.result:
                fp = blog_task.result.get("filepath") or blog_task.result.get("blog_filepath", "")
                if fp:
                    payload["blog_filepath"] = fp

    def _assign_pipeline_task(self, pipeline_id: str, stage_name: str, task_id: str) -> None:
        pipeline = self._pipeline_runs.get(pipeline_id)
        if not pipeline:
            return
        for stage in pipeline.get("stages", []):
            if stage.get("key") == stage_name:
                stage["task_id"] = task_id
                break

    def _mark_pipeline_stage(
        self,
        task: Task,
        status: str,
        error: str | None = None,
        blocked_on: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        pipeline_id = str(task.payload.get("pipeline_id") or "").strip()
        stage_name = str(task.payload.get("stage_name") or "").strip()
        if not pipeline_id or not stage_name:
            return
        pipeline = self._pipeline_runs.get(pipeline_id)
        if not pipeline:
            return
        for stage in pipeline.get("stages", []):
            if stage.get("key") != stage_name:
                continue
            stage["status"] = status
            stage["error"] = error
            stage["blocked_on"] = blocked_on
            if result is not None:
                stage["result"] = {
                    key: result.get(key)
                    for key in ("filepath", "seo_json_path", "storyboard_path", "full_audio_path", "wordpress", "platforms", "distribution_package")
                    if key in result
                }
            break
        statuses = [s.get("status") for s in pipeline.get("stages", [])]
        pipeline["errors"] = [s.get("error") for s in pipeline.get("stages", []) if s.get("error")]
        if any(s == "failed" for s in statuses):
            pipeline["status"] = "failed"
        elif all(s == "completed" for s in statuses):
            pipeline["status"] = "completed"
        elif any(s == "running" for s in statuses):
            pipeline["status"] = "running"
        elif any(s == "blocked" for s in statuses):
            pipeline["status"] = "blocked"
        elif any(s == "retrying" for s in statuses):
            pipeline["status"] = "retrying"
        else:
            pipeline["status"] = "queued"

    def status(self, limit: int = 50, offset: int = 0) -> dict:
        all_pipelines = list(reversed(list(self._pipeline_runs.values())))
        all_tasks = list(self._active_tasks.values())
        return {
            "running": self._running,
            "queue": self.queue.stats(),
            "agents": {
                aid: {
                    "load": a.current_load,
                    "skill": a.skill_summary(),
                }
                for aid, a in self._agents.items()
            },
            "router": self.router.performance_report(),
            "optimizer": self.optimizer.latest_recommendations(),
            "active_tasks": all_tasks[offset:offset + limit],
            "pipelines": all_pipelines[offset:offset + limit],
            "timestamp": datetime.utcnow().isoformat(),
        }
