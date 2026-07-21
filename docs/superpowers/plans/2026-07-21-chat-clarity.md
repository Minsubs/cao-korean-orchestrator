# Chat Clarity (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅에 오케스트레이터의 깨끗한 최종답변만 보이게 하고(내부 나레이션·도구/JSON·마커·장황 사고 제거), 정리 전 원본은 "원문 보기" 토글로 열람 가능하게 한다.

**Architecture:** 순수 함수 `formatOrchestratorOutput`(정리기)을 강화하고, 각 오케스트레이터 답변 엔트리에 원본(`raw`)을 함께 보존해 `Thread`의 버블에서 토글로 노출한다. 정리기는 워크스페이스(`orchestratorChat.ts`)와 클래식 모달(`SessionChatPanel.tsx`) 두 곳이 병렬 테스트되므로 양쪽 동시 반영한다.

**Tech Stack:** TypeScript, React, Vitest. 저장은 localStorage.

## Global Constraints

- 디자인 토큰(`var(--…)`)만 사용. 하드코딩 색 금지. (`node design-tokens/gen.mjs --check`)
- 한국어 UI. 사용자에게 내부 식별자·마커·프로필 ID 노출 금지.
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`.
- 정리 규칙은 `orchestratorChat.ts`(워크스페이스)와 `components/SessionChatPanel.tsx`(클래식)에 **동일하게** 반영. 두 파일의 `formatOrchestratorOutput`은 `web/src/test/orchestrator-chat-output.test.ts`가 `it.each([classic, workspace])`로 함께 검증한다.
- 과다 제거 방지: 정리 규칙은 보수적으로. 사용자향 산문은 남기고, 기계적 노이즈(도구 결과·마커·상태 나레이션)만 제거. 애매하면 남기고 `raw` 토글로 보완.

---

### Task 1: 정리기 노이즈 4종 제거 강화

기존 `formatOrchestratorOutput`은 progress 프레임·tool-call·separator를 처리한다. 여기에 최종답변 블록 내부에 남는 4종 노이즈를 `sanitizeResponseBlock`에서 라인 단위로 제거한다.

**Files:**
- Modify: `web/src/features/workspace/orchestratorChat.ts` (`sanitizeResponseBlock`)
- Modify: `web/src/components/SessionChatPanel.tsx` (동일 `sanitizeResponseBlock` — 손으로 동기화)
- Test: `web/src/test/orchestrator-chat-output.test.ts`

**Interfaces:**
- Produces: `formatOrchestratorOutput(rawOutput: string): string` (시그니처 불변 — 반환 문자열이 더 깨끗해질 뿐)

- [ ] **Step 1: Write the failing tests** — `web/src/test/orchestrator-chat-output.test.ts`에 아래 블록을 `describe` 안에 추가.

```ts
describe('orchestrator chat output noise stripping', () => {
  it.each(formatters)('strips internal-state narration lines', (formatOutput) => {
    const raw = `• assign 접수만으로는 완료 처리하지 않습니다. 워커 콜백을 기다립니다.
• 재할당은 하지 않으며, 동일 작업자의 메시지 도착만 확인합니다.

로그인 재시도 버그를 고쳤고 회귀 테스트가 통과했습니다.`
    expect(formatOutput(raw)).toBe('로그인 재시도 버그를 고쳤고 회귀 테스트가 통과했습니다.')
  })

  it.each(formatters)('strips tool-result JSON continuation lines', (formatOutput) => {
    const raw = `  └ {"success": true, "message_id": 21, "sender_id": "53c5e264"}
{"terminal_id": "2bd9e73e"}

작업을 세 단계로 나눠 완료했어요.`
    expect(formatOutput(raw)).toBe('작업을 세 단계로 나눠 완료했어요.')
  })

  it.each(formatters)('strips standalone internal markers', (formatOutput) => {
    const raw = `LATEST_ORCHESTRATION_VERIFIED
MTX_CX_CX_FIN_OK

최종 결과: 6/6 연결 성공`
    expect(formatOutput(raw)).toBe('최종 결과: 6/6 연결 성공')
  })

  it.each(formatters)('keeps ordinary prose that merely contains an uppercase word', (formatOutput) => {
    const raw = `API 호출을 3회로 줄였어요. OK 응답을 확인했습니다.`
    expect(formatOutput(raw)).toBe('API 호출을 3회로 줄였어요. OK 응답을 확인했습니다.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/test/orchestrator-chat-output.test.ts`
Expected: 새 4개 케이스 중 최소 3개 FAIL (narration/JSON/marker 미제거), 마지막 "ordinary prose" 케이스는 PASS(회귀 가드).

- [ ] **Step 3: Strengthen `sanitizeResponseBlock` in `orchestratorChat.ts`**

`sanitizeResponseBlock`의 `.filter(line => { … })` 안, 기존 `return true` 직전에 아래 규칙을 추가한다(기존 규칙은 유지):

```ts
      // 도구 결과 continuation ("  └ {...}") 및 단독 JSON 오브젝트 라인
      if (/^└/.test(trimmed)) return false
      if (/^\{.*\}$/.test(trimmed)) return false
      // 도구 호출 불릿
      if (/^•\s*Called\b/.test(trimmed)) return false
      // 단독 내부 마커 (대문자+숫자+밑줄로만 이뤄진 토큰 1~수개; 공백 외 다른 문자 없음)
      if (/^[A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]*)*$/.test(trimmed) && /_/.test(trimmed)) return false
      // 내부 상태 나레이션 (알려진 오케스트레이션 상태 문구)
      if (/(콜백.*(대기|기다|전달)|assign.*접수|재할당|완료(로| 처리).*(간주|하지 않)|워커.*(생성 여부|콜백)|응답을 회수|메시지 도착)/.test(trimmed)) return false
```

주석: 마커 규칙은 `_`(밑줄) 포함을 요구해 `OK`·`API` 같은 평범한 대문자 단어를 보존한다. 나레이션 규칙은 curated 문구만 — 과다 제거 방지.

- [ ] **Step 4: Mirror the same block in `components/SessionChatPanel.tsx`**

`SessionChatPanel.tsx`의 `sanitizeResponseBlock`(동일 구조)의 같은 위치에 Step 3과 **동일한** 6줄을 추가한다. (두 파일은 손 동기화 계약.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/orchestrator-chat-output.test.ts`
Expected: 기존 2개 + 신규 4개 모두 PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/orchestratorChat.ts web/src/components/SessionChatPanel.tsx web/src/test/orchestrator-chat-output.test.ts
git commit -m "feat(chat): strip 4 orchestrator-reply noise types (narration/json/marker/tool)"
```

---

### Task 2: 오케스트레이터 답변에 원본(raw) 보존

`Thread` 버블에서 정리 전 원문을 토글로 보여주려면 엔트리에 `raw`를 함께 담아야 한다. 생성 시점(라이브)과 저장/복원 모두 반영한다.

**Files:**
- Modify: `web/src/features/workspace/types.ts` (`ChatEntry`)
- Modify: `web/src/features/workspace/useWorkspaceSession.ts:373` (라이브 엔트리 생성부)
- Modify: `web/src/features/workspace/orchestratorChat.ts` (`StoredChatMessage`, `loadStoredChat`, `saveStoredChat`)
- Test: `web/src/test/orchestrator-chat-output.test.ts` (raw 보존 단위) 또는 신규 `web/src/test/workspace-chat-raw.test.ts`

**Interfaces:**
- Consumes: `formatOrchestratorOutput` (Task 1)
- Produces: `ChatEntry.raw?: string` — assistant 엔트리에 정리 전 원문. `loadStoredChat`/`saveStoredChat`가 이를 왕복 보존.

- [ ] **Step 1: Write the failing test** — 신규 `web/src/test/workspace-chat-raw.test.ts`

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { saveStoredChat, loadStoredChat } from '../features/workspace/orchestratorChat'
import type { ChatEntry } from '../features/workspace/types'

describe('assistant raw preservation', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips assistant raw through save/load', () => {
    const entries: ChatEntry[] = [
      { id: 'a1', role: 'assistant', content: '완료했어요.', raw: '• Called x\n\n완료했어요.', ts: 1 },
    ]
    saveStoredChat('cao-demo', entries, 'last', null)
    const loaded = loadStoredChat('cao-demo')
    const a = loaded.entries.find(e => e.id === 'a1')
    expect(a?.raw).toBe('• Called x\n\n완료했어요.')
    expect(a?.content).toBe('완료했어요.')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/test/workspace-chat-raw.test.ts`
Expected: FAIL (`raw` undefined — 저장/복원에 없음).

- [ ] **Step 3: Add `raw` to `ChatEntry`** — `types.ts`

```ts
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  /** Set only when addressed to a non-supervisor terminal … */
  targetId?: string
  /** Assistant only: pre-cleaned original transcript, revealed by the "원문 보기" toggle. */
  raw?: string
}
```

- [ ] **Step 4: Persist `raw` in the store** — `orchestratorChat.ts`

`StoredChatMessage`에 `raw?: string` 추가:
```ts
interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  targetId?: string
  raw?: string
}
```
`saveStoredChat`의 `workspaceMessages` 매핑에 `raw`를 포함:
```ts
      .map(({ id, role, content, targetId, raw }) => ({ id, role, content, ...(targetId ? { targetId } : {}), ...(raw ? { raw } : {}) }))
```
`loadStoredChat`의 `cleaned` 매핑에서 assistant는 `raw`를 보존하고 `content`만 재정리:
```ts
      .map(m => (m.role === 'assistant' ? { ...m, raw: (m as StoredChatMessage).raw ?? m.content, content: formatOrchestratorOutput((m as StoredChatMessage).raw ?? m.content) } : m))
```
그리고 `entries` 매핑이 `raw`를 통과시키는지 확인(스프레드 `{ ...m }`이면 자동 통과).

- [ ] **Step 5: Populate `raw` at live creation** — `useWorkspaceSession.ts` line ~373

`const clean = formatOrchestratorOutput(outputResult.output || '')` 이후 assistant 엔트리를 만드는 지점에서, 엔트리에 `raw: outputResult.output || ''`를 함께 설정한다(해당 객체 리터럴에 `raw` 추가). content는 기존 `clean` 유지.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/workspace-chat-raw.test.ts && cd web && npx tsc --noEmit`
Expected: PASS + 타입 클린.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/workspace/types.ts web/src/features/workspace/orchestratorChat.ts web/src/features/workspace/useWorkspaceSession.ts web/src/test/workspace-chat-raw.test.ts
git commit -m "feat(chat): preserve pre-cleaned raw on assistant entries"
```

---

### Task 3: "원문 보기" 토글 UI

`ChatBubble`에서 assistant 엔트리에 `raw`가 있고 정리본과 다르면 "원문 보기" 토글을 제공한다.

**Files:**
- Modify: `web/src/features/workspace/Thread.tsx` (`ChatBubble`)
- Test: `web/src/test/workspace.test.tsx` (또는 신규 `web/src/test/workspace-chat-toggle.test.tsx`)

**Interfaces:**
- Consumes: `ChatEntry.raw` (Task 2)

- [ ] **Step 1: Write the failing test** — 신규 `web/src/test/workspace-chat-toggle.test.tsx`

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatBubble } from '../features/workspace/Thread'
import type { ChatEntry } from '../features/workspace/types'

describe('원문 보기 toggle', () => {
  it('reveals raw when the entry has a different raw', () => {
    const entry: ChatEntry = { id: 'a1', role: 'assistant', content: '완료했어요.', raw: '• Called x\n\n완료했어요.', ts: 1 }
    render(<ChatBubble entry={entry} />)
    expect(screen.queryByText(/Called x/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '원문 보기' }))
    expect(screen.getByText(/Called x/)).toBeInTheDocument()
  })

  it('shows no toggle when raw equals content', () => {
    const entry: ChatEntry = { id: 'a2', role: 'assistant', content: '동일', raw: '동일', ts: 1 }
    render(<ChatBubble entry={entry} />)
    expect(screen.queryByRole('button', { name: '원문 보기' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/test/workspace-chat-toggle.test.tsx`
Expected: FAIL — `ChatBubble` export 안 됨 / 토글 없음.

- [ ] **Step 3: Export `ChatBubble` and add the toggle** — `Thread.tsx`

`function ChatBubble` 앞에 `export`를 붙인다. 버블 내부, `{entry.content}` 렌더 뒤에 토글을 추가:

```tsx
function ChatBubble({ entry }: { entry: ChatEntry }) {
  const isUser = entry.role === 'user'
  const isSystem = entry.role === 'system'
  const [showRaw, setShowRaw] = useState(false)
  const hasRaw = entry.role === 'assistant' && !!entry.raw && entry.raw.trim() !== entry.content.trim()
  return (
    <div className={`flex max-w-[86%] gap-2.5 ${isUser ? 'ml-auto flex-row-reverse' : ''}`}>
      {!isUser && <AgentAvatar name={isSystem ? 'system' : 'supervisor'} size="sm" />}
      <div className={/* 기존 className 유지 */ ''}>
        {entry.targetId && <div className="mb-1 text-[10px] font-semibold opacity-70">→ {entry.targetId.slice(0, 8)}</div>}
        {showRaw ? entry.raw : entry.content}
        {hasRaw && (
          <button
            type="button"
            onClick={() => setShowRaw(v => !v)}
            className="mt-1.5 block text-[10px] font-semibold text-[var(--text-3)] hover:text-[var(--text)]"
          >
            {showRaw ? '정리본 보기' : '원문 보기'}
          </button>
        )}
      </div>
    </div>
  )
}
```
(기존 버블 `className` 삼항식은 그대로 유지 — 위 주석 자리에 원래 값을 둔다. `useState`가 `Thread.tsx` 상단 import에 있는지 확인, 없으면 `import { useState } from 'react'` 보강.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/workspace-chat-toggle.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: tsc 0 error, 전체 vitest PASS, build ✓.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/Thread.tsx web/src/test/workspace-chat-toggle.test.tsx
git commit -m "feat(chat): 원문 보기 toggle to reveal pre-cleaned raw"
```

---

## Self-Review

- **Spec coverage (Phase 1):** ①4종 노이즈 제거 → Task 1. ②원문/전체로그 토글 → Task 2(raw 보존)+Task 3(토글). ③사용자↔오케스트레이터 흐름 — 기존 role 구분 유지, 본 플랜 범위 내(진행카드는 Phase 2 별도 플랜). 커버 완료.
- **Placeholder scan:** 코드 스텝 전부 실제 코드. Thread className 삼항식은 "기존 값 유지"로 명시(원문은 소스에 존재). 없음.
- **Type consistency:** `ChatEntry.raw?: string`(Task2) ↔ `entry.raw` 사용(Task3) 일치. `StoredChatMessage.raw?` ↔ save/load 일치. `formatOrchestratorOutput` 시그니처 불변.

## Execution Handoff

Phase 1 전용 플랜. 나머지 Phase 2~6은 각자 spec 절 → plan → 구현 사이클로 별도 진행(스펙 `docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md` 참조).
