"""Tiny argv-only subprocess runner for read-only capability probes.

Deliberately minimal and safe by construction:

* **argv array only** — the command is passed as a list and ``shell`` is
  disabled, so nothing is ever interpreted by a shell. No string command,
  ever.
* **bounded time** — every call carries a timeout; a hung binary yields a
  ``timed_out`` result rather than blocking the request.
* **bounded output** — captured stdout/stderr are truncated to
  :data:`PROBE_OUTPUT_LIMIT` so a chatty binary cannot exhaust memory.

This runner never installs, downloads, or mutates anything — callers use it
purely to read a binary's ``--version`` banner.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Any

# Cap captured stdout/stderr at 64 KiB each. A version banner is a few bytes;
# this only guards against a misbehaving binary flooding the pipe.
PROBE_OUTPUT_LIMIT = 64 * 1024


@dataclass(frozen=True)
class ProbeResult:
    """Outcome of a single probe.

    Carries the essential ``(returncode, stdout, stderr)`` trio plus an explicit
    ``timed_out`` flag so callers can distinguish a timeout from a clean
    non-zero exit. ``returncode`` is ``None`` when the process never produced an
    exit status (timeout, or the binary could not be executed at all).
    """

    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool


def _coerce(data: Any) -> str:
    """Normalize captured output (str/bytes/None) to a string."""
    if data is None:
        return ""
    if isinstance(data, bytes):
        return data.decode("utf-8", "replace")
    return str(data)


def _truncate(text: str) -> str:
    """Clamp captured output to :data:`PROBE_OUTPUT_LIMIT`."""
    if len(text) <= PROBE_OUTPUT_LIMIT:
        return text
    return text[:PROBE_OUTPUT_LIMIT]


def run(argv: list[str], timeout: float) -> ProbeResult:
    """Run ``argv`` with ``shell`` disabled and bounded time/output.

    Args:
        argv: The command as an argument vector, e.g. ``["claude", "--version"]``.
            Must be non-empty.
        timeout: Wall-clock timeout in seconds.

    Returns:
        A :class:`ProbeResult`. A timeout yields ``timed_out=True`` and
        ``returncode=None``; a binary that cannot be executed yields
        ``returncode=None`` with the OS error text in ``stderr``.

    Raises:
        ValueError: If ``argv`` is empty.
    """
    if not argv:
        raise ValueError("probe.run requires a non-empty argv list")

    try:
        completed = subprocess.run(  # noqa: S603 - argv list, shell disabled, read-only probe
            argv,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            shell=False,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return ProbeResult(
            returncode=None,
            stdout=_truncate(_coerce(exc.stdout)),
            stderr=_truncate(_coerce(exc.stderr)),
            timed_out=True,
        )
    except OSError as exc:
        # Binary vanished between which() and run(), permission denied, etc.
        return ProbeResult(returncode=None, stdout="", stderr=str(exc), timed_out=False)

    return ProbeResult(
        returncode=completed.returncode,
        stdout=_truncate(completed.stdout),
        stderr=_truncate(completed.stderr),
        timed_out=False,
    )
