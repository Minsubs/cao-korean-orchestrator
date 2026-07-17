"""Unit tests for the safe async command runner (all subprocess I/O mocked)."""

import asyncio
import os

import pytest

from cli_agent_orchestrator.services.tooling import runner

# --- fakes ----------------------------------------------------------------


class FakeStream:
    """Async stream yielding pre-seeded byte lines, then EOF."""

    def __init__(self, lines):
        self._lines = list(lines)

    async def readline(self):
        if self._lines:
            return self._lines.pop(0)
        return b""

    async def read(self, _n):
        data = b"".join(self._lines)
        self._lines = []
        return data


class HangingStream:
    """Async stream whose readline never returns (to force a timeout/cancel)."""

    async def readline(self):
        await asyncio.sleep(3600)
        return b""  # pragma: no cover

    async def read(self, _n):
        await asyncio.sleep(3600)
        return b""  # pragma: no cover


class FakeProcess:
    def __init__(self, stdout_lines=(), stderr_lines=(), returncode=0, hang=False):
        self.stdout = HangingStream() if hang else FakeStream(stdout_lines)
        self.stderr = FakeStream(stderr_lines)
        self._returncode = returncode
        self.killed = False

    async def wait(self):
        return self._returncode

    def kill(self):
        self.killed = True

    @property
    def returncode(self):
        return self._returncode


def _patch_spawn(monkeypatch, proc, capture=None):
    async def fake_exec(*argv, **kwargs):
        if capture is not None:
            capture["argv"] = argv
            capture["kwargs"] = kwargs
        return proc

    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)


# --- validation -----------------------------------------------------------


@pytest.mark.asyncio
async def test_rejects_empty_argv():
    with pytest.raises(ValueError):
        await runner.run([])


@pytest.mark.asyncio
async def test_rejects_non_allowlisted_binary():
    with pytest.raises(ValueError):
        await runner.run(["rm", "-rf", "/"])


@pytest.mark.asyncio
async def test_allows_allowlisted_binary_by_basename(monkeypatch):
    proc = FakeProcess(stdout_lines=[b"ok\n"])
    _patch_spawn(monkeypatch, proc)
    result = await runner.run(["/usr/local/bin/skills", "list"])
    assert result.returncode == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_token",
    ["skills; rm -rf /", "skills && x", "skills`whoami`", "skills$(id)", "skills|cat", "a b"],
)
async def test_rejects_shell_metacharacter_tokens(bad_token):
    with pytest.raises(ValueError):
        await runner.run(["skills", bad_token])


@pytest.mark.asyncio
async def test_rejects_cwd_outside_home(monkeypatch):
    proc = FakeProcess()
    _patch_spawn(monkeypatch, proc)
    with pytest.raises(ValueError):
        await runner.run(["skills", "list"], cwd="/usr")


@pytest.mark.asyncio
async def test_accepts_cwd_inside_home(monkeypatch):
    capture = {}
    proc = FakeProcess(stdout_lines=[b"ok\n"])
    _patch_spawn(monkeypatch, proc, capture)
    home = os.path.expanduser("~")
    result = await runner.run(["skills", "list"], cwd=home)
    assert result.returncode == 0
    assert capture["kwargs"]["cwd"] == os.path.realpath(home)


# --- env allowlist --------------------------------------------------------


@pytest.mark.asyncio
async def test_env_is_allowlisted_only(monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin")
    monkeypatch.setenv("HOME", "/Users/tester")
    monkeypatch.setenv("SECRET_TOKEN", "should-not-pass")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "nope")
    capture = {}
    _patch_spawn(monkeypatch, FakeProcess(stdout_lines=[b"x\n"]), capture)

    await runner.run(["skills", "list"])

    env = capture["kwargs"]["env"]
    assert set(env).issubset(set(runner._ENV_ALLOWLIST))
    assert "SECRET_TOKEN" not in env
    assert "AWS_SECRET_ACCESS_KEY" not in env
    assert env["PATH"] == "/usr/bin"


@pytest.mark.asyncio
async def test_spawn_uses_argv_list_and_no_shell(monkeypatch):
    capture = {}
    _patch_spawn(monkeypatch, FakeProcess(stdout_lines=[b"x\n"]), capture)
    await runner.run(["skills", "add", "some-skill"])
    assert capture["argv"] == ("skills", "add", "some-skill")
    # create_subprocess_exec never takes a shell; assert we did not pass one.
    assert "shell" not in capture["kwargs"]


# --- output handling ------------------------------------------------------


@pytest.mark.asyncio
async def test_captures_and_streams_masked_lines(monkeypatch):
    proc = FakeProcess(
        stdout_lines=[b"installing\n", b"token=SECRETVALUE\n"], stderr_lines=[b"warn\n"]
    )
    _patch_spawn(monkeypatch, proc)
    seen = []
    result = await runner.run(["skills", "add", "x"], on_line=seen.append)

    assert result.returncode == 0
    assert "installing" in result.stdout
    assert "token=***" in result.stdout
    assert "SECRETVALUE" not in result.stdout  # masked in stored output
    assert "warn" in result.stderr
    # Every line streamed to on_line, already masked.
    assert "token=***" in seen
    assert all("SECRETVALUE" not in line for line in seen)


@pytest.mark.asyncio
async def test_output_capped_and_marked(monkeypatch):
    big_lines = [b"x" * 1000 + b"\n" for _ in range(100)]  # ~100 KiB
    proc = FakeProcess(stdout_lines=big_lines)
    _patch_spawn(monkeypatch, proc)
    result = await runner.run(["skills", "list"])
    assert len(result.stdout) <= runner.RUNNER_OUTPUT_LIMIT + len(runner._TRUNCATION_MARKER)
    assert "[truncated]" in result.stdout


@pytest.mark.asyncio
async def test_on_line_exception_does_not_break_run(monkeypatch):
    proc = FakeProcess(stdout_lines=[b"a\n", b"b\n"])
    _patch_spawn(monkeypatch, proc)

    def boom(_line):
        raise RuntimeError("callback blew up")

    result = await runner.run(["skills", "list"], on_line=boom)
    assert result.returncode == 0
    assert "a" in result.stdout and "b" in result.stdout


@pytest.mark.asyncio
async def test_spawn_oserror_maps_to_failed_result(monkeypatch):
    async def fake_exec(*argv, **kwargs):
        raise FileNotFoundError("skills not found")

    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)
    result = await runner.run(["skills", "list"])
    assert result.returncode is None
    assert result.timed_out is False
    assert "skills not found" in result.stderr


# --- timeout & cancel -----------------------------------------------------


@pytest.mark.asyncio
async def test_timeout_kills_and_flags(monkeypatch):
    proc = FakeProcess(hang=True)
    _patch_spawn(monkeypatch, proc)
    result = await runner.run(["skills", "list"], timeout=0.05)
    assert result.timed_out is True
    assert result.returncode is None
    assert proc.killed is True


@pytest.mark.asyncio
async def test_cancel_kills_and_reraises(monkeypatch):
    proc = FakeProcess(hang=True)
    _patch_spawn(monkeypatch, proc)
    task = asyncio.ensure_future(runner.run(["skills", "list"], timeout=30))
    await asyncio.sleep(0.05)  # let it reach the drain/await
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert proc.killed is True
