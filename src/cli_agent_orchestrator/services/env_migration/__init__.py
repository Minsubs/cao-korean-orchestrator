"""CLI environment migration + instructions-management services (Phase 6b).

Pure, read-mostly filesystem services backing the self-contained ``/env`` router
(``api/env_router.py``). Split into three modules mirroring the three surfaces:

* :mod:`inventory`   -- scan an existing CLI work environment (read-only)
* :mod:`instructions`-- the instruction-file matrix + the one write path
* :mod:`convert`     -- deterministic, no-network conversion previews

Cross-cutting rules enforced here (see the spec):

* **Home confinement.** Every user-supplied path is run through the runner's
  shared ``resolve_within_home`` (imported, never modified) so a caller can
  never reach outside ``$HOME``.
* **Existing files only.** Nothing is reported by guessing a path — a missing
  file/dir is simply absent (``present: false`` / ``exists: false``), never a
  fabricated empty shell.
* **No content in listings.** ``inventory`` and the instructions matrix return
  metadata only. Content is returned solely by explicit convert requests, and
  then only after :func:`~cli_agent_orchestrator.services.tooling.secret_mask.mask`
  redaction.

This package owns no HTTP concerns; the router translates the exceptions defined
in :mod:`errors` into status codes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict


class EnvMigrationError(Exception):
    """Base class for env-migration failures the router maps to HTTP status."""


class PathOutsideHome(EnvMigrationError):
    """A supplied path resolved outside ``$HOME`` (router -> 400)."""


class InvalidInstructionName(EnvMigrationError):
    """A write target's filename is not an allowed instruction file (router -> 400)."""


class ContentTooLarge(EnvMigrationError):
    """A write payload exceeded the size cap (router -> 400)."""


class InstructionExists(EnvMigrationError):
    """A write target exists and ``overwrite`` was not set (router -> 409)."""


class UnsupportedConversion(EnvMigrationError):
    """The (source_kind, target_kind) pair is not a known conversion (router -> 400)."""


class MissingConversionInput(EnvMigrationError):
    """Neither ``path`` nor ``content`` was supplied to a convert request (router -> 400)."""


def home() -> Path:
    """Return the current home directory.

    Indirection over ``Path.home()`` so tests can point every scan at a
    ``tmp_path`` home simply by setting ``$HOME`` (which ``Path.home()`` reads on
    POSIX) — the same confinement basis ``resolve_within_home`` uses.
    """
    return Path.home()


def rel_to_home(path: Path, base: Path) -> str:
    """Return ``path`` as a POSIX-style string relative to ``base`` (home).

    Falls back to the absolute string if ``path`` is not under ``base`` (should
    not happen for home-rooted scans, but keeps the helper total).
    """
    try:
        return path.relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()


def iso_utc(timestamp: float) -> str:
    """Render a filesystem mtime (epoch seconds) as an ISO-8601 UTC string."""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def file_meta(path: Path) -> Dict[str, object]:
    """Return ``{"size", "mtime"}`` for an existing file.

    Callers guard existence first; a stat failure is surfaced as zero size and a
    null mtime rather than raising, so one unreadable file cannot abort a scan.
    """
    try:
        stat = path.stat()
    except OSError:
        return {"size": 0, "mtime": None}
    return {"size": stat.st_size, "mtime": iso_utc(stat.st_mtime)}
