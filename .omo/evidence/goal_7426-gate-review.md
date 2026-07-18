# Goal 7426 final gate review — latest diff

- recommendation: **APPROVE**
- confidence: **high**
- blockers: **none**
- report path: `.omo/evidence/goal_7426-gate-review.md`
- attempt path resolution: `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`; the required fallback path is used.
- notepad path: none supplied or found.

## originalIntent

Make Codex-to-Codex orchestration actually usable from the web chat: launch Codex with a working MCP server, delegate to a worker, receive that worker's delivered callback, and show only the supervisor's response produced after that callback. A receipt, interim pane, unrelated input, old callback, stale worker, idle redraw, reload, or server-reset zero generation must not masquerade as the final answer.

## desiredOutcome

1. A live supervisor-to-worker message and worker-to-supervisor callback are delivered, followed by the supervisor's final response.
2. Both web-chat surfaces remain pending until the exact current-turn branch has semantic input/ready generation proof and delivered direct-child callbacks newer than the captured inbox cursor.
3. Pending message id, target id, output baseline, generation snapshot, and inbox cursor survive close/reload/remount, including while the input request is still unresolved.
4. Raw, rendered-screen, polling, and native status detection cannot assign an old observation to a newer input generation.
5. Codex rendered-pane recovery is bounded, Codex-only, excludes IDLE as rendered completion proof, and cannot fork a capture per concurrent poll.
6. Active-venv and isolated MCP bootstrap paths, inbox cursor/query boundaries, notification aggregation, TypeScript, and production build remain healthy.

## success criteria used

- **SC-1 — live orchestration:** a supervisor request is delivered to the existing worker, a newer callback from that exact worker is delivered back, and the supervisor emits the required final response after it.
- **SC-2 — provenance-gated finality:** completion requires the current target cycle, current-turn descendants, delivered post-cursor callbacks from each direct child, and the target's callback-processing cycle.
- **SC-3 — adversarial finality:** processing/waiting, missing or wrong-sender callbacks, pre-cursor callbacks, unrelated roots/inputs, old workers, idle workers without semantic ready proof, and restart-zero workers do not complete the turn.
- **SC-4 — pending restoration:** every persisted waiting entry retains and restores its exact target/message/output/generation/inbox provenance, and remains locked/polling through remount.
- **SC-5 — status-generation correctness:** every blocking detection path pins its observation generation; rendered fallback additionally requires two matching non-IDLE ready frames and coalesces probes.
- **SC-6 — API/MCP/regression safety:** inbox filtering/bounds and MCP resolution remain executable; targeted backend/frontend suites, typing, formatting, whitespace, and production build pass.
- **SC-7 — scope/safety:** review is product-read-only, does not delete live terminals, and excludes unrelated usage-widget changes from the decision.

## userOutcomeReview

### SC-1 — PASS

Read-only live API inspection on `cao-7426da03` reproduced the intended latest callback ordering:

- inbox query `after_id=20` returned delivered message **22**, sender `2bd9e73e`, receiver `53c5e264`, content `LATEST_CALLBACK_OK`;
- the worker full output contains its `send_message` call creating message 22;
- the supervisor full output contains message 21 delivery, the subsequently received callback 22, and only then `LATEST_ORCHESTRATION_VERIFIED`;
- `/health` returned HTTP-success JSON with `cao: ok`.

The currently running service reports process-local generations as `0/0` after a service restart, so those live counters are not used as proof for the latest source. The source-level semantic generation cases were reproduced separately below.

### SC-2 — PASS

`isOrchestrationReplyReady` scopes descendants to the target branch, selects only descendants whose input generation advanced beyond the pre-send baseline, requires every selected descendant to have a ready outcome with `ready_generation === input_generation`, requires delivered post-cursor callbacks from every direct child, and requires the target to reach its prompt generation plus one callback-input generation per direct child.

Both chat consumers now bracket the output read with the same ready orchestration fingerprint. A state/callback change during the output capture rejects that sample and retries, preventing an earlier pane read from being paired with a later ready snapshot.

### SC-3 — PASS

The helper regression matrix covers active workers, missing callbacks, unrelated second target input, independent roots, old unchanged workers, idle workers with and without semantic proof, and delivered callback provenance. During this gate, a real gap was found and corrected: a newly discovered `idle/0/0` child initially disappeared from the descendant set and allowed completion. The final production helper was executed directly from the current TypeScript source and now returns:

```json
{"zero":false,"one":true}
```

Here `zero` is a newly discovered direct child at `idle`, input/ready `0/0`, with a delivered callback; `one` is the same child at `1/1`. The final regression test passes both assertions.

### SC-4 — PASS

The Workspace storage contract validates and restores `messageId`, `baseline`, `terminalId`, `baselineGenerations`, and `baselineInboxMessageId`, while preserving the classic modal's fields in the shared localStorage object. `useWorkspaceSession` restores the saved output baseline, pending state, target, and disabled sending state. Both Workspace and classic `SessionChatPanel` now create the pending record before awaiting `sendInput`.

Render-level tests leave the input request unresolved, wait for pending provenance to reach localStorage, unmount, resolve the request, remount, and verify that the original user/waiting entries return and the composer remains disabled. Legacy waiting bubbles without provenance remain unlocked rather than fabricating zero baselines.

### SC-5 — PASS

Generation pinning is applied at raw and pyte event ingestion, raw and screen quiescence tasks, fresh raw polling, rendered-pane capture/confirmation/apply, snapshot restoration, and native event-inbox polling. The deterministic race tests force `notify_input_sent()` during raw detection and rendered capture and prove that neither stale result advances the newer ready generation. Native polling proves input 1 -> processing -> completed advances ready generation to 1, while a straddling input is discarded.

Rendered-pane fallback remains opt-in through the Codex provider, excludes rendered IDLE, requires two matching ready observations separated by the cooldown, and reserves the cooldown under lock so repeated polls make one capture.

### SC-6 — PASS

Reproduced on the final source snapshot:

- backend orchestration/status/inbox suite: **71 passed**;
- MCP/provider resolver suite: **368 passed**;
- frontend Workspace/classic/completion/AppShell suite: **54 passed**;
- focused completion suite: **18 passed**;
- `npx tsc --noEmit`: PASS;
- `npm run build`: PASS, 1,801 modules transformed; the existing large-chunk warning is non-failing;
- Black check on 11 scoped Python production/test files: PASS;
- `git diff --check`: PASS.

Vitest emitted the known jsdom `HTMLCanvasElement.getContext` diagnostic from xterm; all selected files and assertions passed.

MCP resolver tests cover broken sibling rejection, alternate launcher selection, and the isolated trusted-source bootstrap. The earlier QA/code-review evidence also records a real JSON-RPC initialize through the isolated bootstrap; the resolver code did not change after that artifact.

### SC-7 — PASS

All live checks were GET-only. No prompt, message, terminal deletion, deployment, commit, push, or unrelated usage change was performed by this gate. Usage-widget files remain outside the goal decision.

## blockers

None.

## direct programming and remove-ai-slops pass

The gate directly applied `omo:programming` and `omo:remove-ai-slops` to the final production diff and tests.

- The new completion tests exercise externally meaningful combinations rather than mirroring implementation strings. The `0/0` test caught a real first implementation failure before passing on the corrected source.
- The pending-remount tests operate through rendered chat surfaces and real localStorage effects with an unresolved request; they are not deletion-only, requested-removal-only, or tautological tests.
- The generation-straddle tests force the relevant interleaving and assert public status/generation outcomes. One test calls the internal scheduler to reach the event-driven boundary, which is justified by the otherwise nondeterministic race and does not introduce production extraction solely for testing.
- No excessive removal test, prose pin, redundant parser/normalizer, or unnecessary production abstraction was added for this goal. The shared completion fingerprint and typed Workspace pending record each remove concrete cross-request/persistence ambiguity.
- The optional-field breadth of the existing frontend terminal type and the duplicated classic/Workspace chat adapters remain maintenance NOTES, not failures of a stated criterion; both serialized shapes are now compatibility-preserving and behavior-tested.

The code-review report at `.omo/evidence/goal_7426-code-review.md` explicitly documents its own `programming` and `remove-ai-slops` checks, including overfit, deletion-only, tautological, implementation-string, and missing-behavior-test criteria. Its 06:07 FAIL verdict is stale: its three HIGH observations (rendered generation straddle, Workspace pending loss, and state/output skew) are all changed in the current diff and directly rechecked here. Stale report prose is an evidence gap, not a current product blocker.

## checked artifact paths

- `docs/HANDOFF-msorchestrator.md`
- `.omo/evidence/goal_7426-code-review.md`
- `.omo/evidence/review_qa/codex-7426-manual-qa.md`
- `.omo/evidence/review_qa/codex-7426-rereview-evidence.txt`
- `.omo/evidence/review_qa/codex-orchestration-evidence.txt`
- `src/cli_agent_orchestrator/services/status_monitor.py`
- `src/cli_agent_orchestrator/api/main.py`
- `src/cli_agent_orchestrator/clients/database.py`
- `src/cli_agent_orchestrator/providers/base.py`
- `src/cli_agent_orchestrator/providers/codex.py`
- `src/cli_agent_orchestrator/services/session_service.py`
- `src/cli_agent_orchestrator/utils/mcp_resolution.py`
- `test/services/test_status_monitor.py`
- `test/services/test_session_service.py`
- `test/api/test_inbox_messages.py`
- `test/utils/test_mcp_resolution.py`
- affected provider MCP tests
- `web/src/api.ts`
- `web/src/components/NotificationCenter.tsx`
- `web/src/components/SessionChatPanel.tsx`
- `web/src/features/workspace/orchestratorChat.ts`
- `web/src/features/workspace/sessionCompletion.ts`
- `web/src/features/workspace/useWorkspaceSession.ts`
- `web/src/test/session-chat.test.tsx`
- `web/src/test/workspace-session-completion.test.ts`
- `web/src/test/workspace.test.tsx`
- `web/src/test/appshell.test.tsx`

## exact evidence gaps and non-blocking notes

1. `.omo/evidence/goal_7426-code-review.md` predates the final fixes and still says FAIL. It nevertheless contains the required skill/overfit coverage; this gate directly reproduced each formerly blocking boundary against the current source.
2. The current running server restarted after the live generation demonstration and now exposes process-local `0/0` counters. The callback/output order remains visible live, while final generation semantics are proven by deterministic current-source tests rather than the restarted counters.
3. No new browser automation interacted with the pending-remount flow on the production server. Both actual React surfaces are covered by render-level unresolved-request/unmount/remount tests, and the criterion did not require a browser artifact.
4. A final whole-repository suite was not rerun after the last narrow completion-helper edit. The earlier full-suite artifact predates that edit; the complete affected backend, provider/MCP, frontend, typing, build, formatting, and whitespace surfaces were rerun on the final snapshot.
5. The production build retains its existing >500 kB chunk warning. Bundle sizing is not a stated success criterion.
