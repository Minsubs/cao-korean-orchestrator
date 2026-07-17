"""Observer-only plugin that mirrors lifecycle hooks into the UI event ring.

The ``UiEventPublisher`` is a pure side-observer of CAO's orchestration
lifecycle for the Phase 2 chat workspace. It subscribes to the five ``Post*``
lifecycle events and appends one UI event per hook to the always-on
``UiEventLog`` (``/ui/events`` + ``/ui/events/history``), preserving the
*original* CAO event vocabulary and detail (no six-primitive abridging).

This is intentionally separate from ``EventLogPublisher`` (the default-off,
metadata-only MCP Apps observer). Differences:

- **Always on.** No ``apps.enabled`` gate — the chat workspace needs the stream
  by default.
- **Original vocabulary.** ``post_create_terminal`` → ``terminal_created`` etc.,
  with the full detail Phase 2b renders.
- **Message body included.** ``message_sent`` carries ``message`` so the
  Orchestration Thread can show what was delegated. (The MCP Apps observer
  deliberately strips bodies; this local single-user workspace surface keeps
  them.)

Invariants preserved from the observer pattern:

- **Observer-only.** Never mutates orchestration state; only reads the event and
  appends to the in-process ring.
- **Failure-isolated.** Hooks run after the orchestration action and the
  registry swallows/logs hook exceptions, so a ring hiccup never alters fleet
  behavior.
"""

from __future__ import annotations

import logging
from typing import Optional

from cli_agent_orchestrator.plugins import (
    PostCreateSessionEvent,
    PostCreateTerminalEvent,
    PostKillSessionEvent,
    PostKillTerminalEvent,
    PostSendMessageEvent,
    hook,
)
from cli_agent_orchestrator.plugins.base import CaoPlugin
from cli_agent_orchestrator.services.ui_event_service import UiEventLog, get_ui_event_log

logger = logging.getLogger(__name__)


class UiEventPublisher(CaoPlugin):
    """Mirror ``Post*`` lifecycle hooks into the UI event ring, original vocab."""

    def __init__(self, log: Optional[UiEventLog] = None) -> None:
        """Bind to ``log`` (defaults to the process-wide singleton).

        The plugin registry instantiates plugins with no arguments, so the
        default resolves the singleton every UI-facing surface shares. Tests
        inject an isolated ``UiEventLog`` for assertion without any mocking.
        """

        self._log = log if log is not None else get_ui_event_log()

    async def setup(self) -> None:
        """Stateless plugin; nothing to initialize."""

    async def teardown(self) -> None:
        """Stateless plugin; nothing to release."""

    # ------------------------------------------------------------------
    # lifecycle hooks (observer-only)

    @hook("post_create_session")
    async def on_post_create_session(self, event: PostCreateSessionEvent) -> None:
        """Record a session launch."""

        self._log.append(
            "session_created",
            {"session_name": event.session_name, "session_id": event.session_id},
        )

    @hook("post_kill_session")
    async def on_post_kill_session(self, event: PostKillSessionEvent) -> None:
        """Record a session teardown."""

        self._log.append(
            "session_killed",
            {"session_name": event.session_name, "session_id": event.session_id},
        )

    @hook("post_create_terminal")
    async def on_post_create_terminal(self, event: PostCreateTerminalEvent) -> None:
        """Record a terminal launch."""

        self._log.append(
            "terminal_created",
            {
                "terminal_id": event.terminal_id,
                "agent_name": event.agent_name,
                "provider": event.provider,
                "session_id": event.session_id,
            },
        )

    @hook("post_kill_terminal")
    async def on_post_kill_terminal(self, event: PostKillTerminalEvent) -> None:
        """Record a terminal teardown.

        ``PostKillTerminalEvent`` carries no ``provider``; the key is kept for a
        stable schema and reported as ``None`` (unknown) via ``getattr``.
        """

        self._log.append(
            "terminal_killed",
            {
                "terminal_id": event.terminal_id,
                "agent_name": event.agent_name,
                "provider": getattr(event, "provider", None),
                "session_id": event.session_id,
            },
        )

    @hook("post_send_message")
    async def on_post_send_message(self, event: PostSendMessageEvent) -> None:
        """Record a message dispatch (assign / handoff / send_message).

        The message body is included so the Orchestration Thread can render the
        delegated instruction — this is a local, single-user workspace surface.
        """

        self._log.append(
            "message_sent",
            {
                "sender": event.sender,
                "receiver": event.receiver,
                "message": event.message,
                "orchestration_type": event.orchestration_type,
                "session_id": event.session_id,
            },
        )
