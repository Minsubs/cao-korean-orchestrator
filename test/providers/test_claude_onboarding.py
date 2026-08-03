"""Claude Code's first-run onboarding screen must fail fast and say why.

Measured on a machine with `hasCompletedOnboarding: false` in ~/.claude.json
(claude 2.1.220 after a 2.1.141 onboarding): every spawned terminal sat on the
theme/login screen and session creation died with "Claude Code initialization
timed out after 60s". Meanwhile `claude -p "say OK"` answered fine — the CLI was
installed and signed in the whole time, so the timeout pointed at the wrong
thing entirely.
"""

import re

from cli_agent_orchestrator.providers.claude_code import (
    ONBOARDING_PROMPT_PATTERNS,
    ClaudeCodeOnboardingRequiredError,
)


def _matches(text: str) -> bool:
    return any(re.search(pattern, text) for pattern in ONBOARDING_PROMPT_PATTERNS)


class TestOnboardingDetection:
    def test_detects_the_theme_screen(self):
        # Captured from the live pane.
        pane = (
            " Let's get started.\n"
            " Choose the text style that looks best with your terminal\n"
            " To change this later, run /theme\n"
            "   1. Auto (match terminal)\n"
        )
        assert _matches(pane) is True

    def test_detects_the_login_screen(self):
        pane = (
            " Claude Code can be used with your Claude subscription or billed based on API usage\n"
            " Select login method:\n"
            " > 1. Claude account with subscription\n"
        )
        assert _matches(pane) is True

    def test_ignores_a_normal_ready_pane(self):
        pane = "Welcome to Claude Code v2.1.220\n\n❯ \n  Model: Opus 5 | ctx:0%\n"
        assert _matches(pane) is False

    def test_ignores_the_prompts_that_are_auto_answered(self):
        # Trust/bypass/import prompts have their own handlers; onboarding must not
        # swallow them.
        for pane in (
            "Do you trust the files in this folder?\n  1. Yes, I trust this folder\n",
            "Bypass permissions mode\n  2. Yes, I accept\n",
            "Allow external CLAUDE.md file imports?\n  1. Yes, allow external imports\n",
        ):
            assert _matches(pane) is False


class TestErrorMessage:
    def test_says_what_to_do_and_where(self):
        error = ClaudeCodeOnboardingRequiredError(
            "Claude Code is waiting on its first-run setup (theme/login) and cannot "
            "be started unattended. Run `claude` once in a terminal, finish the "
            "onboarding, then retry. (~/.claude.json: hasCompletedOnboarding)"
        )
        text = str(error)
        assert "Run `claude` once" in text
        assert "hasCompletedOnboarding" in text
        assert "timed out" not in text
