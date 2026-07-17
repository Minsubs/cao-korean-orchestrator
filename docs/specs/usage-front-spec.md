# 사용량(Usage) 프런트 스펙 — TopBar 알림 옆 AI 계정 사용량 위젯

## 소유권
- 신규만: `web/src/features/usage/`(UsageButton.tsx, UsagePopover.tsx, formatTokens.ts 등), `web/src/api.usage.ts`, `web/src/test/usage.test.tsx`
- 금지: web/src/app/**(TopBar 배선은 메인이 1줄로 함 — UsageButton을 export만 해두면 됨), components/**, features/{workspace,tooling,profiles,flows,command-palette}, api.ts·api.tooling.ts·api.profiles.ts·api.ui.ts, 백엔드, 커밋

## 백엔드 계약 (병렬 Opus 구현 중 — fetch 실패는 정직한 에러 상태로)
`GET /usage/accounts` →
```ts
interface UsageBucket { input: number; output: number; cache_read: number; cache_creation: number; total: number }
interface UsageAccount {
  provider: string            // 'claude_code' | 'codex' | ...
  present: boolean
  source: string
  today: UsageBucket | null
  week: UsageBucket | null
  by_model_today: { model: string; total: number }[]
  rate_limits: null | {
    plan: string | null
    primary: { used_percent: number; window_minutes: number; resets_at: number } | null
    secondary: { used_percent: number; window_minutes: number; resets_at: number } | null
    captured_at: string
  }
  last_activity: string | null
  note: string
}
interface UsageAccountsResponse { accounts: UsageAccount[]; scanned_at: string }
```

## UI
1. **UsageButton** (TopBar용으로 export — 배선은 메인): 알림 벨과 같은 스타일의 아이콘 버튼(lucide `Gauge` 또는 `Activity`), aria-label "AI 사용량".
   - 요약 배지: rate_limits.primary가 있는 계정 중 최고 used_percent를 작은 숫자로 표시(예: `27%`) — 데이터 없으면 배지 없이 아이콘만. 80% 이상이면 경고색 토큰.
2. **UsagePopover** (버튼 클릭 → 우측 정렬 팝오버, ESC/외부 클릭 닫힘, role="dialog"):
   - 계정 카드 per provider(present:true만; 전부 없으면 "표시할 사용량 데이터가 없어요 — CLI를 한 번 이상 사용하면 생겨요"):
     - 헤더: provider 표시명 + plan 칩(있으면, 예: prolite)
     - **rate limit 진행바**(codex처럼 있으면): primary used_percent 진행바 + "주간 한도 27% 사용" (window_minutes 10080→"주간", 300→"5시간" 등 사람 말로) + resets_at 상대 시각("3일 후 리셋"). secondary 있으면 한 줄 더. **실측값 그대로 — 반올림 소수1자리**.
     - 토큰 요약: 오늘 total(축약: 1.2M, 534K) + 상세 툴팁(입력/출력/캐시) / 이번 주 total. by_model_today 칩(최대 3개).
     - last_activity 상대시각, note는 작은 회색 글씨(정직 고지).
   - 푸터: scanned_at + 새로고침 버튼. 열려 있는 동안 60초 자동 갱신(닫히면 타이머 정리).
3. 로딩 스켈레톤/에러 상태("사용량 API에 연결할 수 없어요") — 기존 패턴 재사용.
4. 파스텔 카드·디자인 토큰(var(--…)) 준수, 하드코딩 색 금지, 한국어 카피.

## 테스트 (vitest, fetch mock)
- 응답 렌더: codex 진행바 %·plan 칩·리셋 상대시각, claude 토큰 축약 표기
- present:false 계정 미표시 / 전부 없음 빈 상태
- 배지: 최대 used_percent 표시, 80%+ 경고 클래스, rate_limits 없으면 배지 없음
- window_minutes → 라벨 변환(10080=주간, 300=5시간) 순수함수 단위테스트(formatTokens.ts에 같이)
- API 실패 에러 상태
- 자동 갱신 타이머 정리(unmount 후 fetch 미호출)

## 게이트: cd web && npx tsc --noEmit && npm test && npm run build — 내 소유 테스트 전부 초록, 기존 회귀 0(병렬 에이전트 작업 중인 workspace/tooling 테스트가 흔들리면 보고에만 기록)
## 보고(간결): 컴포넌트 구성, 배지 규칙, 메인이 할 TopBar 배선 1줄 안내, 게이트 결과

## 델타 (사용자 확정 — 한도가 주 표시)
- 카드 주 표시 = 한도 진행바(rate_limits 있으면). 토큰 합계는 보조 줄로 격하(제거 금지).
- Claude 한도 옵트인 토글: rate_limits null + 옵트인 off면 카드에 스위치("한도 실측 조회" + "저장된 Claude 로그인 토큰으로 Anthropic 사용량 API를 조회해요 — 토큰은 이 머신에서 Anthropic으로만 전송돼요"). localStorage `cao:usage:claude-limits-optin:v1` 기본 false. on이면 `?claude_limits=true`로 fetch.
- 백엔드 note는 그대로 카드에 표시(가짜 게이지 금지). 배지 규칙에 claude도 참여.
- 테스트: 토글→쿼리 변화, off 시 토글 노출, claude 5시간/주간 두 바 렌더, note 표시.
