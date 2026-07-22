# Plan D: Antigravity 사용량 + 인라인 per-AI 한도 막대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/usage/accounts`에 Antigravity 계정을 추가하고(quota-cache 기반), 사용량을 버튼/팝오버뿐 아니라 **사용 중인 AI별 인라인 한도 막대그래프**로 상시 표시한다.

**Architecture:** claude/codex와 동일한 `aggregate(home, now)->dict` 계약으로 `antigravity_quota.py`를 신설해 `~/.antigravity/quota-cache.json`을 읽어 account를 만든다(rate-limit window가 없으므로 `remaining_percentage`→`used_percent`, `reset_time`→epoch로 변환해 대표 1개 window 생성). 프런트는 private `RateLimitRow`를 재사용 가능하게 추출하고, 활성 provider(`terminals[i].provider`)에 맞춰 `AgentSidePanel`/`Workbench` 기존 `ContextGaugeChip` 옆에 인라인 막대를 붙인다.

**Tech Stack:** Python(pytest) 백엔드, React/TS(Vitest) 프런트.

## Global Constraints

- 디자인 토큰만; 한국어 UI; 게이트 `PYTHONPATH=src uv run --no-sync python -m pytest test/ -k usage -q` + `cd web && npx tsc --noEmit && npm test && npm run build`.
- **PII 금지**: quota-cache의 `scope.email`/plan_tier 등 개인정보를 UsageAccount·로그·UI에 절대 싣지 않는다. 사용량 수치와 reset 시각만.
- `UsageAccount` 계약(provider/present/source/today/week/by_model_today/rate_limits/last_activity/note) 준수. provider 슬러그는 open string — 닫힌 union 만들지 않는다.
- 인라인 막대는 **표시 전용**(자동 동작 없음), 기존 `ContextGaugeChip` 톤과 통일.
- antigravity는 토큰 버킷(today/week) 없음 → None. by_model_today는 quota 모델 목록으로 채우거나 [].

---

### Task 1: `antigravity_quota.aggregate()` 백엔드 신설

**Files:**
- Create: `src/cli_agent_orchestrator/services/usage/antigravity_quota.py`
- Test: `test/usage/test_antigravity_quota.py` (신규; 기존 usage 테스트 디렉터리 확인)

**Interfaces:**
- Produces: `aggregate(home: Path, now: datetime) -> Dict[str, Any]` — claude_transcripts/codex_rollouts와 동일 키셋. `provider="antigravity_cli"`, `source="quota-cache"`.

- [ ] **Step 1: 기존 aggregator 패턴 확인**

Read: `src/cli_agent_orchestrator/api/usage_router.py`, `src/cli_agent_orchestrator/services/usage/claude_transcripts.py`(absent/present 반환), `codex_rollouts.py`(`_snapshot`), `claude_limits.py`(`_map_window` → `{used_percent, window_minutes, resets_at}`). 반환 키셋을 그대로 맞춘다.

- [ ] **Step 2: Write failing test** — `test/usage/test_antigravity_quota.py`

```python
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
```

- [ ] **Step 3: Run to verify fail**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/usage/test_antigravity_quota.py -q`
Expected: FAIL (module doesn't exist).

- [ ] **Step 4: Implement `antigravity_quota.py`**

```python
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
```
(`by_model_today.total` 0은 antigravity가 토큰 카운트를 안 주기 때문 — 이름만 노출. `worst`=잔여 최저 모델을 대표 한도로. `scope.email`은 읽지 않음.)

- [ ] **Step 5: Run to verify pass**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/usage/test_antigravity_quota.py -q`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add src/cli_agent_orchestrator/services/usage/antigravity_quota.py test/usage/test_antigravity_quota.py
git commit -m "feat(usage): add antigravity quota aggregator (per-model remaining → representative limit)"
```

---

### Task 2: `/usage/accounts`에 antigravity 계정 편입

**Files:**
- Modify: `src/cli_agent_orchestrator/api/usage_router.py` (`_scan_accounts`)
- Test: `test/usage/` 기존 라우터 테스트에 케이스 추가(파일 확인)

**Interfaces:**
- Consumes: `antigravity_quota.aggregate` (Task 1).
- Produces: `/usage/accounts` `accounts` 배열에 antigravity_cli 3번째 계정.

- [ ] **Step 1: Write failing test** — 기존 usage_router 테스트 파일에 추가

```python
def test_accounts_include_antigravity(monkeypatch, tmp_path):
    # (기존 라우터 테스트의 home/fixture 패턴을 따르되) 응답 accounts에 antigravity_cli 포함 확인
    from cli_agent_orchestrator.api import usage_router
    result = usage_router._scan_accounts(include_claude_limits=False)
    providers = {a["provider"] for a in result["accounts"]}
    assert "antigravity_cli" in providers
```

- [ ] **Step 2: Run to verify fail**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/usage -k antigravity -q`
Expected: FAIL (2 accounts only).

- [ ] **Step 3: Wire into `_scan_accounts`** — `usage_router.py`

import 추가: `from cli_agent_orchestrator.services.usage import antigravity_quota` (기존 usage import 옆).
`_scan_accounts` 안 codex_account 다음:
```python
    antigravity_account = antigravity_quota.aggregate(home, now)
```
반환 `accounts` 리스트: `[claude_account, codex_account, antigravity_account]`.

- [ ] **Step 4: Run to verify pass + full usage suite**

Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/usage -q`
Expected: PASS. 기존 "정확히 2개 계정" 단언 테스트가 있으면 3개로 정정(약화 아님).

- [ ] **Step 5: Commit**

```bash
git add src/cli_agent_orchestrator/api/usage_router.py test/usage/
git commit -m "feat(usage): surface antigravity account in /usage/accounts"
```

---

### Task 3: 인라인 per-AI 한도 막대(활성 provider 컨텍스트)

**Files:**
- Modify: `web/src/features/usage/AccountCard.tsx` (`RateLimitRow` export 또는 추출)
- Create: `web/src/features/usage/InlineUsageBar.tsx` (provider 1개용 얇은 막대 + 라벨)
- Modify: `web/src/features/usage/providerLabels.ts` (antigravity_cli 라벨)
- Modify: `web/src/features/workspace/AgentSidePanel.tsx` (에이전트 카드에 InlineUsageBar, terminal.provider로 매칭)
- Test: `web/src/test/inline-usage-bar.test.tsx` (신규)

**Interfaces:**
- Consumes: `apiUsage.getAccounts()` (`api.usage.ts`), `UsageAccount`, `terminals[i].provider`.
- Produces: `InlineUsageBar({ provider }: { provider: string })` — 해당 provider account의 primary limit을 얇은 막대로. rate_limits 없으면 "사용량 데이터 없음" 텍스트(agy 미로그인 등).

- [ ] **Step 1: providerLabels 보강** — `providerLabels.ts` `PROVIDER_LABELS`에 `antigravity_cli: 'Antigravity'` 추가.

- [ ] **Step 2: Write failing test** — `web/src/test/inline-usage-bar.test.tsx`

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineUsageBar } from '../features/usage/InlineUsageBar'
import type { UsageAccount } from '../api.usage'

const acc = (provider: string, usedPercent: number | null): UsageAccount => ({
  provider, present: true, source: 'x', today: null, week: null, by_model_today: [],
  rate_limits: usedPercent === null ? null
    : { plan: null, primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 0 }, secondary: null, captured_at: '' },
  last_activity: null, note: '',
})

describe('InlineUsageBar', () => {
  it('renders a percent bar for a provider with rate_limits', () => {
    render(<InlineUsageBar provider="antigravity_cli" accounts={[acc('antigravity_cli', 60)]} />)
    expect(screen.getByText(/60/)).toBeInTheDocument()
  })
  it('shows a no-data hint when the provider has no rate_limits', () => {
    render(<InlineUsageBar provider="antigravity_cli" accounts={[acc('antigravity_cli', null)]} />)
    expect(screen.getByText(/사용량 데이터 없음|데이터 없음/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify fail**

Run: `cd web && npx vitest run src/test/inline-usage-bar.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 4: Export the bar + implement `InlineUsageBar`**

`AccountCard.tsx`의 `RateLimitRow`(60-78) 앞에 `export`를 붙인다(또는 별 파일로 추출; 추출 시 AccountCard도 새 import 사용). `InlineUsageBar.tsx` 신설:

```tsx
import type { UsageAccount } from '../../api.usage'
import { getProviderLabel } from './providerLabels'
import { formatUsedPercent, isUsageWarning, clampPercent } from './formatTokens'

export function InlineUsageBar({ provider, accounts }: { provider: string; accounts: UsageAccount[] }) {
  const account = accounts.find(a => a.provider === provider) ?? null
  const primary = account?.rate_limits?.primary ?? null
  const label = getProviderLabel(provider)
  if (!primary) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-3)]">
        <span className="font-semibold">{label}</span><span>사용량 데이터 없음</span>
      </div>
    )
  }
  const warn = isUsageWarning(primary.used_percent)
  return (
    <div className="w-full" title="한도 사용량 — 표시 전용">
      <div className="mb-0.5 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold text-[var(--text)]">{label}</span>
        <span className={warn ? 'text-[var(--warning)]' : 'text-[var(--text-3)]'}>{formatUsedPercent(primary.used_percent)} 사용</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${clampPercent(primary.used_percent)}%`, backgroundColor: warn ? 'var(--warning)' : 'var(--accent)' }} />
      </div>
    </div>
  )
}
```
(주의: `formatUsedPercent`/`isUsageWarning`/`clampPercent`의 실제 export 위치를 `formatTokens.ts`에서 확인해 import 경로 맞춘다.)

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run src/test/inline-usage-bar.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 6: Mount inline in AgentSidePanel (활성 AI 컨텍스트)**

`AgentSidePanel.tsx`의 에이전트 카드 렌더(≈286, provider·`ContextGaugeChip` 옆)에서, account 목록을 상위에서 `apiUsage.getAccounts()`로 1회 로드해(기존 usage 로딩 훅이 있으면 재사용) 각 카드에 `<InlineUsageBar provider={terminal.provider} accounts={accounts} />`를 추가한다. 로딩 실패/미로그인은 InlineUsageBar의 no-data 경로가 처리. (accounts 로드는 provider별로 한 번; 카드마다 fetch 금지.)

- [ ] **Step 7: Full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/usage/AccountCard.tsx web/src/features/usage/InlineUsageBar.tsx web/src/features/usage/providerLabels.ts web/src/features/workspace/AgentSidePanel.tsx web/src/test/inline-usage-bar.test.tsx
git commit -m "feat(usage): inline per-AI usage bar in agent side panel (contextual to provider)"
```

---

## Self-Review

- **Spec coverage:** antigravity 사용량 추가(Task1+2) ✅; 인라인 per-AI 막대·버튼 아닌 상시 표시(Task3) ✅; agy 무데이터 graceful(no-data 경로) ✅; PII 차단(aggregator가 email 미독) ✅.
- **Placeholder scan:** import 경로/기존 usage 훅 재사용은 "실제 확인" 지시로 명시. 코드 전부 구체.
- **Type consistency:** `aggregate` 반환 키셋 == UsageAccount(TS). `InlineUsageBar` props(provider, accounts) ↔ 테스트/마운트 일치.

## 남은 위험
- antigravity 대표 window를 "잔여 최저 모델"로 잡음(가장 빡빡한 제약 표시) — 활성 모델 기준이 더 낫다면 status-state.json의 `model`로 매칭하도록 후속 조정 가능(본 플랜은 최저-잔여로 단순화).
- window_minutes=300 근사(실제 antigravity window 미공개). reset은 실제 reset_time 사용이라 정확.
- AgentSidePanel의 accounts 로딩 훅 존재 여부에 따라 Task3 Step6 배선이 달라짐 — 실행자가 기존 usage 훅 재사용 확인.
