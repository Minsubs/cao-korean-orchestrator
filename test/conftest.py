"""Repo-wide test fixtures."""

import pytest

from cli_agent_orchestrator.services import terminal_service


@pytest.fixture(autouse=True)
def _no_llm_compile_in_tests(monkeypatch):
    """Default memory wiki compilation to append mode for every test.

    The production default is "llm", which drives whichever coding-agent CLI
    (claude / codex / kiro-cli) is installed on the developer's machine — each
    invocation cold-starts for tens of seconds and would make the suite both
    slow and non-hermetic. Tests that exercise the LLM path override this env
    var themselves or stub the ``wiki_compiler`` seams.
    """
    monkeypatch.setenv("CAO_MEMORY_COMPILE_MODE", "append")


@pytest.fixture(autouse=True)
def _no_live_terminal_monitor_restore(monkeypatch):
    """Keep API lifespan tests from reconnecting real user tmux sessions."""
    monkeypatch.setattr(terminal_service, "restore_terminal_monitors", lambda: 0)
