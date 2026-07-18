"""Router tests for the Phase 5a catalog + models surface.

Uses a self-contained FastAPI app mounting only the tooling router. The adapter
registry and operation manager are stubbed, but ``catalog.resolve_install`` runs
for real (it is pure + the home-confinement gate), so these tests exercise the
actual catalog:<id> → static-argv wiring and path validation.
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import tooling_router
from cli_agent_orchestrator.services.tooling import operations
from cli_agent_orchestrator.services.tooling.adapters.base import (
    AdapterEnv,
    ExecutionPlan,
    ProviderCapabilities,
)


class FakeMcpAdapter:
    id = "claude_code"
    display_name = "Claude Code"

    def __init__(self, *, can_install=True):
        self._can_install = can_install

    def detect(self):
        return AdapterEnv(True, "/bin/claude", "2.1.0")

    def capabilities(self):
        return ProviderCapabilities(
            canList=True,
            canSearch=False,
            canInstall=self._can_install,
            canRemove=True,
            canUpdate=False,
            canUpdateAll=False,
            requiresNewSession=True,
            requiresRestart=False,
            reasons={} if self._can_install else {"canInstall": "MCP add 없음"},
        )

    def list_installed(self):
        return []

    def plan(self, action, target, scope):
        return ExecutionPlan(["claude", "mcp", "remove", target], "/home", "d", "v")

    def plan_mcp_add(self, name, command_tokens):
        return ExecutionPlan(
            ["claude", "mcp", "add", name, "--", *command_tokens], "/home", f"add {name}", "v"
        )

    def plan_skill_add(self, repository, name, scope):
        argv = ["skills", "add", repository, "--skill", name, "--yes"]
        if scope == "global":
            argv.append("--global")
        return ExecutionPlan(argv, "/home", f"add {name}", "v")

    def verify(self, action, target):
        return True, "ok"


class FakeManager:
    def __init__(self):
        self.ops = {}

    def submit(self, op, work):
        self.ops[op.id] = op
        return op.id

    def list(self):
        return list(reversed(self.ops.values()))

    def get(self, op_id):
        return self.ops.get(op_id)


def _mount(monkeypatch, adapters, manager=None):
    monkeypatch.setattr(tooling_router.registry, "get_adapter", lambda p: adapters.get(p))
    monkeypatch.setattr(tooling_router.registry, "get_adapters", lambda: dict(adapters))
    if manager is not None:
        monkeypatch.setattr(tooling_router.operations, "get_manager", lambda: manager)
    app = FastAPI()
    app.include_router(tooling_router.router)
    return TestClient(app)


@pytest.fixture
def client(monkeypatch):
    adapters = {"claude_code": FakeMcpAdapter(), "generic_skills": FakeMcpAdapter()}
    return _mount(monkeypatch, adapters, FakeManager())


# --- catalog install: plan ------------------------------------------------


def test_plan_catalog_mcp_builds_static_argv(client):
    resp = client.post(
        "/tooling/plan",
        json={"action": "install", "provider": "claude_code", "target": "catalog:context7"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["argv"] == [
        "claude",
        "mcp",
        "add",
        "context7",
        "--",
        "npx",
        "-y",
        "@upstash/context7-mcp",
    ]
    assert any("new session" in w for w in body["warnings"])


def test_plan_catalog_filesystem_appends_home_path(client):
    home = str(Path.home())
    resp = client.post(
        "/tooling/plan",
        json={
            "action": "install",
            "provider": "claude_code",
            "target": "catalog:filesystem",
            "params": {"path": home},
        },
    )
    assert resp.status_code == 200
    assert resp.json()["argv"][-1] == home


def test_plan_catalog_skill_uses_repository_and_exact_skill_name(client):
    resp = client.post(
        "/tooling/plan",
        json={
            "action": "install",
            "provider": "generic_skills",
            "target": "catalog:frontend-design",
            "scope": "global",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["argv"] == [
        "skills",
        "add",
        "anthropics/skills",
        "--skill",
        "frontend-design",
        "--yes",
        "--global",
    ]


def test_plan_catalog_filesystem_missing_path_400(client):
    resp = client.post(
        "/tooling/plan",
        json={"action": "install", "provider": "claude_code", "target": "catalog:filesystem"},
    )
    assert resp.status_code == 400
    assert "params.path" in resp.json()["detail"]


def test_plan_catalog_filesystem_escaping_path_400(client):
    resp = client.post(
        "/tooling/plan",
        json={
            "action": "install",
            "provider": "claude_code",
            "target": "catalog:filesystem",
            "params": {"path": "/etc"},
        },
    )
    assert resp.status_code == 400
    assert "홈" in resp.json()["detail"]


@pytest.mark.parametrize(
    "body,fragment",
    [
        (
            {"action": "remove", "provider": "claude_code", "target": "catalog:context7"},
            "install",
        ),
        (
            {"action": "install", "provider": "claude_code", "target": "catalog:UNKNOWN_ID"},
            "카탈로그 id",
        ),
        (
            {"action": "install", "provider": "claude_code", "target": "catalog:zzz-missing"},
            "알 수 없는",
        ),
        (
            {"action": "install", "provider": "generic_skills", "target": "catalog:context7"},
            "지원하지 않아요",
        ),
    ],
)
def test_plan_catalog_400_cases(client, body, fragment):
    resp = client.post("/tooling/plan", json=body)
    assert resp.status_code == 400
    assert fragment in resp.json()["detail"]


def test_plan_catalog_capability_disabled_400(monkeypatch):
    adapters = {"claude_code": FakeMcpAdapter(can_install=False)}
    client = _mount(monkeypatch, adapters, FakeManager())
    resp = client.post(
        "/tooling/plan",
        json={"action": "install", "provider": "claude_code", "target": "catalog:context7"},
    )
    assert resp.status_code == 400
    assert "MCP add" in resp.json()["detail"]


# --- catalog install: execute (revalidates like plan) ---------------------


def test_execute_catalog_creates_operation(client):
    resp = client.post(
        "/tooling/execute",
        json={"action": "install", "provider": "claude_code", "target": "catalog:context7"},
    )
    assert resp.status_code == 200
    op_id = resp.json()["operation_id"]
    got = client.get(f"/tooling/operations/{op_id}")
    assert got.status_code == 200
    assert got.json()["target"] == "catalog:context7"


def test_execute_catalog_bad_path_400(client):
    resp = client.post(
        "/tooling/execute",
        json={
            "action": "install",
            "provider": "claude_code",
            "target": "catalog:filesystem",
            "params": {"path": "/etc"},
        },
    )
    assert resp.status_code == 400


# --- GET /catalog and /models (wiring) ------------------------------------


def test_get_catalog_endpoint(monkeypatch, client):
    monkeypatch.setattr(tooling_router.catalog, "list_catalog", lambda: [{"id": "context7"}])
    resp = client.get("/tooling/catalog")
    assert resp.status_code == 200
    assert resp.json() == [{"id": "context7"}]


def test_get_models_endpoint(monkeypatch, client):
    monkeypatch.setattr(
        tooling_router.models,
        "list_models",
        lambda: [{"provider": "claude_code", "source": "known"}],
    )
    resp = client.get("/tooling/models")
    assert resp.status_code == 200
    assert resp.json()[0]["provider"] == "claude_code"
