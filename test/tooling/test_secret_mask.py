"""Unit tests for credential redaction (secret_mask.mask)."""

import pytest

from cli_agent_orchestrator.services.tooling.secret_mask import mask


@pytest.mark.parametrize(
    "secret",
    [
        "sk-abcDEF0123456789",
        "sk-proj-abcDEF0123_456-789",
        "ghp_ABCdef0123456789ghi",
        "gho_ABCdef0123456789ghi",
        "github_pat_11ABCDEF0_abcdefghijklmnop",
        "xoxb-123456789012-abcdefghijkl",
        "xoxp-1-2-3-abcdef",
        "AKIAIOSFODNN7EXAMPLE",
    ],
)
def test_branded_tokens_are_redacted(secret):
    """Each branded token shape is masked and its body never survives."""
    out = mask(f"leaked here: {secret} done")
    assert "***" in out
    # The random/secret body must be gone. Compare on the part after the scheme.
    assert secret not in out


@pytest.mark.parametrize(
    "line,expected",
    [
        ("token=supersecretvalue", "token=***"),
        ("api_key=abc123", "api_key=***"),
        ("api-key: abc123", "api-key: ***"),
        ("apikey=abc123", "apikey=***"),
        ("password: hunter2", "password: ***"),
        ("secret=topsecret", "secret=***"),
        ("Authorization: Bearer abc.def.ghi", "Authorization: ***"),
    ],
)
def test_key_value_pairs_are_redacted(line, expected):
    assert mask(line) == expected


def test_standalone_bearer_is_redacted():
    out = mask("curl -H 'Bearer zzzTOKENzzz'")
    # The token (and any trailing punctuation it absorbs) is gone; safe to over-mask.
    assert "zzzTOKENzzz" not in out
    assert out.startswith("curl -H 'Bearer ***")


def test_case_insensitive():
    """Keyword and scheme matching ignores case; original case is preserved."""
    assert mask("TOKEN=SECRET") == "TOKEN=***"
    assert mask("BEARER deadbeef") == "BEARER ***"


def test_authorization_bearer_leaves_no_tail():
    """The token after 'Bearer' must not survive even with the authorization key."""
    tok = "eyJhbGciOiJun1queSecre7Value"
    out = mask(f"Authorization: Bearer {tok}")
    assert tok not in out
    assert out == "Authorization: ***"


def test_length_independent_no_tail_leak():
    """A very long token is fully masked (no first-N-chars behavior)."""
    body = "A" * 5000 + "TAILMARKER"
    out = mask(f"sk-{body}")
    assert "TAILMARKER" not in out
    assert out == "sk-***"


def test_idempotent():
    """mask(mask(x)) == mask(x) for representative inputs."""
    for text in [
        "token=abc Authorization: Bearer sk-xyz",
        "ghp_abcdef0123 and AKIAIOSFODNN7EXAMPLE",
        "nothing sensitive here",
    ]:
        once = mask(text)
        assert mask(once) == once


def test_non_secret_text_unchanged():
    assert mask("building skill foo-bar version 1.2.3") == "building skill foo-bar version 1.2.3"


def test_multiple_secrets_in_one_line():
    out = mask("token=aaa and ghp_bbbbbbbbbbbb and sk-cccccccccc")
    assert "aaa" not in out
    assert "bbbbbbbbbbbb" not in out
    assert "cccccccccc" not in out
    assert out.count("***") == 3


def test_empty_and_non_str():
    assert mask("") == ""
    assert mask(123) == "123"  # coerced, not a crash


def test_akia_requires_exact_shape():
    """AKIA must be followed by 16 uppercase alnum; a short lookalike is left alone."""
    assert mask("AKIASHORT") == "AKIASHORT"
