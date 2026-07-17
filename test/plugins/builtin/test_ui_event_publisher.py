"""Tests for the observer-only UiEventPublisher plugin.

Each lifecycle hook appends exactly one UI event, preserving the original CAO
vocabulary and detail. The publisher is constructed with an isolated
``UiEventLog`` (dependency injection) so every test runs against a fresh ring
with no mocking of the unit under test.
"""

import pytest

from cli_agent_orchestrator.plugins.builtin.ui_event_publisher import UiEventPublisher
from cli_agent_orchestrator.plugins.events import (
    PostCreateSessionEvent,
    PostCreateTerminalEvent,
    PostKillSessionEvent,
    PostKillTerminalEvent,
    PostSendMessageEvent,
)
from cli_agent_orchestrator.services.ui_event_service import UiEventLog, get_ui_event_log


@pytest.fixture
def wired() -> tuple[UiEventPublisher, UiEventLog]:
    """A publisher bound to a fresh, isolated ``UiEventLog``."""

    log = UiEventLog()
    return UiEventPublisher(log=log), log


class TestLifecycleHooks:
    """Every hook maps to the right UI type and detail."""

    @pytest.mark.asyncio
    async def test_create_session(self, wired: tuple[UiEventPublisher, UiEventLog]) -> None:
        pub, log = wired
        await pub.on_post_create_session(
            PostCreateSessionEvent(session_id="cao-demo", session_name="cao-demo")
        )
        (event,) = log.history()
        assert event["type"] == "session_created"
        assert event["detail"] == {"session_name": "cao-demo", "session_id": "cao-demo"}

    @pytest.mark.asyncio
    async def test_kill_session(self, wired: tuple[UiEventPublisher, UiEventLog]) -> None:
        pub, log = wired
        await pub.on_post_kill_session(
            PostKillSessionEvent(session_id="cao-demo", session_name="cao-demo")
        )
        (event,) = log.history()
        assert event["type"] == "session_killed"
        assert event["detail"] == {"session_name": "cao-demo", "session_id": "cao-demo"}

    @pytest.mark.asyncio
    async def test_create_terminal(self, wired: tuple[UiEventPublisher, UiEventLog]) -> None:
        pub, log = wired
        await pub.on_post_create_terminal(
            PostCreateTerminalEvent(
                session_id="cao-demo",
                terminal_id="abcd1234",
                agent_name="developer",
                provider="claude_code",
            )
        )
        (event,) = log.history()
        assert event["type"] == "terminal_created"
        assert event["detail"] == {
            "terminal_id": "abcd1234",
            "agent_name": "developer",
            "provider": "claude_code",
            "session_id": "cao-demo",
        }

    @pytest.mark.asyncio
    async def test_kill_terminal_provider_none(
        self, wired: tuple[UiEventPublisher, UiEventLog]
    ) -> None:
        pub, log = wired
        await pub.on_post_kill_terminal(
            PostKillTerminalEvent(
                session_id="cao-demo", terminal_id="abcd1234", agent_name="developer"
            )
        )
        (event,) = log.history()
        assert event["type"] == "terminal_killed"
        # PostKillTerminalEvent carries no provider — key kept, reported as None.
        assert event["detail"] == {
            "terminal_id": "abcd1234",
            "agent_name": "developer",
            "provider": None,
            "session_id": "cao-demo",
        }

    @pytest.mark.asyncio
    async def test_send_message_includes_body(
        self, wired: tuple[UiEventPublisher, UiEventLog]
    ) -> None:
        pub, log = wired
        await pub.on_post_send_message(
            PostSendMessageEvent(
                session_id="cao-demo",
                sender="supervisor",
                receiver="abcd1234",
                message="build the widget",
                orchestration_type="handoff",
            )
        )
        (event,) = log.history()
        assert event["type"] == "message_sent"
        # Unlike the MCP Apps observer, the Thread surface keeps the body.
        assert event["detail"] == {
            "sender": "supervisor",
            "receiver": "abcd1234",
            "message": "build the widget",
            "orchestration_type": "handoff",
            "session_id": "cao-demo",
        }


def test_default_constructor_binds_to_singleton() -> None:
    """With no injected log the publisher uses the process-wide singleton."""

    pub = UiEventPublisher()
    assert pub._log is get_ui_event_log()
