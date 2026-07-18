"""Unit tests for the unified CAO extension inventory."""

from cli_agent_orchestrator.services.tooling import extensions

_BUILTIN_PLUGINS = {
    "claude_code_memory",
    "kiro_cli_memory",
    "codex_memory",
    "event_log_publisher",
    "mcp_apps",
}


def _make_skill(parent, name, description="a skill"):
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\nSkill body.\n"
    )
    return folder


def _stub_empty_profiles(monkeypatch):
    monkeypatch.setattr(extensions, "list_agent_profiles", lambda: [])
    monkeypatch.setattr(extensions.registry, "get_adapters", lambda: {})


def test_skills_scope_by_install_location(tmp_path, monkeypatch):
    global_store = tmp_path / "global"
    global_store.mkdir()
    extra = tmp_path / "extra"
    extra.mkdir()
    _make_skill(global_store, "cao-supervisor-protocols")
    user_folder = _make_skill(extra, "my-custom-skill")

    monkeypatch.setattr(extensions.constants, "SKILLS_DIR", global_store)
    monkeypatch.setattr(extensions.settings_service, "get_extra_skill_dirs", lambda: [str(extra)])
    _stub_empty_profiles(monkeypatch)

    skills = {i["name"]: i for i in extensions.list_extensions() if i["kind"] == "skill"}

    builtin = skills["cao-supervisor-protocols"]
    assert builtin["scope"] == "built-in"
    assert builtin["id"] == "skill:cao-supervisor-protocols"
    assert builtin["provider"] == "cao"
    assert builtin["enabled"] is True

    user = skills["my-custom-skill"]
    assert user["scope"] == "user"
    assert user["source_path"] == str(user_folder)


def test_builtin_plugins_listed(tmp_path, monkeypatch):
    monkeypatch.setattr(extensions.constants, "SKILLS_DIR", tmp_path / "absent")
    monkeypatch.setattr(extensions.settings_service, "get_extra_skill_dirs", lambda: [])
    _stub_empty_profiles(monkeypatch)

    result = extensions.list_extensions()
    plugins = [i for i in result if i["kind"] == "plugin"]
    plugin_names = {i["name"] for i in plugins}

    assert _BUILTIN_PLUGINS <= plugin_names
    for item in plugins:
        assert item["scope"] == "built-in"
        assert item["id"] == f"plugin:{item['name']}"
        assert item["provider"] == "cao"


def test_profiles_preserve_source_and_duplicates(tmp_path, monkeypatch):
    monkeypatch.setattr(extensions.constants, "SKILLS_DIR", tmp_path / "absent")
    monkeypatch.setattr(extensions.settings_service, "get_extra_skill_dirs", lambda: [])
    monkeypatch.setattr(
        extensions,
        "list_agent_profiles",
        lambda: [
            {"name": "builder", "description": "d", "source": "built-in", "duplicated_in": []},
            {
                "name": "dev",
                "description": "",
                "source": "custom",
                "duplicated_in": ["local", "claude_code"],
            },
        ],
    )

    profiles = {i["name"]: i for i in extensions.list_extensions() if i["kind"] == "profile"}

    assert profiles["builder"]["scope"] == "built-in"
    assert profiles["dev"]["scope"] == "user"
    assert profiles["dev"]["id"] == "profile:dev"
    assert profiles["dev"]["source"] == "custom"
    assert profiles["dev"]["duplicated_in"] == ["local", "claude_code"]


def test_invalid_skill_folder_is_skipped(tmp_path, monkeypatch):
    """A folder whose name mismatches its metadata is omitted (not surfaced here)."""
    global_store = tmp_path / "global"
    broken = global_store / "broken"
    broken.mkdir(parents=True)
    (broken / "SKILL.md").write_text("---\nname: other-name\ndescription: d\n---\nx")

    monkeypatch.setattr(extensions.constants, "SKILLS_DIR", global_store)
    monkeypatch.setattr(extensions.settings_service, "get_extra_skill_dirs", lambda: [])
    _stub_empty_profiles(monkeypatch)

    skill_names = {i["name"] for i in extensions.list_extensions() if i["kind"] == "skill"}
    assert "broken" not in skill_names
    assert "other-name" not in skill_names


def test_provider_managed_extensions_are_merged_with_qualified_ids(tmp_path, monkeypatch):
    class FakeAdapter:
        display_name = "Fake provider"

        def __init__(self, installed, names):
            self._installed = installed
            self._names = names

        def detect(self):
            return type("Env", (), {"installed": self._installed})()

        def list_installed(self):
            return [{"name": name, "raw": name} for name in self._names]

    monkeypatch.setattr(extensions.constants, "SKILLS_DIR", tmp_path / "absent")
    monkeypatch.setattr(extensions.settings_service, "get_extra_skill_dirs", lambda: [])
    monkeypatch.setattr(extensions, "list_agent_profiles", lambda: [])
    monkeypatch.setattr(
        extensions.registry,
        "get_adapters",
        lambda: {
            "generic_skills": FakeAdapter(True, ["frontend-design"]),
            "codex": FakeAdapter(True, ["context7"]),
            "claude_code": FakeAdapter(False, ["ignored"]),
        },
    )

    by_id = {item["id"]: item for item in extensions.list_extensions()}

    assert by_id["skill:generic_skills:frontend-design"]["kind"] == "skill"
    assert by_id["skill:generic_skills:frontend-design"]["provider"] == "generic_skills"
    assert by_id["mcp:codex:context7"]["kind"] == "mcp"
    assert "mcp:claude_code:ignored" not in by_id
