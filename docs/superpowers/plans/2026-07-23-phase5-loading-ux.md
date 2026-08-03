# Phase 5: 로딩 UX (huni 오버레이 + Tooling 즉시 열림) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 긴 작업 중 huni 마스코트 로딩 오버레이를 띄우고, 도구 및 확장 페이지가 즉시 열리도록(느린 콜드 프로브에 셸이 안 막히게) + 캐시/프리웜으로 데이터도 빨리 오게 한다.

**Architecture:** 전역 오버레이 상태를 Zustand store에 ref-count로 두고(snackbar 패턴), `LoadingOverlay` 컴포넌트를 AppShell 최상위에 마운트해 huni PNG + CSS 스쿼시/스트레치 애니메이션으로 표시한다. 긴 작업(새 작업 생성·세션 종료)에서 show/hide로 감싼다. Tooling은 전역 로딩 게이트를 제거해 셸/탭을 즉시 렌더하고, 미캐시 collector(catalog/extensions/adapters)에 TTL 캐시 + 서버 기동 프리웜을 추가한다.

**Tech Stack:** React/TS(Zustand, Vitest), Python(FastAPI lifespan, pytest). huni.png 에셋은 이미 `web/src/assets/huni.png`에 복사됨(release-deploy master, 850×1000).

## Global Constraints

- 디자인 토큰만(`var(--…)`); 하드코딩 테마색 금지. 그림자/스크림의 `rgba(0,0,0,…)`는 테마색 아닌 그림자 효과라 허용(기존 모달도 동일). huni CSS의 release-deploy 토큰→cao 토큰 매핑: `--panel`→`--surface`, `--border2`→`--border-soft`, `--muted`→`--text-2`, `--text`→`--text`(동일), `--elevated`→`--surface-3`, `--modal-shadow`→`shadow-2xl`(Tailwind) 또는 `0 12px 40px rgba(0,0,0,.28)`.
- 오버레이 z-index는 모달(60) 위 — `z-[90]` 또는 `var(--z-toast)`(80)보다 위. 모달에서 트리거될 수 있으므로 모달보다 위여야 함.
- `prefers-reduced-motion: reduce`에서 애니메이션 정지(접근성) — 원본대로 유지.
- 한국어 UI. 게이트: `cd web && npx tsc --noEmit && npm test && npm run build` + 백엔드 변경 시 `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`.
- 오버레이는 표시 전용(자동 동작 없음). ref-count로 중첩 호출 안전(release-deploy `_overlayCount` 패턴).

---

### Task 1: Zustand 전역 오버레이 상태 (ref-count)

**Files:**
- Modify: `web/src/store.ts` (오버레이 상태 + 액션 — snackbar 패턴 미러)
- Test: `web/src/test/store-overlay.test.ts` (신규)

**Interfaces:**
- Produces: store에 `overlay: { count: number; message: string; sub: string | null }`; actions `showOverlay(message: string, sub?: string): void`, `hideOverlay(): void`. `count>0`이면 표시. 중첩 show/hide는 count 증감; count는 0 미만으로 안 감.

- [ ] **Step 1: Read** `web/src/store.ts` — snackbar 상태/액션(`snackbar`, `showSnackbar`/`hideSnackbar`) 형태 확인, `create<Store>` 타입 구조.

- [ ] **Step 2: Write failing test** — `web/src/test/store-overlay.test.ts`
```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { useStore } from '../store'

describe('overlay store (ref-counted)', () => {
  beforeEach(() => { const s = useStore.getState(); while (s.overlay.count > 0) s.hideOverlay() })
  it('shows with message and increments count', () => {
    useStore.getState().showOverlay('처리 중…', '워커 생성 중')
    const o = useStore.getState().overlay
    expect(o.count).toBe(1); expect(o.message).toBe('처리 중…'); expect(o.sub).toBe('워커 생성 중')
  })
  it('nested show/hide is ref-counted and never goes negative', () => {
    const s = () => useStore.getState()
    s().showOverlay('a'); s().showOverlay('b')
    expect(s().overlay.count).toBe(2)
    s().hideOverlay(); expect(s().overlay.count).toBe(1)
    s().hideOverlay(); s().hideOverlay()
    expect(s().overlay.count).toBe(0)
  })
})
```

- [ ] **Step 3: Run → FAIL** — `cd web && npx vitest run src/test/store-overlay.test.ts`

- [ ] **Step 4: Implement in `store.ts`**
State: `overlay: { count: 0, message: '', sub: null as string | null }`.
Actions:
```ts
showOverlay: (message, sub) => set(s => ({ overlay: { count: s.overlay.count + 1, message, sub: sub ?? null } })),
hideOverlay: () => set(s => ({ overlay: { ...s.overlay, count: Math.max(0, s.overlay.count - 1) } })),
```
(Store 타입 인터페이스에 `overlay`/`showOverlay`/`hideOverlay` 추가.)

- [ ] **Step 5: Run → PASS** + `cd web && npx tsc --noEmit`

- [ ] **Step 6: Commit** — `git add web/src/store.ts web/src/test/store-overlay.test.ts && git commit -m "feat(ui): ref-counted global loading-overlay state in store"`

---

### Task 2: LoadingOverlay 컴포넌트 (huni) + AppShell 마운트

**Files:**
- Create: `web/src/components/LoadingOverlay.tsx`
- Create: `web/src/components/LoadingOverlay.css` (huni keyframes, cao 토큰 매핑)
- Modify: `web/src/app/AppShell.tsx` (마운트)
- Test: `web/src/test/loading-overlay.test.tsx` (신규)

**Interfaces:**
- Consumes: `useStore` `overlay`(Task 1), `web/src/assets/huni.png`(복사됨).
- Produces: `LoadingOverlay` — `overlay.count>0`일 때 full-screen 오버레이(huni + message + sub) 렌더, 아니면 null.

- [ ] **Step 1: Read** `AppShell.tsx:230-322`(최상위 return, `<CommandPalette>` 위치 ~315-320) + 한 모달(`ConfirmModal.tsx`)의 백드롭 스타일 참고 + huni CSS(아래 Step 3에 이식본 있음). huni.png import 경로 확인(`../assets/huni.png`).

- [ ] **Step 2: Write failing test** — `web/src/test/loading-overlay.test.tsx`
```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingOverlay } from '../components/LoadingOverlay'
import { useStore } from '../store'

describe('LoadingOverlay', () => {
  beforeEach(() => { const s = useStore.getState(); while (s.overlay.count > 0) s.hideOverlay() })
  it('renders nothing when count is 0', () => {
    const { container } = render(<LoadingOverlay />)
    expect(container).toBeEmptyDOMElement()
  })
  it('renders huni + message when shown', () => {
    useStore.getState().showOverlay('작업을 준비하고 있어요', '잠시만 기다려주세요')
    render(<LoadingOverlay />)
    expect(screen.getByText('작업을 준비하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('잠시만 기다려주세요')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /huni|로딩/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Implement `LoadingOverlay.css`** (huni keyframes, cao 토큰 적용):
```css
@keyframes busy-fade { from { opacity: 0; } }
.busy-overlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); backdrop-filter: blur(1.5px); animation: busy-fade .12s ease-out; }
.busy-box { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 220px; max-width: 440px; padding: 28px 38px 24px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border-soft); box-shadow: 0 12px 40px rgba(0,0,0,.28); }
.busy-huni-wrap { display: flex; flex-direction: column; align-items: center; height: 132px; justify-content: flex-end; margin-bottom: 2px; }
.busy-huni { width: 96px; height: auto; display: block; user-select: none; -webkit-user-drag: none; transform-origin: 50% 100%; animation: huni-bounce 1.5s cubic-bezier(.5,.05,.5,.95) infinite; filter: drop-shadow(0 5px 8px rgba(0,0,0,.32)); }
@keyframes huni-bounce {
  0% { transform: translateY(0) scaleX(1) scaleY(1) rotate(0deg); }
  14% { transform: translateY(2px) scaleX(1.09) scaleY(.91) rotate(0deg); }
  40% { transform: translateY(-26px) scaleX(.93) scaleY(1.07) rotate(4deg); }
  55% { transform: translateY(-31px) scaleX(1) scaleY(1) rotate(-3deg); }
  70% { transform: translateY(-26px) scaleX(.96) scaleY(1.04) rotate(3deg); }
  86% { transform: translateY(2px) scaleX(1.11) scaleY(.89) rotate(0deg); }
  100% { transform: translateY(0) scaleX(1) scaleY(1) rotate(0deg); }
}
.busy-huni-shadow { width: 64px; height: 11px; margin-top: 5px; border-radius: 50%; background: radial-gradient(ellipse at center, rgba(0,0,0,.32), transparent 72%); animation: huni-shadow 1.5s cubic-bezier(.5,.05,.5,.95) infinite; }
@keyframes huni-shadow { 0%,100% { transform: scaleX(1.06); opacity: .55; } 55% { transform: scaleX(.58); opacity: .20; } }
@media (prefers-reduced-motion: reduce) { .busy-huni, .busy-huni-shadow { animation: none; } }
.busy-msg { font-size: 14px; font-weight: 600; color: var(--text); text-align: center; line-height: 1.5; }
.busy-sub { font-size: 12px; color: var(--text-2); text-align: center; margin-top: -4px; }
```

- [ ] **Step 4: Implement `LoadingOverlay.tsx`**
```tsx
import './LoadingOverlay.css'
import huniUrl from '../assets/huni.png'
import { useStore } from '../store'

export function LoadingOverlay() {
  const overlay = useStore(s => s.overlay)
  if (overlay.count <= 0) return null
  return (
    <div className="busy-overlay" role="alert" aria-live="assertive">
      <div className="busy-box">
        <div className="busy-huni-wrap">
          <img className="busy-huni" src={huniUrl} alt="huni 로딩" />
          <div className="busy-huni-shadow" />
        </div>
        <div className="busy-msg">{overlay.message || '처리 중…'}</div>
        {overlay.sub && <div className="busy-sub">{overlay.sub}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Mount in AppShell** — `AppShell.tsx`: import `LoadingOverlay`; render `<LoadingOverlay />` right after `<CommandPalette .../>` (inside the outermost `<div>`, ~line 320).

- [ ] **Step 6: Run tests → PASS** + `cd web && npx tsc --noEmit && npm run build`(에셋 import 빌드 확인)

- [ ] **Step 7: Commit** — `git add web/src/components/LoadingOverlay.tsx web/src/components/LoadingOverlay.css web/src/assets/huni.png web/src/app/AppShell.tsx web/src/test/loading-overlay.test.tsx && git commit -m "feat(ui): huni loading overlay component mounted at AppShell"`

---

### Task 3: 긴 작업(새 작업 생성·세션 종료)에 오버레이 배선

**Files:**
- Modify: `web/src/features/workspace/NewTaskModal.tsx` (create 경로)
- Modify: `web/src/features/workspace/Workspace.tsx` (`handleConfirmEndSession`)
- Test: `web/src/test/overlay-wiring.test.tsx` (신규) 또는 기존 테스트에 케이스 추가

**Interfaces:**
- Consumes: `useStore` `showOverlay`/`hideOverlay`(Task 1).

- [ ] **Step 1: Read** `NewTaskModal.tsx:70,191-209`(creating state + create await) + `Workspace.tsx:223-237`(handleConfirmEndSession).

- [ ] **Step 2: Write failing test** — `web/src/test/overlay-wiring.test.tsx`: NewTaskModal의 create를 발동하면(모킹된 create가 pending인 동안) `useStore.getState().overlay.count`가 1이 되고, resolve 후 0이 되는지 검증. (실제 모달 mount + create 버튼 click + fetch/api 모킹. 무겁다면 create 핸들러 로직을 작은 함수로 뽑아 show/hide 호출을 단위 검증.)
```tsx
// 스케치 — 실제 NewTaskModal props/모킹은 기존 new-task 테스트 패턴 따름
import { useStore } from '../store'
// create가 진행 중 overlay.count===1, 완료 후 0 을 assert
```

- [ ] **Step 3: Wire NewTaskModal** — `NewTaskModal.tsx` create 경로:
```ts
const showOverlay = useStore(s => s.showOverlay)
const hideOverlay = useStore(s => s.hideOverlay)
// create 핸들러:
setCreating(true)
showOverlay('새 작업을 준비하고 있어요', '실행 AI를 시작하는 중이에요')
try {
  const terminal = await createSessionWithOptionalProvider(...)
  onCreated(terminal.session_name); onClose()
} catch (e) { /* 기존 에러 처리 */ }
finally { setCreating(false); hideOverlay() }
```

- [ ] **Step 4: Wire session end** — `Workspace.tsx handleConfirmEndSession`:
```ts
setEndingSession(true)
showOverlay('세션을 정리하고 있어요')
try { await api.deleteSession(selectedSessionId); /* 기존 */ }
finally { setEndingSession(false); hideOverlay() }
```
(hideOverlay가 항상 호출되도록 finally에. 기존 `setEndingSession(false)`가 try 밖이면 그 자리에 hideOverlay도.)

- [ ] **Step 5: Run tests → PASS** + full gate `cd web && npx tsc --noEmit && npm test && npm run build`

- [ ] **Step 6: Commit** — `git add web/src/features/workspace/NewTaskModal.tsx web/src/features/workspace/Workspace.tsx web/src/test/overlay-wiring.test.tsx && git commit -m "feat(ui): show huni overlay during new-task create + session teardown"`

---

### Task 4: Tooling 즉시 열림 (전역 로딩 게이트 제거)

**Files:**
- Modify: `web/src/features/tooling/ToolingView.tsx` (`:294-296` 게이트 제거, 셸/탭 즉시 렌더)
- Test: `web/src/test/tooling-view-shell.test.tsx` (신규) 또는 기존 tooling 테스트에 추가

**Interfaces:**
- Consumes: 기존 per-section 로딩/에러 state(environmentError 등, allSettled).

- [ ] **Step 1: Read** `ToolingView.tsx:93`(loading state), `:225-265`(load allSettled + finally setLoading), `:294-378`(`if(loading) return <ToolingSkeleton/>` + header + tab bar), `:461-473`(ToolingSkeleton), 각 pane의 loading/error props(DiscoverPane `:413-421`, OverviewPane null-env 처리 `:42-53`).

- [ ] **Step 2: Write failing test** — 셸 즉시 렌더: `loading===true`(초기)라도 헤더 제목("도구 및 확장")과 하위탭 tablist가 렌더되는지. (mount + 초기 상태에서 `screen.getByRole('heading',{name:/도구 및 확장/})`와 탭 존재 assert. fetch는 pending 모킹.)

- [ ] **Step 3: Remove the gate** — `ToolingView.tsx`: `if (loading) return <ToolingSkeleton/>`(:294-296) 삭제. 헤더(:310-314)+탭바(:317-378)를 loading 분기 밖에서 항상 렌더. 활성 탭 콘텐츠 영역에서만 해당 섹션 로딩 시 스켈레톤/스피너 표시(각 pane가 이미 지원: OverviewPane는 null environment 처리, DiscoverPane loading prop 등). 전체화면 에러(`environmentError && providersError && extensionsError && diagnosticsError`)는 유지(진짜 전부 실패 시만).

- [ ] **Step 4: Run tests → PASS** + full gate

- [ ] **Step 5: Commit** — `git add web/src/features/tooling/ToolingView.tsx web/src/test/tooling-view-shell.test.tsx && git commit -m "perf(tooling): render page shell+tabs immediately, skeleton only the active section"`

---

### Task 5: Tooling 데이터 캐시 + 서버 기동 프리웜

**Files:**
- Modify: `src/cli_agent_orchestrator/services/tooling/catalog.py` (`list_catalog` TTL 캐시)
- Modify: `src/cli_agent_orchestrator/services/tooling/extensions.py` (`list_extensions` 캐시 — 이미 있으면 확인)
- Modify: `src/cli_agent_orchestrator/api/tooling_router.py` (`_collect_adapters` 캐시)
- Modify: `src/cli_agent_orchestrator/services/tooling/cache.py` (`CACHE_TTL_SECONDS` 60→300, rescan에 새 키 포함; process-wide `cached_which`가 있으면 재사용/없으면 확인)
- Modify: `src/cli_agent_orchestrator/api/main.py` (lifespan에 백그라운드 프리웜)
- Test: `test/tooling/` (캐시 히트 + 프리웜 단위)

**Interfaces:**
- Consumes: 기존 `cache` 모듈(TTL store), `providers.list_providers`(이미 캐시).

- [ ] **Step 1: Read** `cache.py`(TTL store, `CACHE_TTL_SECONDS`, `rescan`, `cached_which` 존재 여부), `catalog.py:28-83`(`_provider_snapshot`/`list_catalog` — 미캐시 확인), `extensions.py:119-155`(`list_extensions` — 캐시 여부), `tooling_router.py:289`(`_collect_adapters`), `main.py:499+`(lifespan/startup, `registry.load()` 위치), `providers.py`의 캐시 사용 패턴(미러 대상).

- [ ] **Step 2: Write failing tests** — (a) `list_catalog` 2회 호출 시 2번째가 캐시 히트(프로브 미재실행 — probe를 모킹해 호출 횟수 assert); (b) `CACHE_TTL_SECONDS >= 300`. (기존 cache 테스트 패턴 따름.)

- [ ] **Step 3: Implement**
- `cache.py`: `CACHE_TTL_SECONDS = 300`(또는 600). `rescan()`이 새 캐시 키(catalog/extensions/adapters)도 무효화하도록 확장. `cached_which`가 없으면 process-wide which 캐시 추가(있으면 catalog/extensions에서 재사용).
- `catalog.py list_catalog`: providers.py 캐시 패턴 미러 — `cache.get_cache()`로 TTL 캐시(키 `catalog:all`), `use_cache=True` 기본.
- `extensions.py list_extensions`: 캐시 없으면 동일 추가.
- `tooling_router.py _collect_adapters`: 캐시 래핑.
- `main.py` lifespan: `registry.load()` 뒤 `asyncio.create_task(asyncio.to_thread(<warm>))` — providers/extensions/catalog/models/_collect_adapters를 백그라운드 예열(서버 기동 블로킹 없이). 실패는 조용히 무시(예열은 best-effort).

- [ ] **Step 4: Run tests → PASS** + `PYTHONPATH=src uv run --no-sync python -m pytest test/tooling -q`

- [ ] **Step 5: Commit** — `git add src/cli_agent_orchestrator/services/tooling/ src/cli_agent_orchestrator/api/ test/tooling/ && git commit -m "perf(tooling): cache catalog/extensions/adapters + raise TTL + startup pre-warm"`

---

## Self-Review

- **Spec coverage(Phase 5):** 로딩 캐릭터(huni) 오버레이 — Task1(상태)+2(컴포넌트/마운트)+3(배선) ✅. Tooling 즉시 열림 — Task4(게이트 제거) ✅. 데이터 빠르게 — Task5(캐시/프리웜) ✅. 연결 UX는 이벤트 수정(이전)으로 이미 안정 — 본 플랜 범위 밖.
- **Placeholder scan:** huni CSS/컴포넌트/store 코드 전부 실제. Task3/4 테스트는 "기존 모킹 패턴 따름"으로 실행자 확인 지시(무거운 mount 대안 명시). cache.py/main.py는 "확인 후 미러" 지시. 토큰 매핑 명시값.
- **Type consistency:** `overlay{count,message,sub}` + `showOverlay(message,sub?)`/`hideOverlay()`(Task1) ↔ LoadingOverlay 소비(Task2) ↔ 배선(Task3) 일치.

## 남은 위험
- huni CSS 토큰 매핑 후 라이트/다크 대비 육안 확인은 라이브에서(다크에서 `--surface`/`--text-2` 대비). 실행 후 브라우저 확인 권장.
- Task5 `cached_which`/캐시 키가 기존 `rescan`/설정 UI의 "다시 검사"와 정합해야 함(사용자가 새로고침 시 캐시 무효화). 실행자 확인.
- Task4에서 게이트 제거 시 각 pane가 부분 데이터/null을 안전히 렌더하는지(OverviewPane는 이미 처리) — 리뷰에서 회귀 중점.
