"""Host environment detection for the Tooling screen.

Reports OS / version / arch / shell / WSL plus the CAO server and Python
versions. Detection is best-effort: any field that cannot be determined is
reported as ``null`` rather than guessed. Results are TTL-cached (see
:mod:`.cache`).
"""

from __future__ import annotations

import os
import platform
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Dict, cast

from cli_agent_orchestrator.services.tooling import cache

# The installed distribution whose metadata version is reported as the server
# version (pyproject ``[project].name``).
_DISTRIBUTION_NAME = "cli-agent-orchestrator"
_CACHE_KEY = "environment"

# platform.system() -> friendly OS label.
_OS_LABELS = {"Darwin": "macOS", "Windows": "Windows", "Linux": "Linux"}


def _read_proc_version() -> str | None:
    """Return the contents of ``/proc/version``, or ``None`` if unreadable.

    Isolated as a seam so WSL detection can be exercised deterministically.
    """
    try:
        return Path("/proc/version").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _detect_os() -> str | None:
    system = platform.system()
    if not system:
        return None
    return _OS_LABELS.get(system, system)


def _detect_os_version() -> str | None:
    if platform.system() == "Darwin":
        return platform.mac_ver()[0] or None
    return platform.release() or None


def _detect_arch() -> str | None:
    return platform.machine() or None


def _detect_shell() -> str | None:
    return os.environ.get("SHELL") or None


def _detect_is_wsl() -> bool:
    """Detect WSL by looking for ``microsoft`` in ``/proc/version`` (Linux only)."""
    if platform.system() != "Linux":
        return False
    text = _read_proc_version()
    if text is None:
        return False
    return "microsoft" in text.lower()


def _detect_server_version() -> str | None:
    try:
        return version(_DISTRIBUTION_NAME)
    except PackageNotFoundError:
        return None


def _collect() -> Dict[str, Any]:
    return {
        "os": _detect_os(),
        "os_version": _detect_os_version(),
        "arch": _detect_arch(),
        "shell": _detect_shell(),
        "is_wsl": _detect_is_wsl(),
        "server_version": _detect_server_version(),
        "python_version": platform.python_version(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def detect_environment(*, use_cache: bool = True) -> Dict[str, Any]:
    """Return host environment facts, TTL-cached by default.

    Args:
        use_cache: When ``False``, bypass and refresh the cached value (used by
            ``POST /tooling/scan``).
    """
    store = cache.get_cache()
    if use_cache:
        cached = store.get(_CACHE_KEY)
        if cached is not None:
            return cast(Dict[str, Any], cached)
    result = _collect()
    store.set(_CACHE_KEY, result)
    return result
