import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cli_agent_orchestrator.services.usage import claude_transcripts


def _write_lines(path: Path, records: list[dict | str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(record if isinstance(record, str) else json.dumps(record) for record in records),
        encoding="utf-8",
    )


def _assistant_event(
    timestamp: str,
    message_id: str,
    request_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> dict:
    return {
        "timestamp": timestamp,
        "requestId": request_id,
        "message": {
            "id": message_id,
            "model": model,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": 3,
                "cache_creation_input_tokens": 4,
            },
        },
    }


def test_aggregate_deduplicates_and_buckets_real_transcript_usage(tmp_path: Path) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    transcript = tmp_path / ".claude" / "projects" / "p" / "session.jsonl"
    event = _assistant_event(now.isoformat(), "msg-1", "req-1", "claude-sonnet", 10, 20)
    old = _assistant_event(
        (now - timedelta(days=7)).isoformat(),
        "msg-old",
        "req-old",
        "claude-opus",
        100,
        200,
    )
    future = _assistant_event(
        (now + timedelta(days=1)).isoformat(),
        "msg-future",
        "req-future",
        "claude-opus",
        500,
        600,
    )
    _write_lines(transcript, [event, event, old, future, '{"usage": broken'])
    os.utime(transcript, (now.timestamp(), now.timestamp()))
    claude_transcripts.reset_memo()

    result = claude_transcripts.aggregate(tmp_path, now)

    assert result["today"] == {
        "input": 10,
        "output": 20,
        "cache_read": 3,
        "cache_creation": 4,
        "total": 37,
    }
    assert result["week"] == result["today"]
    assert result["by_model_today"] == [{"model": "claude-sonnet", "total": 37}]
    assert result["diagnostics"]["corrupt_lines"] == 1


def test_aggregate_reports_absent_transcript_directory(tmp_path: Path) -> None:
    result = claude_transcripts.aggregate(tmp_path, datetime.now(timezone.utc))

    assert result["present"] is False
    assert result["today"] is None
    assert ".claude/projects" in result["note"]


def test_aggregate_reuses_unchanged_file_memo(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    transcript = tmp_path / ".claude" / "projects" / "p" / "session.jsonl"
    _write_lines(
        transcript,
        [_assistant_event(now.isoformat(), "msg-1", "req-1", "claude-sonnet", 1, 2)],
    )
    os.utime(transcript, (now.timestamp(), now.timestamp()))
    claude_transcripts.reset_memo()
    original_parse = claude_transcripts._parse_file
    calls = 0

    def counted_parse(path: Path):
        nonlocal calls
        calls += 1
        return original_parse(path)

    monkeypatch.setattr(claude_transcripts, "_parse_file", counted_parse)

    claude_transcripts.aggregate(tmp_path, now)
    claude_transcripts.aggregate(tmp_path, now)

    assert calls == 1


def test_aggregate_caps_scan_and_discloses_omitted_files(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 7, 17, 12, tzinfo=timezone.utc)
    root = tmp_path / ".claude" / "projects" / "p"
    for index in range(2):
        transcript = root / f"session-{index}.jsonl"
        _write_lines(
            transcript,
            [
                _assistant_event(
                    now.isoformat(), f"msg-{index}", f"req-{index}", "claude-sonnet", 1, 2
                )
            ],
        )
        timestamp = now.timestamp() - index
        os.utime(transcript, (timestamp, timestamp))
    monkeypatch.setattr(claude_transcripts, "_MAX_FILES", 1)
    claude_transcripts.reset_memo()

    result = claude_transcripts.aggregate(tmp_path, now)

    assert result["diagnostics"]["files_scanned"] == 1
    assert result["diagnostics"]["files_omitted"] == 1
    assert "일부 파일 생략" in result["note"]
