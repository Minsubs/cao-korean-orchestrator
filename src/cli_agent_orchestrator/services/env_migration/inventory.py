"""Read-only inventory of an existing CLI work environment (Phase 6b).

Scans the well-known home directories of the ``claude_code`` / ``codex`` /
``antigravity`` CLIs and reports the *metadata* of every file that actually
exists — never file content, never a guessed path. A CLI whose base directory is
absent reports ``present: false`` with an empty item list.

Path notes:

* Every scanned path is rooted at :func:`~cli_agent_orchestrator.services.env_migration.home`,
  so the scan is inherently home-confined (the ``cli`` argument is a closed enum;
  no user-supplied path reaches the filesystem here).
* ``rel_path`` on each item is the file's path relative to ``$HOME``.

Antigravity note: the only code-verified ``agy`` configuration path is
``~/.gemini/config/mcp_config.json`` (see ``providers/antigravity_cli.py`` and
``services/tooling/adapters/antigravity.py``). No instruction/prompt path is
established for ``agy``, so none is scanned — the response carries a ``note``
saying so rather than fabricating entries.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

from cli_agent_orchestrator.services.env_migration import file_meta, home, rel_to_home

CLI_CLAUDE_CODE = "claude_code"
CLI_CODEX = "codex"
CLI_ANTIGRAVITY = "antigravity"

# Scannable CLIs, in a stable order for the ``all`` response.
SUPPORTED_CLIS = (CLI_CLAUDE_CODE, CLI_CODEX, CLI_ANTIGRAVITY)

_ANTIGRAVITY_NOTE = (
    "agy의 코드로 확인된 설정 경로는 ~/.gemini/config/mcp_config.json (MCP 설정)뿐이에요. "
    "지침/프롬프트 경로는 확인되지 않아 스캔하지 않았어요."
)


def _file_item(path: Path, base: Path, kind: str) -> Optional[Dict[str, object]]:
    """Build one inventory item for ``path`` if it is an existing file, else None."""
    if not path.is_file():
        return None
    item: Dict[str, object] = {"rel_path": rel_to_home(path, base), "kind": kind}
    item.update(file_meta(path))
    return item


def _mcp_config_item(path: Path, base: Path) -> Optional[Dict[str, object]]:
    """Build an ``mcp_config`` item, reporting only whether ``mcpServers`` is present.

    The file is read solely to test for the top-level ``mcpServers`` key; its
    content is never returned. A parse/read failure yields
    ``mcp_servers_present: false`` rather than raising.
    """
    if not path.is_file():
        return None
    present = False
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        present = isinstance(data, dict) and "mcpServers" in data
    except (OSError, ValueError):
        present = False
    item: Dict[str, object] = {
        "rel_path": rel_to_home(path, base),
        "kind": "mcp_config",
        "mcp_servers_present": present,
    }
    item.update(file_meta(path))
    return item


def _scan_dir(directory: Path, pattern: str, base: Path, kind: str) -> List[Dict[str, object]]:
    """Return items for every file matching ``pattern`` under ``directory`` (sorted)."""
    if not directory.is_dir():
        return []
    items: List[Dict[str, object]] = []
    for path in sorted(directory.glob(pattern)):
        item = _file_item(path, base, kind)
        if item is not None:
            items.append(item)
    return items


def _scan_skills(skills_dir: Path, base: Path) -> List[Dict[str, object]]:
    """Return one ``skill`` item per ``skills/<name>/SKILL.md`` (or ``skill.md``)."""
    if not skills_dir.is_dir():
        return []
    items: List[Dict[str, object]] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        for candidate in ("SKILL.md", "skill.md"):
            item = _file_item(skill_dir / candidate, base, "skill")
            if item is not None:
                items.append(item)
                break
    return items


def _counts(items: List[Dict[str, object]]) -> Dict[str, int]:
    """Summarise items as ``{"total", <kind>: n, ...}``."""
    counts: Dict[str, int] = {"total": len(items)}
    for item in items:
        kind = str(item["kind"])
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def _scan_claude_code(base: Path) -> Dict[str, object]:
    claude = base / ".claude"
    claude_json = base / ".claude.json"
    present = claude.is_dir() or claude_json.is_file()

    items: List[Dict[str, object]] = []
    instruction = _file_item(claude / "CLAUDE.md", base, "instruction")
    if instruction is not None:
        items.append(instruction)
    settings = _file_item(claude / "settings.json", base, "settings")
    if settings is not None:
        items.append(settings)
    items.extend(_scan_dir(claude / "commands", "*.md", base, "command"))
    items.extend(_scan_skills(claude / "skills", base))
    items.extend(_scan_dir(claude / "agents", "*.md", base, "agent"))
    mcp = _mcp_config_item(claude_json, base)
    if mcp is not None:
        items.append(mcp)

    return {
        "cli": CLI_CLAUDE_CODE,
        "present": present,
        "items": items,
        "counts": _counts(items),
        "note": None,
    }


def _scan_codex(base: Path) -> Dict[str, object]:
    codex = base / ".codex"
    present = codex.is_dir()

    items: List[Dict[str, object]] = []
    settings = _file_item(codex / "config.toml", base, "settings")
    if settings is not None:
        items.append(settings)
    instruction = _file_item(codex / "AGENTS.md", base, "instruction")
    if instruction is not None:
        items.append(instruction)
    items.extend(_scan_dir(codex / "prompts", "*.md", base, "prompt"))

    return {
        "cli": CLI_CODEX,
        "present": present,
        "items": items,
        "counts": _counts(items),
        "note": None,
    }


def _scan_antigravity(base: Path) -> Dict[str, object]:
    gemini = base / ".gemini"
    present = gemini.is_dir()

    items: List[Dict[str, object]] = []
    mcp = _mcp_config_item(gemini / "config" / "mcp_config.json", base)
    if mcp is not None:
        items.append(mcp)

    return {
        "cli": CLI_ANTIGRAVITY,
        "present": present,
        "items": items,
        "counts": _counts(items),
        "note": _ANTIGRAVITY_NOTE,
    }


_SCANNERS = {
    CLI_CLAUDE_CODE: _scan_claude_code,
    CLI_CODEX: _scan_codex,
    CLI_ANTIGRAVITY: _scan_antigravity,
}


def scan_inventory(cli: str) -> Dict[str, object]:
    """Scan one CLI's environment. Raises ``ValueError`` for an unknown ``cli``."""
    scanner = _SCANNERS.get(cli)
    if scanner is None:
        raise ValueError(f"unsupported cli: {cli!r}")
    return scanner(home())


def scan_all() -> Dict[str, object]:
    """Scan every supported CLI, returning ``{"clis": [<per-cli result>, ...]}``."""
    base = home()
    return {"clis": [_SCANNERS[cli](base) for cli in SUPPORTED_CLIS]}
