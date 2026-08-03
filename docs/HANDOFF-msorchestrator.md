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

### 0.11. 2026-07-20 Linux WSL 환경·경로 재확정
- 저장소가 macOS(`/Users/minsub/Documents/minsubsong/cli-agent-orchestrator`)에서 Linux WSL2 `/home/minsub57/hunesion_workspace/cao-korean-orchestrator`로 옮겨졌다. HEAD `0296280`(직전 작업 커밋)에서 §0~§0.10 변경은 전부 커밋·`origin/main` 반영 상태다.
- 실측 툴체인: Python `3.14.4`(linuxbrew), uv `0.11.18`, node `v24.15.0`/npm `11.12.1`, tmux 설치됨. `.venv`는 이 박스에 **아직 없어** `uv sync` 부트스트랩이 선행이며, 9889 서버도 미기동이다.
- macOS 전용 함정(editable `.pth` hidden flag·`chflags`·`--no-sync` 강제)은 Linux에 해당 없다. §3을 Linux WSL 기준으로 재작성하고 macOS 원문은 §3.1에 참고 보존했다.
- 신규 함정: 워크트리가 CRLF, git index는 LF(`.gitattributes` 없음·`core.autocrlf` 미설정)라 `git status`가 973개 파일을 phantom 수정으로 표시한다(내용 동일, EOL만 차이; `211814 ins == 211814 del`). 실변경 아님. 정리는 사용자 승인 후 `.gitattributes` + `git add --renormalize .`. 이 문서 편집은 fresh 워크트리(LF)에서 수행했다.
- 게이트 검증 완료(Linux WSL, Python 3.12.13): backend pytest `4739 passed / 14 skipped`(§0.10 baseline 일치), web `tsc --noEmit` 0 error·vitest `381/381`·`vite build` ✓. 최초 `uv sync`는 Python 3.14 wheel 부재로 실패해 `uv sync -p 3.12`로 고정 후 통과했다(§3).
- 검증 중 backend 1건 회귀(`test_settings_service.py::test_ignores_unknown_keys` `assert 120==60`)를 잡았다. 제품 버그가 아니라 `get_server_settings()` 캐시의 mtime_ns 충돌에 취약한 테스트 격리 결함으로, `settings_file` fixture가 모듈 캐시를 리셋하도록 수정(제품 코드 무변경). 재실행 4739 전부 통과.
- 서버 기동(9889)·e2e·mypy/black/isort는 이번에 실행하지 않았다. 서버는 §3-1 명령, e2e는 §3-4 전제 프로필 필요.
- 이 세션 작업은 워크트리 브랜치 `worktree-handoff-linux-wsl`에 커밋만 했다(HANDOFF 갱신 + 테스트 격리 fix). GitHub 인증(`gh` 미설치/HTTPS credential 없음)으로 push/PR은 사용자 조치 대기다.

### 0.12. 2026-07-20 Linux WSL 오케스트레이션 재검증 + antigravity 크로스체크
- Linux WSL에서 실 CLI 에이전트 오케스트레이션을 재검증하며 환경/버전 blocker 4건을 발견하고 코드 3건을 고쳤다. 서버는 `CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run --no-sync cao-server --host 127.0.0.1 --port 9889`로 기동한다(CAO_HOME은 ext4 경로 필수).
- **blocker 1 (fix, `constants.py`)**: `~/.aws`가 Windows 9p 마운트 symlink이라 `CAO_HOME_DIR`의 FIFO가 `os.mkfifo` ENOTSUP로 실패 → terminal 생성·모든 오케스트레이션 사망. `CAO_HOME_DIR` env override 추가로 ext4 경로 지정해 회피.
- **blocker 2 (환경)**: codex CLI 첫 실행이 자동 업데이트 프롬프트(`npm install -g @openai/codex`)로 에이전트 모드 진입 실패. codex가 `0.144.4→0.144.6`으로 자가 업데이트 완료 후 해소(코드 변경 없음).
- **blocker 3 (fix, `providers/claude_code.py`)**: Claude Code 2.1.x의 신규 대화 "Allow external CLAUDE.md file imports?"(CLAUDE.md 체인이 cwd 밖을 @import하면 표시)를 startup-prompt 핸들러가 몰라 worker init timeout. `EXTERNAL_IMPORT_PROMPT_PATTERN` + 기본 선택 Enter 자동수락 추가.
- **blocker 4 (fix, `providers/antigravity_cli.py`)**: agy 1.1.x가 `"? for shortcuts"` 힌트 대신 상태바(`│ Idle │` / `│ Working │`)를 쓴다. `IDLE_STATUSBAR_PATTERN`·`PROCESSING_STATUSBAR_PATTERN`을 get_status/get_status_from_screen에 추가(processing이 idle보다 먼저 평가). 이전엔 idle이 unknown, busy 미감지라 PROCESSING→IDLE 엣지 부재로 `ready_generation`이 0에 머물러 InboxService busy-guard까지 무력화됐다. 실캡처 문자열 기반.
- **체크 게이트 보정(`scripts/dev/fixed_orchestrator_check.py`)**: supervisor-ready를 status 기반으로 완화(launch 시 `input_generation==ready_generation` 요구 제거). claude는 launch 턴이 없어 `ready_generation=0`이 정상이고 codex의 통과는 배너 아티팩트였다. generation 등가 검증은 태스크 이후(worker-settled/supervisor-final)에만 유지.
- **검증 결과(실 에이전트)**: `codex→claude` PASS(x2), `agy→codex` PASS(antigravity가 orchestrator로 assign→codex worker→callback→final marker 완주, 크로스 콜백 codex→agy delivered). provider 단위 테스트 회귀 `190 passed`.
- **미해결 2건**: (a) `codex→agy`는 assign이 대상 프로필의 `provider: antigravity_cli` 대신 caller provider(codex)로 폴백 — 별도 assign provider-resolution 이슈(agy 자체 아님, agy 워커 창은 올바른 프로필로 생성됨). (b) `claude→codex`(claude가 orchestrator)는 게이트 완화 후 재검증하지 않음(완화로 통과 예상). 둘 다 다음 세션 후속.
- agy 프로필(`antigravity_orchestrator_agy`, `antigravity_qa_agy`)은 `examples/cross-provider/`에 커밋, 런타임은 `~/.local/share/cao-home/agent-store/`에 설치해 서버가 서빙. 3-way 체크는 `scripts/dev/tri_provider_check.py`. 커밋 `7419954`·`fb84de9`(브랜치 `worktree-handoff-linux-wsl` / PR #2). 임시 세션은 정리했다.

### 0.13. 2026-07-20 3-AI(codex·claude·antigravity) 전 조합 크로스 오케스트레이션 검증
- codex/claude_code/antigravity_cli 3개를 supervisor×worker 3×3 = 9개 조합으로 실 CLI 에이전트 검증했다(`scripts/dev/matrix_check.py`, 부분 실행 인자 지원). 각 케이스는 assign→worker(provider 정확)→callback delivered→supervisor final marker까지 엄격 판정한다.
- **assign provider-resolution 수정**: `codex→agy`에서 worker가 codex provider로 잘못 생성되던 근본 원인은 (1) 스폰된 `cao-mcp-server` 자식 프로세스가 `CAO_HOME_DIR` override를 상속받지 못해 런타임 agent-store(ext4)에만 설치된 agy 프로필을 못 찾고, (2) `resolve_provider`가 profile-load 실패 시 무로그로 caller provider를 반환한 것이다. `claude_scout_haiku`가 정상이던 이유는 packaged built-in이라 CAO_HOME 무관하게 발견되기 때문. **수정**: antigravity 프로필 2종을 `src/cli_agent_orchestrator/agent_store/`에 built-in 번들(codex/claude와 동일 취급, curated 8종 parity 테스트는 고정 목록이라 무영향) + `resolve_provider` 폴백에 경고 로그.
- **결과: 9/9 전 조합 통과**. 첫 실행 7/9(CX→CX, CL→CX, CL→CL, CL→AG, AG→CX, AG→CL, AG→AG), 재시도로 나머지 2(CX→CL, CX→AG) 통과. 모든 provider가 orchestrator·worker 양쪽으로 검증됐고, worker provider도 프로필대로 정확(예: codex→agy worker = `antigravity_cli`).
- **관찰된 flake(코드 버그 아님)**: 첫 실행의 CX→CL·CX→AG는 non-codex worker가 태스크는 완료(gen 2/2)했으나 callback(send_message)을 제한 시간 내 안 보냄 → 재시도 즉시 통과. 같은 worker 프로필이 다른 orchestrator 밑(CL→CL·AG→CL·CL→AG·AG→AG)에선 첫판에 callback 전송했으므로 provider 문제가 아니라 real-agent LLM 비결정성이다. 재시도 가치 있음.
- **부수 확인**: `claude→codex`(§0.12의 미해결 (b))는 매트릭스 `CL→CX` PASS로 해소됐다(게이트 완화 효과). `agy` 는 orchestrator·worker 양쪽 모두 완주.
- **회귀**: backend 전체(`-m 'not e2e'`) 통과 — `test_constants`에 CAO_HOME_DIR override 테스트 추가로 갱신. provider 단위 `190 passed`. 커밋 `985abef`(agy built-in+로그+matrix) 및 test_constants fix. 임시 세션 정리, 서버는 `127.0.0.1:9889`(ext4 CAO_HOME) 유지.

### 0.14. 2026-07-21 UX 개편 Phase 1(채팅 명료화) 구현 + Phase 2~6 로드맵 (EOD 자율 세션, Claude Opus)

브랜치 `wsl-3ai-orchestration`. 이 세션은 UX 개선을 6 Phase 스펙으로 설계(브레인스토밍→스펙 승인)한 뒤,
subagent-driven-development(구현 sonnet / 리뷰 sonnet / 최종 opus)로 **Phase 1만** 구현·검증했다.
마지막에 `/end-of-day-handoff-loop`로 전환되어 **커밋/push/merge는 하지 않았고**(전부 사용자 턴) 로드맵·인수인계만 남긴다.

- **스펙(6 Phase 정본):** `docs/superpowers/specs/2026-07-21-ms-orchestrator-ux-design.md` (①채팅 명료화 ②실시간 진행카드 ③에러/비용 ④새작업·프로필·모델카탈로그·에이전트 시각화[A 역할보드+작업중 B 위임계층] ⑤로딩/연결/설정 ⑥마감). 사용자 승인 완료.
- **Phase 1 플랜:** `docs/superpowers/plans/2026-07-21-chat-clarity.md`. **Phase 2~6 실행 로드맵(신규, 이 세션):** `docs/superpowers/plans/2026-07-21-phases-2-6-roadmap.md` — 모델 매핑표·audit 결과·정확한 수정 위치 포함. SDD 진행 렛저: `.superpowers/sdd/progress.md`(gitignore scratch).

- **Phase 1 구현 내용 (로컬 커밋 5개, `8122a42..d0066b8`, 미push):**
  - `42c5102` — `sanitizeResponseBlock`에 노이즈 4종 제거(내부 나레이션·도구결과 JSON·단독 마커·`• Called` 도구호출). `web/src/features/workspace/orchestratorChat.ts`와 `web/src/components/SessionChatPanel.tsx` 두 곳 byte-identical 손 동기화(테스트 `web/src/test/orchestrator-chat-output.test.ts`가 `it.each([classic, workspace])`로 양쪽 동시 검증).
  - `9dd51bf` — 과다제거 방지 강화: JSON 규칙은 도구 metadata 키(`terminal_id/sender_id/message_id/thread_id/agent_id/success`)가 있는 라인만 제거(일반 JSON 답변 보존), 나레이션의 흔한 단어 `재할당/메시지 도착`은 불릿(`•/-/*`) 라인에서만 제거 + 회귀 테스트.
  - `b66fca8` — `ChatEntry.raw?`(assistant 전용 정리 전 원문) 추가. `saveStoredChat`/`loadStoredChat` 왕복 보존(load 시 assistant는 `raw ?? content`로 content 재정리). 라이브 경로는 `useWorkspaceSession.ts`의 WAITING placeholder를 `replaceChatEntry(id, content, raw?)` 헬퍼로 in-place 패치(3번째 param 추가, `raw !== undefined` 가드로 기존 호출부 무영향).
  - `d30ba45` — **과다제거 실버그 수정**: `formatOrchestratorOutput`가 `• Called` 뒤 최종답변이 **비불릿 평범한 산문**이면 `finalStart<0`으로 전체를 `''`로 버리던 문제. 이제 마지막 도구호출 이후를 sanitize해 보존(도구호출만 있으면 정리 결과가 비어 `''` → WAITING 유지). 두 파일 동기 + 회귀 2건(보존/WAITING).
  - `d0066b8` — `Thread.tsx`의 `ChatBubble` export + "원문 보기"/"정리본 보기" 토글. assistant이고 `raw` 존재 & `raw.trim() !== content.trim()`일 때만 노출. raw는 안전한 plain JSX 텍스트(React 이스케이프, dangerouslySetInnerHTML 아님). 토큰 색만 사용.
  - **검증:** Phase별 리뷰 전부 Approved, 최종 전체브랜치 리뷰(opus) **Ready to merge**(Critical/Important 0). HEAD `d0066b8` 게이트: `tsc --noEmit` 0 error, `npm test` **400/400**(42 파일), `npm run build` 성공. 작업트리 클린.
  - **잔여 Minor(선택, 후속 Phase에서):** 멀티라인 pretty-print 도구 JSON은 단일라인 앵커 규칙을 통과해 누출 가능(실제 도구출력은 단일라인이라 저위험); `loadStoredChat` 필터가 `raw` 타입 미검증(변조 localStorage → outer try가 잡아 크래시는 없음); 토글-백/라벨전환 테스트 부재. 상세 `.superpowers/sdd/progress.md` Minor 롤업.

- **사용자 직접 질문 답변 — "기타"로 빠진 에이전트 + 크로스 검증 (audit 완료):**
  - "기타" 에이전트 = **`antigravity_orchestrator_agy`(Gemini 3.1 Pro High) + `antigravity_qa_agy`(Gemini 3.5 Flash High)**. 둘 다 **실동작·사용 가능하며 3-AI 크로스 검증됨**(§0.13 3×3 매트릭스·`tri_provider_check.py`의 AG 당사자가 바로 이 둘).
  - "기타"로 빠진 원인은 **UI 메타만 누락**: (1) 프런트 하드코딩 `PRESENTATION` 맵(`web/src/features/profiles/profilePresentation.ts:32-125`)에 15개 agent_store 중 이 2개만 미등록, (2) frontmatter가 CAO 권한 프리셋 `role:`만 쓰고 백엔드가 그룹핑에 읽는 `uiRole:`(`src/cli_agent_orchestrator/utils/agent_profiles.py:84`)를 안 씀. fallback은 `additionalProfileRole`(`profilePresentation.ts:184-186`)에서 `'기타'`.
  - **수정(Phase 4-A, 동작 변경 없음):** 두 `.md`에 `uiRole:` 추가 + `PRESENTATION` 엔트리 추가(둘 다 하면 안전). examples/cross-provider의 사본에도 반영.
  - **주의:** `examples/cross-provider/*`(cross_provider_supervisor, data_analyst_*×5, report_generator_codex)는 설치 시 기타로 빠지고 **매트릭스 미검증** — 실사용하려면 uiRole 부여 + `tri_provider_check.py`/`matrix_check.py`에 Case 추가로 별도 크로스검증 필요.

- **다음 세션 추천 순서(로드맵 상세):** Phase 4-A(기타 카드 정상화, audit로 위치 확정, 소·즉효) → 4-B(모델 카탈로그: `services/tooling/models.py` `_KNOWN_MODELS` codex STALE=gpt-5-codex/gpt-5/o3 → 실제 gpt-5.6-sol/terra/luna로 수정 + 계약 테스트) → 4-C(에이전트 시각화 A 보드+B 계층, 목업 `.superpowers/brainstorm/4087304-*/content/agent-viz.html`) → Phase 2(진행 카드) → 3 → 5 → 6. 각 Phase writing-plans→SDD→게이트.

- **라이브 서버:** `127.0.0.1:9889`에 `cao-server` 가동 중(pid 3970095, ext4 `CAO_HOME_DIR=/home/minsub57/.local/share/cao-home`). 라우트 prefix는 `/tooling`(not `/api/tooling`). web_ui는 Phase 1까지 반영된 빌드. Windows 브라우저 `http://localhost:9889`.

### 0.14.1. 2026-07-23~24 Phase 4~6b 대량 구현 (PR #5·#6, Claude Opus, SDD)

> **2026-08-03 복원분.** 이 절은 원래 워크트리 `.claude/worktrees/handoff-linux-wsl` 에 **미커밋 상태로만**
> 남아 있어 `main` 의 HANDOFF 가 §0.14(07-21) → §0.15(07-27) 로 건너뛰고 있었다. 코드는 전부 머지됐지만
> "왜 그렇게 했는지"가 정본에 없어 복원한다. 본문은 당시 기록 그대로이고, 그 뒤 상황이 바뀐 곳만
> `[2026-08-03]` 로 덧붙였다. 번호는 기존 §0.15/§0.16 을 밀지 않으려고 `0.14.1` 로 넣었다(시간순 위치는 맞다).

브랜치 `wsl-3ai-orchestration`. §0.14 이후 이어진 장기 세션으로 Phase 4 전체 + Phase 5 + 후속 수정 + Phase 6b 프런트를 subagent-driven-development(구현 sonnet / 리뷰 sonnet / 최종 opus)로 구현·리뷰·라이브검증했다. 커밋/push/PR/머지는 전부 사용자 승인 턴에서만 수행했다. 진행 렛저 전체: `.superpowers/sdd/progress.md`(gitignore scratch)에 태스크별 커밋·리뷰·minor가 남아 있다.

**PR #5 — 머지 완료 (merge commit `e73ce5d`, origin/main).** 내용:
- **Phase 4-A** 에이전트 프로필 정상화: antigravity를 1급 팀으로 승격(오케스트레이터 3번째 선택지 = Codex/Claude/Antigravity), "기타"로 빠지던 agy 프로필에 `uiRole` 부여 + `PRESENTATION` 등록. examples/cross-provider 예제도 카테고리화.
- **Phase 4-B** 모델 카탈로그 수정: `services/tooling/models.py` `_KNOWN_MODELS` codex STALE(gpt-5-codex/gpt-5/o3) → 실제 `gpt-5.6-sol/terra/luna` + fable alias, agy QA 워커를 Gemini 3.6 Flash로(당시 신모델, agy 1.1.5가 하이픈/Title-Case 둘 다 수용 실측). 계약 테스트 포함.
- **Phase 4-C** 에이전트 시각화: RoleBoard(A, 역할별 카드 + provider 색 + 모델 배지) + DelegationHierarchy(B, 위임 계층) + 자동 A/B 전환. `providerAccent` 디자인 토큰.
- **Phase 4-D** 인라인 사용량 바: 각 AI 사용량을 버튼이 아니라 provider별 인라인 막대(`InlineUsageBar`)로 상시 표시. antigravity quota 집계기(`services/usage/antigravity_quota.py`) 추가. `[2026-08-03]` §0.16 에서 `HeaderUsageBars` 로 한 번 더 개편됐다.
- **이벤트 스트림 언마운트 버그 수정**(`b7a971f`): `/ui/events` SSE를 Workspace가 소유해 메뉴 이동 시 unmount→구독 끊김. AppShell로 hoist + `selectedSessionId` lift로 nav 가로질러 1회 구독 유지.
- **Tooling ERR_ABORTED 수정**(`048ce3b`): `fetchJSON` 10s 기본 타임아웃이 WSL 콜드 프로브에 짧음 + `Promise.all`이 전체 화면을 blank + 백엔드 read 핸들러가 blocking. read 타임아웃 60s + `Promise.allSettled`(부분 렌더) + probe 핸들러 `asyncio.to_thread`. RCA로 event-hoist 회귀 아닌 선존 확인.
- **favicon**(`dfe4778`): data-URI SVG "M" 배지 + theme-color. `/favicon.ico` 404 제거.
- **CLI 설치 기능(npm 기반)**(`a17af2c`/`6c10111`/`7aebe5a`): `install_cli` 액션 + codex/claude/kiro/copilot/opencode 를 고정 패키지명으로 npm 설치(클라이언트가 패키지명 못 넣음 — provider→상수 매핑, 보안 리뷰 Approved). 미설치 provider 행에 "설치" 버튼. agy(curl|bash)·kimi(brew)는 보안상 제외. `[2026-08-03]` 이 작업의 플랜 문서도 미커밋이라 함께 복원: `docs/superpowers/plans/2026-07-23-cli-install.md`.

**PR #6 — `[2026-08-03] 머지 완료(2026-07-24).`** (당시 기록: 생성 완료·머지 대기, origin/main `e73ce5d` 대비 13커밋. `gh pr merge 6 --merge` 가 세션 auto-mode classifier에 차단돼 사용자 직접 머지가 필요했다 — 하네스 레벨 차단이라 우회하지 않았다.) 내용:
- **Phase 5 로딩/성능 UX** (6커밋 `65af802..a133cc1`): (1) huni 마스코트 전역 로딩 오버레이(release-deploy `huni.png` 이식, ref-count store, 새작업 생성·세션 종료 시 표시, `prefers-reduced-motion` 존중, z-index 90); (2) 도구·확장 페이지 즉시 열림(전역 로딩 게이트 제거 → 헤더+탭 즉시, 활성 탭 콘텐츠만 스켈레톤); (3) tooling 캐시+프리웜(catalog/extensions/adapters TTL 캐시 + `CACHE_TTL_SECONDS` 60→300 + lifespan 백그라운드 프리웜 — WSL 콜드 catalog 첫 ~19s를 프리웜 이후 ~2ms로); (4) M1 스낵바 z-[100]로 올려 성공 토스트가 오버레이에 안 가리게.
- **오케스트레이터 채팅 슬래시 자동완성 수정**(`c2cedf7`): `/` 자동완성 provider를 워크벤치 터미널(`wbContext`)이 아니라 **채팅 대상**(`composerTarget`)에서 가져오도록. 원인 = 채팅은 오케스트레이터에게 보내는데 슬래시는 워크벤치에 열린 터미널 provider를 봤음 → 워크벤치 안 열면 codex 오케스트레이터와 채팅 중에도 슬래시 안 뜸. `ComposerTarget`에 `provider` 추가 + `slashProvider={composerTarget?.provider}`. 워크벤치 무관 회귀 테스트 RED→GREEN.
- **Antigravity 컨텍스트 게이지 파서**(`71d465e`): agy footer "Context N% left" 스크랩 `get_context_usage` 추가(claude_code 방식 미러링). agy 세션에서 게이지 표시.
- **codex 게이지 제약 문서화**(`d31efd2`): codex는 upstream이 **v0.136+에서 footer의 "N% left" 세그먼트를 제거** → codex 0.145는 스크랩할 컨텍스트 데이터가 없음. codex.py에 주석으로 명시(게이지를 가짜 0%가 아니라 정상적으로 숨김). **게이지 실현 가능성 = footer가 노출하는 CLI만: claude_code ✓, antigravity ✓(추가), codex ✗(upstream 제약).**
- **Phase 6b 프런트 — "환경·지침" 탭**(5커밋 `9f7ce17..4f48662`, SDD 5태스크 전부 Approved): 백엔드 `/env/*`(이미 배포됨, 6b-spec)를 소비하는 도구·확장 8번째 서브탭. (T1) `web/src/api.env.ts` 타입 클라이언트(inventory/instructions/convert/write, `api.tooling.ts`의 `ApiError` 인터페이스 재사용). (T2) CLI 인벤토리 섹션(claude_code/codex/antigravity의 지침·설정·스킬·에이전트·MCP 파일 메타 — 경로·크기·수정시각, 내용 비노출). (T3) AGENTS/CLAUDE 지침 매트릭스(전역 + 프로젝트 경로별 존재/크기/시각 + 마스킹된 headline, 경로 추가 스캔). (T4) 변환 미리보기(claude_agent→cao_profile, claude_command↔codex_prompt, CLAUDE.md↔AGENTS.md 4쌍, preview-only). (T5) 가드된 저장(변환 결과를 CLAUDE.md/AGENTS.md로 write — 홈경로·파일명·256KiB 백엔드 검증, 409 충돌 시 덮어쓰기 체크 필요, 덮어쓰면 자동 백업. **유일한 mutation, 명시 "저장" 클릭 없이는 절대 실행 안 함**).

**검증(PR #6 기준):** 프런트 `460 tests` + `tsc --noEmit` clean + `npm run build` 성공. 백엔드 `test/providers 1044 passed / 7 skipped`, `test/tooling + test/api 744 passed`. 각 태스크 리뷰 Approved + 최종 whole-branch 리뷰(opus, `a133cc1..4f48662` 8커밋) = **READY TO MERGE**(Critical/Important 0). 라이브 브라우저 검증(서버 `127.0.0.1:9889`): huni 오버레이(실물 850×1000 PNG·z90·완료·에러 시 정상 hide), 도구 즉시 렌더 + 프리웜 캐시(catalog 2.4ms), 슬래시 드롭다운 6개 codex 명령, 환경·지침 탭(실데이터 인벤토리 24항목·지침 매트릭스 masked headline·변환 4쌍 UI).

**후속 폴리시(당시 비블로킹, `.superpowers/sdd/progress.md`에 기록):** 환경·지침 탭 재진입 시 추가 프로젝트 경로 칩/카드 desync, 저장블록 경로변경 시 overwrite 잔존, `KIND_LABELS` 중복(envtools.ts vs shared.tsx의 `KIND_LABEL_KO`), 테스트 파일 3개 `vi.unstubAllGlobals()` 누락(잠재 parallel-worker fetch-mock 누수 → 간헐 flaky), addPath dedup(중복 경로 시 React key 경고), AppShell이 SSE 이벤트마다 re-render, "오케스트레이터오케스트레이터" 라벨 중복, adapterless CLI(kimi/hermes/cursor) install/update 버튼 400. `[2026-08-03]` 이 중 "오케스트레이터오케스트레이터" 는 §0.16(`roleLabel.ts`)에서 해소됐다. 나머지는 재확인하지 않았다.

**다음 세션 예정이었던 Phase 2(실시간 진행 카드)** — `[2026-08-03]` §0.15 에서 PR #7 로 구현·머지 완료.

**중요 환경 재확인:** 서버는 반드시 `CAO_HOME_DIR=/home/minsub57/.local/share/cao-home`(ext4)로 기동해야 한다. 이 env 없이 기동하면 기본 홈 `~/.aws/...`가 Windows 9p 마운트라 `os.mkfifo`가 `[Errno 95] Operation not supported` → 세션 생성 실패 → **모든 터미널·오케스트레이션·슬래시·게이지가 죽는다**(§0.11 blocker 1과 동일). 정확한 기동 명령은 §3-1 참조.

### 0.15. 2026-07-27 콜드스타트 복구 + UX Phase 2·3 구현 + EOD 자율 루프 (Claude Opus, 백그라운드 잡)

이 세션은 콜드스타트로 시작해 Phase 2 → Phase 3 을 구현하고, 마지막에 `/end-of-day-handoff-loop`
로 전환해 잔여 항목 일부를 더 처리했다. **작업 산출물이 세 갈래로 나뉘어 있으니 아래 위치를
먼저 확인할 것.**

#### 산출물 위치 (중요)

작업은 워크트리 `/home/minsub57/hunesion_workspace/cao-korean-orchestrator/.claude/worktrees/coldstart-phase4d`
에서 수행했다.

| 갈래 | 상태 | 위치 |
|---|---|---|
| Phase 2 진행 카드 | 커밋·push 완료, **draft PR #7** | 브랜치 `worktree-coldstart-phase4d` (`3d201a9`), base `main` |
| Phase 3 에러·승인대기 | 커밋·push 완료, **draft PR #8** | 브랜치 `phase3-error-cost` (`55c8b78`), base **PR #7 브랜치**(스택) |
| EOD 루프 산출물 | **미커밋 — 워크트리 작업 디렉터리에만 있음** | 같은 워크트리, 브랜치 `phase3-error-cost` 위 uncommitted |

⚠️ EOD 루프분은 `/end-of-day-handoff-loop` skill 규칙(commit/push 를 외부 상태 변경으로 금지)에
따라 **의도적으로 커밋하지 않았다.** 워크트리를 제거하면 소실된다. 이어받을 때 가장 먼저
`git -C <worktree> status` 로 존재를 확인하고 커밋 여부를 결정할 것. 커밋 메시지 초안은 아래에 있다.

PR 머지 순서: #7 먼저 머지 → #8 의 base 를 `main` 으로 변경 → #8 머지. #8 은 #7 의 타입
(`OrchestrationSummary`, `WorkerState`)을 직접 확장하므로 순서를 바꾸면 충돌한다.

#### 콜드스타트에서 확인한 저장소 상태

- **로컬 `main` 이 `origin/main` 보다 41 커밋 뒤처져 있었다**(fast-forward 가능, 분기 아님). 아직
  pull 하지 않았다. `origin/main` tip = `e73ce5d`(PR #5 머지).
- **CRLF phantom diff 재확인**: 원본 체크아웃의 973 파일이 전부 수정됨으로 보이지만
  `git diff --ignore-cr-at-eol --stat` 출력이 비어 실변경 0건이다(§3-5 기록과 일치). 이 세션은
  건드리지 않고 fresh 워크트리에서 작업했다. 정리는 여전히 사용자 승인 대기.
- `.venv` 가 없어 `uv python install 3.12` → `uv sync -p 3.12` 로 부트스트랩했다(워크트리 로컬).
  결과 `.venv` = Python `3.12.13`. 시스템 기본 3.14.4 는 §3 대로 피해야 한다.
- 베이스라인 게이트(`e73ce5d`): backend `4784 passed / 14 skipped`, tsc 0, vitest `432/432`, build ✓.

#### Phase 2 — 실시간 진행 카드 (PR #7, 커밋 5개)

계획: `docs/superpowers/plans/2026-07-27-phase2-live-progress-card.md`.

- `web/src/features/workspace/orchestrationProgress.ts` (신규, React 비의존 순수 모듈):
  `formatElapsed`(초/분/시간), `workerStateFor`, `computeOrchestrationProgress`(stage =
  `dispatching`/`working`/`callback`), `summarizeOrchestration`.
  턴 경계는 `pendingSince` 하나로 정하고, 워커 create 이벤트의 서버 시각이 로컬 전송 시각보다
  살짝 앞설 수 있어 `TURN_GRACE_MS = 2000` 만큼 관대하게 본다.
- `WorkspacePendingReply.startedAt` · `ChatEntry.progress` 를 additive-optional 로 추가.
  `loadStoredChat` 이 둘 다 명시적 가드로 좁힌다(변조 payload 는 조용히 버림).
- `ProgressCard.tsx` (신규): 단계 라벨·경과시간·워커 행·대기 대상·stall 경고. **표시 전용** —
  1초 tick 은 경과 라벨 갱신용 로컬 리렌더일 뿐 터미널 read 를 유발하지 않는다(과거 환각 폴링
  회귀 금지). 상태원은 `AgentSidePanel` 과 동일한 `cards` + `terminalStatuses` 뿐이다.
- 응답 확정 시 `summarizeOrchestration` 스냅샷을 굳혀 `✓ 완료 · 워커 N · 소요 M` 이 리로드 후에도 남는다.
- 게이트: tsc 0, vitest `466/466`, build ✓, design-token ✓.

**실서버 라이브 검증 완료** — 증거 `.omo/evidence/phase2-live-2026-07-27/`(report.md + 캡처 3장).
실제 Codex 위임 턴에서 `작업 배정 중 · 7초` → `워커 작업 중 · 35초 · 0/1 완료 · 테스트 담당 ·
Codex · 작업 중 · 테스트 담당의 콜백 대기 중` → `✓ 완료 · 워커 1 · 소요 39초` + `PHASE2_LIVE_OK2`
를 확인했다. REST 대조로 워커 `b7528bbb:codex_qa_terra` 생성→처리→자동정리, 오케스트레이터
`4/4 completed` 일치. 프로필 ID 노출 0, console error/warning 0, 리로드 후 요약 유지.

- **미확인 1건**: `callback` 단계 프레임은 워커 종료와 최종 답변 도착 사이가 스냅샷 간격보다
  짧아 캡처하지 못했다. 단위 테스트로만 덮여 있다.
- **알게 된 것**: 새 작업 모달의 첫 프롬프트는 `sendMessage` 를 안 거치고 모달이 직접 API 를
  호출해 `pendingReply` 가 등록되지 않는다. 그래서 세션 생성 직후 첫 턴에는 진행 카드가 안 뜬다
  (Phase 2 이전부터의 기존 동작). 카드는 채팅 컴포저 경로에서만 뜬다. 이걸 통일할지는 미결.

#### Phase 3 — 에러 / 승인대기 (PR #8, 커밋 5개)

계획: `docs/superpowers/plans/2026-07-27-phase3-error-cost.md`.

- **실버그 수정(보안성)**: `useWorkspaceSession.ts` 의 전송 실패 catch 가
  `err.detail || err.message` 를 그대로 assistant 말풍선 content 로 넣고 있었다. FastAPI 가
  `detail` 에 담은 파일 경로·예외·내부 식별자가 사용자 화면 문구가 됐다. 이제 신규
  `orchestrationError.ts` 가 HTTP status·AbortError 만 보고 **6종 고정 문구**로 분류하고, 원문은
  `raw` 로만 실어 Phase 1 `원문 보기` 토글 뒤에 둔다. traceback·경로·토큰이 `userMessage` 에
  섞이지 않는지 회귀 테스트가 직접 단언한다.
- 대기 타임아웃 문구를 "실패"가 아니라 "아직 도착하지 않았고 계속 작업 중일 수 있다"로 정정.
- `WAITING_USER_ANSWER` 를 `working` 에서 떼어 **`blocked`** 상태로 분리(경고색 + 조치 버튼).
  `blockedCount`/`errorCount` 추가. 두 상태 모두 미종료라 stage 판정은 불변.
- 진행 카드: 오류 시 danger 테두리, 승인대기 시 warning 테두리, `승인 대기 N · 오류 N` 요약줄,
  해당 워커 행에 `승인하러 가기` / `오류 확인` 버튼(그 워커 터미널을 연다). 정상 워커엔 버튼 없음.
- 전송 실패한 말풍선에 `다시 보내기`(`ChatEntry.retryPrompt`, additive-optional + 읽기 시 좁힘).
- 워커별 경과시간 표시.
- 게이트: tsc 0, vitest `489/489`, build ✓, design-token ✓.

**⚠️ 스펙 축소 — 작업별 토큰은 구현하지 않았다.** 스펙 수용 기준은 "완료 카드에 토큰·시간"인데
변경란은 "새 백엔드 없이 기존 usage 데이터 활용"으로 제약한다. 실측 결과 둘이 양립하지 않는다:
사용량 경로는 `/usage/accounts` 하나뿐이고(`api/usage_router.py:56`) provider별 `today`/`week`
총계와 `by_model_today` 만 반환하며, 집계 서비스(`services/usage/claude_transcripts.py`,
`codex_rollouts.py`)는 CLI 트랜스크립트/롤아웃 파일을 **날짜로만** 스캔해 CAO session·terminal 과
이을 키가 없다. 턴 전후 provider 총계 delta 우회는 같은 머신의 다른 CAO 세션·수동 CLI 사용량이
섞여 "이 작업의 비용"으로 제시할 수 없다(가짜 데이터 금지). 커밋 `55c8b78` 으로 스펙 본문 옆에
사유를 남겼다. **정직하게 표시하려면 backend 에서 terminal ↔ transcript 귀속 경로가 선행돼야 한다.**

**라이브 미검증**: 오류·승인대기 실화면은 확인하지 못했다(페이지 로드 스모크만). 재현에는
승인 정책 `on-request` 프로필(승인대기)과 서버 중단(네트워크 오류)이 필요하다.

#### EOD 자율 루프 산출물 (미커밋)

`/end-of-day-handoff-loop` 로 전환해 아래를 추가로 구현했다. **전부 uncommitted.**

1. **Phase 4-C 실버그 수정 — 정리된 워커를 계속 "작업 중"으로 집계**
   Phase 2 라이브 검증 중 발견했다. 워커 2개가 모두 자동 정리돼 오케스트레이터만 남았는데도
   우측 패널이 `2/2 워커 작업 중` 을 표시하고, 같은 패널의 위임 카드는 `완료` 라 한 화면에서
   어긋났다.
   원인은 `AgentSidePanel` 이 **세션 무관 전역** `useStore.terminalStatuses` 를 그대로
   `isTeamWorking`·`DelegationHierarchy`·`RoleBoard` 에 넘긴 것이다. `store.ts:107`
   `clearTerminalStatuses` 는 클래식 `DashboardHome.tsx:177` 에서만 호출되고 Workspace 경로엔
   배선이 없어, 삭제된 터미널의 마지막 `PROCESSING` 이 스토어에 영구히 남고 **타 세션 터미널까지
   보인다**. 그래서 A/B 자동전환(`vizView`)과 `작업 큐` 카운트도 같이 오염됐다.
   수정: `agentGrouping.ts` 에 `sessionStatusMap({supervisorId, cards, terminalStatuses})` 추가 —
   이 세션의 supervisor + cards 만 담고, `card.killed` 면 스토어보다 카드를 우선한다(위임 카드
   배지가 이미 쓰는 규칙과 동일). `AgentSidePanel` 의 `queueCards`·`isTeamWorking`·두 viz 컴포넌트를
   이 맵으로 교체했다. store 를 건드리지 않아 타 세션 영향 없음. 테스트
   `web/src/test/session-status-map.test.ts` 9건.
2. **Phase 6 — "작업 시작" 비활성 사유 안내**: 신규 `newTaskGate.ts` 의
   `newTaskBlockReason()` 이 canSubmit 과 같은 조건으로 우선순위 하나만 문구화한다(지시 미입력 →
   오케스트레이터 프로필 미설치 → 세션 이름 규칙). `creating` 중엔 스피너가 말하므로 침묵.
   테스트 `new-task-block-reason.test.ts` 6건.
3. **스펙 §4e — 새 작업 모달 간결화**: 기본 팀 + 추가 전문 에이전트를 `고급 — 팀 구성 바꾸기`
   `<details>` 하나로 묶어 **기본 접힘**. 내부용어 문구("체크한 역할의 내부 프로필 ID가 첫 지시에
   함께 전달됩니다")를 "체크한 역할은 후보로만 전달돼요…"로 순화.
   테스트 `new-task-modal-simplify.test.tsx` 5건 — 접힘은 DOM 에 내용이 남아 query 로는 검증이
   안 되므로 `details` 의 `open` 속성으로 단언한다.
4. **Phase 6 접근성**: 작업 지시 textarea 에 `id`/`htmlFor` 를 붙여 라벨을 실제 연결했다(기존엔
   미연결이라 스크린리더가 못 읽었고 `getByLabelText` 도 실패).
5. **Phase 1 잔여 Minor — `loadStoredChat` 의 `raw` 타입 미검증 해소**: 변조된 non-string `raw`
   하나가 `formatOrchestratorOutput` 에서 throw 하고 outer catch 가 삼켜 **대화 전체가 사라졌다.**
   이제 문자열이 아니면 `content` 로 폴백해 나머지 히스토리를 지킨다. 회귀 테스트 추가.

**EOD 루프 게이트**: tsc 0, vitest **`510/510` (61 파일)**, build ✓ `index-D5-mTHcU.js`,
design-token ✓. backend 는 Python 파일 무변경이라 미실행(기준 `4784 passed / 14 skipped`).
라이브 스모크: 서버가 새 번들 서빙, 새 작업 모달에서 고급 접힘·비활성 사유 표시·console 0 확인.
캡처 `eod-newtask-simplified.png`(워크트리 루트, 미커밋).

#### 미커밋분 커밋 메시지 초안 (사용자 승인 후)

```
fix(viz): scope the agent panel's status map to this session and honour ended cards

우측 패널이 자동 정리된 handoff 워커를 계속 "작업 중"으로 집계했다. 원인은 세션 무관 전역
terminalStatuses 를 isTeamWorking/DelegationHierarchy/RoleBoard 에 그대로 넘긴 것이다
(clearTerminalStatuses 는 클래식 DashboardHome 에만 배선돼 Workspace 에서는 삭제된 터미널의
마지막 PROCESSING 이 영구히 남고 타 세션 터미널도 보인다).

sessionStatusMap() 이 이 세션의 supervisor + cards 만 담고 card.killed 를 스토어보다 우선한다.
작업 큐 카운트와 보드→계층 자동전환도 같은 맵을 쓴다. store 는 건드리지 않았다.
```

```
feat(new-task): explain why 작업 시작 is disabled + fold the team pickers into 고급

버튼만 흐려지면 무엇을 채워야 하는지 알 수 없었다. newTaskBlockReason() 이 canSubmit 과 같은
조건으로 우선순위 하나만 알려준다. 스펙 §4e 대로 기본 팀·추가 전문 에이전트를 기본 접힌
"고급" 섹션으로 묶고 내부 프로필 ID 문구를 순화했다. 작업 지시 라벨에 htmlFor/id 를 붙여
접근성도 함께 고쳤다.
```

```
fix(chat): keep the history when a tampered raw is not a string

변조된 non-string raw 하나가 formatOrchestratorOutput 에서 throw 하고 outer catch 가 삼켜
대화 전체가 사라졌다. 문자열이 아니면 content 로 폴백한다. Phase 1 잔여 Minor 해소.
```

#### escalate — 사용자 턴 필요 (이 루프에서 실행하지 않음)

1. **미커밋분 커밋 여부 결정** + PR #7 → #8 머지 순서 진행. 브랜치 삭제·머지는 전부 사용자 턴.
2. 원본 체크아웃의 `main` pull(41 커밋 뒤처짐) 과 CRLF 정리(`.gitattributes` + `--renormalize`,
   973 파일 대형 커밋) — 둘 다 승인 대기.
3. **Phase 7 Electron** — 큰 신규 기능이라 무인 루프에서 착수하지 않았다. 자체 스펙·플랜 사이클
   필요. `docs/electron-plan.md` 참조.

#### 다음 세션 추천 순서

1. 위 escalate 1번(미커밋분 처리) — 가장 먼저. 워크트리 제거 전에.
2. **Phase 5** — 미착수. 3항목 전부 남았다:
   (a) `useUiEventStream.ts`/`eventsClient.ts` **SSE 자동 재연결** + "재연결 중…" 표시(서버 재시작
   후 수동 새로고침 없이 복구). 이번에 medium 규모라 판단해 착수하지 않고 넘겼다.
   (b) `ToolingView.tsx` 스켈레톤 + 부분 로딩(빠른 environment/providers 먼저, 느린 extensions 뒤늦게).
   (c) 설정 화면의 에이전트 프로필 디렉터리가 실제 경로(`CAO_HOME_DIR` override 반영)를 표시.
3. **Phase 6 잔여** — 이번에 비활성 사유·접근성 1건·내부용어 1건만 처리했다. 남은 것:
   (a) **내부용어 잔여** — 새 작업 모달의 오케스트레이터 카드가 아직 프로필 ID 원문
   (`codex_orchestrator_sol`, `claude_orchestrator_sonnet`, `antigravity_orchestrator_agy`)을
   monospace 로 노출한다. 캡처 `eod-newtask-simplified.png` 참조. 식별 목적이면 유지, 아니면 제거.
   (b) 알림 배지 읽음/초기화 동선. (c) 로딩 상태(스켈레톤/스피너/텍스트) 일관화.
   (d) favicon 404 는 `dfe4778` 로 이미 해결됨 — 확인만.
4. **Phase 3 라이브 검증** — 승인 정책 `on-request` 프로필로 승인대기, 서버 중단으로 네트워크
   오류를 재현해 실화면 확인.
5. **Phase 2 callback 프레임 캡처** — 폴링 간격을 좁혀 재시도.
6. **작업별 토큰 귀속(backend)** — Phase 3 에서 제외한 항목. terminal ↔ CLI transcript 를 잇는
   경로 설계가 선행.

#### 라이브 서버

`127.0.0.1:9889` 에서 계속 실행 중이다. 기동 명령은
`CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run cao-server --host 127.0.0.1 --port 9889`
(워크트리 `coldstart-phase4d` 에서 실행). web_ui 는 **EOD 루프까지 반영된 빌드**
(`index-D5-mTHcU.js`). 실측 provider: Claude Code `2.1.220`, Codex `0.145.0`.
임시 세션 `cao-phase2-live` 는 검증 후 삭제했다(`/sessions` = `[]`).

## 1. 프로젝트가 무엇인가
CAO fork를 "채팅 중심 멀티 에이전트 오케스트레이션 작업대 + AI CLI/확장 컨트롤센터"(**MS Orchestrator**)로 개편.
핵심 문서: `docs/ui-refactor-plan.md`(전체 계획·실행 방법·함정), `docs/electron-plan.md`(Phase 7 확정 설계 — **머지 후 착수하기로 사용자와 합의된 다음 큰 단계**), `docs/ux-benchmark.md`, `docs/specs/`(작업별 상세 스펙).
원칙: 가짜 데이터/빈 성공 화면 금지(capability 기반), 한국어 UI, 파스텔 디자인 토큰(`var(--…)`, 하드코딩 색 금지), 단계별 게이트(black/isort/mypy/pytest/tsc/vitest/build), **커밋·push는 사용자가 시킬 때만**.

## 2. 머지 시점 상태 (전부 초록)

> **주의: 아래 수치는 2026-07-17 스냅샷이다.** 최신 게이트 수치는 §0.16(프런트 `652/652`,
> 백엔드 `4809 passed / 21 skipped`), 최신 저장소 상태는 §0.17을 본다.

- pytest `4665 passed / 14 skipped` · vitest `324/324` · tsc 클린 · `npm run build` 성공 · `node design-tokens/gen.mjs --check` 통과
- 완료: Phase 0~5(셸·작업공간·tooling 읽기/쓰기·프로필/모델/Flows/팔레트), Phase 5.5(실사용 피드백 17건), 2d(컨텍스트 게이지)+2e(슬래시 자동완성) 백/프런트, 6b(`/env` 마이그레이션·지침 API 4종), 6c 소스 백엔드(`/tooling/sources`), 소스 탭 프런트(SourcesPane/EnvProfilesPane — 게이트 통과 상태로 랜딩)
- 오케스트레이터 라이브 e2e: claude 8/8 PASS, codex send_message/assign 콜백 PASS(아래 §4 버그 수정 후), claude→codex 크로스는 워커 생성·provider 오버라이드·caller_id까지 PASS

## 3. ⚠️ 실행 환경 (2026-07-20 Linux WSL 기준 재확정)

**현재 정본 환경 — 이 저장소는 Linux WSL2에서 실행한다.** 이전 macOS 함정(editable `.pth` hidden 플래그·`chflags`·`--no-sync` 강제)은 Linux에 **해당 없음**. macOS 원문은 §3.1에 참고용으로 보존한다.

- 프로젝트 루트: `/home/minsub57/hunesion_workspace/cao-korean-orchestrator`
- 실측 툴체인: Python `3.14.4`(linuxbrew `/home/linuxbrew/.linuxbrew/bin`), uv `0.11.18`, node `v24.15.0` / npm `11.12.1`, tmux `/usr/bin/tmux`(설치됨, 세션 미기동)
- **Python은 3.12로 고정한다.** 시스템 기본은 linuxbrew `3.14.4`인데, `httptools`·`uvloop` 등이 cp314 wheel이 없어 소스 컴파일을 강제하고 `gcc-12` 부재로 즉사한다. uv 관리형 3.12로 부트스트랩: `uv python install 3.12` → `uv sync -p 3.12`(전부 prebuilt wheel, 컴파일 0). Linux는 hidden-flag 재적용이 없어 `--no-sync` 불필요(macOS 레거시). 부트스트랩 뒤 plain `uv run`으로 실행한다. **검증 완료(2026-07-20): `.venv`는 `3.12.13`.**
- agent-store 등 홈 상대 경로(`~/.aws/cli-agent-orchestrator/...`)는 Linux에서 `/home/minsub57/.aws/...`로 해석된다(형태 동일).

1. **서버**: `uv sync` 뒤

   ```bash
   CAO_HOME_DIR=/home/minsub57/.local/share/cao-home PYTHONPATH=src uv run cao-server --host 127.0.0.1 --port 9889
   ```

   **`CAO_HOME_DIR`(ext4 경로)를 빼면 안 된다.** 기본 홈 `~/.aws/cli-agent-orchestrator/...`는 Windows 9p 마운트라
   FIFO 생성이 `os.mkfifo: [Errno 95] Operation not supported`로 실패하고 → 세션 생성 실패 → **터미널·오케스트레이션·
   슬래시·컨텍스트 게이지가 전부 죽는다.** 서버 자체는 뜨고 `/sessions`도 200이라 겉으로는 정상으로 보이는 것이
   함정이다(§0.11 blocker 1, §0.14.1 말미에서 두 번 밟았다). host/port 기본값은 config 해석(`--host/--port` default
   None)이므로 명시 권장. tmux 백그라운드 유지 시 세션명 자유. 옛 uv tool 설치본과 동시 기동 금지(pipe-pane 이중 연결).
2. **pytest**: `PYTHONPATH=src uv run python -m pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py` (console-script shebang이 옛 경로를 가리킬 수 있으므로 `python -m pytest` 사용)
3. **웹 게이트**: `cd web && npx tsc --noEmit && npm test && npm run build`
4. **e2e(실서버 필요)**: `PYTHONPATH=src uv run pytest -m e2e test/e2e/... -v` — 전제 프로필 data_analyst/report_generator/analysis_supervisor/data_analyst_codex는 `~/.aws/cli-agent-orchestrator/agent-store/`에 설치돼 있어야 함(임시 — 검증 끝나면 제거 가능). 크로스 검증 스크립트: generic `scripts/dev/xprov_check.py`, 기본 고정 팀 `scripts/dev/fixed_orchestrator_check.py`(서버 떠 있을 때 `PYTHONPATH=src uv run python ...`).
5. **⚠️ CRLF phantom diff (WSL 신규 함정)**: 워크트리 파일은 CRLF, git index는 LF, `.gitattributes` 없음·`core.autocrlf` 미설정 → `git status`가 973개 파일을 전부 수정됨으로 표시한다(내용 동일, EOL만 차이; `211814 ins == 211814 del`). **실변경 아님.** 정리하려면 사용자 승인 후 `.gitattributes`에 `* text=auto eol=lf` 추가 + `git add --renormalize .`(대형 커밋). 새 브랜치/워크트리는 fresh checkout라 LF로 깨끗하므로 문서·코드 편집은 워크트리에서 한다.

### 3.1. (참고) 이전 macOS 환경 함정 — Linux WSL에는 해당 없음
- **`uv run`은 반드시 `--no-sync`** — 맨 uv run이 .venv를 재동기화하며 macOS hidden 플래그를 재적용 → editable .pth 무시 → `.venv/bin/cao-mcp-server`가 ModuleNotFoundError로 즉사 → 이 서버가 만든 모든 에이전트의 assign/handoff/send_message가 조용히 전멸. 재발 시 `chflags -R nohidden .venv`. 서버는 `PYTHONPATH=/Users/minsub/Documents/minsubsong/cli-agent-orchestrator/src .venv/bin/python .venv/bin/cao-server ...`를 우선했었다.

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
6. ✅ **UX Phase 1~6 + 6b 프런트 전부 완료·머지** — Phase 1(§0.14), Phase 4·5·6b(§0.14.1, PR #5·#6), Phase 2(PR #7)·Phase 3(PR #8)(§0.15), Phase 5/6 잔여·알림 초기화·문구 통일(PR #11~#13), 라이브 결함 3라운드(PR #14·#15·#16, §0.16). **2026-08-03 기준 열린 PR 0건, `main` = `4ae4f42`.**
7. 🔄 **Phase 7 Electron 진행 중(§0.19)** — 백엔드 시임(#23), `electron/` + server-manager(#24), `caoNative` 브리지
   + 웹 감지(#25), WSL·셸 감지 + builder 설정(#26) 머지 완료. Tauri 2 검토 결론은 **Electron 유지**.
   **남은 것**: `shellConfig` 브리지·설정 화면 셸 카드, spawn 에 선택 셸/배포판 실제 반영, mac 실기동+dmg,
   Windows nsis 실검증(사용자 수행), 트레이 아이콘 실물. **GUI 는 아직 한 번도 안 띄웠다** — 검증된 것은 순수
   로직과 웹 폴백뿐이다.
8. **잔여 폴리시(작은 것들)** — 습니다체 54곳, mypy 27건(CI 허용), `MemoryGraphView` Sigma 캔버스 hex paint 4개(테마 비반응 — mount 시점 CSS 변수 읽기 필요), 새 작업 모달 첫 턴과 채팅 경로 통일 여부(§0.15 미결), §0.14.1 후속 폴리시 잔여분.
9. ✅ **미머지 `tooling-wsl-fix`(`1486bf4`) 처리 완료** — `cache.cached_which()` 계열만 PR #18 로 이식했고, 병렬화는
   의도적으로 제외했다(§0.17). 원 브랜치는 `archive/tooling-wsl-fix` 태그로만 남기고 삭제했다(§0.18).
10. ✅ **저장소 위생 정리 완료(§0.18)** — PR #17·#18·#19·#20·#21 전부 머지. main CI 상시 실패(black)와 간헐 실패
    (ToolingView 테스트 레이스)까지 원인 수리. 원격 브랜치는 `main` 하나, CRLF 유령 0건, `core.bare` 해제.
    **`origin/main` = `78f2826`, 열린 PR 0건.**

## 6. 미해결/사용자 확인 대기
- 기본 팀 권한 blocker는 §0.4에서 해결했다. 향후 Codex CLI에서 MCP approval config schema가 바뀌면 `scripts/dev/fixed_orchestrator_check.py`로 재검증한다.
- 도구및확장 "소스" 탭의 마켓플레이스 **추가/삭제 실행**(현재 명령 복사 안내만) — 사용자 요청 시 operations queue로.
- 미이식 클래식 기능 3건(프로필 카운트 칩·대시보드 필터/정렬·tmux 세션 배지) — 사용자 확인 대기.
- e2e용 임시 프로필 4개(agent-store) 정리 여부.
- ~~CRLF 973파일~~ → **종료**. PR #19 의 `.gitattributes` + `core.bare` 해제 + 재체크아웃으로 유령 diff 0건(§0.18).
- ~~스테일 워크트리~~ → **종료**. 4개 + `pr6-ci` 까지 제거, 최상위가 정상 작업본이다(§0.18).
- ~~브랜치 정리~~ → **종료**. 원격 브랜치는 `main` 하나뿐, 미머지였던 `tooling-wsl-fix` 는 `archive/tooling-wsl-fix`
  태그로 보존(§0.18).
- ~~`tooling-wsl-fix` 브랜치 처리~~ → PR #18 로 이식 완료(§0.17).
- `workspace.test.tsx` 의 잠재 레이스 5건 — CI 실패 이력 없음, 인위적 지연에서만 재현. 실제로 깨지면 §0.18 의
  재현 기법을 적용한다.
- ~~push/PR: 사용자 지시 없음 — 로컬 머지만 완료된 상태.~~ **해소** — 2026-08-03 기준 PR #1~#16 전부 origin 머지, 열린 PR 0건(§0.17).

### 0.16. 2026-07-30 라이브 사용 결함 8건 + 다크 팔레트 하드코딩 제거 (Claude Opus, 백그라운드 잡)

사용자가 라이브 서버(`127.0.0.1:9889`)를 직접 쓰면서 올린 보고를 하나씩 원인까지 확인해 고친
세션이다. 작업 위치는 워크트리 `.claude/worktrees/pr6-ci`, 브랜치 `live-ux-round2`
(커밋 `ac1d1cf`). **PR 은 아직 안 만들어졌다 — 아래 §미완 참고.**

이 세션 앞부분에서 PR #15(`live-ux-fixes`)를 머지했다. Trivy 체크가 5분 넘게 `pending` 0초로
고착됐으나 이 브랜치가 의존성을 전혀 바꾸지 않아(변경 21개 파일 전부 `.ts`/`.tsx`) 사용자 승인
후 머지했다. 머지 후 `main` = `55247d6`.

#### 고친 것과 각각의 실제 원인

| 증상 (사용자 보고) | 실제 원인 | 수정 |
|---|---|---|
| `documentation-writer` 가 크로스 테스트에서 빠짐 | **그 프로필 문제가 아님.** `tools: Read, Grep, Glob` 는 Claude Code 공식 형식인데 `AgentProfile.tools` 가 `List[str]` 만 받아 assign 전에 pydantic 검증 실패. `~/.claude/agents/` 전체가 이 형식 → 발견된 네이티브 에이전트 전부 위임 불가 | `agent_profile.py` 에 `tools`/`allowedTools`/`resources`/`skills` 문자열→리스트 강제 변환 |
| 완료 보고가 깨져 보임 | ① codex 상태줄(모델·경로·Context·한도)이 답변에 섞임 ② 보고가 터미널이 그린 표 | ① 위치가 아니라 내용으로 판정(`isProviderStatusLine`) ② 괘선(U+2500–U+257F)만 제거 ③ 오케스트레이터 프로필 3개에 완료 보고 형식 추가 |
| 작업 큐가 항상 0 | 오케스트레이터가 콜백 직후 `delete_terminal` → 카드가 즉시 `killed`(=done). 큐는 **살아있는 워커만** 셌다. 8건 위임한 런에서도 내내 0 | 큐 = 그 턴의 작업 목록 전체 + 상태별 정렬. 진행 중 수는 요약 줄로 분리 |
| 사용량이 버튼 뒤에 숨음 | 설계 자체 | `HeaderUsageBars` — 활성 AI별 한도 막대 상시 노출. 팝오버 전용 컨트롤(계정 상세·Claude 옵트인·새로고침)은 **설정 › AI 계정 사용량** 으로 이동 |
| 채팅 자동 스크롤 없음 | 스크롤 관리 코드가 아예 없었음 | `useStickToBottom` — 바닥에 있을 때만 따라감, 올려 읽는 중이면 `맨 아래로` 버튼 |
| 오케스트레이터 카드 `오케스트레이터오케스트레이터` | 프로필 라벨 + 하드코딩된 동일 역할 배지 | `roleLabel.ts` — 이름과 다를 때만 배지 |
| 받는 대상에 내부 프로필 id 노출 | `Workspace.tsx` 가 `t.agent_profile` 원문 사용 | `composerTargetLabel()` 로 통일 |
| Claude 고정 오케스트레이터가 sonnet | — | `claude_orchestrator_opus` 로 **이름까지** 변경(다른 Claude 프로필이 모두 이름에 모델을 담음). packaged `agent_store` copy byte-identical 유지 |
| 에이전트 수정 화면 model 자유 입력 | 추가 화면에만 셀렉트가 있었음 | 카탈로그 셀렉트 + `직접 입력…`. 카탈로그에 없는 기존 값은 보존 |

부수로 발견해 고친 것:
- 사용량 응답이 예상 형태가 아니면 **설정 탭 전체가 크래시**했다(`accounts` 미검증) → 훅에서 방어.
- 정의되지 않은 `--border-strong` 토큰을 쓰던 hover 규칙(죽은 코드).

#### 다크 팔레트 하드코딩 제거

- `dark:` 접두사는 **0건**이었다. 실제 문제는 `bg-gray-900` 류 **팔레트 하드코딩 ~580곳** —
  라이트 모드에서 값이 그대로 남는다. 13개 컴포넌트를 토큰으로 전환(6개 에이전트 병렬).
- 재발 방지: `web/src/test/theme-token-only.test.ts` — 하드코딩 팔레트 클래스가 다시 들어오면
  실패한다. scrim(`bg-black/NN`)과 마크다운 표는 의도적 제외.
- **토큰 어휘에 `--surface-hover` 추가**: `--surface-3` 위에 얹힌 컨트롤은 hover 로 갈 단계가
  없어 `bg-gray-700`+`hover:bg-gray-600` 이 같은 토큰으로 접히며 **hover 가 시각적으로 아무
  일도 하지 않았다**. 자기 자신으로 hover 하던 곳은 0으로 정리.

#### 검증

- 프론트 **652/652** (88 파일), 백엔드 **4809 passed / 21 skipped, 커버리지 90%**
- `npx tsc --noEmit` 0, `node design-tokens/gen.mjs --check` 통과, `npm run build` 성공
- 라이브 서버 재기동 후 **라이트 모드 실화면 확인**: 사용량 막대(Codex 70%·Antigravity 1%),
  작업 큐 15(이전 0), 오케스트레이터 라벨 중복 해소, 받는 대상 프로필 id 제거
- `documentation-writer` 실측: `GET /agents/profiles/documentation-writer` → `tools: ['Read','Grep','Glob']`

#### 미완 / 이어받을 것

- **`live-ux-round2` push 가 미완료다.** 원격(`github.com/Minsubs/cao-korean-orchestrator`)이
  응답 지연으로 여러 번 타임아웃했다. 커밋 `ac1d1cf` 는 로컬에만 있다. 이어받으면
  `git -C .claude/worktrees/pr6-ci push -u origin live-ux-round2` 부터 재시도하고 PR 생성 →
  CI 통과 확인 → main 머지.
- 채팅 이력은 로드할 때 다시 정리되므로, 수정 전에 저장된 깨진 메시지도 **브라우저 강제
  새로고침(Ctrl+Shift+R)** 하면 정리된다(테스트로 고정: `stored-chat-recleaning.test.ts`).
- 남아 있는 것: 습니다체 54곳, Phase 7 Electron(7a→7b→7c), 원본 체크아웃 `main` pull +
  CRLF 973파일 정리(**사용자 승인 대기**), mypy 27건(CI 는 허용), `MemoryGraphView` 의 Sigma
  캔버스 hex paint 4개(테마 비반응 — 토큰화하려면 mount 시점에 CSS 변수를 읽어야 해서 별건),
  `.omc/` 미추적 디렉터리(커밋 대상 아님).


### 0.17. 2026-08-03 콜드스타트 감사 — 미머지 잔재 판정 + HANDOFF 공백 복원 (Claude Opus, 백그라운드 잡)

이 세션은 **코드 변경 0건, 문서만** 고쳤다. 콜드스타트로 저장소 상태를 실제 ref/PR 기준으로 확인하고,
어디에도 커밋되지 않은 채 워크트리에만 남아 있던 기록을 정본으로 되살렸다.

#### 저장소 실측 상태

- `main` = `origin/main` = `4ae4f42`. **PR #1~#16 전부 머지, 열린 PR 0건**(`gh pr list --state open` 빈 결과).
- **⚠️ 최상위 체크아웃 `/home/minsub57/hunesion_workspace/cao-korean-orchestrator` 는 bare 취급이라 `git status`가
  `fatal: 이 작업은 작업 폴더에서 실행해야 합니다`로 실패한다.** 그 디렉터리의 파일은 2026-07-20 스냅샷이라 최신이 아니다.
  **읽기·작업 모두 워크트리에서 한다**(예: `.claude/worktrees/pr6-ci` = `main` clean).
- 워크트리 5개(`pr6-ci`, `coldstart-phase4d`, `handoff-linux-wsl`, `agent-a21c969f07d3bfb02`, `agent-a5714d1cc250b4f0d`)의
  브랜치는 **전부 `main` 대비 0 commits ahead** → 커밋 유실 위험 없음. 미추적물은 위 플랜 3건 외에는 SDD 스크래치
  (`.superpowers/`의 리뷰 diff·태스크 리포트)와 라이브 캡처 png 4장뿐이었다.
- **스테일 워크트리 4개(`coldstart-phase4d`, `handoff-linux-wsl`, `agent-*` 2개)는 제거했다.**
  `git worktree remove --force` 는 하네스 auto-mode classifier 가 AI 실행을 막아서 사용자가 직접 돌렸다.
  제거 전 버전관리되지 않는 참고물은 `.omo/salvage-2026-08-03/` 로 복사해 뒀다(SDD 렛저 2벌 + 라이브 캡처 4장,
  73파일 2.6MB). HANDOFF 본문이 `.superpowers/sdd/progress.md` 를 참조하는 대목은 이제 그 아카이브에서 읽는다.
  남은 워크트리는 `pr6-ci`(= `main` 체크아웃, 최상위가 bare 라 실질적인 main 작업본)와 이 세션의 작업본뿐이다.
- 제거된 워크트리가 쓰던 로컬 브랜치(`worktree-coldstart-phase4d`, `phase3-error-cost`,
  `wsl-3ai-orchestration`, `worktree-agent-*`)는 전부 `main` 에 머지된 상태로 남아 있다. 정리하려면 별도 판단.
- **최상위 체크아웃은 `core.bare=true` 다**(작업 파일이 함께 있는데도). 이것 때문에 `git status` 가 실패한다.
  플래그 해제 여부는 사용자 결정 사항 — 해제하면 07-20 스냅샷 파일들과 CRLF 차이가 한꺼번에 보인다.
- 서버는 **미기동**이었다(9889 무응답, tmux 세션 없음).

#### §0.16의 "미완" 항목 철회

§0.16은 `live-ux-round2` push 실패로 커밋 `ac1d1cf`가 로컬에만 있다고 적었다. **실제로는 그 뒤 push·PR·머지까지
완료됐다** — PR #16(2026-07-30T10:53Z 머지), `main` `4ae4f42`. §0.16의 해당 문단은 기록으로 남기되 이 절이 정정한다.

#### 미머지 잔재 3건 판정

| 잔재 | 판정 | 근거 |
|---|---|---|
| 브랜치 `tooling-wsl-fix` `1486bf4`(2026-07-20, PR 없음) | **실질 대체됨.** 잔여가치 = `cache.cached_which()` 하나 | 프런트 타임아웃은 `DEFAULT_TIMEOUT_MS = 60000` + `Promise.allSettled` + `to_thread`(PR #5 `048ce3b`)로, 백엔드 캐시는 `TTLCache(300s)` + `api/main.py:499,543` 기동 프리웜으로 각각 다른 방식으로 해결됨. 미랜딩분은 `cached_which`(shutil.which hit/miss TTL 캐시)와 `extensions._collect_provider_extensions` 병렬화 — main은 여전히 `extensions.py:126` 직렬, `providers.py:87` 생 `shutil.which` |
| 워크트리 `handoff-linux-wsl` 의 미커밋 HANDOFF 37줄 | **진짜 유실 위험이었음 → 이번에 §0.14.1로 복원** | `main` HANDOFF가 §0.14(07-21) → §0.15(07-27)로 건너뛰어 PR #5·#6 서사가 정본에 없었다 |
| 미추적 플랜 문서 **3건**(`2026-07-23-cli-install.md`, `2026-07-23-phase5-loading-ux.md`, `2026-07-23-phase6b-frontend.md`) | **해당 기능은 전부 머지됨.** 기록 보존 차원에서 이번에 커밋 | 같은 시기 다른 플랜 문서는 전부 `docs/superpowers/plans/`에 있는데 07-23 세션분 3건만 워크트리에만 있었다 |

**`cached_which` 잔여가치의 실제 크기**: 프리웜은 서버 기동 시 1회뿐이라 TTL 300초가 만료되면 그다음 첫 요청이
콜드 프로브 비용을 전부 다시 낸다(WSL 실측 extensions cold 17.2s). 60s 프런트 타임아웃 안이라 실패하지는 않고
느려질 뿐이다. → **이번 세션에서 PR #18 로 이식했다**(`cache.cached_which` + resolved-path probe +
`rescan()` 이 extensions 까지 갱신). 원 브랜치의 `ThreadPoolExecutor` 병렬화는 일부러 제외했다 — 프리웜이 콜드
경로를 이미 가리고, 부분 실패가 없는 collector 의 실패 의미론을 바꾸기 때문이다. 게이트: 백엔드 전체
`4814 passed / 14 skipped`, `test/tooling 277 passed`, black/isort/mypy(변경 2파일) 통과.
`tooling-wsl-fix` 브랜치는 PR #18 머지 후 폐기해도 된다.

#### 이번에 고친 문서

- **§0.14.1 신설** — 위 미커밋 기록 복원(번호는 기존 §0.15/§0.16을 밀지 않으려고 `0.14.1`).
- **§3-1 기동 명령에 `CAO_HOME_DIR` 추가** — 기존 §3-1은 `PYTHONPATH=src uv run cao-server ...`만 적어 두어,
  §3만 보고 기동하면 `~/.aws`(9p 마운트)에서 `os.mkfifo ENOTSUP` → 세션 생성 실패로 오케스트레이션이 전멸한다.
  올바른 명령이 §0.15 본문 안에만 묻혀 있던 것을 §3 정본으로 끌어올렸다.
- **§5 재작성 / §6 갱신** — 완료된 Phase 항목 정리, 다음 큰 단계 = Phase 7 Electron, 승인 대기 항목 명시.

#### 이 세션이 만든 PR (전부 draft)

| PR | 브랜치 | 내용 | 게이트 |
|---|---|---|---|
| #17 | `worktree-handoff-salvage` | 문서 — §0.14.1 복원, §3-1 `CAO_HOME_DIR`, §0.17, 미커밋 플랜 3건 | 문서 전용(코드 게이트 해당 없음) |
| #18 | `fix-tooling-cached-which` | `cache.cached_which` + resolved-path probe + `rescan()` extensions | 백엔드 `4814 passed / 14 skipped`, tooling `277`, black/isort/mypy |
| #19 | `chore-eol-normalize` | `.gitattributes` `* text=auto eol=lf` + 바이너리 명시 | `git add --renormalize .` 스테이징 0건(정책만 변경) |

#### CRLF 정리 결론

`.gitattributes` 를 넣으면 인덱스 LF 정규화가 강제돼 유령 diff 가 다시 생기지 않는다(PR #19). 다만
**최상위 체크아웃은 `core.bare=true` 라 애초에 `git status` 가 돌지 않으므로**, 그 973파일이 이 PR 로 즉시
정리되는 것은 아니다. 실제로 정리하려면 bare 플래그를 해제하고 재체크아웃하거나, 그 체크아웃을 버리고
워크트리만 쓰면 된다 — 사용자 결정 사항.

#### 검증

- PR #18: 백엔드 전체 `4814 passed / 14 skipped`(3분 50초), `test/tooling 277 passed`,
  `black --check`·`isort --check-only`·`mypy`(변경 2파일) 통과.
- PR #19: `git add --renormalize .` 결과 스테이징 0건, `git check-attr` 로 text/binary 판정 실측.
- PR #17: 문서 전용이라 코드 게이트 없음. `git diff --check` 통과, UTF-8(BOM 없음)·LF 확인.
- **하지 않은 것**: 프런트 게이트(`tsc`/`vitest`/`build`) — 프런트 변경 0건이라 생략. 라이브 서버 검증 — 이 세션에서
  서버를 띄우지 않았다. `tooling-wsl-fix` 의 WSL 실측 수치(`providers cold 1.6s·warm 0.001s`)는 2026-07-20 원 기록이다.

### 0.18. 2026-08-03 저장소 위생 정리 — 브랜치·bare 플래그·CI 상시 실패·간헐 실패 (Claude Opus, 백그라운드 잡)

§0.17 이 남긴 결정 항목을 전부 닫고, 그 과정에서 드러난 CI 문제 2건을 원인까지 고쳤다. 제품 동작 변경은 없다.

#### 머지된 PR

| PR | 내용 |
|---|---|
| #17 | §0.14.1 복원 · §3-1 `CAO_HOME_DIR` · §0.17 · 미커밋 플랜 3건 |
| #18 | `cache.cached_which()` + resolved-path probe + `rescan()` 이 extensions 갱신 |
| #19 | `.gitattributes` `* text=auto eol=lf` + 바이너리 명시 |
| #20 | `agent_profile.py` black 1줄 — **main CI 상시 실패 수리** |
| #21 | ToolingView 테스트 fetch 레이스 — **CI 간헐 실패 수리** |

#### CI 가 계속 빨간불이던 진짜 이유 (#20)

`#16` 이 validator 뒤 빈 줄을 빠뜨려 `black --check` 가 실패했고, Code Quality job 은 그 스텝에서 중단된다.
그래서 **그 뒤 품질 스텝들이 최근 머지 여러 번 동안 main 에서 한 번도 실행되지 않았다.** 새 브랜치는 전부
이 실패를 상속받아 "원래 빨갛다"로 오인되기 쉬웠다. 브랜치가 red 일 때 main 도 red 인지부터 보는 게 맞다.

#### 간헐 실패의 원인과 잡는 법 (#21)

증상은 `Web UI Build` 가 `Unable to find an element with the text: 확인할 수 없음` 으로 **16ms** 만에 실패하고
재실행하면 통과하는 것이었다. 원인은 제품이 아니라 테스트다 — Phase 5 가 전역 로딩 게이트를 없앤 뒤
`ToolingView` 는 헤더·탭을 즉시 그리므로, `await screen.findByRole('heading', …)` 은 **이미 있는 요소에 대해
기다리지 않고 즉시 반환**한다. 그 뒤의 동기 단언이 mock fetch 해소를 앞지르면 실패한다.

**재현 기법(재사용할 것):** 해당 파일의 mock fetch 를 같은 마이크로태스크가 아니라 **매크로태스크에서 해소**하게
만들면 그 순서가 유일한 순서가 되어 숨은 레이스가 매번 드러난다. `tooling.test.tsx` 는 이 지연(5ms)을 영구히
남겨 뒀다 — 같은 실수를 하면 CI 가 아니라 로컬에서 즉시 깨진다. 이 방식으로 그 파일에서 3건을 찾아 고쳤다:
null 환경 필드, 개요 카드, `다시 검사` 베이스라인(로딩 중 버튼 라벨이 `검사 중…`), 그리고 단일 엔드포인트 실패
테스트의 "에러 배너 없음" 을 데이터 도착 후로 옮겼다(이전에는 아무것도 안 그려진 상태라 항상 통과 = 가짜 초록).
`afterEach` 에 `vi.unstubAllGlobals()` 도 추가했다(`restoreAllMocks` 는 `stubGlobal` 을 되돌리지 않는다).

검증: 수리 전 전체 스위트 3회 중 2회 실패 → 수리 후 **5회 연속 652/652**, 이후 재확인 3회도 652/652.

**잠재 후보(미수리, 관측된 적 없음):** 같은 지연을 `workspace.test.tsx` 의 mock 7개에 임시 주입하면 5건이 깨진다.
CI 에서 실패한 이력이 없고 인위적 지연에서만 나타나므로 추측성 수정 대신 기록만 남긴다. 실제로 CI 가 이 파일에서
간헐 실패하면 위 기법을 그대로 적용할 것. `tooling-discover/sources/envtools` 는 같은 주입에도 전부 통과했다.

#### 저장소 위생

- **브랜치 정리 완료.** 워크트리에서 쓰던 4개를 먼저 지우고, 이어서 남아 있던 구 브랜치를 원격·로컬 모두 정리했다.
  삭제 전 각 브랜치의 머지 PR 존재를 확인했다(squash 머지라 `ahead>0` 으로 보이는 것들 포함).
  **현재 원격 브랜치는 `main` 하나뿐이다.**
- **`tooling-wsl-fix` 만 예외**였다 — PR #4 가 CLOSED(미머지)라 `1486bf4` 가 유일본이었다. 삭제 전
  **`archive/tooling-wsl-fix` 태그**를 찍어 push 했다(§0.17 이 이 SHA 를 참조하므로 도달 가능해야 한다).
- **최상위 체크아웃의 `core.bare=true` 를 해제했다.** 이제 `git status` 가 정상 동작한다. 해제 직후에는 CRLF
  유령이 1082 건 보였지만(`--ignore-cr-at-eol` 로 확인 시 실변경 0), `main` 을 새로 체크아웃하니
  **#19 의 `.gitattributes` 가 워킹트리에 들어오면서 정규화가 실제로 걸려 0 건이 됐다.** §3-5 의 함정은 종료.
- 그래서 **`pr6-ci` 워크트리를 제거했다** — 최상위가 bare 라서 만들어 뒀던 대체 작업본이라 존재 이유가 사라졌다.
  미추적물은 `.omo/salvage-2026-08-03/` 에 보존했다.
- 워크트리 제거·강제 제거는 하네스 auto-mode classifier 가 AI 실행을 막는 경우가 있다. 그때는 사용자가 직접
  실행해야 한다(우회하지 않는다).

#### 이 시점의 저장소 상태

`origin/main` = `78f2826`, 열린 PR 0, 원격 브랜치 `main` 1개, 태그 `archive/tooling-wsl-fix`,
워크트리 = 최상위(정상 작업본) + 세션 워크트리. 게이트: 백엔드 `4814 passed / 14 skipped`,
프런트 `652/652`, tsc 0, build ✓, black/isort clean.

### 0.19. 2026-08-03 Phase 7 착수 — 데스크톱 셸 3단계 (Claude Opus, 백그라운드 잡)

`docs/desktop-shell-electron-vs-tauri.md` 의 결론(**v1 Electron 유지**)을 그대로 따랐다. Tauri 2 는 외부 URL 로드 시
remote-origin IPC 허용(구 `dangerousRemoteUrlIpcAccess`)이 필요해 계획의 load-bearing 결정과 충돌한다.

#### 머지된 PR

| PR | 내용 | 게이트 |
|---|---|---|
| #23 | `CAO_DEFAULT_SHELL` 백엔드 시임 (§4) | 백엔드 `4825 passed / 14 skipped` |
| #24 | `electron/` 워크스페이스 + server-manager + 부트/트레이 | electron `28`, tsc 0 |
| #25 | `caoNative` 브리지 + 웹 측 감지 | 웹 `670/670`, electron `46`, build ✓ |
| #26 | WSL distro·셸 감지 + electron-builder 설정 | electron `89`, tsc 0 |

CI 에 `Desktop Shell` job 추가(typecheck + 단위만, `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 로 ~100MB 바이너리 미다운로드).

#### 계획서와 달라진 것 — 순서

계획 §8 의 7a 는 **mac 우선**(mac spawn·mac 셸 감지·"mac 에서 dmg 기동까지")인데, 이 저장소의 현재 개발 환경은
**Windows + WSL2** 다. mac 실기동을 할 수 없으므로 "여기서 검증 가능한 것" 순서로 재배열했다: 백엔드 시임 →
순수 로직(server-manager·WSL 파싱·셸 검증) + 단위 테스트 → 웹 측 감지. mac/Windows 실기동과 패키징은 뒤로 미뤘다.

#### 다시 알아내기 비싼 것

- **`wsl.exe -l -v` 는 UTF-16LE 다.** UTF-8 로 읽으면 `Ubuntu` 가 `" U b u n t u"` 가 되어 모든 이름 비교가 조용히
  실패한다. 실측 바이트 `20 00 20 00 4E 00 …`. 테스트 픽스처는 이 PC 의 실제 출력이다.
- **헤더 행은 위치로 버려야 한다.** Windows 가 헤더를 현지화하므로 `"NAME"` 매칭은 한국어 환경에서 `이름` 이라는
  가짜 배포판을 만든다.
- **WSL1 은 사용 불가**(localhost 포워딩이 달라 창이 서버에 닿지 못함), docker-desktop 계열은 Running 이라 멀쩡해
  보이지만 선택지에서 제외.
- **`findByRole` 은 이미 있는 요소면 기다리지 않는다** — §0.18 과 같은 계열의 함정. 브리지 테스트도 데이터 도착을
  기다리도록 작성했다.
- **attach 우선이 왜 절대 규칙인지**: 서버가 둘이면 같은 tmux pane 에 pipe-pane 모니터가 둘 붙어 출력 캡처가 깨진다.
  그래서 이미 뜬 CAO 서버가 있으면 바이너리 탐색조차 건너뛴다(PATH 를 못 읽는 GUI 실행에서도 앱이 동작하는 이유).
- **포트가 찼다고 우리 것이 아니다** — `/health` 의 `service: cli-agent-orchestrator` 확인 후에만 attach.

#### 남은 Phase 7 작업

1. `shellConfig` 브리지 배선(preload/main) + **설정 화면 셸 카드** — 감지 로직(#26)은 있고 UI 와 저장이 없다.
   PowerShell 선택 시 `POWERSHELL_CAVEAT` 를 상시 표시해야 한다.
2. 서버 spawn 에 선택된 셸/배포판 실제 반영 + `CAO_DEFAULT_SHELL` 전달(백엔드 쪽 #23 은 준비 완료).
3. mac: 로그인 셸 기동·`dscl` 폴백 감지, **실기동 + dmg 검증**(Mac 필요).
4. Windows: `wsl.exe` 경로 실동작, nsis 패키징 검증(**회사 PC 에서 사용자 수행** — 계획 §8 검증 행).
5. 트레이 아이콘 실물 교체(현재 16×16 생성 PNG), 로그 열기 메뉴.

#### 검증하지 않은 것 (중요)

이 세션은 **GUI 를 한 번도 띄우지 않았다.** 디스플레이 없는 WSL 이라 Electron 창·폴더 대화상자·트레이·부트 화면은
코드로만 존재한다. 검증된 것은 순수 로직(server-manager·WSL 파싱·셸 검증·브리지 가드)과 웹 측 폴백 동작뿐이다.
패키징도 실행하지 않았다(설정만).

## 7. 데이터/저장 규약 (프런트 로컬)
`cao:theme`(라이트 기본), `cao:projects:v1`, `cao:hidden-providers:v1`(기본 [kiro_cli,kimi_cli,cursor_cli,hermes]), `cao:workbench:v1:<session>`, `cao:workspace:team-roster:v1:<session>`, `cao:workspace:delegation-history:v1:<session>`, `cao:env-profiles:v1`, `cao:usage:claude-limits-optin:v1`, `cao:pending-select-session`(sessionStorage). 세션명은 서버 규칙 `^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$`(cao- 프리픽스는 표시에서만 숨김 — displayName.ts).
