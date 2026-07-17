"""Safe-by-construction async command runner for the write path.

Unlike :mod:`probe` (read-only ``--version`` banners), this runner executes the
install/remove/update commands an adapter plans. Because it runs *mutating*
commands, it is hardened well beyond the probe:

* **argv array only, ``shell=False``** — the command is a list; nothing is ever
  handed to a shell, so no metacharacter can be interpreted.
* **allowlisted binary** — ``argv[0]``'s basename must be in
  :data:`ALLOWED_BINARIES`. A renderer cannot ask the runner to execute an
  arbitrary program.
* **token validation** — every argv token must match :data:`_TOKEN_RE`, a
  conservative character class that excludes every shell metacharacter. This is
  defense-in-depth on top of ``shell=False``: even a future code path that
  forgets to disable the shell cannot smuggle ``;``/``|``/``$()``/backticks.
* **constructed env** — the child receives ONLY the keys in
  :data:`_ENV_ALLOWLIST`, never the API process's full environment, so no secret
  in the server env can leak into a spawned CLI.
* **cwd fenced to $HOME** — a supplied working directory must ``realpath`` to a
  location inside the user's home.
* **bounded time + output** — a timeout kills the child; captured output is
  capped at :data:`RUNNER_OUTPUT_LIMIT` (combined) and every line is run through
  :func:`secret_mask.mask` before it is surfaced.
* **cancellable** — ``asyncio.CancelledError`` kills the child, reaps it, and
  re-raises so a caller-initiated cancel cannot orphan a process.
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

from cli_agent_orchestrator.services.tooling.secret_mask import mask

# Only these binaries may ever be executed. ``argv[0]`` is matched by basename,
# so both ``skills`` and ``/usr/local/bin/skills`` are accepted. Phase 5a adds
# the provider CLIs whose adapters drive non-interactive MCP management.
ALLOWED_BINARIES = {"skills", "claude", "codex", "agy"}

# Every argv token must match this. The class is intentionally narrow: letters,
# digits, and the handful of punctuation characters that legitimately appear in
# skill names / versions / flags (``@%+=:,./_-``). It excludes spaces and every
# shell metacharacter (``; | & $ ( ) < > \` " ' * ? ~ ^ { } [ ]``).
_TOKEN_RE = re.compile(r"^[A-Za-z0-9@%+=:,./_-]{1,200}$")

# The ONLY environment keys forwarded to the child. Constructed, never inherited.
_ENV_ALLOWLIST = ("PATH", "HOME", "LANG", "LC_ALL", "TERM")

# Combined stdout+stderr cap for the RunResult text (64 KiB). The live on_line
# stream is not capped here — the operation store bounds its own log ring.
RUNNER_OUTPUT_LIMIT = 64 * 1024

# Marker appended once when captured output is truncated at the cap.
_TRUNCATION_MARKER = "\n[truncated]"

# Default wall-clock ceiling for a single command.
DEFAULT_TIMEOUT = 120

# Line reader buffer ceiling. A single line longer than this is read in bounded
# chunks rather than raising, so an unterminated flood still makes progress.
_STREAM_LIMIT = RUNNER_OUTPUT_LIMIT + 4096


@dataclass(frozen=True)
class RunResult:
    """Outcome of a single command run.

    ``returncode`` is ``None`` when the process produced no exit status (it was
    killed on timeout/cancel, or could not be spawned at all). ``stdout`` and
    ``stderr`` are already masked and jointly capped at
    :data:`RUNNER_OUTPUT_LIMIT`.
    """

    returncode: Optional[int]
    stdout: str
    stderr: str
    timed_out: bool
    cancelled: bool


class _Accumulator:
    """Masks each line, streams it to ``on_line``, and stores a capped copy.

    The live callback receives every masked line (the operation store applies
    its own 500-line bound). The stored ``stdout``/``stderr`` text is jointly
    capped at :data:`RUNNER_OUTPUT_LIMIT`; overflow is dropped and a single
    ``[truncated]`` marker is appended.
    """

    def __init__(self, cap: int, on_line: Optional[Callable[[str], None]]) -> None:
        self._cap = cap
        self._on_line = on_line
        self._out: List[str] = []
        self._err: List[str] = []
        self._stored = 0
        self._truncated = False

    def add(self, stream: str, line: str) -> None:
        masked = mask(line)
        if self._on_line is not None:
            try:
                self._on_line(masked)
            except Exception:
                # A misbehaving callback must never kill the run or leak an
                # exception into the pump task.
                pass
        self._store(stream, masked)

    def _store(self, stream: str, masked: str) -> None:
        remaining = self._cap - self._stored
        if remaining <= 0:
            self._mark_truncated()
            return
        chunk = masked[:remaining]
        self._stored += len(chunk)
        (self._out if stream == "stdout" else self._err).append(chunk)
        if len(chunk) < len(masked):
            self._mark_truncated()

    def _mark_truncated(self) -> None:
        if not self._truncated:
            self._truncated = True
            (self._out if self._out else self._err).append(_TRUNCATION_MARKER)

    @property
    def stdout(self) -> str:
        return "".join(self._out)

    @property
    def stderr(self) -> str:
        return "".join(self._err)


def is_valid_token(token: str) -> bool:
    """Return whether ``token`` is a single safe argv token (matches :data:`_TOKEN_RE`).

    Exposed so callers that compose an argv from user-influenced fragments (e.g.
    a catalog install with a user-supplied path) can reject an unsafe token up
    front with a clean error, instead of only discovering it when :func:`run`
    re-validates the assembled command.
    """
    return isinstance(token, str) and _TOKEN_RE.match(token) is not None


def resolve_within_home(path: str) -> str:
    """Return ``path`` resolved to a realpath inside $HOME (raises ValueError).

    The single home-confinement check reused by the runner's ``cwd`` gate and by
    the catalog path parameter, so a supplied filesystem path can never escape
    the user's home directory (``..`` traversal and symlinks are resolved before
    the containment test).
    """
    home = os.path.realpath(os.path.expanduser("~"))
    target = os.path.realpath(os.path.expanduser(path))
    if target != home and not target.startswith(home + os.sep):
        raise ValueError(f"path {path!r} resolves outside the home directory")
    return target


def _validate_argv(argv: List[str]) -> None:
    """Reject anything that is not a safe, allowlisted argv (raises ValueError)."""
    if not argv:
        raise ValueError("runner.run requires a non-empty argv list")
    binary = os.path.basename(argv[0])
    if binary not in ALLOWED_BINARIES:
        raise ValueError(
            f"binary {binary!r} is not allowlisted (allowed: {sorted(ALLOWED_BINARIES)})"
        )
    for token in argv:
        if not is_valid_token(token):
            raise ValueError(f"argv token {token!r} contains disallowed characters")


def _validate_cwd(cwd: Optional[str]) -> Optional[str]:
    """Resolve ``cwd`` and require it to live inside $HOME (raises ValueError)."""
    if cwd is None:
        return None
    return resolve_within_home(cwd)


def _build_env() -> Dict[str, str]:
    """Construct the child environment from the allowlist only."""
    env: Dict[str, str] = {}
    for key in _ENV_ALLOWLIST:
        value = os.environ.get(key)
        if value is not None:
            env[key] = value
    return env


async def _pump(stream: Optional[asyncio.StreamReader], name: str, acc: _Accumulator) -> None:
    """Drain one pipe line-by-line into ``acc`` for the life of the process.

    Both pipes are drained by concurrent tasks so a full OS pipe buffer cannot
    deadlock the exit await. A line longer than the stream buffer limit is read
    as a bounded chunk instead of raising.
    """
    if stream is None:
        return
    while True:
        try:
            raw = await stream.readline()
        except (asyncio.LimitOverrunError, ValueError):
            raw = await stream.read(_STREAM_LIMIT)
        if not raw:
            return
        acc.add(name, raw.decode("utf-8", "replace").rstrip("\n"))


async def _kill_and_reap(proc: "asyncio.subprocess.Process") -> None:
    """Kill the child (if alive) and reap it so it does not linger as a zombie."""
    try:
        proc.kill()
    except ProcessLookupError:
        pass
    try:
        await proc.wait()
    except Exception:
        pass


async def run(
    argv: List[str],
    *,
    cwd: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    on_line: Optional[Callable[[str], None]] = None,
) -> RunResult:
    """Execute ``argv`` safely and return a :class:`RunResult`.

    Args:
        argv: The command as an argument vector. ``argv[0]``'s basename must be
            in :data:`ALLOWED_BINARIES` and every token must match
            :data:`_TOKEN_RE`.
        cwd: Optional working directory; must resolve inside $HOME when given.
        timeout: Wall-clock ceiling in seconds. On expiry the child is killed
            and ``timed_out=True`` is returned.
        on_line: Optional callback invoked with each masked output line as it is
            read (live streaming). Exceptions from it are swallowed.

    Returns:
        A :class:`RunResult` with masked, capped output.

    Raises:
        ValueError: If ``argv`` or ``cwd`` fails validation.
        asyncio.CancelledError: Re-raised after the child is killed and reaped.
    """
    _validate_argv(argv)
    resolved_cwd = _validate_cwd(cwd)
    env = _build_env()
    acc = _Accumulator(RUNNER_OUTPUT_LIMIT, on_line)

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=resolved_cwd,
            env=env,
            limit=_STREAM_LIMIT,
        )
    except OSError as exc:
        # The OS refused to spawn (binary vanished, permission denied, bad cwd).
        # This is a run failure, not a programmer error, so it is reported in the
        # result rather than raised.
        return RunResult(
            returncode=None, stdout="", stderr=str(exc), timed_out=False, cancelled=False
        )

    drain = [
        asyncio.create_task(_pump(proc.stdout, "stdout", acc)),
        asyncio.create_task(_pump(proc.stderr, "stderr", acc)),
    ]

    try:
        await asyncio.wait_for(asyncio.gather(*drain), timeout=timeout)
        returncode = await proc.wait()
        return RunResult(
            returncode=returncode,
            stdout=acc.stdout,
            stderr=acc.stderr,
            timed_out=False,
            cancelled=False,
        )
    except asyncio.TimeoutError:
        for task in drain:
            task.cancel()
        await asyncio.gather(*drain, return_exceptions=True)
        await _kill_and_reap(proc)
        return RunResult(
            returncode=None,
            stdout=acc.stdout,
            stderr=acc.stderr,
            timed_out=True,
            cancelled=False,
        )
    except asyncio.CancelledError:
        for task in drain:
            task.cancel()
        await asyncio.gather(*drain, return_exceptions=True)
        await _kill_and_reap(proc)
        raise
