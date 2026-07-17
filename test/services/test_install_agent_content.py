"""Tests for install_agent_content — the HTTP-reachable content-upload twin.

Reuses the ``install_paths`` fixture pattern from test_install_service.py so
every write lands in a temp workspace, never the real agent store.
"""

from pathlib import Path

import pytest

from cli_agent_orchestrator.services.install_service import (
    _MAX_PROFILE_CONTENT_BYTES,
    install_agent_content,
)

VALID_PROFILE = (
    "---\n"
    "name: uploaded-agent\n"
    "description: Uploaded via the web UI\n"
    "provider: claude_code\n"
    "---\n"
    "You are an uploaded test agent.\n"
)


@pytest.fixture
def install_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Path]:
    """Minimal clone of test_install_service.install_paths (temp store dirs)."""
    local_store_dir = tmp_path / "agent-store"
    context_dir = tmp_path / "agent-context"
    kiro_dir = tmp_path / "kiro"
    copilot_dir = tmp_path / "copilot"
    for path in (local_store_dir, context_dir, kiro_dir, copilot_dir):
        path.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        "cli_agent_orchestrator.services.install_service.LOCAL_AGENT_STORE_DIR", local_store_dir
    )
    monkeypatch.setattr(
        "cli_agent_orchestrator.utils.agent_profiles.LOCAL_AGENT_STORE_DIR", local_store_dir
    )
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.install_service.AGENT_CONTEXT_DIR", context_dir
    )
    monkeypatch.setattr("cli_agent_orchestrator.services.install_service.KIRO_AGENTS_DIR", kiro_dir)
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.install_service.COPILOT_AGENTS_DIR", copilot_dir
    )
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.settings_service.get_agent_dirs", lambda: {}
    )
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.settings_service.get_extra_agent_dirs", lambda: []
    )
    return {"local_store_dir": local_store_dir}


def test_installs_uploaded_content(install_paths: dict[str, Path]) -> None:
    result = install_agent_content("uploaded-agent", VALID_PROFILE)
    assert result.success, result.message
    saved = install_paths["local_store_dir"] / "uploaded-agent.md"
    assert saved.read_text(encoding="utf-8") == VALID_PROFILE


def test_rejects_invalid_name(install_paths: dict[str, Path]) -> None:
    for bad in ("../evil", "a/b", "name.md", "", "x" * 65):
        result = install_agent_content(bad, VALID_PROFILE)
        assert not result.success
    assert list(install_paths["local_store_dir"].iterdir()) == []


def test_rejects_oversized_and_empty_content(install_paths: dict[str, Path]) -> None:
    too_big = VALID_PROFILE + ("x" * _MAX_PROFILE_CONTENT_BYTES)
    assert not install_agent_content("uploaded-agent", too_big).success
    assert not install_agent_content("uploaded-agent", "   \n").success
    assert list(install_paths["local_store_dir"].iterdir()) == []


def test_duplicate_requires_overwrite(install_paths: dict[str, Path]) -> None:
    assert install_agent_content("uploaded-agent", VALID_PROFILE).success
    dup = install_agent_content("uploaded-agent", VALID_PROFILE)
    assert not dup.success
    assert "already exists" in dup.message
    assert install_agent_content("uploaded-agent", VALID_PROFILE, overwrite=True).success


# The profile parser is deliberately lenient (bare text becomes a prompt, an
# unknown frontmatter provider falls back to the default), so the reliable
# downstream rejection is an *explicit* invalid provider argument — validated
# by install_agent after the content has been written, which is exactly the
# rollback path these tests pin down.
def test_failed_install_rolls_back_new_file(install_paths: dict[str, Path]) -> None:
    result = install_agent_content("broken-agent", VALID_PROFILE, provider="not_a_real_provider")
    assert not result.success
    assert not (install_paths["local_store_dir"] / "broken-agent.md").exists()


def test_failed_overwrite_restores_previous_content(install_paths: dict[str, Path]) -> None:
    assert install_agent_content("uploaded-agent", VALID_PROFILE).success
    changed = VALID_PROFILE.replace("Uploaded via the web UI", "CHANGED")
    result = install_agent_content(
        "uploaded-agent", changed, provider="not_a_real_provider", overwrite=True
    )
    assert not result.success
    saved = install_paths["local_store_dir"] / "uploaded-agent.md"
    assert saved.read_text(encoding="utf-8") == VALID_PROFILE
