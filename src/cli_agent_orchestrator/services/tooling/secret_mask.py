"""Best-effort secret redaction for command output before it is stored/streamed.

The write-path runner streams a child process's stdout/stderr into an operation
log that the UI polls. That output can incidentally contain credentials (a CLI
that echoes an ``Authorization`` header, a token pasted into an error message,
an AWS key in a stack trace). :func:`mask` scrubs the well-known credential
shapes so no secret material is ever persisted in an operation log or pushed to
a client.

Design constraints:

* **Safe regardless of length** — every pattern masks the *entire* secret body
  with a single ``***`` (never "first N chars"), so a long token cannot leak a
  tail. All patterns are linear (no nested quantifiers over overlapping
  classes), so there is no catastrophic-backtracking exposure on hostile input.
* **Idempotent** — ``mask(mask(x)) == mask(x)`` for every pattern here; the
  ``***`` marker contains no character any pattern will re-match. This lets the
  runner and the operation store both apply it without compounding artifacts.
* **Prefix-preserving** — a recognizable, non-sensitive scheme prefix
  (``sk-``, ``ghp_``, ``Bearer ``, the ``token=`` key) is kept so redacted logs
  stay debuggable; only the secret body becomes ``***``.

This is defense-in-depth, not a guarantee: it targets common shapes, not every
conceivable secret encoding.
"""

from __future__ import annotations

import re
from typing import List, Pattern, Tuple

# Each entry is ``(compiled_pattern, replacement)``. ``replacement`` uses
# backreferences (``\1``) to preserve a captured, non-sensitive scheme prefix.
#
# Order matters: the generic ``key=value`` rule runs FIRST so a value like
# ``Authorization: Bearer <tok>`` is absorbed whole (the scheme word plus the
# token) rather than the generic rule stopping at the first whitespace and
# leaving the token exposed. The standalone ``Bearer`` and branded-token rules
# then mop up any secret that was not preceded by a recognized key.
_RULES: List[Tuple[Pattern[str], str]] = [
    # (api[_-]?key|token|secret|password|authorization) <delim> <value>
    # Delimiter is ``=``/``:`` (with optional surrounding whitespace) or bare
    # whitespace. An optional ``Bearer``/``Token`` scheme word is consumed as
    # part of the value so the credential after it is what gets masked.
    (
        re.compile(
            r"\b(api[_-]?key|token|secret|password|authorization)\b"
            r"(\s*[=:]\s*|\s+)"
            r"(?:bearer\s+|token\s+)?"
            r"\S+",
            re.IGNORECASE,
        ),
        r"\1\2***",
    ),
    # Standalone ``Bearer <token>`` not already handled above.
    (re.compile(r"\b(bearer)\s+\S+", re.IGNORECASE), r"\1 ***"),
    # GitHub fine-grained PAT (checked before ``ghp_`` — different prefix, but
    # keep the more specific literal first for clarity).
    (re.compile(r"\b(github_pat_)[A-Za-z0-9_]+", re.IGNORECASE), r"\1***"),
    # GitHub classic tokens: ghp_, gho_, ghu_, ghs_, ghr_.
    (re.compile(r"\b(gh[porus]_)[A-Za-z0-9]+", re.IGNORECASE), r"\1***"),
    # OpenAI-style keys: sk-, sk-proj-, etc.
    (re.compile(r"\b(sk-)[A-Za-z0-9_-]+", re.IGNORECASE), r"\1***"),
    # Slack tokens: xoxb-, xoxa-, xoxp-, xoxr-, xoxs-.
    (re.compile(r"\b(xox[baprs]-)[A-Za-z0-9-]+", re.IGNORECASE), r"\1***"),
    # AWS access key id: AKIA + 16 uppercase alnum.
    (re.compile(r"\b(AKIA)[0-9A-Z]{16}\b"), r"\1***"),
]


def mask(text: str) -> str:
    """Return ``text`` with well-known credential shapes redacted to ``***``.

    Applies every rule in order. Because each replacement emits only the inert
    ``***`` marker (plus a non-sensitive scheme prefix), applying the rules in
    sequence never re-exposes a secret and is safe to run repeatedly.

    Args:
        text: Arbitrary output text. Non-``str`` input is coerced with ``str``.

    Returns:
        The redacted text. An empty or secret-free string is returned unchanged.
    """
    if not isinstance(text, str):
        text = str(text)
    if not text:
        return text
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text
