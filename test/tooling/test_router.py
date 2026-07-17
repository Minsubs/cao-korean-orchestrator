"""Router tests: a self-contained FastAPI app including only the tooling router.

This deliberately does NOT import api/main.py — the router is self-contained and
integration mounts it separately.
"""

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
    # Nothing is installed in this fixture -> at least one provider_missing info.
    assert any(d["code"] == "provider_missing" for d in body)
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
