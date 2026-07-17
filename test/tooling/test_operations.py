"""Unit tests for the async OperationManager and Operation record."""

import asyncio

import pytest

from cli_agent_orchestrator.services.tooling import operations

# --- Operation record -----------------------------------------------------


def test_log_is_capped_and_masked():
    op = operations.new_operation(action="install", provider="p", target="x")
    for i in range(operations.LOG_LINE_CAP + 100):
        op.append_log(f"line {i} token=SECRET{i}")
    assert len(op.log) == operations.LOG_LINE_CAP
    # Oldest lines dropped; the newest survives.
    assert "line 599" in op.log[-1]
    # Every stored line is masked.
    assert all("SECRET" not in line for line in op.log)
    assert all("token=***" in line for line in op.log)


def test_to_dict_includes_log_only_on_request():
    op = operations.new_operation(action="remove", provider="p", target="x")
    op.append_log("hello")
    assert "log" not in op.to_dict()
    assert op.to_dict()["log_lines"] == 1
    assert op.to_dict(include_log=True)["log"] == ["hello"]


def test_new_operation_has_hex8_id_and_queued():
    op = operations.new_operation(action="update", provider="p", target="x")
    assert len(op.id) == 8
    int(op.id, 16)  # valid hex
    assert op.status == operations.STATUS_QUEUED
    assert op.created_at


# --- lifecycle ------------------------------------------------------------


@pytest.mark.asyncio
async def test_successful_lifecycle():
    mgr = operations.OperationManager()
    seen = []

    async def work(op):
        seen.append(op.status)  # should be "running" by now
        op.status = operations.STATUS_VERIFYING
        op.verified = True
        op.exit_code = 0
        op.status = operations.STATUS_SUCCEEDED

    op = operations.new_operation(action="install", provider="p", target="foo")
    mgr.submit(op, work)
    await mgr._tasks[op.id]

    assert seen == [operations.STATUS_RUNNING]
    assert op.status == operations.STATUS_SUCCEEDED
    assert op.verified is True
    assert op.started_at is not None and op.finished_at is not None


@pytest.mark.asyncio
async def test_verification_failure_marks_failed():
    mgr = operations.OperationManager()

    async def work(op):
        op.status = operations.STATUS_VERIFYING
        op.verified = False
        op.status = operations.STATUS_FAILED
        op.error = "verification failed: absent"

    op = operations.new_operation(action="install", provider="p", target="foo")
    mgr.submit(op, work)
    await mgr._tasks[op.id]

    assert op.status == operations.STATUS_FAILED
    assert op.verified is False
    assert "verification failed" in op.error


@pytest.mark.asyncio
async def test_work_exception_marks_failed():
    mgr = operations.OperationManager()

    async def work(op):
        raise RuntimeError("boom in work")

    op = operations.new_operation(action="install", provider="p", target="foo")
    mgr.submit(op, work)
    await mgr._tasks[op.id]

    assert op.status == operations.STATUS_FAILED
    assert "boom in work" in op.error
    assert op.finished_at is not None


@pytest.mark.asyncio
async def test_work_without_terminal_status_is_defensively_failed():
    mgr = operations.OperationManager()

    async def work(op):
        return  # forgot to set a terminal status

    op = operations.new_operation(action="install", provider="p", target="foo")
    mgr.submit(op, work)
    await mgr._tasks[op.id]

    assert op.status == operations.STATUS_FAILED
    assert "terminal" in op.error


@pytest.mark.asyncio
async def test_cancel_running_operation():
    mgr = operations.OperationManager()
    started = asyncio.Event()
    release = asyncio.Event()

    async def work(op):
        started.set()
        await release.wait()
        op.status = operations.STATUS_SUCCEEDED

    op = operations.new_operation(action="install", provider="p", target="foo")
    mgr.submit(op, work)
    await started.wait()

    assert mgr.cancel(op.id) is True
    with pytest.raises(asyncio.CancelledError):
        await mgr._tasks[op.id]
    assert op.status == operations.STATUS_CANCELLED
    assert op.finished_at is not None
    # A finished operation cannot be cancelled again (409 semantics).
    assert mgr.cancel(op.id) is False


@pytest.mark.asyncio
async def test_cancel_unknown_returns_false():
    mgr = operations.OperationManager()
    assert mgr.cancel("deadbeef") is False


# --- concurrency ----------------------------------------------------------


@pytest.mark.asyncio
async def test_global_concurrency_capped_at_two():
    mgr = operations.OperationManager(max_concurrency=2)
    entered = []
    peak = 0
    active = 0
    release = asyncio.Event()

    async def work(op):
        nonlocal peak, active
        active += 1
        peak = max(peak, active)
        entered.append(op.id)
        await release.wait()
        active -= 1
        op.status = operations.STATUS_SUCCEEDED

    ops = [
        operations.new_operation(action="install", provider=f"p{i}", target="x") for i in range(3)
    ]
    for op in ops:
        mgr.submit(op, work)

    # Wait until the semaphore admits its cap.
    for _ in range(200):
        await asyncio.sleep(0.005)
        if len(entered) >= 2:
            break
    assert peak == 2
    assert len(entered) == 2  # third is blocked by the semaphore

    release.set()
    await asyncio.gather(*mgr._tasks.values())
    assert peak == 2
    assert all(op.status == operations.STATUS_SUCCEEDED for op in ops)


@pytest.mark.asyncio
async def test_same_provider_runs_serially():
    mgr = operations.OperationManager(max_concurrency=2)
    order = []
    release1 = asyncio.Event()

    async def work1(op):
        order.append("1-start")
        await release1.wait()
        order.append("1-end")
        op.status = operations.STATUS_SUCCEEDED

    async def work2(op):
        order.append("2-start")
        op.status = operations.STATUS_SUCCEEDED

    op1 = operations.new_operation(action="install", provider="same", target="a")
    op2 = operations.new_operation(action="install", provider="same", target="b")
    mgr.submit(op1, work1)
    mgr.submit(op2, work2)

    await asyncio.sleep(0.03)
    # op2 must not start while op1 holds the provider lock.
    assert "2-start" not in order
    assert op2.status == operations.STATUS_QUEUED

    release1.set()
    await asyncio.gather(mgr._tasks[op1.id], mgr._tasks[op2.id])
    assert order == ["1-start", "1-end", "2-start"]


# --- retention & caches ---------------------------------------------------


@pytest.mark.asyncio
async def test_ring_keeps_most_recent_operations():
    mgr = operations.OperationManager()

    async def work(op):
        op.status = operations.STATUS_SUCCEEDED

    ops = [
        operations.new_operation(action="install", provider=f"p{i}", target="x")
        for i in range(operations.MAX_OPERATIONS + 5)
    ]
    for op in ops:
        mgr.submit(op, work)

    # Trimming happens synchronously in submit.
    assert len(mgr._operations) == operations.MAX_OPERATIONS
    assert mgr.get(ops[0].id) is None  # oldest evicted
    assert mgr.get(ops[-1].id) is not None  # newest kept
    # list() is newest-first.
    assert mgr.list()[0].id == ops[-1].id

    await asyncio.gather(*mgr._tasks.values(), return_exceptions=True)
    await asyncio.sleep(0.05)  # let orphaned (evicted) tasks settle


@pytest.mark.asyncio
async def test_caches_invalidated_on_completion(monkeypatch):
    calls = []
    monkeypatch.setattr(operations.cache, "invalidate", lambda: calls.append(1))
    mgr = operations.OperationManager()

    async def work(op):
        op.status = operations.STATUS_SUCCEEDED

    op = operations.new_operation(action="install", provider="p", target="x")
    mgr.submit(op, work)
    await mgr._tasks[op.id]
    assert len(calls) >= 1
