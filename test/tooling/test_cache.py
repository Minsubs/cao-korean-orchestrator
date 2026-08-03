"""Unit tests for the tooling TTL cache module."""

from unittest.mock import MagicMock

from cli_agent_orchestrator.services.tooling import cache


def test_ttl_is_at_least_five_minutes():
    """TTL must be long enough that a warmed cache survives between polls
    (Task 5: raised from 60s so catalog/extensions/adapters pre-warming at
    startup actually pays off for the first real Tooling request)."""
    assert cache.CACHE_TTL_SECONDS >= 300


def test_get_set_roundtrip_and_clear():
    store = cache.TTLCache(ttl_seconds=60.0)
    assert store.get("missing") is None

    store.set("key", {"value": 1})
    assert store.get("key") == {"value": 1}

    store.clear()
    assert store.get("key") is None


def test_cached_which_hit_is_looked_up_once(monkeypatch):
    """A resolved binary is looked up once, then served from the cache."""
    which = MagicMock(return_value="/usr/bin/claude")
    monkeypatch.setattr(cache.shutil, "which", which)

    assert cache.cached_which("claude") == "/usr/bin/claude"
    assert cache.cached_which("claude") == "/usr/bin/claude"

    which.assert_called_once_with("claude")


def test_cached_which_caches_the_miss_too(monkeypatch):
    """The expensive case is the miss (full PATH walk), so it must cache as well."""
    which = MagicMock(return_value=None)
    monkeypatch.setattr(cache.shutil, "which", which)

    assert cache.cached_which("nope") is None
    assert cache.cached_which("nope") is None

    which.assert_called_once_with("nope")


def test_cached_which_keys_per_binary(monkeypatch):
    """Different binaries do not share a cache entry."""
    monkeypatch.setattr(cache.shutil, "which", lambda binary: f"/usr/bin/{binary}")

    assert cache.cached_which("codex") == "/usr/bin/codex"
    assert cache.cached_which("claude") == "/usr/bin/claude"


def test_cached_which_refreshes_after_invalidate(monkeypatch):
    """A newly installed CLI shows up once the cache is dropped (POST /tooling/scan)."""
    which = MagicMock(side_effect=[None, "/usr/bin/codex"])
    monkeypatch.setattr(cache.shutil, "which", which)

    assert cache.cached_which("codex") is None
    cache.invalidate()
    assert cache.cached_which("codex") == "/usr/bin/codex"

    assert which.call_count == 2
