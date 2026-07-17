"""Tests for the UI event ring buffer + forwarder (services/ui_event_service.py).

Covers ring-buffer cycling and monotonic ids, ``since_id`` / ``limit`` /
``types`` history filtering, drop-on-slow SSE fan-out, and the
``TerminalEventForwarder`` status-transition + activity-throttle logic. All
tests use real instances (no mocking of the unit under test).
"""

import asyncio

import pytest

from cli_agent_orchestrator.services import ui_event_service as ui_module
from cli_agent_orchestrator.services.ui_event_service import (
    ACTIVITY_THROTTLE_SECONDS,
    RING_CAPACITY,
    UI_EVENT_QUEUE_SIZE,
    TerminalEventForwarder,
    UiEventLog,
    get_ui_event_log,
)


class TestRingBuffer:
    """Ring-buffer bound, monotonic ids, and eviction order."""

    def test_append_returns_monotonic_ids_and_schema(self) -> None:
        log = UiEventLog()
        e1 = log.append("session_created", {"session_name": "cao-a"})
        e2 = log.append("session_killed", {"session_name": "cao-a"})

        assert e1["id"] == 1 and e2["id"] == 2
        assert set(e1.keys()) == {"id", "ts", "type", "detail"}
        assert e1["type"] == "session_created"
        assert e1["detail"] == {"session_name": "cao-a"}
        # ts is an ISO-8601 string.
        assert isinstance(e1["ts"], str) and "T" in e1["ts"]

    def test_buffer_is_bounded_and_evicts_oldest(self) -> None:
        log = UiEventLog()
        for _ in range(RING_CAPACITY + 250):
            log.append("activity", {"terminal_id": "abcd1234"})

        assert len(log) == RING_CAPACITY
        history = log.history()
        # Ids are monotonic and the oldest were evicted: first retained id is
        # (total_appended - RING_CAPACITY + 1).
        assert history[0]["id"] == 250 + 1
        assert history[-1]["id"] == RING_CAPACITY + 250
        # Strictly increasing ids.
        ids = [e["id"] for e in history]
        assert ids == sorted(ids)
        assert len(set(ids)) == len(ids)


class TestHistoryFiltering:
    """``since_id`` (exclusive), ``limit``, and ``types`` filters."""

    def test_since_id_is_exclusive(self) -> None:
        log = UiEventLog()
        events = [log.append("activity", {"terminal_id": "t"}) for _ in range(5)]
        third_id = events[2]["id"]

        out = log.history(since_id=third_id)
        assert [e["id"] for e in out] == [events[3]["id"], events[4]["id"]]

    def test_limit_returns_most_recent_oldest_first(self) -> None:
        log = UiEventLog()
        events = [log.append("activity", {"terminal_id": "t"}) for _ in range(10)]

        out = log.history(limit=3)
        assert [e["id"] for e in out] == [e["id"] for e in events[-3:]]

    def test_limit_zero_returns_empty(self) -> None:
        log = UiEventLog()
        log.append("activity", {"terminal_id": "t"})
        assert log.history(limit=0) == []

    def test_types_filter(self) -> None:
        log = UiEventLog()
        log.append("status_changed", {"terminal_id": "t", "status": "idle", "prev": None})
        log.append("activity", {"terminal_id": "t"})
        log.append("message_sent", {"sender": "a", "receiver": "b"})

        out = log.history(types=["status_changed", "message_sent"])
        assert [e["type"] for e in out] == ["status_changed", "message_sent"]


class TestFanOut:
    """Live SSE fan-out: delivery, isolation, and drop-on-slow back-pressure."""

    @pytest.mark.asyncio
    async def test_subscribe_receives_appended_events(self) -> None:
        log = UiEventLog()
        gen = log.subscribe()
        task = asyncio.ensure_future(gen.__anext__())
        await asyncio.sleep(0)  # register the queue

        log.append("session_created", {"session_name": "cao-x"})
        received = await task
        assert received["type"] == "session_created"

        await gen.aclose()

    @pytest.mark.asyncio
    async def test_full_subscriber_queue_drops_without_blocking(self) -> None:
        log = UiEventLog()
        gen = log.subscribe()
        task = asyncio.ensure_future(gen.__anext__())
        await asyncio.sleep(0)

        # Overfill far past capacity; append must never block or raise.
        for _ in range(UI_EVENT_QUEUE_SIZE + 100):
            log.append("activity", {"terminal_id": "t"})

        assert log.subscriber_count == 1
        # The ring buffer is still the durable record.
        assert len(log) == UI_EVENT_QUEUE_SIZE + 100

        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, StopAsyncIteration):
            pass
        await gen.aclose()


class TestForwarder:
    """Status-transition and activity-throttle translation."""

    def test_status_change_records_prev(self) -> None:
        log = UiEventLog()
        fwd = TerminalEventForwarder(log)

        first = fwd.handle_status("abcd1234", "processing")
        second = fwd.handle_status("abcd1234", "completed")

        assert first["type"] == "status_changed"
        assert first["detail"] == {"terminal_id": "abcd1234", "status": "processing", "prev": None}
        assert second["detail"] == {
            "terminal_id": "abcd1234",
            "status": "completed",
            "prev": "processing",
        }

    def test_prev_is_tracked_per_terminal(self) -> None:
        log = UiEventLog()
        fwd = TerminalEventForwarder(log)

        fwd.handle_status("aaaa1111", "idle")
        other = fwd.handle_status("bbbb2222", "processing")
        # A different terminal's first transition still has prev=None.
        assert other["detail"]["prev"] is None

    def test_activity_is_throttled_per_terminal(self) -> None:
        log = UiEventLog()
        fwd = TerminalEventForwarder(log)

        # First output emits immediately (now=0).
        e0 = fwd.handle_output("abcd1234", now=0.0)
        assert e0 is not None and e0["type"] == "activity"
        assert e0["detail"] == {"terminal_id": "abcd1234"}

        # Within the throttle window: dropped.
        assert fwd.handle_output("abcd1234", now=ACTIVITY_THROTTLE_SECONDS - 0.01) is None

        # At/after the window boundary: emits again.
        e1 = fwd.handle_output("abcd1234", now=ACTIVITY_THROTTLE_SECONDS)
        assert e1 is not None

        # Only two activity events were appended.
        assert len(log.history(types=["activity"])) == 2

    def test_activity_throttle_is_independent_per_terminal(self) -> None:
        log = UiEventLog()
        fwd = TerminalEventForwarder(log)

        assert fwd.handle_output("aaaa1111", now=0.0) is not None
        # Different terminal at the same instant still emits (separate window).
        assert fwd.handle_output("bbbb2222", now=0.0) is not None

    def test_activity_never_includes_raw_output(self) -> None:
        log = UiEventLog()
        fwd = TerminalEventForwarder(log)
        event = fwd.handle_output("abcd1234", now=0.0)
        assert event is not None
        assert set(event["detail"].keys()) == {"terminal_id"}


def test_get_ui_event_log_is_singleton() -> None:
    assert get_ui_event_log() is get_ui_event_log()
    assert isinstance(ui_module.get_ui_event_log(), UiEventLog)
