#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WINDOWS = os.name == "nt"
VENV_DIR = ROOT / ".venv"
COQUI_VENV_DIR = ROOT / "coqui-env"
STAMP_DIR = ROOT / "data" / "install-stamps"
TOOLS_DIR = ROOT / "tools"
FFMPEG_DIR = TOOLS_DIR / "ffmpeg"
FFMPEG_BIN_DIR = FFMPEG_DIR / "bin"
DEFAULT_FFMPEG_DOWNLOAD_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip"


def prefixed_print(prefix: str, message: str) -> None:
    print(f"[{prefix}] {message}", flush=True)


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=str(cwd or ROOT), check=True)


def newest_mtime(paths: list[Path]) -> float:
    existing = [path.stat().st_mtime for path in paths if path.exists()]
    return max(existing) if existing else 0.0


def stamp_path(name: str) -> Path:
    STAMP_DIR.mkdir(parents=True, exist_ok=True)
    return STAMP_DIR / f"{name}.json"


def load_stamp(name: str) -> dict[str, object]:
    path = stamp_path(name)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_stamp(name: str, payload: dict[str, object]) -> None:
    path = stamp_path(name)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def npm_command() -> str:
    if WINDOWS:
        return shutil.which("npm.cmd") or "npm.cmd"
    return shutil.which("npm") or "npm"


def python_in_venv(venv_dir: Path) -> Path:
    if WINDOWS:
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def local_ffmpeg_paths() -> tuple[Path, Path]:
    return FFMPEG_BIN_DIR / ("ffmpeg.exe" if WINDOWS else "ffmpeg"), FFMPEG_BIN_DIR / ("ffprobe.exe" if WINDOWS else "ffprobe")


def ensure_app_venv() -> Path:
    python_path = python_in_venv(VENV_DIR)
    if python_path.exists():
        return python_path

    prefixed_print("BOOTSTRAP", "creating .venv")
    run([sys.executable, "-m", "venv", str(VENV_DIR)])
    return python_path


def ensure_python_requirements(force: bool = False) -> Path:
    python_path = ensure_app_venv()
    requirements = ROOT / "requirements.txt"
    stamp = load_stamp("python")
    expected_inputs = newest_mtime([requirements])
    current_python = str(python_path.resolve())

    needs_install = force or stamp.get("python") != current_python or float(stamp.get("inputs_mtime", 0.0)) < expected_inputs
    if not needs_install:
        prefixed_print("BOOTSTRAP", "python requirements already installed")
        return python_path

    prefixed_print("BOOTSTRAP", "installing Python requirements into .venv")
    run([str(python_path), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(python_path), "-m", "pip", "install", "-r", str(requirements)])
    save_stamp(
        "python",
        {
            "python": current_python,
            "inputs_mtime": expected_inputs,
        },
    )
    return python_path


def ensure_node_dependencies(name: str, directory: Path, force: bool = False) -> None:
    package_json = directory / "package.json"
    package_lock = directory / "package-lock.json"
    node_modules = directory / "node_modules"
    stamp = load_stamp(name)
    expected_inputs = newest_mtime([package_json, package_lock])
    install_mode = "ci" if package_lock.exists() else "install"

    needs_install = force or not node_modules.exists() or float(stamp.get("inputs_mtime", 0.0)) < expected_inputs
    if not needs_install:
        prefixed_print("BOOTSTRAP", f"{directory.relative_to(ROOT)} dependencies already installed")
        return

    prefixed_print("BOOTSTRAP", f"installing Node dependencies in {directory.relative_to(ROOT)}")
    run([npm_command(), install_mode], cwd=directory)
    save_stamp(
        name,
        {
            "inputs_mtime": expected_inputs,
            "install_mode": install_mode,
        },
    )


def ensure_coqui_env(force: bool = False) -> None:
    if not COQUI_VENV_DIR.exists():
        prefixed_print("BOOTSTRAP", "creating coqui-env")
        run([sys.executable, "-m", "venv", str(COQUI_VENV_DIR)])

    python_path = python_in_venv(COQUI_VENV_DIR)
    tts_server = COQUI_VENV_DIR / "Scripts" / "tts-server.exe" if WINDOWS else COQUI_VENV_DIR / "bin" / "tts-server"
    stamp = load_stamp("coqui")
    requirements_input = newest_mtime([ROOT / ".env.example"])
    current_python = str(python_path.resolve())
    needs_install = force or not tts_server.exists() or stamp.get("python") != current_python or float(stamp.get("inputs_mtime", 0.0)) < requirements_input

    if not needs_install:
        prefixed_print("BOOTSTRAP", "coqui-env already installed")
        return

    prefixed_print("BOOTSTRAP", "installing Coqui TTS into coqui-env")
    run([str(python_path), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(python_path), "-m", "pip", "install", "coqui-tts"])
    save_stamp(
        "coqui",
        {
            "python": current_python,
            "inputs_mtime": requirements_input,
        },
    )


def ensure_ffmpeg(force: bool = False) -> None:
    ffmpeg_path, ffprobe_path = local_ffmpeg_paths()
    stamp = load_stamp("ffmpeg")
    expected_url = str(os.getenv("FFMPEG_DOWNLOAD_URL") or DEFAULT_FFMPEG_DOWNLOAD_URL).strip()

    if not WINDOWS:
        if ffmpeg_path.exists() and ffprobe_path.exists():
            prefixed_print("BOOTSTRAP", "local ffmpeg already installed")
            return
        if command_exists("ffmpeg") and command_exists("ffprobe"):
            prefixed_print("BOOTSTRAP", "using system ffmpeg on non-Windows host")
            return
        prefixed_print("BOOTSTRAP", "warning: automatic ffmpeg install is only implemented for Windows")
        return

    required_dlls = list(FFMPEG_BIN_DIR.glob("avcodec-*.dll")) + list(FFMPEG_BIN_DIR.glob("avformat-*.dll")) + list(FFMPEG_BIN_DIR.glob("avutil-*.dll"))
    already_installed = ffmpeg_path.exists() and ffprobe_path.exists() and len(required_dlls) >= 3
    if already_installed and not force and stamp.get("download_url") == expected_url:
        prefixed_print("BOOTSTRAP", "local ffmpeg already installed")
        return

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = TOOLS_DIR / "ffmpeg-shared.zip"
    extract_root = TOOLS_DIR / "ffmpeg-extract"

    prefixed_print("BOOTSTRAP", f"downloading shared ffmpeg build from {expected_url}")
    urllib.request.urlretrieve(expected_url, archive_path)

    if extract_root.exists():
        shutil.rmtree(extract_root, ignore_errors=True)
    extract_root.mkdir(parents=True, exist_ok=True)

    prefixed_print("BOOTSTRAP", "extracting ffmpeg")
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extract_root)

    candidate_bins = sorted(extract_root.glob("**/bin"), key=lambda path: len(path.parts))
    if not candidate_bins:
        raise RuntimeError("FFmpeg archive did not contain a bin directory")

    candidate_bin = candidate_bins[0]
    extracted_ffmpeg = candidate_bin / "ffmpeg.exe"
    extracted_ffprobe = candidate_bin / "ffprobe.exe"
    extracted_dlls = list(candidate_bin.glob("avcodec-*.dll")) + list(candidate_bin.glob("avformat-*.dll")) + list(candidate_bin.glob("avutil-*.dll"))
    if not extracted_ffmpeg.exists() or not extracted_ffprobe.exists() or len(extracted_dlls) < 3:
        raise RuntimeError("Downloaded FFmpeg build does not include the required shared binaries")

    if FFMPEG_DIR.exists():
        shutil.rmtree(FFMPEG_DIR, ignore_errors=True)
    shutil.move(str(candidate_bin.parent), str(FFMPEG_DIR))
    shutil.rmtree(extract_root, ignore_errors=True)

    save_stamp(
        "ffmpeg",
        {
            "download_url": expected_url,
            "ffmpeg_bin": str(ffmpeg_path),
            "ffprobe_bin": str(ffprobe_path),
        },
    )
    prefixed_print("BOOTSTRAP", f"ffmpeg installed at {FFMPEG_BIN_DIR}")


def warn_about_missing_ffmpeg() -> None:
    local_ffmpeg, local_ffprobe = local_ffmpeg_paths()
    if (local_ffmpeg.exists() and local_ffprobe.exists()) or (command_exists("ffmpeg") and command_exists("ffprobe")):
        return
    prefixed_print("BOOTSTRAP", "warning: ffmpeg/ffprobe not found in PATH; video and some Coqui features may fail")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap local dependencies for Autonomous Prime")
    parser.add_argument("--force-install", action="store_true", help="Reinstall dependencies even if stamps look fresh")
    parser.add_argument("--skip-coqui", action="store_true", help="Skip Coqui environment install")
    args, _ = parser.parse_known_args()

    if not command_exists("npm") and not command_exists("npm.cmd"):
        raise SystemExit("npm is required but was not found in PATH.")

    ensure_python_requirements(force=args.force_install)
    ensure_node_dependencies("ui", ROOT / "ui", force=args.force_install)
    ensure_node_dependencies("api", ROOT / "api", force=args.force_install)
    ensure_node_dependencies("commerce", ROOT / "services" / "commerce-api", force=args.force_install)
    ensure_ffmpeg(force=args.force_install)
    if not args.skip_coqui:
        ensure_coqui_env(force=args.force_install)
    warn_about_missing_ffmpeg()
    prefixed_print("BOOTSTRAP", "dependencies are ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
