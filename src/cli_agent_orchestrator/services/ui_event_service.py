"""In-process ring buffer + drop-on-slow fan-out for the chat-workspace UI stream.

This is an **additive**, self-contained surface for the Phase 2 chat-centric
workspace (``/ui/events`` + ``/ui/events/history``). It is deliberately
independent of the MCP Apps event pipeline (``event_log_service`` /
``sse_bus``): that surface is default-off, six-primitive, and metadata-only,
whereas this one is always-on and preserves the *original* CAO event vocabulary
and detail so the Orchestration Thread can render plan/delegation/status cards
without any terminal string parsing.

Two roles live here:

- ``UiEventLog`` — a bounded (``RING_CAPACITY``) monotonic-id ring buffer that
  also fans each appended event out to live SSE subscribers. Fan-out is
  **drop-on-slow**: a full subscriber queue drops that event for that
  subscriber only (the durable record is the ring, backfilled via
  ``/ui/events/history``), so one stalled browser tab never back-pressures the
  orchestration core. Mirrors the proven ``EventLog`` + ``SseBus`` patterns.
- ``TerminalEventForwarder`` — pure translation of the existing
  ``terminal.{id}.status`` / ``terminal.{id}.output`` bus topics into
  ``status_changed`` / ``activity`` UI events. It tracks the previous status
  per terminal and throttles output ``activity`` to at most one event per
  ``ACTIVITY_THROTTLE_SECONDS`` per terminal. Raw output bytes are **never**
  included — ``activity`` is a bare heartbeat.

Event schema (original vocabulary preserved, never abridged)::

    {"id": int, "ts": <iso8601-utc>, "type": <str>, "detail": {...}}
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Ring-buffer capacity. Appends past the cap evict the oldest event in O(1).
RING_CAPACITY = 1000

# Per-subscriber bounded queue capacity for the live SSE fan-out. A full queue
# drops the event for that subscriber only (drop-on-slow); the ring buffer is
# the durable record clients backfill from.
UI_EVENT_QUEUE_SIZE = 256

# Minimum seconds between ``activity`` heartbeats per terminal. Output arrives in
# a high-frequency stream; the Thread only needs a coarse "this terminal is
# producing output" signal, so we coalesce.
ACTIVITY_THROTTLE_SECONDS = 5.0

# Closed vocabulary of UI event types. ``/ui/events/history`` rejects any
# ``types`` token outside this set with 400 rather than silently matching
# nothing, and Phase 2b consumes exactly these.
UI_EVENT_TYPES: Tuple[str, ...] = (
    "session_created",
    "session_killed",
    "terminal_created",
    "terminal_killed",
    "message_sent",
    "status_changed",
    "activity",
)


def _utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""

    return datetime.now(timezone.utc).isoformat()


class UiEventLog:
    """Bounded monotonic-id ring buffer with drop-on-slow SSE fan-out.

    Thread-safe: ``append`` may be called from plugin lifecycle hooks (which can
    run off the event loop) and from the event-bus consumer task, while
    ``history`` is served from request handlers. A single ``threading.Lock``
    guards the buffer, the id counter, and the subscriber list. Live delivery
    happens off the loop each subscriber's queue was created on, via
    ``call_soon_threadsafe`` (``asyncio.Queue`` is not thread-safe).
    """

    def __init__(self) -> None:
        """Create an empty ring buffer with no subscribers."""

        self._buf: Deque[Dict[str, Any]] = deque(maxlen=RING_CAPACITY)
        self._next_id: int = 1
        self._subs: List[Tuple["asyncio.Queue[Dict[str, Any]]", asyncio.AbstractEventLoop]] = []
        self._lock = threading.Lock()

    def append(self, type: str, detail: Dict[str, Any]) -> Dict[str, Any]:
        """Append an event, fan it out to live subscribers, and return it.

        The stored event is ``{"id", "ts", "type", "detail"}`` with a
        monotonically increasing integer ``id`` and an ISO-8601 UTC ``ts``.
        ``detail`` is stored verbatim (original vocabulary preserved).
        """

        with self._lock:
            event: Dict[str, Any] = {
                "id": self._next_id,
                "ts": _utc_now_iso(),
                "type": type,
                "detail": detail,
            }
            self._next_id += 1
            self._buf.append(event)
            subscribers = list(self._subs)

        # Fan out outside the lock so a slow ``call_soon_threadsafe`` target can
        # never stall an appender. Drop-on-slow per subscriber.
        dead: List[Tuple["asyncio.Queue[Dict[str, Any]]", asyncio.AbstractEventLoop]] = []
        for entry in subscribers:
            queue, loop = entry
            try:
                loop.call_soon_threadsafe(self._deliver, queue, event)
            except RuntimeError:
                # Subscriber's loop is closed/closing — treat as disconnected.
                dead.append(entry)
                logger.debug("UI event subscriber loop unavailable; dropping subscriber")

        if dead:
            with self._lock:
                for entry in dead:
                    try:
                        self._subs.remove(entry)
                    except ValueError:
                        pass

        return event

    @staticmethod
    def _deliver(queue: "asyncio.Queue[Dict[str, Any]]", event: Dict[str, Any]) -> None:
        """Enqueue ``event`` for one subscriber, dropping it if the queue is full."""

        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("UI event subscriber queue full. Dropping event.")

    def history(
        self,
        limit: int = RING_CAPACITY,
        since_id: Optional[int] = None,
        types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Return retained events oldest-first after ``since_id``/``types`` filtering.

        Args:
            limit: Maximum number of events to return. ``<= 0`` returns nothing;
                the result is at most ``min(limit, RING_CAPACITY)`` since the
                buffer is bounded. When more than ``limit`` events match, the
                most recent ``limit`` are returned (still oldest-first).
            since_id: If given, only events with ``id`` strictly greater than
                this value are returned (exclusive lower bound).
            types: If given, only events whose ``type`` is in this collection.

        Returns:
            Events in ascending ``id`` (== chronological) order.
        """

        with self._lock:
            items = list(self._buf)

        types_set = set(types) if types is not None else None
        out: List[Dict[str, Any]] = []
        for event in items:
            if since_id is not None and event["id"] <= since_id:
                continue
            if types_set is not None and event["type"] not in types_set:
                continue
            out.append(event)

        if limit <= 0:
            return []
        if limit >= len(out):
            return out
        return out[len(out) - limit :]

    async def subscribe(self) -> AsyncGenerator[Dict[str, Any], None]:
        """Register a subscriber queue and yield events until cancelled.

        The queue is removed from the active set when the generator is closed
        (client disconnect / cancellation).
        """

        loop = asyncio.get_running_loop()
        queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue(maxsize=UI_EVENT_QUEUE_SIZE)
        entry = (queue, loop)
        with self._lock:
            self._subs.append(entry)
        try:
            while True:
                yield await queue.get()
        finally:
            with self._lock:
                try:
                    self._subs.remove(entry)
                except ValueError:
                    pass

    @property
    def subscriber_count(self) -> int:
        """Return the number of currently active subscribers."""

        with self._lock:
            return len(self._subs)

    def __len__(self) -> int:
        """Return the current number of buffered events (<= RING_CAPACITY)."""

        with self._lock:
            return len(self._buf)


class TerminalEventForwarder:
    """Translate terminal status/output bus events into UI events.

    Instances are driven by a single event-bus consumer task, so the per-terminal
    ``_last_status`` / ``_last_activity`` maps are touched from exactly one
    coroutine and need no locking. Construct with the target ``UiEventLog``.
    """

    def __init__(self, log: UiEventLog) -> None:
        """Bind the forwarder to ``log``."""

        self._log = log
        self._last_status: Dict[str, str] = {}
        self._last_activity: Dict[str, float] = {}

    def handle_status(self, terminal_id: str, status: str) -> Dict[str, Any]:
        """Emit a ``status_changed`` event, carrying the previous status.

        The bus only publishes ``terminal.{id}.status`` on a genuine transition
        (``StatusMonitor`` de-dupes), so every call here is a real change.
        ``prev`` is the last status this forwarder saw for the terminal, or
        ``None`` if none is known yet.
        """

        prev = self._last_status.get(terminal_id)
        self._last_status[terminal_id] = status
        return self._log.append(
            "status_changed",
            {"terminal_id": terminal_id, "status": status, "prev": prev},
        )

    def handle_output(
        self, terminal_id: str, now: Optional[float] = None
    ) -> Optional[Dict[str, Any]]:
        """Emit a throttled ``activity`` heartbeat, or ``None`` if throttled.

        At most one ``activity`` event per ``ACTIVITY_THROTTLE_SECONDS`` per
        terminal. The first output for a terminal always emits. Raw output is
        never included — the event carries only ``terminal_id``. ``now`` (a
        monotonic seconds value) is injectable for deterministic tests.
        """

        current = now if now is not None else time.monotonic()
        last = self._last_activity.get(terminal_id)
        if last is None or current - last >= ACTIVITY_THROTTLE_SECONDS:
            self._last_activity[terminal_id] = current
            return self._log.append("activity", {"terminal_id": terminal_id})
        return None


_log: Optional[UiEventLog] = None
_log_lock = threading.Lock()


def get_ui_event_log() -> UiEventLog:
    """Return the process-wide singleton ``UiEventLog`` (lazily created)."""

    global _log
    if _log is None:
        with _log_lock:
            if _log is None:
                _log = UiEventLog()
    return _log
