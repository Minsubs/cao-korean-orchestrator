# HANDOFF — MS Orchestrator 개편 (Codex 이어받기용)

> 2026-07-17, Claude Code 세션에서 토큰 소진으로 중단·머지. 이 문서 + `docs/specs/`만 읽으면 이어서 작업할 수 있게 작성함.

## 1. 프로젝트가 무엇인가
CAO fork를 "채팅 중심 멀티 에이전트 오케스트레이션 작업대 + AI CLI/확장 컨트롤센터"(**MS Orchestrator**)로 개편.
핵심 문서: `docs/ui-refactor-plan.md`(전체 계획·실행 방법·함정), `docs/electron-plan.md`(Phase 7 확정 설계 — **머지 후 착수하기로 사용자와 합의된 다음 큰 단계**), `docs/ux-benchmark.md`, `docs/specs/`(작업별 상세 스펙).
원칙: 가짜 데이터/빈 성공 화면 금지(capability 기반), 한국어 UI, 파스텔 디자인 토큰(`var(--…)`, 하드코딩 색 금지), 단계별 게이트(black/isort/mypy/pytest/tsc/vitest/build), **커밋·push는 사용자가 시킬 때만**.

## 2. 머지 시점 상태 (전부 초록)
- pytest `4665 passed / 14 skipped` · vitest `324/324` · tsc 클린 · `npm run build` 성공 · `node design-tokens/gen.mjs --check` 통과
- 완료: Phase 0~5(셸·작업공간·tooling 읽기/쓰기·프로필/모델/Flows/팔레트), Phase 5.5(실사용 피드백 17건), 2d(컨텍스트 게이지)+2e(슬래시 자동완성) 백/프런트, 6b(`/env` 마이그레이션·지침 API 4종), 6c 소스 백엔드(`/tooling/sources`), 소스 탭 프런트(SourcesPane/EnvProfilesPane — 게이트 통과 상태로 랜딩)
- 오케스트레이터 라이브 e2e: claude 8/8 PASS, codex send_message/assign 콜백 PASS(아래 §4 버그 수정 후), claude→codex 크로스는 워커 생성·provider 오버라이드·caller_id까지 PASS

## 3. ⚠️ 실행 환경 함정 (반드시 숙지)
1. **`uv run`은 반드시 `--no-sync`** — 맨 uv run이 .venv를 재동기화하며 macOS hidden 플래그를 재적용 → editable .pth 무시 → `.venv/bin/cao-mcp-server`가 ModuleNotFoundError로 즉사 → **이 서버가 만든 모든 에이전트의 assign/handoff/send_message가 조용히 전멸**(서버·pytest는 PYTHONPATH=src라 멀쩡해 보임). 재발 시 `chflags -R nohidden .venv`.
2. pytest: `PYTHONPATH=src uv run --no-sync pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py`
3. 서버(main에서): `uv run --no-sync cao-server --host 127.0.0.1 --port 9889` — 현재 백그라운드에 떠 있을 수 있음(포트 확인). uv tool 설치본(옛 코드)과 동시 기동 금지(pipe-pane 이중 연결). ※worktree는 삭제됨 — PYTHONPATH=src 불필요(main은 editable 정상), --no-sync 습관은 유지.
4. 웹 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`
5. e2e(실서버 필요): `PYTHONPATH=src uv run --no-sync pytest -m e2e test/e2e/... -v` — 전제 프로필 data_analyst/report_generator/analysis_supervisor/data_analyst_codex는 `~/.aws/cli-agent-orchestrator/agent-store/`에 설치돼 있음(임시 — 검증 끝나면 제거 가능). 크로스 검증 스크립트: `scripts/dev/xprov_check.py`(서버 떠 있을 때 `PYTHONPATH=src uv run --no-sync python scripts/dev/xprov_check.py`).

## 4. 이번에 잡은 실버그 2건 (재발 시 참고)
- **MCP hidden 플래그**(§3-1) — 사용자 피드백 #5("팀 연결 안 됨")의 원인 1.
- **codex 디렉터리 신뢰 다이얼로그**: codex 0.144가 문구를 바꿔 `providers/codex.py`의 TRUST_PROMPT_PATTERN이 못 잡음 → 지연 초기화가 다이얼로그 위에 태스크를 붙여넣어 "No, quit"으로 CLI 즉사. 수정 완료(신문구+옵션쌍 폴백, 실캡처 테스트 2건). 미신뢰 디렉터리에서만 발생.

## 5. 중단된 작업 (이어서 할 것, 우선순위순)
1. **사용량 위젯 백엔드** — `docs/specs/usage-backend-spec.md`(+ 하단 델타 = Claude 한도 실측 옵트인, 사용자 승인됨).
   WIP: `src/cli_agent_orchestrator/services/usage/{claude_transcripts.py,codex_rollouts.py}` 파서 2개는 작성됨(포맷 검증됨, 어디서도 import 안 됨). **남은 것**: claude 한도 모듈(OAuth usage API, 델타 참조), `api/usage_router.py`(자기완결, prefix /usage), main.py include 1줄, 테스트 전체.
2. **사용량 위젯 프런트** — `docs/specs/usage-front-spec.md`(+ 델타). WIP: `web/src/api.usage.ts`(100줄, 컴파일됨). **남은 것**: `features/usage/`(UsageButton — % 배지, UsagePopover — 한도 진행바 주 표시), 테스트, TopBar 배선 1줄(`web/src/app/AppShell.tsx` topbar의 알림 벨 옆에 UsageButton).
3. **6c 탭 마무리 확인** — SourcesPane/EnvProfilesPane은 게이트 통과 상태로 랜딩했지만 에이전트가 최종 보고 전에 중단됨 → `docs/specs/phase6c-tabs-front-spec.md` 대비 빠진 요건(특히 EnvProfilesPane의 스냅샷/비교 UX, DiscoverPane kind:'cli' 렌더) 실서버로 점검.
4. **크로스 검증 마지막 다리** — `scripts/dev/xprov_check.py` 1회 완주(PASS 4b~5: codex 워커의 send_message 콜백이 supervisor inbox로 도달하는지 — trust 수정 후 codex 단독 콜백 e2e는 PASS했으므로 통과 예상, 미확인일 뿐).
5. **Phase 6** — 접근성/성능/Settings·Memory 라이트 테마 전환/폴링 통합/최종 보고(§26 형식). **Phase 6b 프런트** — `/env` API 소비 화면(마이그레이션·지침 관리 탭). 스펙은 `docs/specs/phase6b-spec.md` 참조(백엔드 완료).
6. **Phase 7 Electron** — `docs/electron-plan.md`대로 7a(mac 셸+서버매니저)→7b(preload+웹 감지)→7c(WSL+패키징). 셸 기본값 설정(§4)의 백엔드 시임(CAO_DEFAULT_SHELL→create_window window_shell)은 소형 선행 작업.

## 6. 미해결/사용자 확인 대기
- 도구및확장 "소스" 탭의 마켓플레이스 **추가/삭제 실행**(현재 명령 복사 안내만) — 사용자 요청 시 operations queue로.
- 미이식 클래식 기능 3건(프로필 카운트 칩·대시보드 필터/정렬·tmux 세션 배지) — 사용자 확인 대기.
- e2e용 임시 프로필 4개(agent-store) 정리 여부.
- push/PR: 사용자 지시 없음 — **로컬 머지만 완료된 상태**.

## 7. 데이터/저장 규약 (프런트 로컬)
`cao:theme`(라이트 기본), `cao:projects:v1`, `cao:hidden-providers:v1`(기본 [kiro_cli,kimi_cli,cursor_cli,hermes]), `cao:workbench:v1:<session>`, `cao:env-profiles:v1`, `cao:usage:claude-limits-optin:v1`(예정), `cao:pending-select-session`(sessionStorage). 세션명은 서버 규칙 `^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$`(cao- 프리픽스는 표시에서만 숨김 — displayName.ts).
