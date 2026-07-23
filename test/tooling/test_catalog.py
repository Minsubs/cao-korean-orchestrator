"""Unit tests for the popular-extension catalog (registry mocked for listing)."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from cli_agent_orchestrator.services.tooling import catalog
from cli_agent_orchestrator.services.tooling.adapters.base import AdapterEnv, ProviderCapabilities


class FakeAdapter:
    def __init__(self, *, installed=True, can_install=True, names=(), reason=None):
        self._installed = installed
        self._can_install = can_install
        self._names = list(names)
        self._reason = reason

    def detect(self):
        return AdapterEnv(self._installed, "/bin/x" if self._installed else None, None)

    def capabilities(self):
        return ProviderCapabilities(
            canList=True,
            canSearch=False,
            canInstall=self._can_install,
            canRemove=True,
            canUpdate=False,
            canUpdateAll=False,
            requiresNewSession=True,
            requiresRestart=False,
            reasons={"canInstall": self._reason} if self._reason else {},
        )

    def list_installed(self):
        return [{"name": n, "raw": n} for n in self._names]


def _patch_registry(monkeypatch, mapping):
    monkeypatch.setattr(catalog.registry, "get_adapter", lambda p: mapping.get(p))


# --- schema ---------------------------------------------------------------


def test_every_item_has_required_fields():
    for item in catalog._ITEMS:
        assert item.id and item.name and item.description_ko
        assert item.kind in {"mcp", "plugin", "skill", "cli"}
        assert item.providers and item.install
        assert set(item.install) == set(item.providers)
        for spec in item.install.values():
            assert spec.method in {"mcp", "skill", "manual"}
            assert isinstance(spec.argv, tuple)


def test_ids_unique_and_lookup():
    ids = [it.id for it in catalog._ITEMS]
    assert len(ids) == len(set(ids))
    assert catalog.get_item("context7") is not None
    assert catalog.get_item("nope") is None


def test_catalog_has_a_broad_recommended_skill_and_plugin_selection():
    assert len(catalog._ITEMS) >= 30
    ids = {item.id for item in catalog._ITEMS}
    assert {"frontend-design", "webapp-testing", "mcp-builder", "computer-use"} <= ids
    assert {
        "claude-plugin-linear",
        "claude-plugin-notion",
        "claude-plugin-figma",
        "claude-plugin-sentry",
    } <= ids

    notion = catalog.get_item("claude-plugin-notion")
    assert notion.kind == "plugin"
    assert notion.install["claude_code"].argv == (
        "claude",
        "plugin",
        "install",
        "notion@claude-plugins-official",
    )


def test_mcp_and_skill_provider_split():
    ctx = catalog.get_item("context7")
    assert ctx.providers == ("claude_code", "codex")
    docx = catalog.get_item("docx")
    assert docx.providers == ("generic_skills",)
    assert docx.install["generic_skills"].method == "skill"


def test_github_carries_env_warning():
    gh = catalog.get_item("github")
    assert any("GITHUB_PERSONAL_ACCESS_TOKEN" in w for w in gh.warnings)


def test_generic_skills_cli_bootstrap_item():
    """The generic 'skills' CLI is a manual, kind='cli' bootstrap entry (#9)."""
    cli = catalog.get_item("generic-skills-cli")
    assert cli is not None
    assert cli.kind == "cli"
    assert cli.providers == ("generic_skills",)
    spec = cli.install["generic_skills"]
    assert spec.method == "manual"
    assert spec.argv == ("npm", "install", "-g", "skills")
    assert cli.homepage == "https://github.com/vercel-labs/skills"
    assert any("전역" in w for w in cli.warnings)
    assert cli.manual_reason and "다시 검사" in cli.manual_reason


def test_manual_cli_item_shows_command_even_when_undetected(monkeypatch):
    """A manual bootstrap item must surface its copyable command + reason even
    when its CLI is absent — that is exactly when the user needs it (#9). This
    guards the ordering: manual is handled before the 'not detected' return."""
    _patch_registry(monkeypatch, {"generic_skills": FakeAdapter(installed=False)})
    cli = next(it for it in catalog.list_catalog() if it["id"] == "generic-skills-cli")
    entry = cli["supported"]["generic_skills"]
    assert entry["supported"] is False
    assert entry["install_status"] == "not_installed"
    assert entry["command"] == "npm install -g skills"
    assert (
        entry["reason"] == "자동 설치는 지원하지 않아요 — 명령을 복사해 실행한 뒤 다시 검사하세요"
    )


def test_manual_cli_item_reports_installed_when_detected(monkeypatch):
    """When the skills CLI binary is detected, the bootstrap entry reports
    installed (detection-based, since there is no inventory to look it up in)."""
    _patch_registry(monkeypatch, {"generic_skills": FakeAdapter(installed=True)})
    cli = next(it for it in catalog.list_catalog() if it["id"] == "generic-skills-cli")
    entry = cli["supported"]["generic_skills"]
    assert entry["install_status"] == "installed"
    assert entry["command"] == "npm install -g skills"


# --- resolve_install ------------------------------------------------------


def test_resolve_mcp_tokens():
    r = catalog.resolve_install("context7", "claude_code", None)
    assert r.method == "mcp"
    assert r.name == "context7"
    assert r.command_tokens == ["npx", "-y", "@upstash/context7-mcp"]


def test_resolve_filesystem_appends_home_path():
    home = str(Path.home())
    r = catalog.resolve_install("filesystem", "codex", {"path": home})
    assert r.command_tokens[-1] == home
    assert r.command_tokens[:3] == ["npx", "-y", "@modelcontextprotocol/server-filesystem"]


@pytest.mark.parametrize("bad", ["/etc", "/", None, "", "   "])
def test_resolve_filesystem_rejects_bad_path(bad):
    params = {"path": bad} if bad is not None else None
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_install("filesystem", "claude_code", params)


def test_resolve_unknown_item():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_install("nope", "claude_code", None)


def test_resolve_unsupported_provider():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_install("context7", "generic_skills", None)
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_install("docx", "codex", None)


def test_resolve_skill():
    r = catalog.resolve_install("docx", "generic_skills", None)
    assert r.method == "skill"
    assert r.name == "docx"
    assert r.command_tokens == ["anthropics/skills", "docx"]


# --- list_catalog ---------------------------------------------------------


def test_list_catalog_supported_and_status(monkeypatch):
    _patch_registry(
        monkeypatch,
        {
            "claude_code": FakeAdapter(names=["context7"]),  # context7 already installed
            "codex": FakeAdapter(names=[]),
            "generic_skills": FakeAdapter(installed=False),
        },
    )
    items = {it["id"]: it for it in catalog.list_catalog()}

    ctx = items["context7"]
    assert ctx["supported"]["claude_code"]["supported"] is True
    assert ctx["supported"]["claude_code"]["install_status"] == "installed"
    assert ctx["supported"]["codex"]["install_status"] == "not_installed"
    # static argv fragment is exposed for the UI
    assert ctx["install"]["claude_code"]["argv"] == ["npx", "-y", "@upstash/context7-mcp"]

    docx = items["docx"]
    assert docx["supported"]["generic_skills"]["supported"] is False
    assert docx["supported"]["generic_skills"]["install_status"] == "unknown"
    assert "감지" in docx["supported"]["generic_skills"]["reason"]


def test_list_catalog_capability_disabled_reason(monkeypatch):
    _patch_registry(
        monkeypatch,
        {
            "claude_code": FakeAdapter(can_install=False, reason="MCP add 없음"),
            "codex": FakeAdapter(),
            "generic_skills": FakeAdapter(installed=False),
        },
    )
    ctx = next(it for it in catalog.list_catalog() if it["id"] == "context7")
    assert ctx["supported"]["claude_code"]["supported"] is False
    assert ctx["supported"]["claude_code"]["reason"] == "MCP add 없음"


def test_list_catalog_filesystem_requires_params(monkeypatch):
    _patch_registry(
        monkeypatch,
        {"claude_code": FakeAdapter(), "codex": FakeAdapter(), "generic_skills": FakeAdapter()},
    )
    fs = next(it for it in catalog.list_catalog() if it["id"] == "filesystem")
    assert fs["supported"]["claude_code"]["requires_params"] == ["path"]


def test_list_catalog_caches_provider_snapshot(monkeypatch):
    """A cached list_catalog() does not re-detect providers; use_cache=False does."""
    adapter = FakeAdapter(names=["context7"])
    detect_spy = MagicMock(wraps=adapter.detect)
    monkeypatch.setattr(adapter, "detect", detect_spy)
    referenced = {provider for item in catalog._ITEMS for provider in item.providers}
    _patch_registry(monkeypatch, {provider: adapter for provider in referenced})

    catalog.list_catalog()  # populates the cache
    calls_after_first = detect_spy.call_count
    assert calls_after_first == len(referenced)

    catalog.list_catalog()  # cache hit -> no new detect() calls
    assert detect_spy.call_count == calls_after_first

    catalog.list_catalog(use_cache=False)  # forced refresh re-detects
    assert detect_spy.call_count == calls_after_first * 2
