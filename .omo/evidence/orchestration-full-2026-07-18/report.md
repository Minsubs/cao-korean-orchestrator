# AI 오케스트레이터 전체 재검증 — 2026-07-18

## 판정

- 오케스트레이션 전송 계층, `caller_id`, inbox `delivered`, status generation 완료 게이트는 Claude/Codex 양방향에서 정상이다.
- 기본 팀 프리셋은 전체 PASS가 아니다. `codex_orchestrator_sol`의 Codex 승인 대기와 `claude_scout_haiku`의 Claude `send_message` 거부가 무인 실행을 막는다.
- 수신 또는 ready 표시만으로 완료를 인정하지 않았다. 워커와 부모의 `input_generation == ready_generation`, 해당 워커 sender의 새 `delivered` callback, 최종 부모 출력까지 모두 확인했다.

## 라이브 교차 검증

### Claude → Codex: PASS

- 명령: `PYTHONPATH=src .venv/bin/python scripts/dev/xprov_check.py`
- 세션: `cao-e2e-xprov-cc-7a1325` (검증 후 삭제)
- Claude supervisor: `d369a438`
- Codex worker: `a2b8bd48`, `caller_id=d369a438`
- worker 상태: `processing -> completed`
- supervisor inbox: sender `a2b8bd48`, status `delivered`
- 최종 출력: 평균 `5`를 명시

### Codex → Claude 전송 계층: PASS

- 세션: `cao-e2e-xprov-cx-e6ab82` (검증 후 삭제)
- Codex supervisor: `1aa5d008`, profile `analysis_supervisor`
- Claude worker: `882b8c44`, profile `claude_developer_sonnet`, `caller_id=1aa5d008`
- 미완료 관측: worker `input/ready=2/0`
- callback 처리 관측: parent `3/3 -> 4/3(processing) -> 4/4(completed)`
- delivered callback: `CROSS_CLAUDE_CALLBACK_OK`
- 최종 출력: `CROSS_CODEX_FINAL_OK`

## 기본 팀 프리셋 결함

### 1. Codex 오케스트레이터 승인 대기

- 세션: `cao-e2e-xprov-cx-8b6832` (검증 후 삭제)
- `codex_orchestrator_sol`은 `codexApprovalPolicy: on-request`로 실행된다.
- `load_skill`과 `assign` 호출마다 Codex 승인 UI에서 멈췄다.
- 승인 UI가 떠 있는 동안 API 상태가 `completed`, generation이 settled로 표시됐다. 워커/callback 구조 게이트가 없으면 채팅이 조기 완료할 수 있는 재현이다.
- 세션 한정 승인을 수동 입력한 뒤에만 Claude worker `8e567762`가 생성됐다.

### 2. Claude scout callback 미전송

- `claude_scout_haiku`는 `permissionMode: dontAsk`로 실행됐다.
- worker는 `send_message`를 호출하지 않고 권한 요청 문장을 최종 출력한 뒤 `completed`가 됐다.
- Codex parent inbox는 빈 상태였고 parent는 `Awaiting the assigned Claude worker callback.`에서 멈췄다.
- 같은 역방향 경로에서 `permissionMode: bypassPermissions`인 `claude_developer_sonnet`은 exact callback을 정상 전송했다. 따라서 CAO callback 전송 계층이 아니라 기본 reviewer/scout 권한 프리셋 문제다.
- 저장소 `agent-profiles/`와 설치된 `~/.aws/cli-agent-orchestrator/agent-store/`의 세 프로필 diff는 0이었다.

## 단독 공급자 실 E2E

명령:

```text
PYTHONPATH=src .venv/bin/python -m pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -o addopts= -k 'TestCodexSupervisorOrchestration or TestClaudeCodeSupervisorOrchestration'
```

- Codex supervisor handoff: PASS
- Codex supervisor assign + handoff + delivered callback: PASS
- Claude supervisor handoff: PASS
- Claude supervisor assign + handoff + delivered callback: PASS
- 합계: `4 passed, 12 deselected in 297.86s`

## 완료 게이트 회귀

- backend inbox/status/session: `71 passed` (`test/api/test_inbox_messages.py`, `test/services/test_status_monitor.py`, `test/services/test_session_service.py`)
- frontend chat/session completion: `42 passed` (`workspace-session-completion`, `session-chat`, `workspace`)
- Vitest는 jsdom canvas 미구현 경고를 출력했지만 3개 파일/42개 테스트와 프로세스 종료 코드는 정상(0)이었다.

## 종료 상태

- 임시 `e2e-xprov-*`와 pytest E2E 세션은 모두 삭제됐다.
- `cao session list --json`에는 기존 `cao-7426da03`과 `cao-source-server`만 남았다.
- source 서버: tmux `cao-source-server`, pane PID `8878`, `/health` OK.
- 기존 `cao-7426da03`의 세 터미널은 보존했다.
- commit/push는 하지 않았다.
