"""Unified listing of CAO-owned extensions (skills, plugins, agent profiles).

Phase 3a lists only assets CAO itself owns; provider-native extensions are
Phase 5 and are simply not emitted here (the list omits them rather than
inventing empty entries). Each item carries a stable ``kind:name`` id.

Reuse:
    * skills   -- validated via :func:`utils.skills.validate_skill_folder` over
      the documented catalog inputs (``SKILLS_DIR`` + ``extra_skill_dirs``);
      scope is by install location (global store = built-in, extras = user).
    * plugins  -- discovered via the ``cao.plugins`` entry-point group (the same
      mechanism the registry uses) WITHOUT loading/instantiating them; the five
      pyproject entry points are scope=built-in.
    * profiles -- :func:`utils.agent_profiles.list_agent_profiles`, preserving
      ``source`` and ``duplicated_in``.
"""

from __future__ import annotations

import importlib.metadata
from pathlib import Path
from typing import Any, Dict, List

from cli_agent_orchestrator import constants
from cli_agent_orchestrator.plugins.registry import ENTRY_POINT_GROUP
from cli_agent_orchestrator.services import settings_service
from cli_agent_orchestrator.utils.agent_profiles import list_agent_profiles
from cli_agent_orchestrator.utils.skills import validate_skill_folder


def _skill_store_dirs() -> List[tuple[Path, str]]:
    """Return ``(directory, scope)`` pairs in resolution order.

    Mirrors ``utils.skills`` catalog inputs: the global store first (classified
    ``built-in`` — the managed install location), then user-added
    ``extra_skill_dirs`` (classified ``user``).
    """
    dirs: List[tuple[Path, str]] = [(constants.SKILLS_DIR, "built-in")]
    dirs.extend((Path(extra), "user") for extra in settings_service.get_extra_skill_dirs())
    return dirs


def _collect_skills() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for directory, scope in _skill_store_dirs():
        if not directory.is_dir():
            continue
        for entry in sorted(directory.iterdir(), key=lambda path: path.name):
            if not entry.is_dir() or entry.name in seen:
                continue
            if not (entry / "SKILL.md").is_file():
                continue
            try:
                metadata = validate_skill_folder(entry)
            except Exception:
                # Malformed skill folders are surfaced by diagnostics, not here;
                # first-valid-wins matches utils.skills.list_skills().
                continue
            seen.add(entry.name)
            items.append(
                {
                    "id": f"skill:{metadata.name}",
                    "kind": "skill",
                    "name": metadata.name,
                    "description": metadata.description,
                    "scope": scope,
                    "source_path": str(entry),
                    "provider": "cao",
                    "enabled": True,
                }
            )
    return items


def _collect_plugins() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for entry_point in importlib.metadata.entry_points(group=ENTRY_POINT_GROUP):
        items.append(
            {
                "id": f"plugin:{entry_point.name}",
                "kind": "plugin",
                "name": entry_point.name,
                "description": "",
                "scope": "built-in",
                "source_path": entry_point.value,
                "provider": "cao",
                "enabled": True,
            }
        )
    return items


def _collect_profiles() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for profile in list_agent_profiles():
        source = profile.get("source")
        items.append(
            {
                "id": f"profile:{profile['name']}",
                "kind": "profile",
                "name": profile["name"],
                "description": profile.get("description", ""),
                "scope": "built-in" if source == "built-in" else "user",
                "source_path": None,
                "provider": "cao",
                "enabled": True,
                # Preserved from list_agent_profiles for the UI's "also defined
                # in …" affordance (GH #280).
                "source": source,
                "duplicated_in": profile.get("duplicated_in", []),
            }
        )
    return items


def list_extensions() -> List[Dict[str, Any]]:
    """Return the combined, deterministically sorted CAO extension inventory."""
    extensions = _collect_skills() + _collect_plugins() + _collect_profiles()
    extensions.sort(key=lambda item: (item["kind"], item["name"]))
    return extensions
