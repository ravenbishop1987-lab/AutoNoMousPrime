#!/usr/bin/env python3
"""
Autonomous Prime — Main Entry Point
Starts OpenClaw orchestrator + all 5 agents + dashboard + scheduler
"""
import asyncio
import json
import os
import socket
import sys
from pathlib import Path
from typing import Optional

import httpx
import typer
import uvicorn
from dotenv import load_dotenv
from loguru import logger
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from core.runtime_settings import apply_settings_to_env
from core.saas_callback_client import install_saas_callbacks

# ── Windows: force UTF-8 so Rich renders correctly in legacy console ──────────
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# Load .env before anything else
load_dotenv()


def configure_local_ffmpeg_environment() -> None:
    ffmpeg_bin_dir = Path("tools") / "ffmpeg" / "bin"
    ffmpeg_path = ffmpeg_bin_dir / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    ffprobe_path = ffmpeg_bin_dir / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    if not ffmpeg_path.exists() or not ffprobe_path.exists():
        return

    current_path = os.environ.get("PATH", "")
    resolved_bin = str(ffmpeg_bin_dir.resolve())
    path_entries = current_path.split(os.pathsep) if current_path else []
    if resolved_bin not in path_entries:
        os.environ["PATH"] = f"{resolved_bin}{os.pathsep}{current_path}" if current_path else resolved_bin

    os.environ.setdefault("FFMPEG_BIN", str(ffmpeg_path.resolve()))
    os.environ.setdefault("FFMPEG_PATH", str(ffmpeg_path.resolve()))
    os.environ.setdefault("FFPROBE_BIN", str(ffprobe_path.resolve()))
    os.environ.setdefault("FFPROBE_PATH", str(ffprobe_path.resolve()))


configure_local_ffmpeg_environment()

default_tts_home = Path(os.getenv("TTS_HOME", str(Path("data") / "tts-cache"))).expanduser()
default_tts_home.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TTS_HOME", str(default_tts_home.resolve()))
os.environ.setdefault("COQUI_TOS_AGREED", "1")

apply_settings_to_env()

# ── Logging ───────────────────────────────────────────────────────────────────
log_level = os.getenv("LOG_LEVEL", "INFO")
logger.remove()
logger.add(
    sys.stderr,
    level=log_level,
    colorize=True,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan> - {message}",
)
Path("data").mkdir(exist_ok=True)
logger.add("data/autonomous_prime.log", level="DEBUG", rotation="50 MB", retention="30 days")

console = Console()
app = typer.Typer(help="Autonomous Prime — AI Business Orchestrator", add_completion=False)


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


# ── Agent factory ─────────────────────────────────────────────────────────────

def build_openclaw():
    """Instantiate OpenClaw with all agents registered."""
    from core.orchestrator import OpenClaw
    from agents.content_agent import ContentAgent
    from agents.image_agent import ImageAgent
    from agents.voice_agent import VoiceAgent
    from agents.video_agent import VideoAgent
    from agents.distribution_agent import DistributionAgent
    from agents.ebook_agent import EbookAgent
    from agents.podcast_agent import PodcastAgent
    from agents.funnel_agent import FunnelAgent
    from agents.ads_agent import AdsAgent
    from agents.analytics_agent import AnalyticsAgent
    from agents.product_agent import ProductAgent

    oc = OpenClaw(
        max_concurrent=int(os.getenv("MAX_CONCURRENT_TASKS", "5")),
        optimizer_interval=300,
    )
    llm = oc.llm
    oc.register_agent("content_agent",      ContentAgent(llm))
    oc.register_agent("image_agent",        ImageAgent(llm))
    oc.register_agent("voice_agent",        VoiceAgent(llm))
    oc.register_agent("video_agent",        VideoAgent(llm))
    oc.register_agent("distribution_agent", DistributionAgent(llm))
    oc.register_agent("ebook_agent",        EbookAgent(llm))
    oc.register_agent("podcast_agent",      PodcastAgent(llm))
    oc.register_agent("funnel_agent",       FunnelAgent(llm))
    oc.register_agent("ads_agent",          AdsAgent(llm))
    oc.register_agent("analytics_agent",    AnalyticsAgent(llm))
    oc.register_agent("product_agent",      ProductAgent(llm))
    return oc


# ── Main async runner ─────────────────────────────────────────────────────────

async def _run(
    host: str,
    port: int,
    pipeline_topic: Optional[str],
    pipeline_keywords: list,
    schedule: bool,
    workers: int,
) -> None:
    oc = build_openclaw()
    install_saas_callbacks(oc.bus)

    console.print(Panel.fit(
        "[bold cyan]Autonomous Prime[/bold cyan]  v1.0\n"
        "OpenClaw Orchestrator + 5 Agents + React UI\n"
        f"Dashboard -> http://localhost:{port}",
        border_style="cyan",
    ))

    tbl = Table(title="Registered Agents", show_header=True, header_style="bold cyan")
    tbl.add_column("Agent ID",      style="cyan")
    tbl.add_column("Capabilities",  style="green")
    tbl.add_column("Max Concurrent", justify="right")
    for aid, agent in oc._agents.items():
        sk = agent.skill_summary()
        tbl.add_row(aid, ", ".join(sk.get("capabilities", [])), str(agent._max_concurrent))
    console.print(tbl)

    await oc.start(num_workers=workers)

    scheduler = None
    if schedule:
        from workflows.daily_pipeline import setup_scheduler
        scheduler = setup_scheduler(oc)
        scheduler.start()
        logger.info("[Main] Scheduler started — daily 08:00 UTC / weekly report Mon 09:00 UTC")

    if pipeline_topic:
        ids = await oc.submit_pipeline(pipeline_topic, pipeline_keywords)
        logger.info(f"[Main] Pipeline queued: {len(ids)} tasks for '{pipeline_topic}'")

    from dashboard.api import create_app
    fastapi_app = create_app(oc)

    config = uvicorn.Config(
        fastapi_app,
        host=host,
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)

    try:
        await server.serve()
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)
        await oc.stop()
        logger.info("[Main] Shutdown complete")


# ── CLI commands ──────────────────────────────────────────────────────────────

@app.command()
def run(
    host: str = typer.Option("0.0.0.0", help="API host"),
    port: int = typer.Option(int(os.getenv("DASHBOARD_PORT", "8000")), help="API port"),
    topic: Optional[str] = typer.Option(None, "--topic", "-t", help="Launch an immediate pipeline"),
    keywords: str = typer.Option("", "--keywords", "-k", help="Comma-separated keywords"),
    schedule: bool = typer.Option(_env_flag("ENABLE_SCHEDULER", True), help="Enable daily scheduler"),
    workers: int = typer.Option(int(os.getenv("MAX_CONCURRENT_TASKS", "5")), help="Worker count"),
    force_free_port: bool = typer.Option(False, help="Force-kill the process using the target port before startup"),
) -> None:
    """Start Autonomous Prime (orchestrator + API + React UI)."""
    if force_free_port:
        _free_port(port)
    elif not os.getenv("RAILWAY_ENVIRONMENT") and not _port_available(host, port):
        raise typer.BadParameter(
            f"Port {port} is already in use. Stop the existing process or rerun with --force-free-port."
        )
    kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
    asyncio.run(_run(host, port, topic, kw_list, schedule, workers))


@app.command()
def status() -> None:
    """Print live system status from the running instance."""
    port = int(os.getenv("DASHBOARD_PORT", "8000"))
    try:
        r = httpx.get(f"http://localhost:{port}/api/status", timeout=5)
        r.raise_for_status()
        console.print_json(json.dumps(r.json()))
    except httpx.ConnectError:
        console.print(f"[red]Cannot connect — is 'python main.py run' running on port {port}?[/red]")
    except Exception as exc:
        console.print(f"[red]Error: {exc}[/red]")


@app.command()
def pipeline(
    topic: str = typer.Argument(..., help="Content topic"),
    keywords: str = typer.Option("", "-k", help="Comma-separated keywords"),
) -> None:
    """Submit a content pipeline to the running instance."""
    port = int(os.getenv("DASHBOARD_PORT", "8000"))
    kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
    try:
        r = httpx.post(
            f"http://localhost:{port}/api/pipeline",
            json={"topic": topic, "keywords": kw_list},
            timeout=10,
        )
        r.raise_for_status()
        console.print_json(r.text)
    except httpx.ConnectError:
        console.print(f"[red]Cannot connect — is 'python main.py run' running on port {port}?[/red]")
    except Exception as exc:
        console.print(f"[red]Error: {exc}[/red]")


def _free_port(port: int) -> None:
    """Kill any process holding the target port so startup never fails."""
    import subprocess
    try:
        result = subprocess.run(
            f'netstat -ano | findstr ":{port} "',
            shell=True, capture_output=True, text=True
        )
        for line in result.stdout.splitlines():
            parts = line.split()
            if parts and parts[-1].isdigit():
                pid = int(parts[-1])
                if pid > 0:
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True,
                                   capture_output=True)
    except Exception:
        pass


def _port_available(host: str, port: int) -> bool:
    bind_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((bind_host, port))
            return True
        except OSError:
            return False


if __name__ == "__main__":
    # When double-clicked or run without arguments, default to 'run'
    if len(sys.argv) == 1:
        sys.argv.append("run")

    try:
        app()
    except Exception as exc:
        # Keep window open so the error is readable
        print(f"\n\nFATAL ERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        input("\nPress Enter to close...")
