"""Unit tests for CLI self-update support in the codex/claude/agy adapters.

Covers Phase C (AI CLI self-update): each adapter must report ``canUpdate`` and
plan a bare ``<binary> update`` invocation. These tests never execute the real
update — ``plan()`` only builds an :class:`ExecutionPlan` (argv), it does not
run it; nothing here calls ``runner.run``.
"""

import pytest

from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter

ADAPTERS = [(CodexAdapter(), "codex"), (ClaudeCodeAdapter(), "claude"), (AntigravityAdapter(), "agy")]


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_can_update_cli_binary(adapter, binary):
    assert adapter.capabilities().canUpdate is True


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_update_plan_runs_binary_update(adapter, binary):
    plan = adapter.plan("update", None, None)
    assert plan.argv == [binary, "update"]
