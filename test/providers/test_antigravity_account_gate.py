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


def test_launch_watch_leaves_immediately_when_the_banner_shows():
    """A gated launch pays no extra wait — the watch exits on the first sighting."""
    provider = make_provider()
    with (
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep") as sleep,
    ):
        backend.return_value.get_history.return_value = GATED_PANE
        assert provider._gate_appears_during_launch() is True
    sleep.assert_not_called()


def test_launch_watch_catches_a_banner_drawn_after_the_first_read():
    """The reason this is a loop and not a read.

    agy reports its idle status bar before it contacts the backend, so the first
    read lands on a pane where the banner does not exist yet. Two earlier
    attempts (read at readiness; read after the launch turn) both reported clean
    for terminals whose own logs show the banner — a full-screen TUI keeps only
    the current frame, so a missed moment is gone for good.
    """
    provider = make_provider()
    provider.GATE_POLL_S = 0.01
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.side_effect = [READY_PANE, READY_PANE, GATED_PANE]
        assert provider._gate_appears_during_launch() is True


def test_launch_watch_gives_up_on_a_healthy_pane():
    provider = make_provider()
    provider.LAUNCH_TURN_WAIT_S = 0.0
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.return_value = READY_PANE
        assert provider._gate_appears_during_launch() is False


def test_error_is_a_provider_error_so_existing_handlers_still_catch_it():
    assert issubclass(AntigravityAccountVerificationError, ProviderError)


def test_input_is_blocked_while_the_gate_is_up():
    """The launch-time check is not enough on its own.

    agy shows "│ Idle │" for a moment before it contacts the backend, so
    initialize() can pass *before* the banner is drawn — measured live: the
    startup check read a clean pane and the very next paste was still dropped.
    The send path is where refusing actually saves the work.
    """
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.return_value = GATED_PANE
        reason = make_provider().input_block_reason()

    assert reason and "eligibility" in reason
    # Says what to do about it, not just what happened.
    assert "start a new one" in reason


def test_input_is_allowed_once_the_banner_scrolls_out_of_view():
    """Bounded to the footer window: a banner left in the scrollback must not
    block a terminal that went on to work normally."""
    recovered = GATED_PANE + ("\n  real output line\n" * 400)
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.return_value = recovered
        assert make_provider().input_block_reason() is None


def test_input_is_allowed_on_a_ready_pane():
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.return_value = READY_PANE
        assert make_provider().input_block_reason() is None


def test_a_failed_pane_read_never_blocks_input():
    # The guard runs on every send_input; it must not be the thing that breaks
    # sending when tmux hiccups.
    with patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend:
        backend.return_value.get_history.side_effect = RuntimeError("tmux busy")
        assert make_provider().input_block_reason() is None


def test_other_providers_do_not_block_by_default():
    from cli_agent_orchestrator.providers.codex import CodexProvider

    provider = CodexProvider(terminal_id="t", session_name="s", window_name="w")
    assert provider.input_block_reason() is None


def _run_initialize(provider, pane_sequence):
    """Drive initialize() and return (result_or_error, backend_mock)."""
    import asyncio

    async def _true(*args, **kwargs):
        return True

    with (
        patch.object(AntigravityCliProvider, "_build_agy_command", return_value="agy"),
        patch.object(AntigravityCliProvider, "_handle_startup_dialog", return_value=None),
        patch("cli_agent_orchestrator.providers.antigravity_cli.get_backend") as backend,
        patch("cli_agent_orchestrator.providers.antigravity_cli.wait_for_shell", side_effect=_true),
        patch(
            "cli_agent_orchestrator.providers.antigravity_cli.wait_until_status", side_effect=_true
        ),
        patch("cli_agent_orchestrator.providers.antigravity_cli.time.sleep"),
    ):
        if isinstance(pane_sequence, list):
            backend.return_value.get_history.side_effect = pane_sequence
        else:
            backend.return_value.get_history.return_value = pane_sequence
        try:
            return asyncio.run(provider.initialize()), backend
        except Exception as exc:  # returned so the caller can assert on it
            return exc, backend


def test_initialize_restarts_the_cli_once_when_it_launches_gated():
    """A gated instance never recovers, so the only fix is a new one.

    Gates cluster on launches that closely follow another one, and a fresh
    launch is usually clean — so one restart turns most of them into a working
    terminal instead of a failed session.
    """
    provider = make_provider()
    provider.LAUNCH_TURN_WAIT_S = 0.0
    # gate seen at launch -> restart -> clean afterwards
    result, backend = _run_initialize(provider, [GATED_PANE, READY_PANE])

    assert result is True
    assert provider._initialized is True
    sent = [call.args[2] for call in backend.return_value.send_keys.call_args_list]
    assert sent.count("agy") == 2, "the CLI must actually be relaunched"
    assert "/quit" in sent, "the gated CLI has to be quit before relaunching"


def test_initialize_refuses_when_the_restart_is_gated_too():
    """Two gated launches in a row is not a transient — fail with the reason
    instead of handing back a worker that ignores its task."""
    provider = make_provider()
    provider.LAUNCH_TURN_WAIT_S = 0.0
    result, _ = _run_initialize(provider, GATED_PANE)

    assert isinstance(result, AntigravityAccountVerificationError)
    assert provider._initialized is False


def test_initialize_does_not_restart_a_clean_launch():
    provider = make_provider()
    provider.LAUNCH_TURN_WAIT_S = 0.0
    result, backend = _run_initialize(provider, READY_PANE)

    assert result is True
    sent = [call.args[2] for call in backend.return_value.send_keys.call_args_list]
    assert sent == ["agy"], "a healthy launch must not be restarted"


def test_initialize_catches_a_gate_that_appears_after_readiness():
    """End to end over the exact live failure: the pane reads clean when agy
    reports ready, the banner lands a moment later, and the CLI is relaunched."""
    provider = make_provider()
    provider.LAUNCH_TURN_WAIT_S = 0.2
    provider.GATE_POLL_S = 0.01
    # clean, clean, gated  -> restart -> clean
    result, backend = _run_initialize(provider, [READY_PANE, READY_PANE, GATED_PANE, READY_PANE])

    assert result is True
    sent = [call.args[2] for call in backend.return_value.send_keys.call_args_list]
    assert sent.count("agy") == 2
    assert "/quit" in sent
