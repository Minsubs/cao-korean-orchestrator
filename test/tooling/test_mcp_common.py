"""Unit tests for the shared MCP adapter helpers."""

from cli_agent_orchestrator.services.tooling import probe
from cli_agent_orchestrator.services.tooling.adapters import _mcp_common

_KNOWN = ("list", "add", "remove")


def test_probe_subcommands_finds_present_tokens(monkeypatch):
    monkeypatch.setattr(
        probe, "run", lambda argv, timeout: probe.ProbeResult(0, "  add\n  list\n", "", False)
    )
    found = _mcp_common.probe_subcommands(["claude", "mcp", "--help"], _KNOWN, "k1")
    assert found == {"add", "list"}


def test_probe_subcommands_none_on_nonzero_exit(monkeypatch):
    monkeypatch.setattr(probe, "run", lambda argv, timeout: probe.ProbeResult(1, "", "", False))
    assert _mcp_common.probe_subcommands(["codex", "mcp", "--help"], _KNOWN, "k2") is None


def test_probe_subcommands_none_on_empty_output(monkeypatch):
    monkeypatch.setattr(
        probe, "run", lambda argv, timeout: probe.ProbeResult(0, "   \n", "", False)
    )
    assert _mcp_common.probe_subcommands(["codex", "mcp", "--help"], _KNOWN, "k3") is None


def test_probe_subcommands_is_cached(monkeypatch):
    calls = {"n": 0}

    def counting(argv, timeout):
        calls["n"] += 1
        return probe.ProbeResult(0, "add\n", "", False)

    monkeypatch.setattr(probe, "run", counting)
    first = _mcp_common.probe_subcommands(["claude", "mcp", "--help"], _KNOWN, "k4")
    second = _mcp_common.probe_subcommands(["claude", "mcp", "--help"], _KNOWN, "k4")
    assert first == second == {"add"}
    assert calls["n"] == 1  # probed once; second call served from the TTL cache


def test_unreadable_result_is_cached(monkeypatch):
    calls = {"n": 0}

    def counting(argv, timeout):
        calls["n"] += 1
        return probe.ProbeResult(1, "", "", False)

    monkeypatch.setattr(probe, "run", counting)
    assert _mcp_common.probe_subcommands(["c", "mcp", "--help"], _KNOWN, "k5") is None
    assert _mcp_common.probe_subcommands(["c", "mcp", "--help"], _KNOWN, "k5") is None
    assert calls["n"] == 1  # the "unreadable" sentinel is cached, not re-probed


def test_argv_builders():
    assert _mcp_common.mcp_list_argv("claude") == ["claude", "mcp", "list"]
    assert _mcp_common.mcp_remove_argv("codex", "srv") == ["codex", "mcp", "remove", "srv"]
    assert _mcp_common.mcp_add_argv("claude", "srv", ["npx", "-y", "pkg"]) == [
        "claude",
        "mcp",
        "add",
        "srv",
        "--",
        "npx",
        "-y",
        "pkg",
    ]
