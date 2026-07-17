# 사용량(Usage) 백엔드 스펙 — AI 계정별 토큰 사용량 집계 API

목적: TopBar 알림 옆 "사용량" 위젯이 소비할 읽기 전용 API. 로컬 CLI들이 남기는 **실측 데이터만** 집계한다(가짜 숫자·요금 추정 금지).

## 소유권
- 신규만: `src/cli_agent_orchestrator/api/usage_router.py`(자기완결 APIRouter prefix="/usage" — **main.py include 금지**, 통합 시 메인이), `src/cli_agent_orchestrator/services/usage/`(claude_transcripts.py, codex_rollouts.py, __init__.py), `test/api/test_usage_router.py`, `test/services/test_usage_*.py`
- import만: security.auth(require_any_scope — security.auth 경로에서!), 표준 라이브러리
- 금지: 기존 파일 일체 수정(main.py, tooling, providers, web), 커밋

## 데이터 소스 (이 머신에서 실측 확인된 형식)

### claude_code — `~/.claude/projects/**/*.jsonl`
assistant 이벤트 라인에:
```json
"message":{"id":"msg_...","model":"claude-...","usage":{"input_tokens":131,"cache_creation_input_tokens":1120,"cache_read_input_tokens":512658,"output_tokens":2252,...}}
```
- 라인 단위 스트리밍 파싱: `"usage"` 문자열이 없는 라인은 json.loads 전에 스킵(성능).
- **디듑 필수**: 같은 응답이 여러 라인에 반복될 수 있음 — `(message.id, requestId)` 쌍으로 유니크 처리(requestId는 라인 톱레벨에 있음; 없으면 message.id만).
- 집계: 오늘(로컬 타임존 자정 기준)과 최근 7일. 각 {input, output, cache_read, cache_creation, total}. 모델별 오늘 합계 top 5.
- 파일 필터: mtime 8일 이내 파일만. 손상 라인은 스킵(카운트만 diagnostics).

### codex — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
`token_count` 이벤트:
```json
{"type":"event_msg"(또는 유사),"payload"|...:{"type":"token_count","info":{"total_token_usage":{"input_tokens":20062,"cached_input_tokens":9984,"output_tokens":19,"reasoning_output_tokens":0,"total_tokens":20081},"last_token_usage":{...},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":27.0,"window_minutes":10080,"resets_at":1784780187},"secondary":null,"credits":{...},"plan_type":"prolite",...}}}
```
- 실제 라인 구조는 파일에서 관찰해 확정하라(위는 grep 발췌). `"token_count"` 포함 라인만 파싱.
- 세션 파일당 **마지막** total_token_usage = 그 세션의 누적 → 날짜 디렉터리(오늘/최근 7일)의 세션들을 합산.
- **rate_limits**: 모든 파일 중 가장 최근 이벤트의 스냅샷 1개를 그대로 노출(plan_type, primary/secondary used_percent·window_minutes·resets_at, captured_at=파일 mtime 또는 이벤트 시각). 이건 OpenAI가 내려준 실측 계정 한도다 — 가공하지 말 것.

### antigravity — v1 제외
`~/.gemini/`에 사용량 로그 형식 미확인 → 응답에 넣지 않는다(빈 껍데기 금지). 보고에만 "미확인" 명시.

## 엔드포인트 — GET /usage/accounts  (READ|WRITE|ADMIN)
```json
{"accounts":[
  {"provider":"claude_code","present":true,"source":"transcripts",
   "today":{"input":0,"output":0,"cache_read":0,"cache_creation":0,"total":0},
   "week":{...같은 형},"by_model_today":[{"model":"...","total":0}],
   "rate_limits":null,"last_activity":"ISO|null",
   "note":"로컬 트랜스크립트 합산 추정치 — CLI 자체 집계와 다를 수 있어요"},
  {"provider":"codex","present":true,"source":"rollouts",
   "today":{...},"week":{...},"by_model_today":[],
   "rate_limits":{"plan":"prolite","primary":{"used_percent":27.0,"window_minutes":10080,"resets_at":1784780187},"secondary":null,"captured_at":"ISO"},
   "last_activity":"ISO","note":"..."}
],"scanned_at":"ISO"}
```
- 디렉터리 자체가 없으면 해당 provider `present:false` + note(파일 경로 안내), 숫자 필드 null.
- total = input+output+cache_creation+cache_read... 아니다 — **total은 CLI 의미를 따르라**: claude는 4필드 합, codex는 이벤트의 total_tokens 그대로. 필드별 의미를 응답 그대로 두고 합성값 최소화.
- 비용($) 계산 **금지**(단가표 하드코딩은 시효성 문제) — 토큰·퍼센트만.

## 성능 (필수)
- 서버 인메모리 캐시 TTL 60s(전체 응답).
- 파일 단위 증분 memo: {path: (mtime, size, 집계결과)} — 변경 없으면 재파싱 금지. claude jsonl은 수십 MB 가능.
- 스캔 상한: 파일 400개/프로바이더, 초과 시 최신 mtime 순 400개 + 응답 note에 "일부 파일 생략" 명시.

## 테스트
tmp_path 홈 모킹: claude 디듑(중복 requestId), 날짜 경계(오늘/7일 밖 제외), 모델별 집계, 손상 라인 스킵 / codex 세션 누적=마지막 이벤트, 여러 세션 합산, rate_limits 최신 스냅샷 선택, 디렉터리 부재 present:false / 캐시 TTL·증분 memo / 라우터: 자체 앱 include(test_ui_features_router.py 스타일), 스코프 게이트.

## 게이트
black/isort --check + mypy(신규 파일) + `PYTHONPATH=src uv run --no-sync pytest test/ -q --no-cov -m 'not e2e' --ignore=test/e2e --ignore=test/providers/test_kiro_cli_integration.py` 회귀 0. **반드시 --no-sync**(맨 uv run은 .venv hidden 플래그 재발로 MCP를 깨뜨림 — 실증된 사고). 커밋 금지. 병렬 에이전트들의 변경(web/** 등) 절대 건드리지 말 것.

## 보고(간결): 응답 실예시(이 머신 실데이터로 1회 호출 결과 — 서버 말고 함수 직접 호출로), 파서가 처리/스킵하는 라인 규칙, 게이트 결과

## 델타 (사용자 확정 — Claude 한도 실측 옵트인, 구현 필요)
- `GET /usage/accounts`에 `claude_limits: bool = False` 쿼리 파라미터. true면 claude_code 항목 rate_limits 채움:
  - 토큰(읽기 전용): ① `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w` (argv, shell=False) → JSON claudeAiOauth.accessToken ② 폴백 ~/.claude/.credentials.json. **refreshToken 사용/저장/전송 절대 금지.** expiresAt 지났으면 조회 없이 note "토큰이 만료됐어요 — Claude Code를 한 번 실행하면 갱신돼요".
  - GET https://api.anthropic.com/api/oauth/usage (호스트 하드코딩, 그 외 아웃바운드 금지), Authorization: Bearer, 헤더 anthropic-beta: oauth-2025-04-20, timeout 10s. five_hour/seven_day류 {utilization, resets_at} → primary(window_minutes:300)/secondary(10080) 매핑. 미인식 형식→rate_limits null+정직 note. plan은 credentials subscriptionType.
  - 토큰은 로그·에러문자열·응답 어디에도 노출 금지. TTL 120s 별도 캐시. false 기본 동작 불변.
  - 테스트: Keychain mock/파일 폴백/만료/응답 매핑/미인식/네트워크 실패/토큰 미노출/기본 동작 불변.
