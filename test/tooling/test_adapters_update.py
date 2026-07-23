"""Unit tests for CLI self-update support in the codex/claude/agy adapters.

Covers Phase C (AI CLI self-update): each adapter must report ``canUpdateAll``
and plan a bare ``<binary> update`` invocation via the target-exempt
``update_all`` action (not ``update`` — that capability/action pair stays
gating the per-MCP-server update in InstalledPane, which these adapters still
do not support, so ``canUpdate`` must stay ``False``). These tests never
execute the real update — ``plan()`` only builds an :class:`ExecutionPlan`
(argv), it does not run it; nothing here calls ``runner.run``.
"""

import pytest

from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter

ADAPTERS = [(CodexAdapter(), "codex"), (ClaudeCodeAdapter(), "claude"), (AntigravityAdapter(), "agy")]


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_can_update_all_cli_binary(adapter, binary):
    assert adapter.capabilities().canUpdateAll is True


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_cannot_update_single_mcp_server(adapter, binary):
    """canUpdate (per-MCP-server update, gated in InstalledPane) stays unsupported."""
    assert adapter.capabilities().canUpdate is False


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_update_all_plan_runs_binary_update(adapter, binary):
    plan = adapter.plan("update_all", None, None)
    assert plan.argv == [binary, "update"]
