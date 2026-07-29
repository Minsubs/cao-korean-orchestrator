"""Unit tests for the tooling TTL cache module."""

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
