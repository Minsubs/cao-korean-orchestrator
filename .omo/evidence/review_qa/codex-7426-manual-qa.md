# cao-7426 manual QA re-review

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| live-health | SC-1/SC-7 | HTTP | `curl -i --max-time 10 http://127.0.0.1:9889/health` | PASS — HTTP 200 and CAO component ok | `rereview-transcript` |
| live-codex-team | SC-1 | HTTP + tmux-backed session | `curl -sS http://127.0.0.1:9889/sessions/cao-7426da03`; parent/worker output endpoints | PASS — worker `2bd9e73e` has caller `53c5e264`; parent output reaches `UI_PROVENANCE_VERIFIED` only after callback 20 | `rereview-transcript` |
| callback-provenance | SC-1/SC-3 | HTTP inbox + terminal output | `curl .../terminals/53c5e264/inbox/messages?limit=50&after_id=0` and `curl .../output?mode=full` | PASS — callback sender is the direct worker and callback id 20 follows sent message 19; final text follows it | `rereview-transcript` |
| cursor-filter | SC-5/SC-7 | HTTP | `curl .../inbox/messages?limit=50&after_id=19` | PASS — only id 20 is returned | `rereview-transcript` |
| frontend-regression | SC-2/SC-3/SC-4 | CLI test runner | `npm test -- --run src/test/session-chat.test.tsx src/test/workspace-session-completion.test.ts src/test/workspace.test.tsx` | PASS — 39 tests passed | `rereview-transcript` |
| backend-regression | SC-2/SC-4/SC-5/SC-6 | CLI test runner | focused pytest command in transcript | PASS — 434 tests passed | `rereview-transcript` |
| latest-bundle | SC-6/SC-7 | CLI build | `npm run build` | PASS — TypeScript and Vite production build completed | `rereview-transcript` |
| browser-ui | SC-1/SC-6 | Browser UI | Chrome tab `http://127.0.0.1:9889/`, fresh DOM snapshot after reload | PASS — current UI shows session/parent/worker completed, worker parent label, agent count 3, recipient selector, and empty composer disabled; no interaction performed | `rereview-transcript`, `browser-transcript` |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| no-callback-interim | SC-2/SC-3 | missing callback / worker processing | receipt/interim output remains pending while worker is processing and no delivered callback exists | PASS — completion unit and component regression keep composer disabled | `rereview-transcript` |
| wrong-sender-callback | SC-3 | callback provenance | unrelated sender must not unlock direct-child callback completion | PASS — completion tests require delivered callback sender to match direct child | `rereview-transcript` |
| restored-baseline | SC-4 | restart/persistence | restored pending turn retains generation and inbox baselines; old worker is not treated as current | PASS — `restores the exact pending turn baselines` test passed | `rereview-transcript` |
| inbox-limit-zero | SC-5/SC-7 | invalid query boundary | limit 0 must be rejected, not interpreted as unlimited | PASS — HTTP 422 ge=1 | `rereview-transcript` |
| unknown-session | SC-7 | unknown resource | unknown session returns 404 with no mutation | PASS — HTTP 404 | `rereview-transcript` |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| rereview-transcript | terminal transcript | Current live HTTP probes, callback ordering, targeted tests, and build output | `.omo/evidence/review_qa/codex-7426-rereview-evidence.txt` |
| browser-transcript | browser transcript | Existing live browser DOM, console, desktop/mobile layout evidence | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |

## verdict

PASS. Current implementation satisfies the callback sender/cursor, persisted baseline, status-gating, MCP, and bundle checks exercised here. The only non-failing diagnostic is jsdom's known xterm canvas warning.

## competitive-fix recheck

PASS. Latest changes covering Workspace pending remount persistence, interim-output suppression, sequential double-snapshot completion, and rendered-generation straddle passed 52 focused frontend tests and 67 focused backend tests. Production TypeScript/Vite build and `git diff --check` also passed. Live session remained untouched and all three terminals stayed completed at generation 0/0.

## final raw-detection straddle recheck

PASS. `test/services/test_status_monitor.py` passed 35/35. The suite now directly covers raw fresh detection racing with `notify_input_sent`, rendered capture racing with a new generation, idle-frame non-finality, rendered probe coalescing, and input/ready generation bookkeeping. No live session mutation was performed.

## final event-driven/persistence recheck

PASS. Latest frontend tests passed 53/53, covering pending persistence before `sendInput` resolves, unresolved-request unmount/remount recovery, stored `lastOutput` restoration, Workspace remount retention, and completion snapshot races. Latest status-monitor tests passed 36/36, covering generation pinning for both event-driven raw and screen detection. Production build passed; live session remained unchanged at completed generation 0/0.

## final Herdr/Codex callback recheck

PASS. Status-monitor tests passed 38/38, including native Herdr `get_status` lifecycle and straddle protection. Workspace completion tests passed 41/41, including callback sender provenance and semantic ready-generation proof for an idle delegated worker. Live read-only session evidence shows direct worker `2bd9e73e` idle with `input_generation=1`, `ready_generation=1`, caller `53c5e264`; delivered callbacks 20/22 precede parent `LATEST_ORCHESTRATION_VERIFIED`. QA sent no input.

## zero-generation gap recheck

FAIL. The new frontend regression currently fails: with a newly discovered direct child at `idle`, `input_generation=0`, `ready_generation=0`, and a delivered callback, `isOrchestrationReplyReady` returns `true` but the test requires `false`. The companion `1/1` case passes, and status-monitor remains 38/38. This indicates baseline-undefined descendants are still omitted from the direct-child readiness check instead of requiring input generation advancement.

## zero-generation gap fix recheck (supersedes prior FAIL)

PASS. After the fix, the completion suite passed 18/18 and the combined Workspace/session/completion suite passed 42/42. The newly discovered idle child is correctly rejected at `0/0` and accepted at `1/1`; status-monitor remains 38/38 and the production frontend build passes. The prior FAIL above is historical and superseded by this recheck.
