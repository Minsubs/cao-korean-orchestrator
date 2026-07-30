# Phase 5/6 잔여 — 라이브 검증 (2026-07-30)

브랜치 `phase5-6-remainder` (PR #11). 서버 `127.0.0.1:9889`, 번들 `index-D738Qmov.js`,
`CAO_HOME_DIR=/home/minsub57/.local/share/cao-home`.

## 1. 프로필 디렉터리 실제 경로 (Phase 5)

수정 전 `GET /settings/agent-dirs` 는 `~/.aws/cli-agent-orchestrator/...` 를 반환했고 그 경로는
디스크에 **존재하지 않았다**. 실제 프로필이 있는 `cao-home/agent-store` 는 목록에 없었다.

수정 후 실측:

```
codex        → /home/minsub57/.local/share/cao-home/agent-store
cao_installed → /home/minsub57/.local/share/cao-home/agent-context
claude_code  → /home/minsub57/.claude/agents      (의도적 불변)
kiro_cli     → /home/minsub57/.kiro/agents
```

원인은 파생 중복이었다. `settings_service._DEFAULTS` 가 경로를 직접 만들면서
`constants.LOCAL_AGENT_STORE_DIR` / `AGENT_CONTEXT_DIR`(이미 override 반영)과 별개로 존재했고,
`CAO_HOME_DIR` 이 설정된 환경에서 둘이 갈라졌다. 이제 constants 를 import 해 파생이 한 곳이다.

부수적으로 `_DEFAULTS`(module-level dict) → `_defaults()`(read-time 계산)로 바꿨다. import 시점에
얼려두면 override 가 반영되지 않고 테스트도 검증할 수 없다.

## 2. 재연결 상태 구분 (Phase 5)

`eventsClient` 의 자동 재연결(backoff 1s→30s)은 **이미 구현돼 있었다.** 없던 것은 UI 구분이다.
`Thread`/`Composer` 가 `connecting` 과 `disconnected` 를 같은 문구로 합쳤다.

라이브 시나리오:

| 단계 | 상단 표시기 |
|---|---|
| 정상 | `이벤트 연결됨` |
| `pkill -9 cao-server` | `이벤트 끊김` |
| 서버 재기동 후 (수동 새로고침 **없이**) | `이벤트 연결됨` |

Phase 5 수용 기준의 핵심("서버 재시작 후 UI가 자동 재연결")이 실증됐다.

### 검증 중 뒤집힌 가설 하나 (기록 목적)

SIGTERM(`pkill -f cao-server`)만으로 죽였을 때 표시가 12초 넘게 `이벤트 연결됨` 을 유지했다.
처음엔 표시기가 거짓말한다고 의심했다. 확인해 보니:

- `ss -ltn` → 포트 9889 **CLOSED**
- `pgrep` → 프로세스 **ALIVE**

uvicorn 이 브라우저의 열린 SSE 스트림 때문에 graceful shutdown 대기 중이었다. 즉 **스트림은
실제로 아직 연결돼 있었고 표시가 정확했다.** listener 만 닫혀 신규 요청이 실패해 console error 가
쌓였을 뿐이다. SIGKILL 로 진짜 단절을 만들면 즉시 `이벤트 끊김` 으로 전환된다.

교훈: "표시가 틀렸다"고 결론 내리기 전에 대상이 정말 죽었는지 확인해야 한다.

### 미검증

`Thread`/`Composer` 의 재연결 **배너 자체**는 실화면으로 보지 못했다. `Workspace` 는 세션
미선택 시 두 컴포넌트를 렌더하지 않고, 이 박스엔 활성 세션이 0개였다(직전 검증 후 정리함).
단위 테스트 `web/src/test/stream-reconnect-copy.test.tsx` 5건이 세 상태를 각각 고정한다.

## 3. 프로필 ID 노출 제거 (Phase 6)

새 작업 모달의 오케스트레이터 카드가 `codex_orchestrator_sol` /
`claude_orchestrator_sonnet` / `antigravity_orchestrator_agy` 를 monospace 로 노출했다.

수정 후 실측: 모달 DOM 에서 세 ID 전부 **0건**. 대신 모델명이 표시된다 —
`gpt-5.6-sol` / `sonnet` / `Gemini 3.1 Pro (High)`. 캡처
`orchestrator-cards-no-raw-ids.png` 참조.

카드 제목이 이미 provider 이므로 모델만 남기면 중복이 없고, 모델을 모르면 placeholder 대신
아무것도 표시하지 않는다. 프로필 미설치 시의 `프로필 설치 필요` 는 유지했다(이 박스는 3개 모두
설치돼 있어 해당 분기는 단위 테스트로만 덮인다).

## 게이트

- `tsc --noEmit` 0 error
- `npm test` **548/548** (71 파일)
- `node design-tokens/gen.mjs --check` 통과
- backend `test/services/test_settings_service.py` **38/38**
- `black --check` / `isort --check-only` 통과 (469 files)

## 남은 Phase 6 항목

1. **알림 배지 읽음/초기화 동선** — 미착수. `NotificationCenter.tsx` 에 `alert.read` 플래그와
   `unreadCount` 는 있으나 읽음 처리·초기화 동작이 없어 배지가 줄지 않는다. 저장 키는
   `cao:notifications:history:v1`. 데이터 계층에 setter 가 이미 있는지 조사가 선행이다.
2. **로딩 문구 통일** — 조사 완료, 미적용. 패턴 자체(`Loader2` + `animate-spin` + `불러오는 중`)는
   12개 파일에서 이미 일관되다. 실제 outlier 는 두 종류다.
   - 줄임표 혼용: `불러오는 중...`(ASCII 3점, 4곳) vs `불러오는 중…`(U+2026, 2곳),
     `처리 중...`(2곳) vs `처리 중…`(1곳)
   - 어미 혼용: 프로젝트 UI 목소리는 해요체인데 `메모리를 불러오지 못했습니다` /
     `설정을 불러오지 못했습니다` / `최근 오케스트레이터 출력을 불러오지 못했습니다.` 가 섞임
   다수 파일의 문자열을 건드리므로 별건으로 분리했다. `SessionChatPanel` 의 옛 문구는 클래식
   경로로 의도적으로 보존되는 파일이라 동기화 여부를 먼저 판단해야 한다.
