"""Unit tests for the ``install_cli`` action (npm-based fixed CLI install).

Security-critical: ``install_cli`` must plan a HARDCODED per-provider npm
package. The client-supplied ``target`` must never influence the argv —
otherwise a renderer could smuggle an arbitrary package name into a real
``npm install -g`` call.
"""

import pytest

from cli_agent_orchestrator.services.tooling import operations, runner
from cli_agent_orchestrator.services.tooling.adapters import claude_code, codex
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter


def test_install_cli_is_a_valid_action():
    assert "install_cli" in operations.VALID_ACTIONS


def test_npm_is_allowlisted():
    assert "npm" in runner.ALLOWED_BINARIES


@pytest.mark.parametrize(
    "adapter,pkg",
    [
        (CodexAdapter(), "@openai/codex"),
        (ClaudeCodeAdapter(), "@anthropic-ai/claude-code"),
    ],
)
def test_install_cli_plan_uses_fixed_package(adapter, pkg):
    assert adapter.capabilities().canInstallCli is True
    plan = adapter.plan("install_cli", None, None)
    assert plan.argv == ["npm", "install", "-g", pkg]


@pytest.mark.parametrize("adapter", [CodexAdapter(), ClaudeCodeAdapter()])
def test_install_cli_ignores_client_target(adapter):
    # target from client must NOT influence the package (security)
    plan = adapter.plan("install_cli", "evil-package", None)
    assert "evil-package" not in plan.argv


@pytest.mark.parametrize(
    "module,adapter",
    [
        (codex, CodexAdapter()),
        (claude_code, ClaudeCodeAdapter()),
    ],
)
def test_install_cli_capability_true_even_when_not_installed(monkeypatch, module, adapter):
    # The whole point of install_cli is bootstrapping when the CLI is absent,
    # so canInstallCli must stay True even on the "not installed" branch.
    monkeypatch.setattr(module.shutil, "which", lambda _b: None)
    assert adapter.capabilities().canInstallCli is True


# -- Task 2: minimal install-only adapters (kiro_cli/copilot_cli/opencode_cli) --


def test_new_adapters_registered():
    from cli_agent_orchestrator.services.tooling.adapters import registry

    adapters = registry.get_adapters()
    for pid in ("kiro_cli", "copilot_cli", "opencode_cli"):
        assert pid in adapters
        assert registry.get_adapter(pid) is not None


@pytest.mark.parametrize(
    "pid,pkg",
    [
        ("kiro_cli", "@anthropic-ai/kiro-cli"),
        ("copilot_cli", "@github/copilot"),
        ("opencode_cli", "opencode-ai"),
    ],
)
def test_new_adapter_install_cli(pid, pkg):
    from cli_agent_orchestrator.services.tooling.adapters import registry

    adapter = registry.get_adapter(pid)
    assert adapter.capabilities().canInstallCli is True
    assert adapter.plan("install_cli", None, None).argv == ["npm", "install", "-g", pkg]
    # every other action is refused (install-only adapter)
    with pytest.raises(ValueError):
        adapter.plan("remove", "x", None)


@pytest.mark.parametrize("pid", ["kiro_cli", "copilot_cli", "opencode_cli"])
def test_new_adapter_install_cli_ignores_client_target(pid):
    from cli_agent_orchestrator.services.tooling.adapters import registry

    adapter = registry.get_adapter(pid)
    # target from client must NOT influence the package (security)
    plan = adapter.plan("install_cli", "evil-package", None)
    assert "evil-package" not in plan.argv
