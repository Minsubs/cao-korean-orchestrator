# MS Orchestrator UX 개선 설계 (2026-07-21)

> 채팅 중심 오케스트레이션 작업대의 사용자 편의성 개선. 채팅 명료화 + 실시간 현황
> 가시화 + 전체 UI 라이브 감사 대응. 대부분 프론트(`web/src`) 변경 + 일부 프로필
> 메타 / 소소한 백엔드.

## 📌 쉽게 보는 요약

- **한 줄 요약:** 여러 AI를 지휘하는 오케스트레이션 화면에서, 채팅은 "지휘자(오케스트레이터)의 깔끔한 답변"만 보이게 하고, 작업이 도는 동안 "누가 뭘 하는지"를 실시간으로 보여주며, 다른 메뉴들의 자잘한 불편함까지 함께 손봅니다.
- **왜 하나:** 지금 채팅에 내부 진행 메시지·도구 로그·식별자 같은 군더더기가 섞여 나오고, 작업 현황이 한눈에 안 들어오며, 모델 목록이 실제 CLI와 안 맞는 등 사용성 문제가 있습니다.
- **무엇을 바꾸나:** ①채팅 정리 ②실시간 진행 카드 ③에러·비용 표시 ④에이전트 보기 개선+모델 매핑 정합 ⑤로딩·연결·설정 다듬기 ⑥마감 정리.
- **서비스/사용자 영향:** UI/UX 개선 위주. 오케스트레이션 로직 자체는 그대로. 사용자는 더 깔끔하고 진행이 잘 보이는 화면을 얻습니다.
- **언제 적용:** Phase별로 독립 구현·검증 후 순차 반영.
- **문제 시 롤백:** Phase 단위 revert. 실서비스 로직 변경이 적어 위험 낮음.

## 배경 / 목표

MS Orchestrator(작업공간 탭)는 사용자가 채팅으로 작업을 지시하면 고정 오케스트레이터가
워커 에이전트를 만들어 위임하는 구조다. 라이브 검증에서 오케스트레이션 기능은 정상이나
(3-AI 전 조합 완주 확인), UI/UX에 다음 불편이 있다:

1. 채팅에 오케스트레이터 최종답변 외 내부 진행 나레이션·도구/JSON·마커·식별자·장황한
   사고가 섞여 나온다.
2. 작업 중 실시간 현황(누가/무엇/단계/경과/대기대상)이 한눈에 안 들어온다.
3. 에러·승인대기·블로커가 눈에 안 띄고 조치 동선이 없다. 작업 비용/시간이 안 보인다.
4. 새 작업 모달에서 agy를 오케스트레이터로 못 고른다. 에이전트 그룹에 agy가 "기타"로
   빠지고, 모델 카탈로그가 현재 CLI(codex `gpt-5.6-*`)와 안 맞는다. 모달이 과도하게 길다.
5. 도구·확장 최초 로드가 ~17s인데 진행 표시가 없다. 서버 재시작 시 "오프라인"이 잔존한다.
   설정의 프로필 dir이 실제 사용 경로와 다르게 표시된다.
6. 자잘한 마감 이슈(비활성 사유 미표시, 내부용어 노출, 알림 배지 누적, favicon 404,
   로딩상태 불일치).

## 범위

**In:** 위 6개 영역 전부(Phase 1~6). **Out:** 오케스트레이션 코어 로직, Electron(Phase 7),
새로운 provider 추가. 기존 파스텔 디자인 토큰·한국어 UI·"가짜 데이터/빈 성공화면 금지"
원칙 준수.

## 공통 원칙 (cross-cutting)

- 디자인 토큰(`var(--…)`)만 사용, 하드코딩 색 금지(`node design-tokens/gen.mjs --check`).
- 한국어 UI 유지. 사용자에게 내부 식별자·프로필 ID·마커를 노출하지 않는다.
- capability 기반 — 데이터 없으면 정직한 빈/에러 상태(가짜 값 금지).
- 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`, 관련 백엔드는
  `PYTHONPATH=src uv run --no-sync python -m pytest`.

---

## Phase 1 · 채팅 명료화

**목표:** 채팅 = 사용자 지시 ↔ 오케스트레이터의 깨끗한 최종답변만.

**변경:**
- `web/src/features/workspace/orchestratorChat.ts`의 `formatOrchestratorOutput` 강화 —
  4종 노이즈 제거:
  1. 내부 상태 나레이션("assign 접수만으로는…", "콜백 대기 중", "재할당 안 함")
  2. 도구 호출/JSON 결과(`• Called …`, `{"success": true, …}`, 터미널 프레임 잔여)
  3. 내부 식별자·마커(terminal id, generation, `MTX_*`/검증 마커 등)
  4. 장황한 사고·라우팅 설명 — 최종 사용자향 답변만 남김
- **원문/전체로그 토글**: 각 오케스트레이터 답변 버블에 "원문 보기" 토글 — 정리 전 원본
  transcript를 접힘으로 제공(투명성). 기본은 정리본.
- `Thread.tsx`: 사용자/오케스트레이터 role만 대화 흐름으로, system/내부 메시지는 시각적
  구분(진행카드는 Phase 2).

**주의:** 마커/식별자 정규식이 사용자의 정상 텍스트를 오제거하지 않도록 보수적으로.
`orchestratorChat.ts`는 클래식 모달(`SessionChatPanel.tsx`)과 정리 규칙을 손으로 동기화하는
계약이므로 양쪽 반영.

**수용 기준:** 대표 raw transcript(내부 나레이션+도구JSON+마커 포함) 입력 시 최종답변만
남고, 원문 토글로 원본 확인 가능. 회귀 테스트(`web/src/test`)로 4종 각각 고정.

## Phase 2 · 실시간 현황 (채팅 인라인 라이브 진행카드)

**목표:** 오케스트레이터 응답 대기 동안 "무슨 일이 일어나는지"를 채팅 안에서 본다.

**변경:**
- 대기 중(오케스트레이터 processing) 채팅 스레드에 **라이브 진행카드** 삽입:
  - 각 활성 워커: 역할명(예: "테스트 담당") · provider · 상태(대기/작업중/완료) · 경과시간
  - 오케스트레이션 단계: assign → 작업중 → 콜백 → 완료 (단계 표시/진행)
  - 오케스트레이터가 지금 무엇을 기다리는지("테스트 담당의 콜백 대기 중")
  - stall(지체) 경고: `stall.ts`의 계산 재사용
  - 완료 시 "✓ 완료 (워커 N · 소요 M)"로 접힘, 펼치면 상세
- 데이터 출처: `useUiEventStream.ts`/`eventsClient.ts` 이벤트 + `delegationHistory.ts`(세션별
  위임 기록) + `terminalStatuses`. 기존 `AgentSidePanel`(오른쪽 패널)과 **동일 상태원** 사용,
  중복 없이 채팅 인라인 뷰만 추가.
- `types.ts`/`threadReducer.ts`에 진행카드 엔트리 타입 추가.

**수용 기준:** 워커 생성→작업중→콜백→완료가 채팅 카드에 실시간 반영. 완료 후 요약으로 접힘.
지체 시 경고 표시. 오른쪽 패널과 상태 불일치 없음.

## Phase 3 · 에러·비용

**변경:**
- **에러·승인대기·블로커 강조**: 워커 실패/인증문제/승인대기를 채팅 진행카드·오른쪽 패널에
  눈에 띄게(색/아이콘) + **원클릭 조치**(재시도 / 승인 이동). `statusColor.ts`/알림 연계.
- **작업별 비용·시간**: 진행카드/완료 요약에 토큰·경과. 세션 누적은 상단 사용량 위젯
  (`api.usage.ts`, `UsageButton`)과 연계 — 새 백엔드 없이 기존 usage 데이터 활용.

**수용 기준:** 실패/승인대기 케이스가 강조되고 조치 버튼 동작. 완료 카드에 토큰·시간 표시.

> **2026-07-27 실측 — 작업별 토큰은 이 수용 기준에서 제외한다.**
> 사용량 경로는 `/usage/accounts` 하나뿐이고(`api/usage_router.py:56`) provider별 `today`/`week`
> 총계와 `by_model_today` 만 반환한다. 집계 서비스(`services/usage/claude_transcripts.py`,
> `codex_rollouts.py`)는 CLI 트랜스크립트/롤아웃 파일을 날짜로만 스캔하며 CAO session·terminal 과
> 이어 붙일 키가 없다. 턴 전후 provider 총계 delta 로 대신하는 우회는 같은 머신의 다른 세션·수동
> CLI 사용량이 섞여 들어가 "이 작업의 비용"으로 제시할 수 없다(§공통 원칙 "가짜 데이터 금지").
> 따라서 Phase 3 은 **시간만** 표시한다 — 턴 경과, 워커별 경과, 완료 요약의 소요시간.
> 작업별 토큰은 backend 에서 terminal↔transcript 귀속 경로를 먼저 만든 뒤 별도 작업으로 다룬다.

## Phase 4 · 새 작업 · 프로필 · 모델 · 시각화

### 4a. agy 오케스트레이터 선택
- `NewTaskModal.tsx`: "오케스트레이터 실행 AI" 라디오에 **Antigravity** 추가(Codex/Claude/
  Antigravity 3지선다). agy 오케스트레이터 프로필(`antigravity_orchestrator_agy`) 연결.

### 4b. 에이전트 시각화 (A 기본 + 작업 중 B 전환, 합침)
- **A · 역할 보드(기본, idle)**: 역할 그룹 열(오케스트레이터/탐색·설계/구현/검증·문서) +
  카드(아바타 · provider 색[Codex 초록·Claude 앰버·Antigravity 인디고] · 모델 배지 · 상태 dot).
- **B · 위임 계층(작업 중)**: 오케스트레이터 최상단 → 역할 그룹으로 뻗는 구조, 실시간 진행
  강조. 활성 세션에 작업이 돌면 자동 B, 없으면 A. 수동 토글도 제공.
- 적용 위치: Agent 프로필 탭 + 작업공간 오른쪽 에이전트 패널(`AgentSidePanel.tsx`,
  `AgentAvatar.tsx`, `avatar.ts`). "기타" 그룹 제거.

### 4c. 모델 매핑 적용 (역할별)
프로필의 `model`을 역할 부하에 맞춰 현행 모델로 정합:

| 역할 | 실행 AI | 모델(현행) |
|---|---|---|
| 오케스트레이터 | Codex | `gpt-5.6-sol` |
| 오케스트레이터 | Claude | `sonnet` |
| 오케스트레이터 | Antigravity | `Gemini 3.1 Pro (High)` |
| 빠른 탐색가 | Claude | `haiku` |
| 설계 아키텍트 | Claude | `opus` |
| 개발자 | Claude | `sonnet` |
| 테스트 담당 | Codex | `gpt-5.6-terra` |
| 최종 검토자 | Codex | `gpt-5.6-sol` |
| 문서 정리 | Codex | `gpt-5.6-luna` |
| agy 워커(QA) | Antigravity | `Gemini 3.5 Flash (High)` |

- 프로필 파일(`agent-profiles/*.md` + byte-parity로 `src/cli_agent_orchestrator/agent_store/*.md`)에
  `uiRole`/`specialty` 메타 추가(agy 포함) → 역할 그룹 정확 분류("기타" 탈출).
- curated 8종 parity 테스트(`test/utils/test_agent_profiles.py`) 통과 유지.

### 4d. 모델 카탈로그 정합
- `src/cli_agent_orchestrator/services/tooling/models.py`의 `_KNOWN_MODELS` 갱신:
  - `codex`: `gpt-5-codex/gpt-5/o3` → 현행 `gpt-5.6-*`(sol/terra/luna 등). 가능하면 live 조회
    경로 검토, 불가하면 정적 목록을 현행값으로.
  - `claude_code`: `opus/sonnet/haiku` 별칭 유지하되 실제 모델(claude-opus-4-8 등)임을 명시.
  - antigravity는 `agy models` 실시간 유지.
- 프로필 카드 model 표시를 실제와 정합.

### 4e. 새 작업 모달 간결화
- `NewTaskModal.tsx`: 기본 노출 = 작업 지시 + 오케스트레이터 선택. 기본 팀·추가 전문
  에이전트는 "고급"으로 접힘(기본 접힘). 내부용어("내부 프로필 ID가 첫 지시에 전달") 제거/순화.

**수용 기준:** agy 오케스트레이터 선택·실행. idle=A / 작업중=B 자동전환 + 수동토글. 모든
에이전트 올바른 역할 그룹(“기타” 없음). 카탈로그·프로필 모델이 현행. 모달 간결. 프로필/
카탈로그 백엔드 테스트 통과.

## Phase 5 · 로딩 · 연결 · 설정

- **도구·확장 cold 로드**: `ToolingView.tsx` — 스켈레톤 + 부분 로딩(빠른 environment/
  providers 먼저 렌더, 느린 extensions는 뒤늦게 채움) + "CLI 조회 중…" 진행 문구. (백엔드
  캐시·병렬화는 이미 반영됨 — 관련 PR.)
- **SSE 자동 재연결**: `useUiEventStream.ts`/`eventsClient.ts`/`api.ui.ts` — 서버 재시작 등
  연결 끊김 시 자동 재연결 + "재연결 중…" 표시, 복구 시 자동 갱신(수동 새로고침 불필요).
- **설정 프로필 dir 실제 경로**: 설정 화면의 에이전트 프로필 디렉터리 목록이 실제 사용
  경로(CAO_HOME override 반영)를 표시.

**수용 기준:** cold 로드 중 스켈레톤/진행 표시, 부분 데이터 먼저 노출. 서버 재시작 후 UI가
자동 재연결. 설정 경로가 실제와 일치.

## Phase 6 · 마감

- "작업 시작" 비활성 사유 안내(지시 입력 필요).
- 내부용어 잔여 정리.
- 알림 배지 읽음/초기화 동선.
- favicon 404 해결.
- 로딩 상태(스켈레톤/스피너/텍스트) 일관화.

**수용 기준:** 각 항목 육안 확인 + console 무에러.

## 테스트 / 검증

- 프론트: 각 Phase 회귀 테스트(`web/src/test`), `tsc --noEmit`, `vitest`, `npm run build`,
  design-token check.
- 백엔드(Phase 4d/5 일부): 프로필 parity·bundled·models 테스트, `pytest -m 'not e2e'`.
- 라이브 육안(Playwright): 대표 플로우(새 작업→진행카드→완료, 도구·확장 로드, 에이전트
  A/B 전환) 실화면 + console 0.
- 오케스트레이션 코어는 기존 검증 유지(회귀 없음 확인).

## Phase 순서 / 독립성

1 → 2 → 3 (채팅 핵심) → 4 (새작업·프로필·모델·시각화) → 5 (로딩·연결·설정) → 6 (마감).
각 Phase는 독립 구현·검증·병합 가능. Phase 2는 1의 정리 로직 위에 얹힘. Phase 4c/4d는
프로필/카탈로그 동시 변경(정합 필수).

## 리스크 / 열린 질문

- 채팅 노이즈 정규식의 과다 제거 위험 → 보수적 규칙 + 원문 토글로 완화.
- codex 모델 live 조회 가능 여부 불확실 → 불가 시 정적 현행값(gpt-5.6-*)로.
- 진행카드와 오른쪽 패널 상태 정합 — 단일 상태원 사용으로 방지.
- Antigravity 오케스트레이터의 간헐 지연(별도 확인된 순차-부하 flake)은 본 UX 스코프 밖.
