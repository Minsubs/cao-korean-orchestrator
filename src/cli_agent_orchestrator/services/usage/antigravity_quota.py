"""Antigravity usage from ~/.antigravity/quota-cache.json.

The cache lists per-model ``remaining_percentage`` (100 - used%) + ``reset_time``
(ISO). Antigravity has no rate-limit *window* like Claude's 5h/7d, so we derive a
single representative window from the most-consumed model (lowest remaining).
PII in the cache (scope.email/plan_tier) is never read into the account.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

_CACHE_REL = ".antigravity/quota-cache.json"
_DEFAULT_WINDOW_MINUTES = 300  # antigravity quotas refresh on a ~5h cadence


def _absent(note: str) -> Dict[str, Any]:
    return {
        "provider": "antigravity_cli", "present": False, "source": "quota-cache",
        "today": None, "week": None, "by_model_today": [], "rate_limits": None,
        "last_activity": None, "note": note,
    }


def _reset_to_epoch(reset_time: str) -> Optional[int]:
    try:
        return int(datetime.fromisoformat(reset_time.replace("Z", "+00:00")).timestamp())
    except (ValueError, AttributeError):
        return None


def aggregate(home: Path, now: datetime) -> Dict[str, Any]:
    path = home / _CACHE_REL
    if not path.exists():
        return _absent(f"파일이 없습니다: ~/{_CACHE_REL}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _absent("quota-cache.json을 읽지 못했어요")
    models = data.get("models") or {}
    entries = [m for m in models.values() if isinstance(m, dict) and isinstance(m.get("remaining_percentage"), (int, float))]
    if not entries:
        return _absent("사용량 정보가 아직 없어요")
    worst = min(entries, key=lambda m: m["remaining_percentage"])
    resets_at = _reset_to_epoch(str(worst.get("reset_time", "")))
    primary = {
        "used_percent": max(0.0, min(100.0, 100.0 - float(worst["remaining_percentage"]))),
        "window_minutes": _DEFAULT_WINDOW_MINUTES,
        "resets_at": resets_at if resets_at is not None else 0,
    }
    by_model = [{"model": m.get("name", "?"), "total": 0} for m in entries][:5]
    return {
        "provider": "antigravity_cli", "present": True, "source": "quota-cache",
        "today": None, "week": None, "by_model_today": by_model,
        "rate_limits": {"plan": None, "primary": primary, "secondary": None,
                         "captured_at": now.astimezone().isoformat()},
        "last_activity": None,
        "note": "모델별 남은 한도 기준이에요 (토큰 사용량은 제공되지 않아요).",
    }
