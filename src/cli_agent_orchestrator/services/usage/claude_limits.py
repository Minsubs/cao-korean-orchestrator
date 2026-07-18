from __future__ import annotations

import json
import math
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

_CREDENTIAL_SERVICE = "Claude Code-credentials"
_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
_CACHE_TTL_SECONDS = 120.0


@dataclass(frozen=True, slots=True)
class ClaudeLimitLookup:
    rate_limits: Optional[Dict[str, Any]]
    note: str


@dataclass(frozen=True, slots=True)
class _Credential:
    access_token: str
    expires_at: datetime
    plan: Optional[str]


_CACHE: Optional[tuple[float, Optional[datetime], ClaudeLimitLookup]] = None
_CACHE_LOCK = threading.Lock()


def _read_keychain() -> Optional[str]:
    try:
        completed = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", _CREDENTIAL_SERVICE, "-w"],
            capture_output=True,
            check=False,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    return value or None


def _read_credentials_file(home: Path) -> Optional[str]:
    try:
        return (home / ".claude" / ".credentials.json").read_text(encoding="utf-8")
    except OSError:
        return None


def _parse_expiry(value: Any) -> Optional[datetime]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000 if abs(float(value)) >= 1e12 else float(value)
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return None


def _parse_credential(raw: Optional[str]) -> Optional[_Credential]:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    oauth = payload.get("claudeAiOauth")
    if not isinstance(oauth, dict):
        return None
    access_token = oauth.get("accessToken")
    expires_at = _parse_expiry(oauth.get("expiresAt"))
    if not isinstance(access_token, str) or not access_token or expires_at is None:
        return None
    plan_value = payload.get("subscriptionType", oauth.get("subscriptionType"))
    plan = plan_value if isinstance(plan_value, str) and plan_value else None
    return _Credential(access_token=access_token, expires_at=expires_at, plan=plan)


def _load_credential(home: Path) -> Optional[_Credential]:
    keychain = _parse_credential(_read_keychain())
    if keychain is not None:
        return keychain
    return _parse_credential(_read_credentials_file(home))


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def _as_epoch_seconds(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000 if abs(float(value)) >= 1e12 else float(value)
        try:
            return int(seconds)
        except (OverflowError, ValueError):
            return None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    return None


def _map_window(payload: Any, window_minutes: int) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    used_percent = _as_float(payload.get("utilization"))
    resets_at = _as_epoch_seconds(payload.get("resets_at"))
    if used_percent is None or resets_at is None:
        return None
    return {
        "used_percent": used_percent,
        "window_minutes": window_minutes,
        "resets_at": resets_at,
    }


def _request_limits(credential: _Credential, now: datetime) -> ClaudeLimitLookup:
    try:
        response = requests.get(
            _USAGE_URL,
            headers={
                "Authorization": f"Bearer {credential.access_token}",
                "anthropic-beta": "oauth-2025-04-20",
            },
            timeout=10,
            allow_redirects=False,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        return ClaudeLimitLookup(None, "Anthropic 사용량 API에 연결할 수 없어요")
    if not isinstance(payload, dict):
        return ClaudeLimitLookup(None, "Anthropic 사용량 응답 형식을 확인할 수 없어요")
    primary = _map_window(payload.get("five_hour"), 300)
    secondary = _map_window(payload.get("seven_day"), 10080)
    if primary is None and secondary is None:
        return ClaudeLimitLookup(None, "Anthropic 사용량 응답 형식을 확인할 수 없어요")
    return ClaudeLimitLookup(
        {
            "plan": credential.plan,
            "primary": primary,
            "secondary": secondary,
            "captured_at": now.astimezone().isoformat(),
        },
        "Anthropic OAuth 사용량 API 실측",
    )


def get_limits(home: Path, now: datetime) -> ClaudeLimitLookup:
    global _CACHE

    monotonic_now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE
        if cached is not None and monotonic_now - cached[0] < _CACHE_TTL_SECONDS:
            expires_at = cached[1]
            if expires_at is None or expires_at > now.astimezone(timezone.utc):
                return cached[2]

    credential = _load_credential(home)
    if credential is None:
        result = ClaudeLimitLookup(None, "저장된 Claude 로그인 토큰을 찾을 수 없어요")
    elif credential.expires_at <= now.astimezone(timezone.utc):
        result = ClaudeLimitLookup(
            None,
            "토큰이 만료됐어요 — Claude Code를 한 번 실행하면 갱신돼요",
        )
    else:
        result = _request_limits(credential, now)

    with _CACHE_LOCK:
        successful_expiry = (
            credential.expires_at
            if credential is not None and result.rate_limits is not None
            else None
        )
        _CACHE = (monotonic_now, successful_expiry, result)
    return result


def reset_cache() -> None:
    global _CACHE

    with _CACHE_LOCK:
        _CACHE = None
