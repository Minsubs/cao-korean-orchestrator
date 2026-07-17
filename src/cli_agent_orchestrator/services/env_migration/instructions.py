"""Instruction-file matrix + the single instruction write path (Phase 6b).

The matrix (:func:`build_matrix`) reports, per scope, whether the well-known
instruction files exist and — for existing files — a small drift-comparison
fingerprint (``sha256``) plus a one-line ``headline`` (secret-masked). It returns
**no full content**.

The write path (:func:`write_instruction`) is the one and only mutating operation
in the whole ``/env`` surface. It is home-confined, filename-restricted, size-
capped, atomic (temp file + ``os.replace``), and backs up any file it overwrites.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from cli_agent_orchestrator.services.env_migration import (
    ContentTooLarge,
    InstructionExists,
    InvalidInstructionName,
    PathOutsideHome,
    file_meta,
    home,
)
from cli_agent_orchestrator.services.tooling.runner import resolve_within_home
from cli_agent_orchestrator.services.tooling.secret_mask import mask

# Per-item error for a project path that escapes $HOME (the whole request still
# returns 200 — only the offending entry carries this).
OUTSIDE_HOME_MESSAGE = "홈 디렉터리 밖 경로는 다룰 수 없어요"

# Global instruction files, as (base subdir under $HOME, filename).
_GLOBAL_FILES = ((".claude", "CLAUDE.md"), (".codex", "AGENTS.md"))

# Per-project instruction files checked under each requested project path.
_PROJECT_FILES = ("CLAUDE.md", "AGENTS.md")
_PROJECT_COMMANDS = (".claude", "commands")

# Write cap: 256 KiB. An instruction file far larger than this is almost
# certainly not hand-authored guidance; reject rather than persist it.
_MAX_WRITE_BYTES = 256 * 1024

# Filenames the write path accepts: the two instruction files by exact name, or
# any ``*.md``. Anything else (``settings.json``, ``config.toml``, ...) is refused
# so this path can only ever touch markdown guidance.
_ALLOWED_EXACT = {"CLAUDE.md", "AGENTS.md"}


def _headline(text: str) -> Optional[str]:
    """First non-empty line, secret-masked, truncated to 80 chars (or None)."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return mask(stripped)[:80]
    return None


def _file_entry(path: Path, name: str) -> Dict[str, object]:
    """Build a matrix file entry: existence + (for existing files) drift metadata.

    ``sha256`` and ``headline`` are populated only when the file exists and is
    readable; the fingerprint is over the raw bytes, the headline over the
    decoded first line (secret-masked).
    """
    entry: Dict[str, object] = {
        "name": name,
        "exists": path.is_file(),
        "size": None,
        "mtime": None,
        "sha256": None,
        "headline": None,
    }
    if not path.is_file():
        return entry
    entry.update(file_meta(path))
    try:
        raw = path.read_bytes()
    except OSError:
        return entry
    entry["sha256"] = hashlib.sha256(raw).hexdigest()
    entry["headline"] = _headline(raw.decode("utf-8", errors="replace"))
    return entry


def _commands_entry(base: Path) -> Dict[str, object]:
    """Build the ``.claude/commands`` directory entry (existence + command count)."""
    commands_dir = base.joinpath(*_PROJECT_COMMANDS)
    exists = commands_dir.is_dir()
    command_count = len(list(commands_dir.glob("*.md"))) if exists else 0
    return {
        "name": "/".join(_PROJECT_COMMANDS),
        "exists": exists,
        "is_dir": True,
        "size": None,
        "mtime": None,
        "sha256": None,
        "headline": None,
        "command_count": command_count,
    }


def _global_entry(base: Path) -> Dict[str, object]:
    """Build the single global-scope entry covering the well-known global files."""
    files = [
        _file_entry(base / subdir / name, f"{subdir}/{name}") for subdir, name in _GLOBAL_FILES
    ]
    return {"scope": "global", "base_path": str(base), "files": files}


def _project_entry(raw_path: str) -> Dict[str, object]:
    """Build one project-scope entry, or a per-item error if it escapes $HOME."""
    try:
        resolved = resolve_within_home(raw_path)
    except ValueError:
        return {"scope": "project", "base_path": raw_path, "error": OUTSIDE_HOME_MESSAGE}

    base = Path(resolved)
    files = [_file_entry(base / name, name) for name in _PROJECT_FILES]
    files.append(_commands_entry(base))
    return {"scope": "project", "base_path": str(base), "files": files}


def build_matrix(project_paths: List[str]) -> Dict[str, object]:
    """Return ``{"entries": [global, *projects]}`` for the instruction matrix.

    A blank/whitespace project path is skipped. A project path outside ``$HOME``
    produces an entry carrying ``error`` (not a 400) so one bad path does not
    sink the whole matrix.
    """
    entries: List[Dict[str, object]] = [_global_entry(home())]
    for raw_path in project_paths:
        if raw_path and raw_path.strip():
            entries.append(_project_entry(raw_path.strip()))
    return {"entries": entries}


def _validate_write_name(path: Path) -> None:
    """Raise :class:`InvalidInstructionName` unless the filename is an allowed one."""
    name = path.name
    if name in _ALLOWED_EXACT:
        return
    if name.endswith(".md") and len(name) > len(".md"):
        return
    raise InvalidInstructionName(
        f"허용되지 않는 파일명이에요: {name!r} (CLAUDE.md / AGENTS.md / *.md만 기록할 수 있어요)"
    )


def write_instruction(path: str, content: str, overwrite: bool = False) -> Dict[str, object]:
    """Write ``content`` to an instruction file, home-confined and atomic.

    Order of checks: home confinement, filename allow-list, size cap, then the
    overwrite/backup decision. On overwrite a ``<name>.bak.<UTC-stamp>`` copy is
    made in the same directory before the new bytes land. The write itself goes
    to a temp file in the target directory and is ``os.replace``d into place so a
    failure never leaves a half-written instruction file.

    Raises:
        PathOutsideHome: ``path`` resolved outside ``$HOME``.
        InvalidInstructionName: filename is not CLAUDE.md / AGENTS.md / ``*.md``.
        ContentTooLarge: encoded content exceeded the 256 KiB cap.
        InstructionExists: target exists and ``overwrite`` is False.
    """
    try:
        resolved = resolve_within_home(path)
    except ValueError as exc:
        raise PathOutsideHome(OUTSIDE_HOME_MESSAGE) from exc

    target = Path(resolved)
    _validate_write_name(target)

    encoded = content.encode("utf-8")
    if len(encoded) > _MAX_WRITE_BYTES:
        raise ContentTooLarge(
            f"내용이 너무 커요: {len(encoded)} bytes (최대 {_MAX_WRITE_BYTES} bytes)"
        )

    exists = target.exists()
    if exists and not overwrite:
        raise InstructionExists(f"이미 파일이 있어요: {target} (overwrite=true로 덮어쓸 수 있어요)")

    backup_path: Optional[str] = None
    if exists and overwrite:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = target.with_name(f"{target.name}.bak.{stamp}")
        backup.write_bytes(target.read_bytes())
        backup_path = str(backup)

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encoded)
        os.replace(tmp_name, target)
    except OSError:
        # Best-effort cleanup of the temp file; never mask the original error.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    return {
        "written": True,
        "path": str(target),
        "backup_path": backup_path,
        "bytes": len(encoded),
        "created": not exists,
    }
