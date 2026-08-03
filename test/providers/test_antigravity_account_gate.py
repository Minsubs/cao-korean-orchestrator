"""agy's account-eligibility gate must fail a terminal, not silently eat its work.

Measured over the 3x3 cross-provider matrix (2026-08-03): agy can finish
launching with

    ⚠ Verifying your account...
    ⎿  We're finishing verifying your account eligibility.
       This usually takes a moment. Please try again shortly.

still on screen, while its status bar already reads Idle. Every readiness check
therefore passes — but input pasted in that state is discarded: the keystrokes
render in the composer once and no turn ever runs. Across six agy terminals the
split was exact: banner present -> the task was never processed (3/3), banner
absent -> processed (3/3). Each failure cost a 300s worker-created timeout with
nothing in the logs, because CAO believed it had delivered the task.
"""

from unittest.mock import patch

import pytest

from cli_agent_orchestrator.providers.antigravity_cli import (
    ACCOUNT_GATE_PATTERN,
    AntigravityAccountVerificationError,
    AntigravityCliProvider,
    ProviderError,
)

GATED_PANE = """\
  You are the antigravity_orchestrator_agy. Acknowledge your role in one sentence.
⚠ Verifying your account...
  ⎿  We're finishing verifying your account eligibility.
     This usually takes a moment. Please try again shortly.
  I am the antigravity_orchestrator_agy, ready to coordinate specialists.
Gemini 3.1 Pro (High) │ Idle │ Context 100% left │ ~/work [sandbox]
"""

READY_PANE = """\
  I am the antigravity_orchestrator_agy, ready to coordinate specialists.
Gemini 3.1 Pro (High) │ Idle │ Context 100% left │ ~/work [sandbox]
"""


def make_provider() -> AntigravityCliProvider:
    return AntigravityCliProvider(
        terminal_id="test-tid",
        session_name="test-session",
        window_name="window-0",
    )


def test_pattern_matches_the_live_banner():
    import re

    assert re.search(ACCOUNT_GATE_PATTERN, GATED_PANE)
    assert not re.search(ACCOUNT_GATE_PATTERN, READY_PANE)


def test_ready_pane_passes_without_waiting():
    with (
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep") as sleep,
    ):
        backend.return_value.get_history.return_value = READY_PANE
        make_provider()._require_account_verified(timeout=30.0)
    sleep.assert_not_called()


def test_gate_that_clears_lets_initialization_continue():
    # The banner is sometimes a transient re-check, so this must be a bounded
    # wait rather than an instant refusal.
    panes = [GATED_PANE, GATED_PANE, READY_PANE]
    with (
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep"),
    ):
        backend.return_value.get_history.side_effect = panes
        make_provider()._require_account_verified(timeout=30.0)


def test_gate_that_never_clears_raises_with_the_operator_action():
    with (
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep"),
    ):
        backend.return_value.get_history.return_value = GATED_PANE
        with pytest.raises(AntigravityAccountVerificationError) as excinfo:
            make_provider()._require_account_verified(timeout=0.0)

    message = str(excinfo.value)
    assert "verifying" in message.lower()
    # The message has to say what to do, not just what happened: the gate needs a
    # human to finish signing in.
    assert "agy" in message


def test_error_is_a_provider_error_so_existing_handlers_still_catch_it():
    assert issubclass(AntigravityAccountVerificationError, ProviderError)


def test_initialize_refuses_a_gated_terminal():
    """The check belongs to initialize(), so an assigned worker is covered too —
    assign() fails loudly instead of creating a worker that ignores its task."""
    provider = make_provider()
    with (
        patch.object(AntigravityCliProvider, "_build_agy_command", return_value="agy"),
        patch.object(AntigravityCliProvider, "_handle_startup_dialog", return_value=None),
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.wait_for_shell") as shell,
        patch("cli_agent_orchestrator.providers.antigravity_cli.wait_until_status") as status,
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep"),
    ):
        backend.return_value.get_history.return_value = GATED_PANE

        async def _true(*args, **kwargs):
            return True

        shell.side_effect = _true
        status.side_effect = _true
        import asyncio

        with pytest.raises(AntigravityAccountVerificationError):
            asyncio.run(provider.initialize())

    assert provider._initialized is False
