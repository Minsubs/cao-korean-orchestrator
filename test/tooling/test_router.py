"""Router tests: a self-contained FastAPI app including only the tooling router.

This deliberately does NOT import api/main.py — the router is self-contained and
integration mounts it separately.
"""

import asyncio
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import tooling_router
from cli_agent_orchestrator.services.tooling import extensions, probe, providers

_PROVIDER_KEYS = {
    "name",
    "display_name",
    "binary",
    "installed",
    "path",
    "version",
    "version_raw",
    "version_error",
    "checked_at",
}
_ENV_KEYS = {
    "os",
    "os_version",
    "arch",
    "shell",
    "is_wsl",
    "server_version",
    "python_version",
    "checked_at",
}
_EXTENSION_KEYS = {
    "id",
    "kind",
    "name",
    "description",
    "scope",
    "source_path",
    "provider",
    "enabled",
}
_DIAGNOSTIC_KEYS = {
    "severity",
    "code",
    "title",
    "cause",
    "impact",
    "recommendation",
    "provider",
    "path",
}


@pytest.fixture
def client(monkeypatch):
    # Hermetic: no provider installed -> no real subprocess probing; profiles
    # stubbed so extension/diagnostic content does not depend on the host store.
    monkeypatch.setattr(providers.shutil, "which", lambda binary: None)
    monkeypatch.setattr(extensions, "list_agent_profiles", lambda: [])
    app = FastAPI()
    app.include_router(tooling_router.router)
    return TestClient(app)


def test_environment_endpoint(client):
    resp = client.get("/tooling/environment")
    assert resp.status_code == 200
    assert set(resp.json()) == _ENV_KEYS


def test_providers_endpoint(client):
    resp = client.get("/tooling/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list) and body
    for provider in body:
        assert set(provider) == _PROVIDER_KEYS
        assert provider["installed"] is False


def test_extensions_endpoint(client):
    resp = client.get("/tooling/extensions")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    for item in body:
        assert _EXTENSION_KEYS <= set(item)


def test_diagnostics_endpoint(client):
    resp = client.get("/tooling/diagnostics")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    # Optional tools that are simply unused/uninstalled are not warnings.
    assert not any(d["code"] == "provider_missing" for d in body)
    for diagnostic in body:
        assert set(diagnostic) == _DIAGNOSTIC_KEYS


def test_scan_forces_cache_refresh(client, monkeypatch):
    # First read populates the cache with "nothing installed".
    first = client.get("/tooling/providers").json()
    assert all(p["installed"] is False for p in first)

    # Flip the environment to "installed"; a cached read must not reflect it yet.
    monkeypatch.setattr(providers.shutil, "which", lambda binary: f"/usr/bin/{binary}")
    monkeypatch.setattr(
        providers.probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(0, f"{argv[0]} 1.2.3\n", "", False),
    )
    cached = client.get("/tooling/providers").json()
    assert all(p["installed"] is False for p in cached)

    # scan invalidates + recollects.
    scanned = client.post("/tooling/scan").json()
    assert "scanned_at" in scanned

    refreshed = client.get("/tooling/providers").json()
    assert all(p["installed"] is True for p in refreshed)
    assert any(p["version"] == "1.2.3" for p in refreshed)


@pytest.mark.asyncio
async def test_slow_provider_probe_does_not_block_concurrent_requests(monkeypatch):
    """Regression test for the Tooling ERR_ABORTED bug (RCA: a blocking
    ``subprocess.run``-based probe ran directly inside ``async def
    get_providers()`` with no ``asyncio.to_thread`` -- it monopolized the
    single event loop for its full duration, so on WSL (where CLI probes are
    slow) 8 concurrent first-mount Tooling requests fully serialized instead
    of running in parallel, and the frontend's 10s abort timeout would fire
    before its turn ever came up).

    Simulates a slow ``list_providers()`` and fires a concurrent, otherwise
    instant request (``/tooling/operations``, pure in-memory) alongside it.
    Ordering (not per-call elapsed time) is what actually discriminates
    blocking vs. off-loaded here: a plain synchronous call with no internal
    ``await`` cannot yield the event loop to another task mid-flight, so
    *nothing* else can complete first -- both requests only resolve back to
    back once the 0.3s sleep is over. Off-loaded via ``asyncio.to_thread``,
    the slow call's wait happens on a worker thread, freeing the loop to
    finish the fast request almost immediately.
    """

    def slow_list_providers(*, use_cache: bool = True):
        time.sleep(0.3)
        return []

    monkeypatch.setattr(providers, "list_providers", slow_list_providers)

    app = FastAPI()
    app.include_router(tooling_router.router)
    transport = httpx.ASGITransport(app=app)

    finished_at: dict[str, float] = {}

    async def timed_get(client: httpx.AsyncClient, path: str, key: str) -> httpx.Response:
        resp = await client.get(path)
        finished_at[key] = time.monotonic()
        return resp

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as async_client:
        start = time.monotonic()
        slow_task = asyncio.create_task(timed_get(async_client, "/tooling/providers", "slow"))
        await asyncio.sleep(0.05)  # let the slow request enter its handler first
        fast_task = asyncio.create_task(timed_get(async_client, "/tooling/operations", "fast"))
        slow_resp, fast_resp = await asyncio.gather(slow_task, fast_task)

    assert fast_resp.status_code == 200
    assert slow_resp.status_code == 200
    # The fast request must both finish comfortably before the slow probe's
    # 0.3s sleep is up, AND finish strictly before the slow one -- if the
    # probe were still blocking the event loop, the fast request could not
    # even start being served until the slow one had already finished.
    assert finished_at["fast"] - start < 0.2
    assert finished_at["fast"] < finished_at["slow"]
