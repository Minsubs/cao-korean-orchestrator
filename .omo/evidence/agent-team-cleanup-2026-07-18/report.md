# 고정 오케스트레이터·기본 AI 팀 정리 — 2026-07-18

## 판정

- 새 작업의 역할은 `오케스트레이터`로 고정하고 실행 AI만 Codex/Claude 중 선택한다.
- 기본 팀은 탐색·설계, 구현, 검증·문서 역할로 표시하며 내부 profile ID는 호환과 실제 라우팅을 위해 유지한다.
- `installed`, `built-in`, `local` 원문 대신 `실행용 설치본`, `CAO 기본 제공`, `내 에이전트` 등 사용자용 출처명을 표시한다.
- 기본 Codex↔Claude 양방향 assign/callback/final loop는 모두 PASS다. assign receipt나 메시지 수신만으로 완료를 인정하지 않았다.

## 권한 원인과 수정

- `codex_orchestrator_sol`을 `codexApprovalPolicy: never`, `codexSandbox: read-only`로 바꾼 첫 재검증에서도 Codex 0.144.5는 CAO MCP `load_skill` 승인 화면을 띄웠다.
- 실제 프로세스 명령에 `--ask-for-approval never --sandbox read-only`가 들어간 것을 확인했다. Codex의 셸 승인 정책과 MCP tool approval가 별도이므로 기본 Codex 팀 4개 프로필에 CAO MCP 전용 `mcp_servers.cao-mcp-server.default_tools_approval_mode: approve`를 추가했다. 다른 MCP나 파일 샌드박스는 넓히지 않았다.
- Claude 오케스트레이터/빠른 탐색가/설계 아키텍트는 `permissionMode: bypassPermissions`로 실행하되, 오케스트레이터의 허용 도구는 `fs_read`, `fs_list`, `@cao-mcp-server`로 제한했다.
- 기본 8개 팀 프로필을 `src/cli_agent_orchestrator/agent_store/`에도 포함해 새 wheel 설치에서도 같은 팀이 제공된다. 원본 `agent-profiles/`와 byte-for-byte 동기화를 테스트한다.

## 실서버 양방향 검증

명령:

```text
PYTHONPATH=src uv run --no-sync python scripts/dev/fixed_orchestrator_check.py
```

### Codex 오케스트레이터 → Claude 빠른 탐색가

- session: `cao-fixed-codex-to-clau-bab1a8` (검증 후 삭제)
- parent: `e9f41580`, `codex_orchestrator_sol`
- worker: `0575239d`, `claude_scout_haiku`, provider `claude_code`, `caller_id=e9f41580`
- worker generation: `2/2`
- delivered callback: message `27`, `CODEX_TO_CLAUDE_CALLBACK_OK`
- parent는 callback 직후 `processing 4/3`; `completed 4/4`에서만 `CODEX_TO_CLAUDE_FINAL_OK` 확인

### Claude 오케스트레이터 → Codex 테스트 담당

- session: `cao-fixed-claude-to-cod-0dc292` (검증 후 삭제)
- parent: `0f36c064`, `claude_orchestrator_sonnet`
- worker: `7cfb47a9`, `codex_qa_terra`, provider `codex`, `caller_id=0f36c064`
- worker generation: `3/3`
- delivered callback: message `28`, `CLAUDE_TO_CODEX_CALLBACK_OK`
- parent는 generation `3/3` 뒤에도 final marker가 아직 없는 순간을 통과시키지 않았고, 실제 최종 출력에서만 `CLAUDE_TO_CODEX_FINAL_OK` 확인

검증 스크립트는 worker provider/profile/caller, worker settled generation, 새 delivered callback sender/marker, parent settled generation과 callback 이후 final marker를 모두 확인한다. 두 임시 세션은 삭제했고 `cao-7426da03`과 `cao-source-server`만 남겼다.

## UI 실검증

- `http://127.0.0.1:9889/` 새 작업 모달에서 `오케스트레이터 · 고정 역할`, Codex/Claude radio, 역할별 기본 팀 6개 worker를 확인했다.
- `AI 팀과 에이전트` 화면에서 기본 AI 팀 8개, 추가 에이전트, CAO 시스템 도우미, 호환용 예제 섹션과 역할명을 확인했다.
- 기본 팀의 정상적인 local/installed/built-in mirror는 중복 경고에서 제외된다.
- 브라우저 console error: 0.

## 자동 검증

- frontend: `364 passed` (`npm test`), `npx tsc --noEmit`, `npm run build` PASS.
- backend focused: `372 passed` (`inbox`, status monitor, session service, Codex/Claude providers, agent profiles).
- agent profile focused: `37 passed`.
- design tokens: `node design-tokens/gen.mjs --check` PASS.
- production bundle: `index-BDgUB4JX.js`, `index-DbBJBrpj.css`.

commit/push는 하지 않았다.
