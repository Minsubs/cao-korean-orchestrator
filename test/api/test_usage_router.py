from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import usage_router


def _account(provider: str) -> dict:
    return {
        "provider": provider,
        "present": True,
        "source": "transcripts" if provider == "claude_code" else "rollouts",
        "today": {"input": 1, "output": 2, "cache_read": 3, "cache_creation": 4, "total": 10},
        "week": {"input": 1, "output": 2, "cache_read": 3, "cache_creation": 4, "total": 10},
        "by_model_today": [],
        "rate_limits": None,
        "last_activity": "2026-07-17T12:00:00+00:00",
        "note": "local data",
        "diagnostics": {"files_scanned": 1, "files_omitted": 0, "corrupt_lines": 0},
    }


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(usage_router.router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache() -> None:
    usage_router.reset_cache()


def test_accounts_returns_both_real_local_providers(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(
        usage_router.claude_transcripts,
        "aggregate",
        lambda home, now: _account("claude_code"),
    )
    monkeypatch.setattr(
        usage_router.codex_rollouts,
        "aggregate",
        lambda home, now: _account("codex"),
    )
    monkeypatch.setattr(
        usage_router.antigravity_quota,
        "aggregate",
        lambda home, now: _account("antigravity_cli"),
    )

    response = client.get("/usage/accounts")

    assert response.status_code == 200
    body = response.json()
    assert [account["provider"] for account in body["accounts"]] == ["claude_code", "codex", "antigravity_cli"]
    assert body["scanned_at"].startswith("20")


def test_accounts_include_antigravity(monkeypatch, tmp_path) -> None:
    result = usage_router._scan_accounts(include_claude_limits=False)
    providers = {a["provider"] for a in result["accounts"]}
    assert "antigravity_cli" in providers


def test_accounts_claude_limits_is_opt_in_and_merges_note(client: TestClient, monkeypatch) -> None:
    claude = _account("claude_code")
    monkeypatch.setattr(
        usage_router.claude_transcripts,
        "aggregate",
        lambda home, now: dict(claude),
    )
    monkeypatch.setattr(
        usage_router.codex_rollouts,
        "aggregate",
        lambda home, now: _account("codex"),
    )
    lookup = usage_router.claude_limits.ClaudeLimitLookup(
        rate_limits={
            "plan": "max",
            "primary": {"used_percent": 12.3, "window_minutes": 300, "resets_at": 1784780187},
            "secondary": None,
            "captured_at": "2026-07-17T12:00:00+00:00",
        },
        note="Anthropic 실측 한도",
    )
    monkeypatch.setattr(usage_router.claude_limits, "get_limits", lambda home, now: lookup)

    default_response = client.get("/usage/accounts")
    opted_in_response = client.get("/usage/accounts?claude_limits=true")

    assert default_response.json()["accounts"][0]["rate_limits"] is None
    opted_in = opted_in_response.json()["accounts"][0]
    assert opted_in["rate_limits"]["plan"] == "max"
    assert opted_in["note"] == "local data · Anthropic 실측 한도"


def test_accounts_caches_each_query_mode_for_sixty_seconds(client: TestClient, monkeypatch) -> None:
    calls = {"claude": 0, "codex": 0}

    def claude_aggregate(home: Path, now: datetime) -> dict:
        calls["claude"] += 1
        return _account("claude_code")

    def codex_aggregate(home: Path, now: datetime) -> dict:
        calls["codex"] += 1
        return _account("codex")

    monkeypatch.setattr(usage_router.claude_transcripts, "aggregate", claude_aggregate)
    monkeypatch.setattr(usage_router.codex_rollouts, "aggregate", codex_aggregate)

    first = client.get("/usage/accounts")
    second = client.get("/usage/accounts")

    assert first.status_code == second.status_code == 200
    assert calls == {"claude": 1, "codex": 1}


def test_usage_route_declares_read_write_admin_scope_gate() -> None:
    route = next(
        route
        for route in usage_router.router.routes
        if getattr(route, "path", "") == "/usage/accounts"
    )
    dependencies = list(route.dependant.dependencies)

    assert any(
        "require_any_scope" in getattr(dependency.call, "__qualname__", "")
        for dependency in dependencies
    )
