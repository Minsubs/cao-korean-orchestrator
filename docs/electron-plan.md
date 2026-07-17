# Electron 패키징 설계 (Phase 7)

> 확정 설계 문서. 타깃: **macOS(개인, arm64)** + **Windows(회사, 서버는 WSL Ubuntu)**.
> 원칙: 렌더러는 기존 web UI 그대로(HTTP-only), Electron은 "서버 수명 관리자 + 네이티브 브리지"만 담당.

## 1. 아키텍처 결정

```
Electron main ──spawn/attach──▶ cao-server (FastAPI, :9889)
     │                              ▲ HTTP/SSE/WS (localhost)
     ├─ preload (contextBridge) ─┐  │
     └─ BrowserWindow ── loadURL(http://127.0.0.1:9889) ── 기존 web UI
```

- **렌더러 = `loadURL(http://127.0.0.1:<port>)`** — UI가 이미 서버에서 서빙되고 API가 상대경로라 **웹 코드 수정 0**으로 이식. file:// 방식은 쓰지 않는다(CORS/경로 문제 원천 차단).
- **서버 실행 전략**
  - **attach 우선**: 시작 시 포트 헬스체크 → 이미 떠 있으면 **스폰하지 않고 연결**(이중 pipe-pane 모니터 방지 — 알려진 위험).
  - macOS: 설치된 `cao-server` 탐지(PATH + `~/.local/bin` + uv tool 후보) 후 자식 프로세스로 spawn. Python 번들(PyInstaller)은 v2 — v1은 "설치 요구 + 온보딩 안내"가 단순하고 개발 모드와 동일 경로.
  - Windows: **`wsl.exe -d <distro> -- cao-server --host 127.0.0.1 --port <port>`** 로 WSL 안에서 기동. WSL2 localhost 포워딩으로 Windows에서 `127.0.0.1:<port>` 접근. distro 목록은 `wsl.exe -l -q`로 조회해 선택 UI 제공. Python/서버 미설치 시 안내(§4).
  - 포트: 기본 9889, 점유+비CAO(헬스 실패) 시 9890…+n 자동 탐색.
  - 종료: 우리가 spawn한 경우에만 서버 종료(그레이스풀 SIGTERM→타임아웃 kill, Windows는 wsl 프로세스 트리 종료). attach 모드면 건드리지 않음.

## 2. 보안 규칙 (필수)

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. preload는 `contextBridge.exposeInMainWorld('caoNative', …)`로 **아래 계약만** 노출. 렌더러의 파일시스템/셸 접근 금지 원칙은 Electron에서도 동일 — 모든 파일 작업은 여전히 cao-server API 경유. `setWindowOpenHandler`로 외부 링크는 `shell.openExternal`, 그 외 창 생성 거부. 원격 콘텐츠 로드 없음(localhost 전용).

## 3. 네이티브 브리지 계약 — `window.caoNative` (preload)

| API | 시그니처 | 웹 폴백(현행) |
|---|---|---|
| `pickDirectory` | `(initialPath?: string) => Promise<string \| null>` — native 폴더 대화상자 | DirectoryPicker(fs/list) — 프런트는 `window.caoNative?.pickDirectory` 감지 후 우선 사용 |
| `openExternal` | `(url: string) => void` (https만) | `<a target=_blank>` |
| `appInfo` | `() => { platform, version, serverMode: 'spawned'\|'attached', distro? }` | 없음 — TopBar 환경 칩 보강용 |
| `restartServer` | `() => Promise<void>` (spawned 모드만, 확인 후) | 없음 |
| `shellConfig` | `get(): Promise<{mode, detected}>` / `set(mode): Promise<void>` — §4 셸 설정 읽기/변경 (웹 Settings 노출용) | 없음 — Electron 전용 설정 |

- 브라우저 알림(Notification API)은 Electron에서 OS 알림으로 동작 → **교체 불필요, 유지**.
- ⌘K 등 단축키는 앱 내 키 훅으로 이미 동작 → 글로벌 단축키는 v2.

## 4. 셸 기본값 설정 (wsl · mac · powershell) — 피드백 #15

> 원칙: 선택지는 전부 실동작(가짜 옵션 금지), 자동 감지도 실제 감지 결과만 표시.

- **설정 모델**: `shell.mode = auto | mac:<셸경로> | wsl:<distro> | powershell` — electron-store에 저장, 부트/진단 화면과 트레이에서 변경, 웹 Settings에서는 `caoNative.shellConfig` 브리지로 읽기/변경.
- **자동 감지 (실구현)**
  - mac: `$SHELL` → `dscl . -read ~ UserShell` → `/bin/zsh` 순 폴백. 수동 선택지는 `/etc/shells`의 실존 항목만 나열.
  - Windows: `wsl.exe -l -v` 파싱으로 distro 목록+기본 distro, PowerShell은 `pwsh.exe`(7) → `powershell.exe`(5.1) 순 감지. 감지 실패 항목은 선택 불가 + 사유 표기.
- **동작 지점 1 — 서버 기동 환경**: mac은 `<선택 셸> -lc 'cao-server …'`(로그인 셸 PATH/rc 반영 — uv·nvm·pyenv PATH 문제 해소), Windows는 `wsl.exe -d <선택 distro> -- <셸> -lc 'cao-server …'`.
- **동작 지점 2 — 에이전트 터미널 셸**: spawn 시 서버에 `CAO_DEFAULT_SHELL=<path>` 전달 → 터미널 생성 경로의 기존 `window_shell` 시임(backends.create_window → tmux new_window)으로 적용, CLI가 사용자 셸 환경(PATH/rc)에서 뜬다. **소형 백엔드 확장 1건**(이 저장소: 설정/env를 읽어 create_window에 전달) — 7a에 포함하되 Phase 6에서 선반영 가능.
- **PowerShell의 정직한 범위 (v1)**: 에이전트 터미널은 tmux 기반이라 PowerShell이 호스트할 수 없음 — 선택 시 "에이전트 터미널은 WSL(<distro>)에서 실행됩니다"를 상시 표기하고, PowerShell은 Windows 쪽 보조 실행(외부 명령·탐색기 열기)과 진단 화면 감지 표기에 사용. **v2 승격 경로**: backends 계층이 이미 플러그블(tmux/herdr)이므로 ConPTY 기반 Windows-native 백엔드를 추가하면 PowerShell 에이전트 터미널이 가능해짐 — 이 설정이 그대로 백엔드 선택으로 확장된다.

## 5. 시작/온보딩 UX

main이 띄우는 로컬 부트 화면 1장(단순 HTML, 번들 내):
`서버 확인 중 → (없으면) 기동 중(로그 꼬리 표시) → 성공 시 UI 로드` /
실패 시 진단 화면: 탐지한 경로 후보, (Windows) distro 선택, "cao-server 설치 안내", 재시도. 가짜 진행 표시 금지 — 실제 헬스체크 기반.
트레이 아이콘: 서버 상태(spawned/attached/실패) + 재시작 + 로그 열기 + 종료.

## 6. 저장소 구조 & 개발 모드

```
electron/            # 독립 워크스페이스 (web/·python과 분리, 기존 CI 무영향)
  package.json       # electron, electron-builder, typescript
  src/main.ts        # 수명 관리·창·트레이·메뉴
  src/server-manager.ts  # 탐지/attach/spawn(mac·wsl)/헬스/종료
  src/preload.ts     # caoNative 계약
  boot.html          # 부트/진단 화면
```
- dev: `ELECTRON_DEV=1`이면 서버는 개발자가 띄운 것 attach + `loadURL(vite dev 5173)`.
- CI: electron 디렉터리는 typecheck+unit(server-manager 로직, spawn mock)만. 패키징은 로컬 태스크.

## 7. 패키징 (electron-builder)

- mac: `dmg`+`zip`, arm64, 개인 사용이라 v1은 ad-hoc 서명(공증 생략) — Gatekeeper 우회 절차를 README에 기록.
- win: `nsis` x64. 서버는 WSL에 있으므로 Python 번들 불필요.
- 앱 이름 `MS Orchestrator`, 아이콘: 마스코트 SVG → icns/ico 변환 태스크 포함.
- 자동 업데이트(electron-updater)는 v2.

## 8. 구현 분할 (Phase 7 발주 계획)

| 단계 | 내용 | 담당 |
|---|---|---|
| 7a | electron/ 골격 + server-manager(mac spawn·attach·포트·종료) + 부트 화면 + 창/메뉴/트레이 + **mac 셸 감지·로그인 셸 기동 + CAO_DEFAULT_SHELL 백엔드 시임(§4)** + mac에서 실기동 검증 | Opus |
| 7b | preload 계약 + 웹 측 감지 코드(DirectoryPicker native 우선, TopBar appInfo 칩, Settings 셸 설정 카드) + 보안 설정 테스트 | Sonnet |
| 7c | Windows/WSL server-manager 분기 + **distro·PowerShell 감지 + 셸 설정 UI(§4)** + electron-builder 설정(mac 빌드 검증) | Opus |
| 검증 | mac: 이 세션에서 dmg 기동까지. **Windows/WSL 실검증: 회사 PC에서 사용자 수행**(체크리스트 제공) | 사용자 협업 |

## 9. 리스크와 대응

- **이중 서버**: attach 우선 + spawned만 종료 (§1)
- **PowerShell 기대 불일치**: 에이전트 터미널은 v1에서 WSL 고정 — 셸 설정 화면에 제약을 상시 명시(§4), native 백엔드는 v2
- WSL 미설치/버전(WSL1은 포워딩 다름): `wsl.exe -l -v` 검사 후 안내
- 서버 좀비: spawn 시 프로세스 그룹 관리, 종료 훅(before-quit)+타임아웃 kill
- CLI 로그인(claude/codex/agy)은 WSL 셸 안 상태를 따름 — 온보딩에 "WSL에서 로그인 확인" 안내
- 포트 충돌/방화벽(회사 PC): localhost 한정이라 일반적으로 무프롬프트, 문제 시 진단 화면에 표기
