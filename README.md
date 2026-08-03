# MS Orchestrator

여러 AI 코딩 CLI(Claude Code · Codex · Antigravity 등)를 **한 채팅 화면에서 오케스트레이션**하는 로컬 작업대.
오케스트레이터 하나가 워커 에이전트에게 일을 나눠 주고, 각 에이전트는 tmux 안에서 진짜 CLI 프로세스로 돌아간다.

[awslabs/cli-agent-orchestrator](https://github.com/awslabs/cli-agent-orchestrator) 포크다. 상위 프로젝트의 코어
(tmux 백엔드 · MCP 오케스트레이션 · 프로필)를 그대로 쓰면서, 이 저장소는 **한국어 UI · 채팅 중심 작업공간 ·
도구/확장 컨트롤센터 · 데스크톱 셸**을 얹었다. CLI 사용법·MCP 프리미티브 같은 원본 기능 문서는 상위 저장소 README 를 참고한다.

---

## 무엇이 들어 있나

| 구성 | 위치 | 설명 |
|---|---|---|
| 서버 | `src/cli_agent_orchestrator/` | FastAPI. 세션·터미널·오케스트레이션·도구 인벤토리 API, 웹 UI 정적 서빙, MCP 서버 |
| 웹 UI | `web/` | React + Vite. 빌드 산출물이 서버의 `web_ui/` 로 들어가 같은 오리진에서 서빙된다 |
| 데스크톱 셸 | `electron/` | Electron. **서버 수명 관리 + 네이티브 브리지만** 담당하고, 창은 `http://127.0.0.1:<port>` 를 그대로 띄운다 |
| 터미널 백엔드 | `backends/` | tmux(기본) / herdr |

데스크톱 셸이 웹 UI 를 복제하지 않는 것이 핵심이다. 브라우저로 쓰든 앱으로 쓰든 **같은 화면**이고, 앱에서만
가능한 동작(OS 폴더 선택창 등)은 `window.caoNative` 브리지로 기능 감지해서 쓴다.

---

## 빠른 시작 (Linux / WSL2)

### 준비물

- **Python 3.12** — uv 로 설치한다. 시스템 기본이 3.14 면 그대로 쓰지 말 것: `httptools`·`uvloop` 에 cp314 휠이
  없어 소스 컴파일로 넘어가고 컴파일러가 없으면 그대로 실패한다.
- Node 20+ (웹/데스크톱 빌드), tmux, `uv`

```bash
uv python install 3.12
uv sync -p 3.12
```

### 서버 실행

```bash
CAO_HOME_DIR=$HOME/.local/share/cao-home \
PYTHONPATH=src uv run cao-server --host 127.0.0.1 --port 9889
```

> **`CAO_HOME_DIR` 를 ext4 경로로 지정해야 한다.** 기본 홈은 `~/.aws/cli-agent-orchestrator/…` 인데, WSL 에서 그
> 경로가 Windows 9p 마운트면 FIFO 생성이 `os.mkfifo: [Errno 95] Operation not supported` 로 실패한다. 이때
> **서버는 정상적으로 뜨고 `/health` 도 200 을 주지만 터미널·오케스트레이션·슬래시·컨텍스트 게이지가 전부 죽는다.**
> 겉보기 멀쩡함이 이 함정의 핵심이라 명령에 항상 포함한다.

브라우저에서 `http://127.0.0.1:9889` 를 연다. Windows 에서 WSL 서버로 접속할 때도 같은 주소를 쓴다(WSL2 localhost 포워딩).

### 웹 UI 개발

```bash
cd web
npm ci
npm run dev      # vite dev 서버 (API 는 9889 로 프록시)
npm run build    # 서버가 서빙하는 web_ui/ 로 산출
```

---

## 데스크톱 앱

```bash
cd electron
npm ci
npm run build          # tsc -p tsconfig.build.json → dist/
npx electron .         # 실행
npm run pack:win       # nsis 인스톨러
npm run pack:mac       # dmg/zip (arm64)
```

동작 규칙 — 전부 의도적인 선택이다.

- **attach 우선.** 이미 CAO 서버가 응답하면 새로 띄우지 않고 연결한다. 서버가 둘이면 같은 tmux pane 에 pipe-pane
  모니터가 둘 붙어 출력 캡처가 깨진다. 그래서 이미 뜬 서버가 있으면 바이너리 탐색조차 건너뛴다.
- **포트가 찼다고 우리 서버는 아니다.** `/health` 가 `service: cli-agent-orchestrator` 로 답할 때만 attach 하고,
  아니면 다음 포트(9890…)로 넘어간다.
- **우리가 띄운 서버만 종료한다.** attach 한 서버는 사용자 터미널 소유다.
- **로그인 셸로 기동한다**(`<shell> -lc`). GUI 로 띄운 앱은 사용자 PATH 를 상속하지 않아 uv·nvm·pyenv 로 깐 CLI 가
  "설치 안 됨"처럼 보인다. Windows 에서는 그 셸이 `wsl.exe -d <distro> --` 안에서 돈다 — 서버는 Windows 에서 돌지 않는다.
- **설정 › 서버 실행 셸** 에서 셸/배포판을 고른다. 설치되지 않은 항목은 숨기지 않고 사유와 함께 비활성으로 보여 준다.
  선택한 셸은 `CAO_DEFAULT_SHELL` 로 서버에 전달돼 에이전트 터미널도 같은 셸에서 뜬다.
- 앱이 띄운 서버의 출력은 `userData/cao-server.log` 에 쌓이고 트레이의 **서버 로그 열기** 로 볼 수 있다.
- 렌더러 CSP 는 셸이 주입한다(`script-src 'self'`). 서버는 CSP 를 보내지 않는다 — 브라우저 배포를 건드리지 않기 위해서다.

### 플랫폼별 검증 상태

| 플랫폼 | 상태 |
|---|---|
| Windows + WSL2 | **실기동 검증 완료** — attach/spawn, WSL distro·셸 감지, 메뉴 전수, nsis 패키징, 종료 시 서버 정리 (HANDOFF §0.20) |
| Linux | 서버·웹은 상시 사용 중. 데스크톱 셸 GUI 는 미검증 |
| macOS | **미검증** — 코드 경로는 있으나 dmg·로그인 셸 감지를 실기동으로 확인하지 않았다 |

---

## 개발

```bash
# 백엔드
PYTHONPATH=src uv run python -m pytest test/ -q --no-cov -m 'not e2e' \
  --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py

# 웹
cd web && npx tsc --noEmit && npm test && npm run build

# 데스크톱 셸
cd electron && npm run typecheck && npm test
```

CI(`.github/workflows/ci.yml`)는 Unit Tests(3.10/3.11/3.12) · Web UI Build · **Desktop Shell**(typecheck + 단위) ·
CAO MCP Apps · Code Quality · Security Scan 을 돌린다. Desktop Shell 잡은 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 로
Electron 바이너리를 받지 않는다 — 패키징은 로컬 작업이다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/HANDOFF-msorchestrator.md`](docs/HANDOFF-msorchestrator.md) | **세션 간 인수인계 정본.** 지금까지의 결정·실버그·함정이 시간순으로 쌓여 있다. 새로 붙는 사람은 여기부터 |
| [`docs/electron-plan.md`](docs/electron-plan.md) | 데스크톱 셸 확정 설계 |
| [`docs/desktop-shell-electron-vs-tauri.md`](docs/desktop-shell-electron-vs-tauri.md) | Tauri 2 대안 검토와 v1 에서 Electron 을 유지한 근거 |
| [`docs/ui-refactor-plan.md`](docs/ui-refactor-plan.md) | UI 개편 전체 계획 |
| [`docs/api.md`](docs/api.md), [`docs/configuration.md`](docs/configuration.md), [`docs/agent-profile.md`](docs/agent-profile.md) | API · 설정 · 에이전트 프로필 |
| `docs/superpowers/plans/` | 작업별 구현 플랜 |

---

## 알려진 함정

다시 알아내려면 비싼 것들만 모았다. 자세한 재현·근거는 HANDOFF 각 절에.

- **`CAO_HOME_DIR` 은 ext4** — 위 §서버 실행. 증상이 "서버는 멀쩡한데 아무것도 안 됨"이라 오진하기 쉽다.
- **Python 3.12 고정** — 3.14 는 휠이 없어 컴파일로 넘어간다.
- **`wsl.exe -l -v` 출력은 UTF-16LE** — UTF-8 로 읽으면 `Ubuntu` 가 `" U b u n t u"` 가 되어 이름 비교가 조용히
  전부 실패한다. 헤더 행도 Windows 언어에 따라 현지화되므로 문자열이 아니라 위치로 걷어내야 한다.
- **WSL1 은 쓸 수 없다** — localhost 포워딩 방식이 달라 창이 서버에 닿지 못한다. docker-desktop 배포판도 선택지에서 제외한다.
- **샌드박스 preload 는 상대경로 `require` 를 못 한다** — Electron 문서가 "여러 파일로 쪼개려면 번들러가 필요하다"고
  명시한 그 제약이다. 어기면 preload 가 조용히 죽고 `window.caoNative` 가 사라지는데, 메인 로그에는 아무 것도 안 남아
  앱이 "그냥 브라우저"처럼 보인다. `electron/test/preload-sandbox.test.ts` 가 이걸 소스 수준에서 막는다.
- **Windows 에서 `process.kill(-pid)` 는 못 쓴다** — POSIX 전용이라 예외가 나고, 앱을 닫아도 서버가 살아 포트를
  잡고 있게 된다. `taskkill /T` 를 쓴다.
- **CRLF** — `.gitattributes` 가 `* text=auto eol=lf` 를 강제한다. 이전에는 EOL 차이만으로 973 파일이 수정된 것처럼 보였다.

---

## 라이선스

Apache-2.0. 상위 프로젝트 [awslabs/cli-agent-orchestrator](https://github.com/awslabs/cli-agent-orchestrator) 의
저작권 표기는 [`NOTICE`](NOTICE) 를 따른다.
