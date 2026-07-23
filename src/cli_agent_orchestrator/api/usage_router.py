from __future__ import annotations

import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Query

from cli_agent_orchestrator.security.auth import (
    SCOPE_ADMIN,
    SCOPE_READ,
    SCOPE_WRITE,
    require_any_scope,
)
from cli_agent_orchestrator.services.usage import (
    antigravity_quota,
    claude_limits,
    claude_transcripts,
    codex_rollouts,
)

router = APIRouter(prefix="/usage", tags=["usage"])

_CACHE_TTL_SECONDS = 60.0
_CACHE: Dict[bool, tuple[float, Dict[str, Any]]] = {}
_CACHE_LOCK = threading.Lock()


def _merge_note(original: Any, addition: str) -> str:
    base = original if isinstance(original, str) else ""
    if not base:
        return addition
    if not addition:
        return base
    return f"{base} · {addition}"


def _scan_accounts(include_claude_limits: bool) -> Dict[str, Any]:
    now = datetime.now().astimezone()
    home = Path.home()
    claude_account = dict(claude_transcripts.aggregate(home, now))
    codex_account = codex_rollouts.aggregate(home, now)
    antigravity_account = antigravity_quota.aggregate(home, now)
    if include_claude_limits and claude_account.get("present") is True:
        lookup = claude_limits.get_limits(home, now)
        claude_account["rate_limits"] = lookup.rate_limits
        claude_account["note"] = _merge_note(claude_account.get("note"), lookup.note)
    return {
        "accounts": [claude_account, codex_account, antigravity_account],
        "scanned_at": now.isoformat(),
    }


@router.get("/accounts")
def get_usage_accounts(
    include_claude_limits: bool = Query(default=False, alias="claude_limits"),
    _scopes: List[str] = Depends(require_any_scope(SCOPE_READ, SCOPE_WRITE, SCOPE_ADMIN)),
) -> Dict[str, Any]:
    monotonic_now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(include_claude_limits)
        if cached is not None and monotonic_now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]
    result = _scan_accounts(include_claude_limits)
    with _CACHE_LOCK:
        _CACHE[include_claude_limits] = (monotonic_now, result)
    return result


def reset_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
