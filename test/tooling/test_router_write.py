"""Router tests for the Phase 4a write path (adapter + manager mocked).

Uses a self-contained FastAPI app mounting only the tooling router (like
test_router.py). The adapter registry and operation manager are stubbed so the
tests exercise endpoint validation and wiring deterministically, without real
subprocesses or asyncio task timing. Scope gating of the mutating routes is
verified structurally here and end-to-end by test/api/test_scope_coverage.py.
"""

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

_SUBCOMMAND = {"install": "add", "remove": "remove", "update": "update", "update_all": "update"}


class FakeAdapter:
    id = "generic_skills"
    display_name = "Skills (generic)"

    def __init__(self, *, caps=None, supports_global=False, installed=True):
        self._caps = caps or ProviderCapabilities(
            canList=True,
            canSearch=True,
            canInstall=True,
            canRemove=True,
            canUpdate=True,
            canUpdateAll=True,
            requiresNewSession=False,
            requiresRestart=False,
            reasons={},
        )
        self._supports_global = supports_global
        self._installed = installed

    def detect(self):
        return AdapterEnv(
            installed=self._installed,
            path="/usr/local/bin/skills" if self._installed else None,
            version=None,
        )

    def capabilities(self):
        return self._caps

    def list_installed(self):
        return []

    def plan(self, action, target, scope):
        argv = ["skills", _SUBCOMMAND[action]]
        if action != "update_all":
            argv.append(target)
        if scope == "global" and self._supports_global:
            argv.append("--global")
        return ExecutionPlan(
            argv=argv, cwd="/home/tester", description=f"{action} {target}", verify_description="v"
        )

    def verify(self, action, target):
        return True, "ok"


class FakeManager:
    """In-memory stand-in that stores ops without running their work coroutine."""

    def __init__(self):
        self.ops = {}

    def submit(self, op, work):
        self.ops[op.id] = op
        return op.id

    def list(self):
        return list(reversed(self.ops.values()))

    def get(self, op_id):
        return self.ops.get(op_id)

    def cancel(self, op_id):
        op = self.ops.get(op_id)
        if op is None or op.status in operations._TERMINAL:
            return False
        op.status = operations.STATUS_CANCELLED
        return True


@pytest.fixture
def adapter():
    return FakeAdapter()


@pytest.fixture
def manager():
    return FakeManager()


@pytest.fixture
def client(monkeypatch, adapter, manager):
    monkeypatch.setattr(
        tooling_router.registry,
        "get_adapter",
        lambda provider: adapter if provider == adapter.id else None,
    )
    monkeypatch.setattr(tooling_router.registry, "get_adapters", lambda: {adapter.id: adapter})
    monkeypatch.setattr(tooling_router.operations, "get_manager", lambda: manager)
    app = FastAPI()
    app.include_router(tooling_router.router)
    return TestClient(app)


# --- GET /tooling/adapters ------------------------------------------------


def test_adapters_endpoint(client):
    resp = client.get("/tooling/adapters")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    entry = body[0]
    assert entry["id"] == "generic_skills"
    assert entry["detected"] == {
        "installed": True,
        "path": "/usr/local/bin/skills",
        "version": None,
    }
    caps = entry["capabilities"]
    assert caps["canInstall"] is True
    assert "reasons" in caps


# --- POST /tooling/plan ---------------------------------------------------


def test_plan_success(client):
    resp = client.post(
        "/tooling/plan", json={"action": "install", "provider": "generic_skills", "target": "foo"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["argv"] == ["skills", "add", "foo"]
    assert body["cwd"] == "/home/tester"
    assert body["warnings"] == []
    assert "description" in body and "verify_description" in body


def test_plan_update_all_needs_no_target(client):
    resp = client.post("/tooling/plan", json={"action": "update_all", "provider": "generic_skills"})
    assert resp.status_code == 200
    assert resp.json()["argv"] == ["skills", "update"]


def test_plan_global_scope_warns_when_unsupported(client):
    resp = client.post(
        "/tooling/plan",
        json={
            "action": "install",
            "provider": "generic_skills",
            "target": "foo",
            "scope": "global",
        },
    )
    assert resp.status_code == 200
    warnings = resp.json()["warnings"]
    assert any("global scope" in w for w in warnings)


def test_plan_restart_warning(monkeypatch, manager):
    caps = ProviderCapabilities(
        canList=True,
        canSearch=True,
        canInstall=True,
        canRemove=True,
        canUpdate=True,
        canUpdateAll=True,
        requiresNewSession=True,
        requiresRestart=True,
        reasons={},
    )
    adapter = FakeAdapter(caps=caps)
    monkeypatch.setattr(
        tooling_router.registry, "get_adapter", lambda p: adapter if p == adapter.id else None
    )
    monkeypatch.setattr(tooling_router.registry, "get_adapters", lambda: {adapter.id: adapter})
    app = FastAPI()
    app.include_router(tooling_router.router)
    resp = TestClient(app).post(
        "/tooling/plan", json={"action": "install", "provider": "generic_skills", "target": "foo"}
    )
    warnings = resp.json()["warnings"]
    assert any("restart" in w for w in warnings)
    assert any("new session" in w for w in warnings)


@pytest.mark.parametrize(
    "body,fragment",
    [
        ({"action": "install", "provider": "nope", "target": "x"}, "unknown provider"),
        (
            {"action": "frobnicate", "provider": "generic_skills", "target": "x"},
            "unsupported action",
        ),
        ({"action": "install", "provider": "generic_skills"}, "requires a target"),
        (
            {"action": "install", "provider": "generic_skills", "target": "bad;rm -rf"},
            "disallowed characters",
        ),
        (
            {"action": "install", "provider": "generic_skills", "target": "a b"},
            "disallowed characters",
        ),
    ],
)
def test_plan_400_cases(client, body, fragment):
    resp = client.post("/tooling/plan", json=body)
    assert resp.status_code == 400
    assert fragment in resp.json()["detail"]


def test_plan_capability_disabled_is_400(monkeypatch, manager):
    caps = ProviderCapabilities(
        canList=True,
        canSearch=True,
        canInstall=False,
        canRemove=True,
        canUpdate=True,
        canUpdateAll=True,
        requiresNewSession=False,
        requiresRestart=False,
        reasons={"canInstall": "skills CLI has no 'add' subcommand"},
    )
    adapter = FakeAdapter(caps=caps)
    monkeypatch.setattr(
        tooling_router.registry, "get_adapter", lambda p: adapter if p == adapter.id else None
    )
    app = FastAPI()
    app.include_router(tooling_router.router)
    resp = TestClient(app).post(
        "/tooling/plan", json={"action": "install", "provider": "generic_skills", "target": "foo"}
    )
    assert resp.status_code == 400
    assert "add" in resp.json()["detail"]


# --- POST /tooling/execute + operations -----------------------------------


def test_execute_creates_and_returns_operation(client, manager):
    resp = client.post(
        "/tooling/execute",
        json={"action": "install", "provider": "generic_skills", "target": "foo"},
    )
    assert resp.status_code == 200
    op_id = resp.json()["operation_id"]
    assert op_id in manager.ops

    # It is retrievable with its (masked) log.
    got = client.get(f"/tooling/operations/{op_id}")
    assert got.status_code == 200
    assert got.json()["id"] == op_id
    assert "log" in got.json()

    listing = client.get("/tooling/operations")
    assert listing.status_code == 200
    assert any(o["id"] == op_id for o in listing.json())


def test_execute_revalidates_like_plan(client):
    """execute must reject a bad target the same way plan does (requirement 12)."""
    resp = client.post(
        "/tooling/execute",
        json={"action": "install", "provider": "generic_skills", "target": "bad;evil"},
    )
    assert resp.status_code == 400


def test_get_unknown_operation_404(client):
    assert client.get("/tooling/operations/deadbeef").status_code == 404


# --- POST /tooling/operations/{id}/cancel ---------------------------------


def test_cancel_running_operation(client, manager):
    op_id = client.post(
        "/tooling/execute",
        json={"action": "install", "provider": "generic_skills", "target": "foo"},
    ).json()["operation_id"]
    resp = client.post(f"/tooling/operations/{op_id}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelling"


def test_cancel_unknown_operation_404(client):
    assert client.post("/tooling/operations/deadbeef/cancel").status_code == 404


def test_cancel_finished_operation_409(client, manager):
    op_id = client.post(
        "/tooling/execute",
        json={"action": "install", "provider": "generic_skills", "target": "foo"},
    ).json()["operation_id"]
    manager.ops[op_id].status = operations.STATUS_SUCCEEDED
    resp = client.post(f"/tooling/operations/{op_id}/cancel")
    assert resp.status_code == 409


# --- scope gating (structural mirror of test_scope_coverage) --------------


def _has_scope_dep(route):
    stack = list(getattr(route.dependant, "dependencies", []))
    while stack:
        dep = stack.pop()
        call = getattr(dep, "call", None)
        if call is not None and "require_any_scope" in getattr(call, "__qualname__", ""):
            return True
        stack.extend(getattr(dep, "dependencies", []))
    return False


def test_mutating_routes_are_scope_gated():
    app = FastAPI()
    app.include_router(tooling_router.router)
    gated = {
        route.path
        for route in app.routes
        if getattr(route, "methods", None)
        and route.methods & {"POST", "PUT", "PATCH", "DELETE"}
        and _has_scope_dep(route)
    }
    assert "/tooling/execute" in gated
    assert "/tooling/operations/{operation_id}/cancel" in gated
    assert "/tooling/plan" in gated  # read-only POST, gated to any scope
