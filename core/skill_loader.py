from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AGENTS_ROOT = Path("Agents")
AGENT_FOLDER_MAP = {
    "content_agent": "Agent_Veronica",
    "image_agent": "Agent_John",
    "voice_agent": "Agent_Maya",
    "video_agent": "Agent_Luca",
    "distribution_agent": "Agent_Sage",
}


@dataclass
class SkillPack:
    name: str
    path: Path
    task_types: list[str]
    prompt: str = ""
    template: str = ""
    references: str = ""

    def applies_to(self, task_type: str | None) -> bool:
        return not task_type or not self.task_types or task_type in self.task_types

    def combined_text(self) -> str:
        parts = [self.prompt.strip(), self.template.strip(), self.references.strip()]
        return "\n\n".join(part for part in parts if part)


def profile_dir_for_agent(agent_id: str) -> Path:
    direct = AGENTS_ROOT / AGENT_FOLDER_MAP.get(agent_id, agent_id)
    if direct.exists():
        return direct
    for path in AGENTS_ROOT.glob("*/agent.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if payload.get("agent_id") == agent_id:
            return path.parent
    return direct


def load_skill_packs(agent_id: str) -> tuple[Path, list[SkillPack]]:
    profile_dir = profile_dir_for_agent(agent_id)
    skill_dir = profile_dir / "Skills"
    if not skill_dir.exists():
        return profile_dir, []

    packs: list[SkillPack] = []
    for folder in sorted(path for path in skill_dir.iterdir() if path.is_dir()):
        manifest_path = folder / "manifest.json"
        manifest: dict[str, Any] = {}
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                manifest = {}
        prompt = _read_first(folder, ["prompt.md", "prompt.txt", "system.md"])
        template = _read_first(folder, ["template.md", "template.txt"])
        references = _read_first(folder, ["references.md", "reference.md", "notes.md"])
        packs.append(
            SkillPack(
                name=manifest.get("name", folder.name),
                path=folder,
                task_types=list(manifest.get("task_types", [])),
                prompt=prompt,
                template=template,
                references=references,
            )
        )
    return profile_dir, packs


def render_skill_context(agent_id: str, task_type: str | None = None) -> str:
    _, packs = load_skill_packs(agent_id)
    relevant = [pack for pack in packs if pack.applies_to(task_type)]
    if not relevant:
        return ""
    blocks = []
    for pack in relevant:
        text = pack.combined_text()
        if text:
            blocks.append(f"[{pack.name}]\n{text}")
    return "\n\n".join(blocks).strip()


def _read_first(folder: Path, names: list[str]) -> str:
    for name in names:
        path = folder / name
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    return ""
