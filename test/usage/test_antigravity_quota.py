import json
from datetime import datetime, timezone
from pathlib import Path

from cli_agent_orchestrator.services.usage import antigravity_quota


def _write_cache(home: Path, models: dict) -> None:
    d = home / ".antigravity"
    d.mkdir(parents=True, exist_ok=True)
    (d / "quota-cache.json").write_text(json.dumps({
        "models": models,
        "scope": {"email": "secret@example.com", "plan_tier": "Pro"},
        "source": "local_language_server",
        "timestamp": 1784689473.0,
    }), encoding="utf-8")


def test_absent_when_no_cache(tmp_path):
    acc = antigravity_quota.aggregate(tmp_path, datetime.now(timezone.utc))
    assert acc["provider"] == "antigravity_cli"
    assert acc["present"] is False
    assert acc["rate_limits"] is None


def test_builds_used_percent_from_remaining(tmp_path):
    _write_cache(tmp_path, {
        "gemini36flashhigh": {"name": "Gemini 3.6 Flash (High)", "remaining_percentage": 40.0,
                               "reset_time": "2026-07-22T08:00:00Z", "refreshes_in": "5h", "source": "x"},
        "gemini31prohigh": {"name": "Gemini 3.1 Pro (High)", "remaining_percentage": 90.0,
                             "reset_time": "2026-07-22T08:00:00Z", "refreshes_in": "5h", "source": "x"},
    })
    acc = antigravity_quota.aggregate(tmp_path, datetime.now(timezone.utc))
    assert acc["present"] is True
    assert acc["provider"] == "antigravity_cli"
    rl = acc["rate_limits"]
    assert rl is not None
    # 대표 window = 잔여 최저(가장 많이 쓴) 모델 → used_percent = 100 - 40 = 60
    assert abs(rl["primary"]["used_percent"] - 60.0) < 0.01
    assert rl["primary"]["resets_at"] > 0
    # PII 미노출
    assert "email" not in json.dumps(acc)


def test_today_week_none_no_token_buckets(tmp_path):
    _write_cache(tmp_path, {"gemini35flashhigh": {"name": "Gemini 3.5 Flash (High)",
                            "remaining_percentage": 100.0, "reset_time": "2026-07-22T08:00:00Z",
                            "refreshes_in": "5h", "source": "x"}})
    acc = antigravity_quota.aggregate(tmp_path, datetime.now(timezone.utc))
    assert acc["today"] is None and acc["week"] is None
