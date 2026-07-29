# Phase 2 진행 카드 — 실서버 라이브 검증 (2026-07-27)

브랜치 `worktree-coldstart-phase4d` (PR #7), 번들 `index-DlrxKAtQ.js`.

## 환경

- 서버: `CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run cao-server --host 127.0.0.1 --port 9889`
- `.venv` Python `3.12.13`, provider 실측 Claude Code `2.1.220` / Codex `0.145.0`
- 서빙 번들이 Phase 2 빌드(`index-DlrxKAtQ.js`)인지 `curl` 로 확인 후 진행

## 시나리오

세션 `cao-phase2-live` 생성(오케스트레이터 = Codex Sol). 관찰을 단순화하려고 기본 팀 7명 중
`테스트 담당(codex_qa_terra)` 하나만 체크했다.

새 작업 모달의 첫 프롬프트는 `sendMessage` 가 아니라 모달이 직접 보내므로 `pendingReply` 가
등록되지 않는다(Phase 2 이전부터의 기존 동작). 따라서 진행 카드가 걸리는 경로인 **채팅 컴포저**로
2차 위임을 보내 관찰했다.

## 관측 결과 — 단계 전이

| 단계 | 화면 |
|---|---|
| dispatching | `작업 배정 중 · 7초` / `워커를 배정하는 중이에요` (워커 행 없음) |
| working | `워커 작업 중 · 35초 · 0/1 완료` / 워커 행 `테스트 담당 · Codex · 작업 중` / `테스트 담당의 콜백 대기 중` |
| 완료(접힘) | `✓ 완료 · 워커 1 · 소요 39초` + 최종 답변 `PHASE2_LIVE_OK2` + Phase 1 `원문 보기` 토글 |

REST 대조: 워커 `b7528bbb:codex_qa_terra` 가 실제로 생성 → 처리 → 콜백 후 자동 정리됐고,
오케스트레이터는 `4/4 completed` 로 정착했다. 카드가 표시한 내용과 실제 서버 상태가 일치한다.

**`callback` 단계 프레임은 캡처하지 못했다.** 워커 종료와 최종 답변 도착 사이가 너무 짧아
스냅샷 간격 사이로 지나갔다. 해당 단계의 판정 로직·렌더는 단위 테스트로만 덮여 있다.

## 부수 확인

- 사용자 노출 문자열에 프로필 ID(`codex_qa_terra`) 없음 — 항상 `테스트 담당` 표시.
- browser console **error 0 / warning 0** (초기 로드~완료~새로고침 전 구간 누적).
- **새로고침 내구성**: 전체 리로드 후에도 `✓ 완료 · 워커 1 · 소요 39초` + `PHASE2_LIVE_OK2` +
  `원문 보기` 유지. localStorage 왕복이 `readSummary` 가드를 통과함.

## 이번 검증에서 발견한 기존 결함 (Phase 2 무관, 미수정)

오른쪽 패널 `DelegationHierarchy`(Phase 4-C)가 **자동 정리된 handoff 워커를 계속 "작업 중"으로
집계**한다. 실제로는 워커 2개가 모두 삭제되고 오케스트레이터만 남았는데도 `2/2 워커 작업 중` 을
표시했다.

- 원인: `DelegationHierarchy.tsx:16-18` `statusOf()` 가 전역 `useStore.terminalStatuses` 를 그대로
  읽는데, `store.ts:107` `clearTerminalStatuses` 는 클래식 `DashboardHome.tsx:177` 에서만 호출되고
  Workspace 경로에서는 호출되지 않는다. 삭제된 터미널의 마지막 `PROCESSING` 이 스토어에 남는다.
- 같은 화면의 위임 카드는 `resolveStatus()` 가 `card.killed` 를 우선하므로 올바르게 `완료` 를
  표시한다 — 그래서 한 패널 안에서 요약과 카드가 서로 어긋난다.
- 새로고침하면 스토어가 비어 `알 수 없음` 으로 바뀐다(캡처 `after-reload.png`). 즉 영구 오류가
  아니라 리로드 전까지 남는 stale 값이다.
- Phase 2 diff 는 `store.ts`, `DelegationHierarchy.tsx`, `agentGrouping.ts`, `AgentSidePanel.tsx`,
  `RoleBoard.tsx` 중 어느 것도 건드리지 않는다(`git diff e73ce5d..HEAD --stat` 확인).

## 캡처

- `progress-card-working.png` — working 단계(19초 시점). 파일명이 stage1 로 저장됐다가 이름을
  바꾼 것으로, 스냅샷과 스크린샷 사이에 카드가 dispatching→working 으로 전이해 실제로는 working
  프레임이 찍혔다.
- `completion-summary.png` — 접힌 완료 요약 + 최종 답변
- `after-reload.png` — 전체 화면(리로드 후)

## 정리

임시 세션 `cao-phase2-live` 는 검증 후 삭제했다.
