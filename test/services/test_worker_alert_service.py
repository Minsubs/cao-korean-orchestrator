"""A stuck worker has to reach its supervisor, once, and only when it is real.

Reported from live use: with the thread showing only the conversation, a worker
that errors or parks on an approval prompt is visible in the work queue and
nowhere else — and the orchestrator, which is the one talking to the user, does
not know either. It keeps waiting for a callback that cannot arrive.

CAO already notifies the caller when a worker's deferred init fails
(terminal_service._notify_caller_of_deferred_failure). This service covers the
two states that strand a worker that did start.
"""

import asyncio
from unittest.mock import patch

import pytest

from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services.worker_alert_service import WorkerAlertService

WORKER = "worker01"
SUPERVISOR = "sup01"
META = {"caller_id": SUPERVISOR, "agent_profile": "codex_qa_terra"}


def drive(service: WorkerAlertService, status: TerminalStatus | None) -> None:
    """One status transition, decided synchronously (no running loop → no grace)."""
    service.handle_status(WORKER, status)


class TestReporting:
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_a_blocked_worker_is_reported_to_its_caller(self, meta, create):
        meta.return_value = META
        drive(WorkerAlertService(), TerminalStatus.WAITING_USER_ANSWER)

        create.assert_called_once()
        kwargs = create.call_args.kwargs
        assert kwargs["receiver_id"] == SUPERVISOR
        # Sent AS the worker: inbox delivery to a busy terminal is only exempted
        # for a callback from a terminal it spawned, and a supervisor blocked on
        # this very worker is exactly who needs to hear it.
        assert kwargs["sender_id"] == WORKER
        assert "answer_user_prompt" in kwargs["message"]
        assert WORKER in kwargs["message"]

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_an_errored_worker_is_reported_with_what_to_do(self, meta, create):
        meta.return_value = META
        drive(WorkerAlertService(), TerminalStatus.ERROR)

        message = create.call_args.kwargs["message"]
        assert "error state" in message
        # Says what to do rather than only what happened — the point is to stop
        # the supervisor from waiting.
        assert "do not keep waiting" in message

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_the_profile_name_is_used_when_known(self, meta, create):
        meta.return_value = META
        drive(WorkerAlertService(), TerminalStatus.ERROR)

        assert "codex_qa_terra" in create.call_args.kwargs["message"]

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_a_terminal_with_no_caller_is_left_to_the_queue(self, meta, create):
        # A supervisor stuck on its own prompt has nobody to tell; inventing a
        # recipient would be worse than the queue showing it.
        meta.return_value = {"caller_id": None, "agent_profile": "codex_orchestrator_sol"}
        drive(WorkerAlertService(), TerminalStatus.WAITING_USER_ANSWER)

        create.assert_not_called()

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_healthy_states_say_nothing(self, meta, create):
        meta.return_value = META
        service = WorkerAlertService()
        for status in (TerminalStatus.IDLE, TerminalStatus.PROCESSING, TerminalStatus.COMPLETED):
            drive(service, status)

        create.assert_not_called()


class TestOncePerEpisode:
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_a_repeated_status_does_not_repeat_the_notice(self, meta, create):
        meta.return_value = META
        service = WorkerAlertService()
        for _ in range(4):
            drive(service, TerminalStatus.WAITING_USER_ANSWER)

        assert create.call_count == 1

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_recovering_and_getting_stuck_again_is_a_new_episode(self, meta, create):
        meta.return_value = META
        service = WorkerAlertService()
        drive(service, TerminalStatus.WAITING_USER_ANSWER)
        drive(service, TerminalStatus.PROCESSING)  # answered, back to work
        drive(service, TerminalStatus.WAITING_USER_ANSWER)  # stuck on the next prompt

        assert create.call_count == 2

    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_switching_between_stuck_states_reports_the_new_one(self, meta, create):
        meta.return_value = META
        service = WorkerAlertService()
        drive(service, TerminalStatus.WAITING_USER_ANSWER)
        drive(service, TerminalStatus.ERROR)

        assert create.call_count == 2
        assert "error state" in create.call_args.kwargs["message"]


class TestGracePeriod:
    @pytest.mark.asyncio
    @patch("cli_agent_orchestrator.services.worker_alert_service.WORKER_ALERT_GRACE_SECONDS", 0.01)
    @patch("cli_agent_orchestrator.services.worker_alert_service.status_monitor")
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    async def test_a_prompt_that_clears_itself_is_never_reported(self, meta, create, monitor):
        """An approval picker can appear and resolve in a second or two. Crying
        wolf on every flicker teaches the orchestrator to ignore these."""
        meta.return_value = META
        monitor.get_status.return_value = TerminalStatus.PROCESSING  # already moved on
        service = WorkerAlertService()
        service.handle_status(WORKER, TerminalStatus.WAITING_USER_ANSWER)
        await asyncio.sleep(0.05)

        create.assert_not_called()

    @pytest.mark.asyncio
    @patch("cli_agent_orchestrator.services.worker_alert_service.WORKER_ALERT_GRACE_SECONDS", 0.01)
    @patch("cli_agent_orchestrator.services.worker_alert_service.status_monitor")
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    async def test_a_prompt_that_persists_is_reported(self, meta, create, monitor):
        meta.return_value = META
        monitor.get_status.return_value = TerminalStatus.WAITING_USER_ANSWER
        service = WorkerAlertService()
        service.handle_status(WORKER, TerminalStatus.WAITING_USER_ANSWER)
        await asyncio.sleep(0.05)

        create.assert_called_once()

    @pytest.mark.asyncio
    @patch("cli_agent_orchestrator.services.worker_alert_service.WORKER_ALERT_GRACE_SECONDS", 5.0)
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    async def test_recovering_inside_the_grace_window_cancels_the_notice(self, meta, create):
        meta.return_value = META
        service = WorkerAlertService()
        service.handle_status(WORKER, TerminalStatus.ERROR)
        service.handle_status(WORKER, TerminalStatus.IDLE)
        await asyncio.sleep(0.01)

        create.assert_not_called()
        assert WORKER not in service._pending


class TestResilience:
    @patch("cli_agent_orchestrator.services.worker_alert_service.create_inbox_message")
    @patch("cli_agent_orchestrator.services.worker_alert_service.get_terminal_metadata")
    def test_a_missing_terminal_record_is_not_an_error(self, meta, create):
        meta.return_value = None
        drive(WorkerAlertService(), TerminalStatus.ERROR)

        create.assert_not_called()

    def test_an_unparseable_status_is_ignored(self):
        assert WorkerAlertService._parse_status("not-a-status") is None
        assert WorkerAlertService._parse_status(None) is None
