"""Module-level TTL cache for read-only tooling collectors.

Provider, environment, catalog, extensions and adapter collection each shell
out / touch the filesystem (some adapter probes take upwards of 20s on WSL),
so their results are cached in-process for :data:`CACHE_TTL_SECONDS`. This
keeps a polling UI from re-probing every CLI binary on every request. ``POST
/tooling/scan`` calls :func:`rescan` to force a fresh collection.
"""

from __future__ import annotations

import shutil
import time
from typing import Any, cast

# Tooling collector results are cached this long. Long enough that opening the
# Tooling page never pays for a cold CLI probe once the server has been up a
# while; a newly installed CLI or extension still shows up promptly via the
# explicit "rescan" action, which invalidates every key below.
CACHE_TTL_SECONDS = 300.0


class TTLCache:
    """A minimal time-to-live cache keyed by string."""

    def __init__(self, ttl_seconds: float) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        """Return the cached value, or ``None`` if missing or expired."""
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        """Store ``value`` under ``key`` with a fresh TTL."""
        self._store[key] = (time.monotonic() + self._ttl, value)

    def clear(self) -> None:
        """Drop every cached entry."""
        self._store.clear()


_CACHE = TTLCache(CACHE_TTL_SECONDS)


def get_cache() -> TTLCache:
    """Return the process-wide tooling cache."""
    return _CACHE


def cached_which(binary: str) -> str | None:
    """``shutil.which`` with a TTL cache for both hits AND misses.

    A miss makes the OS walk the entire PATH. On WSL that PATH usually carries
    dozens of ``/mnt/c`` (9p) entries, so looking up an uninstalled binary is
    slow — and the tooling collectors look up the same handful of binaries over
    and over (once per provider probe, once per adapter, again for diagnostics).
    Caching the resolved path *and* the absence of one collapses those repeated
    walks.

    The entry is stored as a dict so a cached miss (``{"path": None}``) stays
    distinguishable from an absent key, which :meth:`TTLCache.get` also reports
    as ``None``. Entries expire with everything else in the shared cache, so a
    freshly installed CLI is picked up on the next TTL cycle or an explicit
    ``POST /tooling/scan``.
    """
    key = f"which:{binary}"
    entry = _CACHE.get(key)
    if entry is not None:
        return cast(str | None, entry.get("path"))
    path = shutil.which(binary)
    _CACHE.set(key, {"path": path})
    return path


def invalidate() -> None:
    """Drop all cached tooling results."""
    _CACHE.clear()


def rescan() -> str:
    """Invalidate caches, force a fresh collection, and return the scan time.

    Imports the collectors lazily so this module stays free of import cycles
    (``providers``/``environment`` depend on this module).

    Returns:
        An ISO-8601 UTC timestamp for when the rescan completed.
    """
    from datetime import datetime, timezone

    from cli_agent_orchestrator.services.tooling import environment, extensions, providers

    invalidate()
    providers.list_providers(use_cache=False)
    # Extensions is the slowest collector (adapter probes dominate: ~17s cold on
    # WSL), so refresh it here too. Otherwise ``invalidate()`` above leaves the
    # very next Tooling page load to pay that cost interactively.
    extensions.list_extensions(use_cache=False)
    environment.detect_environment(use_cache=False)
    return datetime.now(timezone.utc).isoformat()
