"""Unit tests for the model catalog (agy probe + known constants)."""

from cli_agent_orchestrator.services.tooling import models, probe


def _by_provider(entries):
    return {e["provider"]: e for e in entries}


# --- known models (claude_code / codex) ----------------------------------


def test_known_models_present_with_allow_custom(monkeypatch):
    monkeypatch.setattr(models.shutil, "which", lambda _b: None)  # agy absent
    entries = _by_provider(models.list_models())

    claude = entries["claude_code"]
    assert claude["source"] == "known"
    assert claude["allow_custom"] is True
    assert [m["name"] for m in claude["models"]] == ["opus", "sonnet", "haiku", "fable"]
    assert "직접 입력" in claude["note"]

    codex = entries["codex"]
    assert codex["source"] == "known"
    assert codex["allow_custom"] is True
    assert codex["models"]  # non-empty curated list


def test_codex_known_models_are_current_not_stale():
    codex = next(m for m in models.list_models() if m["provider"] == "codex")
    names = {m["name"] for m in codex["models"]}
    assert "gpt-5.6-sol" in names
    assert names.isdisjoint({"gpt-5-codex", "gpt-5", "o3"})  # stale aliases gone
    assert codex["allow_custom"] is True


def test_known_note_flags_alias_and_points_to_cli_docs(monkeypatch):
    """The known-models note must flag the list as aliases and point users to
    the CLI docs for the authoritative set (#7)."""
    monkeypatch.setattr(models.shutil, "which", lambda _b: None)
    note = _by_provider(models.list_models())["claude_code"]["note"]
    assert "별칭" in note
    assert "CLI 문서" in note
    assert "직접 입력" in note


# --- antigravity (probe) --------------------------------------------------


def test_antigravity_not_installed_errors(monkeypatch):
    monkeypatch.setattr(models.shutil, "which", lambda _b: None)
    agy = _by_provider(models.list_models())["antigravity_cli"]
    assert agy["source"] == "probe"
    assert agy["models"] == []
    assert agy["error"] and "감지" in agy["error"]


def test_antigravity_parses_model_lines(monkeypatch):
    monkeypatch.setattr(models.shutil, "which", lambda _b: "/usr/local/bin/agy")
    monkeypatch.setattr(
        probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(0, "gemini-2.5-pro\ngemini-2.5-flash\n", "", False),
    )
    agy = _by_provider(models.list_models())["antigravity_cli"]
    assert agy["error"] is None
    assert [m["name"] for m in agy["models"]] == ["gemini-2.5-pro", "gemini-2.5-flash"]


def test_antigravity_signin_error_is_friendly_login_hint(monkeypatch):
    """A sign-in failure is surfaced as an actionable Korean login hint, not the
    raw CLI line (#7). Detection keys off auth signals in the output, so this is
    a mapping of a real condition — not a guess applied to every non-zero exit."""
    monkeypatch.setattr(models.shutil, "which", lambda _b: "/usr/local/bin/agy")
    monkeypatch.setattr(
        probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(
            1, "Error: Please sign in to view models.", "", False
        ),
    )
    agy = _by_provider(models.list_models())["antigravity_cli"]
    assert agy["models"] == []
    assert agy["error"] == "agy 로그인이 필요해요 — 터미널에서 agy 실행 후 로그인하세요"


def test_antigravity_non_auth_error_keeps_raw_line(monkeypatch):
    """A non-auth non-zero exit is NOT mislabelled as a login problem — the raw
    (masked) CLI line is preserved."""
    monkeypatch.setattr(models.shutil, "which", lambda _b: "/usr/local/bin/agy")
    monkeypatch.setattr(
        probe,
        "run",
        lambda argv, timeout: probe.ProbeResult(1, "Error: network unreachable", "", False),
    )
    agy = _by_provider(models.list_models())["antigravity_cli"]
    assert agy["models"] == []
    assert "로그인" not in agy["error"]
    assert "network unreachable" in agy["error"]


def test_antigravity_timeout_errors(monkeypatch):
    monkeypatch.setattr(models.shutil, "which", lambda _b: "/usr/local/bin/agy")
    monkeypatch.setattr(probe, "run", lambda argv, timeout: probe.ProbeResult(None, "", "", True))
    agy = _by_provider(models.list_models())["antigravity_cli"]
    assert agy["models"] == []
    assert agy["error"]


def test_parse_agy_models_masks_and_keeps_raw():
    parsed = models._parse_agy_models("model-a  (default)\n\ntoken=SECRET leaked\n")
    names = [m["name"] for m in parsed]
    assert "model-a" in names
    # a secret-shaped token in output is masked before storage
    assert all("SECRET" not in m["raw"] for m in parsed)
    assert any("token=***" in m["raw"] for m in parsed)


def test_parses_agy_hyphenated_3_6_model_ids():
    parsed = models._parse_agy_models(
        "gemini-3.6-flash-high\ngemini-3.5-flash-high\ngemini-3.1-pro-high\n"
    )
    names = [m["name"] for m in parsed]
    assert "gemini-3.6-flash-high" in names
