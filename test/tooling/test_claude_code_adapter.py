"""Unit tests for the Claude Code adapter (which + probe mocked)."""

import pytest

from cli_agent_orchestrator.services.tooling import probe
from cli_agent_orchestrator.services.tooling.adapters import claude_code
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter

_MCP_HELP_FULL = "Usage: claude mcp\n  add\n  remove\n  list\n  get\n"
_PLUGIN_HELP_FULL = "Usage: claude plugin\n  install\n  uninstall\n  marketplace\n  list\n"


def _install(
    monkeypatch,
    *,
    version="2.1.212 (Claude Code)",
    version_rc=0,
    mcp_help=_MCP_HELP_FULL,
    mcp_help_rc=0,
    plugin_help=_PLUGIN_HELP_FULL,
    plugin_help_rc=0,
    list_out="",
):
    monkeypatch.setattr(claude_code.shutil, "which", lambda _b: "/usr/local/bin/claude")

    def fake_probe(argv, timeout):
        rest = argv[1:]
        if rest == ["--version"]:
            return probe.ProbeResult(version_rc, version if version_rc == 0 else "", "", False)
        if rest == ["mcp", "--help"]:
            return probe.ProbeResult(mcp_help_rc, mcp_help if mcp_help_rc == 0 else "", "", False)
        if rest == ["plugin", "--help"]:
            return probe.ProbeResult(
                plugin_help_rc, plugin_help if plugin_help_rc == 0 else "", "", False
            )
        if rest == ["mcp", "list"]:
            return probe.ProbeResult(0, list_out, "", False)
        return probe.ProbeResult(0, "", "", False)

    monkeypatch.setattr(probe, "run", fake_probe)


# --- detection & not-installed -------------------------------------------


def test_not_installed(monkeypatch):
    monkeypatch.setattr(claude_code.shutil, "which", lambda _b: None)
    a = ClaudeCodeAdapter()
    env = a.detect()
    assert env.installed is False and env.path is None and env.version is None
    caps = a.capabilities()
    assert not any([caps.canList, caps.canInstall, caps.canRemove])
    assert "감지되지" in caps.reasons["canInstall"]
    assert a.list_installed() == []


def test_detect_reads_version(monkeypatch):
    _install(monkeypatch, version="2.1.212 (Claude Code)")
    env = ClaudeCodeAdapter().detect()
    assert env.installed is True
    assert env.path == "/usr/local/bin/claude"
    assert env.version == "2.1.212 (Claude Code)"


def test_detect_version_probe_failure_is_none(monkeypatch):
    _install(monkeypatch, version_rc=1)
    assert ClaudeCodeAdapter().detect().version is None


# --- capabilities from mcp --help ----------------------------------------


def test_capabilities_full(monkeypatch):
    _install(monkeypatch)
    caps = ClaudeCodeAdapter().capabilities()
    assert caps.canList and caps.canInstall and caps.canRemove
    # canUpdateAll=True means "update the claude CLI binary itself" (`claude
    # update`, via the target-exempt update_all action) — independent of MCP
    # server management. canUpdate (per-MCP-server update) stays unsupported.
    assert caps.canUpdate is False and caps.canUpdateAll is True and caps.canSearch is False
    assert caps.requiresNewSession is True
    assert "canUpdateAll" not in caps.reasons  # supported → no reason needed
    assert "개별 업데이트" in caps.reasons["canUpdate"]
    # Plugins are manageable here (install + marketplace present).
    assert "plugin" in caps.reasons and "claude plugin" in caps.reasons["plugin"]


def test_capabilities_mcp_help_unreadable(monkeypatch):
    _install(monkeypatch, mcp_help_rc=1)
    caps = ClaudeCodeAdapter().capabilities()
    assert not any([caps.canList, caps.canInstall, caps.canRemove])
    assert "읽지 못해" in caps.reasons["canInstall"]


def test_capabilities_missing_add_subcommand(monkeypatch):
    _install(monkeypatch, mcp_help="Usage: claude mcp\n  list\n  get\n")  # no add/remove
    caps = ClaudeCodeAdapter().capabilities()
    assert caps.canList is True
    assert caps.canInstall is False and caps.canRemove is False
    assert "add" in caps.reasons["canInstall"]


def test_capabilities_plugin_interactive_when_unmanageable(monkeypatch):
    _install(monkeypatch, plugin_help="Usage: claude plugin\n  list\n")  # no install/marketplace
    caps = ClaudeCodeAdapter().capabilities()
    assert "Plugin Browser" in caps.reasons["plugin"]


# --- planning -------------------------------------------------------------


def test_plan_remove_argv(monkeypatch):
    _install(monkeypatch)
    plan = ClaudeCodeAdapter().plan("remove", "context7", None)
    assert plan.argv == ["claude", "mcp", "remove", "context7"]
    assert "context7" in plan.verify_description


def test_plan_install_requires_command(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        ClaudeCodeAdapter().plan("install", "context7", None)


def test_plan_mcp_add_argv(monkeypatch):
    _install(monkeypatch)
    plan = ClaudeCodeAdapter().plan_mcp_add("context7", ["npx", "-y", "@upstash/context7-mcp"])
    assert plan.argv == [
        "claude",
        "mcp",
        "add",
        "context7",
        "--",
        "npx",
        "-y",
        "@upstash/context7-mcp",
    ]


def test_plan_mcp_add_requires_name_and_command(monkeypatch):
    _install(monkeypatch)
    a = ClaudeCodeAdapter()
    with pytest.raises(ValueError):
        a.plan_mcp_add("", ["npx"])
    with pytest.raises(ValueError):
        a.plan_mcp_add("context7", [])


# --- listing --------------------------------------------------------------


def test_list_parsing_name_before_colon(monkeypatch):
    _install(
        monkeypatch,
        list_out=(
            "Checking MCP server health…\n"
            "\n"
            "context7: npx -y @upstash/context7-mcp - ✔ Connected\n"
            "claude.ai Google Drive: https://drive.example/mcp - ✔ Connected\n"
        ),
    )
    items = ClaudeCodeAdapter().list_installed()
    names = [it["name"] for it in items]
    assert "context7" in names
    assert "claude.ai Google Drive" in names
    # The health-check header has no ": " and is kept with name=None.
    assert any(it["name"] is None and "health" in it["raw"] for it in items)


# --- verification ---------------------------------------------------------


def test_verify_install_present_and_absent(monkeypatch):
    _install(monkeypatch, list_out="context7: cmd - ok\n")
    ok, detail = ClaudeCodeAdapter().verify("install", "context7")
    assert ok is True and "present" in detail

    _install(monkeypatch, list_out="other: cmd - ok\n")
    ok, _ = ClaudeCodeAdapter().verify("install", "context7")
    assert ok is False


def test_verify_remove_absent_is_success(monkeypatch):
    _install(monkeypatch, list_out="other: cmd - ok\n")
    ok, _ = ClaudeCodeAdapter().verify("remove", "context7")
    assert ok is True


def test_verify_requires_target(monkeypatch):
    _install(monkeypatch)
    ok, detail = ClaudeCodeAdapter().verify("install", None)
    assert ok is False and "target" in detail


def test_verify_remove_still_present_and_unknown(monkeypatch):
    _install(monkeypatch, list_out="context7: cmd - ok\n")
    ok, _ = ClaudeCodeAdapter().verify("remove", "context7")  # still present → failed
    assert ok is False
    ok, detail = ClaudeCodeAdapter().verify("frobnicate", "context7")
    assert ok is False and "unknown action" in detail


def test_plan_update_all_runs_binary_update(monkeypatch):
    """`update_all` plans a CLI self-update (`claude update`), not an MCP action."""
    _install(monkeypatch)
    plan = ClaudeCodeAdapter().plan("update_all", None, None)
    assert plan.argv == ["claude", "update"]


def test_plan_unsupported_action(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        ClaudeCodeAdapter().plan("frobnicate", "context7", None)
