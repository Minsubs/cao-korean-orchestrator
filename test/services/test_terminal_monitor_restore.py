"""Regression tests for restoring tmux monitoring after server restart."""

from unittest.mock import MagicMock, patch

from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services.status_monitor import StatusMonitor
from cli_agent_orchestrator.services.terminal_service import restore_terminal_monitors


@patch("cli_agent_orchestrator.services.terminal_service.status_monitor")
@patch("cli_agent_orchestrator.services.terminal_service.provider_manager")
@patch("cli_agent_orchestrator.services.terminal_service.fifo_manager")
@patch("cli_agent_orchestrator.services.terminal_service.list_all_terminals")
@patch("cli_agent_orchestrator.services.terminal_service.get_backend")
def test_restore_rearms_pipe_and_seeds_status(
    mock_get_backend,
    mock_list_terminals,
    mock_fifo,
    mock_provider_manager,
    mock_status_monitor,
):
    backend = MagicMock()
    backend.supports_event_inbox.return_value = False
    backend.session_exists.return_value = True
    backend.get_history.return_value = "rendered idle prompt"
    mock_get_backend.return_value = backend
    mock_list_terminals.return_value = [
        {
            "id": "abc12345",
            "tmux_session": "cao-demo",
            "tmux_window": "worker-1",
        }
    ]

    assert restore_terminal_monitors() == 1

    backend.stop_pipe_pane.assert_called_once_with("cao-demo", "worker-1")
    mock_fifo.stop_reader.assert_called_once_with("abc12345")
    mock_fifo.create_reader.assert_called_once()
    backend.pipe_pane.assert_called_once()
    mock_provider_manager.get_provider.assert_called_once_with("abc12345")
    mock_status_monitor.restore_snapshot.assert_called_once_with("abc12345", "rendered idle prompt")
    backend.send_special_key.assert_not_called()


@patch("cli_agent_orchestrator.services.terminal_service.fifo_manager")
@patch("cli_agent_orchestrator.services.terminal_service.list_all_terminals")
@patch("cli_agent_orchestrator.services.terminal_service.get_backend")
def test_restore_skips_missing_tmux_session(mock_get_backend, mock_list_terminals, mock_fifo):
    backend = MagicMock()
    backend.supports_event_inbox.return_value = False
    backend.session_exists.return_value = False
    mock_get_backend.return_value = backend
    mock_list_terminals.return_value = [
        {"id": "deadbeef", "tmux_session": "cao-gone", "tmux_window": "worker"}
    ]

    assert restore_terminal_monitors() == 0
    mock_fifo.create_reader.assert_not_called()


def test_restore_snapshot_populates_cache_and_detects_current_state():
    monitor = StatusMonitor()
    with (
        patch.object(monitor, "_detect_status", return_value=TerminalStatus.IDLE),
        patch("cli_agent_orchestrator.services.status_monitor.bus.publish") as publish,
    ):
        detected = monitor.restore_snapshot("abc12345", "current prompt")

    assert detected == TerminalStatus.IDLE
    assert monitor.get_status("abc12345") == TerminalStatus.IDLE
    publish.assert_called_once_with("terminal.abc12345.status", {"status": "idle"})
