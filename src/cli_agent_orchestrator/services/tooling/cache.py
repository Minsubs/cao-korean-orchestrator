"""Module-level TTL cache for read-only tooling collectors.

Provider and environment collection each shell out / touch the filesystem, so
their results are cached in-process for :data:`CACHE_TTL_SECONDS`. This keeps a
polling UI from re-probing every CLI binary on every request. ``POST
/tooling/scan`` calls :func:`rescan` to force a fresh collection.
"""

from __future__ import annotations

import time
from typing import Any

# Providers/environment results are cached this long. Short enough that a newly
# installed CLI shows up on the next poll cycle without an explicit rescan.
CACHE_TTL_SECONDS = 60.0


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

    from cli_agent_orchestrator.services.tooling import environment, providers

    invalidate()
    providers.list_providers(use_cache=False)
    environment.detect_environment(use_cache=False)
    return datetime.now(timezone.utc).isoformat()
