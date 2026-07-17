"""Claude Code transcript usage aggregation.

Reads ``~/.claude/projects/**/*.jsonl`` transcripts and sums the **real** token
counts Claude Code records on each ``assistant`` event. Nothing is estimated and
no cost is derived — only the token fields the CLI itself wrote.

Line rules (streaming, per file):
    * A line without the ``"usage"`` substring is skipped before ``json.loads``
      (the transcripts can be tens of MB; this keeps the hot loop cheap).
    * A line whose JSON fails to parse is skipped and counted as a corrupt line
      (surfaced under ``diagnostics`` only — never raised).
    * A usage record is deduplicated by ``(message.id, requestId)``: Claude Code
      writes the same assistant response across several streaming lines, so the
      pair is counted once. ``requestId`` sits at the line top level; when it is
      absent the dedup falls back to ``message.id`` alone. Records with no
      ``message.id`` are not deduplicated (kept as-is).

Bucketing is by the event's local calendar date (top-level ``timestamp``, ISO
8601, UTC ``Z``): ``today`` is the current local date and ``week`` is the last
seven calendar days (today plus the six preceding). Because a recently-modified
file can still hold week-old events, the per-file cache stores a date-keyed
breakdown rather than pre-bucketed totals, so it stays valid across midnight.

Performance:
    * Only files whose mtime is within ``_MTIME_WINDOW_DAYS`` are scanned.
    * At most ``_MAX_FILES`` files (newest mtime first); the overflow count is
      surfaced so the router can note "some files omitted".
    * A per-file memo keyed by ``(path, mtime, size)`` avoids re-parsing an
      unchanged transcript on the next scan.
"""

from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_MTIME_WINDOW_DAYS = 8
_MAX_FILES = 400

_TOKEN_KEYS = ("input", "output", "cache_read", "cache_creation")

_NOTE = "로컬 트랜스크립트 합산 추정치 — CLI 자체 집계와 다를 수 있어요"

# Per-file memo: str(path) -> (mtime, size, parsed). Guarded by a lock because
# the aggregation may run under concurrent requests.
_MEMO: Dict[str, Tuple[float, int, "_ParsedFile"]] = {}
_MEMO_LOCK = threading.Lock()


class _ParsedFile:
    """Date-keyed usage breakdown for a single transcript file.

    ``daily`` maps a local date to the summed token fields for that date;
    ``daily_by_model`` maps a local date to per-model total-token sums (used for
    the today-only top-models list). ``corrupt_lines`` and ``newest`` are
    diagnostics/activity metadata.
    """

    __slots__ = ("daily", "daily_by_model", "corrupt_lines", "newest")

    def __init__(
        self,
        daily: Dict[date, Dict[str, int]],
        daily_by_model: Dict[date, Dict[str, int]],
        corrupt_lines: int,
        newest: Optional[datetime],
    ) -> None:
        self.daily = daily
        self.daily_by_model = daily_by_model
        self.corrupt_lines = corrupt_lines
        self.newest = newest


def _blank_bucket() -> Dict[str, int]:
    return {key: 0 for key in _TOKEN_KEYS}


def _local_date(ts: Any) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp to an aware datetime, or None."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _parse_file(path: Path) -> _ParsedFile:
    """Stream a transcript and build its date-keyed usage breakdown."""
    daily: Dict[date, Dict[str, int]] = {}
    daily_by_model: Dict[date, Dict[str, int]] = {}
    seen: set[Tuple[Any, Any]] = set()
    corrupt = 0
    newest: Optional[datetime] = None

    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return _ParsedFile(daily, daily_by_model, corrupt, newest)

    with handle:
        for line in handle:
            if '"usage"' not in line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                corrupt += 1
                continue
            if not isinstance(record, dict):
                continue
            message = record.get("message")
            if not isinstance(message, dict):
                continue
            usage = message.get("usage")
            if not isinstance(usage, dict):
                continue

            msg_id = message.get("id")
            if msg_id is not None:
                key = (msg_id, record.get("requestId"))
                if key in seen:
                    continue
                seen.add(key)

            moment = _local_date(record.get("timestamp"))
            if moment is None:
                continue
            if newest is None or moment > newest:
                newest = moment
            day = moment.astimezone().date()

            inp = _as_int(usage.get("input_tokens"))
            out = _as_int(usage.get("output_tokens"))
            cache_read = _as_int(usage.get("cache_read_input_tokens"))
            cache_creation = _as_int(usage.get("cache_creation_input_tokens"))

            bucket = daily.setdefault(day, _blank_bucket())
            bucket["input"] += inp
            bucket["output"] += out
            bucket["cache_read"] += cache_read
            bucket["cache_creation"] += cache_creation

            total = inp + out + cache_read + cache_creation
            if total > 0:
                model = message.get("model")
                model_name = model if isinstance(model, str) and model else "unknown"
                by_model = daily_by_model.setdefault(day, {})
                by_model[model_name] = by_model.get(model_name, 0) + total

    return _ParsedFile(daily, daily_by_model, corrupt, newest)


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def _get_parsed(path: Path, mtime: float, size: int) -> _ParsedFile:
    """Return the parsed breakdown for ``path``, reusing the memo when unchanged."""
    key = str(path)
    with _MEMO_LOCK:
        cached = _MEMO.get(key)
        if cached is not None and cached[0] == mtime and cached[1] == size:
            return cached[2]
    parsed = _parse_file(path)
    with _MEMO_LOCK:
        _MEMO[key] = (mtime, size, parsed)
    return parsed


def _discover(root: Path, now: datetime) -> Tuple[List[Tuple[float, int, Path]], int]:
    """Return (selected newest-first, omitted_count) for recent transcripts."""
    cutoff = now.timestamp() - _MTIME_WINDOW_DAYS * 86400
    entries: List[Tuple[float, int, Path]] = []
    for candidate in root.rglob("*.jsonl"):
        try:
            stat = candidate.stat()
        except OSError:
            continue
        if stat.st_mtime < cutoff:
            continue
        entries.append((stat.st_mtime, stat.st_size, candidate))
    entries.sort(key=lambda item: item[0], reverse=True)
    omitted = 0
    if len(entries) > _MAX_FILES:
        omitted = len(entries) - _MAX_FILES
        entries = entries[:_MAX_FILES]
    return entries, omitted


def _with_total(bucket: Dict[str, int]) -> Dict[str, int]:
    """Attach ``total`` = sum of the four token fields (Claude semantics)."""
    return {
        "input": bucket["input"],
        "output": bucket["output"],
        "cache_read": bucket["cache_read"],
        "cache_creation": bucket["cache_creation"],
        "total": sum(bucket[key] for key in _TOKEN_KEYS),
    }


def _add(target: Dict[str, int], source: Dict[str, int]) -> None:
    for key in _TOKEN_KEYS:
        target[key] += source[key]


def _absent(root: Path) -> Dict[str, Any]:
    return {
        "provider": "claude_code",
        "present": False,
        "source": "transcripts",
        "today": None,
        "week": None,
        "by_model_today": [],
        "rate_limits": None,
        "last_activity": None,
        "note": f"트랜스크립트 디렉터리가 없습니다: {root}",
        "diagnostics": {"files_scanned": 0, "files_omitted": 0, "corrupt_lines": 0},
    }


def aggregate(home: Path, now: datetime) -> Dict[str, Any]:
    """Aggregate Claude Code transcript usage into one account entry."""
    root = home / ".claude" / "projects"
    if not root.is_dir():
        return _absent(root)

    entries, omitted = _discover(root, now)
    today = now.astimezone().date()
    week_start = today - timedelta(days=6)

    today_bucket = _blank_bucket()
    week_bucket = _blank_bucket()
    by_model_today: Dict[str, int] = {}
    corrupt_total = 0
    last_activity: Optional[datetime] = None

    for mtime, size, path in entries:
        parsed = _get_parsed(path, mtime, size)
        corrupt_total += parsed.corrupt_lines
        if parsed.newest is not None and (last_activity is None or parsed.newest > last_activity):
            last_activity = parsed.newest
        for day, bucket in parsed.daily.items():
            if day == today:
                _add(today_bucket, bucket)
            if day >= week_start:
                _add(week_bucket, bucket)
        today_models = parsed.daily_by_model.get(today)
        if today_models:
            for model_name, total in today_models.items():
                by_model_today[model_name] = by_model_today.get(model_name, 0) + total

    ranked = sorted(by_model_today.items(), key=lambda item: item[1], reverse=True)[:5]
    note = _NOTE
    if omitted:
        note = f"{note} · 일부 파일 생략({omitted}개, 최신 {_MAX_FILES}개만 스캔)"

    return {
        "provider": "claude_code",
        "present": True,
        "source": "transcripts",
        "today": _with_total(today_bucket),
        "week": _with_total(week_bucket),
        "by_model_today": [{"model": name, "total": total} for name, total in ranked],
        "rate_limits": None,
        "last_activity": last_activity.astimezone().isoformat() if last_activity else None,
        "note": note,
        "diagnostics": {
            "files_scanned": len(entries),
            "files_omitted": omitted,
            "corrupt_lines": corrupt_total,
        },
    }


def reset_memo() -> None:
    """Clear the per-file memo (tests only)."""
    with _MEMO_LOCK:
        _MEMO.clear()
