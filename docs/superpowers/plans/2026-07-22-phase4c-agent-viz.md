# Phase 4-C: 에이전트 시각화 (A 역할보드 + B 위임계층) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** AgentSidePanel의 "agents" 탭 평면 리스트를 역할 기반 시각화로 개선한다 — 평소엔 **A) 역할 보드**(역할별 그룹 + provider 색 + 모델 배지 + 상태 dot), 팀이 작업 중이면 **B) 위임 계층**(오케스트레이터 상단 → 역할 그룹, 활성 그룹 강조)로 자동 전환하며 수동 토글도 제공한다.

**Architecture:** provider 색을 design-token으로 신설(하드코딩 hex 금지). 순수 헬퍼(`groupAgentsByRole`, `isTeamWorking`)로 로직을 분리해 단위 테스트하고, `RoleBoard`/`DelegationHierarchy` 프레젠테이션 컴포넌트를 만들어 AgentSidePanel agents 탭에서 상태에 따라 전환한다. 라이브 상태는 기존 `terminalStatuses`/`cards`/`terminals`를 쓰고, 역할 매핑은 기존 `profilePresentation.ts` 헬퍼(`workerGroup`/`isOrchestratorProfile`/`additionalProfileRole`)를 재사용한다.

**Tech Stack:** React/TS, Vitest, design-tokens(`design-tokens/tokens.json` → `node design-tokens/gen.mjs`).

## Global Constraints

- **디자인 토큰만. 하드코딩 색 금지** — provider 색은 `tokens.json`에 추가하고 `node design-tokens/gen.mjs --check` 통과. 목업의 인라인 hex(#d1fae5 등)를 그대로 쓰지 않는다.
- 한국어 UI; 내부 프로필 ID·마커 노출 금지(사용자용 라벨은 `profileLabel`/`providerLabel`).
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build` + `node design-tokens/gen.mjs --check`.
- 296px 사이드바 폭에 맞춘다 — 목업의 가로 컬럼 대신 **세로 역할 그룹 섹션**으로 적응(그룹 헤더 + 카드 스택). B 계층도 세로(오케스트레이터 카드 → 그룹 박스 세로 스택).
- 상태 dot 색은 기존 status 토큰(`status.generated.ts`/StatusBadge)과 정합 — IDLE=green, PROCESSING=작업중, 미실행=neutral. 목업의 임의 색 대신 기존 상태 색 체계 사용.
- 기존 AgentCard의 정보(ContextGaugeChip, InlineUsageBar[Plan D], StatusBadge, 액션 버튼)를 잃지 않는다 — 보드/계층은 그 위의 그룹핑 레이어.

---

### Task 1: provider 색 design-token + `providerAccent` 헬퍼

**Files:**
- Modify: `design-tokens/tokens.json` (provider 색 토큰 추가)
- Regenerate: `web/src/theme.generated.css` (via `node design-tokens/gen.mjs`)
- Create: `web/src/features/profiles/providerAccent.ts`
- Test: `web/src/test/provider-accent.test.ts`

**Interfaces:**
- Produces: `providerAccent(provider: string): { bg: string; fg: string }` — CSS `var(--…)` 문자열 반환(codex/claude_code/antigravity_cli, 그 외 fallback neutral).

- [ ] **Step 1: 토큰 구조 확인** — Read `design-tokens/tokens.json` + `design-tokens/gen.mjs`(생성 규칙) + `web/src/theme.generated.css`(라이트/다크 구조). 기존 토큰 명명 규칙 파악.

- [ ] **Step 2: Write failing test** — `web/src/test/provider-accent.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { providerAccent } from '../features/profiles/providerAccent'

describe('providerAccent', () => {
  it('maps known providers to CSS var tokens (no hardcoded hex)', () => {
    for (const p of ['codex', 'claude_code', 'antigravity_cli']) {
      const a = providerAccent(p)
      expect(a.bg).toMatch(/^var\(--prov-/)
      expect(a.fg).toMatch(/^var\(--prov-/)
    }
  })
  it('falls back to neutral tokens for unknown providers', () => {
    const a = providerAccent('something_else')
    expect(a.bg).toMatch(/^var\(--/)
    expect(a.fg).toMatch(/^var\(--/)
  })
})
```

- [ ] **Step 3: Add tokens** — `design-tokens/tokens.json`에 provider 색 추가(라이트/다크 각각). 명명: `prov-codex-bg`/`prov-codex-fg`, `prov-claude-bg`/`prov-claude-fg`, `prov-agy-bg`/`prov-agy-fg`. 값은 목업 팔레트를 토큰화(라이트: codex #d1fae5/#065f46, claude #fef3c7/#92400e, agy #e0e7ff/#3730a3; 다크는 대비 맞춰 어둡게 — 기존 다크 토큰 톤에 맞춤). 그 뒤 `node design-tokens/gen.mjs`로 `theme.generated.css` 재생성.

- [ ] **Step 4: Implement `providerAccent.ts`**
```ts
const MAP: Record<string, { bg: string; fg: string }> = {
  codex: { bg: 'var(--prov-codex-bg)', fg: 'var(--prov-codex-fg)' },
  claude_code: { bg: 'var(--prov-claude-bg)', fg: 'var(--prov-claude-fg)' },
  antigravity_cli: { bg: 'var(--prov-agy-bg)', fg: 'var(--prov-agy-fg)' },
}
const FALLBACK = { bg: 'var(--surface-3)', fg: 'var(--text-2)' }
export function providerAccent(provider: string): { bg: string; fg: string } {
  return MAP[provider] ?? FALLBACK
}
```

- [ ] **Step 5: Run tests + token check**
Run: `cd web && npx vitest run src/test/provider-accent.test.ts && node design-tokens/gen.mjs --check`
Expected: PASS + 토큰 clean.

- [ ] **Step 6: Commit**
```bash
git add design-tokens/tokens.json web/src/theme.generated.css web/src/features/profiles/providerAccent.ts web/src/test/provider-accent.test.ts
git commit -m "feat(viz): provider accent color design tokens + providerAccent helper"
```

---

### Task 2: 순수 헬퍼 — 역할 그룹핑 + 작업중 판정

**Files:**
- Create: `web/src/features/workspace/agentGrouping.ts`
- Test: `web/src/test/agent-grouping.test.ts`

**Interfaces:**
- Consumes: `profilePresentation.ts`의 `workerGroup`/`isOrchestratorProfile`/`additionalProfileRole`.
- Produces:
  - `isTeamWorking(statuses: Record<string,string>): boolean` — 하나라도 `PROCESSING`/`WAITING_USER_ANSWER`면 true.
  - `groupAgentsByRole<T extends { name: string; provider?: string | null }>(agents: T[]): { key: string; label: string; agents: T[] }[]` — 오케스트레이터/탐색·설계/구현/검증·문서/기타 순의 그룹 배열(빈 그룹 제외).

- [ ] **Step 1: Write failing test** — `web/src/test/agent-grouping.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { isTeamWorking, groupAgentsByRole } from '../features/workspace/agentGrouping'

describe('isTeamWorking', () => {
  it('true when any status is PROCESSING', () => {
    expect(isTeamWorking({ a: 'IDLE', b: 'PROCESSING' })).toBe(true)
  })
  it('false when all idle/completed', () => {
    expect(isTeamWorking({ a: 'IDLE', b: 'COMPLETED' })).toBe(false)
  })
})

describe('groupAgentsByRole', () => {
  it('groups orchestrator + workers into ordered role groups', () => {
    const groups = groupAgentsByRole([
      { name: 'codex_orchestrator_sol', provider: 'codex' },
      { name: 'claude_scout_haiku', provider: 'claude_code' },
      { name: 'codex_qa_terra', provider: 'codex' },
    ])
    const keys = groups.map(g => g.key)
    expect(keys[0]).toBe('orchestrator')
    expect(keys).toContain('discovery')
    expect(keys).toContain('verification')
    expect(groups.every(g => g.agents.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**
Run: `cd web && npx vitest run src/test/agent-grouping.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: Implement `agentGrouping.ts`**
```ts
import { isOrchestratorProfile, workerGroup, additionalProfileRole, WORKER_GROUPS, ADDITIONAL_ROLE_LABELS } from '../profiles/profilePresentation'
import type { ProfileLike } from '../profiles/profilePresentation'

const WORKING = new Set(['PROCESSING', 'WAITING_USER_ANSWER'])
export function isTeamWorking(statuses: Record<string, string>): boolean {
  return Object.values(statuses).some(s => WORKING.has((s || '').toUpperCase()))
}

const ORDER = ['orchestrator', 'discovery', 'implementation', 'verification'] as const

export function groupAgentsByRole<T extends { name: string; provider?: string | null }>(
  agents: T[],
): { key: string; label: string; agents: T[] }[] {
  const buckets = new Map<string, { label: string; agents: T[] }>()
  const push = (key: string, label: string, a: T) => {
    const b = buckets.get(key) ?? { label, agents: [] }
    b.agents.push(a); buckets.set(key, b)
  }
  for (const a of agents) {
    const profile = { name: a.name, source: 'built-in', provider: a.provider ?? null } as ProfileLike
    if (isOrchestratorProfile(a.name)) { push('orchestrator', '오케스트레이터', a); continue }
    const wg = workerGroup(profile)
    if (wg) { push(wg, WORKER_GROUPS[wg].label, a); continue }
    const role = additionalProfileRole(profile)
    push(role, ADDITIONAL_ROLE_LABELS[role] ?? role, a)
  }
  const ordered: { key: string; label: string; agents: T[] }[] = []
  for (const key of ORDER) {
    const b = buckets.get(key); if (b) { ordered.push({ key, ...b }); buckets.delete(key) }
  }
  for (const [key, b] of buckets) ordered.push({ key, ...b })
  return ordered
}
```
(주의: `WORKER_GROUPS`/`ADDITIONAL_ROLE_LABELS`/`ProfileLike` export를 profilePresentation.ts에서 확인. `orchestrator` 그룹 라벨 '오케스트레이터'.)

- [ ] **Step 4: Run to verify pass**
Run: `cd web && npx vitest run src/test/agent-grouping.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/features/workspace/agentGrouping.ts web/src/test/agent-grouping.test.ts
git commit -m "feat(viz): pure helpers for team-working detection + role grouping"
```

---

### Task 3: RoleBoard (A) 컴포넌트

**Files:**
- Create: `web/src/features/workspace/RoleBoard.tsx`
- Test: `web/src/test/role-board.test.tsx`

**Interfaces:**
- Consumes: `groupAgentsByRole`(T2), `providerAccent`(T1), `providerLabel`(roleData), `profileLabel`, `StatusBadge`.
- Produces: `RoleBoard({ agents, statuses }: { agents: AgentVizItem[]; statuses: Record<string,string> })` where `AgentVizItem = { name: string; provider?: string|null; model?: string|null; terminalId?: string|null }`.

- [ ] **Step 1: Write failing test** — `web/src/test/role-board.test.tsx`
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoleBoard } from '../features/workspace/RoleBoard'

describe('RoleBoard', () => {
  it('renders role-group headers with the agents under them', () => {
    render(<RoleBoard
      agents={[
        { name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol' },
        { name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra' },
      ]}
      statuses={{}} />)
    expect(screen.getByText('오케스트레이터')).toBeInTheDocument()
    expect(screen.getByText('검증·문서')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument()  // model badge
  })
})
```

- [ ] **Step 2: Run → FAIL**
Run: `cd web && npx vitest run src/test/role-board.test.tsx`

- [ ] **Step 3: Implement `RoleBoard.tsx`** — 세로 역할 그룹 섹션. 각 그룹: 헤더(라벨 + count 배지), 카드 스택. 카드: provider 이니셜 아바타(배경 `providerAccent(provider).bg`, 글자 `.fg`), `profileLabel(name)`, 배지 행(providerLabel + model 모노스페이스 배지), `StatusBadge`(terminalId로 status 조회, 없으면 미실행). 모든 색은 토큰. 예:
```tsx
import { groupAgentsByRole } from './agentGrouping'
import { providerAccent } from '../profiles/providerAccent'
import { providerLabel } from '../profiles/roleData'
import { profileLabel } from '../profiles/profilePresentation'
import { StatusBadge } from '../../components/StatusBadge'

export interface AgentVizItem { name: string; provider?: string | null; model?: string | null; terminalId?: string | null }

export function RoleBoard({ agents, statuses }: { agents: AgentVizItem[]; statuses: Record<string, string> }) {
  const groups = groupAgentsByRole(agents)
  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group.key}>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
            {group.label}
            <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px]">{group.agents.length}</span>
          </div>
          <div className="space-y-1.5">
            {group.agents.map(a => {
              const accent = providerAccent(a.provider ?? '')
              const status = a.terminalId ? statuses[a.terminalId] ?? null : null
              return (
                <div key={a.name} className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={{ backgroundColor: accent.bg, color: accent.fg }}>
                    {(providerLabel(a.provider ?? '?')[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-[var(--text)]">{profileLabel(a.name)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: accent.bg, color: accent.fg }}>{providerLabel(a.provider ?? '?')}</span>
                      {a.model && <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-2)]">{a.model}</span>}
                    </div>
                    <div className="mt-1"><StatusBadge status={status} /></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
```
(주의: `StatusBadge`의 실제 props(status: string|null 허용 여부)와 `profileLabel`/`providerLabel` export를 확인해 맞춘다. StatusBadge가 null을 "미실행"류로 렌더하지 않으면 fallback 텍스트 처리.)

- [ ] **Step 4: Run → PASS**
Run: `cd web && npx vitest run src/test/role-board.test.tsx`

- [ ] **Step 5: Commit**
```bash
git add web/src/features/workspace/RoleBoard.tsx web/src/test/role-board.test.tsx
git commit -m "feat(viz): RoleBoard (A) — role-grouped agent cards with provider color + model badge"
```

---

### Task 4: DelegationHierarchy (B) + 자동 전환 + AgentSidePanel 통합

**Files:**
- Create: `web/src/features/workspace/DelegationHierarchy.tsx`
- Modify: `web/src/features/workspace/AgentSidePanel.tsx` (agents 탭 body에 보드/계층 전환 + 토글)
- Test: `web/src/test/delegation-hierarchy.test.tsx`, `web/src/test/agent-viz-switch.test.tsx`

**Interfaces:**
- Consumes: `groupAgentsByRole`, `isTeamWorking`(T2), `providerAccent`(T1), `AgentVizItem`(T3).
- Produces: `DelegationHierarchy({ orchestrator, agents, statuses })`; AgentSidePanel agents 탭이 `isTeamWorking(terminalStatuses)`면 B, 아니면 A, 수동 토글로 override.

- [ ] **Step 1: Write failing tests**
`web/src/test/delegation-hierarchy.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DelegationHierarchy } from '../features/workspace/DelegationHierarchy'

describe('DelegationHierarchy', () => {
  it('shows the orchestrator at top and role-group boxes below', () => {
    render(<DelegationHierarchy
      orchestrator={{ name: 'codex_orchestrator_sol', provider: 'codex', model: 'gpt-5.6-sol', terminalId: 't0' }}
      agents={[{ name: 'codex_qa_terra', provider: 'codex', model: 'gpt-5.6-terra', terminalId: 't1' }]}
      statuses={{ t1: 'PROCESSING' }} />)
    expect(screen.getByText(/오케스트레이터/)).toBeInTheDocument()
    expect(screen.getByText('검증·문서')).toBeInTheDocument()
  })
})
```
`web/src/test/agent-viz-switch.test.tsx`: (AgentSidePanel agents 탭이 작업중일 때 B, 평소 A 표시 — 실제 패널 렌더가 무거우면 전환 판정 헬퍼(`isTeamWorking`) + 뷰 선택 로직을 작은 wrapper로 뽑아 테스트. 실행자가 실제 구조에 맞춰 결정하되, "작업중=계층/평소=보드 + 수동 토글" 동작을 최소 1개 실 DOM 테스트로 증명.)

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `DelegationHierarchy.tsx`** — 상단 오케스트레이터 카드(강조 테두리 `border-[var(--accent)]`, 집계 상태 예 "N/M 워커 대기중"), 세로 연결선, 그 아래 역할 그룹 박스 세로 스택(각 박스: 그룹 라벨 + 컴팩트 provider·모델·상태 배지). 작업중 그룹(그룹 내 terminalId status가 PROCESSING)은 `border-[var(--warning)] bg-[var(--warning-bg)]` 강조, 나머지 dashed `border-[var(--border)]`. 색 전부 토큰.

- [ ] **Step 4: Integrate into AgentSidePanel agents tab** — `AgentSidePanel.tsx` agents 탭 body 상단에 뷰 전환. `terminals`/`cards`를 `AgentVizItem[]`로 매핑(name=agent_profile, provider, model=프로필 model 또는 PRESENTATION detail, terminalId). `const working = isTeamWorking(terminalStatuses)`; `const [mode, setMode] = useState<'auto'|'board'|'hier'>('auto')`; 실제 뷰 = mode==='auto' ? (working?'hier':'board') : mode. 작은 토글 버튼 2개(보드/계층, 토큰 스타일). **기존 flat AgentCard 리스트는 유지하되 그 위에 시각화 섹션을 추가**하거나, 시각화를 기본으로 하고 상세는 카드로 — 실행자가 기존 카드(액션 버튼/InlineUsageBar/ContextGaugeChip)를 잃지 않도록 배치(보드/계층은 요약 뷰, 카드 리스트는 상세 유지가 안전). 어느 배치든 기존 기능 회귀 없게.

- [ ] **Step 5: Run tests → PASS**
Run: `cd web && npx vitest run src/test/delegation-hierarchy.test.tsx src/test/agent-viz-switch.test.tsx`

- [ ] **Step 6: Full gate**
Run: `cd web && npx tsc --noEmit && npm test && npm run build && node design-tokens/gen.mjs --check`
Expected: green.

- [ ] **Step 7: Commit**
```bash
git add web/src/features/workspace/DelegationHierarchy.tsx web/src/features/workspace/AgentSidePanel.tsx web/src/test/delegation-hierarchy.test.tsx web/src/test/agent-viz-switch.test.tsx
git commit -m "feat(viz): DelegationHierarchy (B) + auto A/B switch in agent side panel"
```

---

## Self-Review

- **Spec coverage:** A 역할보드(T3) + B 위임계층(T4) + 작업중 자동 전환·수동 토글(T4) + provider 색·모델 배지·상태 dot(T1/T3) ✅. 목업 대비 296px 세로 적응 명시. 토큰 준수(하드코딩 hex 금지, T1에서 토큰화) ✅.
- **Placeholder scan:** StatusBadge/profileLabel/WORKER_GROUPS export·AgentSidePanel 실제 구조는 "확인" 지시. T4 Step4 배치는 "기존 카드 기능 유지" 제약 명시. 코드 스텝 구체.
- **Type consistency:** `AgentVizItem`(T3) ↔ RoleBoard/DelegationHierarchy props 일치. `groupAgentsByRole`/`isTeamWorking`(T2) ↔ T3/T4 사용 일치. providerAccent 반환 `{bg,fg}`(T1) ↔ style 사용 일치.

## 남은 위험
- StatusBadge가 null status를 렌더 안 하면 "미실행" fallback 필요(T3 주의).
- AgentSidePanel 통합 배치가 가장 리스크 — 기존 AgentCard(액션/InlineUsageBar/ContextGaugeChip) 회귀 없게 요약(보드/계층)+상세(카드) 공존 권장. 리뷰에서 회귀 중점 확인.
- 다크모드 provider 토큰 대비 — T1에서 다크 값도 지정, `gen.mjs --check` 통과 필수.
