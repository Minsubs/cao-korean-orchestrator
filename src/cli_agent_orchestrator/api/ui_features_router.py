"""UI-features API router (Phase 2d+2e).

Self-contained ``APIRouter`` with a ``/ui`` prefix. It is NOT mounted here — the
integration owner wires it into ``api/main.py`` via
``app.include_router(ui_features_router.router)``. Keeping it standalone lets the
context-gauge and slash-command surfaces ship without touching ``main.py``.

Both endpoints are read-only and gated to any authenticated scope
(READ/WRITE/ADMIN); neither mutates server state.

Endpoints:
    GET /ui/terminals/{terminal_id}/context  -- remaining-context gauge (display only)
    GET /ui/slash-commands?provider=&cwd=     -- enumerated slash commands + builtins

Design notes:
    * The context gauge is DISPLAY ONLY. ``percent_left`` is a best-effort scrape
      of the CLI's own footer chrome (see ``BaseProvider.get_context_usage``); it
      is ``null`` whenever no footer matched, and the frontend hides the gauge
      then. It must never drive an orchestration decision.
    * Slash-command enumeration is filesystem-only and read-only. Project command
      scanning is home-confined via ``runner.resolve_within_home`` (imported, not
      modified): a ``cwd`` outside ``$HOME`` silently skips the project scan
      rather than erroring, so a caller cannot probe paths outside the home dir.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException

from cli_agent_orchestrator.clients.database import get_terminal_metadata
from cli_agent_orchestrator.providers.manager import provider_manager
from cli_agent_orchestrator.security.auth import (
    SCOPE_ADMIN,
    SCOPE_READ,
    SCOPE_WRITE,
    require_any_scope,
)
from cli_agent_orchestrator.services.status_monitor import status_monitor
from cli_agent_orchestrator.services.tooling.runner import resolve_within_home

router = APIRouter(prefix="/ui", tags=["ui"])


# --- 2d: context gauge ----------------------------------------------------


@router.get("/terminals/{terminal_id}/context")
async def get_terminal_context(
    terminal_id: str,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Return the remaining-context gauge for a terminal (display only).

    Resolves the terminal's provider, reads the StatusMonitor's rolling buffer,
    and asks the provider to scrape its remaining-context footer. ``percent_left``
    is ``null`` when the terminal's provider has no footer (e.g. Codex today) or
    no footer is currently visible in the buffer; the frontend hides the gauge in
    that case. Raises 404 when the terminal does not exist.
    """
    metadata = get_terminal_metadata(terminal_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail=f"terminal not found: {terminal_id!r}")

    percent_left: Optional[int] = None
    try:
        provider = provider_manager.get_provider(terminal_id)
    except ValueError:
        # The terminal exists (metadata found) but its provider could not be
        # resolved — report "no gauge" rather than a spurious 404.
        provider = None
    if provider is not None:
        buffer = status_monitor.get_buffer(terminal_id)
        percent_left = provider.get_context_usage(buffer)

    return {
        "terminal_id": terminal_id,
        "percent_left": percent_left,
        "source": "footer",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


# --- 2e: slash-command enumeration ----------------------------------------

# Providers this surface knows how to enumerate. Any other value is a 400.
_SLASH_PROVIDERS = frozenset({"claude_code", "codex"})

# Closed-set built-in commands per provider, as (name, interactive, description).
# These are the CLI's own built-ins (not filesystem-defined); they always carry
# scope="builtin", kind="command". ``interactive=True`` marks a command that
# opens a picker in the CLI and therefore needs the UI to have a terminal
# selected before it can be run ("터미널 선택 필요").
_CLAUDE_BUILTINS: List[Tuple[str, bool, str]] = [
    ("/compact", False, "Compact the conversation to reclaim context"),
    ("/clear", False, "Clear the conversation history"),
    ("/model", True, "Switch the active model"),
    ("/review", False, "Review pending changes"),
    ("/init", False, "Generate a CLAUDE.md for the project"),
    ("/cost", False, "Show token usage and cost"),
    ("/agents", True, "Manage or switch subagents"),
    ("/help", False, "List available commands"),
]
_CODEX_BUILTINS: List[Tuple[str, bool, str]] = [
    ("/compact", False, "Compact the conversation to reclaim context"),
    ("/new", False, "Start a new conversation"),
    ("/diff", False, "Show the working-tree diff"),
    ("/model", True, "Switch the active model"),
    ("/review", False, "Review pending changes"),
    ("/quit", False, "Exit Codex"),
]

# TTL cache: (provider, cwd) -> (monotonic_stamp, commands). Enumeration hits the
# filesystem, so a short TTL keeps a polling frontend from re-walking the dirs on
# every keystroke. 30s per spec.
_SLASH_CACHE_TTL_S = 30.0
_SLASH_CACHE: Dict[Tuple[str, Optional[str]], Tuple[float, List[Dict[str, Any]]]] = {}
_SLASH_CACHE_LOCK = threading.Lock()


@router.get("/slash-commands")
async def get_slash_commands(
    provider: str,
    cwd: Optional[str] = None,
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    """Enumerate slash commands for a provider (built-ins + filesystem-defined).

    ``provider`` must be one of the supported values (else 400). ``cwd`` enables
    the project-scope scan (``{cwd}/.claude/commands``) for claude_code; a cwd
    outside ``$HOME`` skips that scan (no error). Results are TTL-cached for 30s.
    """
    if provider not in _SLASH_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"unsupported provider: {provider!r}")

    commands = _enumerate_cached(provider, cwd)
    return {"provider": provider, "cwd": cwd, "commands": commands}


def _enumerate_cached(provider: str, cwd: Optional[str]) -> List[Dict[str, Any]]:
    """Return enumerated commands for ``(provider, cwd)``, served from a 30s TTL cache."""
    key = (provider, cwd)
    now = time.monotonic()
    with _SLASH_CACHE_LOCK:
        cached = _SLASH_CACHE.get(key)
        if cached is not None and (now - cached[0]) < _SLASH_CACHE_TTL_S:
            return cached[1]

    commands = _collect_slash_commands(provider, cwd)

    with _SLASH_CACHE_LOCK:
        _SLASH_CACHE[key] = (now, commands)
    return commands


def _collect_slash_commands(provider: str, cwd: Optional[str]) -> List[Dict[str, Any]]:
    """Build the command list: built-ins first, then user/project/skill entries."""
    home = Path.home()
    commands: List[Dict[str, Any]] = []

    if provider == "claude_code":
        commands.extend(_builtin_items(_CLAUDE_BUILTINS))
        commands.extend(_scan_command_dir(home / ".claude" / "commands", "user"))
        project_dir = _project_commands_dir(cwd)
        if project_dir is not None:
            commands.extend(_scan_command_dir(project_dir, "project"))
        commands.extend(_scan_skill_dirs(home / ".claude" / "skills", "user"))
    elif provider == "codex":
        commands.extend(_builtin_items(_CODEX_BUILTINS))
        commands.extend(_scan_command_dir(home / ".codex" / "prompts", "user"))

    return commands


def _builtin_items(specs: List[Tuple[str, bool, str]]) -> List[Dict[str, Any]]:
    """Materialize the closed built-in list into command items."""
    return [
        {
            "name": name,
            "scope": "builtin",
            "kind": "command",
            "description": description,
            "interactive": interactive,
        }
        for name, interactive, description in specs
    ]


def _project_commands_dir(cwd: Optional[str]) -> Optional[Path]:
    """Resolve ``{cwd}/.claude/commands`` when cwd is inside $HOME, else None.

    A cwd outside the home directory (or an unresolvable one) returns None so the
    caller simply skips the project scan — never a 400. Uses the runner's shared
    home-confinement check so the boundary matches the write path exactly.
    """
    if not cwd:
        return None
    try:
        resolved = resolve_within_home(cwd)
    except ValueError:
        return None
    return Path(resolved) / ".claude" / "commands"


def _scan_command_dir(directory: Path, scope: str) -> List[Dict[str, Any]]:
    """Enumerate ``*.md`` command files in ``directory`` (non-recursive, sorted)."""
    if not directory.is_dir():
        return []
    items: List[Dict[str, Any]] = []
    for md_path in sorted(directory.glob("*.md")):
        if not md_path.is_file():
            continue
        items.append(
            {
                "name": f"/{md_path.stem}",
                "scope": scope,
                "kind": "command",
                "description": _extract_description(md_path),
                "interactive": False,
            }
        )
    return items


def _scan_skill_dirs(directory: Path, scope: str) -> List[Dict[str, Any]]:
    """Enumerate skill directories under ``directory`` (each subdir = one skill)."""
    if not directory.is_dir():
        return []
    items: List[Dict[str, Any]] = []
    for skill_dir in sorted(directory.iterdir()):
        if not skill_dir.is_dir():
            continue
        description: Optional[str] = None
        for candidate in ("SKILL.md", "skill.md"):
            skill_md = skill_dir / candidate
            if skill_md.is_file():
                description = _extract_description(skill_md)
                break
        items.append(
            {
                "name": f"/{skill_dir.name}",
                "scope": scope,
                "kind": "skill",
                "description": description,
                "interactive": False,
            }
        )
    return items


# Matches a ``description:`` key inside a leading ``---`` YAML frontmatter block.
_FRONTMATTER_DESCRIPTION_RE = re.compile(r"\s*description\s*:\s*(.+?)\s*$")


def _extract_description(md_path: Path) -> Optional[str]:
    """Best-effort one-line description for a command/skill markdown file.

    Preference order: a ``description:`` key in a leading ``---`` frontmatter
    block, else the first non-empty body line truncated to 60 chars. Any read
    failure (or an empty file) yields None — never a raise.
    """
    try:
        text = md_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    lines = text.splitlines()
    body_start = 0
    if lines and lines[0].strip() == "---":
        closing: Optional[int] = None
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                closing = i
                break
            match = _FRONTMATTER_DESCRIPTION_RE.match(lines[i])
            if match:
                value = match.group(1).strip().strip("'\"").strip()
                if value:
                    return value[:200]
        body_start = (closing + 1) if closing is not None else len(lines)

    for line in lines[body_start:]:
        stripped = line.strip()
        if stripped:
            return stripped[:60]
    return None
