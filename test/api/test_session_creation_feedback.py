"""Phase 5.5-A feedback coverage for POST /sessions.

Two user-reported issues, both reproduced through the real HTTP boundary with
terminal creation mocked at the tmux/provider seam
(``session_service.create_terminal``), so real ``session_service.create_session``
+ ``resolve_provider`` + ``load_agent_profile`` run against on-disk profiles:

* **#1** — "source=local profiles fail to start a session, cao-installed ones
  work." The backend load/resolve path is correct: it launches the profile's
  frontmatter provider when the client omits ``provider``. The failure is a
  *client value* problem — the web UI forces ``provider=claude_code`` because
  the profile list historically had no ``provider`` field. These tests pin the
  backend behaviour (the contract the fixed frontend consumes) rather than a
  backend bug.
* **#12** — a Korean (non-ASCII) ``session_name`` is rejected. tmux name safety
  requires an ASCII allowlist, so the value stays rejected but now returns an
  actionable 400 instead of a terse ``Invalid session_name: ...``.
"""

from unittest.mock import AsyncMock, patch

import pytest

from cli_agent_orchestrator.models.terminal import Terminal


@pytest.fixture
def local_codex_profile(tmp_path, monkeypatch):
    """A source=local profile authored for codex (provider frontmatter set).

    Only the local store is populated; provider/extra dirs are stubbed empty so
    the lookup is deterministic and isolated from the developer's real HOME.
    """
    store = tmp_path / "agent-store"
    store.mkdir()
    (store / "codex_worker.md").write_text(
        "---\nname: codex_worker\ndescription: 코덱스 워커\nprovider: codex\n"
        "model: gpt-5-codex\n---\nYou are a worker.\n"
    )
    monkeypatch.setattr("cli_agent_orchestrator.utils.agent_profiles.LOCAL_AGENT_STORE_DIR", store)
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.settings_service.get_agent_dirs", lambda: {}
    )
    monkeypatch.setattr(
        "cli_agent_orchestrator.services.settings_service.get_extra_agent_dirs", lambda: []
    )
    return store


def _captured_provider(mock_create_terminal) -> str:
    return mock_create_terminal.call_args.kwargs["provider"]


class TestSessionProviderResolution:
    """#1: what provider does POST /sessions actually launch a local profile under?"""

    def test_explicit_provider_is_used_verbatim(self, client, local_codex_profile):
        """When the client sends provider=claude_code (what the old frontend did
        via `provider || 'claude_code'`), the session launches under claude_code
        — wrong for a codex-authored profile. This reproduces the reported
        symptom and localises it to the client-sent value."""
        with patch(
            "cli_agent_orchestrator.services.session_service.create_terminal",
            new=AsyncMock(
                return_value=Terminal(
                    id="abcd1234",
                    name="w",
                    session_name="cao-s",
                    provider="claude_code",
                    agent_profile="codex_worker",
                )
            ),
        ) as mock_ct:
            response = client.post(
                "/sessions",
                params={"provider": "claude_code", "agent_profile": "codex_worker"},
            )

        assert response.status_code == 201
        assert _captured_provider(mock_ct) == "claude_code"

    def test_omitted_provider_resolves_from_frontmatter(self, client, local_codex_profile):
        """When the client omits provider, session_service resolves it from the
        profile's frontmatter (codex) — the correct behaviour the fixed frontend
        should rely on (send the profile's provider, or omit it). Proves the
        backend load/resolve path is NOT the bug."""
        with patch(
            "cli_agent_orchestrator.services.session_service.create_terminal",
            new=AsyncMock(
                return_value=Terminal(
                    id="abcd1234",
                    name="w",
                    session_name="cao-s",
                    provider="codex",
                    agent_profile="codex_worker",
                )
            ),
        ) as mock_ct:
            response = client.post("/sessions", params={"agent_profile": "codex_worker"})

        assert response.status_code == 201
        assert _captured_provider(mock_ct) == "codex"

    def test_profiles_list_exposes_provider_for_the_client(self, client, local_codex_profile):
        """The #6 contract that lets the frontend send the right provider:
        GET /agents/profiles now carries provider/model per profile."""
        response = client.get("/agents/profiles")
        assert response.status_code == 200
        by_name = {p["name"]: p for p in response.json()}
        worker = by_name["codex_worker"]
        assert worker["source"] == "local"
        assert worker["provider"] == "codex"
        assert worker["model"] == "gpt-5-codex"


class TestSessionNameValidation:
    """#12: Korean/invalid session names return an actionable 400."""

    def test_korean_session_name_returns_actionable_400(self, client):
        with patch("cli_agent_orchestrator.api.main.session_service") as mock_svc:
            response = client.post(
                "/sessions",
                params={"agent_profile": "developer", "session_name": "로그인수정"},
            )

        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "영문" in detail and "한글" in detail
        # Rejected at the boundary — the service is never reached.
        mock_svc.create_session.assert_not_called()

    @pytest.mark.parametrize("bad_name", ["with space", "name!", "trailing.dot", "colon:name"])
    def test_other_invalid_names_rejected_with_same_message(self, client, bad_name):
        with patch("cli_agent_orchestrator.api.main.session_service") as mock_svc:
            response = client.post(
                "/sessions",
                params={"agent_profile": "developer", "session_name": bad_name},
            )

        assert response.status_code == 400
        assert "영문" in response.json()["detail"]
        mock_svc.create_session.assert_not_called()

    def test_valid_session_name_passes_validation(self, client):
        with patch("cli_agent_orchestrator.api.main.session_service") as mock_svc:
            mock_svc.create_session = AsyncMock(
                return_value=Terminal(
                    id="abcd1234",
                    name="w",
                    session_name="cao-login-fix",
                    provider="kiro_cli",
                    agent_profile="developer",
                )
            )
            response = client.post(
                "/sessions",
                params={
                    "provider": "kiro_cli",
                    "agent_profile": "developer",
                    "session_name": "login-fix",
                },
            )

        assert response.status_code == 201
        mock_svc.create_session.assert_called_once()
