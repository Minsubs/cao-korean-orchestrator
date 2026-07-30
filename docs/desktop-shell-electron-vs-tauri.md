# 데스크톱 셸 선택 검토 — Electron vs Tauri 2 (Phase 7)

> 2026-07-30 작성. `docs/electron-plan.md`(확정 설계)에 대한 대안 검토.
> 결론 먼저: **v1 은 Electron 유지 권고.** Tauri 2 는 "언제 다시 볼지"를 조건으로 명시해 보류.
> 이 문서는 결정 근거를 남기는 것이 목적이므로 압축하지 않는다.

## 0. 이 비교가 일반적인 Electron vs Tauri 논쟁과 다른 이유

일반적인 비교는 "번들 크기 vs 생태계"로 흐른다. 이 프로젝트는 전제가 달라서 그 축이 결정적이지 않다.

`docs/electron-plan.md` §1 의 아키텍처는 셸을 의도적으로 얇게 잡았다.

```
셸 ──spawn/attach──▶ cao-server (FastAPI, :9889)
 │                        ▲ HTTP/SSE/WS (localhost)
 └─ 창 ── loadURL(http://127.0.0.1:9889) ── 기존 web UI 그대로
```

셸이 지는 책임은 네 가지뿐이다.

1. 서버 수명 관리 — attach 우선, 없으면 spawn(mac 직접 / Windows 는 `wsl.exe`), 포트 탐색, 그레이스풀 종료
2. 네이티브 브리지 5개 — `pickDirectory` / `openExternal` / `appInfo` / `restartServer` / `shellConfig`
3. 부트·진단 화면 + 트레이
4. 패키징 (mac dmg/zip arm64, win nsis x64)

렌더러는 **기존 web UI 를 수정 0으로** 재사용한다. 즉 이 선택은 "어떤 프레임워크로 앱을 만들까"가 아니라 **"localhost 웹앱을 가리키는 창 + 작은 브리지를 무엇으로 만들까"** 다. 그래서 판단 기준도 달라진다.

## 1. Electron 계획의 load-bearing 결정 두 개

Tauri 검토는 이 두 개를 지킬 수 있는지가 전부다.

| # | 결정 | 근거 (계획서 원문) |
|---|---|---|
| **A** | 렌더러 = `loadURL(http://127.0.0.1:<port>)` | "UI가 이미 서버에서 서빙되고 API가 상대경로라 **웹 코드 수정 0**으로 이식" |
| **B** | `file://` 방식 배제 | "CORS/경로 문제 원천 차단" |

A 는 이식 비용을 0으로 만드는 장치고, B 는 그 대가로 피하려던 문제를 명시한 것이다. **Tauri 의 두 가지 구현 경로가 각각 이 둘 중 하나와 충돌한다** — 이것이 이번 검토의 핵심 발견이다.

## 2. Tauri 2 로 가는 두 경로와 각각의 대가

### 경로 1 — 외부 URL 로드 (A 를 지키는 쪽)

Tauri 2 의 `WebviewUrl` 은 **외부 `http`/`https` URL 을 지원한다**(공식 문서 `reference/config` 확인). 따라서 창을 `http://127.0.0.1:9889` 로 띄우는 것 자체는 된다.

문제는 브리지다. 그 origin 에서 IPC(=우리의 `caoNative` 5개)를 쓰려면 **remote origin 에 capability 를 명시 허용**해야 한다.

```json
{
  "identifier": "remote-capability",
  "windows": ["main"],
  "remote": { "urls": ["https://*.mydomain.dev"] },
  "permissions": ["..."]
}
```

공식 문서가 이 기능에 붙인 경고를 그대로 옮긴다.

- `security/capabilities`: "Consider security implications carefully."
- v1.3 릴리스 노트(이 기능의 전신): "**profoundly affects the application's security model**... developers are strongly advised to exercise extreme caution"
- v1 시절 설정 키 이름 자체가 **`dangerousRemoteUrlIpcAccess`** 였다. v2 에서 capability 로 정제됐지만 성격은 같다.

즉 Electron 에서는 preload 가 어떤 URL 에든 자연히 붙는 **표준 관용구**인 일이, Tauri 에서는 프레임워크가 "위험"으로 분류하고 별도 허용목록을 요구하는 **예외 경로**가 된다. 기능 부재가 아니라 **설계 결이 반대**라는 점이 문제다.

### 경로 2 — 프런트엔드 자산 번들 (B 를 깨는 쪽)

`web/dist` 를 앱에 넣고 `tauri://localhost` origin 에서 실행하면 IPC 는 기본 origin 이라 깔끔하다. 대신 **모든 API 호출이 cross-origin 이 된다.** 우리 web 코드는 `const BASE = ''` 로 상대경로를 쓰므로(`web/src/api.ts:1`) 전부 절대 URL 로 바꾸고, **cao-server 에 CORS 를 열어야** 한다.

이건 계획서가 §1 에서 명시적으로 피한 그 문제다("CORS/경로 문제 원천 차단"). 그리고 서버에 CORS 를 여는 것은 로컬 바인딩이라도 보안 표면 확대다 — 브라우저에서 임의 페이지가 `127.0.0.1:9889` 를 때릴 수 있게 되는 조건을 새로 만든다.

**요약: 경로 1 은 프레임워크가 위험하다고 표시한 문을 열어야 하고, 경로 2 는 계획이 의도적으로 닫아둔 문을 다시 열어야 한다.**

## 3. 항목별 비교

`✅` = 우위, `⚠️` = 주의, `❌` = 실질 장애

| 항목 | Electron | Tauri 2 | 이 프로젝트에서의 무게 |
|---|---|---|---|
| 번들 크기 | ❌ ~100–150MB | ✅ ~3–10MB | **낮음.** 배포 대상이 개인 mac + 회사 PC 2대, 스토어 배포 없음 |
| 메모리 | ⚠️ Chromium 상주 | ✅ 시스템 WebView | 낮음~중간. 서버·CLI·tmux 가 이미 주 소비자 |
| **WebView 엔진 일관성** | ✅ Chromium 고정 | ❌ mac=WKWebView(Safari), win=WebView2(Chromium) | **높음.** 아래 §4 |
| **localhost URL + 브리지** | ✅ preload 표준 관용구 | ⚠️ remote capability (문서가 "dangerous" 로 분류) | **결정적.** §2 |
| 웹 코드 수정량 | ✅ 0 | ⚠️ 0(경로1) / ❌ 다수+서버 CORS(경로2) | **높음** |
| 렌더러 격리 | ⚠️ `nodeIntegration:false`·`sandbox:true` 를 **설정**으로 확보 | ✅ Node 자체가 없어 **구조적**으로 확보 | 중간. Tauri 의 진짜 우위 |
| 서버 spawn/attach | ✅ `child_process` + 성숙한 선례 | ✅ `tauri-plugin-shell` / sidecar | 동등 |
| 트레이·폴더 대화상자·외부 링크 | ✅ 코어 | ✅ v2 코어/1st-party 플러그인(tray, dialog, opener) | 동등 |
| 자동 업데이트(v2 목표) | ✅ electron-updater | ✅ updater 플러그인 | 동등 |
| 툴체인 추가 | ✅ 없음(이미 Node) | ❌ Rust + 플랫폼 빌드 의존성(win: MSVC) | **중간~높음.** 이 저장소 Rust 0 |
| Windows 런타임 전제 | ✅ 자체 포함 | ⚠️ WebView2 필요(Win10/11 기본 탑재, 회사 이미지 지연 시 부트스트래퍼) | 낮음 |
| 이 문제 영역의 선례·문서 | ✅ 두꺼움 | ⚠️ "로컬 서버를 가리키는 셸" 조합은 상대적으로 얇음 | 중간 |

## 4. 엔진 일관성이 왜 이 프로젝트에서 특히 무거운가

Tauri 는 OS WebView 를 쓴다. 그러면 **mac 은 Safari 엔진(WKWebView)** 에서 UI 가 돌아간다. 우리 UI 의 검증 자산은 전부 Chromium 기준이다.

- E2E: Playwright **chromium 전용** (`npm run test:e2e:install` 이 chromium 만 설치)
- 단위: vitest + jsdom
- 이번 세션의 라이브 검증도 Chromium 실화면

그리고 UI 가 무겁게 쓰는 것들이 엔진 민감한 축에 걸쳐 있다.

- **xterm.js (canvas 렌더링)** — 터미널이 제품의 핵심 화면
- **SSE(`/ui/events`)** — 재연결·스트림 수명
- **CSS 변수 기반 디자인 토큰 + `prefers-color-scheme`**
- 1MB 넘는 단일 번들(`index-*.js` ~1,047KB)

Tauri 로 가면 **검증해야 할 브라우저 축이 1개에서 2개로 늘고, 새로 늘어난 쪽(WKWebView)에는 E2E 자산이 없다.** 이건 일회성 이식 비용이 아니라 **상시 유지 비용**이다. 반면 Electron 은 이 축을 1로 고정해 준다 — 즉 Electron 이 사는 값의 상당 부분이 "우리가 이미 만든 Chromium 기준 검증 자산을 그대로 재사용"이다.

## 5. 권고

**v1 은 Electron 으로 진행한다.** 이유를 우선순위대로:

1. **Tauri 의 두 경로가 각각 계획의 load-bearing 결정 하나를 깬다**(§2). 어느 쪽도 "그냥 바꿔 끼우기"가 아니다.
2. **엔진 축이 2개로 늘어난다**(§4). 이 프로젝트가 지금 가진 검증 자산과 정면으로 어긋난다.
3. Tauri 의 최대 강점(크기·메모리)이 **이 배포 상황에서 2차적**이다. 2대 사설 배포, 스토어 없음.
4. Electron 계획은 이미 함정까지 적힌 확정 문서다(이중 서버, WSL1 포워딩, PowerShell 범위 정직화, 좀비 프로세스). 그 사전조사를 버리게 된다.
5. Rust 툴체인 추가는 CI·온보딩 비용이며, 지금 저장소에 Rust 코드가 0이다.

### 다만 — 진짜 헤지는 프레임워크 선택이 아니다

셸의 표면을 작게 유지하는 것이 헤지다. 계획서가 이미 그렇게 설계돼 있다: **브리지 5개 + 서버 수명 관리 + 부트 화면.** 이 표면을 유지하는 한 셸은 **교체 가능한 부품**이다. 따라서 7a 를 진행할 때 다음을 규칙으로 못 박는 것을 권한다.

- 서버 탐지/attach/spawn/포트/종료 로직을 **UI 프레임워크 API 와 섞지 않는다**(`server-manager.ts` 를 순수 로직으로 유지 — 계획서 §6 구조가 이미 그렇다).
- `window.caoNative` 계약을 **5개에서 늘리지 않는다.** 늘어날수록 교체 비용이 선형으로 증가한다.
- 웹 측은 항상 `window.caoNative?.…` 로 **feature-detect + 웹 폴백**을 유지한다(계획서 §3 표에 폴백이 이미 명시됨). 이러면 셸이 없어도, 바뀌어도 UI 가 산다.

### Tauri 2 를 다시 볼 조건 (아무 때나가 아니라 이때)

아래 중 **하나라도** 실제로 발생하면 재검토할 값이 있다.

1. 배포 대상이 2대를 넘어 **여러 사람에게 나눠주는 상황**이 된다 → 100MB+ 다운로드가 실제 마찰이 된다.
2. Electron 상주 메모리가 **측정으로** 문제로 확인된다(체감이 아니라 수치).
3. mac 을 **WKWebView 로도 검증할 이유가 따로 생긴다**(예: Safari 사용자 대응) → 엔진 축 증가가 어차피 지불될 비용이 된다.
4. 서버에 **CORS 를 이미 열어야 할 다른 정당한 이유**가 생긴다 → 경로 2 의 대가가 이미 지불된 상태가 된다.

## 6. 확인하지 못한 것 (재검토 시 spike 로 먼저 검증할 항목)

정직하게 남긴다. 아래는 문서로 확정하지 못했고, Tauri 로 기울 때 **코드 한 줄 쓰기 전에** 확인해야 한다.

1. **`remote.urls` 가 plain `http` origin 을 허용하는가.** 공식 예시는 전부 `https://*.…` 다. 우리 대상은 `http://127.0.0.1`.
2. **동적 포트를 패턴으로 표현할 수 있는가.** 계획 §1 은 9889 점유 시 9890+n 로 이동한다. URLPattern 와일드카드 포트(`http://127.0.0.1:*`)가 실제로 매칭되는지 확인 필요.
3. **remote capability 가 데스크톱에서 지원되는가.** 문서의 대표 예시가 `platforms: ["iOS","android"]` 로 한정돼 있었다(그 예시의 per-capability 필터일 뿐일 가능성이 높지만, 확인 없이 전제하면 안 된다).
4. **WKWebView 에서 xterm.js + SSE 실동작.** 최소 재현 앱으로 터미널 1개 열고 이벤트 스트림 붙여 보는 30분짜리 spike.

1~3 중 하나라도 막히면 경로 1 은 사라지고 경로 2(=서버 CORS + 웹 코드 수정)만 남는다. 그 경우 Tauri 의 비용은 이 문서가 적은 것보다 **더 크다.**

## 7. 한 줄 결론

셸이 얇다는 것은 "무엇으로 만들어도 된다"가 아니라 **"무엇으로 만들든 이득이 작다"**는 뜻이다. 이득이 작을 때는 이미 사전조사가 끝나고 우리 검증 자산과 엔진이 일치하는 쪽을 고른다 — **Electron**. 대신 셸 표면을 작게 유지해 나중에 마음이 바뀔 권리를 남긴다.
