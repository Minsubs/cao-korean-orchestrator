"""Unit tests for the Antigravity adapter (read-only; which + config mocked)."""

import json

import pytest

from cli_agent_orchestrator.services.tooling.adapters import antigravity
from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter


def _present(monkeypatch):
    monkeypatch.setattr(antigravity.shutil, "which", lambda _b: "/usr/local/bin/agy")


# --- detection & capabilities --------------------------------------------


def test_not_installed(monkeypatch):
    monkeypatch.setattr(antigravity.shutil, "which", lambda _b: None)
    a = AntigravityAdapter()
    assert a.detect().installed is False
    caps = a.capabilities()
    assert not any([caps.canList, caps.canInstall, caps.canRemove])
    assert a.list_installed() == []


def test_detect_never_executes(monkeypatch):
    """Detection must be which-only — no probe/exec of agy at all."""
    _present(monkeypatch)
    env = AntigravityAdapter().detect()
    assert env.installed is True and env.version is None


def test_capabilities_read_only(monkeypatch):
    _present(monkeypatch)
    caps = AntigravityAdapter().capabilities()
    assert caps.canList is True
    assert caps.canInstall is False and caps.canRemove is False
    # canUpdate=True: `agy update` (CLI self-update) is the one mutation this
    # otherwise read-only adapter allows.
    assert caps.canUpdate is True and caps.canUpdateAll is False and caps.canSearch is False
    assert "조회만" in caps.reasons["canInstall"]


# --- config listing -------------------------------------------------------


def test_list_parses_mcp_servers(monkeypatch, tmp_path):
    _present(monkeypatch)
    config = tmp_path / "mcp_config.json"
    config.write_text(
        json.dumps({"mcpServers": {"srv-a": {"command": "x"}, "srv-b": {"command": "y"}}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(antigravity, "_config_path", lambda: config)
    names = sorted(it["name"] for it in AntigravityAdapter().list_installed())
    assert names == ["srv-a", "srv-b"]


def test_list_empty_file(monkeypatch, tmp_path):
    _present(monkeypatch)
    config = tmp_path / "mcp_config.json"
    config.write_text("", encoding="utf-8")
    monkeypatch.setattr(antigravity, "_config_path", lambda: config)
    assert AntigravityAdapter().list_installed() == []


def test_list_missing_file(monkeypatch, tmp_path):
    _present(monkeypatch)
    monkeypatch.setattr(antigravity, "_config_path", lambda: tmp_path / "absent.json")
    assert AntigravityAdapter().list_installed() == []


def test_list_malformed_json(monkeypatch, tmp_path):
    _present(monkeypatch)
    config = tmp_path / "mcp_config.json"
    config.write_text("{not valid", encoding="utf-8")
    monkeypatch.setattr(antigravity, "_config_path", lambda: config)
    assert AntigravityAdapter().list_installed() == []


def test_list_unexpected_shape_yields_nothing(monkeypatch, tmp_path):
    _present(monkeypatch)
    config = tmp_path / "mcp_config.json"
    config.write_text(json.dumps(["a", "b"]), encoding="utf-8")  # list, not the expected dict
    monkeypatch.setattr(antigravity, "_config_path", lambda: config)
    assert AntigravityAdapter().list_installed() == []


def test_parse_accepts_snake_case_key():
    text = json.dumps({"mcp_servers": {"only": {}}})
    assert antigravity._parse_config_server_names(text) == ["only"]


# --- read-only: plan/verify refuse ---------------------------------------


def test_plan_refuses(monkeypatch):
    _present(monkeypatch)
    with pytest.raises(ValueError):
        AntigravityAdapter().plan("install", "x", None)


def test_verify_refuses(monkeypatch):
    _present(monkeypatch)
    ok, detail = AntigravityAdapter().verify("install", "x")
    assert ok is False and "조회만" in detail


def test_plan_mcp_add_unsupported_by_default(monkeypatch):
    """Antigravity inherits the base refusal for MCP installs."""
    _present(monkeypatch)
    with pytest.raises(ValueError):
        AntigravityAdapter().plan_mcp_add("x", ["npx"])
