"""Unit tests for provider install-status and version probing."""

from unittest.mock import MagicMock

from cli_agent_orchestrator.models.provider import ProviderType
from cli_agent_orchestrator.services.tooling import probe, providers


def test_list_covers_every_provider_type(monkeypatch):
    """The list is derived from ProviderType (not hardcoded)."""
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: None)
    result = providers.list_providers(use_cache=False)

    assert {p["name"] for p in result} == {p.value for p in ProviderType}
    for provider in result:
        assert provider["installed"] is False
        assert provider["path"] is None
        assert provider["version"] is None
        assert provider["version_error"] is None  # probe skipped when missing


def test_not_installed_skips_probe(monkeypatch):
    """No version probe runs for a missing binary."""
    run_spy = MagicMock()
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: None)
    monkeypatch.setattr(providers.probe, "run", run_spy)

    providers.list_providers(use_cache=False)

    run_spy.assert_not_called()


def test_installed_parses_version(monkeypatch):
    """A normal ``<tool> <semver>`` banner parses cleanly."""
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: f"/usr/bin/{binary}")
    monkeypatch.setattr(
        providers.probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(0, "claude 2.1.211 (build 5)\n", "", False),
    )

    result = providers.list_providers(use_cache=False)
    claude = next(p for p in result if p["name"] == ProviderType.CLAUDE_CODE.value)

    assert claude["installed"] is True
    assert claude["path"] == "/usr/bin/claude"
    assert claude["version"] == "2.1.211"
    assert claude["version_raw"] == "claude 2.1.211 (build 5)"
    assert claude["version_error"] is None


def test_installed_unparseable_output_sets_error(monkeypatch):
    """Output with no numeric token -> version None, raw preserved, error set."""
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: f"/usr/bin/{binary}")
    monkeypatch.setattr(
        providers.probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(0, "no version here\n", "", False),
    )

    sample = providers.list_providers(use_cache=False)[0]

    assert sample["version"] is None
    assert sample["version_raw"] == "no version here"
    assert "could not parse" in sample["version_error"]


def test_installed_timeout_sets_error(monkeypatch):
    """A probe timeout surfaces as a version_error, not a crash."""
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: f"/usr/bin/{binary}")
    monkeypatch.setattr(
        providers.probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(None, "", "", True),
    )

    sample = providers.list_providers(use_cache=False)[0]

    assert sample["version"] is None
    assert "timed out" in sample["version_error"]


def test_cache_avoids_reprobe_until_forced(monkeypatch):
    """A cached read does not re-probe; use_cache=False forces a refresh."""
    run_spy = MagicMock(return_value=probe.ProbeResult(0, "tool 1.0\n", "", False))
    monkeypatch.setattr(providers.cache, "cached_which", lambda binary: f"/usr/bin/{binary}")
    monkeypatch.setattr(providers.probe, "run", run_spy)

    first = providers.list_providers()  # populates the cache
    probes_after_first = run_spy.call_count
    assert probes_after_first == len(list(ProviderType))

    second = providers.list_providers()  # cache hit -> no new probes
    assert run_spy.call_count == probes_after_first
    assert first == second

    providers.list_providers(use_cache=False)  # forced refresh re-probes
    assert run_spy.call_count == probes_after_first * 2
