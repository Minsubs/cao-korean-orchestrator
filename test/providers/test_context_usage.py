"""Unit tests for the remaining-context gauge (Phase 2d).

Covers ``BaseProvider.get_context_usage`` (default None), the ClaudeCodeProvider
footer parser across its known variants, the None-on-no-match contract, ANSI
tolerance, freshest-match selection, and the 0–100 clamp. Codex intentionally
inherits the base None (footer not calibrated yet).
"""

import pytest

from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.providers.base import BaseProvider
from cli_agent_orchestrator.providers.claude_code import ClaudeCodeProvider
from cli_agent_orchestrator.providers.codex import CodexProvider


class _ConcreteProvider(BaseProvider):
    """Minimal concrete provider to exercise the base-class default."""

    async def initialize(self) -> bool:
        return True

    def get_status(self, buffer: str) -> TerminalStatus:
        return TerminalStatus.UNKNOWN

    def extract_last_message_from_script(self, script_output: str) -> str:
        return ""

    def exit_cli(self) -> str:
        return "/exit"

    def cleanup(self) -> None:
        pass


def _claude() -> ClaudeCodeProvider:
    return ClaudeCodeProvider("term-ctx", "session-ctx", "window-0")


class TestBaseDefault:
    def test_base_returns_none_for_any_input(self) -> None:
        provider = _ConcreteProvider("t", "s", "w")
        assert provider.get_context_usage("Context left until auto-compact: 50%") is None
        assert provider.get_context_usage("") is None

    def test_codex_inherits_none(self) -> None:
        # Codex footer is not calibrated this round — must report no gauge.
        provider = CodexProvider("t", "s", "w")
        assert provider.get_context_usage("model · 40% left · ~/proj") is None


class TestClaudeContextParsing:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Context left until auto-compact: 23%", 23),
            ("Context left until auto-compact: 100%", 100),
            ("context left until auto-compact: 7%", 7),
            ("42% until auto-compact", 42),
            ("42% left until auto-compact", 42),
            ("Context low · 8% remaining", 8),
            ("Context low (8%)", 8),
            ("Context low, only 3% remaining before compaction", 3),
        ],
    )
    def test_known_footer_variants(self, text: str, expected: int) -> None:
        assert _claude().get_context_usage(text) == expected

    def test_no_footer_returns_none(self) -> None:
        idle = "\n".join(["────────", "❯ ", "────────"])
        assert _claude().get_context_usage(idle) is None

    def test_empty_returns_none(self) -> None:
        assert _claude().get_context_usage("") is None

    def test_ansi_wrapped_footer_parses(self) -> None:
        # Live buffer interleaves SGR colour codes with the footer text.
        raw = "Context left until auto-compact: \x1b[2m42\x1b[0m%"
        assert _claude().get_context_usage(raw) == 42

    def test_freshest_match_wins(self) -> None:
        # An older footer redraw (80%) precedes the freshest one (12%).
        raw = "Context left until auto-compact: 80%\n" "... work ...\n" "12% until auto-compact\n"
        assert _claude().get_context_usage(raw) == 12

    def test_out_of_range_is_clamped_to_none(self) -> None:
        # A 3-digit match above 100 is rejected (no fabricated value).
        assert _claude().get_context_usage("Context left until auto-compact: 200%") is None
