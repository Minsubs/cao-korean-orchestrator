"""Unit tests for the Codex adapter (which + probe + config file mocked)."""

import json

import pytest

from cli_agent_orchestrator.services.tooling import probe
from cli_agent_orchestrator.services.tooling.adapters import codex
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter

_MCP_HELP_MANAGED = "Usage: codex mcp\n  list\n  get\n  add\n  remove\n  login\n"

_LIST_JSON = json.dumps(
    [
        {"name": "context7", "enabled": True, "transport": {"type": "stdio"}},
        {"name": "node_repl", "enabled": True, "transport": {"type": "stdio"}},
    ]
)


def _install(
    monkeypatch,
    *,
    mcp_help=_MCP_HELP_MANAGED,
    mcp_help_rc=0,
    list_json=_LIST_JSON,
    list_rc=0,
):
    monkeypatch.setattr(codex.shutil, "which", lambda _b: "/usr/local/bin/codex")

    def fake_probe(argv, timeout):
        rest = argv[1:]
        if rest == ["mcp", "--help"]:
            return probe.ProbeResult(mcp_help_rc, mcp_help if mcp_help_rc == 0 else "", "", False)
        if rest == ["mcp", "list", "--json"]:
            return probe.ProbeResult(list_rc, list_json if list_rc == 0 else "", "", False)
        return probe.ProbeResult(0, "", "", False)

    monkeypatch.setattr(probe, "run", fake_probe)


# --- detection & not-installed -------------------------------------------


def test_not_installed(monkeypatch):
    monkeypatch.setattr(codex.shutil, "which", lambda _b: None)
    a = CodexAdapter()
    assert a.detect().installed is False
    caps = a.capabilities()
    assert not any([caps.canList, caps.canInstall, caps.canRemove])
    assert a.list_installed() == []


def test_detect_which_only_no_version(monkeypatch):
    _install(monkeypatch)
    env = CodexAdapter().detect()
    assert env.installed is True and env.version is None


# --- capabilities: managed vs read-only ----------------------------------


def test_capabilities_managed(monkeypatch):
    _install(monkeypatch)
    caps = CodexAdapter().capabilities()
    assert caps.canList and caps.canInstall and caps.canRemove
    assert caps.canUpdate is False and caps.canSearch is False
    assert caps.requiresNewSession is True
    assert "canInstall" not in caps.reasons  # supported → no reason


def test_capabilities_read_only_when_help_unreadable(monkeypatch):
    _install(monkeypatch, mcp_help_rc=1)
    caps = CodexAdapter().capabilities()
    # Listing still works (config.toml), management does not.
    assert caps.canList is True
    assert caps.canInstall is False and caps.canRemove is False
    assert "설정 파일" in caps.reasons["canInstall"]


def test_capabilities_read_only_when_no_add(monkeypatch):
    _install(monkeypatch, mcp_help="Usage: codex mcp\n  list\n  get\n")  # no add/remove
    caps = CodexAdapter().capabilities()
    assert caps.canList is True and caps.canInstall is False


# --- listing: CLI JSON vs config.toml ------------------------------------


def test_list_via_cli_json(monkeypatch):
    _install(monkeypatch)
    names = [it["name"] for it in CodexAdapter().list_installed()]
    assert names == ["context7", "node_repl"]


def test_list_falls_back_to_config_when_read_only(monkeypatch, tmp_path):
    _install(monkeypatch, mcp_help_rc=1)  # read-only mode → config.toml
    config = tmp_path / "config.toml"
    config.write_text(
        "[mcp_servers.alpha]\n" "[mcp_servers.alpha.env]\n" '[mcp_servers."beta-two"]\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(codex, "_config_path", lambda: config)
    names = [it["name"] for it in CodexAdapter().list_installed()]
    assert names == ["alpha", "beta-two"]  # subtable .env collapsed, quoted unquoted


def test_list_via_cli_malformed_json_falls_back(monkeypatch, tmp_path):
    _install(monkeypatch, list_json="not json")
    config = tmp_path / "config.toml"
    config.write_text("[mcp_servers.gamma]\ncommand = 'g'\n", encoding="utf-8")
    monkeypatch.setattr(codex, "_config_path", lambda: config)
    names = [it["name"] for it in CodexAdapter().list_installed()]
    assert names == ["gamma"]


def test_config_missing_is_empty(monkeypatch, tmp_path):
    _install(monkeypatch, mcp_help_rc=1)
    monkeypatch.setattr(codex, "_config_path", lambda: tmp_path / "absent.toml")
    assert CodexAdapter().list_installed() == []


def test_parse_config_server_names_direct():
    text = (
        "[mcp_servers.node_repl]\n[mcp_servers.node_repl.env]\n"
        '[mcp_servers."my-srv"]\n[other.table]\n'
    )
    assert codex._parse_config_server_names(text) == ["node_repl", "my-srv"]
    assert codex._parse_config_server_names("") == []


# --- planning & verification ---------------------------------------------


def test_plan_remove_argv(monkeypatch):
    _install(monkeypatch)
    plan = CodexAdapter().plan("remove", "context7", None)
    assert plan.argv == ["codex", "mcp", "remove", "context7"]


def test_plan_install_requires_command(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        CodexAdapter().plan("install", "context7", None)


def test_plan_mcp_add_argv(monkeypatch):
    _install(monkeypatch)
    plan = CodexAdapter().plan_mcp_add("context7", ["npx", "-y", "@upstash/context7-mcp"])
    assert plan.argv == [
        "codex",
        "mcp",
        "add",
        "context7",
        "--",
        "npx",
        "-y",
        "@upstash/context7-mcp",
    ]


def test_verify_install_present_absent(monkeypatch):
    _install(monkeypatch)  # CLI list has context7
    ok, _ = CodexAdapter().verify("install", "context7")
    assert ok is True
    ok, _ = CodexAdapter().verify("install", "missing")
    assert ok is False


def test_verify_remove_and_unknown(monkeypatch):
    _install(monkeypatch)  # CLI list has context7, node_repl
    ok, _ = CodexAdapter().verify("remove", "missing")  # absent → removal succeeded
    assert ok is True
    ok, _ = CodexAdapter().verify("remove", "context7")  # still present → failed
    assert ok is False
    ok, detail = CodexAdapter().verify("frobnicate", "context7")
    assert ok is False and "unknown action" in detail


def test_plan_unsupported_action(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        CodexAdapter().plan("update", "context7", None)
