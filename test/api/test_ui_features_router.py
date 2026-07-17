"""Tests for the self-contained UI-features router (Phase 2d+2e).

Mirrors ``test/tooling/test_router.py``: mounts ONLY ``ui_features_router`` on a
throwaway FastAPI app (never imports ``api/main.py``). Covers the context-gauge
endpoint (200 / null / 404) and slash-command enumeration (user/project/skill
merge, description extraction, home-confined project scan, unsupported provider,
built-in interactive flags, TTL caching).
"""

from pathlib import Path
from typing import Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cli_agent_orchestrator.api import ui_features_router


@pytest.fixture(autouse=True)
def _clear_slash_cache() -> None:
    """The TTL cache is module-global; reset it so tests don't leak into each other."""
    ui_features_router._SLASH_CACHE.clear()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(ui_features_router.router)
    return TestClient(app)


class _FakeProvider:
    """Stands in for a real provider; records the buffer it was handed."""

    def __init__(self, value: Optional[int]) -> None:
        self._value = value
        self.seen_buffer: Optional[str] = None

    def get_context_usage(self, output: str) -> Optional[int]:
        self.seen_buffer = output
        return self._value


# --- context gauge --------------------------------------------------------


def test_context_returns_percent(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeProvider(42)
    monkeypatch.setattr(
        ui_features_router, "get_terminal_metadata", lambda tid: {"provider": "claude_code"}
    )
    monkeypatch.setattr(ui_features_router.provider_manager, "get_provider", lambda tid: fake)
    monkeypatch.setattr(ui_features_router.status_monitor, "get_buffer", lambda tid: "raw-buffer")

    resp = client.get("/ui/terminals/term-1/context")
    assert resp.status_code == 200
    body = resp.json()
    assert body["terminal_id"] == "term-1"
    assert body["percent_left"] == 42
    assert body["source"] == "footer"
    assert "checked_at" in body
    # The rolling buffer must be the value handed to the parser.
    assert fake.seen_buffer == "raw-buffer"


def test_context_null_when_no_footer(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ui_features_router, "get_terminal_metadata", lambda tid: {"provider": "codex"}
    )
    monkeypatch.setattr(
        ui_features_router.provider_manager, "get_provider", lambda tid: _FakeProvider(None)
    )
    monkeypatch.setattr(ui_features_router.status_monitor, "get_buffer", lambda tid: "")

    resp = client.get("/ui/terminals/term-1/context")
    assert resp.status_code == 200
    assert resp.json()["percent_left"] is None


def test_context_404_when_terminal_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ui_features_router, "get_terminal_metadata", lambda tid: None)
    resp = client.get("/ui/terminals/nope/context")
    assert resp.status_code == 404


def test_context_null_when_provider_unresolvable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Terminal exists but provider resolution raises: report no gauge, not 404.
    def _raise(tid: str) -> None:
        raise ValueError("boom")

    monkeypatch.setattr(
        ui_features_router, "get_terminal_metadata", lambda tid: {"provider": "kiro_cli"}
    )
    monkeypatch.setattr(ui_features_router.provider_manager, "get_provider", _raise)

    resp = client.get("/ui/terminals/term-1/context")
    assert resp.status_code == 200
    assert resp.json()["percent_left"] is None


# --- slash-command enumeration --------------------------------------------


def _write(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    return home


def test_slash_unsupported_provider_400(client: TestClient) -> None:
    resp = client.get("/ui/slash-commands", params={"provider": "kiro_cli"})
    assert resp.status_code == 400


def test_slash_claude_merges_user_project_and_skills(client: TestClient, fake_home: Path) -> None:
    _write(fake_home / ".claude" / "commands" / "foo.md", "# Foo command\nRun foo now.\n")
    _write(
        fake_home / ".claude" / "commands" / "bar.md",
        "---\ndescription: Bar does the bar thing\n---\n# Bar\n",
    )
    _write(
        fake_home / ".claude" / "skills" / "myskill" / "SKILL.md",
        "---\nname: myskill\ndescription: My skill for testing\n---\n",
    )
    project = fake_home / "proj"
    _write(
        project / ".claude" / "commands" / "deploy.md",
        "---\ndescription: Deploy the app\n---\n",
    )

    resp = client.get("/ui/slash-commands", params={"provider": "claude_code", "cwd": str(project)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "claude_code"
    by_name = {c["name"]: c for c in body["commands"]}

    # User commands
    assert by_name["/foo"]["scope"] == "user"
    assert by_name["/foo"]["kind"] == "command"
    assert by_name["/foo"]["interactive"] is False
    assert by_name["/foo"]["description"] == "# Foo command"  # first non-empty line
    assert by_name["/bar"]["description"] == "Bar does the bar thing"  # frontmatter

    # Project command (home-confined cwd)
    assert by_name["/deploy"]["scope"] == "project"
    assert by_name["/deploy"]["description"] == "Deploy the app"

    # Skill (directory name; description from SKILL.md)
    assert by_name["/myskill"]["kind"] == "skill"
    assert by_name["/myskill"]["scope"] == "user"
    assert by_name["/myskill"]["description"] == "My skill for testing"


def test_slash_claude_builtins_and_interactive_flags(client: TestClient, fake_home: Path) -> None:
    resp = client.get("/ui/slash-commands", params={"provider": "claude_code"})
    assert resp.status_code == 200
    builtins = {c["name"]: c for c in resp.json()["commands"] if c["scope"] == "builtin"}
    assert builtins  # closed set present even with an empty home
    assert builtins["/model"]["interactive"] is True
    assert builtins["/agents"]["interactive"] is True
    assert builtins["/compact"]["interactive"] is False
    assert builtins["/compact"]["kind"] == "command"


def test_slash_cwd_outside_home_skips_project(client: TestClient, fake_home: Path) -> None:
    resp = client.get("/ui/slash-commands", params={"provider": "claude_code", "cwd": "/etc"})
    assert resp.status_code == 200
    scopes = {c["scope"] for c in resp.json()["commands"]}
    assert "project" not in scopes


def test_slash_codex_builtins_and_user_prompts(client: TestClient, fake_home: Path) -> None:
    _write(fake_home / ".codex" / "prompts" / "summarize.md", "Summarize the diff\n")
    resp = client.get("/ui/slash-commands", params={"provider": "codex"})
    assert resp.status_code == 200
    by_name = {c["name"]: c for c in resp.json()["commands"]}
    assert by_name["/quit"]["scope"] == "builtin"
    assert by_name["/new"]["scope"] == "builtin"
    assert by_name["/model"]["interactive"] is True
    assert by_name["/summarize"]["scope"] == "user"
    assert by_name["/summarize"]["kind"] == "command"
    assert by_name["/summarize"]["description"] == "Summarize the diff"


def test_slash_results_are_cached_within_ttl(client: TestClient, fake_home: Path) -> None:
    _write(fake_home / ".claude" / "commands" / "one.md", "one\n")
    first = client.get("/ui/slash-commands", params={"provider": "claude_code"}).json()
    names_first = {c["name"] for c in first["commands"]}
    assert "/one" in names_first

    # Add a new command; a cached response must NOT reflect it within the TTL.
    _write(fake_home / ".claude" / "commands" / "two.md", "two\n")
    second = client.get("/ui/slash-commands", params={"provider": "claude_code"}).json()
    assert "/two" not in {c["name"] for c in second["commands"]}

    # After clearing the cache, the new command appears.
    ui_features_router._SLASH_CACHE.clear()
    third = client.get("/ui/slash-commands", params={"provider": "claude_code"}).json()
    assert "/two" in {c["name"] for c in third["commands"]}


# --- home-confinement helper (direct) -------------------------------------


def test_project_commands_dir_confinement(fake_home: Path) -> None:
    assert ui_features_router._project_commands_dir(None) is None
    assert ui_features_router._project_commands_dir("/etc") is None
    inside = ui_features_router._project_commands_dir(str(fake_home / "proj"))
    assert inside is not None
    assert inside.parts[-2:] == (".claude", "commands")
