# Phase 2 · 실시간 진행 카드 (채팅 인라인 라이브 진행) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오케스트레이터 응답을 기다리는 동안, 지금 어떤 워커가 무슨 단계에 있고 얼마나 걸렸는지를 채팅 스레드 안의 라이브 카드로 보여주고, 응답이 도착하면 그 카드를 한 줄 완료 요약으로 접는다.

**Architecture:** 순수 계산(`orchestrationProgress.ts`)과 표시(`ProgressCard.tsx`)를 분리한다. 상태원은 새로 만들지 않는다 — 이미 `useWorkspaceSession`이 보유한 `cards`(DelegationCard[]), `terminalStatuses`, `supervisorTerminalId`와, `WorkspacePendingReply`에 additive로 얹는 `startedAt` 하나만 쓴다. 오른쪽 `AgentSidePanel`과 같은 데이터를 읽으므로 상태 불일치가 구조적으로 생기지 않는다. 응답이 확정되는 순간의 스냅샷을 `ChatEntry.progress` 요약으로 굳혀 localStorage 왕복 후에도 완료 요약이 남는다.

**Tech Stack:** React 19 + TypeScript(strict) + Vitest + @testing-library/react, Tailwind 유틸 + 디자인 토큰 CSS 변수.

## Global Constraints

- 디자인 토큰(`var(--…)`)만 사용한다. 하드코딩 색 금지 — 게이트는 `node design-tokens/gen.mjs --check`.
- 사용 가능한 토큰: `--surface`, `--surface-2`, `--border`, `--text`, `--text-3`, `--accent`, `--on-accent`, `--success`/`--success-bg`, `--info`/`--info-bg`, `--warning`/`--warning-bg`, `--danger`/`--danger-bg`.
- UI 문자열은 한국어. 사용자에게 내부 식별자·프로필 ID·마커를 노출하지 않는다 — 프로필 ID는 반드시 `profileLabel()`을 거친다.
- capability 기반: 데이터가 없으면 정직한 빈 상태를 쓴다. 경과시간·워커 수를 추정해서 채우지 않는다.
- 진행 카드는 **표시 전용**이다. 워커 터미널 output/read 를 새로 유발하는 폴링을 추가하지 않는다(과거 "환각 orca 폴링" 회귀 금지).
- `localStorage` 스키마 변경은 additive-optional 만 허용한다. 기존 저장분이 그대로 로드돼야 한다.
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`.
- 베이스라인(2026-07-27, `e73ce5d`): backend `4784 passed / 14 skipped`, vitest `432/432`, tsc 0 error, build ✓.

## File Structure

**신규**
- `web/src/features/workspace/orchestrationProgress.ts` — 순수 계산. 경과시간 포맷터, 워커 상태 판정, 턴 단위 진행 요약, 완료 스냅샷 생성. React 의존 없음.
- `web/src/features/workspace/ProgressCard.tsx` — 라이브 진행 카드 표시. 1초 tick 은 이 컴포넌트가 소유한다.
- `web/src/test/orchestration-progress.test.ts` — Task 1 단위 테스트.
- `web/src/test/workspace-progress-card.test.tsx` — Task 3 컴포넌트 테스트.
- `web/src/test/workspace-progress-wiring.test.tsx` — Task 4 통합 테스트.

**수정**
- `web/src/features/workspace/types.ts` — `ChatEntry.progress?: OrchestrationSummary` 추가.
- `web/src/features/workspace/orchestratorChat.ts` — `WorkspacePendingReply.startedAt?`, `StoredChatMessage.progress?` 왕복 보존.
- `web/src/features/workspace/useWorkspaceSession.ts` — `startedAt` 기록, `replaceChatEntry` 4번째 인자, 확정 시 완료 요약 굳히기, `pendingSince`/`pendingMessageId` 노출.
- `web/src/features/workspace/Thread.tsx` — WAITING 버블 자리에 `ProgressCard`, `ChatBubble`에 완료 요약 줄.
- `web/src/features/workspace/Workspace.tsx` — Thread 에 신규 props 전달.

---

### Task 1: 순수 진행 계산 모듈

**Files:**
- Create: `web/src/features/workspace/orchestrationProgress.ts`
- Test: `web/src/test/orchestration-progress.test.ts`

**Interfaces:**
- Consumes: `DelegationCard`(`./types`), `computeStall`(`./stall`), `profileLabel`(`../profiles/profilePresentation`).
- Produces: 타입 `OrchestrationStage`, `WorkerState`, `WorkerProgress`, `OrchestrationProgress`, `OrchestrationSummary`. 함수 `formatElapsed(ms: number): string`, `workerStateFor(card: DelegationCard, statuses: Record<string, string>): WorkerState`, `computeOrchestrationProgress(params): OrchestrationProgress | null`, `summarizeOrchestration(progress: OrchestrationProgress | null): OrchestrationSummary | undefined`.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/orchestration-progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  computeOrchestrationProgress,
  formatElapsed,
  summarizeOrchestration,
  workerStateFor,
} from '../features/workspace/orchestrationProgress'
import type { DelegationCard } from '../features/workspace/types'

const T0 = 1_700_000_000_000

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

describe('formatElapsed', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatElapsed(0)).toBe('0초')
    expect(formatElapsed(12_400)).toBe('12초')
  })

  it('renders minutes with seconds, dropping a zero seconds remainder', () => {
    expect(formatElapsed(125_000)).toBe('2분 5초')
    expect(formatElapsed(180_000)).toBe('3분')
  })

  it('renders hours with minutes', () => {
    expect(formatElapsed(3_600_000)).toBe('1시간')
    expect(formatElapsed(3_780_000)).toBe('1시간 3분')
  })

  it('never renders a negative or non-finite duration', () => {
    expect(formatElapsed(-5000)).toBe('0초')
    expect(formatElapsed(Number.NaN)).toBe('0초')
  })
})

describe('workerStateFor', () => {
  it('reports a killed card as done regardless of live status', () => {
    expect(workerStateFor(card({ terminalId: 'w1', killed: true }), { w1: 'PROCESSING' })).toBe('done')
  })

  it('reports error before working', () => {
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'ERROR' })).toBe('error')
  })

  it('treats PROCESSING and WAITING_USER_ANSWER as working', () => {
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'PROCESSING' })).toBe('working')
    expect(workerStateFor(card({ terminalId: 'w1' }), { w1: 'WAITING_USER_ANSWER' })).toBe('working')
  })

  it('falls back to the card status when no live status is known', () => {
    expect(workerStateFor(card({ terminalId: 'w1', status: 'completed' }), {})).toBe('done')
    expect(workerStateFor(card({ terminalId: 'w1' }), {})).toBe('waiting')
  })
})

describe('computeOrchestrationProgress', () => {
  const base = { supervisorTerminalId: 'sup', terminalStatuses: {}, now: T0 + 5000 }

  it('returns null when no turn is pending', () => {
    expect(computeOrchestrationProgress({ ...base, pendingSince: null, cards: [] })).toBeNull()
  })

  it('reports dispatching while no worker of this turn exists yet', () => {
    const progress = computeOrchestrationProgress({ ...base, pendingSince: T0, cards: [] })
    expect(progress).not.toBeNull()
    expect(progress!.stage).toBe('dispatching')
    expect(progress!.totalCount).toBe(0)
    expect(progress!.waitingForLabel).toBeNull()
    expect(progress!.elapsedMs).toBe(5000)
  })

  it('excludes the supervisor and workers left over from an earlier turn', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [
        card({ terminalId: 'sup', firstSeenAt: T0 - 60_000 }),
        card({ terminalId: 'old', firstSeenAt: T0 - 60_000 }),
        card({ terminalId: 'w1', agentName: 'codex_qa_terra' }),
      ],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.workers.map(w => w.terminalId)).toEqual(['w1'])
  })

  it('reports working and names the worker it is waiting on, via the display label', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', agentName: 'codex_qa_terra', provider: 'codex' })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.stage).toBe('working')
    expect(progress!.workers[0].roleLabel).not.toBe('codex_qa_terra')
    expect(progress!.waitingForLabel).toBe(progress!.workers[0].roleLabel)
    expect(progress!.doneCount).toBe(0)
    expect(progress!.totalCount).toBe(1)
  })

  it('reports callback once every worker has ended but the reply has not landed', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [
        card({ terminalId: 'w1', agentName: 'codex_qa_terra', firstSeenAt: T0 + 1000 }),
        card({ terminalId: 'w2', agentName: 'claude_scout_haiku', firstSeenAt: T0 + 2000, killed: true }),
      ],
      terminalStatuses: { w1: 'COMPLETED' },
    })
    expect(progress!.stage).toBe('callback')
    expect(progress!.doneCount).toBe(2)
    // the most recently finished worker is the one whose callback is awaited
    expect(progress!.waitingForLabel).toBe(progress!.workers[1].roleLabel)
  })

  it('flags a stall from the shared stall calculation', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', status: 'processing', firstSeenAt: T0 })],
      terminalStatuses: { w1: 'PROCESSING' },
      now: T0 + 6 * 60 * 1000,
    })
    expect(progress!.stalled).toBe(true)
    expect(progress!.workers[0].stalled).toBe(true)
  })

  it('tolerates a create event timestamped slightly before the local send', () => {
    const progress = computeOrchestrationProgress({
      ...base,
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', firstSeenAt: T0 - 1500 })],
      terminalStatuses: { w1: 'PROCESSING' },
    })
    expect(progress!.workers.map(w => w.terminalId)).toEqual(['w1'])
  })
})

describe('summarizeOrchestration', () => {
  it('returns undefined when nothing was pending', () => {
    expect(summarizeOrchestration(null)).toBeUndefined()
  })

  it('returns undefined when the turn delegated to nobody', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [],
      terminalStatuses: {},
      now: T0 + 5000,
    })
    expect(summarizeOrchestration(progress)).toBeUndefined()
  })

  it('freezes worker count, duration and labels', () => {
    const progress = computeOrchestrationProgress({
      supervisorTerminalId: 'sup',
      pendingSince: T0,
      cards: [card({ terminalId: 'w1', agentName: 'codex_qa_terra' })],
      terminalStatuses: { w1: 'COMPLETED' },
      now: T0 + 125_000,
    })
    const summary = summarizeOrchestration(progress)
    expect(summary).toEqual({
      workerCount: 1,
      durationMs: 125_000,
      workerLabels: [progress!.workers[0].roleLabel],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts`
Expected: FAIL — `Failed to resolve import "../features/workspace/orchestrationProgress"`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/workspace/orchestrationProgress.ts`:

```ts
// Phase 2 · 채팅 인라인 라이브 진행카드의 순수 계산부.
//
// 상태원을 새로 만들지 않는다 — AgentSidePanel 이 읽는 것과 같은
// DelegationCard[] + terminalStatuses 만 읽고, "이번 턴"의 경계는
// pendingSince(사용자가 프롬프트를 보낸 로컬 시각) 하나로 정한다.
// 표시 전용이므로 여기서 어떤 워커 터미널도 읽지 않는다.
import { computeStall } from './stall'
import { profileLabel } from '../profiles/profilePresentation'
import type { DelegationCard } from './types'

/** 워커 create 이벤트의 서버 timestamp 가 로컬 전송 시각보다 살짝 앞설 수 있어 그만큼만 관대하게 본다. */
export const TURN_GRACE_MS = 2000

export type OrchestrationStage = 'dispatching' | 'working' | 'callback'
export type WorkerState = 'waiting' | 'working' | 'done' | 'error'

export interface WorkerProgress {
  terminalId: string
  /** 사용자용 역할명. 프로필 ID 를 그대로 노출하지 않는다. */
  roleLabel: string
  provider: string | null
  state: WorkerState
  stalled: boolean
  firstSeenAt: number
}

export interface OrchestrationProgress {
  stage: OrchestrationStage
  elapsedMs: number
  workers: WorkerProgress[]
  /** 지금 콜백을 기다리는 대상의 역할명. 아직 배정 전이면 null. */
  waitingForLabel: string | null
  doneCount: number
  totalCount: number
  stalled: boolean
}

/** 응답 확정 시점에 굳혀 ChatEntry 에 붙는 스냅샷(로컬 저장 왕복 대상). */
export interface OrchestrationSummary {
  workerCount: number
  durationMs: number
  workerLabels: string[]
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0초'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}초`

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60
    return seconds === 0 ? `${totalMinutes}분` : `${totalMinutes}분 ${seconds}초`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`
}

const WORKING_STATUSES = new Set(['PROCESSING', 'WAITING_USER_ANSWER'])
const ENDED_STATES = new Set<WorkerState>(['done', 'error'])

export function workerStateFor(card: DelegationCard, statuses: Record<string, string>): WorkerState {
  if (card.killed) return 'done'
  const status = (statuses[card.terminalId] || card.status || '').toUpperCase()
  if (status === 'ERROR') return 'error'
  if (WORKING_STATUSES.has(status)) return 'working'
  if (status === 'COMPLETED') return 'done'
  return 'waiting'
}

export function computeOrchestrationProgress(params: {
  pendingSince: number | null
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  terminalStatuses: Record<string, string>
  now: number
}): OrchestrationProgress | null {
  const { pendingSince, supervisorTerminalId, cards, terminalStatuses, now } = params
  if (pendingSince === null) return null

  const workers: WorkerProgress[] = cards
    .filter(card => card.terminalId !== supervisorTerminalId)
    .filter(card => card.firstSeenAt >= pendingSince - TURN_GRACE_MS)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .map(card => {
      const state = workerStateFor(card, terminalStatuses)
      const liveStatus = terminalStatuses[card.terminalId]
      const stall = computeStall({ ...card, status: liveStatus ? liveStatus.toLowerCase() : card.status }, now)
      return {
        terminalId: card.terminalId,
        roleLabel: card.agentName ? profileLabel(card.agentName) : card.terminalId.slice(0, 8),
        provider: card.provider,
        state,
        stalled: stall.stalled,
        firstSeenAt: card.firstSeenAt,
      }
    })

  const active = workers.filter(worker => !ENDED_STATES.has(worker.state))
  const stage: OrchestrationStage =
    workers.length === 0 ? 'dispatching' : active.length > 0 ? 'working' : 'callback'

  let waitingForLabel: string | null = null
  if (stage === 'working') {
    waitingForLabel = (active.find(worker => worker.state === 'working') ?? active[0]).roleLabel
  } else if (stage === 'callback') {
    waitingForLabel = workers[workers.length - 1].roleLabel
  }

  return {
    stage,
    elapsedMs: Math.max(0, now - pendingSince),
    workers,
    waitingForLabel,
    doneCount: workers.filter(worker => ENDED_STATES.has(worker.state)).length,
    totalCount: workers.length,
    stalled: workers.some(worker => worker.stalled),
  }
}

export function summarizeOrchestration(progress: OrchestrationProgress | null): OrchestrationSummary | undefined {
  if (!progress || progress.workers.length === 0) return undefined
  return {
    workerCount: progress.workers.length,
    durationMs: progress.elapsedMs,
    workerLabels: progress.workers.map(worker => worker.roleLabel),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts`
Expected: PASS — 모든 케이스 통과.

- [ ] **Step 5: Typecheck and commit**

```bash
cd web && npx tsc --noEmit
git add web/src/features/workspace/orchestrationProgress.ts web/src/test/orchestration-progress.test.ts
git commit -m "feat(progress): pure orchestration-turn progress model + elapsed formatter"
```

---

### Task 2: 턴 시작시각 기록 · 완료 요약 굳히기

**Files:**
- Modify: `web/src/features/workspace/types.ts` (`ChatEntry`)
- Modify: `web/src/features/workspace/orchestratorChat.ts` (`WorkspacePendingReply`, `StoredChatMessage`, `loadStoredChat`, `saveStoredChat`)
- Modify: `web/src/features/workspace/useWorkspaceSession.ts` (`replaceChatEntry`, `sendMessage`, poll 확정부, 반환값)
- Test: `web/src/test/orchestration-progress.test.ts` (저장 왕복 describe 추가)

**Interfaces:**
- Consumes: Task 1 의 `OrchestrationSummary`, `computeOrchestrationProgress`, `summarizeOrchestration`.
- Produces: `WorkspacePendingReply.startedAt?: number`; `ChatEntry.progress?: OrchestrationSummary`; `replaceChatEntry(id, content, raw?, progress?)`; hook 반환에 `pendingSince: number | null`, `pendingMessageId: string | null` 추가.

- [ ] **Step 1: Write the failing test**

`web/src/test/orchestration-progress.test.ts` 끝에 추가:

```ts
import { loadStoredChat, saveStoredChat } from '../features/workspace/orchestratorChat'

describe('stored chat round-trip of the completion summary', () => {
  it('preserves ChatEntry.progress and pendingReply.startedAt', () => {
    window.localStorage.clear()
    saveStoredChat(
      'sess',
      [
        { id: 'a1', role: 'assistant', content: '끝났어요', ts: 1, progress: { workerCount: 2, durationMs: 61_000, workerLabels: ['테스트 담당', '탐색 담당'] } },
      ],
      '끝났어요',
      { messageId: 'a1', baseline: '', terminalId: 'sup', baselineGenerations: {}, baselineInboxMessageId: 0, startedAt: 12_345 },
    )
    const loaded = loadStoredChat('sess')
    expect(loaded.entries[0].progress).toEqual({
      workerCount: 2,
      durationMs: 61_000,
      workerLabels: ['테스트 담당', '탐색 담당'],
    })
    expect(loaded.pendingReply?.startedAt).toBe(12_345)
  })

  it('loads a legacy entry that has no progress field', () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'cao:session-chat:v2:sess',
      JSON.stringify({ workspaceMessages: [{ id: 'a1', role: 'assistant', content: '옛 답변' }], lastOutput: '옛 답변' }),
    )
    const loaded = loadStoredChat('sess')
    expect(loaded.entries[0].content).toBe('옛 답변')
    expect(loaded.entries[0].progress).toBeUndefined()
  })
})
```

확정된 계약: `saveStoredChat(sessionName, entries, lastOutput, pendingReply)`, 저장 키 접두사 `STORAGE_KEYS.sessionChat === 'cao:session-chat:v2:'`(`web/src/features/workspace/constants.ts:29`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts -t 'stored chat round-trip'`
Expected: FAIL — `progress` 가 `undefined`, `startedAt` 이 `undefined`(타입 에러도 함께 발생).

- [ ] **Step 3: Write minimal implementation**

`web/src/features/workspace/types.ts` — `ChatEntry` 에 필드 추가:

```ts
import type { OrchestrationSummary } from './orchestrationProgress'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  /** Set only when addressed to a non-supervisor terminal (composer target switched); undefined = supervisor conversation. */
  targetId?: string
  /** Assistant only: pre-cleaned original transcript, revealed by the "원문 보기" toggle. */
  raw?: string
  /** Assistant only: frozen snapshot of the orchestration turn that produced this reply (Phase 2). */
  progress?: OrchestrationSummary
}
```

`web/src/features/workspace/orchestratorChat.ts`:

```ts
export interface WorkspacePendingReply {
  messageId: string
  baseline: string
  terminalId: string
  baselineGenerations: Record<string, number>
  baselineInboxMessageId: number
  /** ms epoch when the prompt was sent. Optional — payloads stored before Phase 2 have none. */
  startedAt?: number
}
```

`StoredChatMessage` 에 `progress?: OrchestrationSummary` 를 추가하고, `loadStoredChat` 의 필터가 통과시킨 뒤 엔트리를 만들 때 `progress` 를 옮긴다. 변조된 localStorage 를 방어하기 위해 형태를 검증하는 좁은 가드를 쓴다:

```ts
function readSummary(value: unknown): OrchestrationSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<OrchestrationSummary>
  if (typeof candidate.workerCount !== 'number' || !Number.isFinite(candidate.workerCount)) return undefined
  if (typeof candidate.durationMs !== 'number' || !Number.isFinite(candidate.durationMs)) return undefined
  if (!Array.isArray(candidate.workerLabels) || candidate.workerLabels.some(label => typeof label !== 'string')) return undefined
  return { workerCount: candidate.workerCount, durationMs: candidate.durationMs, workerLabels: candidate.workerLabels }
}
```

엔트리 생성부에서는 `readSummary` 결과를 지역 변수로 뽑아 붙인다:

```ts
      const summary = readSummary(m.progress)
      return { ...entry, ...(summary ? { progress: summary } : {}) }
```

`saveStoredChat`(`orchestratorChat.ts:173-175`)은 필드를 골라 담으므로 `progress` 를 목록에 추가해야 한다:

```ts
    const workspaceMessages: StoredChatMessage[] = entries
      .slice(-100)
      .map(({ id, role, content, targetId, raw, progress }) => ({
        id,
        role,
        content,
        ...(targetId ? { targetId } : {}),
        ...(raw ? { raw } : {}),
        ...(progress ? { progress } : {}),
      }))
```

`web/src/features/workspace/useWorkspaceSession.ts`:

```ts
  const replaceChatEntry = useCallback(
    (id: string, content: string, raw?: string, progress?: OrchestrationSummary) => {
      setChatEntries(current =>
        current.map(e =>
          e.id === id
            ? { ...e, content, ...(raw !== undefined ? { raw } : {}), ...(progress !== undefined ? { progress } : {}) }
            : e,
        ),
      )
    },
    [],
  )
```

`sendMessage` 의 `nextPendingReply` 에 `startedAt: Date.now()` 를 추가한다.

폴링 확정부(현재 `replaceChatEntry(pendingReply.messageId, clean, outputResult.output || '')`)를 요약과 함께 호출하도록 바꾼다. 카드/상태는 effect 안에서 최신값이 필요하므로 ref 로 읽는다 — `cardsRef`, `terminalStatusesRef` 가 없으면 다음을 추가한다:

```ts
  const cardsRef = useRef<DelegationCard[]>([])
  const terminalStatusesRef = useRef<Record<string, string>>({})
  useEffect(() => { cardsRef.current = cards }, [cards])
  useEffect(() => { terminalStatusesRef.current = terminalStatuses }, [terminalStatuses])
```

확정부:

```ts
        const clean = formatOrchestratorOutput(outputResult.output || '')
        if (clean && clean !== pendingReply.baseline) {
          const summary = summarizeOrchestration(
            computeOrchestrationProgress({
              pendingSince: pendingReply.startedAt ?? null,
              supervisorTerminalId,
              cards: cardsRef.current,
              terminalStatuses: terminalStatusesRef.current,
              now: Date.now(),
            }),
          )
          replaceChatEntry(pendingReply.messageId, clean, outputResult.output || '', summary)
```

반환값에 추가:

```ts
    pendingSince: pendingReply?.startedAt ?? null,
    pendingMessageId: pendingReply?.messageId ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/orchestration-progress.test.ts`
Expected: PASS — 왕복 2건 포함 전부 통과.

- [ ] **Step 5: Guard against regressions in the existing chat suite**

Run: `cd web && npx vitest run src/test/orchestrator-chat-output.test.ts src/test/session-chat.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc 0 error.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/types.ts web/src/features/workspace/orchestratorChat.ts web/src/features/workspace/useWorkspaceSession.ts web/src/test/orchestration-progress.test.ts
git commit -m "feat(progress): record turn start + freeze a completion summary on the reply"
```

---

### Task 3: 진행 카드 컴포넌트

**Files:**
- Create: `web/src/features/workspace/ProgressCard.tsx`
- Test: `web/src/test/workspace-progress-card.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `computeOrchestrationProgress`, `formatElapsed`; `useNowTick`(`./useNowTick`), `AgentAvatar`(`./AgentAvatar`), `providerLabel`(`../profiles/profilePresentation`), `DelegationCard`(`./types`).
- Produces: `export function ProgressCard(props: { pendingSince: number; supervisorTerminalId: string | null; cards: DelegationCard[]; terminalStatuses: Record<string, string> }): JSX.Element`. 루트에 `data-testid="progress-card"`, `data-stage={stage}` 를 단다.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/workspace-progress-card.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressCard } from '../features/workspace/ProgressCard'
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

describe('ProgressCard', () => {
  it('shows the dispatching stage before any worker exists', () => {
    render(<ProgressCard pendingSince={T0} supervisorTerminalId="sup" cards={[]} terminalStatuses={{}} />)
    const root = screen.getByTestId('progress-card')
    expect(root.getAttribute('data-stage')).toBe('dispatching')
    expect(screen.getByText('작업 배정 중')).toBeTruthy()
  })

  it('lists the working worker by display label and names who it waits on', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', provider: 'codex' })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getByTestId('progress-card').getAttribute('data-stage')).toBe('working')
    expect(screen.queryByText('codex_qa_terra')).toBeNull()
    expect(screen.getByText('작업 중')).toBeTruthy()
    expect(screen.getByText(/콜백 대기 중$/)).toBeTruthy()
  })

  it('renders the elapsed time of the turn', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra' })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getByText(/^1분/)).toBeTruthy()
  })

  it('warns when a worker is stalled', () => {
    render(
      <ProgressCard
        pendingSince={Date.now() - 7 * 60 * 1000}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', status: 'processing', firstSeenAt: Date.now() - 7 * 60 * 1000 })]}
        terminalStatuses={{ w1: 'PROCESSING' }}
      />,
    )
    expect(screen.getByText(/응답이 없어요/)).toBeTruthy()
  })

  it('reports the callback stage with a done count once every worker finished', () => {
    render(
      <ProgressCard
        pendingSince={T0}
        supervisorTerminalId="sup"
        cards={[card({ terminalId: 'w1', agentName: 'codex_qa_terra', killed: true })]}
        terminalStatuses={{}}
      />,
    )
    expect(screen.getByTestId('progress-card').getAttribute('data-stage')).toBe('callback')
    expect(screen.getByText('1/1 완료')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/workspace-progress-card.test.tsx`
Expected: FAIL — `Failed to resolve import "../features/workspace/ProgressCard"`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/workspace/ProgressCard.tsx`:

```tsx
// Phase 2 · 채팅 인라인 라이브 진행카드.
//
// 표시 전용이다. 새 API 를 호출하지 않고, AgentSidePanel 과 같은
// cards/terminalStatuses 만 읽어 그린다. 1초 tick 은 경과시간 표시를 위한
// 로컬 리렌더일 뿐 어떤 네트워크 요청도 유발하지 않는다.
import { AlertTriangle } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { useNowTick } from './useNowTick'
import { computeOrchestrationProgress, formatElapsed } from './orchestrationProgress'
import { providerLabel } from '../profiles/roleData'
import type { OrchestrationStage, WorkerState } from './orchestrationProgress'
import type { DelegationCard } from './types'

const STAGE_LABEL: Record<OrchestrationStage, string> = {
  dispatching: '작업 배정 중',
  working: '워커 작업 중',
  callback: '콜백 대기 중',
}

const STATE_LABEL: Record<WorkerState, string> = {
  waiting: '대기',
  working: '작업 중',
  done: '완료',
  error: '오류',
}

const STATE_CLASS: Record<WorkerState, string> = {
  waiting: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)]',
  working: 'border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]',
  done: 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]',
  error: 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]',
}

export function ProgressCard({
  pendingSince,
  supervisorTerminalId,
  cards,
  terminalStatuses,
}: {
  pendingSince: number
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  terminalStatuses: Record<string, string>
}) {
  const now = useNowTick(1000)
  const progress = computeOrchestrationProgress({ pendingSince, supervisorTerminalId, cards, terminalStatuses, now })
  if (!progress) return null

  return (
    <div
      data-testid="progress-card"
      data-stage={progress.stage}
      className="ml-10 max-w-[calc(86%-40px)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden />
        <span className="text-[12px] font-semibold text-[var(--text)]">{STAGE_LABEL[progress.stage]}</span>
        <span className="text-[11px] text-[var(--text-3)]">{formatElapsed(progress.elapsedMs)}</span>
        {progress.totalCount > 0 && (
          <span className="ml-auto text-[11px] text-[var(--text-3)]">
            {progress.doneCount}/{progress.totalCount} 완료
          </span>
        )}
      </div>

      {progress.workers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {progress.workers.map(worker => (
            <li key={worker.terminalId} className="flex items-center gap-2">
              <AgentAvatar name={worker.roleLabel} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">{worker.roleLabel}</span>
              {worker.provider && (
                <span className="text-[10px] text-[var(--text-3)]">{providerLabel(worker.provider)}</span>
              )}
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATE_CLASS[worker.state]}`}>
                {STATE_LABEL[worker.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-[var(--text-3)]">
        {progress.waitingForLabel
          ? `${progress.waitingForLabel}의 콜백 대기 중`
          : '워커를 배정하는 중이에요'}
      </p>

      {progress.stalled && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--warning)]">
          <AlertTriangle size={12} aria-hidden />
          한동안 응답이 없어요
        </p>
      )}
    </div>
  )
}
```

확정된 계약: `AgentAvatar({ name, size = 'md', title })` — `size="sm"` 유효(`AgentAvatar.tsx:10`). `providerLabel` 은 `src/features/profiles/roleData.ts` 에서 export 된다.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/workspace-progress-card.test.tsx`
Expected: PASS — 5건 전부.

- [ ] **Step 5: Verify no hardcoded colors leaked in**

Run: `cd web && node ../design-tokens/gen.mjs --check`
Expected: 통과(비-토큰 색 0건).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/ProgressCard.tsx web/src/test/workspace-progress-card.test.tsx
git commit -m "feat(progress): live in-chat progress card for the pending orchestration turn"
```

---

### Task 4: 스레드 배선 · 완료 요약 표시

**Files:**
- Modify: `web/src/features/workspace/Thread.tsx` (`ThreadProps`, `ChatBubble`, 렌더 분기 ~line 220)
- Modify: `web/src/features/workspace/Workspace.tsx:305-317` (Thread props)
- Test: `web/src/test/workspace-progress-wiring.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `formatElapsed`, Task 2 의 `ChatEntry.progress`·hook 의 `pendingSince`/`pendingMessageId`, Task 3 의 `ProgressCard`.
- Produces: `ThreadProps` 에 `pendingSince: number | null`, `pendingMessageId: string | null`, `cards: DelegationCard[]`, `supervisorTerminalId: string | null` 추가.

- [ ] **Step 1: Write the failing test**

Create `web/src/test/workspace-progress-wiring.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatBubble, Thread } from '../features/workspace/Thread'
import type { ChatEntry, DelegationCard, ThreadItem } from '../features/workspace/types'

const T0 = Date.now() - 65_000

const WAITING_ENTRY: ChatEntry = {
  id: 'a1',
  role: 'assistant',
  content: '오케스트레이터 응답을 기다리는 중…',
  ts: T0,
}

const WORKER: DelegationCard = {
  terminalId: 'w1',
  sessionId: null,
  agentName: 'codex_qa_terra',
  provider: 'codex',
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
}

function threadProps(over: Partial<React.ComponentProps<typeof Thread>> = {}) {
  const items: ThreadItem[] = [{ kind: 'chat', id: 'a1', ts: T0, entry: WAITING_ENTRY }]
  return {
    sessionName: 'sess',
    loading: false,
    threadItems: items,
    connectionStatus: 'connected' as const,
    terminalStatuses: { w1: 'PROCESSING' },
    cards: [WORKER],
    supervisorTerminalId: 'sup',
    pendingSince: T0,
    pendingMessageId: 'a1',
    onOpenTerminal: () => {},
    onOpenOutput: () => {},
    onOpenLogs: () => {},
    onRequestStop: () => {},
    onMessageTarget: () => {},
    onRequestStatusCheck: async () => {},
    ...over,
  }
}

describe('Thread progress wiring', () => {
  it('replaces the WAITING bubble with the live progress card', () => {
    render(<Thread {...threadProps()} />)
    expect(screen.getByTestId('progress-card')).toBeTruthy()
    expect(screen.queryByText('오케스트레이터 응답을 기다리는 중…')).toBeNull()
  })

  it('keeps the WAITING bubble when the turn has no recorded start time', () => {
    render(<Thread {...threadProps({ pendingSince: null })} />)
    expect(screen.queryByTestId('progress-card')).toBeNull()
    expect(screen.getByText('오케스트레이터 응답을 기다리는 중…')).toBeTruthy()
  })

  it('leaves other chat entries alone while a turn is pending', () => {
    const other: ChatEntry = { id: 'u1', role: 'user', content: '테스트 돌려줘', ts: T0 - 1 }
    render(
      <Thread
        {...threadProps({
          threadItems: [
            { kind: 'chat', id: 'u1', ts: T0 - 1, entry: other },
            { kind: 'chat', id: 'a1', ts: T0, entry: WAITING_ENTRY },
          ],
        })}
      />,
    )
    expect(screen.getByText('테스트 돌려줘')).toBeTruthy()
    expect(screen.getByTestId('progress-card')).toBeTruthy()
  })
})

describe('ChatBubble completion summary', () => {
  it('renders the frozen summary above a finished reply', () => {
    render(
      <ChatBubble
        entry={{
          id: 'a1',
          role: 'assistant',
          content: '전부 통과했어요',
          ts: T0,
          progress: { workerCount: 2, durationMs: 125_000, workerLabels: ['테스트 담당', '탐색 담당'] },
        }}
      />,
    )
    expect(screen.getByText('✓ 완료 · 워커 2 · 소요 2분 5초')).toBeTruthy()
    expect(screen.getByText('전부 통과했어요')).toBeTruthy()
  })

  it('renders nothing extra when there is no summary', () => {
    render(<ChatBubble entry={{ id: 'a1', role: 'assistant', content: '답변', ts: T0 }} />)
    expect(screen.queryByText(/✓ 완료/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/test/workspace-progress-wiring.test.tsx`
Expected: FAIL — `Thread` 가 새 props 를 모르고 `progress-card` 를 찾지 못한다(타입 에러 포함).

- [ ] **Step 3: Write minimal implementation**

`web/src/features/workspace/Thread.tsx` — import 추가:

```tsx
import { ProgressCard } from './ProgressCard'
import { formatElapsed } from './orchestrationProgress'
import type { ChatEntry, DelegationCard, ThreadItem } from './types'
```

`ThreadProps` 에 추가:

```tsx
  cards: DelegationCard[]
  supervisorTerminalId: string | null
  /** ms epoch of the pending turn's send, or null when nothing is pending / the turn predates Phase 2. */
  pendingSince: number | null
  /** Chat entry id of the pending assistant placeholder. */
  pendingMessageId: string | null
```

`ChatBubble` 안, 본문 렌더 직전에 요약 줄을 넣는다:

```tsx
        {entry.targetId && <div className="mb-1 text-[10px] font-semibold opacity-70">→ {entry.targetId.slice(0, 8)}</div>}
        {entry.progress && (
          <div className="mb-1 text-[10px] font-semibold text-[var(--success)]">
            ✓ 완료 · 워커 {entry.progress.workerCount} · 소요 {formatElapsed(entry.progress.durationMs)}
          </div>
        )}
        {showRaw ? entry.raw : entry.content}
```

렌더 분기(현재 `if (item.kind === 'chat') return <ChatBubble key={item.id} entry={item.entry} />`)를 교체:

```tsx
              if (item.kind === 'chat') {
                const isPendingPlaceholder =
                  props.pendingSince !== null && props.pendingMessageId === item.entry.id
                if (isPendingPlaceholder) {
                  return (
                    <ProgressCard
                      key={item.id}
                      pendingSince={props.pendingSince}
                      supervisorTerminalId={props.supervisorTerminalId}
                      cards={props.cards}
                      terminalStatuses={props.terminalStatuses}
                    />
                  )
                }
                return <ChatBubble key={item.id} entry={item.entry} />
              }
```

> 렌더 분기가 `props` 를 구조분해해 쓰고 있다면 구조분해 목록에 새 항목을 추가하고 `props.` 접두사를 뺀다.

`web/src/features/workspace/Workspace.tsx:305-317` 의 `<Thread .../>` 에 추가:

```tsx
                cards={workspaceSession.cards}
                supervisorTerminalId={workspaceSession.supervisorTerminalId}
                pendingSince={workspaceSession.pendingSince}
                pendingMessageId={workspaceSession.pendingMessageId}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/test/workspace-progress-wiring.test.tsx`
Expected: PASS — 5건 전부.

- [ ] **Step 5: Run the full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build && node ../design-tokens/gen.mjs --check`
Expected: tsc 0 error, vitest `432 + 신규` 전부 통과(기존 432 중 실패 0), build ✓, 토큰 체크 통과.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/Thread.tsx web/src/features/workspace/Workspace.tsx web/src/test/workspace-progress-wiring.test.tsx
git commit -m "feat(progress): render the live progress card in the thread + collapsed completion summary"
```

---

## 수용 기준 (스펙 §Phase 2 대조)

| 스펙 요구 | 충족 위치 |
|---|---|
| 활성 워커별 역할명·provider·상태·경과 | Task 1 `WorkerProgress` + Task 3 워커 행 |
| 단계 표시 assign → 작업중 → 콜백 | Task 1 `OrchestrationStage`(`dispatching`/`working`/`callback`) + Task 3 `STAGE_LABEL` |
| "무엇을 기다리는지" 표시 | Task 1 `waitingForLabel` + Task 3 대기 문구 |
| stall 경고, `stall.ts` 재사용 | Task 1 `computeStall` 위임 + Task 3 경고 줄 |
| 완료 시 "✓ 완료 (워커 N · 소요 M)"로 접힘 | Task 2 `summarizeOrchestration` 굳히기 + Task 4 `ChatBubble` 요약 줄 |
| 오른쪽 패널과 상태 불일치 없음 | 같은 `cards`/`terminalStatuses` 만 읽음(새 상태원 없음) |
| 진행카드 엔트리 타입 추가 | `ChatEntry.progress`(별도 ThreadItem kind 불필요 — pending placeholder 를 제자리 치환) |

## 남은 것 (이 플랜 범위 밖)

- 완료 카드의 토큰·비용 표시는 **Phase 3** 소관이다(`OrchestrationSummary` 에 필드를 additive 로 얹으면 된다).
- 실서버 라이브 확인: 서버 기동 후 실제 위임 턴에서 카드가 assign→작업중→콜백→완료로 전이하는지 브라우저에서 확인해야 최종 수용이다. 단위 테스트만으로는 수용 기준을 다 증명하지 못한다.
