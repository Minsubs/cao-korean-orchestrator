# Phase 6c-프런트 스펙 — 도구및확장 "소스"·"환경 프로필" 탭 구현

두 탭은 현재 ToolingView에 `active:false` placeholder. 이번에 실데이터 기반으로 활성화한다. 가짜 데이터/빈 성공 화면 금지 — 없으면 "없음"을 정직하게.

## 소유권
- 수정: `web/src/features/tooling/**`(ToolingView 탭 활성화, 신규 SourcesPane.tsx·EnvProfilesPane.tsx 등), `web/src/api.tooling.ts`(타입·fetcher 추가), `web/src/test/**`(신규 테스트 파일 — 기존 파일 수정은 tooling 관련만)
- 금지: web/src/features/{workspace,profiles,flows,command-palette}(병렬 에이전트/메인 소유), web/src/app/**, web/src/components/**, api.ts, api.profiles.ts, api.ui.ts, 백엔드 전체, 커밋
- 참고: 병렬로 다른 에이전트가 features/workspace를 작업 중 — npm test에서 workspace 테스트가 일시적으로 흔들리면 보고에만 적고 내 소유 파일에 집중(내 탭 테스트는 반드시 초록).

## A. 소스 탭 (SourcesPane)
백엔드 계약(병렬 Opus가 구현 중 — **완성 전까지 fetch 실패를 정직한 에러 상태로**, 기존 ToolingView의 "Tooling API에 연결할 수 없어요" 패턴 재사용):
`GET /tooling/sources` →
```ts
interface ToolingSources {
  directory_sources: { path: string; scope?: 'store'|'user'; cli?: string; kind: string; count: number; exists: boolean }[]
  catalog: { count: number; kinds: Record<string, number>; origin: string; note: string }
  marketplaces: Record<string, { supported: boolean; items: {name: string; source?: string}[] | null; reason: string | null; manage_hint?: string }>
}
```
UI(파스텔 카드 스타일, 기존 EnvironmentPane 관례 따름):
1. **디렉터리 소스** 섹션: 카드/행 — 경로(모노), kind 배지(스킬/명령/프롬프트/에이전트), 개수, exists:false면 "아직 없어요" 흐림 처리. cli 필드 있으면 provider 아이콘/라벨.
2. **큐레이션 카탈로그** 카드: 개수 + kind 분포 칩 + note 문구 + "탐색 탭에서 보기" 버튼(onNavigate 탭 전환 — ToolingView 내부 탭 state 사용).
3. **마켓플레이스** 섹션(claude 등 키 있는 것만): supported면 items 목록(name+source), 아니면 reason 표시. manage_hint는 복사 버튼 달린 명령으로("여기서 직접 추가/삭제는 아직 지원하지 않아요 — 명령을 복사해 실행하세요" 정직 고지).
4. 새로고침 버튼(재fetch).

## B. 환경 프로필 탭 (EnvProfilesPane) — 백엔드 신규 없음, 전부 기존 실API 조합
개념: 현재 머신의 도구 환경 스냅샷을 만들고(export), 다른 머신에서 가져와(import) 차이를 본다(회사 Windows/WSL ↔ 개인 mac 시나리오).
1. **스냅샷 생성**: 버튼 1개 → 병렬 fetch: GET /tooling/environment, /tooling/extensions, /agents/profiles, /env/inventory?cli=all → 조립:
```ts
interface EnvSnapshot {
  schema: 'cao-env-profile/v1'
  captured_at: string  // ISO
  label: string        // 사용자 입력(기본: 날짜)
  environment: unknown // /tooling/environment 원본
  extensions_summary: { kind: string; name: string; scope?: string }[]  // 이름만(내용/경로 미포함)
  agent_profiles: { name: string; provider: string|null; model: string|null }[]
  inventory_counts: Record<string, Record<string, number>>  // cli→kind→count
}
```
  민감정보 주의: 절대 파일 내용/토큰을 넣지 말 것(이름·버전·개수만).
2. **저장 목록**: localStorage `cao:env-profiles:v1` (배열). 카드: label, captured_at, CLI 버전 요약 칩. 삭제 버튼. "이 브라우저에만 저장돼요" 고지.
3. **내보내기**: JSON 파일 다운로드(`cao-env-<label>.json`). **가져오기**: 파일 선택(input type=file) 또는 붙여넣기 textarea → schema 필드 검증(불일치 시 "cao-env-profile/v1 형식이 아니에요").
4. **비교**: 스냅샷 선택(저장 목록 또는 방금 가져온 것) vs **현재 라이브 환경**(비교 시점에 재fetch) → 차이 테이블:
   - CLI 버전 드리프트: 같은 CLI의 버전 다름(양쪽 버전 표시)
   - 스냅샷에만 있는 것 / 현재에만 있는 것: CLI(미설치), 에이전트 프로필(이름 기준), 확장(이름 기준), inventory 카운트 차
   - 차이 없음이면 "차이가 없어요 ✨" — 빈 테이블 뼈대 금지
   - 액션은 안내만: "설치는 탐색 탭에서, 프로필은 에이전트 프로필 화면에서" (가짜 원클릭 동기화 버튼 금지)
5. 스냅샷 생성/비교 중 로딩 상태, 부분 fetch 실패 시 해당 섹션 결측 정직 표기(예: "/env/inventory 조회 실패 — 이 항목 제외").

## C. ToolingView 탭 활성화
- TABS의 sources/envprofiles `active: true`로, 각 Pane 연결. 기존 탭 회귀 금지.
- (기존 계약 잔무) DiscoverPane: 카탈로그 신규 `kind:'cli'` 항목 + method:'manual' 항목이 미감지 상태에서도 command/reason을 노출함 — 렌더링이 이를 자연스럽게 표시하는지 확인하고 필요시 보강(수동 설치 항목은 설치 버튼 대신 명령 복사+reason).

## 테스트 (vitest, 기존 tooling.test 패턴)
- Sources: fetch 성공 렌더(디렉터리/카탈로그/마켓플레이스 3섹션), exists:false 표시, marketplace supported:false reason 표시, API 실패 에러 상태
- EnvProfiles: 스냅샷 조립(각 API mock)→localStorage 저장, export 파일명, import 스키마 검증 실패 메시지, 비교 diff 계산(버전 드리프트+프로필 누락 — 순수함수로 분리해 단위테스트: envProfileDiff.ts), "차이 없음" 상태
- DiscoverPane kind:'cli' 스냅샷 1건

## 게이트: cd web && npx tsc --noEmit && npm test && npm run build — 내 소유 테스트 전부 초록, 기존 tooling 테스트 회귀 0
## 보고(간결): 두 탭 화면 구성 요약, diff 규칙, 스냅샷 스키마, 게이트 결과
