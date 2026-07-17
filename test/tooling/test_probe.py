"""Unit tests for the argv-only probe runner."""

import subprocess

import pytest

from cli_agent_orchestrator.services.tooling import probe


def test_run_uses_argv_and_disables_shell(monkeypatch):
    """The command is passed as an argv list with shell disabled."""
    captured = {}

    def fake_run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout="tool 1.0\n", stderr=""
        )

    monkeypatch.setattr(probe.subprocess, "run", fake_run)
    result = probe.run(["claude", "--version"], timeout=5.0)

    assert captured["args"][0] == ["claude", "--version"]
    assert captured["kwargs"].get("shell") is False
    assert captured["kwargs"].get("timeout") == 5.0
    assert captured["kwargs"].get("capture_output") is True
    assert captured["kwargs"].get("text") is True
    assert result.returncode == 0
    assert result.stdout == "tool 1.0\n"
    assert result.timed_out is False


def test_run_timeout_yields_timed_out_result(monkeypatch):
    """A TimeoutExpired maps to timed_out=True with no return code."""

    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(
            cmd=args[0], timeout=kwargs.get("timeout"), output="partial", stderr="err"
        )

    monkeypatch.setattr(probe.subprocess, "run", fake_run)
    result = probe.run(["slowbin", "--version"], timeout=0.5)

    assert result.timed_out is True
    assert result.returncode is None
    assert result.stdout == "partial"
    assert result.stderr == "err"


def test_run_truncates_output(monkeypatch):
    """stdout/stderr are clamped to PROBE_OUTPUT_LIMIT."""
    big = "x" * (probe.PROBE_OUTPUT_LIMIT + 5000)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args=args[0], returncode=0, stdout=big, stderr=big)

    monkeypatch.setattr(probe.subprocess, "run", fake_run)
    result = probe.run(["chatty"], timeout=1.0)

    assert len(result.stdout) == probe.PROBE_OUTPUT_LIMIT
    assert len(result.stderr) == probe.PROBE_OUTPUT_LIMIT


def test_run_oserror_maps_to_failed_result(monkeypatch):
    """A binary that cannot be executed yields returncode=None + stderr text."""

    def fake_run(*args, **kwargs):
        raise FileNotFoundError("no such binary")

    monkeypatch.setattr(probe.subprocess, "run", fake_run)
    result = probe.run(["ghost"], timeout=1.0)

    assert result.returncode is None
    assert result.timed_out is False
    assert "no such binary" in result.stderr


def test_run_rejects_empty_argv():
    with pytest.raises(ValueError):
        probe.run([], timeout=1.0)
