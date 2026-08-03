"""Unit tests for the CAO_DEFAULT_SHELL resolution (Phase 7 §4 backend seam)."""

import os
import stat

from cli_agent_orchestrator.utils.default_shell import ENV_VAR, resolve_default_window_shell


def _make_executable(path):
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def test_unset_means_no_opinion(monkeypatch):
    """Nothing configured -> tmux keeps its own default-shell."""
    monkeypatch.delenv(ENV_VAR, raising=False)
    assert resolve_default_window_shell() is None


def test_blank_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv(ENV_VAR, "   ")
    assert resolve_default_window_shell() is None


def test_usable_shell_becomes_a_login_shell_command(monkeypatch, tmp_path):
    """The login flag is the point: it is what applies the user's rc/PATH."""
    shell = _make_executable(tmp_path / "zsh")
    monkeypatch.setenv(ENV_VAR, str(shell))

    assert resolve_default_window_shell() == f"exec {shell} -l"


def test_path_with_spaces_is_quoted(monkeypatch, tmp_path):
    directory = tmp_path / "my shells"
    directory.mkdir()
    shell = _make_executable(directory / "zsh")
    monkeypatch.setenv(ENV_VAR, str(shell))

    assert resolve_default_window_shell() == f"exec '{shell}' -l"


def test_relative_path_is_ignored(monkeypatch):
    """A bare name would resolve against tmux's PATH, not the user's — refuse."""
    monkeypatch.setenv(ENV_VAR, "zsh")
    assert resolve_default_window_shell() is None


def test_missing_file_is_ignored(monkeypatch, tmp_path):
    monkeypatch.setenv(ENV_VAR, str(tmp_path / "nope"))
    assert resolve_default_window_shell() is None


def test_directory_is_ignored(monkeypatch, tmp_path):
    monkeypatch.setenv(ENV_VAR, str(tmp_path))
    assert resolve_default_window_shell() is None


def test_non_executable_is_ignored(monkeypatch, tmp_path):
    """Configured but unusable falls back rather than launching something else."""
    shell = tmp_path / "zsh"
    shell.write_text("#!/bin/sh\n")
    shell.chmod(shell.stat().st_mode & ~stat.S_IXUSR & ~stat.S_IXGRP & ~stat.S_IXOTH)
    monkeypatch.setenv(ENV_VAR, str(shell))

    assert os.access(shell, os.X_OK) is False
    assert resolve_default_window_shell() is None
