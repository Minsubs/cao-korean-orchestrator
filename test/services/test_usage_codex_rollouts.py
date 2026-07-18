import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cli_agent_orchestrator.services.usage import codex_rollouts


def _token_event(timestamp: str, total: int, used_percent: float) -> dict:
    return {
        "timestamp": timestamp,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": total - 10,
                    "cached_input_tokens": 5,
                    "output_tokens": 10,
                    "reasoning_output_tokens": 0,
                    "total_tokens": total,
                }
            },
            "rate_limits": {
                "limit_id": "codex",
                "primary": {
                    "used_percent": used_percent,
                    "window_minutes": 10080,
                    "resets_at": 1784780187,
                },
                "secondary": None,
                "plan_type": "prolite",
            },
        },
    }


def _write_rollout(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(record) for record in records), encoding="utf-8")


def test_aggregate_uses_last_session_total_and_latest_rate_snapshot(tmp_path: Path) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    first = tmp_path / ".codex" / "sessions" / "2026" / "07" / "17" / "rollout-first.jsonl"
    second = tmp_path / ".codex" / "sessions" / "2026" / "07" / "16" / "rollout-second.jsonl"
    future = tmp_path / ".codex" / "sessions" / "2026" / "07" / "18" / "rollout-future.jsonl"
    _write_rollout(
        first,
        [
            _token_event("2026-07-17T10:00:00Z", 50, 10.0),
            _token_event("2026-07-17T11:00:00Z", 80, 27.0),
        ],
    )
    _write_rollout(second, [_token_event("2026-07-16T09:00:00Z", 20, 9.0)])
    future_event = _token_event((now + timedelta(days=1)).isoformat(), 99, 1.0)
    del future_event["payload"]["rate_limits"]
    _write_rollout(future, [future_event])
    os.utime(first, (now.timestamp(), now.timestamp()))
    os.utime(second, (now.timestamp() - 60, now.timestamp() - 60))
    os.utime(future, (now.timestamp() - 120, now.timestamp() - 120))
    codex_rollouts.reset_memo()

    result = codex_rollouts.aggregate(tmp_path, now)

    assert result["today"]["total"] == 80
    assert result["week"]["total"] == 100
    assert result["rate_limits"]["plan"] == "prolite"
    assert result["rate_limits"]["primary"]["used_percent"] == 27.0


def test_aggregate_reports_absent_rollout_directory(tmp_path: Path) -> None:
    result = codex_rollouts.aggregate(tmp_path, datetime.now(timezone.utc))

    assert result["present"] is False
    assert result["week"] is None
    assert ".codex/sessions" in result["note"]


def test_aggregate_reuses_unchanged_file_memo(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    rollout = tmp_path / ".codex" / "sessions" / "2026" / "07" / "17" / "rollout-one.jsonl"
    _write_rollout(rollout, [_token_event(now.isoformat(), 50, 10.0)])
    os.utime(rollout, (now.timestamp(), now.timestamp()))
    codex_rollouts.reset_memo()
    original_parse = codex_rollouts._parse_file
    calls = 0

    def counted_parse(path: Path):
        nonlocal calls
        calls += 1
        return original_parse(path)

    monkeypatch.setattr(codex_rollouts, "_parse_file", counted_parse)

    codex_rollouts.aggregate(tmp_path, now)
    codex_rollouts.aggregate(tmp_path, now)

    assert calls == 1


def test_aggregate_caps_scan_and_discloses_omitted_files(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    root = tmp_path / ".codex" / "sessions" / "2026" / "07" / "17"
    for index in range(2):
        rollout = root / f"rollout-{index}.jsonl"
        _write_rollout(rollout, [_token_event(now.isoformat(), 50 + index, 10.0)])
        timestamp = now.timestamp() - index
        os.utime(rollout, (timestamp, timestamp))
    monkeypatch.setattr(codex_rollouts, "_MAX_FILES", 1)
    codex_rollouts.reset_memo()

    result = codex_rollouts.aggregate(tmp_path, now)

    assert result["diagnostics"]["files_scanned"] == 1
    assert result["diagnostics"]["files_omitted"] == 1
    assert "일부 파일 생략" in result["note"]
