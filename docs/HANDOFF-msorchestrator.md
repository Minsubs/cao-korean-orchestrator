# HANDOFF — MS Orchestrator 개편 (Codex 이어받기용)

> 2026-07-17, Claude Code 세션에서 토큰 소진으로 중단·머지. 이 문서 + `docs/specs/`만 읽으면 이어서 작업할 수 있게 작성함.

## 0. 2026-07-17 Codex 이어받기 결과
- `git pull --ff-only`: 원격과 동기화됨(`Already up to date`). 현재 `main`은 로컬 선행 커밋 4개 상태이며 push/commit은 하지 않음.
- 아래 §5의 사용량 백엔드·프런트 우선순위 1~2를 구현 완료. `/usage/accounts` 기본 로컬 집계와 Claude OAuth 한도 옵트인, TopBar 배지/팝오버/반응형 UI가 실제 서버에 연결됨.
- 라이브 검증: `http://127.0.0.1:9889/`에서 Claude Code·Codex 카드, 5시간/주간 한도, 토큰 합계, 새로고침, ESC/외부 클릭 닫힘 확인. 375/768/1280px 시각 QA 통과.
- 최종 게이트: backend `4684 passed / 14 skipped`, frontend `335/335`, usage 대상 backend `19/19`, usage+AppShell `23/23`, tsc/build/design-token/black/isort/mypy/diff-check 통과. 최신 번들 `index-CgJWDsFq.js`.
- 안전 경계: Claude 조회는 기본 off, accessToken만 읽고 refreshToken은 사용하지 않음. Anthropic 고정 호스트 요청은 redirect 금지·10초 timeout이며 토큰/비밀은 응답·로그에 노출하지 않음.
- 다음 미완료 항목은 §5-4 **크로스 검증 마지막 다리**.

### 0.1. 2026-07-18 `7426da03` Codex 오케스트레이션 재검증
- 실패 원인은 두 갈래였다. 이 저장소의 hidden editable `.pth` 때문에 생성된 Codex의 `cao-mcp-server`가 조용히 죽었고, 웹 채팅은 작업자 콜백이 아닌 중간 출력/ready 상태만으로 응답을 확정할 수 있었다.
- MCP 해석기는 깨진 sibling/PATH 실행 파일을 실제 import probe로 제외하고, 대안이 없으면 현재 로드된 source root를 넣는 isolated bootstrap을 사용한다. macOS hidden 플래그가 다시 생겨도 새 Codex 에이전트의 MCP initialize가 성공한다.
- 채팅 완료 조건은 이제 **이번 turn의 작업자 generation 전진 + 해당 작업자 ID의 새 delivered inbox callback + callback 이후 오케스트레이터 ready generation**이다. 입력 API가 반환되기 전부터 exact pending metadata를 저장하므로 패널을 닫아도 generation/inbox cursor를 복원한다. 상태와 출력은 ready snapshot → output → 동일 ready snapshot 순서로 읽어 중간 출력을 최종 상태와 결합하지 않는다.
- 모든 raw/rendered/pyte/native(Herdr) 상태 판정은 캡처 시점 generation을 고정한다. 입력이 판정 중 끼어들면 이전 프레임을 폐기하며, Codex rendered-pane의 active-turn IDLE 한 프레임은 완료 증거가 아니다. 새 작업자가 `idle/0/0`이면 미확정으로 차단하고, `idle`은 generation 전진·`ready == input`·sender callback이 모두 증명될 때만 완료로 인정한다.
- 동일 `cao-7426da03` 최종 실검증: `53c5e264` → `2bd9e73e` 메시지 `21`(`EXACT_LATEST_CALLBACK`) delivered, 역방향 메시지 `22`(`LATEST_CALLBACK_OK`) delivered. 콜백 직후에는 parent `processing 2/1`, worker `processing 1/0`이라 완료되지 않았고, parent `2/2`·worker `1/1` 정착 뒤에만 `LATEST_ORCHESTRATION_VERIFIED`가 출력됐다. 기존 `cff2a1e5`와 검증 터미널은 삭제하지 않았다.
- 최종 게이트: backend `4698 passed / 21 skipped / 97 deselected`, frontend 단일-worker 전체 `350/350`, `tsc --noEmit`, production build, black/isort/diff-check 통과. 최신 번들 `index-BqLtumkM.js`; Chrome 실화면 1440×1000 및 console error 0 확인. 독립 goal/code/security/QA 게이트는 blocker 없이 승인했고, 전체 mypy는 이번 변경과 무관한 기존 17개 오류가 남아 있어 초록으로 주장하지 않는다.
- 최신 source 서버는 `127.0.0.1:9889`의 tmux `cao-source-server`에서 PID `8878`로 실행 중이다. 서버 재시작 시 in-memory generation은 0부터 다시 시작하므로 재시작을 가로지른 pending turn은 자동 확정하지 않고 timeout까지 보수적으로 대기한다. commit/push는 하지 않았다.

### 0.2. 2026-07-18 Phase 6c 탭 마무리 실검증
- `docs/specs/phase6c-tabs-front-spec.md` 대비 Sources/EnvProfiles/Discover의 라이브 API와 실제 UI를 다시 점검했다. Sources는 디렉터리·큐레이션·마켓플레이스 실데이터를 표시했고, 375/768/1280px 캡처에서 탭 자체의 blocker는 없었다.
- EnvProfiles의 기존 누락은 `/tooling/environment`의 서버 버전을 CLI 버전처럼 비교하고 실제 `/tooling/providers` 버전을 스냅샷에 담지 않았던 점이다. v1 스키마를 유지하면서 `cli_versions`를 optional additive 필드로 추가했고, 설치된 CLI의 `name/display_name/version`만 저장한다. provider 조회 실패는 필드를 생략하고 `/tooling/providers 조회 실패`로 표시해 “미설치”로 오인하지 않는다. 기존 v1 JSON은 그대로 가져올 수 있다.
- 라이브 스냅샷 카드에서 Claude Code `2.1.212`, Codex `0.144.5`, Hermes `0.16.0`, Antigravity CLI `1.1.4`를 확인했다. 같은 스냅샷을 현재 환경과 다시 비교해 `차이가 없어요 ✨`까지 확인했으며 browser console error는 0건이다. 375px에서 하위 탭을 3열 grid, Sources 설명/새로고침을 세로 배치로 바꿔 잘림을 제거했고, 독립 시각 게이트 2곳 모두 PASS했다. 증거는 `.omo/evidence/phase6c-live/`의 Sources/EnvProfiles 375·768·1280 및 no-diff 캡처에 있다.
- 사용자 재현처럼 `npm install -g @anthropic-ai/skills`는 존재하지 않는 패키지였다. `generic-skills-cli`는 Vercel Skills CLI 홈페이지와 `npm install -g skills` 수동 설치 명령을 표시하도록 고쳤고, 탐색 탭 실제 상세 화면에서도 둘 다 확인했다. 기존 `generic_skills` 어댑터의 `skills` binary 계약은 유지한다.
- 최종 검증: backend `4698 passed / 21 skipped / 97 deselected`, frontend `362/362`, 새 EnvProfiles/Discover/Tooling 집중 `46/46`, catalog/generic adapter `39/39`, `tsc --noEmit`, production build, design-token check, diff-check 통과. 최신 번들 `index-ft73jVBC.js`. commit/push는 하지 않았다.
- 서버 재시작 뒤 `cao-7426da03`도 다시 복원됐다. 세 터미널은 모두 completed, worker `2bd9e73e.caller_id == 53c5e264`, 메시지 21 요청과 22 `LATEST_CALLBACK_OK` 회신은 양방향 delivered, parent output은 `LATEST_ORCHESTRATION_VERIFIED`다.

### 0.3. 2026-07-18 AI 오케스트레이터 전체 재검증
- Claude→Codex 마지막 다리는 완주했다. `scripts/dev/xprov_check.py`가 Claude supervisor `d369a438` → Codex worker `a2b8bd48`의 provider/caller 연결, worker 완료, supervisor inbox `delivered`, callback 재처리, 최종 평균 `5`까지 모두 PASS했다.
- 반대 방향도 Codex `analysis_supervisor` → Claude `claude_developer_sonnet`으로 완주했다. worker `882b8c44.caller_id == 1aa5d008`, 미완료 generation `2/0`, callback 뒤 parent `3/3 → 4/3(processing) → 4/4(completed)`, exact callback `CROSS_CLAUDE_CALLBACK_OK`, 최종 `CROSS_CODEX_FINAL_OK`를 확인했다.
- 동일 provider 실 E2E는 Codex/Claude 각각 `handoff`와 `assign+handoff` 4개가 전부 PASS했다. 완료 게이트 집중 회귀도 backend `71/71`, frontend `42/42` PASS했다.
- 단, 기본 팀 프리셋 전체 판정은 FAIL이다. `codex_orchestrator_sol`의 `codexApprovalPolicy: on-request`가 `load_skill`/`assign` 승인 UI에서 무인 실행을 멈추며 이때 API는 `completed`를 표시했다. 수동 세션 승인 뒤에야 worker가 생성됐다.
- `claude_scout_haiku`의 `permissionMode: dontAsk`도 assign callback에서 `send_message`를 실행하지 않고 권한 질문을 최종 출력한 뒤 `completed`가 됐다. parent inbox는 비어 있었고 Codex는 callback 대기 상태였다. `bypassPermissions`인 `claude_developer_sonnet` 대조군은 같은 경로를 통과했으므로 전송 계층이 아닌 기본 프로필 권한 문제다.
- 저장소 프로필과 설치된 agent-store 프로필은 diff 0이었다. 상세 재현과 세션 ID는 `.omo/evidence/orchestration-full-2026-07-18/report.md`에 있다. 임시 세션은 모두 삭제했고 기존 `cao-7426da03`은 보존했다.

### 0.4. 2026-07-18 고정 오케스트레이터·기본 AI 팀 구현
- 새 작업의 역할은 `오케스트레이터`로 고정하고 실행 AI만 Codex/Claude 중 선택하도록 바꿨다. 내부 profile ID는 호환용으로 유지하며 기본 팀은 탐색·설계/구현/검증·문서로 표시한다. 프로필 화면도 `기본 AI 팀`, `추가 에이전트`, `CAO 시스템 도우미`, `호환용 예제`로 재구성하고 `installed/built-in/local` 원문을 사용자용 출처명으로 바꿨다.
- `claude_orchestrator_sonnet`을 추가하고 기본 8개 팀 프로필을 packaged `agent_store`에도 포함했다. 원본과 packaged copy의 byte-for-byte 일치를 회귀 테스트로 고정했다.
- Codex 오케스트레이터는 `never/read-only`, Claude 오케스트레이터는 `bypassPermissions` + `fs_read/fs_list/@cao-mcp-server`로 제한했다. Codex 0.144.5에서 `--ask-for-approval never`만으로 MCP 승인이 사라지지 않는 것을 실재현해, 기본 Codex 팀에는 **CAO MCP만** `default_tools_approval_mode=approve`로 추가했다. Claude scout/architect도 `bypassPermissions`로 바꿔 callback을 무인 전송한다.
- `scripts/dev/fixed_orchestrator_check.py` 양방향 실검증 PASS: Codex parent `e9f41580` → Claude scout `0575239d`, callback `27`, parent `4/4` + `CODEX_TO_CLAUDE_FINAL_OK`; Claude parent `0f36c064` → Codex QA `7cfb47a9`, callback `28`, parent `3/3` + `CLAUDE_TO_CODEX_FINAL_OK`. receipt/수신만으로 완료하지 않고 caller/provider, worker generation, delivered callback, parent generation, callback 이후 final marker를 모두 확인했다.
- 실화면에서 고정 역할 radio와 역할별 팀, 기본 8개 카드, console error 0을 확인했다. frontend `364/364`, backend focused `372/372`, profile `37/37`, tsc/build/design-token PASS. 최신 번들 `index-BDgUB4JX.js`; 상세는 `.omo/evidence/agent-team-cleanup-2026-07-18/report.md`. 임시 세션은 삭제했고 기존 `cao-7426da03`은 보존했다. commit/push는 하지 않았다.

### 0.5. 2026-07-18 에이전트 생성·도구 카탈로그 피드백 6건 수정
- 프로필 생성 모달은 이제 첫 `에이전트 만들기` 클릭에서 Markdown 생성과 `POST /agents/profiles` 설치를 연속 실행하고, 성공하면 목록을 즉시 다시 읽는다. 실패할 때만 결과 화면에서 재시도·다운로드·CLI 복구 경로를 제공한다. 표시 경로도 실제 `~/.aws/cli-agent-orchestrator/agent-store/`로 바로잡았다.
- 새 프로필 frontmatter에 `uiRole`과 `specialty`를 보존해 추가 에이전트를 역할별로 나누고, 기본 8개 팀도 `고정 오케스트레이터 / 탐색·설계 / 구현 / 검증·문서`로 세분화했다. CAO 내부 `supervisor/developer/reviewer` 역할 계약은 그대로 유지한다.
- `/tooling/extensions`가 CAO 항목만 반환하던 문제를 수정해 Generic Skills, Claude Code, Codex 등 설치된 adapter 인벤토리를 함께 합친다. 실서버에서 총 129개(`cao 32`, `generic_skills 91`, `claude_code 4`, `codex 2`)를 확인했다.
- GUI PATH 밖의 `/Users/minsub/.hermes/node/bin/skills`도 안전하게 감지한다. 실제 Skills CLI 기능 6종이 모두 활성이고, Skills CLI 항목은 `installed`로 표시된다. 카탈로그 스킬 설치는 `skills add anthropics/skills --skill <name> --yes` 계약으로 수정했다.
- 선택 사항인 미설치 provider는 진단에서 제외하고, 예상된 local/installed/built-in 프로필 mirror도 경고하지 않는다. 실서버 `/tooling/diagnostics`는 현재 0건이며 UI는 info 등급을 표시하지 않는다.
- 추천 카탈로그를 35종으로 확대했다: MCP 7, Claude 공식 플러그인 13, Agent Skill 14, Skills CLI 1. GitHub/GitLab/Linear/Atlassian/Slack/Notion/Figma/Sentry/Supabase/Vercel/Cloudflare/Stripe/Asana 등을 포함한다.
- 검증: backend 관련 `252/252`, frontend 전체 `365/365`, TypeScript, production build, Black, 실제 API 및 인앱 브라우저 QA 통과. 브라우저에서 프로필 17개와 역할별 그룹, 설치 목록 129개, 추천 35개, 진단 빈 상태, console warn/error 0을 확인했다. 최신 source 서버는 tmux `cao-source-server`의 `127.0.0.1:9889`에서 계속 실행 중이며 commit/push는 하지 않았다.

### 0.6. 2026-07-18 동기 handoff 장기 실행의 채팅 조기 완료 수정
- 사용자 실재현은 새 `cao-test` 세션에서 기본 6개 프로필을 동기 `handoff`로 연결 검사한 경우다. 터미널은 최종 `6/6 연결 성공`까지 출력했지만 웹 채팅은 직전의 "응답 회수 중" 문장, 도구 호출 3건, `Working (2m 07s • esc to interrupt)` 프레임을 먼저 완료 응답으로 저장했다.
- 원인은 Codex progress 정규식이 초 단위 `Working (0s …)`만 인식하고 분 단위 `2m 07s`를 놓친 것이다. progress bullet을 일반 assistant marker로 보고 `completed`를 발행했고, 이 경로는 동기 handoff라 별도 inbox callback이 없어 target generation 조건만으로 확정됐다.
- `providers/codex.py`의 progress duration을 초/분/시간 표기로 확장했다. 클래식 채팅과 Workspace 채팅 포맷터에도 같은 active-progress guard를 추가해 상태/출력 사이의 짧은 경합에서도 진행 프레임을 최종 답변으로 승격하지 않는다.
- 실제 재현 문자열 회귀: provider minute spinner `2/2`, 두 채팅 포맷터의 진행 차단·최종 `6/6` 추출 `4/4`; 관련 frontend `32/32`, production build, diff-check 통과. 현재 `cao-test` 터미널 `8f346e88`의 최종 출력은 `6/6 연결 성공`이며 inbox가 비어 있는 것은 동기 handoff 계약상 정상이다.
- 저장소 이동 뒤 `.venv` editable `.pth`의 hidden flag가 재발해 재시작 시 import 실패가 드러났다. `uv sync --reinstall-package cli-agent-orchestrator`와 `chflags -R nohidden .venv`로 source import를 복구했다. source 서버는 tmux `cao-source-server`, `127.0.0.1:9889`에서 새 코드로 실행 중이다. commit/push는 하지 않았다.

### 0.7. 2026-07-18 오른쪽 에이전트 전체 명단·채팅 진행 기록 수정
- 새 작업 모달의 팀 체크박스는 이전까지 profile ID를 첫 프롬프트에만 넣었고 세션 명단은 저장하지 않았다. 이제 생성 직후 선택 팀을 세션별 `cao:workspace:team-roster:v1:<session>`에 저장하고, 실제 호출 전에도 오른쪽 에이전트 탭에 `대기` 카드로 표시한다. 워커가 호출되면 같은 프로필의 대기 카드를 실제 실행 카드가 대체한다. 수정 전 세션은 supervisor의 retained full output에서 제한된 `agent_profile` JSON 인자만 추출해 한 번 자동 백필한다.
- `/terminals/run-step`이 `terminal_created`/`message_sent` 플러그인 이벤트를 누락하던 경로를 수정했다. `run_agent_step()`이 create/send/delete 전 과정에 registry를 전달하고, handoff 요청은 `caller_id`와 `orchestration_type=handoff`를 함께 보낸다.
- handoff 워커는 완료 후 REST 세션 목록에서 자동 삭제되므로 UI event의 `terminal_created`에서 세션 소속 ephemeral terminal ID를 먼저 발견하도록 바꿨다. 비동기로 늦게 도착한 create event도 시간순 replay 전에 선등록하며, 실행 카드는 세션별 `cao:workspace:delegation-history:v1:<session>`에 최대 100개까지 저장해 새로고침과 서버 재시작 뒤에도 채팅/오른쪽 탭에 남긴다.
- graceful-exit 뒤 `completed → processing → terminal_killed`가 발생해도 정상 종료 워커는 `완료/종료됨`으로 유지한다. 삭제된 워커에는 제어 버튼 대신 `완료 후 자동 정리된 작업 기록`을 표시하고 profile ID 대신 사용자용 역할명(예: `테스트 담당`)을 쓴다.
- 실제 `cao-test`의 parent `8f346e88`에서 `codex_qa_terra`를 handoff해 worker `a2f7c159`가 `UI_PROGRESS_EVENT_OK`를 반환한 뒤 자동 삭제되는 경로를 검증했다. REST에는 parent만 남았지만 채팅과 오른쪽 탭에는 완료 기록이 유지됐다. 로컬 저장소를 비운 새 브라우저에서도 기존 output으로 명단이 자동 백필됐다. 최종 실화면은 `.omo/evidence/agent-roster-progress-final.png`: `에이전트 7`, 오케스트레이터 1 + 완료 기록 1 + 대기 팀 5, `작업 중 0`, console warn/error 0.
- 검증: backend 집중 `54/54`, frontend 집중 `40/40` 및 전체 `374/374`, targeted mypy/Black, TypeScript production build, `git diff --check` 통과. 현재 source 서버는 tmux `cao-source-server`, `127.0.0.1:9889`에서 `PYTHONPATH=/Users/minsub/Documents/minsubsong/cli-agent-orchestrator/src .venv/bin/python .venv/bin/cao-server --host 127.0.0.1 --port 9889`로 계속 실행 중이며 `/sessions` HTTP 200을 확인했다. `.pth` hidden flag가 재발할 수 있어 재시작도 이 명시적 `PYTHONPATH` 방식을 우선한다. commit/push는 하지 않았다.

### 0.8. 2026-07-18 알림의 세션·에이전트 식별 정보 수정
- 기존 알림 센터는 세션의 aggregate 상태만 추적하고 완료 주체를 항상 첫 terminal ID로 기록해 `cao-세션이름`만 보였다. 오케스트레이터 알림은 이제 실제 오케스트레이터 상태 전이만 추적하고, profile ID를 사용자 역할명으로 변환해 `세션 표시명 · 에이전트 역할명 · 상태`를 제목에 포함한다.
- 자동 정리되는 handoff 워커는 3초 REST poll에서 사라질 수 있으므로 Workspace의 persistent delegation card 상태 전이에서 완료/오류를 발행한다. killed 카드에 남은 stale global `processing`보다 card의 `completed`를 우선해 `login-fix · 테스트 담당 작업 완료`처럼 정확히 알린다. 승인 대기와 정체 알림도 같은 세션·에이전트 메타데이터를 저장한다.
- 저장 형식에는 optional `agentName`만 additive하게 추가해 기존 `cao:notifications:history:v1`과 호환한다. 과거 완료/승인/오류 알림은 정확한 worker 정보가 없으므로 `오케스트레이터`로 표시하고, 새 알림은 정확한 profile 역할명을 표시한다. 팝오버는 `세션 · 에이전트` context와 `작업 완료` 상태를 분리해 중복 없이 보여주며 OS 알림·스낵바에는 전체 제목을 사용한다.
- 검증: 알림 집중 `12/12`, frontend 전체 `376/376`, TypeScript와 production build 통과. Playwright 실화면 `.omo/evidence/notification-agent-context.png`에서 `login-fix · 테스트 담당 / 작업 완료`, console warn/error 0을 확인했다. 최신 번들 `index-CowQRSuC.js`; source 서버는 `127.0.0.1:9889`에서 계속 실행 중이다. commit/push는 하지 않았다.

### 0.9. 2026-07-18 Skill 최신 상태·도구 필터·세분화 에이전트 복구
- Skills CLI는 업데이트 가능 개수/버전을 비변경으로 조회하는 명령을 제공하지 않는다. 따라서 항상 업데이트가 남은 것처럼 `모두 업데이트`를 표시하지 않고, 최초에는 `전체 최신 상태 확인`, 성공 후에는 `최신 상태 확인됨 · <시각>` + `다시 확인`을 표시한다. 개별 Skill 동작도 미확인 pending 배지가 아닌 `최신화`로 구분했다.
- 탐색·추천의 종류/provider 칩을 다중 toggle에서 `전체` 또는 하나를 고르는 단일 필터로 바꾸었다. 이제 `Plugin 13`을 누르면 plugin을 제외하지 않고 정확히 13개만 표시하며, 목록 상단에 `검색 결과 13개 / 전체 35개`를 고정 표시한다. 검색 대상을 이름·설명·분류·종류·provider 한/영 표시명까지 넓혔다. 설치됨도 종류·위치·연결 도구·검색 결과 수를 표시한다.
- Claude 세분화 에이전트가 사라진 원인은 `claude_code` 에이전트 경로가 CAO 기본 프로필 폴더로 덮여 있었기 때문이다. 기본값과 실제 설정을 `~/.claude/agents`로 복구했고, native frontmatter에 CAO `provider`가 없어도 소스 디렉터리로 `claude_code`를 안전하게 추론한다. `disabled` 보관 폴더는 가짜 에이전트로 표시하지 않는다.
- 실서버에서 활성 프로필 38개, 그중 native Claude 21개를 확인했다. `frontend-developer`, `backend-developer`, `fullstack-developer`, `observability-engineer` 등은 개별 카드를 유지하면서 개발·구현/운영·관측/리뷰·리팩터링 등으로 세분화했다. 새 작업 모달에서도 추가 전문 에이전트를 개별 선택하되 기본으로는 unchecked라서 전체가 자동 실행되지 않는다.
- 라이브 Playwright 검증: catalog 35(MCP 7/plugin 13/skill 14/CLI 1), plugin 직접 필터 13/13, Codex provider 7, 설치됨 150(skill 100/plugin 6/profile 38/MCP 6; built-in 17/user 133), profile 카드 38, 새 작업 specialist opt-in, console error 0. 증거는 `.omo/evidence/tooling-plugin-13-after.png`, `.omo/evidence/agent-specialists-after.png`. frontend `380/380`, production build(`index-DT2cg_xe.js`), backend full `4738 passed / 14 skipped` 후 macOS FIFO 단일 flaky 1건은 독립 재실행 `1/1` PASS, 변경 관련 backend `96/96`, Black/isort/diff-check 통과.
- 검증 중 지원하지 않는 `skills check --help`를 비변경 확인으로 잘못 실행했고 CLI가 이를 update 흐름으로 처리해 전역 Skill 4개(`find-skills`, `computer-use`, `orca-cli`, `orchestration`)를 실제 최신화했다. 이전 버전 정보가 없어 임의 rollback은 하지 않았다.
- `.venv` hidden 플래그를 `chflags -R nohidden .venv`로 다시 제거하고 source import와 `cao-mcp-server --help`를 재확인했다. source 서버는 tmux `cao-source-server`, PID `63161`, `127.0.0.1:9889`에서 최신 코드로 계속 실행 중이며 commit/push는 하지 않았다.

### 0.10. 2026-07-18 세션 선택 시 Workbench 기본 컨텍스트 복구
- 세션 선택 직후 `useWorkspaceSession`의 새 poll이 시작되기 전에 Workbench 복원 effect가 빈/이전 터미널 목록을 보고도 해당 세션을 `복원 완료`로 기록했다. 이후 실제 터미널이 도착해도 재시도하지 않아 하단이 `컨텍스트: 선택된 에이전트 없음`과 카드 선택 안내만 표시됐다.
- 세션 변경 시 이전 터미널 컨텍스트를 즉시 비우고, `tmux_session`이 현재 선택 세션과 일치하는 터미널이 실제로 도착한 뒤에만 복원 완료로 기록하도록 수정했다. 저장된 터미널이 없으면 해당 세션의 첫 터미널(고정 오케스트레이터)을 기본 컨텍스트로 선택한다.
- 회귀 테스트를 추가했고 전체 게이트는 backend `4739 passed / 14 skipped`, frontend `381/381`, TypeScript production build, Black/isort, design-token, diff-check 통과다. 실서버 `cao-test` 선택 시 `codex_orchestrator_sol · 8f346e88`이 자동 연결되고 기존 안내 문구 0건, console error 0건을 확인했다.
- 사용자 지시로 이번 누적 변경을 `main`에 커밋하고 `origin/main`에 반영했다. source 서버 `127.0.0.1:9889`는 계속 실행 중이다.

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
2. pytest: `PYTHONPATH=src uv run --no-sync python -m pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py` (저장소 이동 뒤 console-script shebang이 옛 경로를 가리킬 수 있으므로 `python -m pytest` 사용)
3. 서버(main에서): editable `.pth`의 macOS hidden flag가 반복되므로 현재는 `PYTHONPATH=/Users/minsub/Documents/minsubsong/cli-agent-orchestrator/src .venv/bin/python .venv/bin/cao-server --host 127.0.0.1 --port 9889`를 우선한다. 현재 tmux `cao-source-server`에서 실행 중이며 uv tool 설치본(옛 코드)과 동시 기동 금지(pipe-pane 이중 연결). `uv run`이 필요하면 반드시 `--no-sync`를 붙인다.
4. 웹 게이트: `cd web && npx tsc --noEmit && npm test && npm run build`
5. e2e(실서버 필요): `PYTHONPATH=src uv run --no-sync pytest -m e2e test/e2e/... -v` — 전제 프로필 data_analyst/report_generator/analysis_supervisor/data_analyst_codex는 `~/.aws/cli-agent-orchestrator/agent-store/`에 설치돼 있음(임시 — 검증 끝나면 제거 가능). 크로스 검증 스크립트: 기존 generic은 `scripts/dev/xprov_check.py`, 기본 고정 팀은 `scripts/dev/fixed_orchestrator_check.py`(서버 떠 있을 때 `PYTHONPATH=src uv run --no-sync python ...`).

## 4. 이번에 잡은 실버그 (재발 시 참고)
- **MCP hidden 플래그**(§3-1) — 사용자 피드백 #5("팀 연결 안 됨")의 원인 1.
- **codex 디렉터리 신뢰 다이얼로그**: codex 0.144가 문구를 바꿔 `providers/codex.py`의 TRUST_PROMPT_PATTERN이 못 잡음 → 지연 초기화가 다이얼로그 위에 태스크를 붙여넣어 "No, quit"으로 CLI 즉사. 수정 완료(신문구+옵션쌍 폴백, 실캡처 테스트 2건). 미신뢰 디렉터리에서만 발생.
- **수신을 완료로 오인**: target 출력 변화나 ready 상태만으로 채팅을 확정하면 작업자 콜백 전에 중간 안내가 최종 답변이 됨. inbox callback의 sender/status/message cursor를 generation과 함께 검증하도록 수정.
- **Codex footer 단일 프레임 오인**: 처리 중 spinner가 잠깐 사라진 rendered pane을 IDLE로 읽을 수 있음. active turn의 rendered IDLE은 완료 증거에서 제외하고 ready 결과는 두 번 연속 확인.
- **Codex 분 단위 progress 오인**: `Working (2m 07s • esc to interrupt)`를 기존 초 단위 정규식이 놓쳐 assistant 응답으로 판정했다. 초/분/시간 duration을 모두 processing으로 인식하고 채팅 포맷터도 active progress를 반환하지 않는다(§0.6).
- **상태 캡처 generation 경합**: raw/rendered/pyte/Herdr 판정 도중 새 입력이 오면 과거 ready 프레임이 새 turn을 완료 처리할 수 있었음. 모든 snapshot/apply에 expected generation을 묶어 불일치 판정을 폐기.
- **상태·출력 시간축 혼합**: 병렬 HTTP 응답의 서로 다른 시점 때문에 callback 이후 generation과 callback 이전 중간 출력이 결합될 수 있었음. 동일 orchestration fingerprint가 output read 전후에 유지될 때만 대기 bubble을 최종 응답으로 교체.

## 5. 이어서 할 것 (우선순위순)
1. ✅ **사용량 위젯 백엔드 완료** — `services/usage/claude_limits.py`, `api/usage_router.py`, `main.py` 배선과 회귀 테스트 구현. 기본 요청은 로컬 파일만 집계하고 `claude_limits=true`에서만 Claude OAuth 실측 한도를 조회함. 60초 응답 캐시/120초 Claude 캐시, 증분 파일 memo, 400파일 상한, 미래 날짜 제외, malformed/non-finite 응답, redirect 차단을 테스트함.
2. ✅ **사용량 위젯 프런트 완료** — `UsageButton`을 TopBar 알림 옆에 배선. 최대 한도 배지, 80% 경고색, 계정별 한도/토큰/정직 고지, Claude 옵트인, 60초 새로고침, 로딩/에러/빈 상태, StrictMode와 요청 경합 회귀를 포함함.
3. ✅ **6c 탭 마무리 확인 완료** — Sources 실데이터, EnvProfiles 실제 CLI 버전 스냅샷/비교·legacy v1 호환·부분 실패, Discover `kind:'cli'`와 Vercel Skills CLI 수동 명령을 실서버/실브라우저에서 확인. 회귀 테스트와 3개 뷰포트 증거는 §0.2 참조.
4. ✅ **크로스 검증 마지막 다리 완료** — Claude→Codex와 Codex→Claude에서 caller/inbox delivered/generation/final output까지 확인. 상세는 §0.3과 `.omo/evidence/orchestration-full-2026-07-18/report.md`.
5. ✅ **기본 팀 프리셋 무인 권한 수정 완료** — Codex는 `never/read-only` + CAO MCP 전용 auto-approve, Claude scout/architect는 `bypassPermissions`로 수정. `scripts/dev/fixed_orchestrator_check.py`가 Codex→Claude scout와 Claude→Codex QA의 caller/inbox/generation/final output을 모두 검증한다. 상세는 §0.4.
6. **Phase 6** — 접근성/성능/Settings·Memory 라이트 테마 전환/폴링 통합/최종 보고(§26 형식). **Phase 6b 프런트** — `/env` API 소비 화면(마이그레이션·지침 관리 탭). 스펙은 `docs/specs/phase6b-spec.md` 참조(백엔드 완료).
7. **Phase 7 Electron** — `docs/electron-plan.md`대로 7a(mac 셸+서버매니저)→7b(preload+웹 감지)→7c(WSL+패키징). 셸 기본값 설정(§4)의 백엔드 시임(CAO_DEFAULT_SHELL→create_window window_shell)은 소형 선행 작업.

## 6. 미해결/사용자 확인 대기
- 기본 팀 권한 blocker는 §0.4에서 해결했다. 향후 Codex CLI에서 MCP approval config schema가 바뀌면 `scripts/dev/fixed_orchestrator_check.py`로 재검증한다.
- 도구및확장 "소스" 탭의 마켓플레이스 **추가/삭제 실행**(현재 명령 복사 안내만) — 사용자 요청 시 operations queue로.
- 미이식 클래식 기능 3건(프로필 카운트 칩·대시보드 필터/정렬·tmux 세션 배지) — 사용자 확인 대기.
- e2e용 임시 프로필 4개(agent-store) 정리 여부.
- push/PR: 사용자 지시 없음 — **로컬 머지만 완료된 상태**.

## 7. 데이터/저장 규약 (프런트 로컬)
`cao:theme`(라이트 기본), `cao:projects:v1`, `cao:hidden-providers:v1`(기본 [kiro_cli,kimi_cli,cursor_cli,hermes]), `cao:workbench:v1:<session>`, `cao:workspace:team-roster:v1:<session>`, `cao:workspace:delegation-history:v1:<session>`, `cao:env-profiles:v1`, `cao:usage:claude-limits-optin:v1`, `cao:pending-select-session`(sessionStorage). 세션명은 서버 규칙 `^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$`(cao- 프리픽스는 표시에서만 숨김 — displayName.ts).
