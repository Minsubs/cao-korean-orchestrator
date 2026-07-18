"""Codex rollout usage aggregation.

Reads ``~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`` rollouts and sums the
**real** token counts Codex records in its ``token_count`` events. Nothing is
estimated and no cost is derived.

Line rules (streaming, per file):
    * A line without the ``"token_count"`` substring is skipped before
      ``json.loads``.
    * A line whose JSON fails to parse is skipped and counted as corrupt.
    * Only a line whose ``payload.type == "token_count"`` is used — other lines
      that merely mention the string (e.g. a message discussing it) are ignored.

Per session file the **last** ``token_count`` event carries the session's
cumulative ``total_token_usage`` (the counter is monotonic and the file is
append-only), so that final event is the session total. Sessions are bucketed by
their **date directory** (``YYYY/MM/DD``, the CLI's own local-date grouping):
``today`` is the current local date, ``week`` the last seven calendar days.

``rate_limits`` is the single most recent ``token_count`` snapshot across all
scanned files, exposed as-is — it is OpenAI's real account limit, so its
``used_percent`` / ``window_minutes`` / ``resets_at`` are passed through
untouched. ``total`` follows Codex semantics: the event's ``total_tokens``, not a
re-sum of the component fields (``cached_input_tokens`` is a subset of
``input_tokens`` there).

Performance mirrors the transcript reader: newest-mtime-first, capped at
``_MAX_FILES``, with a per-file ``(path, mtime, size)`` memo.
"""

from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_MAX_FILES = 400

_TOKEN_KEYS = ("input", "output", "cache_read", "cache_creation", "total")

_NOTE = "codex 롤아웃 세션 누적 합산 — rate_limits는 OpenAI 실측 스냅샷"

_MEMO: Dict[str, Tuple[float, int, "_ParsedFile"]] = {}
_MEMO_LOCK = threading.Lock()


class _ParsedFile:
    """Summary of one rollout: session date, cumulative usage, latest snapshot."""

    __slots__ = ("session_date", "cumulative", "newest", "rate_limits", "corrupt_lines")

    def __init__(
        self,
        session_date: Optional[date],
        cumulative: Optional[Dict[str, Any]],
        newest: Optional[datetime],
        rate_limits: Optional[Dict[str, Any]],
        corrupt_lines: int,
    ) -> None:
        self.session_date = session_date
        self.cumulative = cumulative
        self.newest = newest
        self.rate_limits = rate_limits
        self.corrupt_lines = corrupt_lines


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def _parse_dt(ts: Any) -> Optional[datetime]:
    if not isinstance(ts, str) or not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _session_date(path: Path) -> Optional[date]:
    """Derive the session date from the ``YYYY/MM/DD`` directory, with fallbacks."""
    parts = path.parts
    if len(parts) >= 4:
        try:
            return date(int(parts[-4]), int(parts[-3]), int(parts[-2]))
        except (ValueError, IndexError):
            pass
    # Fallback: the filename embeds ``rollout-YYYY-MM-DDThh-...``.
    stem = path.name
    if stem.startswith("rollout-") and len(stem) >= 18:
        try:
            return date(int(stem[8:12]), int(stem[13:15]), int(stem[16:18]))
        except ValueError:
            pass
    # Last resort: file mtime.
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone().date()
    except OSError:
        return None


def _parse_file(path: Path) -> _ParsedFile:
    """Stream a rollout and capture the last token_count event's totals + limits."""
    cumulative: Optional[Dict[str, Any]] = None
    newest: Optional[datetime] = None
    rate_limits: Optional[Dict[str, Any]] = None
    corrupt = 0

    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return _ParsedFile(_session_date(path), cumulative, newest, rate_limits, corrupt)

    with handle:
        for line in handle:
            if "token_count" not in line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                corrupt += 1
                continue
            if not isinstance(record, dict):
                continue
            payload = record.get("payload")
            if not isinstance(payload, dict) or payload.get("type") != "token_count":
                continue
            info = payload.get("info")
            if isinstance(info, dict):
                total_usage = info.get("total_token_usage")
                if isinstance(total_usage, dict):
                    cumulative = total_usage
            moment = _parse_dt(record.get("timestamp"))
            if moment is not None:
                newest = moment
            limits = payload.get("rate_limits")
            rate_limits = limits if isinstance(limits, dict) else None

    return _ParsedFile(_session_date(path), cumulative, newest, rate_limits, corrupt)


def _get_parsed(path: Path, mtime: float, size: int) -> _ParsedFile:
    key = str(path)
    with _MEMO_LOCK:
        cached = _MEMO.get(key)
        if cached is not None and cached[0] == mtime and cached[1] == size:
            return cached[2]
    parsed = _parse_file(path)
    with _MEMO_LOCK:
        _MEMO[key] = (mtime, size, parsed)
    return parsed


def _discover(root: Path) -> Tuple[List[Tuple[float, int, Path]], int]:
    """Return (selected newest-first, omitted_count) for rollout files.

    No mtime window is applied: the ``rate_limits`` snapshot must reflect the
    most recent session even when the user has been idle for a while. Bucketing
    by date directory already confines the today/week totals.
    """
    entries: List[Tuple[float, int, Path]] = []
    for candidate in root.rglob("rollout-*.jsonl"):
        try:
            stat = candidate.stat()
        except OSError:
            continue
        entries.append((stat.st_mtime, stat.st_size, candidate))
    entries.sort(key=lambda item: item[0], reverse=True)
    omitted = 0
    if len(entries) > _MAX_FILES:
        omitted = len(entries) - _MAX_FILES
        entries = entries[:_MAX_FILES]
    return entries, omitted


def _blank_bucket() -> Dict[str, int]:
    return {key: 0 for key in _TOKEN_KEYS}


def _contribution(total_usage: Dict[str, Any]) -> Dict[str, int]:
    """Map a Codex ``total_token_usage`` onto the shared bucket shape."""
    return {
        "input": _as_int(total_usage.get("input_tokens")),
        "output": _as_int(total_usage.get("output_tokens")),
        "cache_read": _as_int(total_usage.get("cached_input_tokens")),
        "cache_creation": 0,
        "total": _as_int(total_usage.get("total_tokens")),
    }


def _add(target: Dict[str, int], source: Dict[str, int]) -> None:
    for key in _TOKEN_KEYS:
        target[key] += source[key]


def _snapshot(rate_limits: Dict[str, Any], captured: Optional[datetime]) -> Dict[str, Any]:
    """Shape the raw Codex rate_limits into the account contract, values intact."""
    return {
        "plan": rate_limits.get("plan_type"),
        "primary": rate_limits.get("primary"),
        "secondary": rate_limits.get("secondary"),
        "captured_at": captured.astimezone().isoformat() if captured else None,
    }


def _absent(root: Path) -> Dict[str, Any]:
    return {
        "provider": "codex",
        "present": False,
        "source": "rollouts",
        "today": None,
        "week": None,
        "by_model_today": [],
        "rate_limits": None,
        "last_activity": None,
        "note": f"롤아웃 디렉터리가 없습니다: {root}",
        "diagnostics": {"files_scanned": 0, "files_omitted": 0, "corrupt_lines": 0},
    }


def aggregate(home: Path, now: datetime) -> Dict[str, Any]:
    """Aggregate Codex rollout usage into one account entry."""
    root = home / ".codex" / "sessions"
    if not root.is_dir():
        return _absent(root)

    entries, omitted = _discover(root)
    today = now.astimezone().date()
    week_start = today - timedelta(days=6)

    today_bucket = _blank_bucket()
    week_bucket = _blank_bucket()
    corrupt_total = 0
    last_activity: Optional[datetime] = None
    newest_snapshot: Optional[Dict[str, Any]] = None
    newest_snapshot_at: Optional[datetime] = None

    for mtime, size, path in entries:
        parsed = _get_parsed(path, mtime, size)
        corrupt_total += parsed.corrupt_lines
        if parsed.newest is not None and (last_activity is None or parsed.newest > last_activity):
            last_activity = parsed.newest
        if parsed.rate_limits is not None and parsed.newest is not None:
            if newest_snapshot_at is None or parsed.newest > newest_snapshot_at:
                newest_snapshot = parsed.rate_limits
                newest_snapshot_at = parsed.newest

        if parsed.cumulative is None:
            continue
        contribution = _contribution(parsed.cumulative)
        session_day = parsed.session_date
        if session_day == today:
            _add(today_bucket, contribution)
        if session_day is not None and week_start <= session_day <= today:
            _add(week_bucket, contribution)

    note = _NOTE
    if omitted:
        note = f"{note} · 일부 파일 생략({omitted}개, 최신 {_MAX_FILES}개만 스캔)"

    rate_limits = (
        _snapshot(newest_snapshot, newest_snapshot_at) if newest_snapshot is not None else None
    )

    return {
        "provider": "codex",
        "present": True,
        "source": "rollouts",
        "today": today_bucket,
        "week": week_bucket,
        "by_model_today": [],
        "rate_limits": rate_limits,
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
