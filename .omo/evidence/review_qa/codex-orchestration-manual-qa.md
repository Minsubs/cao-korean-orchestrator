# Codex-to-Codex orchestration and chat completion manual QA

Scope: live `http://127.0.0.1:9889`, session `cao-7426da03`; read-only inspection only. No prompts, permissions, terminal deletion, or external state changes were issued by QA.

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| p0-health | service availability | HTTP | `curl -i --max-time 10 http://127.0.0.1:9889/health` | PASS — HTTP 200, `status:ok`, tmux backend | `api-session-transcript` |
| p0-session-aggregate | settled aggregate state | HTTP | `curl -i http://127.0.0.1:9889/sessions` | PASS — one `cao-7426da03`, detached | `api-session-transcript` |
| p0-session-detail | terminal aggregate/status | HTTP | `curl -i http://127.0.0.1:9889/sessions/cao-7426da03` | PASS — 3 Codex terminals, all `completed` | `api-session-transcript` |
| p0-parent-child | worker-parent display | HTTP/UI | `curl /terminals/{id}` for 53c5e264 and 2bd9e73e; open app at `http://127.0.0.1:9889/` | PASS — worker `caller_id=53c5e264`; UI shows `상위: codex_orchestrator_sol` and `에이전트 3` | `api-terminal-transcript`, `browser-dom-transcript` |
| p0-callback-inbox | final callback evidence | HTTP | `curl /terminals/53c5e264/inbox/messages?limit=50` | PASS — delivered message id 14 contains `CONNECTIVITY_OK` and worker id | `api-terminal-transcript` |
| p0-final-response | final response after callback | tmux | `tmux capture-pane -pt cao-7426da03:codex_orchestrator_sol-f57e -S -80` | PASS — `CONNECTIVITY_VERIFIED` appears after callback; no further delegation needed | `tmux-transcript` |
| p0-composer-settled | composer after settled state | Browser UI | load app; inspect DOM after session polling settles | PASS — composer textbox and recipient selector rendered; session cards show 완료 | `browser-dom-transcript` |
| p1-no-interim-final | interim receipt does not close chat | tmux/output | `curl /terminals/cff2a1e5/output?mode=full` and parent tmux capture | PASS — transcript includes interim MCP/assign receipt, then callback and explicit final verification | `api-terminal-transcript`, `tmux-transcript` |
| p1-worker-output | worker output surface | HTTP | `curl /terminals/2bd9e73e/output?mode=full` | PASS — worker transcript includes assigned prompt, send_message call and `CONNECTIVITY_OK` | `api-terminal-transcript` |
| p1-inbox-status | delivered callback status | HTTP | `curl /terminals/53c5e264/inbox/messages?limit=50` | PASS — callback status is `delivered`, receiver is parent | `api-terminal-transcript` |
| p1-browser-console | runtime error boundary | Browser UI | `tab.dev.logs({levels:["error","warn"],limit:100})` | PASS — no console error/warn entries | `browser-console` |
| p1-responsive-desktop | desktop basic layout | Browser UI | `window.innerWidth/scrollWidth` at default Chrome viewport | PASS — 1512x828 viewport; body width 1512 (no horizontal overflow) | `browser-layout` |
| p1-responsive-mobile | mobile basic layout | Browser UI | set viewport 390x844, reload, inspect `window.innerWidth/scrollWidth` | PASS — body width 390 equals viewport; workspace controls remain present | `browser-mobile-layout` |
| p1-ui-status-badges | completion/status rendering | Browser UI | DOM snapshot after session polling | PASS — session row and all three agents show 완료; worker parent text visible | `browser-dom-transcript` |
| p1-targeted-frontend | chat/completion regression | CLI | `cd web && npm test -- --run src/test/session-chat.test.tsx src/test/workspace-session-completion.test.ts src/test/workspace.test.tsx src/test/workspace-reducer.test.ts src/test/workspace-composer-slash.test.ts` | PASS — 70 tests passed (canvas jsdom warning only) | `frontend-test-transcript` |
| p1-targeted-backend | status/callback regression | CLI | `PYTHONPATH=src uv run --no-sync python3 -m pytest test/services/test_status_monitor.py test/services/test_agent_step.py test/e2e/test_assign.py -q --no-cov` | PASS — 55 passed, 24 deselected | `backend-test-transcript` |
| p1-provider-unit | Codex/Claude MCP wiring regression | CLI | `PYTHONPATH=src uv run --no-sync python3 -m pytest test/providers/test_claude_code_unit.py -q --no-cov` | FAIL — 1 failure in bundled MCP command resolution; 131 passed | `provider-failure-transcript` |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| adv-unknown-session | session API contract | unknown resource | unknown session returns 404 without mutation | PASS — `/sessions/7426da03` returned 404 | `api-session-transcript` |
| adv-processing-gate | completion contract | processing/delegated worker | receipt/interim text must not mark final while worker processing | PASS by targeted completion tests (70 frontend; 55 backend) and live callback ordering | `frontend-test-transcript`, `backend-test-transcript`, `tmux-transcript` |
| adv-unknown-status | status normalization | unknown status | render safely as status-checking/unknown, never completed | PASS by `workspace-session-completion`/status-monitor tests | `frontend-test-transcript`, `backend-test-transcript` |
| adv-mcp-startup | provider boundary | dependency/startup failure | surface honest failure; do not claim verified callback | FAIL — live cff2a1e5 output reports `cao-mcp-server` handshake failure and earlier `cao session status --workers` showed zero workers; later historical callback evidence exists | `tmux-transcript`, `provider-failure-transcript` |
| adv-empty-inbox | callback absence | missing callback | remain pending/blocked rather than emit final | PASS by completion tests covering active delegated worker; no new prompt sent to live session | `frontend-test-transcript`, `backend-test-transcript` |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| api-session-transcript | terminal transcript | `/health`, session detail, terminal details, output tails, inbox and unknown-session checks | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| api-terminal-transcript | terminal transcript | parent/worker API output and delivered callback | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| tmux-transcript | tmux transcript | parent and worker panes showing callback and final verification | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| browser-dom-transcript | browser DOM transcript | session UI cards, parent label, composer and completion badges | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| browser-console | browser console log | no error/warn logs | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| browser-layout | browser evaluation | desktop viewport/body dimensions | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| browser-mobile-layout | browser evaluation | 390x844 viewport/body dimensions and mobile DOM excerpt | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| frontend-test-transcript | test report | 5 focused frontend files, 70 passed | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| backend-test-transcript | test report | status/agent-step/assign tests, 55 passed | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
| provider-failure-transcript | test report | Claude provider unit suite, 131 passed/1 failed | `.omo/evidence/review_qa/codex-orchestration-evidence.txt` |
