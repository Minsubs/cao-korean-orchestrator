# Usage API + TopBar manual QA

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| api-health | backend availability | HTTP | `curl -i --max-time 5 http://127.0.0.1:9889/health` | PASS — HTTP 200 and `status:ok` | `curl-health` |
| usage-default | usage-backend-spec.md endpoint/default behavior | HTTP | `curl -i --max-time 15 http://127.0.0.1:9889/usage/accounts` | PASS — HTTP 200; both `claude_code` and `codex` present, token buckets/last_activity/scanned_at populated; Claude rate_limits is null by default | `curl-default` |
| usage-claude-limits | usage-backend-spec.md Claude opt-in delta | HTTP | `curl -i --max-time 15 'http://127.0.0.1:9889/usage/accounts?claude_limits=true'` | PASS — HTTP 200; Claude rate_limits populated and note states OAuth usage API measurement; no token value observed in response | `curl-limits` |
| usage-malformed-bool | FastAPI validation boundary | HTTP | `curl -i --max-time 15 'http://127.0.0.1:9889/usage/accounts?claude_limits=wat'` | PASS — HTTP 422 `bool_parsing`; malformed input rejected | `curl-malformed` |
| backend-targeted-tests | usage backend test gate | CLI | `PYTHONPATH=src uv run --no-sync python -m pytest test/api/test_usage_router.py test/services/test_usage_claude_limits.py test/services/test_usage_claude_transcripts.py test/services/test_usage_codex_rollouts.py -q --no-cov` | PASS — 12 passed (3 existing dependency deprecation warnings) | `pytest-targeted` |
| frontend-targeted-tests | usage-front-spec.md tests | CLI | `cd web && npm test -- --run src/test/usage.test.tsx` | PASS — 9 tests passed | `vitest-usage` |
| frontend-typecheck | usage-front-spec.md gate | CLI | `cd web && npm exec tsc -- --noEmit` | PASS — exit 0 | `tsc` |
| topbar-open | usage-front-spec.md button/popover anatomy | Browser UI | Vite `npm run dev -- --host 127.0.0.1`; open `http://127.0.0.1:5173/`; locate `button[aria-label="AI 사용량"]`; click once | PASS — unique button rendered in TopBar; opens unique `role=dialog` named `AI 계정 사용량` | `browser-topbar-open` |
| topbar-esc | usage-front-spec.md ESC close | Browser UI | With usage dialog open, press `Escape` on the unique AI 사용량 button | PASS — dialog count became 0 and `aria-expanded` became `false` | `browser-esc` |
| topbar-data-render | usage-front-spec.md account-card/rate-limit rendering | Browser UI | Open production surface `http://127.0.0.1:9889/`; locate `button[aria-label="AI 사용량"]`; click once; wait 3s | PASS — Claude Code and Codex cards rendered with plan chips, measured 5-hour/weekly bars, relative reset times, compact today/week totals, model chips, notes, scanned timestamp, and refresh control. | `browser-production-cards` |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| malformed-query | usage-backend-spec.md | malformed boolean | Reject non-boolean query with 4xx, never silently enable opt-in | PASS — 422 bool_parsing | `curl-malformed` |
| opt-in-default-separation | usage-backend-spec.md delta | privacy/opt-in boundary | Default request leaves Claude rate_limits null; explicit true may populate | PASS — observed default null vs true populated; no credential/token output observed | `curl-default`, `curl-limits` |
| browser-api-block | usage-front-spec.md honest fetch failure | network/browser transport failure | Production UI should fetch same-origin `/usage/accounts`; dev origin should be treated as environment-specific if browser client blocks it | PASS — production origin rendered cards. Vite dev origin was blocked by Chrome client (`ERR_BLOCKED_BY_CLIENT`) while its curl proxy returned 200; not a production-surface defect. | `browser-production-cards`, `browser-loading-fail`, `browser-direct-api-block` |
| empty-present-filter | usage-front-spec.md | empty/present filtering | `present:false` providers hidden; all absent shows empty copy | PASS by automated usage.test coverage (not separately injectable against live data) | `vitest-usage` |
| claude-token-leak | usage-backend-spec.md | secret exposure | Access/refresh token must not appear in response or visible errors | PASS — inspected redacted curl output and browser surface; no credential value observed | `curl-limits` |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| curl-health | terminal transcript | `/health` HTTP response | `.omo/evidence/review_qa/usage-manual-qa.md` |
| curl-default | terminal transcript | default `/usage/accounts` response (secret-free summary) | `.omo/evidence/review_qa/usage-manual-qa.md` |
| curl-limits | terminal transcript | `claude_limits=true` response (secret-free summary) | `.omo/evidence/review_qa/usage-manual-qa.md` |
| curl-malformed | terminal transcript | malformed boolean 422 response | `.omo/evidence/review_qa/usage-manual-qa.md` |
| pytest-targeted | test report | 12 targeted backend tests passed | `.omo/evidence/review_qa/usage-manual-qa.md` |
| vitest-usage | test report | 9 usage UI tests passed | `.omo/evidence/review_qa/usage-manual-qa.md` |
| tsc | test report | TypeScript no-emit passed | `.omo/evidence/review_qa/usage-manual-qa.md` |
| browser-topbar-open | browser DOM transcript | TopBar button and dialog opened | `.omo/evidence/review_qa/usage-manual-qa.md` |
| browser-esc | browser DOM transcript | ESC closed dialog | `.omo/evidence/review_qa/usage-manual-qa.md` |
| browser-loading-fail | browser DOM transcript | dialog remained loading after wait | `.omo/evidence/review_qa/usage-manual-qa.md` |
| browser-direct-api-block | browser navigation transcript | direct proxied API blocked by Chrome client | `.omo/evidence/review_qa/usage-manual-qa.md` |
| browser-production-cards | browser DOM transcript | production 9889 origin rendered account cards and limits | `.omo/evidence/review_qa/usage-manual-qa.md` |
