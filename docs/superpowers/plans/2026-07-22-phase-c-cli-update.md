# Plan C: AI CLI 자체 업데이트 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this plan runs as a self-contained unit in an isolated worktree). Steps use checkbox (`- [ ]`) syntax.

**Goal:** agy/codex/claude CLI 바이너리를 UI에서 업데이트할 수 있게 한다 — provider별 "업데이트" 버튼이 기존 operations 흐름(plan→preview→execute→poll)으로 `<binary> update`를 실행.

**Architecture:** 기존 tooling operations 프레임워크를 그대로 재사용한다. `runner.py`의 argv allowlist에 이미 `{claude,codex,agy}`가 있고 `VALID_ACTIONS`에 `update`가 있으므로, 각 provider adapter에 `canUpdate=True` + `plan("update")→ExecutionPlan([_BINARY,"update"])`만 추가하면 라우터/러너/프런트 operation 인프라가 자동 연결된다. 프런트는 `OverviewPane`의 `ProviderRow`에 버튼을 붙여 기존 `requestAction({action:'update',provider})`를 호출한다.

**Tech Stack:** Python(pytest) adapters, React/TS(Vitest) tooling UI.

## Global Constraints

- **실제 update 명령을 테스트/구현 중 실행 금지.** `<binary> update`는 사용자 머신의 CLI를 갱신하는 상태변경 — 모든 테스트는 `runner.run`을 **모킹**한다. 실제 실행은 사용자가 UI 버튼+preview로 런타임에 개시.
- 디자인 토큰만; 한국어 UI; 게이트 백엔드 `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`, 프런트 `cd web && npx tsc --noEmit && npm test && npm run build`.
- `canUpdate=True`는 이 3개 adapter에서 "CLI 바이너리 자체 업데이트"를 의미한다(이들은 MCP-update 개념이 없어 의미 충돌 없음). `_ACTION_CAPABILITY` 매핑상 action `update`↔`canUpdate` 이미 연결됨.
- ExecutionPlan/verify는 기존 remove/install `plan()`(codex.py:192-208, claude_code.py:238-254) 스타일을 그대로 따른다.

---

### Task 1: 3개 provider adapter에 CLI update 구현

**Files:**
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/codex.py` (`capabilities`, `plan`, `verify`)
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/claude_code.py` (동일)
- Modify: `src/cli_agent_orchestrator/services/tooling/adapters/antigravity.py` (read-only refuse → update만 허용)
- Test: `test/tooling/test_adapters_update.py` (신규)

**Interfaces:**
- Produces: 각 adapter `capabilities().canUpdate == True`; `plan("update", None, None) -> ExecutionPlan(argv=[_BINARY, "update"], ...)`.

- [ ] **Step 1: 기존 adapter plan()/ExecutionPlan 형태 확인**
Read: `adapters/base.py`(ExecutionPlan 필드, ProviderCapabilities), `adapters/codex.py`(capabilities+plan+verify), `adapters/claude_code.py`, `adapters/antigravity.py`. ExecutionPlan 생성 인자(description/argv/cwd/verify_description/warnings)를 정확히 확인.

- [ ] **Step 2: Write failing tests** — `test/tooling/test_adapters_update.py`

```python
import pytest
from cli_agent_orchestrator.services.tooling.adapters.codex import CodexAdapter
from cli_agent_orchestrator.services.tooling.adapters.claude_code import ClaudeCodeAdapter
from cli_agent_orchestrator.services.tooling.adapters.antigravity import AntigravityAdapter

ADAPTERS = [(CodexAdapter(), "codex"), (ClaudeCodeAdapter(), "claude"), (AntigravityAdapter(), "agy")]


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_can_update_cli_binary(adapter, binary):
    assert adapter.capabilities().canUpdate is True


@pytest.mark.parametrize("adapter,binary", ADAPTERS)
def test_update_plan_runs_binary_update(adapter, binary):
    plan = adapter.plan("update", None, None)
    assert plan.argv == [binary, "update"]
```

- [ ] **Step 3: Run to verify fail**
Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling/test_adapters_update.py -q`
Expected: FAIL (canUpdate False / plan raises ValueError).

- [ ] **Step 4: Implement update in each adapter**

각 adapter에서:
- `capabilities(...)`의 `canUpdate=False` → `canUpdate=True`. `reasons`에서 `"canUpdate"` 항목은 제거하거나 `"canUpdate": "CLI 자체를 최신 버전으로 업데이트해요"`로 교체.
- `plan(self, action, target, scope)`에 update 분기 추가(기존 remove/install 분기 옆, `raise ValueError` 앞):
```python
        if action == "update":
            return ExecutionPlan(
                description=f"{self._BINARY} CLI를 최신 버전으로 업데이트해요",
                argv=[self._BINARY, "update"],
                cwd=None,
                verify_description=f"{self._BINARY} --version 재확인",
                warnings=["CLI 프로세스가 실행 중이면 업데이트 후 재시작이 필요할 수 있어요"],
            )
```
(각 adapter의 `_BINARY` 상수/ExecutionPlan 필드명은 Step 1에서 확인한 실제값으로. antigravity는 현재 모든 action을 `raise ValueError(_READ_ONLY_REASON)`하므로, update 분기를 그 raise **앞에** 넣어 update만 허용.)
- `verify(self, action, target)`: update 시 성공 판정 — 최소 `if action == "update": return True, "updated"` (또는 `<binary> --version` 재프로브가 기존 패턴이면 그걸 따름). antigravity의 `verify`도 update만 True 경로 추가.

- [ ] **Step 5: Run to verify pass + full tooling suite**
Run: `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`
Expected: PASS. 기존 "canUpdate False" 또는 "plan raises for update" 단언 테스트가 있으면 새 동작으로 정정.

- [ ] **Step 6: Commit**
```bash
git add src/cli_agent_orchestrator/services/tooling/adapters/ test/tooling/test_adapters_update.py
git commit -m "feat(tooling): implement CLI self-update plan for agy/codex/claude adapters"
```

---

### Task 2: OverviewPane ProviderRow에 "업데이트" 버튼

**Files:**
- Modify: `web/src/features/tooling/OverviewPane.tsx` (`ProviderRow` L121-152 + 상위에서 requestAction 전달)
- Test: `web/src/test/provider-update-button.test.tsx` (신규)

**Interfaces:**
- Consumes: `useToolingOperations`의 `requestAction({action:'update', provider})` (기존). Task 1의 adapter update.

- [ ] **Step 1: 기존 흐름 확인**
Read: `web/src/features/tooling/OverviewPane.tsx`(ProviderRow, 상위 컴포넌트가 useToolingOperations를 어떻게 쓰는지), `web/src/features/tooling/useToolingOperations.ts`(`requestAction` 시그니처), `ToolingView.tsx`(operations 훅 배선). requestAction이 preview 모달→execute→poll을 이미 처리함을 확인.

- [ ] **Step 2: Write failing test** — `web/src/test/provider-update-button.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProviderRow } from '../features/tooling/OverviewPane'
import type { ToolingProvider } from '../api.tooling'

const provider: ToolingProvider = {
  name: 'codex', display_name: 'Codex', binary: 'codex', installed: true,
  path: '/usr/bin/codex', version: '0.144.6', version_raw: '0.144.6', version_error: null, checked_at: '',
} as any

describe('ProviderRow update button', () => {
  it('calls onUpdate with the provider when clicked (installed only)', () => {
    const onUpdate = vi.fn()
    render(<ProviderRow provider={provider} withBorder={false} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: /업데이트/ }))
    expect(onUpdate).toHaveBeenCalledWith('codex')
  })
  it('hides the update button for a not-installed provider', () => {
    render(<ProviderRow provider={{ ...provider, installed: false }} withBorder={false} onUpdate={() => {}} />)
    expect(screen.queryByRole('button', { name: /업데이트/ })).toBeNull()
  })
})
```
(주의: `ProviderRow`가 현재 export 안 돼 있으면 export 추가. props에 `onUpdate?: (provider: string) => void` 추가. 실제 `ToolingProvider` 타입 필드는 Step 1에서 확인.)

- [ ] **Step 3: Run to verify fail**
Run: `cd web && npx vitest run src/test/provider-update-button.test.tsx`
Expected: FAIL (버튼/ prop 없음).

- [ ] **Step 4: Add the button**
`OverviewPane.tsx`: `ProviderRow` export + `onUpdate?: (provider: string) => void` prop 추가. `provider.installed`일 때만 버튼 렌더(토큰 스타일, 라벨 "업데이트"), onClick=`() => onUpdate?.(provider.name)`. 상위 컴포넌트에서 `onUpdate={(p) => requestAction({ action: 'update', provider: p })}`를 전달(기존 useToolingOperations 훅의 requestAction 사용 — preview/execute/poll 자동).

- [ ] **Step 5: Run to verify pass**
Run: `cd web && npx vitest run src/test/provider-update-button.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 6: Full gate**
Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: green.

- [ ] **Step 7: Commit**
```bash
git add web/src/features/tooling/OverviewPane.tsx web/src/test/provider-update-button.test.tsx
git commit -m "feat(tooling): per-provider CLI update button wired to operations flow"
```

---

## Self-Review

- **Spec coverage:** "각 AI CLI 업데이트 기능"(사용자 요청 대안) — adapter update(Task1) + UI 버튼(Task2), 기존 operations preview/execute/poll 재사용 ✅. 실제 실행은 사용자 개시(안전) ✅.
- **Placeholder scan:** ExecutionPlan 필드명/`_BINARY`/`requestAction` 시그니처는 "Step 1에서 확인" 명시. 코드 구체.
- **Safety:** 테스트는 runner 모킹, 실제 update 미실행. requestAction의 기존 preview 모달이 실행 전 사용자 확인 제공.
- **Type consistency:** adapter `plan("update")` argv `[_BINARY,"update"]` ↔ Task2는 `action:'update'`만 넘기고 argv는 백엔드가 생성. `onUpdate(provider: string)` ↔ 테스트 일치.

## 남은 위험
- "update 가능/최신" 감지(codex doctor의 "available") 신호는 이 코드베이스에 없음 — v1은 버튼 상시 제공(설치된 provider만), "업데이트 있음" 배지는 후속. 
- antigravity adapter는 원래 전-action refuse라 update만 예외 허용 — 다른 action은 계속 refuse 유지(회귀 없게 Step4에서 순서 주의).
- `<binary> update`의 실제 동작/권한은 각 CLI에 위임 — 실패 시 operation이 stderr를 표면화(기존 흐름).
