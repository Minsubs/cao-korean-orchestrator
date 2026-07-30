"""Claude Code's native agent format writes list fields as one comma-separated line.

Observed live: assigning work to the discovered `documentation-writer` agent failed
before the worker ever launched —

    Assignment failed: 1 validation error for AgentProfile
    tools
      Input should be a valid list [type=list_type, input_value='Read, Grep, Glob', input_type=str]

That is not a malformed profile. `tools: Read, Grep, Glob` is exactly how Claude
Code writes its own agents, so *every* agent discovered under `~/.claude/agents/`
was undelegatable. These tests pin the coercion so the whole class stays fixed.
"""

import pytest

from cli_agent_orchestrator.models.agent_profile import AgentProfile


def _profile(**overrides):
    return AgentProfile(name="documentation-writer", description="docs", **overrides)


def test_tools_accepts_the_claude_code_comma_separated_form():
    profile = _profile(tools="Read, Grep, Glob")
    assert profile.tools == ["Read", "Grep", "Glob"]


def test_tools_still_accepts_a_real_list():
    profile = _profile(tools=["Read", "Bash"])
    assert profile.tools == ["Read", "Bash"]


def test_unset_tools_stays_none():
    # None means "not declared" and must not become an empty allow-list, which
    # would read as "no tools permitted".
    assert _profile().tools is None


def test_irregular_spacing_and_trailing_separators_are_tolerated():
    profile = _profile(tools="Read ,Grep,  Glob ,")
    assert profile.tools == ["Read", "Grep", "Glob"]


def test_an_empty_string_becomes_an_empty_list_not_none():
    # The author wrote the key. For a scope list, "present but empty" means
    # nothing is allowed — a different statement from leaving it unset.
    assert _profile(tools="").tools == []
    assert _profile(tools="   ").tools == []


@pytest.mark.parametrize("field", ["allowedTools", "resources", "skills"])
def test_the_same_coercion_applies_to_the_other_list_fields(field):
    # Same one-line habit shows up in these keys; a profile that launches but
    # silently loses its allowedTools scope would be worse than one that fails.
    profile = _profile(**{field: "alpha, beta"})
    assert getattr(profile, field) == ["alpha", "beta"]


def test_a_native_claude_agent_front_matter_shape_validates_end_to_end():
    # The exact shape read off ~/.claude/agents/code-reviewer.md.
    profile = AgentProfile(
        name="code-reviewer",
        description="코드 리뷰 / 변경 진단 전용",
        tools="Read, Grep, Glob, Bash",
        model="sonnet",
    )
    assert profile.tools == ["Read", "Grep", "Glob", "Bash"]
    assert profile.model == "sonnet"
