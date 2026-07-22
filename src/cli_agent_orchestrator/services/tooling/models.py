"""Model catalog for provider CLIs.

Two sources, never mixed and never guessed:

* **probe** — Antigravity's ``agy models`` is a read-only listing, so it is run
  (when ``agy`` is detected) and its lines parsed conservatively. A non-zero
  exit (e.g. "please sign in") yields an empty list plus a masked ``error``
  string rather than a fabricated model set. The result is TTL-cached.
* **known** — Claude Code and Codex have no read-only "list models" command, so
  a short constant of well-known *aliases* is returned with ``source="known"``.
  These are curated, explicitly *not* probed, and paired with
  ``allow_custom=True`` so the UI lets a user type any exact model id. Nothing
  here is inferred from a version banner.
"""

from __future__ import annotations

import re
import shutil
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from cli_agent_orchestrator.services.tooling import cache, probe
from cli_agent_orchestrator.services.tooling.secret_mask import mask

_AGY_BINARY = "agy"
_AGY_MODELS_TIMEOUT_SECONDS = 10.0
_AGY_CACHE_KEY = "models:antigravity_cli"

# Curated, well-known aliases (NOT probed). ``allow_custom`` is the escape hatch
# for any exact model id not listed here.
_KNOWN_MODELS: Dict[str, tuple[str, ...]] = {
    "claude_code": ("opus", "sonnet", "haiku", "fable"),
    "codex": ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"),
}

_KNOWN_NOTE = (
    "알려진 별칭 목록이에요 (probe로 조회한 값이 아니에요) — "
    "정확한 목록은 각 CLI 문서를 확인하세요. 원하는 모델명을 직접 입력할 수도 있어요."
)

# Auth/login signals in ``agy models`` failure output. When any appears, the
# non-zero exit is surfaced as a friendly "please sign in" hint instead of the
# raw CLI line — this is a mapping of a detected condition, not a guess: only
# output that actually mentions sign-in/auth reaches this branch.
_AGY_AUTH_HINTS = (
    "sign in",
    "signin",
    "sign-in",
    "log in",
    "login",
    "logged in",
    "authenticate",
    "authentication",
    "unauthorized",
    "unauthenticated",
    "credential",
    "로그인",
    "인증",
)
_AGY_LOGIN_ERROR = "agy 로그인이 필요해요 — 터미널에서 agy 실행 후 로그인하세요"

# A plausible model-id first token (letters/digits with .-_ separators).
_MODEL_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _known_models(provider: str) -> Dict[str, Any]:
    return {
        "provider": provider,
        "source": "known",
        "models": [{"name": name} for name in _KNOWN_MODELS[provider]],
        "allow_custom": True,
        "note": _KNOWN_NOTE,
        "probed_at": _now(),
    }


def _parse_agy_models(stdout: str) -> List[Dict[str, str]]:
    """Parse ``agy models`` stdout conservatively into ``{name, raw}`` entries."""
    models: List[Dict[str, str]] = []
    for line in stdout.splitlines():
        stripped = mask(line.strip())
        if not stripped:
            continue
        first = stripped.split()[0]
        name = first if _MODEL_TOKEN_RE.match(first) else stripped
        models.append({"name": name, "raw": stripped})
    return models


def _antigravity_models(*, use_cache: bool = True) -> Dict[str, Any]:
    store = cache.get_cache()
    if use_cache:
        cached = store.get(_AGY_CACHE_KEY)
        if cached is not None:
            return cast(Dict[str, Any], cached)

    result = _collect_antigravity_models()
    store.set(_AGY_CACHE_KEY, result)
    return result


def _collect_antigravity_models() -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "provider": "antigravity_cli",
        "source": "probe",
        "models": [],
        "allow_custom": True,
        "probed_at": _now(),
        "error": None,
    }
    if shutil.which(_AGY_BINARY) is None:
        base["error"] = "agy가 감지되지 않았어요"
        return base

    outcome = probe.run([_AGY_BINARY, "models"], timeout=_AGY_MODELS_TIMEOUT_SECONDS)
    if outcome.timed_out or outcome.returncode is None:
        base["error"] = "agy models 실행에 실패했어요"
        return base
    if outcome.returncode != 0:
        combined = outcome.stdout + "\n" + outcome.stderr
        if any(hint in combined.lower() for hint in _AGY_AUTH_HINTS):
            # Most common non-zero exit is "please sign in" — give an actionable
            # login hint rather than echoing the raw (possibly noisy) CLI line.
            base["error"] = _AGY_LOGIN_ERROR
            return base
        first = next((ln.strip() for ln in combined.splitlines() if ln.strip()), "")
        base["error"] = mask(first) or f"agy models가 코드 {outcome.returncode}로 종료됐어요"
        return base

    base["models"] = _parse_agy_models(outcome.stdout)
    return base


def list_models() -> List[Dict[str, Any]]:
    """Return the model catalog for antigravity (probe) + claude/codex (known)."""
    return [
        _antigravity_models(),
        _known_models("claude_code"),
        _known_models("codex"),
    ]
