"""Shared fixtures for the read-only tooling service tests."""

import pytest

from cli_agent_orchestrator.services.tooling import cache


@pytest.fixture(autouse=True)
def _clear_tooling_cache():
    """Isolate the module-level TTL cache between tests."""
    cache.invalidate()
    yield
    cache.invalidate()
