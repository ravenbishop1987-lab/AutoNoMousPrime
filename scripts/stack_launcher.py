#!/usr/bin/env python3
"""
Unified local stack launcher for Autonomous Prime.

Starts all local services in one console, prefixes logs by service, and shuts
the stack down cleanly when interrupted.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
WINDOWS = os.name == "nt"
CREATE_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
DEFAULT_TTS_HOME = ROOT / "data" / "tts-cache"
LOCAL_FFMPEG_BIN = ROOT / "tools" / "ffmpeg" / "bin"

if WINDOWS:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"


@dataclass
class Service:
    name: str
    command: list[str]
    cwd: Path
    url: str | None = None
    health_url: str | None = None
    health_mode: str = "http"
    startup_timeout: int = 45
    env: dict[str, str] = field(default_factory=dict)
    optional: bool = False
    process: subprocess.Popen[str] | None = None


def npm_command() -> str:
    if WINDOWS:
        return shutil.which("npm.cmd") or "npm.cmd"
    return shutil.which("npm") or "npm"


def prefixed_print(prefix: str, message: str) -> None:
    print(f"[{prefix}] {message}", flush=True)


def stream_output(service: Service) -> None:
    assert service.process is not None
    assert service.process.stdout is not None
    for line in service.process.stdout:
        prefixed_print(service.name, line.rstrip())


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def wait_for_url(url: str, timeout_seconds: int = 45) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return True
        except urllib.error.HTTPError as exc:
            if 200 <= exc.code < 500:
                return True
        except Exception:
            time.sleep(1)
    return False


def wait_for_port(port: int, timeout_seconds: int = 45) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if bool(pids_on_port(port)) if WINDOWS else _port_open_socket(port):
            return True
        time.sleep(1)
    return False


def service_endpoint_alive(service: Service) -> bool:
    target = service.health_url or service.url
    if not target:
        return False
    parsed = urlparse(target if "://" in target else f"http://{target}")
    if service.health_mode == "tcp":
        return bool(parsed.port and wait_for_port(parsed.port, timeout_seconds=1))
    return wait_for_url(target, timeout_seconds=1)


def _port_open_socket(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def port_in_use(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port
    if not port:
        return False
    if WINDOWS:
        return bool(pids_on_port(port))
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex((host, port)) == 0


def port_from_url(url: str | None) -> int | None:
    if not url:
        return None
    parsed = urlparse(url if "://" in url else f"http://{url}")
    return parsed.port


def pids_on_port(port: int) -> list[int]:
    if not WINDOWS:
        return []
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True,
        text=True,
        check=False,
    )
    pids: set[int] = set()
    patterns = (f":{port} ", f":{port}\r", f":{port}\n")
    for line in result.stdout.splitlines():
        if not any(pattern in line for pattern in patterns):
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pids.add(int(parts[-1]))
    return sorted(pid for pid in pids if pid > 0)


def kill_pid(pid: int) -> None:
    if WINDOWS:
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def clean_service_port(service: Service) -> None:
    port = port_from_url(service.url)
    if not port:
        return
    pids = pids_on_port(port)
    if not pids:
        return
    prefixed_print(service.name, f"clean start: stopping processes on port {port}: {', '.join(map(str, pids))}")
    for pid in pids:
        kill_pid(pid)
    deadline = time.time() + 12
    while time.time() < deadline:
        if not pids_on_port(port):
            return
        time.sleep(0.5)
    prefixed_print(service.name, f"warning: port {port} still appears busy after cleanup")


def wait_for_service(service: Service) -> bool:
    target = service.health_url or service.url
    if not target:
        return True
    deadline = time.time() + service.startup_timeout
    parsed = urlparse(target if "://" in target else f"http://{target}")
    while time.time() < deadline:
        process = service.process
        if process is not None:
            code = process.poll()
            if code is not None:
                if service_endpoint_alive(service):
                    prefixed_print(service.name, f"ready via spawned child service (launcher process exited with code {code})")
                    service.process = None
                    return True
                prefixed_print(service.name, f"exited before becoming ready (code {code})")
                return False
        if service.health_mode == "tcp":
            if parsed.port and wait_for_port(parsed.port, timeout_seconds=2):
                prefixed_print(service.name, f"ready on port {parsed.port}")
                return True
        elif wait_for_url(target, timeout_seconds=2):
            prefixed_print(service.name, f"ready at {target}")
            return True
        time.sleep(1)
    prefixed_print(service.name, f"did not become ready at {target} within {service.startup_timeout}s")
    return False



def get_tts_home() -> str:
    configured = str(os.getenv("TTS_HOME") or "").strip()
    target = Path(configured).expanduser() if configured else DEFAULT_TTS_HOME
    target.mkdir(parents=True, exist_ok=True)
    return str(target.resolve())


def ffmpeg_env() -> dict[str, str]:
    if not LOCAL_FFMPEG_BIN.exists():
        return {}

    ffmpeg = LOCAL_FFMPEG_BIN / ("ffmpeg.exe" if WINDOWS else "ffmpeg")
    ffprobe = LOCAL_FFMPEG_BIN / ("ffprobe.exe" if WINDOWS else "ffprobe")
    if not ffmpeg.exists() or not ffprobe.exists():
        return {}

    current_path = os.environ.get("PATH", "")
    prefixed_path = f"{LOCAL_FFMPEG_BIN}{os.pathsep}{current_path}" if current_path else str(LOCAL_FFMPEG_BIN)
    return {
        "PATH": prefixed_path,
        "FFMPEG_BIN": str(ffmpeg),
        "FFMPEG_PATH": str(ffmpeg),
        "FFPROBE_BIN": str(ffprobe),
        "FFPROBE_PATH": str(ffprobe),
    }


def start_service(service: Service) -> bool:
    env = os.environ.copy()
    env.update(service.env)

    startup = {
        "cwd": str(service.cwd),
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if WINDOWS:
        startup["creationflags"] = CREATE_NEW_PROCESS_GROUP
    else:
        startup["start_new_session"] = True

    prefixed_print(service.name, f"starting: {' '.join(service.command)}")
    try:
        service.process = subprocess.Popen(service.command, **startup)
    except FileNotFoundError:
        prefixed_print(service.name, f"command not found: {service.command[0]}")
        return False

    thread = threading.Thread(target=stream_output, args=(service,), daemon=True)
    thread.start()
    return True


def stop_service(service: Service) -> None:
    process = service.process
    if process is None or process.poll() is not None:
        return

    prefixed_print(service.name, "stopping")
    try:
        process.terminate()
        process.wait(timeout=5)
        return
    except Exception:
        pass

    if WINDOWS:
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(process.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except Exception:
            process.kill()


def build_services(args: argparse.Namespace) -> list[Service]:
    services: list[Service] = []
    npm_bin = npm_command()
    tts_home = get_tts_home()
    shared_ffmpeg_env = ffmpeg_env()

    services.extend(
        [
            Service(
                name="COMMERCE",
                command=[npm_bin, "run", args.node_mode],
                cwd=ROOT / "services" / "commerce-api",
                url="http://localhost:3010",
                health_url="http://localhost:3010",
                startup_timeout=60,
                env={
                    **shared_ffmpeg_env,
                    "COMMERCE_DB_PATH": str(ROOT / "data" / "commerce.db"),
                },
            ),
            Service(
                name="SAAS",
                command=[npm_bin, "run", args.node_mode],
                cwd=ROOT / "api",
                url="http://localhost:3001",
                health_url="http://localhost:3001/saas/workspaces/session",
                startup_timeout=60,
                env=shared_ffmpeg_env.copy(),
            ),
            Service(
                name="API",
                command=[sys.executable, "main.py", "run", "--force-free-port"],
                cwd=ROOT,
                url="http://localhost:8000",
                health_url="tcp://127.0.0.1:8000",
                health_mode="tcp",
                startup_timeout=120,
                env={
                    **shared_ffmpeg_env,
                    "TTS_HOME": tts_home,
                },
            ),
        ]
    )

    if not args.skip_ui:
        services.append(
            Service(
                name="UI",
                command=[npm_bin, "run", args.ui_mode],
                cwd=ROOT / "ui",
                url="http://localhost:5173",
                health_url="http://localhost:5173",
                startup_timeout=60,
                env=shared_ffmpeg_env.copy(),
            )
        )

    return services


def validate_environment(services: Iterable[Service]) -> None:
    if not command_exists("npm") and not command_exists("npm.cmd"):
        raise SystemExit("npm is required but was not found in PATH.")

    missing_dirs = [str(service.cwd) for service in services if not service.cwd.exists()]
    if missing_dirs:
        raise SystemExit(f"Missing service directories: {', '.join(missing_dirs)}")


def launch_browser_if_ready(url: str) -> None:
    if wait_for_url(url, timeout_seconds=60):
        webbrowser.open(url)
    else:
        prefixed_print("LAUNCHER", f"browser not opened because {url} did not become ready in time")


def main() -> int:
    # Default to success; overridden in error paths.
    return_code = 0

    parser = argparse.ArgumentParser(description="Unified Autonomous Prime stack launcher")
    parser.add_argument("--open-browser", action="store_true", help="Open the UI after it becomes ready")
    parser.add_argument("--skip-ui", action="store_true", help="Start backend services only")
    parser.add_argument("--reuse-existing", action="store_true", help="Reuse services already running on stack ports")
    parser.add_argument("--ui-mode", default="dev", choices=["dev", "preview"], help="UI npm script to run")
    parser.add_argument("--node-mode", default="dev", choices=["dev", "start"], help="Node npm script to run")
    args = parser.parse_args()

    services = build_services(args)
    validate_environment(services)

    print("Starting Autonomous Prime stack...", flush=True)
    print("", flush=True)
    for service in services:
        print(f"  {service.name:<9} -> {service.url or 'no url'}", flush=True)
    print("", flush=True)

    started: list[Service] = []
    try:
        for service in services:
            if service.url and port_in_use(service.url):
                if args.reuse_existing:
                    prefixed_print(service.name, f"already running on {service.url}, reusing existing service")
                    continue
                clean_service_port(service)
            ok = start_service(service)
            if not ok:
                if service.optional:
                    prefixed_print(service.name, "optional service skipped")
                    continue
                raise RuntimeError(f"Could not start {service.name}")
            started.append(service)
            if not wait_for_service(service):
                if service.optional:
                    prefixed_print(service.name, "optional service did not become ready and will be skipped")
                    stop_service(service)
                    started.remove(service)
                    continue
                raise RuntimeError(f"{service.name} failed health check")

        if args.open_browser and not args.skip_ui:
            browser_thread = threading.Thread(
                target=launch_browser_if_ready,
                args=("http://localhost:5173",),
                daemon=True,
            )
            browser_thread.start()

        prefixed_print("LAUNCHER", "stack is running. Press Ctrl+C to stop all services.")

        while True:
            for service in started:
                process = service.process
                if process is None:
                    continue
                code = process.poll()
                if code is not None:
                    if service_endpoint_alive(service):
                        prefixed_print(service.name, f"launcher process exited with code {code}, but service is still healthy")
                        service.process = None
                        continue
                    if service.optional:
                        prefixed_print(service.name, f"optional service exited with code {code}; keeping the rest of the stack running")
                        service.process = None
                        continue
                    raise RuntimeError(f"{service.name} exited with code {code}")
            time.sleep(2)
    except KeyboardInterrupt:
        prefixed_print("LAUNCHER", "shutdown requested")
    except Exception as exc:
        prefixed_print("LAUNCHER", str(exc))
        return_code = 1
    finally:
        for service in reversed(started):
            stop_service(service)

    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
