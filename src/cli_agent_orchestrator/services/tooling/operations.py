"""In-memory manager for asynchronous install/remove/update operations.

An :class:`Operation` is the durable-for-the-process record of one write action:
its lifecycle status, timing, exit code, verification outcome, and a bounded,
already-masked log. The :class:`OperationManager` runs the actual work as
``asyncio`` tasks under two constraints:

* a **global concurrency cap of 2** (a semaphore), so a burst of requests never
  spawns an unbounded number of child processes; and
* **per-provider serialization** (a lock per provider), so two operations
  against the same provider never race each other's state.

The work coroutine drives the run through the lifecycle
``queued -> running -> verifying -> (succeeded | failed)``; a caller-initiated
cancel yields ``cancelled``. On *any* terminal outcome the tooling caches are
invalidated so the next read reflects reality.

**State is in-memory only.** Operations live in a ring of the most recent
:data:`MAX_OPERATIONS`; a server restart discards all history. This is an
intentional Phase 4a simplification — operations are short-lived and the record
is a convenience for the polling UI, not a system of record.
"""

from __future__ import annotations

import asyncio
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from cli_agent_orchestrator.services.tooling import cache
from cli_agent_orchestrator.services.tooling.secret_mask import mask

# Lifecycle statuses.
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_VERIFYING = "verifying"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_PARTIALLY_SUCCEEDED = "partially_succeeded"

# Statuses past which an operation no longer changes.
_TERMINAL = frozenset(
    {STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED, STATUS_PARTIALLY_SUCCEEDED}
)

# Valid actions an operation may carry.
VALID_ACTIONS = frozenset({"install", "remove", "update", "update_all"})

# Global cap on concurrently running operations.
MAX_CONCURRENCY = 2

# Most recent operations retained in memory.
MAX_OPERATIONS = 100

# Per-operation log line cap (already-masked lines only).
LOG_LINE_CAP = 500

# The work coroutine an operation runs: it drives the command + verification and
# sets the operation's terminal status.
Work = Callable[["Operation"], Awaitable[None]]


def _now() -> str:
    """ISO-8601 UTC timestamp for operation bookkeeping."""
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Operation:
    """The mutable record of one write operation."""

    id: str
    action: str
    provider: str
    target: Optional[str]
    scope: Optional[str]
    created_at: str
    status: str = STATUS_QUEUED
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    exit_code: Optional[int] = None
    error: Optional[str] = None
    log: List[str] = field(default_factory=list)
    verified: Optional[bool] = None

    def append_log(self, line: str) -> None:
        """Append a masked log line, keeping only the last :data:`LOG_LINE_CAP`.

        Masking is applied here too (not only in the runner) so the operation
        store is the enforcing boundary: whatever the source, only redacted text
        is ever retained.
        """
        self.log.append(mask(line))
        if len(self.log) > LOG_LINE_CAP:
            # Drop the oldest overflow so memory stays bounded on a chatty run.
            del self.log[: len(self.log) - LOG_LINE_CAP]

    def to_dict(self, *, include_log: bool = False) -> Dict[str, Any]:
        """Serialize for the API. ``include_log`` attaches the full masked log."""
        data: Dict[str, Any] = {
            "id": self.id,
            "action": self.action,
            "provider": self.provider,
            "target": self.target,
            "scope": self.scope,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "exit_code": self.exit_code,
            "error": self.error,
            "verified": self.verified,
            "log_lines": len(self.log),
        }
        if include_log:
            data["log"] = list(self.log)
        return data


def new_operation(
    *,
    action: str,
    provider: str,
    target: Optional[str] = None,
    scope: Optional[str] = None,
) -> Operation:
    """Build a fresh queued :class:`Operation` with an 8-hex id."""
    return Operation(
        id=secrets.token_hex(4),
        action=action,
        provider=provider,
        target=target,
        scope=scope,
        created_at=_now(),
    )


class OperationManager:
    """Runs operations under a global concurrency cap + per-provider serialization."""

    def __init__(self, max_concurrency: int = MAX_CONCURRENCY) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._provider_locks: Dict[str, asyncio.Lock] = {}
        self._operations: "OrderedDict[str, Operation]" = OrderedDict()
        self._tasks: Dict[str, "asyncio.Task[None]"] = {}

    def _provider_lock(self, provider: str) -> asyncio.Lock:
        lock = self._provider_locks.get(provider)
        if lock is None:
            lock = asyncio.Lock()
            self._provider_locks[provider] = lock
        return lock

    def submit(self, op: Operation, work: Work) -> str:
        """Register ``op`` and schedule ``work``; return the operation id.

        Must be called from within a running event loop (it creates an
        ``asyncio`` task). The operation is retained immediately (status
        ``queued``) so it is observable before its task is scheduled.
        """
        self._operations[op.id] = op
        while len(self._operations) > MAX_OPERATIONS:
            evicted_id, _ = self._operations.popitem(last=False)
            self._tasks.pop(evicted_id, None)
        task = asyncio.create_task(self._run(op, work))
        self._tasks[op.id] = task
        return op.id

    async def _run(self, op: Operation, work: Work) -> None:
        """Drive one operation through its lifecycle, then invalidate caches."""
        try:
            # Acquire the provider lock BEFORE a concurrency slot so a second
            # op for the same provider waits without holding a slot (keeps
            # different-provider ops parallel). Consistent acquire order across
            # all tasks makes this deadlock-free.
            async with self._provider_lock(op.provider):
                async with self._semaphore:
                    op.started_at = _now()
                    op.status = STATUS_RUNNING
                    try:
                        await work(op)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # noqa: BLE001 - any work failure -> failed op
                        if op.status not in _TERMINAL:
                            op.status = STATUS_FAILED
                            op.error = op.error or str(exc)
        except asyncio.CancelledError:
            op.status = STATUS_CANCELLED
            raise
        finally:
            if op.finished_at is None:
                op.finished_at = _now()
            if op.status not in _TERMINAL:
                # Work returned without settling a terminal status (defensive).
                op.status = STATUS_FAILED
                op.error = op.error or "operation did not reach a terminal state"
            # Completion of any kind invalidates the read caches so the next
            # poll reflects the mutated environment.
            cache.invalidate()

    def cancel(self, op_id: str) -> bool:
        """Request cancellation of ``op_id``.

        Returns ``True`` if a cancel was initiated, ``False`` if the operation
        is unknown or already finished (the caller maps that to HTTP 409).
        """
        op = self._operations.get(op_id)
        if op is None or op.status in _TERMINAL:
            return False
        task = self._tasks.get(op_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    def get(self, op_id: str) -> Optional[Operation]:
        """Return the operation with ``op_id``, or ``None``."""
        return self._operations.get(op_id)

    def list(self) -> List[Operation]:
        """Return retained operations, newest first."""
        return list(reversed(self._operations.values()))


_MANAGER = OperationManager()


def get_manager() -> OperationManager:
    """Return the process-wide operation manager."""
    return _MANAGER
