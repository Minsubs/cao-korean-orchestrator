"""Unit tests for host environment detection."""

from cli_agent_orchestrator.services.tooling import environment

_ENV_KEYS = {
    "os",
    "os_version",
    "arch",
    "shell",
    "is_wsl",
    "server_version",
    "python_version",
    "checked_at",
}


def test_os_label_and_version_on_macos(monkeypatch):
    monkeypatch.setattr(environment.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(environment.platform, "mac_ver", lambda: ("15.5", ("", "", ""), ""))

    env = environment.detect_environment(use_cache=False)

    assert env["os"] == "macOS"
    assert env["os_version"] == "15.5"


def test_wsl_detected_from_proc_version(monkeypatch):
    monkeypatch.setattr(environment.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        environment,
        "_read_proc_version",
        lambda: "Linux version 5.15.0-microsoft-standard-WSL2",
    )

    assert environment.detect_environment(use_cache=False)["is_wsl"] is True


def test_wsl_false_on_plain_linux(monkeypatch):
    monkeypatch.setattr(environment.platform, "system", lambda: "Linux")
    monkeypatch.setattr(environment, "_read_proc_version", lambda: "Linux version 6.1.0 generic")

    assert environment.detect_environment(use_cache=False)["is_wsl"] is False


def test_wsl_false_off_linux(monkeypatch):
    """Non-Linux short-circuits before ever reading /proc/version."""
    monkeypatch.setattr(environment.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(environment.platform, "mac_ver", lambda: ("15.5", ("", "", ""), ""))
    monkeypatch.setattr(environment, "_read_proc_version", lambda: "microsoft")

    assert environment.detect_environment(use_cache=False)["is_wsl"] is False


def test_undetectable_fields_are_null(monkeypatch):
    monkeypatch.setattr(environment.platform, "machine", lambda: "")
    monkeypatch.delenv("SHELL", raising=False)

    env = environment.detect_environment(use_cache=False)

    assert env["arch"] is None
    assert env["shell"] is None


def test_core_fields_and_shape(monkeypatch):
    monkeypatch.setattr(environment.platform, "system", lambda: "Linux")
    monkeypatch.setattr(environment, "_read_proc_version", lambda: "generic")

    env = environment.detect_environment(use_cache=False)

    assert set(env) == _ENV_KEYS
    assert isinstance(env["python_version"], str) and env["python_version"]
    assert isinstance(env["checked_at"], str) and env["checked_at"]
    # Metadata-derived: a string when the dist is installed, else None.
    assert env["server_version"] is None or isinstance(env["server_version"], str)
