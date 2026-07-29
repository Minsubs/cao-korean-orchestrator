"""Unit tests for CLI self-update support in the codex/claude/agy adapters.

Covers Phase C (AI CLI self-update): each adapter must report ``canUpdateAll``
and plan a bare ``<binary> update`` invocation via the target-exempt
``update_all`` action (not ``update`` — that capability/action pair stays
gating the per-MCP-server update in InstalledPane, which these adapters still
do not support, so ``canUpdate`` must stay ``False``). These tests never
execute the real update — ``plan()`` only builds an :class:`ExecutionPlan`
(argv), it does not run it; nothing here calls ``runner.run``.

``capabilities()`` early-returns :func:`unsupported_capabilities` when
``detect()`` finds no binary, so every capability assertion here pins
``detect()`` explicitly instead of inheriting whatever happens to be on PATH.
Without that pin these tests passed on a dev box (codex/claude/agy installed)
and failed on CI (none installed) — the assertions were describing the
not-installed branch there, not the contract they name. The not-installed
branch now has its own test rather than being an accident of the environment.
"""

import pytest

from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter
from cli_agent_orchestrator.services.tooling.adapters.base import AdapterEnv
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter

ADAPTERS = [
    (CodexAdapter(), "codex"),
    (ClaudeCodeAdapter(), "claude"),
    (AntigravityAdapter(), "agy"),
]


def _pin_installed(monkeypatch, adapter, binary: str) -> None:
    """Report the CLI as present, whatever the runner's PATH holds."""
    monkeypatch.setattr(
        adapter,
        "detect",
        lambda: AdapterEnv(installed=True, path=f"/usr/local/bin/{binary}", version=None),
    )


def _pin_absent(monkeypatch, adapter) -> None:
    """Report the CLI as missing, whatever the runner's PATH holds."""
    monkeypatch.setattr(
        adapter, "detect", lambda: AdapterEnv(installed=False, path=None, version=None)
    )


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_can_update_all_cli_binary(monkeypatch, adapter, binary):
    _pin_installed(monkeypatch, adapter, binary)
    assert adapter.capabilities().canUpdateAll is True


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_cannot_update_all_when_cli_absent(monkeypatch, adapter, binary):
    """No binary to update — offering "update all" would be a dead button."""
    _pin_absent(monkeypatch, adapter)
    assert adapter.capabilities().canUpdateAll is False


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_cannot_update_single_mcp_server(monkeypatch, adapter, binary):
    """canUpdate (per-MCP-server update, gated in InstalledPane) stays unsupported."""
    _pin_installed(monkeypatch, adapter, binary)
    assert adapter.capabilities().canUpdate is False


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_update_all_plan_runs_binary_update(adapter, binary):
    plan = adapter.plan("update_all", None, None)
    assert plan.argv == [binary, "update"]
