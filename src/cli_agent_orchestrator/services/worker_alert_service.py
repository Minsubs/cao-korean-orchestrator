"""Tells a supervisor when one of its workers gets stuck.

A worker that errors out, or parks on an approval prompt, stops producing the
callback its supervisor is waiting for — and the supervisor has no way to find
out. It waits until something times out, and the user sees nothing at all: the
work queue shows the state, but the orchestrator is the one holding the
conversation and it does not know.

CAO already does exactly this for one case: a worker whose deferred init fails
gets a message enqueued to its caller (terminal_service._notify_caller_of_
deferred_failure) so "the failure surfaces as the supervisor's next input
instead of leaving it to wait forever on a callback that will never come". This
service extends that idea to the two states that strand a running worker.

The notice is sent *as the worker*, which matters: inbox delivery to a busy
terminal is normally deferred until it is idle, and the exempted case is a
callback from a terminal this one spawned (inbox_service._is_awaited_worker_
callback). A supervisor blocked waiting on this very worker is precisely when
the notice has to get through, and sending it under the worker's id is what
makes that happen.

Consumer: terminal.{id}.status
"""

import asyncio
import logging
from typing import Dict, Optional

from cli_agent_orchestrator.clients.database import create_inbox_message, get_terminal_metadata
from cli_agent_orchestrator.constants import WORKER_ALERT_GRACE_SECONDS
from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services.event_bus import bus
from cli_agent_orchestrator.services.status_monitor import status_monitor
from cli_agent_orchestrator.utils.event import terminal_id_from_topic

logger = logging.getLogger(__name__)

#: States a worker cannot leave on its own, and that stop its callback.
ALERT_STATUSES = (TerminalStatus.ERROR, TerminalStatus.WAITING_USER_ANSWER)

ALERT_MESSAGE = {
    TerminalStatus.WAITING_USER_ANSWER: (
        "[CAO] Worker {label} is parked on a prompt waiting for an answer, so the "
        "callback you are waiting for will not arrive on its own. Answer it with "
        "answer_user_prompt (terminal_id={terminal_id}), or take another route and "
        "tell the user what you chose."
    ),
    TerminalStatus.ERROR: (
        "[CAO] Worker {label} is in an error state and will not send its callback. "
        "Read its output (terminal_id={terminal_id}) to see what happened, then "
        "decide whether to retry, reassign or report it — do not keep waiting."
    ),
}


class WorkerAlertService:
    """Watches worker status and notifies the assigning supervisor once per episode."""

    def __init__(self) -> None:
        # terminal_id -> the pending "still stuck after the grace period?" task.
        # Its presence also means "this episode has not been reported yet".
        self._pending: Dict[str, asyncio.Task] = {}
        # terminal_id -> state already reported, so a status that flaps inside one
        # episode does not send the supervisor the same notice again.
        self._notified: Dict[str, TerminalStatus] = {}

    async def run(self) -> None:
        queue = bus.subscribe("terminal.*.status")
        logger.info("WorkerAlertService started")

        while True:
            try:
                event = await queue.get()
                terminal_id = terminal_id_from_topic(event["topic"])
                status = self._parse_status(event["data"].get("status"))
                self.handle_status(terminal_id, status)
            except Exception as e:  # noqa: BLE001 — a bad event must not kill the loop
                logger.error(f"Error in WorkerAlertService: {e}")

    @staticmethod
    def _parse_status(value: object) -> Optional[TerminalStatus]:
        try:
            return TerminalStatus(str(value))
        except ValueError:
            return None

    def handle_status(self, terminal_id: str, status: Optional[TerminalStatus]) -> None:
        """React to one status transition (sync so tests can drive it directly)."""
        if status in ALERT_STATUSES:
            if self._notified.get(terminal_id) == status or terminal_id in self._pending:
                return  # same episode, already reported or already being timed
            self._arm(terminal_id, status)
            return

        # Left the stuck state: the episode is over, so cancel a pending timer and
        # let the next one report again.
        task = self._pending.pop(terminal_id, None)
        if task is not None:
            task.cancel()
        self._notified.pop(terminal_id, None)

    def _arm(self, terminal_id: str, status: TerminalStatus) -> None:
        """Wait out the grace period before crying wolf.

        An approval picker can appear and resolve on its own within a second or
        two; reporting instantly would train the orchestrator to ignore these.
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop (unit tests / offline replay): decide immediately.
            self._report(terminal_id, status)
            return
        self._pending[terminal_id] = loop.create_task(self._wait_then_report(terminal_id, status))

    async def _wait_then_report(self, terminal_id: str, status: TerminalStatus) -> None:
        try:
            await asyncio.sleep(WORKER_ALERT_GRACE_SECONDS)
            # Re-read rather than trust the event: the worker may have moved on
            # without publishing anything this service saw.
            if status_monitor.get_status(terminal_id) is not status:
                return
            await asyncio.to_thread(self._report, terminal_id, status)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — best-effort notification
            logger.warning("Worker alert for %s failed: %s", terminal_id, exc)
        finally:
            self._pending.pop(terminal_id, None)

    def _report(self, terminal_id: str, status: TerminalStatus) -> None:
        metadata = get_terminal_metadata(terminal_id)
        caller_id = (metadata or {}).get("caller_id")
        if not caller_id:
            # A supervisor stuck on its own prompt has nobody to tell; the work
            # queue still shows it. Log rather than invent a recipient.
            logger.info(
                "Worker %s is %s with no caller to notify; queue-only.",
                terminal_id,
                status.value,
            )
            self._notified[terminal_id] = status
            return

        label = (metadata or {}).get("agent_profile") or terminal_id[:8]
        message = ALERT_MESSAGE[status].format(label=label, terminal_id=terminal_id)
        create_inbox_message(sender_id=terminal_id, receiver_id=caller_id, message=message)
        self._notified[terminal_id] = status
        logger.info("Notified %s that worker %s is %s", caller_id, terminal_id, status.value)


worker_alert_service = WorkerAlertService()
