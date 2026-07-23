# Phase 4-A/4-D: Antigravity(agy) 1급 팀원화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `antigravity_orchestrator_agy`·`antigravity_qa_agy`를 "기타"에서 꺼내 기본 AI 팀의 1급 구성원(오케스트레이터 3번째 옵션 + 검증 워커)으로 만들고, 설치-provider 예제 프로필도 "호환용 예제"로 정상 분류한다.

**Architecture:** 순수 프레젠테이션 매핑(`profilePresentation.ts`)에 agy·예제 프로필 엔트리를 추가하고, `NewTaskModal`의 하드코딩 오케스트레이터 선택지를 3개로 확장한다. agy `.md` frontmatter에 `uiRole`을 추가해 데이터 경로에서도 정상 분류되게 이중화한다. 런타임 오케스트레이션 동작은 이미 검증됨(§0.13 3×3) — 본 플랜은 UI 분류/노출만 바꾼다.

**Tech Stack:** TypeScript, React, Vitest. 프로필 `.md`(YAML frontmatter). Python 매트릭스 스크립트(선택 라이브 검증).

## Global Constraints

- 디자인 토큰(`var(--…)`)만. 하드코딩 색 금지. `node design-tokens/gen.mjs --check`.
- 한국어 UI. 사용자에게 내부 프로필 ID·마커 노출 금지.
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`.
- provider id는 정확히 `antigravity_cli`. agy 오케스트레이터 프로필 = `antigravity_orchestrator_agy`, QA = `antigravity_qa_agy`.
- 미설치 CLI(copilot/kimi/kiro) 예제는 범위 제외 — 건드리지 않는다.
- 모델 문자열 변경(Gemini 3.6 등)은 본 플랜 범위 아님(Plan B). 여기서는 현재 모델 표기(`Gemini 3.1 Pro`, `Gemini 3.5 Flash`)를 그대로 display detail에 쓴다.
- agy `.md`는 `src/cli_agent_orchestrator/agent_store/`(built-in)와 `examples/cross-provider/`(사본) 두 곳에 존재 — frontmatter 변경 시 양쪽 동기.

---

### Task 1: agy 2종을 기본 AI 팀 PRESENTATION에 등록 + uiRole 부여

**Files:**
- Modify: `web/src/features/profiles/profilePresentation.ts` (`ORCHESTRATOR_PROFILES` 22-25, `PRESENTATION` 32-125)
- Modify: `src/cli_agent_orchestrator/agent_store/antigravity_orchestrator_agy.md` (frontmatter, +`uiRole`)
- Modify: `src/cli_agent_orchestrator/agent_store/antigravity_qa_agy.md` (frontmatter, +`uiRole`)
- Modify: `examples/cross-provider/antigravity_orchestrator_agy.md`, `examples/cross-provider/antigravity_qa_agy.md` (동일 frontmatter 동기)
- Test: `web/src/test/profile-presentation.test.ts` (신규)

**Interfaces:**
- Consumes: 기존 `profileSection`, `additionalProfileRole`, `isOrchestratorProfile`, `workerGroup` (`profilePresentation.ts`).
- Produces: `ORCHESTRATOR_PROFILES.antigravity_cli === 'antigravity_orchestrator_agy'`; `PRESENTATION['antigravity_orchestrator_agy']`(section 'team') / `PRESENTATION['antigravity_qa_agy']`(section 'team', workerGroup 'verification').

- [ ] **Step 1: Write the failing test** — 신규 `web/src/test/profile-presentation.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_PROFILES,
  isOrchestratorProfile,
  profileSection,
  workerGroup,
  additionalProfileRole,
} from '../features/profiles/profilePresentation'
import type { ProfileLike } from '../features/profiles/profilePresentation'

const agyOrch: ProfileLike = { name: 'antigravity_orchestrator_agy', source: 'built-in', provider: 'antigravity_cli' }
const agyQa: ProfileLike = { name: 'antigravity_qa_agy', source: 'built-in', provider: 'antigravity_cli' }

describe('antigravity is a first-class team member', () => {
  it('registers agy as a selectable orchestrator', () => {
    expect(ORCHESTRATOR_PROFILES.antigravity_cli).toBe('antigravity_orchestrator_agy')
    expect(isOrchestratorProfile('antigravity_orchestrator_agy')).toBe(true)
  })
  it('places both agy profiles in the team section (not 기타)', () => {
    expect(profileSection(agyOrch)).toBe('team')
    expect(profileSection(agyQa)).toBe('team')
    expect(additionalProfileRole(agyOrch)).not.toBe('기타')
  })
  it('assigns the agy QA worker to the verification group', () => {
    expect(workerGroup(agyQa)).toBe('verification')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/test/profile-presentation.test.ts`
Expected: FAIL — `ORCHESTRATOR_PROFILES.antigravity_cli` undefined, `profileSection` returns 'additional', `additionalProfileRole` returns '기타'.

- [ ] **Step 3: Add agy to `ORCHESTRATOR_PROFILES`** — `profilePresentation.ts:22-25`

기존:
```ts
export const ORCHESTRATOR_PROFILES = {
  codex: 'codex_orchestrator_sol',
  claude_code: 'claude_orchestrator_sonnet',
} as const
```
변경:
```ts
export const ORCHESTRATOR_PROFILES = {
  codex: 'codex_orchestrator_sol',
  claude_code: 'claude_orchestrator_sonnet',
  antigravity_cli: 'antigravity_orchestrator_agy',
} as const
```

- [ ] **Step 4: Add two PRESENTATION entries** — `profilePresentation.ts`, `PRESENTATION` 객체 안 `claude_orchestrator_sonnet` 엔트리(40-46) 바로 뒤에 삽입:

```ts
  antigravity_orchestrator_agy: {
    label: '오케스트레이터',
    description: '작업을 나누고 Codex·Claude·Antigravity 팀의 결과를 종합해요.',
    detail: 'Antigravity · Gemini 3.1 Pro',
    section: 'team',
    order: 2,
  },
```
그리고 `codex_docs_luna` 엔트리(87-94) 바로 뒤(즉 team 워커들 끝)에 삽입:
```ts
  antigravity_qa_agy: {
    label: 'agy 테스트 담당',
    description: '테스트를 실행하고 회귀와 실패 원인을 확인해요.',
    detail: 'Antigravity · Gemini 3.5 Flash',
    section: 'team',
    workerGroup: 'verification',
    order: 8,
  },
```
(agy_orch `order: 2`는 orchestrator 서브그룹 내 codex(0)·claude(1) 다음. 워커 order와 다른 서브그룹이라 충돌 무영향. agy_qa `order: 8`은 기존 워커 최대 order 7 다음.)

- [ ] **Step 5: Add `uiRole` to agy frontmatter (데이터 경로 이중화)** — 네 파일 모두 동일하게

`src/cli_agent_orchestrator/agent_store/antigravity_orchestrator_agy.md`와 `examples/cross-provider/antigravity_orchestrator_agy.md`의 frontmatter `role: supervisor` 줄 바로 아래에 추가:
```yaml
uiRole: supervisor
```
`src/cli_agent_orchestrator/agent_store/antigravity_qa_agy.md`와 `examples/cross-provider/antigravity_qa_agy.md`의 frontmatter `role: developer` 줄 바로 아래에 추가:
```yaml
uiRole: qa
```
(주의: 두 built-in과 두 예제 사본 frontmatter가 이 변경 후에도 서로 동일하게 유지되는지 확인. body는 건드리지 않음.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/profile-presentation.test.ts`
Expected: PASS (3/3).

- [ ] **Step 7: Backend regression — agy 프로필 로드/노출 무결**

Run: `cd /home/minsub57/hunesion_workspace/cao-korean-orchestrator/.claude/worktrees/handoff-linux-wsl && PYTHONPATH=src uv run --no-sync python -m pytest test/ -k "profile or agent_store or agent_profiles" -q`
Expected: PASS (frontmatter에 additive `uiRole` 추가는 기존 파서에 무해; 실패 시 파서가 unknown key를 거부하는지 확인 후 보고).

- [ ] **Step 8: Commit**

```bash
git add web/src/features/profiles/profilePresentation.ts web/src/test/profile-presentation.test.ts src/cli_agent_orchestrator/agent_store/antigravity_orchestrator_agy.md src/cli_agent_orchestrator/agent_store/antigravity_qa_agy.md examples/cross-provider/antigravity_orchestrator_agy.md examples/cross-provider/antigravity_qa_agy.md
git commit -m "feat(profiles): promote antigravity agy to first-class team (orchestrator + QA)"
```

---

### Task 2: 새 작업 모달에 Antigravity 오케스트레이터 선택지 추가

**Files:**
- Modify: `web/src/features/workspace/NewTaskModal.tsx` (`ORCHESTRATOR_CHOICES` 32-39, grid 285)
- Modify: `web/src/features/profiles/ProfilesView.tsx` (팀 오케스트레이터 서브그룹 설명 277)
- Test: `web/src/test/new-task-orchestrator.test.tsx` (신규)

**Interfaces:**
- Consumes: `ORCHESTRATOR_PROFILES`(Task 1로 3개), `OrchestratorProvider`.

- [ ] **Step 1: Write the failing test** — 신규 `web/src/test/new-task-orchestrator.test.tsx`

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewTaskModal } from '../features/workspace/NewTaskModal'

const profiles = [
  { name: 'codex_orchestrator_sol', provider: 'codex' },
  { name: 'claude_orchestrator_sonnet', provider: 'claude_code' },
  { name: 'antigravity_orchestrator_agy', provider: 'antigravity_cli' },
] as any

describe('NewTaskModal orchestrator choices', () => {
  it('offers Antigravity as a third orchestrator option', () => {
    render(<NewTaskModal open profiles={profiles} onClose={() => {}} onCreate={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Antigravity 오케스트레이터' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Codex 오케스트레이터' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Claude 오케스트레이터' })).toBeInTheDocument()
  })
})
```
(주의: `NewTaskModal`의 실제 props 시그니처를 열어 확인하고 위 render props를 실제에 맞춘다. `open`/`profiles`/`onClose`/`onCreate` 이름이 다르면 실제 이름으로 교체하고, 필수 props를 최소 stub으로 채운다.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/test/new-task-orchestrator.test.tsx`
Expected: FAIL — Antigravity radio 없음(현재 2개만).

- [ ] **Step 3: Add the third choice + widen grid** — `NewTaskModal.tsx`

`ORCHESTRATOR_CHOICES`(32-39) 배열에 항목 추가:
```ts
  { provider: 'antigravity_cli', label: 'Antigravity', description: '여러 AI를 교차 조율하고 빠르게 처리해요.' },
```
그리고 라디오그룹 그리드(285) `className="grid grid-cols-2 gap-2"` → `className="grid grid-cols-3 gap-2"`.

- [ ] **Step 4: Update team orchestrator subgroup copy** — `ProfilesView.tsx:277`

`description="역할은 같고 작업을 지휘할 실행 AI만 Codex 또는 Claude로 선택해요."` → `description="역할은 같고 작업을 지휘할 실행 AI만 Codex·Claude·Antigravity 중에 골라요."`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/new-task-orchestrator.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/workspace/NewTaskModal.tsx web/src/features/profiles/ProfilesView.tsx web/src/test/new-task-orchestrator.test.tsx
git commit -m "feat(new-task): add Antigravity as a third orchestrator option"
```

---

### Task 3: 설치-provider 예제 프로필 분류(호환용 예제) + 크로스검증 Case

**Files:**
- Modify: `web/src/features/profiles/profilePresentation.ts` (`PRESENTATION` examples 섹션 107-124 뒤)
- Modify: `scripts/dev/tri_provider_check.py` (`CASES`에 예제-워커 Case 1개 추가)
- Test: `web/src/test/profile-presentation.test.ts` (Task 1 파일에 case 추가)

**Interfaces:**
- Consumes: `profileSection`(Task 1).

- [ ] **Step 1: Add failing assertions** — `web/src/test/profile-presentation.test.ts`에 append

```ts
describe('installed-provider example profiles are categorized as examples', () => {
  const ex = (name: string, provider?: string): ProfileLike => ({ name, source: 'built-in', provider: provider ?? null })
  it('routes cross-provider examples to the examples section (not 기타)', () => {
    for (const p of [
      ex('data_analyst_claude_code', 'claude_code'),
      ex('data_analyst_codex', 'codex'),
      ex('report_generator_codex', 'codex'),
      ex('cross_provider_supervisor'),
    ]) {
      expect(profileSection(p)).toBe('examples')
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/test/profile-presentation.test.ts`
Expected: FAIL — 위 4개는 PRESENTATION 미등록이라 'additional' 반환.

- [ ] **Step 3: Add examples PRESENTATION entries** — `profilePresentation.ts`, `reviewer` 엔트리(119-124) 뒤, `PRESENTATION` 닫는 `}` 앞에 삽입:

```ts
  cross_provider_supervisor: {
    label: '교차 provider 오케스트레이터 예제',
    description: '여러 provider 워커에게 분석을 위임하는 예제 오케스트레이터예요.',
    detail: '호환용 예제',
    section: 'examples',
  },
  data_analyst_claude_code: {
    label: '데이터 분석가 예제 (Claude)',
    description: 'Claude에서 실행되는 데이터 분석가 예제예요.',
    detail: '호환용 예제 · Claude',
    section: 'examples',
  },
  data_analyst_codex: {
    label: '데이터 분석가 예제 (Codex)',
    description: 'Codex에서 실행되는 데이터 분석가 예제예요.',
    detail: '호환용 예제 · Codex',
    section: 'examples',
  },
  report_generator_codex: {
    label: '리포트 생성기 예제 (Codex)',
    description: 'Codex에서 실행되는 리포트 생성 예제예요.',
    detail: '호환용 예제 · Codex',
    section: 'examples',
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/test/profile-presentation.test.ts`
Expected: PASS (Task1 3 + Task3 1 describe 전부).

- [ ] **Step 5: Add a cross-verification Case (code only)** — `scripts/dev/tri_provider_check.py`의 `CASES` 튜플에 항목 추가(기존 Case 형식 그대로):

```python
    Case(
        name="crossprov-supervisor-to-codex-analyst",
        supervisor_provider="codex",
        supervisor_profile="cross_provider_supervisor",
        worker_provider="codex",
        worker_profile="data_analyst_codex",
        callback_marker="XPROV_EXAMPLE_CB_OK",
        final_marker="XPROV_EXAMPLE_FIN_OK",
    ),
```
(참고: `cross_provider_supervisor`는 provider-agnostic 프로필이라 supervisor_provider는 실행 AI 지정용 `codex`로 둔다. 이 Case의 실 실행은 라이브 서버+로그인 필요 — Step 6.)

- [ ] **Step 6: Optional live cross-verify (본 플랜의 유일한 라이브 단계)**

Run: `cd /home/minsub57/hunesion_workspace/cao-korean-orchestrator/.claude/worktrees/handoff-linux-wsl && CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run --no-sync python scripts/dev/tri_provider_check.py only crossprov-supervisor-to-codex-analyst`
Expected: 해당 Case PASS(assign→worker(codex)→callback delivered→final marker). 실패 시 §0.13 flake 노트대로 1회 재시도. 서버 미기동/미로그인 등 환경 사유면 SKIP으로 보고(코드 결함과 구분). **이 단계는 커밋 게이트가 아니다** — 코드/유닛은 Step 4에서 이미 초록.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/profiles/profilePresentation.ts web/src/test/profile-presentation.test.ts scripts/dev/tri_provider_check.py
git commit -m "feat(profiles): categorize installed-provider example profiles + cross-verify case"
```

---

## Self-Review

- **Spec coverage:** 4-A(기타 제거: agy team화 Task1 + 예제 분류 Task3) ✅; 4-D(새작업 3번째 오케스트레이터 Task2) ✅; audit의 "uiRole/PRESENTATION 이중화" ✅(Task1 Step3-5). 미설치 CLI 제외 준수(예제 4종 중 copilot/kimi/kiro 없음) ✅.
- **Placeholder scan:** 코드 스텝 전부 실제 코드. Task2 Step1은 실제 props 확인 지시 포함(모달 시그니처 미확정분) — 실행자가 파일 열어 맞춤. 없음.
- **Type consistency:** `ORCHESTRATOR_PROFILES.antigravity_cli`(Task1) ↔ `NewTaskModal` provider 'antigravity_cli'(Task2) 일치. `OrchestratorProvider` 타입은 `keyof typeof ORCHESTRATOR_PROFILES`라 antigravity_cli 자동 포함. section 'examples'(Task3) ↔ `profileSection` 반환 일치.
- **라이브 의존:** Task3 Step6만 라이브(비-게이트). 나머지 전부 로컬 유닛/타입/빌드로 검증.

## 남은 위험

- agy `.md`에 `uiRole` 추가 시 백엔드 frontmatter 파서가 unknown key를 엄격 거부하면 Task1 Step7에서 드러남 → 그 경우 PRESENTATION 등록만으로 충분(uiRole 롤백)하고 보고.
- 모델 표기(Gemini 3.1/3.5)는 display detail 하드코딩 — Plan B에서 실제 모델(3.6 등)로 갱신 시 함께 수정.
