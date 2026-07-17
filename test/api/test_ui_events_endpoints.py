"""Integration tests for the /ui/events endpoints.

Covers ``/ui/events/history`` replay + ``since_id`` / ``types`` / ``limit``
filtering, the closed-vocabulary 400, and ``/ui/events`` advertising the
``text/event-stream`` media type. Unlike ``/events`` (default-off MCP Apps),
this surface is always on — no ``CAO_MCP_APPS_ENABLED`` gate.
"""

import asyncio

import pytest

from cli_agent_orchestrator.services.ui_event_service import RING_CAPACITY, get_ui_event_log


@pytest.mark.integration
def test_history_replays_appended_events(client) -> None:
    """An appended event is retrievable via /ui/events/history by id."""

    ev = get_ui_event_log().append("session_created", {"session_name": "cao-foo"})

    resp = client.get("/ui/events/history")
    assert resp.status_code == 200
    events = resp.json()["events"]
    match = [e for e in events if e["id"] == ev["id"]]
    assert match and match[0]["type"] == "session_created"
    assert match[0]["detail"] == {"session_name": "cao-foo"}


@pytest.mark.integration
def test_history_since_id_is_exclusive(client) -> None:
    """since_id returns only events with a strictly greater id."""

    log = get_ui_event_log()
    boundary = log.append("activity", {"terminal_id": "t"})
    after = log.append("activity", {"terminal_id": "t"})

    resp = client.get("/ui/events/history", params={"since_id": boundary["id"]})
    assert resp.status_code == 200
    ids = [e["id"] for e in resp.json()["events"]]
    assert boundary["id"] not in ids
    assert after["id"] in ids


@pytest.mark.integration
def test_history_types_filter(client) -> None:
    """The types filter narrows results to the requested vocabulary."""

    log = get_ui_event_log()
    log.append("status_changed", {"terminal_id": "t", "status": "idle", "prev": None})
    log.append("message_sent", {"sender": "a", "receiver": "b", "message": "x"})

    resp = client.get("/ui/events/history", params={"types": "message_sent"})
    assert resp.status_code == 200
    assert all(e["type"] == "message_sent" for e in resp.json()["events"])


@pytest.mark.integration
def test_history_rejects_invalid_type(client) -> None:
    """An unknown type fails closed with 400."""

    resp = client.get("/ui/events/history", params={"types": "bogus"})
    assert resp.status_code == 400


@pytest.mark.integration
def test_history_rejects_one_invalid_among_valid(client) -> None:
    """A single bad token anywhere in the list still fails closed."""

    resp = client.get("/ui/events/history", params={"types": "activity,bogus"})
    assert resp.status_code == 400


@pytest.mark.integration
def test_history_accepts_mixed_valid_types(client) -> None:
    resp = client.get("/ui/events/history", params={"types": "activity,status_changed"})
    assert resp.status_code == 200


@pytest.mark.integration
def test_history_clamps_limit_over_capacity(client) -> None:
    resp = client.get("/ui/events/history", params={"limit": RING_CAPACITY + 1})
    assert resp.status_code == 422


@pytest.mark.integration
def test_history_rejects_negative_limit(client) -> None:
    resp = client.get("/ui/events/history", params={"limit": -1})
    assert resp.status_code == 422


@pytest.mark.integration
def test_history_rejects_negative_since_id(client) -> None:
    resp = client.get("/ui/events/history", params={"since_id": -1})
    assert resp.status_code == 422


@pytest.mark.integration
def test_stream_advertises_event_stream_media_type() -> None:
    """The /ui/events endpoint returns a text/event-stream StreamingResponse."""

    from cli_agent_orchestrator.api.main import ui_events_stream

    async def _call():
        return await ui_events_stream()

    response = asyncio.run(_call())
    assert response.media_type == "text/event-stream"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_consumer_forwards_status_and_activity() -> None:
    """ui_event_consumer routes bus status/output topics into UI events.

    Drives the real event bus end-to-end: a ``terminal.{id}.status`` publish
    becomes a ``status_changed`` event and a ``terminal.{id}.output`` publish
    becomes an ``activity`` event, proving the consumer's topic branching and
    forwarder wiring.
    """
    from cli_agent_orchestrator.api.main import ui_event_consumer
    from cli_agent_orchestrator.services.event_bus import bus
    from cli_agent_orchestrator.services.ui_event_service import get_ui_event_log

    log = get_ui_event_log()
    baseline = log.history()[-1]["id"] if len(log) else 0

    original_loop = bus._loop
    bus.set_loop(asyncio.get_running_loop())
    task = asyncio.create_task(ui_event_consumer())
    try:
        await asyncio.sleep(0)  # let the consumer register its subscription

        bus.publish("terminal.abcd1234.status", {"status": "processing"})
        bus.publish("terminal.abcd1234.output", {"data": "raw bytes not forwarded"})
        # Give the loop turns to dispatch (bus) and process (consumer).
        for _ in range(10):
            await asyncio.sleep(0)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        bus.set_loop(original_loop)

    new = log.history(since_id=baseline)
    types = [e["type"] for e in new]
    assert "status_changed" in types
    assert "activity" in types

    status_event = next(e for e in new if e["type"] == "status_changed")
    assert status_event["detail"] == {
        "terminal_id": "abcd1234",
        "status": "processing",
        "prev": None,
    }
    # activity is a bare heartbeat — raw output is never forwarded.
    activity_event = next(e for e in new if e["type"] == "activity")
    assert activity_event["detail"] == {"terminal_id": "abcd1234"}
