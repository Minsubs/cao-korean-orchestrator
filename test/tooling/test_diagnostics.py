"""Unit tests for derived tooling diagnostics."""

from cli_agent_orchestrator.services.tooling import diagnostics


def _provider(name, **overrides):
    base = {
        "name": name,
        "display_name": name.replace("_", " ").title(),
        "binary": name.split("_")[0],
        "installed": True,
        "path": f"/usr/bin/{name}",
        "version": "1.0",
        "version_raw": "1.0",
        "version_error": None,
        "checked_at": "t",
    }
    base.update(overrides)
    return base


def _neuter_skills(monkeypatch, tmp_path):
    monkeypatch.setattr(diagnostics.constants, "SKILLS_DIR", tmp_path / "no-skills")
    monkeypatch.setattr(diagnostics.settings_service, "get_extra_skill_dirs", lambda: [])


def test_provider_missing_and_version_error(monkeypatch, tmp_path):
    _neuter_skills(monkeypatch, tmp_path)
    monkeypatch.setattr(diagnostics, "list_agent_profiles", lambda: [])
    monkeypatch.setattr(
        diagnostics,
        "list_providers",
        lambda: [
            _provider("claude_code", installed=False, path=None, version=None, version_raw=None),
            _provider(
                "codex",
                version=None,
                version_raw="weird",
                version_error="could not parse a version from: weird",
            ),
            _provider("hermes"),
        ],
    )

    result = diagnostics.collect_diagnostics()
    by_code = {d["code"]: d for d in result}

    assert by_code["provider_missing"]["severity"] == "info"
    assert by_code["provider_missing"]["provider"] == "claude_code"
    assert by_code["provider_missing"]["path"] is None
    assert by_code["version_probe_failed"]["severity"] == "warning"
    assert by_code["version_probe_failed"]["provider"] == "codex"
    assert by_code["version_probe_failed"]["path"] == "/usr/bin/codex"
    # The healthy provider produces nothing.
    assert len(result) == 2


def test_skill_parse_error(monkeypatch, tmp_path):
    monkeypatch.setattr(diagnostics, "list_providers", lambda: [])
    monkeypatch.setattr(diagnostics, "list_agent_profiles", lambda: [])

    skills_dir = tmp_path / "skills"
    broken = skills_dir / "broken"
    broken.mkdir(parents=True)
    # Folder name != metadata name -> validation raises ValueError.
    (broken / "SKILL.md").write_text("---\nname: something-else\ndescription: d\n---\nx")

    monkeypatch.setattr(diagnostics.constants, "SKILLS_DIR", skills_dir)
    monkeypatch.setattr(diagnostics.settings_service, "get_extra_skill_dirs", lambda: [])

    result = diagnostics.collect_diagnostics()

    assert len(result) == 1
    assert result[0]["code"] == "skill_parse_error"
    assert result[0]["severity"] == "warning"
    assert result[0]["path"] == str(broken)
    assert result[0]["provider"] is None


def test_profile_duplicate(monkeypatch, tmp_path):
    _neuter_skills(monkeypatch, tmp_path)
    monkeypatch.setattr(diagnostics, "list_providers", lambda: [])
    monkeypatch.setattr(
        diagnostics,
        "list_agent_profiles",
        lambda: [
            {"name": "dev", "description": "", "source": "local", "duplicated_in": ["claude_code"]},
            {"name": "solo", "description": "", "source": "built-in", "duplicated_in": []},
        ],
    )

    result = diagnostics.collect_diagnostics()

    assert len(result) == 1
    assert result[0]["code"] == "profile_duplicate"
    assert result[0]["severity"] == "warning"
    assert "claude_code" in result[0]["cause"]


def test_no_diagnostics_when_healthy(monkeypatch, tmp_path):
    _neuter_skills(monkeypatch, tmp_path)
    monkeypatch.setattr(diagnostics, "list_providers", lambda: [_provider("codex")])
    monkeypatch.setattr(diagnostics, "list_agent_profiles", lambda: [])

    assert diagnostics.collect_diagnostics() == []
