"""End-to-end write-path test: real router + real manager + real runner.

Only the two OS boundaries are mocked — ``shutil.which`` / ``probe.run`` (so the
adapter believes ``skills`` is installed) and ``create_subprocess_exec`` (so the
runner "executes" a fake process). Everything else — request validation, the
operation lifecycle, concurrency wrapper, streaming/masking, and verification —
runs for real, exercising the exact ``work`` closure the execute endpoint builds.

Uses httpx's ASGITransport on a single event loop so the background operation
task progresses deterministically as we poll.
"""

import asyncio

import httpx
import pytest
from fastapi import FastAPI

from cli_agent_orchestrator.api import tooling_router
from cli_agent_orchestrator.services.tooling import operations, probe, runner
from cli_agent_orchestrator.services.tooling.adapters import generic_skills


class _FakeStream:
    def __init__(self, lines):
        self._lines = list(lines)

    async def readline(self):
        return self._lines.pop(0) if self._lines else b""

    async def read(self, _n):
        data = b"".join(self._lines)
        self._lines = []
        return data


class _FakeProc:
    def __init__(self, stdout_lines, stderr_lines=(), returncode=0):
        self.stdout = _FakeStream(stdout_lines)
        self.stderr = _FakeStream(stderr_lines)
        self.killed = False
        self._rc = returncode

    async def wait(self):
        return self._rc

    def kill(self):
        self.killed = True

    @property
    def returncode(self):
        return self._rc


def _install_adapter(monkeypatch, *, list_after="my-skill 1.0\n"):
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: "/usr/local/bin/skills")

    def fake_probe(argv, timeout):
        if argv[1] == "--help":
            return probe.ProbeResult(0, "add remove update list find", "", False)
        if argv[1] == "list":
            return probe.ProbeResult(0, list_after, "", False)
        return probe.ProbeResult(0, "", "", False)

    monkeypatch.setattr(generic_skills.probe, "run", fake_probe)


def _app_with_fresh_manager(monkeypatch):
    fresh = operations.OperationManager()
    monkeypatch.setattr(operations, "get_manager", lambda: fresh)
    app = FastAPI()
    app.include_router(tooling_router.router)
    return app


async def _poll_terminal(client, op_id, tries=300):
    body = {}
    for _ in range(tries):
        await asyncio.sleep(0.01)
        body = (await client.get(f"/tooling/operations/{op_id}")).json()
        if body["status"] in {"succeeded", "failed", "cancelled"}:
            return body
    return body


@pytest.mark.asyncio
async def test_execute_success_end_to_end(monkeypatch):
    _install_adapter(monkeypatch, list_after="my-skill 1.0\nother 2.0\n")

    async def fake_exec(*_argv, **_kwargs):
        return _FakeProc([b"installing my-skill\n", b"done\n"], returncode=0)

    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)
    app = _app_with_fresh_manager(monkeypatch)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/tooling/execute",
            json={"action": "install", "provider": "generic_skills", "target": "my-skill"},
        )
        assert resp.status_code == 200
        op_id = resp.json()["operation_id"]

        body = await _poll_terminal(client, op_id)
        assert body["status"] == "succeeded"
        assert body["verified"] is True
        assert body["exit_code"] == 0
        assert any("installing my-skill" in line for line in body["log"])


@pytest.mark.asyncio
async def test_execute_verification_failure_end_to_end(monkeypatch):
    # Command exits 0 but the target never appears in `skills list` -> verify fails.
    _install_adapter(monkeypatch, list_after="other 2.0\n")

    async def fake_exec(*_argv, **_kwargs):
        return _FakeProc([b"pretended to install\n"], returncode=0)

    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)
    app = _app_with_fresh_manager(monkeypatch)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        op_id = (
            await client.post(
                "/tooling/execute",
                json={"action": "install", "provider": "generic_skills", "target": "my-skill"},
            )
        ).json()["operation_id"]

        body = await _poll_terminal(client, op_id)
        assert body["status"] == "failed"
        assert body["verified"] is False
        assert "verification failed" in body["error"]


@pytest.mark.asyncio
async def test_execute_nonzero_exit_end_to_end(monkeypatch):
    _install_adapter(monkeypatch)

    async def fake_exec(*_argv, **_kwargs):
        # Secret arrives on stderr, which the failure path copies into `error`.
        return _FakeProc([b"progress\n"], stderr_lines=[b"fatal: token=SECRETLEAK\n"], returncode=3)

    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)
    app = _app_with_fresh_manager(monkeypatch)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        op_id = (
            await client.post(
                "/tooling/execute",
                json={"action": "install", "provider": "generic_skills", "target": "my-skill"},
            )
        ).json()["operation_id"]

        body = await _poll_terminal(client, op_id)
        assert body["status"] == "failed"
        assert body["exit_code"] == 3
        # The stderr secret is masked before it reaches `error` (and the log).
        assert "SECRETLEAK" not in body["error"]
        assert "token=***" in body["error"]
        assert all("SECRETLEAK" not in line for line in body["log"])
