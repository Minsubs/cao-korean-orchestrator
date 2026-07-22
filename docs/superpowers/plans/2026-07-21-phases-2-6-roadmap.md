# MS Orchestrator UX — Phases 2–6 실행 로드맵

> 정본 스펙: `docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md`
> Phase 1(채팅 명료화)은 완료·커밋됨(로컬, 미push). 본 문서는 남은 Phase 2~6을 다음 세션이
> **Phase별 writing-plans → subagent-driven-development(SDD)** 사이클로 바로 착수하도록 하는
> 중간 로드맵이다. 각 Phase는 독립 서브시스템이라 별도 plan→구현→리뷰→(다음 Phase)로 진행한다.
> 이 문서 자체는 EOD 자율 루프에서 작성됨 — 커밋/push/merge는 사용자 턴(escalate).

## 공통 Global Constraints (전 Phase 공통)

- 디자인 토큰(`var(--…)`)만. 하드코딩 색 금지. `node design-tokens/gen.mjs --check`.
- 한국어 UI. 사용자에게 내부 식별자·마커·프로필 ID·raw 마커 노출 금지.
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`.
- 프런트 산출물은 gitignore된 `src/cli_agent_orchestrator/web_ui/`로 빌드됨(서버가 정적 서빙).
- 백엔드 변경 시 서버 재기동: `CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run --no-sync cao-server --host 127.0.0.1 --port 9889`.
- WSL: tooling 첫 호출 느림(CLI 콜드 프로브, catalog 콜드 ~22s), TTL 캐시로 이후 즉시. 프런트 타임아웃 30s.

## 모델 매핑 (설계 결정 · 현재 CLI 실측 일치 — audit 확인)

| 역할(uiRole 후보) | provider | 모델 | 프로필 파일 |
|---|---|---|---|
| 오케스트레이터 | codex | gpt-5.6-sol | codex_orchestrator_sol |
| 오케스트레이터 | claude | sonnet | claude_orchestrator_sonnet |
| 오케스트레이터 | antigravity | Gemini 3.1 Pro (High) | antigravity_orchestrator_agy |
| 빠른 탐색가 | claude | haiku | claude_scout_haiku |
| 설계 아키텍트 | claude | opus | claude_architect_opus |
| 개발자 | claude | sonnet | claude_developer_sonnet |
| 테스트 담당 | codex | gpt-5.6-terra | codex_qa_terra |
| 최종 검토자 | codex | gpt-5.6-sol | codex_reviewer_sol |
| 문서 정리 | codex | gpt-5.6-luna | codex_docs_luna |
| agy 워커(QA) | antigravity | Gemini 3.5 Flash (High) | antigravity_qa_agy |

---

## Phase 2 — 실시간 진행 카드 (작업중 현황)

**목표:** 오케스트레이터가 워커에게 위임해 콜백 대기 중일 때, 채팅 하단/상단에 "무슨 작업이 누구에게
얼마나" 진행 중인지 실시간 카드로 표시. (현재는 WAITING 텍스트만.)

**주요 파일(예상):**
- `web/src/features/workspace/useWorkspaceSession.ts` — pendingReply 폴링 상태에 진행 메타(대상 워커, 경과시간, 단계) 노출.
- 신규 `web/src/features/workspace/ProgressCard.tsx` — 카드 컴포넌트(토큰 색, 경과 타이머, 워커 아바타).
- `web/src/features/workspace/Thread.tsx` — WAITING 자리에 ProgressCard 렌더.
- 백엔드: 워커 상태/inbox 폴링은 기존 `/tooling` 또는 세션 API 재사용(신규 엔드포인트 최소화).

**핵심 데이터:** 이미 `WorkspacePendingReply{ messageId, baseline, terminalId, baselineGenerations, baselineInboxMessageId }` 존재 — 여기에 대상 워커 표시명·시작 ts를 얹어 경과시간/대상 카드화.
**TDD 포인트:** 경과시간 포맷터 단위 테스트, 폴링 상태→카드 표시/숨김 전이 테스트.
**리스크:** 폴링 주기·환각 폴링(과거 orca 버그) 재발 금지 — 카드는 표시 전용, 워커 터미널 read 유발 금지.

## Phase 3 — 에러/비용 표시

**목표:** 오케스트레이터/워커 실패(타임아웃·CLI 에러)와 토큰·비용을 사용자에게 명확히.
**주요 파일:** `useWorkspaceSession.ts`(에러 경로 ~line 317 timeout, 에러 분기), 신규 배지/토스트 컴포넌트, `api.usage.ts`/`/tooling/usage` 또는 `usage_router` 연동(비용).
**TDD:** 에러 상태→사용자 메시지 매핑, 비용 합산 포맷터.
**리스크:** 에러 원문(스택/내부 식별자) 그대로 노출 금지 — 사용자향 요약 + "원문 보기"(Phase 1 패턴 재사용) 고려.

## Phase 4 — 새작업 / 프로필 / 모델 카탈로그 / 에이전트 시각화  ★가장 큼·사용자 라이브 관심

### 4-A. 에이전트 프로필 카드 정상화 ("기타" 제거) — audit 기반, 동작 변경 無
- **원인(audit):** `antigravity_orchestrator_agy`, `antigravity_qa_agy`가 (1) `web/src/features/profiles/profilePresentation.ts:32-125` `PRESENTATION` 맵에 미등록, (2) frontmatter가 `uiRole:` 미설정(`role:`만). → `additionalProfileRole`(`profilePresentation.ts:184-186`)에서 `기타`.
- **수정안 A(권장, 데이터):** `src/cli_agent_orchestrator/agent_store/antigravity_orchestrator_agy.md` / `antigravity_qa_agy.md` frontmatter에 `uiRole: supervisor` / `uiRole: qa`(또는 developer) 추가. 백엔드 `agent_profiles.py:84`가 `meta.get("uiRole")`를 그대로 노출 → 카드 자동 분류. (examples/cross-provider 사본도 동일 반영.)
- **수정안 B(프런트):** `PRESENTATION`(`profilePresentation.ts:32-125`)에 두 프로필 엔트리 추가(라벨·설명·provider 색).
- 둘 다 적용이 안전(하드코딩 맵 + 데이터 fallback 양쪽 커버). 크로스검증은 이미 완료(둘은 3×3 매트릭스의 AG).
- **주의:** `examples/cross-provider/*`(cross_provider_supervisor, data_analyst_*×5, report_generator_codex)는 설치 시 기타로 빠지고 **매트릭스 미검증**. 실사용 예정이면 uiRole 부여 + tri/matrix Case 추가로 별도 검증 필요.

### 4-B. 모델 카탈로그 매핑 수정 (codex/claude 불일치)
- `src/cli_agent_orchestrator/services/tooling/models.py` `_KNOWN_MODELS` codex 항목이 STALE(gpt-5-codex/gpt-5/o3) — 실제는 gpt-5.6-sol/terra/luna. claude도 위 매핑표 기준 정합 확인.
- 카탈로그가 실제 프로필 모델과 일치하도록 갱신 + `test/tooling/`에 계약 테스트.

### 4-C. 에이전트 시각화 (A 역할 보드 + 작업중 B 위임계층)
- 목업 정본: `.superpowers/brainstorm/4087304-*/content/agent-viz.html`(A 보드/B 계층 마크업·색·배지 참고).
- 평소 = A 역할 보드(역할 열 카드, provider 색, 모델 배지, 상태 dot, "기타" 없음).
- 작업 중 = B 위임 계층(오케스트레이터 최상단 → 역할 그룹, 실시간 진행). Phase 2 진행 상태와 연동.
- 파일: `web/src/features/profiles/ProfilesView.tsx`(그룹 렌더), `profilePresentation.ts`(그룹/라벨), 신규 보드/계층 뷰 컴포넌트. WORKER_GROUPS(오케스트레이터/탐색·설계/구현/검증·문서) 라벨 재사용.

### 4-D. 새작업 시작 UX
- 새 오케스트레이션 작업 시작 플로우(프로필 선택 → 모델 확인 → 지시) 정돈. 스펙 4절 참조.

## Phase 5 — 로딩 / 연결 / 설정 UX

**목표:** 느린 tooling 로드 시 스켈레톤/진행 표시, 연결 실패("API에 연결할 수 없어요") 재시도 UX, 설정 경로 명확화.
**주요 파일:** `web/src/api.tooling.ts`(이미 30s 타임아웃), tooling 뷰들, 설정 화면. 백엔드 캐시/병렬은 이미 반영됨 — 프런트 로딩/에러 상태 위주.
**TDD:** 로딩/에러/재시도 상태 전이.

## Phase 6 — 마감(폴리시)

**목표:** 전 Phase 통합 후 시각/카피/접근성 다듬기, 반응형, 다크모드 토큰 정합, 잔여 Minor(아래 롤업) 처리.
- Phase 1 롤업 Minor(선택): 멀티라인 도구 JSON 누출 하드닝, `loadStoredChat` raw 타입가드, 토글-백 테스트 등 — `.superpowers/sdd/progress.md` 참조.

---

## 실행 순서 권장
1. Phase 4-A/4-B(작고 사용자 즉효, audit로 위치 확정) 먼저 → 이후 4-C 시각화.
2. Phase 2(진행 카드) → 4-C가 이를 소비.
3. Phase 3 → 5 → 6.
각 Phase: writing-plans로 bite-sized TDD 플랜 작성 → SDD(구현 sonnet / 리뷰 sonnet / 최종 opus) → 게이트 → 다음.
