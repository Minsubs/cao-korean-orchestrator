"""Aggregated source inventory for the "Sources" tab (Phase 6c).

Single read-only collector behind ``GET /tooling/sources``. It answers *where*
skills / commands / prompts come from with real filesystem data — never a
guessed path or an empty-shell entry:

* **directory_sources** — the CAO skill-store directories (reusing
  :func:`extensions._skill_store_dirs`, scope ``store``/``user``) plus the
  well-known CLI home directories (Claude ``commands``/``skills``/``agents`` and
  Codex ``prompts``, the same rules :mod:`env_migration.inventory` scans). Each
  entry reports ``exists`` (the directory is really there) and ``count``
  (matching items), so a missing directory is surfaced as ``exists: false``
  rather than omitted or faked. Home paths are ``~``-abbreviated.
* **catalog** — a count + kind distribution of the curated catalog
  (:mod:`catalog`); the list itself stays owned by ``GET /tooling/catalog``.
* **marketplaces** — per-CLI plugin-marketplace listing. Only providers that
  actually have the concept appear (Claude Code); the listing is delegated to
  the provider adapter, which shells out through the write-path runner (masked,
  allowlisted) and parses conservatively. A CLI without the concept (Codex,
  Antigravity) is omitted — never emitted as a fake empty entry.

Directory scanning is immediate; only the marketplace probe is TTL-cached (in
the adapter), so a polling UI does not re-shell on every request.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from cli_agent_orchestrator.services.env_migration import home
from cli_agent_orchestrator.services.tooling import catalog
from cli_agent_orchestrator.services.tooling.adapters import registry
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.extensions import _skill_store_dirs

_CATALOG_ORIGIN = "builtin-curated"
_CATALOG_NOTE = "네트워크 조회 없는 내장 큐레이션 목록이에요"


def _abbreviate_home(path: Path) -> str:
    """Return ``path`` with the home prefix collapsed to ``~`` (POSIX style)."""
    base = home()
    try:
        rel = path.relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()
    return "~" if rel == "." else f"~/{rel}"


def _count_glob_files(directory: Path, pattern: str) -> int:
    """Count files matching ``pattern`` directly under ``directory`` (0 if absent)."""
    if not directory.is_dir():
        return 0
    return sum(1 for entry in directory.glob(pattern) if entry.is_file())


def _count_skill_dirs(directory: Path) -> int:
    """Count skill folders (``<name>/SKILL.md``) under ``directory`` (0 if absent).

    Mirrors the ``skills/<name>/SKILL.md`` rule used by both
    :func:`extensions._collect_skills` and :mod:`env_migration.inventory`.
    """
    if not directory.is_dir():
        return 0
    count = 0
    for child in directory.iterdir():
        if child.is_dir() and ((child / "SKILL.md").is_file() or (child / "skill.md").is_file()):
            count += 1
    return count


def _store_sources() -> List[Dict[str, Any]]:
    """Directory entries for the CAO skill-store dirs (scope ``store``/``user``)."""
    entries: List[Dict[str, Any]] = []
    for directory, raw_scope in _skill_store_dirs():
        entries.append(
            {
                "path": _abbreviate_home(directory),
                # ``_skill_store_dirs`` classifies the managed global store as
                # "built-in"; surface it as "store" (the store tab's vocabulary).
                "scope": "store" if raw_scope == "built-in" else raw_scope,
                "kind": "skills",
                "count": _count_skill_dirs(directory),
                "exists": directory.is_dir(),
            }
        )
    return entries


def _cli_entry(directory: Path, cli: str, kind: str, count: int) -> Dict[str, Any]:
    return {
        "path": _abbreviate_home(directory),
        "cli": cli,
        "kind": kind,
        "count": count,
        "exists": directory.is_dir(),
    }


def _cli_sources() -> List[Dict[str, Any]]:
    """Directory entries for the well-known CLI home dirs (Claude, Codex)."""
    base = home()
    claude = base / ".claude"
    codex = base / ".codex"
    return [
        _cli_entry(
            claude / "commands",
            "claude_code",
            "commands",
            _count_glob_files(claude / "commands", "*.md"),
        ),
        _cli_entry(
            claude / "skills", "claude_code", "skills", _count_skill_dirs(claude / "skills")
        ),
        _cli_entry(
            claude / "agents", "claude_code", "agents", _count_glob_files(claude / "agents", "*.md")
        ),
        _cli_entry(
            codex / "prompts", "codex", "prompts", _count_glob_files(codex / "prompts", "*.md")
        ),
    ]


def _directory_sources() -> List[Dict[str, Any]]:
    return _store_sources() + _cli_sources()


def _catalog_summary() -> Dict[str, Any]:
    """Count + kind distribution of the curated catalog (no shell-out).

    Reads the static ``catalog._ITEMS`` table directly rather than via
    ``catalog.list_catalog()``, so a source count never triggers the per-provider
    ``list_installed`` shell-outs that endpoint performs — the list itself stays
    owned by ``GET /tooling/catalog``.
    """
    kinds: Dict[str, int] = {}
    total = 0
    for item in catalog._ITEMS:
        total += 1
        kinds[item.kind] = kinds.get(item.kind, 0) + 1
    return {"count": total, "kinds": kinds, "origin": _CATALOG_ORIGIN, "note": _CATALOG_NOTE}


async def _marketplaces() -> Dict[str, Any]:
    """Per-CLI marketplace listing; only CLIs that have the concept are included."""
    result: Dict[str, Any] = {}
    adapter = registry.get_adapter("claude_code")
    if isinstance(adapter, ClaudeCodeAdapter):
        result["claude_code"] = await adapter.marketplace_list()
    # Codex / Antigravity have no plugin-marketplace concept — omit them entirely
    # rather than emit a fabricated empty entry.
    return result


async def collect_sources() -> Dict[str, Any]:
    """Assemble the full ``GET /tooling/sources`` payload."""
    return {
        "directory_sources": _directory_sources(),
        "catalog": _catalog_summary(),
        "marketplaces": await _marketplaces(),
    }
