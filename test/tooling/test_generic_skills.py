"""Unit tests for the generic skills adapter (which + probe mocked)."""

import pytest

from cli_agent_orchestrator.services.tooling import probe
from cli_agent_orchestrator.services.tooling.adapters import generic_skills
from cli_agent_orchestrator.services.tooling.adapters.generic_skills import (
    GenericSkillsAdapter,
)

_FULL_HELP = "Usage: skills <cmd>\n  add\n  remove\n  update\n  list\n  find\n"


def _install(monkeypatch, *, help_text=_FULL_HELP, list_out="", help_rc=0):
    """Simulate an installed skills CLI with the given --help / list output."""
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: "/usr/local/bin/skills")

    def fake_probe(argv, timeout):
        if argv[1] == "--help":
            rc = help_rc
            return probe.ProbeResult(rc, help_text if rc == 0 else "", "", False)
        if argv[1] == "list":
            return probe.ProbeResult(0, list_out, "", False)
        return probe.ProbeResult(0, "", "", False)

    monkeypatch.setattr(generic_skills.probe, "run", fake_probe)


# --- detection & not-installed -------------------------------------------


def test_not_installed_detects_absent(monkeypatch):
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: None)
    monkeypatch.setattr(GenericSkillsAdapter, "_fallback_binary", staticmethod(lambda: None))
    env = GenericSkillsAdapter().detect()
    assert env.installed is False
    assert env.path is None
    assert env.version is None


def test_not_installed_all_caps_false_with_reasons(monkeypatch):
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: None)
    monkeypatch.setattr(GenericSkillsAdapter, "_fallback_binary", staticmethod(lambda: None))
    caps = GenericSkillsAdapter().capabilities()
    assert not any(
        [
            caps.canList,
            caps.canSearch,
            caps.canInstall,
            caps.canRemove,
            caps.canUpdate,
            caps.canUpdateAll,
        ]
    )
    # Reason is the actionable "install it then re-scan" message.
    assert "감지되지" in caps.reasons["canInstall"]
    assert caps.requiresRestart is False
    assert caps.requiresNewSession is False


def test_not_installed_list_is_empty(monkeypatch):
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: None)
    monkeypatch.setattr(GenericSkillsAdapter, "_fallback_binary", staticmethod(lambda: None))
    assert GenericSkillsAdapter().list_installed() == []


def test_detects_npm_prefix_fallback_when_gui_path_is_missing(monkeypatch):
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: None)
    monkeypatch.setattr(
        GenericSkillsAdapter,
        "_fallback_binary",
        staticmethod(lambda: "/managed/node/bin/skills"),
    )

    env = GenericSkillsAdapter().detect()

    assert env.installed is True
    assert env.path == "/managed/node/bin/skills"


def test_detect_does_not_execute_binary(monkeypatch):
    """detect() must rely on which only, never spawn the binary."""
    monkeypatch.setattr(generic_skills.shutil, "which", lambda _b: "/usr/local/bin/skills")

    def exploding_probe(argv, timeout):
        raise AssertionError("detect must not run a probe")

    monkeypatch.setattr(generic_skills.probe, "run", exploding_probe)
    env = GenericSkillsAdapter().detect()
    assert env.installed is True
    assert env.path == "/usr/local/bin/skills"


# --- capabilities from --help --------------------------------------------


def test_capabilities_all_true_from_help(monkeypatch):
    _install(monkeypatch)
    caps = GenericSkillsAdapter().capabilities()
    assert caps.canInstall and caps.canRemove and caps.canUpdate
    assert caps.canUpdateAll and caps.canList and caps.canSearch
    assert caps.reasons == {}


def test_capabilities_missing_subcommands(monkeypatch):
    _install(monkeypatch, help_text="Usage: skills\n  add\n  remove\n  list\n")  # no update/find
    caps = GenericSkillsAdapter().capabilities()
    assert caps.canInstall and caps.canRemove and caps.canList
    assert caps.canUpdate is False
    assert caps.canUpdateAll is False
    assert caps.canSearch is False
    assert "update" in caps.reasons["canUpdate"]
    assert "find" in caps.reasons["canSearch"]


def test_capabilities_help_unreadable(monkeypatch):
    _install(monkeypatch, help_rc=1)  # non-zero --help
    caps = GenericSkillsAdapter().capabilities()
    assert not any([caps.canInstall, caps.canUpdate, caps.canList])
    assert "확인" in caps.reasons["canInstall"]


# --- planning -------------------------------------------------------------


def test_plan_argv_per_action(monkeypatch):
    _install(monkeypatch)
    a = GenericSkillsAdapter()
    assert a.plan("install", "my-skill", None).argv == ["skills", "add", "my-skill"]
    assert a.plan("remove", "my-skill", None).argv == ["skills", "remove", "my-skill"]
    assert a.plan("update", "my-skill", None).argv == ["skills", "update", "my-skill"]
    assert a.plan("update_all", None, None).argv == ["skills", "update"]


def test_plan_cwd_is_home(monkeypatch):
    import os

    _install(monkeypatch)
    plan = GenericSkillsAdapter().plan("install", "x", None)
    assert plan.cwd == os.path.expanduser("~")


def test_plan_global_scope_appended_when_supported(monkeypatch):
    _install(monkeypatch, help_text=_FULL_HELP + "  --global\n")
    argv = GenericSkillsAdapter().plan("install", "x", "global").argv
    assert argv == ["skills", "add", "x", "--global"]


def test_plan_global_scope_omitted_when_unsupported(monkeypatch):
    _install(monkeypatch)  # no --global in help
    argv = GenericSkillsAdapter().plan("install", "x", "global").argv
    assert "--global" not in argv


def test_plan_catalog_skill_uses_repository_and_skill_name(monkeypatch):
    _install(monkeypatch, help_text=_FULL_HELP + "  --global\n")

    argv = (
        GenericSkillsAdapter().plan_skill_add("anthropics/skills", "frontend-design", "global").argv
    )

    assert argv == [
        "skills",
        "add",
        "anthropics/skills",
        "--skill",
        "frontend-design",
        "--yes",
        "--global",
    ]


def test_plan_requires_target(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        GenericSkillsAdapter().plan("install", None, None)


def test_plan_unsupported_action(monkeypatch):
    _install(monkeypatch)
    with pytest.raises(ValueError):
        GenericSkillsAdapter().plan("frobnicate", "x", None)


# --- verification ---------------------------------------------------------


def test_verify_install_present(monkeypatch):
    _install(monkeypatch, list_out="my-skill 1.0\nother 2.0\n")
    ok, detail = GenericSkillsAdapter().verify("install", "my-skill")
    assert ok is True
    assert "present" in detail


def test_verify_install_absent(monkeypatch):
    _install(monkeypatch, list_out="other 2.0\n")
    ok, detail = GenericSkillsAdapter().verify("install", "my-skill")
    assert ok is False
    assert "absent" in detail


def test_verify_remove_absent_is_success(monkeypatch):
    _install(monkeypatch, list_out="other 2.0\n")
    ok, _ = GenericSkillsAdapter().verify("remove", "my-skill")
    assert ok is True


def test_verify_remove_still_present_is_failure(monkeypatch):
    _install(monkeypatch, list_out="my-skill 1.0\n")
    ok, _ = GenericSkillsAdapter().verify("remove", "my-skill")
    assert ok is False


def test_verify_update_all_is_soft_success(monkeypatch):
    _install(monkeypatch)
    ok, detail = GenericSkillsAdapter().verify("update_all", None)
    assert ok is True
    assert "per-item" in detail


# --- list parsing ---------------------------------------------------------


def test_list_parsing_keeps_uncertain_lines_as_raw(monkeypatch):
    _install(
        monkeypatch,
        list_out="my-skill  1.2.3\n===== header =====\n\nweird!!! entry\nother-skill\n",
    )
    items = GenericSkillsAdapter().list_installed()
    names = [it["name"] for it in items]
    assert "my-skill" in names
    assert "other-skill" in names
    # A line whose first token is not name-shaped is kept, name=None.
    raws = [it["raw"] for it in items if it["name"] is None]
    assert any("header" in r for r in raws)
    assert any("weird" in r for r in raws)
    # Blank lines are dropped entirely.
    assert all(it["raw"].strip() for it in items)
