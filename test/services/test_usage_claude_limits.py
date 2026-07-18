import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

import requests

from cli_agent_orchestrator.services.usage import claude_limits


def _credentials(token: str, expires_at: datetime, plan: str = "max") -> str:
    return json.dumps(
        {
            "claudeAiOauth": {
                "accessToken": token,
                "refreshToken": "must-never-be-used",
                "expiresAt": int(expires_at.timestamp() * 1000),
            },
            "subscriptionType": plan,
        }
    )


def test_get_limits_prefers_keychain_and_maps_measured_windows(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    token = "secret-access-token"
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials(token, now + timedelta(hours=1)),
    )
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "five_hour": {"utilization": 12.34, "resets_at": "2026-07-17T15:00:00Z"},
        "seven_day": {"utilization": 56.78, "resets_at": "2026-07-20T12:00:00Z"},
    }
    get = Mock(return_value=response)
    monkeypatch.setattr(claude_limits.requests, "get", get)
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is not None
    assert result.rate_limits["primary"]["window_minutes"] == 300
    assert result.rate_limits["secondary"]["window_minutes"] == 10080
    assert result.rate_limits["primary"]["used_percent"] == 12.34
    assert result.rate_limits["plan"] == "max"
    headers = get.call_args.kwargs["headers"]
    assert headers["Authorization"] == f"Bearer {token}"
    assert get.call_args.kwargs["allow_redirects"] is False
    assert token not in result.note
    assert "must-never-be-used" not in repr(result)


def test_get_limits_falls_back_to_credentials_file(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    path = tmp_path / ".claude" / ".credentials.json"
    path.parent.mkdir(parents=True)
    path.write_text(_credentials("file-token", now + timedelta(hours=1)), encoding="utf-8")
    monkeypatch.setattr(claude_limits, "_read_keychain", lambda: None)
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "five_hour": {"utilization": 1.0, "resets_at": 1784780187},
        "seven_day": {"utilization": 2.0, "resets_at": 1784780187},
    }
    get = Mock(return_value=response)
    monkeypatch.setattr(claude_limits.requests, "get", get)
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is not None
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer file-token"


def test_get_limits_skips_network_for_expired_token(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials("expired-token", now - timedelta(seconds=1)),
    )
    get = Mock()
    monkeypatch.setattr(claude_limits.requests, "get", get)
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is None
    assert "토큰이 만료됐어요" in result.note
    get.assert_not_called()


def test_get_limits_returns_honest_note_for_failed_response(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials("network-token", now + timedelta(hours=1)),
    )
    get = Mock(side_effect=requests.RequestException("network-token must stay private"))
    monkeypatch.setattr(claude_limits.requests, "get", get)
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is None
    assert result.note == "Anthropic 사용량 API에 연결할 수 없어요"
    assert "network-token" not in result.note


def test_get_limits_returns_honest_note_for_unrecognized_response(
    tmp_path: Path, monkeypatch
) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials("shape-token", now + timedelta(hours=1)),
    )
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"unexpected": {"utilization": 42}}
    monkeypatch.setattr(claude_limits.requests, "get", Mock(return_value=response))
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is None
    assert result.note == "Anthropic 사용량 응답 형식을 확인할 수 없어요"
    assert "shape-token" not in repr(result)


def test_get_limits_rejects_non_finite_measured_values(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials("finite-token", now + timedelta(hours=1)),
    )
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "five_hour": {"utilization": float("inf"), "resets_at": float("inf")}
    }
    monkeypatch.setattr(claude_limits.requests, "get", Mock(return_value=response))
    claude_limits.reset_cache()

    result = claude_limits.get_limits(tmp_path, now)

    assert result.rate_limits is None
    assert result.note == "Anthropic 사용량 응답 형식을 확인할 수 없어요"


def test_get_limits_does_not_reuse_success_after_credential_expiry(
    tmp_path: Path, monkeypatch
) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    expires_at = now + timedelta(seconds=30)
    monkeypatch.setattr(
        claude_limits,
        "_read_keychain",
        lambda: _credentials("short-token", expires_at),
    )
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"five_hour": {"utilization": 1.0, "resets_at": 1784780187}}
    get = Mock(return_value=response)
    monkeypatch.setattr(claude_limits.requests, "get", get)
    claude_limits.reset_cache()

    first = claude_limits.get_limits(tmp_path, now)
    after_expiry = claude_limits.get_limits(tmp_path, expires_at + timedelta(seconds=1))

    assert first.rate_limits is not None
    assert after_expiry.rate_limits is None
    assert "토큰이 만료됐어요" in after_expiry.note
    get.assert_called_once()
