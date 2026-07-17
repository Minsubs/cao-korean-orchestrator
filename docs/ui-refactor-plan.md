# UI 개편 계획 — 채팅 중심 오케스트레이션 작업대 + 도구/확장 컨트롤센터

> Phase 0 분석 산출물. 설계 확정본은 목업 v9 (MS Orchestrator, artifact `d1214cab`)이며,
> 이 문서는 저장소 분석 결과와 단계별 구현 계획을 기록한다.

## 1. 현재 구조 분석 요약

### 프런트엔드 (`web/`, React 18 + TS strict + Vite + Tailwind + Zustand)
- 상단 탭 5개 SPA: 홈(DashboardHome) / 에이전트(AgentPanel) / 자동화(FlowsPanel) / 설정(SettingsPanel) / 메모리(MemoryPanel+Graph)
- Terminal(xterm)·Output·Inbox·SessionChatPanel(사용자 커스텀 채팅)·NotificationCenter는 전부 **모달**
- 데이터: REST 폴링(세션 10s) + 터미널 PTY WebSocket(`/terminals/{id}/ws`)만 사용
- 디자인 토큰: `design-tokens/{tokens,status}.json` → `gen.mjs` → `web/tailwind.preset.cjs` + `web/src/status.generated.ts` (+ cao_mcp_apps CSS) — **CI가 gen --check로 drift 검사**
- 빌드 산출물: `vite build` → `src/cli_agent_orchestrator/web_ui` (wheel에 번들, **경로 이동 금지**)

### 백엔드 (FastAPI, `api/main.py` 약 2.9k줄)
- Sessions/Terminals(input·key·output·exit·working-directory·defer_init·caller_id), Inbox(전송·조회),
  Flows CRUD+run, Memory, Graph, Workflows(runs/steps), Agent profiles(+install), Providers(binary 감지), Skills content, Settings
- 상태 감지: 이벤트 버스(FifoReader→StatusMonitor→InboxService), 터미널 상태 6종
  `idle|processing|completed|waiting_user_answer|error|unknown`
- 구조화 이벤트: plugin 이벤트 5종(post_send_message[assign/handoff/send_message]·post_create/kill_session/terminal)
  → EventLogPublisher → SseBus → `GET /events`(SSE)+`/events/history` — 단 `CAO_MCP_APPS_ENABLED` 기본 꺼짐, 6-primitive로 축약됨
- 응답 추출: `GET /terminals/{id}/output?mode=last`가 provider별 `extract_last_message` + 단계적 스크롤백 확장 수행
- 보안: auth scope(JWKS, 선택), TerminalId/경로 검증, env-var redaction, audit_log

### 보존해야 할 사용자 커스텀 (커밋 d83554a)
- SessionChatPanel(세션별 오케스트레이터 채팅, localStorage `cao:session-chat:v2:*`), NotificationCenter(브라우저 알림)
- 한국어 UI, `restore_terminal_monitors`(서버 재시작 후 상태 복원), Claude 추출 패턴 강화,
  `codexApprovalPolicy/codexSandbox`, `dontAsk` permissionMode, agent-profiles/ 7종, 관련 테스트

### 기존 기능 보존 목록 (완료 조건)
세션 목록/생성/종료 · Agent Profile 확인/실행/중지 · Terminal 실시간 출력/입력 · Inbox · Output ·
Flows · Settings(agent-dirs/skill-dirs/memory) · Memory(+Graph) · 서버 연결 오류 표시 · 알림 · 세션 채팅 이력

## 2. 정보 구조 — 변경 전/후

```
변경 전:                          변경 후 (목업 v9):
상단 탭 5개                        App Shell
├─ 홈                             ├─ 작업공간 (Workspace)
├─ 에이전트                        │  ├─ 프로젝트/그룹/세션 Sidebar (그룹 = 솔루션 > web/engine…)
├─ 자동화                          │  ├─ Orchestration Thread (계획/위임/오류/승인 카드 + 위치 칩)
├─ 설정                            │  ├─ Message Composer (수신 대상 표시, ⌘⏎)
└─ 메모리                          │  ├─ Agent / 작업 큐 / 세션 정보 우측 Panel
                                  │  └─ 하단 Workbench (Terminal·Output·Inbox·Logs 도킹)
                                  ├─ 자동 실행 · Flows (스케줄 + 최근 실행 + Workflow run 조회)
                                  ├─ 도구 및 확장 (개요/설치됨/탐색/업데이트/소스/환경 프로필/진단)
                                  ├─ Agent 프로필 (역할×전문분야×모델 + 모델 카탈로그)
                                  ├─ 메모리 (기존 유지)
                                  └─ 설정 (기존 유지)
```

핵심 UX 결정(목업 확정): 새 작업 = **프로젝트 그룹에 지시**(그룹 루트 세션) → Supervisor가 하위 프로젝트
판단 → 워커를 프로젝트별 `working_directory`로 실행(기존 터미널 API 지원). 단일 프로젝트도 동일 흐름.
에이전트 = 기본 역할 7종(권한 축) × 전문 분야(내용 축, description 자동 생성). 다크/라이트 지원(기본 다크).

## 3. 설계 결정 사항

1. **Orchestration Thread 데이터**: 터미널 문자열 파싱 금지 원칙 유지. plugin 이벤트를 UI 전용
   additive SSE(`/ui/events` 계열, 원본 event_type+detail 보존, MCP Apps 게이트와 분리하되 동일 auth 게이트)로 노출.
   Supervisor 대화는 기존 `mode=last` 추출 재사용. 구조화 계획 데이터가 없으면 추측 표시하지 않음.
2. **이벤트 휘발성**: SseBus 링은 메모리(재시작 시 소실) — Timeline은 이벤트(휘발)+inbox(영속)+세션/터미널
   현황(영속) 혼합. 소실 구간은 "확인할 수 없음". 이벤트 영속화는 스코프 밖.
3. **Tooling 백엔드**: `api/tooling.py`(APIRouter) + `services/tooling/` 신설. main.py는 include만.
4. **프런트 구조**: 빅뱅 금지 — 기존 컴포넌트 제자리 재사용, AppShell을 새로 얹고 신규 화면만 `features/`.
   메모리 탭은 최상위 유지.
5. **실시간**: Thread는 SSE, Tooling operation은 폴링(2s)+이벤트 보강. 새 WS 채널 없음.
6. **프로젝트/그룹**: 백엔드 무변경(UI 데이터 모델 + localStorage). 그룹 루트 세션 = 부모 working_directory.
   하위 폴더 스캔만 additive API 필요(renderer 파일시스템 접근 금지).
7. **보안**: renderer→백엔드는 enum action + 검증된 id/scope만. argv 배열 실행, allowlist, timeout,
   출력 제한, secret masking, 경로 canonicalization. 위험 작업은 Preview 확인 모달 필수.

## 4. Additive API 후보 (기존 동작 무변경)

| API | 용도 | Phase |
|---|---|---|
| `GET /ui/events` (SSE) + `/ui/events/history` | Thread 이벤트 (원본 vocabulary) | 2 |
| `GET /fs/list?path=` (읽기 전용, 경로 confinement) | 그룹 하위 폴더 스캔 | 2 |
| `GET /tooling/environment` | OS/arch/shell/WSL/server 버전 | 3 |
| `GET /tooling/providers` | CLI 경로+버전 probe (capability 포함) | 3 |
| `GET /tooling/extensions` (+`/{provider}/{id}`) | 설치 확장 통합 조회 | 3 |
| `GET /tooling/diagnostics`, `POST /tooling/scan` | 진단 | 3 |
| `POST /tooling/{install,update,remove,...}` + `GET /tooling/operations*` | 쓰기 + Operation Queue | 4 |
| `GET /tooling/models` | provider별 모델 카탈로그(agy 실조회) | 5 |
| `GET /flows/runs` (이력) | Flows 최근 실행 | 5 |

## 5. Phase 계획 (각 Phase 종료 시 lint·typecheck·test·build 게이트)

- **Phase 0 — 분석** ✅: 본 문서 + docs/ux-benchmark.md. 기준선 게이트 실행.
- **Phase 1 — 토큰/테마 + App Shell (P0)**
  1a. design-tokens 확장(파스텔 팔레트·spacing·radius·z-index·panel, 라이트/다크 페어) + gen.mjs가
      `web/src/theme.generated.css`(CSS 변수, `:root[data-theme]`) 산출 + preset를 var() 참조로 전환.
      cao_mcp_apps 소비자·CI parity(--check) 유지. — **Opus**
  1b. AppShell(레일/TopBar/Sidebar/RightPanel/Workbench 골격 + 다크/라이트 토글 + 패널 접기)
      + 기존 5화면 재배치(기능·테스트 보존, tooling은 정직한 "준비 중" placeholder). — **Sonnet**
- **Phase 2 — 작업공간 (P0)**
  2a. 백엔드: UI 이벤트 SSE + fs/list + (필요시) 이벤트 정규화 레이어. — **Opus**
  2b. 프런트: 프로젝트/그룹 사이드바, 새 작업 모달(그룹 지시), Orchestration Thread(카드+위치 칩),
      Composer, Agent 패널, Workbench 도킹, SessionChatPanel 로직 승격, 재연결 처리. — **Sonnet(+Opus 보조)**
- **Phase 3 — Tooling 읽기 전용 (P0)**
  3a. 백엔드: environment/providers(버전 probe)/extensions(CAO 자산+provider-native 조회 가능 범위)/diagnostics. — **Opus**
  3b. 프런트: 개요/설치됨(3단)/진단 화면, capability 기반 버튼 상태. — **Sonnet**
- **Phase 4 — 쓰기 경로 + Operation Queue (P1)**
  Command Runner(argv·allowlist·timeout·masking), Operation Manager(상태 전이·취소·완료 후 재검증),
  Generic Skills adapter(감지 시에만), Preview 모달, 업데이트 탭. — **Opus(백엔드)+Sonnet(UI)**
- **Phase 5 — Provider 어댑터 + 프로필/모델/Flows (P2 선별)**
  Claude/Codex/AGY 어댑터(실지원 범위만, TUI 파싱 금지, Terminal fallback), 모델 카탈로그,
  에이전트 추가(역할×전문분야×설명), Flows 화면 개편(+실행 이력), Command Palette. — **Opus+Sonnet**
- **Phase 6 — 마무리**
  환경 프로필(비교/Export/Import), 접근성·키보드, 성능 점검, 최종 게이트, 최종 보고(§26 형식). — **Sonnet+검증 Fable**
- **Phase 7 — Electron 패키징** (개편 완료 후, 원 요구사항의 최종 목표)
  Electron main이 cao-server 수명 관리(macOS 로컬 / Windows는 wsl.exe로 WSL 서버 기동·연결),
  렌더러=기존 web UI(loadURL http://127.0.0.1:9889 — HTTP-only 구조라 이식 비용 최소).
  electron-builder(mac dmg arm64 / win nsis x64), 네이티브 시임 교체(DirectoryPicker→native dialog,
  알림→OS, 외부 링크, 글로벌 단축키, 트레이), contextIsolation·렌더러 Node 미노출.
  Windows/WSL 실검증은 회사 PC에서 사용자 수행.
- (제외) IDE 기능(파일 뷰어/에디터/MD 뷰어)은 이 개편 스코프에서 다루지 않는다 — Electron 완성 후 별도 진행하기로 결정(2026-07-17).

우선순위 방침: P2가 P0/P1 품질을 훼손하면 P2를 줄인다. mock 데이터·가짜 성공 표시 금지.
지원되지 않는 기능은 비활성화+사유 표기.

## 5.5 실행 방법과 알려진 주의사항 (이 worktree)

```bash
# 새 UI로 서버 실행 (기존 uv tool 설치본은 옛 코드 — 동시에 켜지 말 것: pipe-pane 모니터 이중 연결 위험)
uv run cao-server --host 127.0.0.1 --port 9889
```
- **macOS + 이 worktree 한정 (치명적)**: 맨 `uv run`/`uv sync`가 .venv 파일에 hidden 플래그를 재부여해
  editable 설치(.pth)가 조용히 무시될 수 있다(Python 3.11+는 hidden .pth를 건너뜀). 증상:
  `ModuleNotFoundError: cli_agent_orchestrator`. **가장 위험한 2차 효과**: 서버는 터미널 생성 시
  에이전트 mcp.json에 자기 인터프리터 옆 `.venv/bin/cao-mcp-server` 절대경로를 심으므로(utils/mcp_resolution
  tier 1), 이 상태에서 만든 모든 에이전트의 assign/handoff/send_message가 "MCP 시작 실패"로 조용히 죽는다
  (서버·pytest 자체는 PYTHONPATH=src라 멀쩡해 보임 — 2026-07-17 라이브 e2e에서 실증).
  해결: `chflags -R nohidden .` 후 재실행, 이후 실행은 항상 `uv run --no-sync …` 사용.
- UI 이벤트 링은 메모리(용량 1000) — 서버 재시작 시 스레드의 과거 이벤트 라인은 소실되고
  에이전트 카드는 REST 시딩으로 유지된다(의도된 트레이드오프).
- 라이트 모드에서 Settings/Memory 화면은 다크 하드코딩이 남아 혼재 — Phase 6에서 전환.

## 6. 게이트 명령 (기준선과 동일)

```bash
# backend
uv run black --check src/ test/ && uv run isort --check-only src/ test/
uv run pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py
# frontend
cd web && npx tsc --noEmit && npm test && npm run build
# tokens
node design-tokens/gen.mjs --check
```
