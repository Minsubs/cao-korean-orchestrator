# Phase 3 · 에러 / 승인대기 / 비용·시간 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오케스트레이션이 실패하거나 승인 대기로 멈췄을 때 사용자가 무슨 일인지 즉시 알고 한 번의 클릭으로 조치할 수 있게 하고, 각 작업에 걸린 시간을 워커 단위까지 드러낸다.

**Architecture:** Phase 2 의 `orchestrationProgress.ts` / `ProgressCard.tsx` 를 확장한다. 에러 분류는 새 순수 모듈 `orchestrationError.ts` 가 맡아 원문을 절대 사용자 문구로 쓰지 않고, 원문은 Phase 1 의 `ChatEntry.raw` + "원문 보기" 토글로만 접근하게 한다. 승인 대기는 지금 `working` 에 묻혀 있는데 이를 별도 `blocked` 상태로 분리해 경고색과 조치 버튼을 붙인다.

**Tech Stack:** React 19 + TypeScript(strict) + Vitest + @testing-library/react, Tailwind 유틸 + 디자인 토큰 CSS 변수.

## ⚠️ 스펙 대비 축소 — 작업별 토큰은 산출하지 않는다

스펙 §Phase 3 수용 기준은 "완료 카드에 **토큰**·시간 표시"이고, 변경란은 "새 백엔드 없이 기존 usage 데이터 활용"으로 제약한다. **이 둘은 양립하지 않는다.** 실측 결과:

- 사용량 엔드포인트는 `/usage/accounts` 하나뿐이다(`src/cli_agent_orchestrator/api/usage_router.py:56`).
- 반환은 provider별 `today`/`week` 총계 + `by_model_today` 뿐이고 CAO 세션·터미널·턴 스코프가 없다.
- 집계 서비스(`services/usage/claude_transcripts.py`, `codex_rollouts.py`)도 CLI 자체 트랜스크립트/롤아웃 파일을 날짜로만 스캔한다. CAO terminal 과 이어 붙일 키가 없다.
- 턴 시작·종료 시점의 provider 총계 delta 를 쓰는 우회는 **거부한다.** 같은 머신에서 다른 CAO 세션과 사람이 직접 쓰는 CLI 가 동시에 돌면 delta 에 남의 사용량이 섞인다. 그럴듯한 숫자를 만들어 "이 작업의 비용"이라 붙이는 것은 공통 원칙의 "가짜 데이터/빈 성공 화면 금지" 위반이다.

따라서 이 플랜은 **시간만** 다룬다(턴 경과 + 워커별 경과). 작업별 토큰을 정직하게 표시하려면 백엔드에서 terminal↔transcript 를 잇는 귀속 경로가 먼저 필요하며, 이는 별도 작업이다. Task 5 에서 이 결론을 스펙 옆에 기록한다.

## Global Constraints

- 디자인 토큰(`var(--…)`)만 사용. 하드코딩 색 금지 — `node design-tokens/gen.mjs --check`.
- 사용 가능한 토큰: `--surface`, `--surface-2`, `--border`, `--text`, `--text-2`, `--text-3`, `--accent`, `--on-accent`, `--success`/`--success-bg`, `--info`/`--info-bg`, `--warning`/`--warning-bg`, `--danger`/`--danger-bg`.
- UI 문자열은 한국어. **에러 원문·스택·내부 식별자를 사용자 문구로 노출하지 않는다.** 원문은 `raw` 에만 담아 "원문 보기" 뒤에 둔다.
- capability 기반: 모르는 건 추정하지 않는다.
- 진행 카드는 표시 전용 — 새 폴링/터미널 read 금지. 조치 버튼은 사용자 클릭에만 반응한다.
- `localStorage` 스키마는 additive-optional 만.
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`.
- 베이스라인(브랜치 `phase3-error-cost`, `3d201a9`): tsc 0, vitest `466/466`, build ✓, backend `4784 passed / 14 skipped`.

## File Structure

**신규**
- `web/src/features/workspace/orchestrationError.ts` — 순수 에러 분류. `ApiError`(status/detail)와 `AbortError` 를 사용자향 한국어 문구로 매핑. React·DOM 의존 없음.
- `web/src/test/orchestration-error.test.ts`
- `web/src/test/workspace-progress-actions.test.tsx`

**수정**
- `web/src/features/workspace/orchestrationProgress.ts` — `WorkerState` 에 `blocked` 추가, `workerStateFor` 분기, 워커별 `elapsedMs`.
- `web/src/features/workspace/types.ts` — `ChatEntry.retryPrompt?: string`.
- `web/src/features/workspace/orchestratorChat.ts` — `retryPrompt` 왕복 보존 + 가드.
- `web/src/features/workspace/useWorkspaceSession.ts` — 전송 실패·타임아웃 경로를 분류기로 교체, 원문 `raw` 보존, `retryPrompt` 기록.
- `web/src/features/workspace/ProgressCard.tsx` — `blocked`/`error` 강조 + 조치 버튼.
- `web/src/features/workspace/Thread.tsx` — 조치 콜백 전달, 에러 말풍선의 "다시 보내기".
- `web/src/features/workspace/Workspace.tsx` — 콜백 배선.
- `web/src/test/orchestration-progress.test.ts` — `WAITING_USER_ANSWER` 계약 변경 반영.
- `docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md` — Phase 3 토큰 항목에 실측 결론 주석.

---

### Task 1: 에러 분류 순수 모듈

**Files:**
- Create: `web/src/features/workspace/orchestrationError.ts`
- Test: `web/src/test/orchestration-error.test.ts`

**Interfaces:**
- Consumes: `ApiError`(`../../api`) 형태 — `{ name?, message?, status?: number, detail?: string }`.
- Produces: 타입 `OrchestrationErrorKind = 'network' | 'timeout' | 'auth' | 'notfound' | 'server' | 'unknown'`, 인터페이스 `ClassifiedError { kind; userMessage: string; raw?: string }`, 함수 `classifyOrchestrationError(error: unknown): ClassifiedError`, `pendingTimeoutMessage(): string`.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/orchestration-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyOrchestrationError, pendingTimeoutMessage } from '../features/workspace/orchestrationError'

function apiError(status: number, detail?: string, message = `${status} err`): Error & { status: number; detail?: string } {
  const err = new Error(message) as Error & { status: number; detail?: string }
  err.status = status
  if (detail !== undefined) err.detail = detail
  return err
}

describe('classifyOrchestrationError', () => {
  it('maps an aborted request to a timeout, not a generic failure', () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    const result = classifyOrchestrationError(err)
    expect(result.kind).toBe('timeout')
    expect(result.userMessage).toBe('요청이 제한 시간 안에 끝나지 않았어요. 잠시 후 다시 시도해 주세요.')
  })

  it('maps a status-less failure to a connection problem', () => {
    const result = classifyOrchestrationError(new TypeError('Failed to fetch'))
    expect(result.kind).toBe('network')
    expect(result.userMessage).toBe('서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.')
  })

  it('maps 401 and 403 to an authentication problem', () => {
    expect(classifyOrchestrationError(apiError(401)).kind).toBe('auth')
    const result = classifyOrchestrationError(apiError(403))
    expect(result.kind).toBe('auth')
    expect(result.userMessage).toBe('이 작업을 수행할 권한이 없어요. CLI 로그인 상태를 확인해 주세요.')
  })

  it('maps 404 to a missing target', () => {
    const result = classifyOrchestrationError(apiError(404))
    expect(result.kind).toBe('notfound')
    expect(result.userMessage).toBe('대상 에이전트를 찾을 수 없어요. 이미 정리되었을 수 있어요.')
  })

  it('maps 5xx to a server-side failure', () => {
    expect(classifyOrchestrationError(apiError(500)).kind).toBe('server')
    expect(classifyOrchestrationError(apiError(503)).userMessage).toBe('서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
  })

  it('falls back to a generic message for an unmapped status', () => {
    const result = classifyOrchestrationError(apiError(418))
    expect(result.kind).toBe('unknown')
    expect(result.userMessage).toBe('메시지를 보내지 못했어요.')
  })

  it('never puts the server detail or the raw message into the user-facing text', () => {
    const result = classifyOrchestrationError(
      apiError(500, 'Traceback: /home/minsub57/secret/path.py line 42 KeyError token_abc123', '500 Internal Server Error'),
    )
    expect(result.userMessage).not.toContain('Traceback')
    expect(result.userMessage).not.toContain('token_abc123')
    expect(result.userMessage).not.toContain('/home/minsub57')
    expect(result.userMessage).not.toContain('500')
  })

  it('preserves the raw detail separately so the 원문 보기 toggle can show it', () => {
    const result = classifyOrchestrationError(apiError(500, 'KeyError: token', '500 Internal Server Error'))
    expect(result.raw).toContain('KeyError: token')
    expect(result.raw).toContain('500 Internal Server Error')
  })

  it('leaves raw undefined when there is nothing beyond the user message to show', () => {
    expect(classifyOrchestrationError(undefined).raw).toBeUndefined()
    expect(classifyOrchestrationError(undefined).kind).toBe('unknown')
  })
})

describe('pendingTimeoutMessage', () => {
  it('tells the user the turn is still running rather than claiming failure', () => {
    expect(pendingTimeoutMessage()).toBe(
      '응답이 아직 도착하지 않았어요. 오케스트레이터는 계속 작업 중일 수 있어요 — 잠시 후 새로고침해 확인해 주세요.',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/orchestration-error.test.ts`
Expected: FAIL — `Failed to resolve import "../features/workspace/orchestrationError"`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/workspace/orchestrationError.ts`:

```ts
// Phase 3 · 오케스트레이션 실패의 사용자향 분류.
//
// 원칙: 서버 detail, 스택, 경로, 토큰 같은 원문은 사용자 문구에 절대 넣지
// 않는다. 원문은 `raw` 로만 실어 보내고 화면에서는 Phase 1 의 "원문 보기"
// 토글 뒤에 둔다. 분류는 HTTP status 와 AbortError 만 보고 결정한다.

export type OrchestrationErrorKind = 'network' | 'timeout' | 'auth' | 'notfound' | 'server' | 'unknown'

export interface ClassifiedError {
  kind: OrchestrationErrorKind
  /** 사용자에게 그대로 보여줄 한국어 문구. 원문 파편을 포함하지 않는다. */
  userMessage: string
  /** 진단용 원문(서버 detail + 예외 message). 없으면 undefined. */
  raw?: string
}

const MESSAGE: Record<OrchestrationErrorKind, string> = {
  timeout: '요청이 제한 시간 안에 끝나지 않았어요. 잠시 후 다시 시도해 주세요.',
  network: '서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.',
  auth: '이 작업을 수행할 권한이 없어요. CLI 로그인 상태를 확인해 주세요.',
  notfound: '대상 에이전트를 찾을 수 없어요. 이미 정리되었을 수 있어요.',
  server: '서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  unknown: '메시지를 보내지 못했어요.',
}

function kindOf(error: { name?: string; status?: number } | null): OrchestrationErrorKind {
  if (!error) return 'unknown'
  if (error.name === 'AbortError') return 'timeout'
  const status = error.status
  if (typeof status !== 'number') return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'notfound'
  if (status >= 500) return 'server'
  return 'unknown'
}

export function classifyOrchestrationError(error: unknown): ClassifiedError {
  const err = (error && typeof error === 'object'
    ? (error as { name?: string; message?: string; status?: number; detail?: string })
    : null)
  const kind = kindOf(err)
  const parts = [err?.detail, err?.message].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  )
  return { kind, userMessage: MESSAGE[kind], ...(parts.length > 0 ? { raw: parts.join('\n') } : {}) }
}

/** 대기 타임아웃은 실패가 아니다 — 아직 진행 중일 수 있음을 알린다. */
export function pendingTimeoutMessage(): string {
  return '응답이 아직 도착하지 않았어요. 오케스트레이터는 계속 작업 중일 수 있어요 — 잠시 후 새로고침해 확인해 주세요.'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/orchestration-error.test.ts`
Expected: PASS — 10건 전부.

- [ ] **Step 5: Typecheck and commit**

```bash
cd web && npx tsc --noEmit
git add web/src/features/workspace/orchestrationError.ts web/src/test/orchestration-error.test.ts
git commit -m "feat(error): user-facing classification for orchestration failures"
```

---

### Task 2: 승인 대기를 별도 상태로 분리 + 워커별 경과시간

**Files:**
- Modify: `web/src/features/workspace/orchestrationProgress.ts`
- Test: `web/src/test/orchestration-progress.test.ts`

**Interfaces:**
- Produces: `WorkerState` 에 `'blocked'` 추가(`'waiting' | 'working' | 'blocked' | 'done' | 'error'`). `WorkerProgress` 에 `elapsedMs: number` 추가. `OrchestrationProgress` 에 `blockedCount: number`, `errorCount: number` 추가.

**계약 변경(의도적):** Phase 2 에서 `WAITING_USER_ANSWER` 는 `working` 이었다. Phase 3 부터 `blocked` 다. 승인 대기는 "일하는 중"이 아니라 "사람을 기다리는 중"이라 조치 버튼을 붙여야 하기 때문이다. 두 상태 모두 미종료로 취급하므로 stage 판정(`working`)은 그대로다.

- [ ] **Step 1: Write the failing test**

`web/src/test/orchestration-progress.test.ts` 의 기존 케이스를 수정하고 새 케이스를 추가한다.

기존 `it('treats PROCESSING and WAITING_USER_ANSWER as working', ...)` 를 다음으로 교체:

```ts
  it('treats PROCESSING as working and WAITING_USER_ANSWER as blocked', () => {
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'PROCESSING' })).toBe('working')
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'WAITING_USER_ANSWER' })).toBe('blocked')
  })
```

`describe('computeOrchestrationProgress', ...)` 안에 추가:

```ts
  it('keeps a blocked worker unfinished and counts it', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', agentName: 'codex_qa_terra' })],
      terminalStatuses: { w1: 'WAITING_USER_ANSWER' },
    })
    expect(progress!.stage).toBe('working')
    expect(progress!.blockedCount).toBe(1)
    expect(progress!.doneCount).toBe(0)
    expect(progress!.waitingForLabel).toBe(progress!.workers[0].roleLabel)
  })

  it('counts errored workers separately from completed ones', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [
        card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: T0 + 1000 }),
        card({ terminalId: 'w2', agentName: 'claude_scout_haiku', firstSeenAt: T0 + 2000 }),
      ],
      terminalStatuses: { w1: 'ERROR', w2: 'COMPLETED' },
    })
    expect(progress!.errorCount).toBe(1)
    expect(progress!.doneCount).toBe(2)
    expect(progress!.stage).toBe('callback')
  })

  it('reports how long each worker has been alive', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', firstSeenAt: T0 + 1000 })],
      terminalStatuses: { w1: 'PROCESSING' },
      now: T0 + 31_000,
    })
    expect(progress!.workers[0].elapsedMs).toBe(30_000)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts`
Expected: FAIL — `blocked` 미구현으로 `'working'` 반환, `blockedCount`/`errorCount`/`elapsedMs` 는 `undefined`.

- [ ] **Step 3: Write minimal implementation**

`orchestrationProgress.ts` 수정:

```ts
export type WorkerState = 'waiting' | 'working' | 'blocked' | 'done' | 'error'
```

```ts
export interface WorkerProgress {
  terminalId: string
  roleLabel: string
  provider: string | null
  state: WorkerState
  stalled: boolean
  firstSeenAt: number
  /** 이 워커가 살아 있은 시간. 턴 경과와 달리 워커 생성 시점 기준이다. */
  elapsedMs: number
}
```

```ts
export interface OrchestrationProgress {
  stage: OrchestrationStage
  elapsedMs: number
  workers: WorkerProgress[]
  waitingForLabel: string | null
  doneCount: number
  totalCount: number
  stalled: boolean
  /** 사람의 승인을 기다리며 멈춘 워커 수. */
  blockedCount: number
  /** 오류로 끝난 워커 수. doneCount 에도 포함된다(둘 다 "종료"). */
  errorCount: number
}
```

`workerStateFor` 의 상수와 분기:

```ts
const ENDED_STATES = new Set<WorkerState>(['done', 'error'])

export function workerStateFor(card: DelegationCard, statuses: Record<string, string>): WorkerState {
  if (card.killed) return 'done'
  const status = (statuses[card.terminalId] || card.status || '').toUpperCase()
  if (status === 'ERROR') return 'error'
  if (status === 'WAITING_USER_ANSWER') return 'blocked'
  if (status === 'PROCESSING') return 'working'
  if (status === 'COMPLETED') return 'done'
  return 'waiting'
}
```

(`WORKING_STATUSES` 상수는 더 이상 쓰이지 않으므로 제거한다.)

`computeOrchestrationProgress` 의 map 콜백에 `elapsedMs` 추가:

```ts
        elapsedMs: Math.max(0, now - card.firstSeenAt),
```

반환 객체에 두 카운트 추가:

```ts
    blockedCount: workers.filter(worker => worker.state === 'blocked').length,
    errorCount: workers.filter(worker => worker.state === 'error').length,
```

`waitingForLabel` 의 `stage === 'working'` 분기는 `active.find(w => w.state === 'working') ?? active[0]` 이므로 working 이 없고 blocked 만 있으면 blocked 워커가 선택된다 — 의도한 동작이라 수정 불필요.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts`
Expected: PASS — 기존 22건 + 신규 3건.

- [ ] **Step 5: Commit**

```bash
cd web && npx tsc --noEmit
git add web/src/features/workspace/orchestrationProgress.ts web/src/test/orchestration-progress.test.ts
git commit -m "feat(progress): split 승인 대기 into a blocked state + per-worker elapsed"
```

---

### Task 3: 전송 실패·타임아웃 경로를 분류기로 교체

**Files:**
- Modify: `web/src/features/workspace/types.ts`
- Modify: `web/src/features/workspace/orchestratorChat.ts`
- Modify: `web/src/features/workspace/useWorkspaceSession.ts`
- Test: `web/src/test/orchestration-error.test.ts` (저장 왕복 describe 추가)

**Interfaces:**
- Consumes: Task 1 의 `classifyOrchestrationError`, `pendingTimeoutMessage`.
- Produces: `ChatEntry.retryPrompt?: string` — 전송 실패한 원래 프롬프트. 이게 있으면 UI 가 "다시 보내기"를 띄운다.

- [ ] **Step 1: Write the failing test**

`web/src/test/orchestration-error.test.ts` 끝에 추가:

```ts
import { loadStoredChat, saveStoredChat } from '../features/workspace/orchestratorChat'

describe('stored chat round-trip of retryPrompt', () => {
  it('preserves retryPrompt so 다시 보내기 survives a reload', () => {
    window.localStorage.clear()
    saveStoredChat(
      'sess',
      [{ id: 'a1', role: 'assistant', content: '메시지를 보내지 못했어요.', ts: 1, retryPrompt: '테스트 돌려줘' }],
      '',
      null,
    )
    expect(loadStoredChat('sess').entries[0].retryPrompt).toBe('테스트 돌려줘')
  })

  it('drops a non-string retryPrompt from a tampered payload', () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'cao:session-chat:v2:sess',
      JSON.stringify({
        workspaceMessages: [{ id: 'a1', role: 'assistant', content: '실패', retryPrompt: { evil: true } }],
        lastOutput: '실패',
      }),
    )
    expect(loadStoredChat('sess').entries[0].retryPrompt).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/orchestration-error.test.ts -t 'retryPrompt'`
Expected: FAIL — `retryPrompt` 가 `undefined`(타입 에러 포함).

- [ ] **Step 3: Write minimal implementation**

`types.ts` 의 `ChatEntry` 에 추가:

```ts
  /** Assistant only: the prompt that failed to send, enabling a one-click 다시 보내기 (Phase 3). */
  retryPrompt?: string
```

`orchestratorChat.ts`:
- `StoredChatMessage` 에 `retryPrompt?: unknown` 추가.
- `loadStoredChat` 의 엔트리 생성부에서 문자열일 때만 싣는다:

```ts
    const entries: ChatEntry[] = cleaned.map((m, i) => {
      const { progress, retryPrompt, ...rest } = m
      const summary = readSummary(progress)
      const retry = typeof retryPrompt === 'string' && retryPrompt.length > 0 ? retryPrompt : undefined
      const ts = baseTs + i * 1000
      return {
        ...rest,
        ts,
        ...(summary ? { progress: summary } : {}),
        ...(retry ? { retryPrompt: retry } : {}),
      }
    })
```

- `saveStoredChat` 의 필드 선택에 `retryPrompt` 추가:

```ts
      .map(({ id, role, content, targetId, raw, progress, retryPrompt }) => ({
        id,
        role,
        content,
        ...(targetId ? { targetId } : {}),
        ...(raw ? { raw } : {}),
        ...(progress ? { progress } : {}),
        ...(retryPrompt ? { retryPrompt } : {}),
      }))
```

`useWorkspaceSession.ts`:
- import 추가: `import { classifyOrchestrationError, pendingTimeoutMessage } from './orchestrationError'`
- `replaceChatEntry` 에 네 번째가 아닌 **옵션 객체**를 쓰도록 확장하면 호출부가 흔들리므로, 대신 다섯 번째 인자를 붙이지 말고 전용 헬퍼를 하나 더 둔다:

```ts
  const failChatEntry = useCallback(
    (id: string, classified: ClassifiedError, retryPrompt?: string) => {
      setChatEntries(current =>
        current.map(e =>
          e.id === id
            ? {
                ...e,
                content: classified.userMessage,
                ...(classified.raw !== undefined ? { raw: classified.raw } : {}),
                ...(retryPrompt !== undefined ? { retryPrompt } : {}),
              }
            : e,
        ),
      )
    },
    [],
  )
```

(`ClassifiedError` 는 `./orchestrationError` 에서 type import.)

- 전송 실패 catch(현재 `useWorkspaceSession.ts:347-351`)를 교체:

```ts
      } catch (error: unknown) {
        failChatEntry(replyId, classifyOrchestrationError(error), prompt)
        setPendingReply(null)
        setSending(false)
      }
```

- `sendMessage` 의 의존성 배열에서 `replaceChatEntry` 를 `failChatEntry` 로 바꾼다(같은 콜백에서 `replaceChatEntry` 를 더 쓰지 않으면 제거).

- 타임아웃 경로(현재 `useWorkspaceSession.ts:434`)를 교체:

```ts
      replaceChatEntry(pendingReply.messageId, pendingTimeoutMessage())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/orchestration-error.test.ts`
Expected: PASS — 12건 전부.

- [ ] **Step 5: Guard the existing suites**

Run: `cd web && npx vitest run src/test/workspace.test.tsx src/test/orchestration-progress.test.ts src/test/session-chat.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc 0 error.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/types.ts web/src/features/workspace/orchestratorChat.ts web/src/features/workspace/useWorkspaceSession.ts web/src/test/orchestration-error.test.ts
git commit -m "fix(error): stop leaking raw server detail into the chat, keep it behind 원문 보기"
```

---

### Task 4: 진행 카드의 오류·승인대기 강조 + 원클릭 조치

**Files:**
- Modify: `web/src/features/workspace/ProgressCard.tsx`
- Modify: `web/src/features/workspace/Thread.tsx`
- Modify: `web/src/features/workspace/Workspace.tsx`
- Test: `web/src/test/workspace-progress-actions.test.tsx`

**Interfaces:**
- Consumes: Task 2 의 `blocked`/`errorCount`/`blockedCount`/`elapsedMs`, Task 3 의 `ChatEntry.retryPrompt`.
- Produces: `ProgressCard` props 에 `onOpenWorker: (terminalId: string) => void` 추가. `ThreadProps` 에 `onRetry: (prompt: string) => void` 추가. `ChatBubble` props 에 `onRetry?: (prompt: string) => void` 추가.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/workspace-progress-actions.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressCard } from '../features/workspace/ProgressCard'
import { ChatBubble } from '../features/workspace/Thread'
import type { DelegationCard } from '../features/workspace/types'

const T0 = Date.now() - 65_000

function card(over: Partial<DelegationCard> & { terminalId: string }): DelegationCard {
  return {
    sessionId: null,
    agentName: null,
    provider: null,
    callerId: null,
    callerAgentName: null,
    status: null,
    prevStatus: null,
    location: null,
    locationLoaded: false,
    instruction: null,
    instructionType: null,
    instructionFromId: null,
    killed: false,
    lastActivityAt: null,
    lastOutputAt: null,
    firstSeenAt: T0 + 1000,
    hasSignal: true,
    ...over,
  }
}

describe('ProgressCard blocked/error handling', () => {
  it('labels a 승인 대기 worker and offers a one-click jump to its terminal', () => {
    const onOpenWorker = vi.fn()
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'WAITING_USER_ANSWER' }}
        onOpenWorker={onOpenWorker}
      />,
    )
    expect(screen.getByText('승인 대기')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '승인하러 가기' }))
    expect(onOpenWorker).toHaveBeenCalledWith('w1')
  })

  it('labels an errored worker and offers a one-click jump to its terminal', () => {
    const onOpenWorker = vi.fn()
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'ERROR' }}
        onOpenWorker={onOpenWorker}
      />,
    )
    expect(screen.getByText('오류')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '오류 확인' }))
    expect(onOpenWorker).toHaveBeenCalledWith('w1')
  })

  it('offers no action button for a healthy worker', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '승인하러 가기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '오류 확인' })).toBeNull()
  })

  it('summarises blocked and errored counts in the header', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[
          card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: T0 + 1000 }),
          card({ terminalId: 'w2', agentName: 'claude_scout_haiku', firstSeenAt: T0 + 2000 }),
        ]}
        terminalStatuses={{ w1: 'WAITING_USER_ANSWER', w2: 'ERROR' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.getByText('승인 대기 1 · 오류 1')).toBeTruthy()
  })

  it('shows each worker its own elapsed time', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: Date.now() - 30_000 })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
        onOpenWorker={() => {}}
      />,
    )
    expect(screen.getByText('30초')).toBeTruthy()
  })
})

describe('ChatBubble retry action', () => {
  it('offers 다시 보내기 on a failed send and passes the original prompt back', () => {
    const onRetry = vi.fn()
    render(
      <ChatBubble
        entry={{
          id: 'a1',
          role: 'assistant',
          content: '서버에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.',
          ts: T0,
          retryPrompt: '테스트 돌려줘',
        }}
        onRetry={onRetry}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    expect(onRetry).toHaveBeenCalledWith('테스트 돌려줘')
  })

  it('offers no retry when the entry did not fail', () => {
    render(<ChatBubble entry={{ id: 'a1', role: 'assistant', content: '완료', ts: T0 }} onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/workspace-progress-actions.test.tsx`
Expected: FAIL — `onOpenWorker`/`onRetry` 미구현, 라벨·버튼 없음.

- [ ] **Step 3: Write minimal implementation**

`ProgressCard.tsx`:

```tsx
const STATE_LABEL: Record<WorkerState, string> = {
  waiting: '대기',
  working: '작업 중',
  blocked: '승인 대기',
  done: '완료',
  error: '오류',
}

const STATE_CLASS: Record<WorkerState, string> = {
  waiting: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)]',
  working: 'border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]',
  blocked: 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]',
  done: 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]',
  error: 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]',
}

const ACTION_LABEL: Partial<Record<WorkerState, string>> = {
  blocked: '승인하러 가기',
  error: '오류 확인',
}
```

props 에 `onOpenWorker: (terminalId: string) => void` 추가. 카드 루트에 위험도 테두리:

```tsx
      className={`ml-10 max-w-[calc(86%-40px)] rounded-2xl border bg-[var(--surface)] p-3 shadow-sm ${
        progress.errorCount > 0
          ? 'border-[var(--danger)]'
          : progress.blockedCount > 0
            ? 'border-[var(--warning)]'
            : 'border-[var(--border)]'
      }`}
```

헤더의 `0/1 완료` 옆에 문제 요약을 추가한다(둘 중 하나라도 있을 때만):

```tsx
      {(progress.blockedCount > 0 || progress.errorCount > 0) && (
        <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">
          승인 대기 {progress.blockedCount} · 오류 {progress.errorCount}
        </p>
      )}
```

워커 행에 경과시간과 조치 버튼:

```tsx
              <span className="text-[10px] text-[var(--text-3)]">{formatElapsed(worker.elapsedMs)}</span>
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATE_CLASS[worker.state]}`}>
                {STATE_LABEL[worker.state]}
              </span>
              {ACTION_LABEL[worker.state] && (
                <button
                  type="button"
                  onClick={() => onOpenWorker(worker.terminalId)}
                  className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-2)] hover:text-[var(--text)]"
                >
                  {ACTION_LABEL[worker.state]}
                </button>
              )}
```

`Thread.tsx`:
- `ChatBubble` 시그니처를 `{ entry, onRetry }: { entry: ChatEntry; onRetry?: (prompt: string) => void }` 로 확장하고, 본문 뒤에 버튼을 추가한다:

```tsx
        {entry.retryPrompt && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(entry.retryPrompt as string)}
            className="mt-1.5 block text-[10px] font-semibold text-[var(--danger)] hover:underline"
          >
            다시 보내기
          </button>
        )}
```

- `ThreadProps` 에 `onRetry: (prompt: string) => void` 추가, 구조분해에 포함.
- 렌더 분기의 `<ChatBubble key={item.id} entry={item.entry} />` 를 `<ChatBubble key={item.id} entry={item.entry} onRetry={onRetry} />` 로.
- `<ProgressCard ... />` 호출에 `onOpenWorker={onOpenTerminal}` 추가.

`Workspace.tsx` 의 `<Thread .../>` 에 추가:

```tsx
                onRetry={prompt => void workspaceSession.sendMessage(prompt)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/workspace-progress-actions.test.tsx src/test/workspace-progress-card.test.tsx src/test/workspace-progress-wiring.test.tsx`
Expected: PASS. `workspace-progress-wiring.test.tsx` 의 `threadProps` 에 `onRetry: () => {}` 를 추가해야 타입이 맞는다.

- [ ] **Step 5: Full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build && node ../design-tokens/gen.mjs --check`
Expected: tsc 0 error, vitest 전부 통과(기존 466 중 실패 0), build ✓, 토큰 체크 통과.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/ProgressCard.tsx web/src/features/workspace/Thread.tsx web/src/features/workspace/Workspace.tsx web/src/test/workspace-progress-actions.test.tsx web/src/test/workspace-progress-wiring.test.tsx
git commit -m "feat(progress): highlight 승인 대기/오류 with one-click actions + per-worker elapsed"
```

---

### Task 5: 토큰 미표시 결론을 스펙 옆에 기록

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md` (Phase 3 절)

- [ ] **Step 1: 스펙에 실측 결론 추가**

`## Phase 3 · 에러·비용` 절의 **수용 기준** 줄 바로 뒤에 추가:

```markdown
> **2026-07-27 실측 — 작업별 토큰은 이 수용 기준에서 제외한다.**
> 사용량 경로는 `/usage/accounts` 하나뿐이고(`api/usage_router.py:56`) provider별 `today`/`week`
> 총계와 `by_model_today` 만 반환한다. 집계 서비스(`services/usage/claude_transcripts.py`,
> `codex_rollouts.py`)는 CLI 트랜스크립트/롤아웃 파일을 날짜로만 스캔하며 CAO session·terminal 과
> 이어 붙일 키가 없다. 턴 전후 provider 총계 delta 로 대신하는 우회는 같은 머신의 다른 세션·수동
> CLI 사용량이 섞여 들어가 "이 작업의 비용"으로 제시할 수 없다(가짜 데이터 금지).
> 따라서 Phase 3 은 **시간만** 표시한다. 작업별 토큰은 backend 에서 terminal↔transcript 귀속
> 경로를 먼저 만든 뒤 별도 작업으로 다룬다.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md
git commit -m "docs(spec): record why per-task token cost is out of Phase 3 scope"
```

---

## 수용 기준 대조

| 스펙 요구 | 상태 |
|---|---|
| 워커 실패·승인대기를 진행카드에 눈에 띄게(색/아이콘) | Task 2 `blocked`/`error` 분리 + Task 4 경고/위험 토큰 색·테두리·헤더 요약 |
| 원클릭 조치(재시도 / 승인 이동) | Task 4 — 워커 행의 `승인하러 가기`/`오류 확인`(터미널로 이동), 실패한 전송의 `다시 보내기` |
| `statusColor.ts` 연계 | 같은 토큰 팔레트(`--warning`/`--danger`/`--info`/`--success`)를 사용. `statusDotColor` 의 규칙과 동일 매핑 |
| 에러 원문 노출 금지 | Task 1·3 — 사용자 문구는 고정 문구 6종, 원문은 `raw` → `원문 보기` |
| 진행카드/완료 요약에 경과 | Task 2 워커별 `elapsedMs` + Phase 2 의 턴 경과·완료 요약 소요시간 |
| 완료 카드에 **토큰** | ❌ **제외** — 기존 데이터로 산출 불가. Task 5 에 사유 기록 |
| 세션 누적은 기존 usage 위젯과 연계 | 기존 `UsageButton`(상단)·`InlineUsageBar`(우측 패널) 유지. 중복 표시를 만들지 않음 |

## 남은 것 (이 플랜 범위 밖)

- 작업별 토큰 귀속: backend 에서 terminal ↔ CLI transcript 를 잇는 경로가 선행돼야 한다.
- 오른쪽 패널 `DelegationHierarchy` 가 자동 정리된 handoff 워커를 계속 "작업 중"으로 집계하는 기존 결함(`.omo/evidence/phase2-live-2026-07-27/report.md` 참조). Phase 4-C 소관이라 별건.
- 실서버 라이브 확인: 오류/승인대기 상태는 실제로 재현이 까다롭다. 최소한 승인 대기(`WAITING_USER_ANSWER`)는 승인 정책을 `on-request` 로 둔 프로필로 재현 가능하다.
