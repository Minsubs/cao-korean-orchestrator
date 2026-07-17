"""Unit + route tests for the Phase 6c source-aggregation endpoint.

Directory scans are made hermetic by redirecting ``$HOME`` to a ``tmp_path`` (so
``env_migration.home`` points there) and monkeypatching
``sources._skill_store_dirs`` (whose global store path is import-time fixed at the
real home). Marketplace tests mock the async ``runner.run`` so no real subprocess
is spawned. The route test mounts ONLY the tooling router (never ``api/main.py``).
"""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import tooling_router
from cli_agent_orchestrator.services.tooling import catalog, probe, sources
from cli_agent_orchestrator.services.tooling.adapters import claude_code
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.runner import RunResult

# --- helpers --------------------------------------------------------------


def _mkskill(skills_dir: Path, name: str) -> None:
    folder = skills_dir / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text("---\nname: x\ndescription: y\n---\n", encoding="utf-8")


def _mkfile(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x", encoding="utf-8")


def _install_claude(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the claude adapter believe ``claude`` is installed (no real probe)."""
    monkeypatch.setattr(claude_code.shutil, "which", lambda _b: "/usr/local/bin/claude")
    monkeypatch.setattr(
        claude_code.probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(0, "2.1.212 (Claude Code)", "", False),
    )


def _run_result(stdout: str = "", returncode: int | None = 0) -> RunResult:
    return RunResult(
        returncode=returncode, stdout=stdout, stderr="", timed_out=False, cancelled=False
    )


def _has_scope_dependency(route) -> bool:
    stack = list(getattr(route.dependant, "dependencies", []))
    while stack:
        dep = stack.pop()
        call = getattr(dep, "call", None)
        if call is not None and "require_any_scope" in getattr(call, "__qualname__", ""):
            return True
        stack.extend(getattr(dep, "dependencies", []))
    return False


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    return home


# --- directory sources ----------------------------------------------------


def test_directory_sources_counts_and_existence(
    fake_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Store dirs: one existing global store with 2 skills, one absent user extra.
    store = fake_home / ".aws" / "cli-agent-orchestrator" / "skills"
    _mkskill(store, "alpha")
    _mkskill(store, "beta")
    absent_extra = fake_home / "extra-skills"
    monkeypatch.setattr(
        sources, "_skill_store_dirs", lambda: [(store, "built-in"), (absent_extra, "user")]
    )
    # CLI dirs under the fake home.
    _mkfile(fake_home / ".claude" / "commands" / "a.md")
    _mkfile(fake_home / ".claude" / "commands" / "b.md")
    _mkfile(fake_home / ".claude" / "commands" / "not-a-command.txt")  # excluded (not *.md)
    _mkskill(fake_home / ".claude" / "skills", "cc-skill")
    _mkfile(fake_home / ".claude" / "agents" / "agent.md")
    # ``~/.codex/prompts`` intentionally absent -> exists False, count 0.

    by_path = {e["path"]: e for e in sources._directory_sources()}

    store_entry = by_path["~/.aws/cli-agent-orchestrator/skills"]
    assert store_entry["scope"] == "store" and store_entry["kind"] == "skills"
    assert store_entry["exists"] is True and store_entry["count"] == 2
    assert "cli" not in store_entry

    extra_entry = by_path["~/extra-skills"]
    assert extra_entry["scope"] == "user"
    assert extra_entry["exists"] is False and extra_entry["count"] == 0

    commands = by_path["~/.claude/commands"]
    assert commands["cli"] == "claude_code" and commands["kind"] == "commands"
    assert commands["exists"] is True and commands["count"] == 2 and "scope" not in commands

    skills = by_path["~/.claude/skills"]
    assert skills["cli"] == "claude_code" and skills["count"] == 1 and skills["exists"] is True

    agents = by_path["~/.claude/agents"]
    assert agents["kind"] == "agents" and agents["count"] == 1

    prompts = by_path["~/.codex/prompts"]
    assert prompts["cli"] == "codex" and prompts["kind"] == "prompts"
    assert prompts["exists"] is False and prompts["count"] == 0


# --- catalog summary ------------------------------------------------------


def test_catalog_summary_matches_static_table() -> None:
    summary = sources._catalog_summary()
    assert summary["origin"] == "builtin-curated"
    assert summary["note"]
    assert summary["count"] == len(catalog._ITEMS)
    assert sum(summary["kinds"].values()) == summary["count"]
    expected: dict[str, int] = {}
    for item in catalog._ITEMS:
        expected[item.kind] = expected.get(item.kind, 0) + 1
    assert summary["kinds"] == expected


# --- marketplaces (adapter method, runner mocked) -------------------------


@pytest.mark.asyncio
async def test_marketplace_json_success(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_claude(monkeypatch)
    payload = json.dumps(
        [
            {"name": "anthropics/skills", "source": "github", "repo": "anthropics/skills"},
            {"name": "local-mp"},  # no source -> None
        ]
    )

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        assert argv == ["claude", "plugin", "marketplace", "list", "--json"]
        return _run_result(stdout=payload)

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is True
    assert result["items"] == [
        {"name": "anthropics/skills", "source": "github"},
        {"name": "local-mp", "source": None},
    ]
    assert result["reason"] is None
    assert result["manage_hint"] == "claude plugin marketplace add <repo>"


@pytest.mark.asyncio
async def test_marketplace_empty_array_is_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_claude(monkeypatch)

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        return _run_result(stdout="[]")

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is True and result["items"] == []


@pytest.mark.asyncio
async def test_marketplace_text_unrecognized_is_supported_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_claude(monkeypatch)

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        return _run_result(stdout="Marketplaces:\n  anthropics/skills (github)\n")

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is False and result["items"] is None
    assert "인식" in result["reason"]
    assert result["manage_hint"] == "claude plugin marketplace add <repo>"


@pytest.mark.asyncio
async def test_marketplace_nonzero_exit_is_supported_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_claude(monkeypatch)

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        # e.g. an older CLI that does not accept ``--json`` -> non-zero exit.
        return _run_result(stdout="", returncode=2)

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is False and result["items"] is None


@pytest.mark.asyncio
async def test_marketplace_not_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claude_code.shutil, "which", lambda _b: None)

    async def fail_run(*args, **kwargs):  # pragma: no cover - must never be called
        raise AssertionError("runner must not run when claude is absent")

    monkeypatch.setattr(claude_code.runner, "run", fail_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is False and result["items"] is None
    assert "감지" in result["reason"]


@pytest.mark.asyncio
async def test_marketplace_capped_output_is_graceful(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_claude(monkeypatch)
    # Simulate the runner's 64 KiB cap: a body truncated mid-JSON no longer parses.
    truncated = "[" + json.dumps({"name": "x", "source": "github"}) + ("," * 50) + "\n[truncated]"

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        return _run_result(stdout=truncated)

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    result = await ClaudeCodeAdapter().marketplace_list()
    assert result["supported"] is False and result["items"] is None


@pytest.mark.asyncio
async def test_marketplace_result_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_claude(monkeypatch)
    calls = {"n": 0}

    async def fake_run(argv, *, cwd=None, timeout=None, on_line=None):
        calls["n"] += 1
        return _run_result(stdout=json.dumps([{"name": "mp", "source": "github"}]))

    monkeypatch.setattr(claude_code.runner, "run", fake_run)

    adapter = ClaudeCodeAdapter()
    first = await adapter.marketplace_list()
    second = await adapter.marketplace_list()
    assert first == second and calls["n"] == 1  # second call served from the TTL cache


# --- route ----------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(tooling_router.router)
    return TestClient(app)


def test_sources_route_shape(
    client: TestClient, fake_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Hermetic: no CLI installed -> marketplace supported:false, no shell-out; a
    # single absent store dir so directory scanning stays inside the fake home.
    monkeypatch.setattr(claude_code.shutil, "which", lambda _b: None)
    monkeypatch.setattr(
        sources,
        "_skill_store_dirs",
        lambda: [(fake_home / ".aws" / "cli-agent-orchestrator" / "skills", "built-in")],
    )

    resp = client.get("/tooling/sources")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"directory_sources", "catalog", "marketplaces"}

    assert isinstance(body["directory_sources"], list) and body["directory_sources"]
    for entry in body["directory_sources"]:
        assert {"path", "kind", "count", "exists"} <= set(entry)
        assert ("scope" in entry) ^ ("cli" in entry)  # store dirs carry scope, CLI dirs carry cli

    assert body["catalog"]["origin"] == "builtin-curated"
    assert body["catalog"]["count"] == len(catalog._ITEMS)

    mp = body["marketplaces"]["claude_code"]
    assert mp["supported"] is False and mp["items"] is None and mp["reason"]
    assert "codex" not in body["marketplaces"]  # no fake entry for a concept-less CLI


def test_sources_route_is_scope_gated() -> None:
    route = next(
        r for r in tooling_router.router.routes if getattr(r, "path", None) == "/tooling/sources"
    )
    assert _has_scope_dependency(route)
