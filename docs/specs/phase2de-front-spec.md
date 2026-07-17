# Phase 2d+2e 프런트 스펙 — 컨텍스트 게이지 UI · 컴포저 슬래시 자동완성

백엔드 계약은 확정·구현 완료(라우터는 main 통합 시 mount됨). 이 배치는 5.5-B가 끝난 뒤 실행 — B가 만든 최신 파일 상태를 먼저 읽고 작업할 것.

## 소유권
- 수정: web/src/features/workspace/** (Composer.tsx, Workbench.tsx, AgentSidePanel.tsx, useWorkspaceAlerts.ts 등), web/src/api.ui.ts(fetcher 추가), web/src/test/**
- 금지: web/src/app/AppShell.tsx, api.tooling.ts, api.profiles.ts, features/{tooling,profiles,flows,command-palette}, components/**(NotificationCenter 포함 — 알림은 workspace 알림 경로 사용), 백엔드 전체, 커밋

## 백엔드 계약 (구현 완료, /ui prefix)
1. `GET /ui/terminals/{terminal_id}/context` → `{terminal_id, percent_left: number|null, source:"footer", checked_at}`
   - **percent_left = 잔량 %** (높을수록 여유). `null`이면 게이지 렌더 금지(0%와 구분 — 숨김). 404 = 터미널 없음.
   - 표시 전용 — 오케스트레이션/자동 동작 금지 (auto-/compact 전송 금지).
2. `GET /ui/slash-commands?provider=<claude_code|codex>&cwd=<path>` → `{provider, cwd, commands:[{name:"/x", scope:"builtin"|"user"|"project", kind:"command"|"skill", description:string|null, interactive:boolean}]}`
   - 그 외 provider는 400 → 자동완성 기능 자체를 숨김(에러 토스트 금지). 같은 이름이 scope 다르게 중복 가능 → 그대로 나열(scope 배지로 구분).

## 2d — 컨텍스트 게이지
- api.ui.ts에 `getTerminalContext(terminalId)` 추가.
- 표시 지점: Workbench의 컨텍스트 터미널 헤더 + AgentSidePanel 터미널(에이전트) 행. 작은 칩/미니 바: `잔여 42%`.
  - 색: ≥50 안전(파스텔 그린), 20–49 주의(앰버), <20 경고(레드) — 기존 토큰 팔레트 사용, 하드코딩 색상 금지.
  - percent_left null → 아무것도 렌더하지 않음(자리 차지 X). provider가 claude_code가 아니면 호출 자체를 생략해도 됨(백엔드가 null 주므로 통일 처리도 허용).
- 폴링: 보이는(선택된 세션의) 터미널만, 20s 간격 + 터미널 상태가 processing→idle 전환 시 1회 즉시. 언마운트/세션 전환 시 타이머 정리.
- 저컨텍스트 알림: percent_left가 **15 미만으로 하강 교차**할 때 workspace 알림 경로(useWorkspaceAlerts 계열)에 1건 추가 — 문구 예: `⚠️ {터미널이름} 컨텍스트 부족 (12%) — /compact 를 고려하세요`. 
  - 디바운스: 터미널당 1회, 25 이상으로 회복하면 재무장. 알림 클릭 동작은 기존 알림과 동일(세션 이동 시임 재사용 가능하면 사용).
  - 자동 /compact 전송 등 어떤 자동 동작도 금지 — 알림+표시만.

## 2e — 컴포저 슬래시 자동완성
- api.ui.ts에 `getSlashCommands(provider, cwd?)` 추가. 클라 캐시 30s (provider+cwd 키) — 서버도 30s 캐시지만 타이핑마다 fetch 금지.
- Composer.tsx: 입력값이 `/`로 시작하면 드롭다운(입력창 위 팝오버) 오픈.
  - 목록 소스: 현재 컨텍스트 터미널의 provider + 세션 working_directory(cwd). provider가 claude_code/codex 외면 기능 비활성(드롭다운 안 뜸).
  - 필터: `/` 뒤 타이핑 텍스트로 startsWith→includes 순 정렬. 항목 UI: 이름(모노) + scope 배지(내장/사용자/프로젝트) + kind가 skill이면 `스킬` 배지 + description(회색, 1줄 말줄임).
  - `interactive:true` 항목은 `터미널 대화형` 배지 — 선택은 가능(어차피 터미널로 send됨).
  - 키보드: ↑↓ 이동, Enter/Tab 선택(입력창에 `/이름 ` 삽입), Esc 닫기. Enter는 드롭다운 열려있을 때만 선택으로 소비(닫혀있으면 기존 전송 동작 유지 — 회귀 금지!).
  - 마우스 클릭 선택 지원. 드롭다운 열림 상태에서 blur 시 닫기.
- 전송 자체는 기존 경로 그대로(슬래시 명령도 일반 텍스트로 send — 백엔드가 이미 pass-through).

## 테스트 (vitest)
- 게이지: null→미렌더 / 값별 색 버킷 / 하강 교차 알림 1회+재무장 (pure 로직 분리 권장: contextGauge.ts)
- 슬래시: `/` 입력 시 오픈, 필터링, Enter 선택 삽입, 드롭다운 닫힘 상태 Enter는 전송 유지, 미지원 provider 비활성
- fetch mock은 기존 테스트 패턴 재사용

## 게이트: cd web && npx tsc --noEmit && npm test && npm run build (마지막 1회)
## 보고(간결): 표시 지점 스크린 설명, 알림 디바운스 규칙, 슬래시 UX 키맵, 게이트 결과
