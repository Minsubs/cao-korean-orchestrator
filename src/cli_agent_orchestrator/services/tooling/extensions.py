"""Unified listing of CAO and provider-managed extensions.

CAO-owned skills/plugins/profiles and live adapter inventories share the same
wire shape. Each item carries a provider-qualified stable id so a skill seen by
the generic Skills CLI does not collide with a CAO-managed skill of the same
name.

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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, cast

from cli_agent_orchestrator import constants
from cli_agent_orchestrator.plugins.registry import ENTRY_POINT_GROUP
from cli_agent_orchestrator.services import settings_service
from cli_agent_orchestrator.services.tooling import cache
from cli_agent_orchestrator.services.tooling.adapters import registry
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


def _probe_adapter(provider: str, adapter: Any) -> List[Dict[str, Any]]:
    """Collect one adapter's reported extensions. Each adapter shells out to its
    CLI (detect + list), so callers run these concurrently."""
    if not adapter.detect().installed:
        return []
    kind = "skill" if provider == "generic_skills" else "mcp"
    out: List[Dict[str, Any]] = []
    for installed in adapter.list_installed():
        name = installed.get("name")
        if not isinstance(name, str) or not name:
            continue
        description = (
            "Skills CLI에서 감지된 공용 Agent Skill"
            if kind == "skill"
            else f"{adapter.display_name}에 등록된 MCP 서버"
        )
        out.append(
            {
                "id": f"{kind}:{provider}:{name}",
                "kind": kind,
                "name": name,
                "description": description,
                "scope": "user",
                "source_path": None,
                "provider": provider,
                "enabled": True,
            }
        )
    return out


def _collect_provider_extensions() -> List[Dict[str, Any]]:
    """Collect skills/MCP servers reported by installed provider adapters.

    Adapters are probed concurrently (each does independent CLI I/O), then the
    per-adapter results are merged in registry order with cross-adapter dedup —
    preserving the previous serial-loop semantics.
    """
    adapters = list(registry.get_adapters().items())
    with ThreadPoolExecutor(max_workers=max(len(adapters), 1)) as pool:
        per_adapter = list(pool.map(lambda pa: _probe_adapter(pa[0], pa[1]), adapters))

    items: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for chunk in per_adapter:
        for item in chunk:
            key = (item["provider"], item["kind"], item["name"])
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
    return items


_EXTENSIONS_CACHE_KEY = "extensions"


def list_extensions(*, use_cache: bool = True) -> List[Dict[str, Any]]:
    """Return the combined, deterministically sorted CAO extension inventory.

    TTL-cached (mirroring ``providers.list_providers``) so a polling UI does not
    re-probe every adapter on each tab load; ``POST /tooling/scan`` refreshes it.
    """
    store = cache.get_cache()
    if use_cache:
        cached = store.get(_EXTENSIONS_CACHE_KEY)
        if cached is not None:
            return cast(List[Dict[str, Any]], cached)
    extensions = (
        _collect_skills()
        + _collect_plugins()
        + _collect_profiles()
        + _collect_provider_extensions()
    )
    extensions.sort(key=lambda item: (item["kind"], item.get("provider") or "", item["name"]))
    store.set(_EXTENSIONS_CACHE_KEY, extensions)
    return extensions
