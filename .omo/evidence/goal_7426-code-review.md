# Code quality re-review: goal_7426

- Snapshot reviewed: 2026-07-18 09:01 KST
- Verdict: **PASS WITH WATCH ITEMS**
- Confidence: **high**
- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- `reportPath`: `.omo/evidence/goal_7426-code-review.md`
- `blockers`: none

## Goal and scope

I re-reviewed the latest orchestration diff after the final Herdr-generation and zero-generation-child fixes. The goal is to keep the bundled Codex MCP server launchable when an interpreter-sibling launcher is unusable, and to make both web-chat surfaces accept only the current orchestration turn's final response: the target and turn-relevant descendants must have semantic ready-generation proof, direct-child callbacks must be delivered with matching sender provenance, and the output read must be bracketed by an unchanged ready snapshot. Session notifications should reflect aggregate terminal state.

Reviewed production scope:

- `src/cli_agent_orchestrator/utils/mcp_resolution.py`
- `src/cli_agent_orchestrator/services/status_monitor.py`
- `src/cli_agent_orchestrator/providers/base.py`
- `src/cli_agent_orchestrator/providers/codex.py`
- `src/cli_agent_orchestrator/clients/database.py`
- `src/cli_agent_orchestrator/services/session_service.py`
- orchestration hunks in `src/cli_agent_orchestrator/api/main.py`
- `web/src/api.ts`
- `web/src/components/NotificationCenter.tsx`
- `web/src/components/SessionChatPanel.tsx`
- `web/src/features/workspace/orchestratorChat.ts`
- `web/src/features/workspace/sessionCompletion.ts`
- `web/src/features/workspace/useWorkspaceSession.ts`
- corresponding orchestration tests

The separate usage-widget changes were outside this goal and excluded, as in the supplied review scope. `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`, so the required fallback report path is used. No task notepad path was supplied or found. I inspected the supplied evidence at `.omo/evidence/review_qa/codex-7426-rereview-evidence.txt`, `.omo/evidence/review_qa/codex-7426-manual-qa.md`, `.omo/evidence/review_qa/codex-orchestration-evidence.txt`, and `.omo/evidence/review_qa/codex-orchestration-manual-qa.md`, but treated those claims as untrusted until corroborated against current source and independent runs.

## Skill-perspective check

The required skill-perspective check **ran**. I read and applied `omo:programming` and `omo:remove-ai-slops`, including the relevant Python async/error/data-modeling and TypeScript type/error/data-modeling guidance.

No deletion-only, requested-removal-only, prose-only, or tautological removal test was added. The status generations, inbox cursor, pending-turn persistence, and MCP fallback are required production behavior rather than needless parsing or extraction.

The diff still has non-blocking violations of both perspectives:

- **programming:** expected polling states are represented by thrown exceptions, the completion-specific fields remain optional on a broad API type, and a positional inbox API causes placeholder `undefined` arguments.
- **remove-ai-slops:** the claimed concurrent capture coalescing test is sequential, the isolated-bootstrap unit test mirrors generated implementation strings rather than executing the command, and the identical-snapshot output boundary lacks a focused temporal-skew regression.

These are recorded as MEDIUM because they create maintenance burden or incomplete regression protection, but the current implementation and independently run checks do not show a remaining correctness failure.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **A persisted pending turn cannot recover across a server process restart.**

   Input and ready generations are process-local dictionaries (`src/cli_agent_orchestrator/services/status_monitor.py:75-81`). `restore_snapshot()` restores pane status but has no persisted generation/epoch to reconcile browser baselines (`status_monitor.py:596-620`). If the browser retains a pending record with generations greater than the restarted server's `0/0`, the completion threshold cannot be reached and the composer remains disabled until the 180-second timeout. The QA artifact labels a localStorage remount test as a restart/persistence check, but it does not restart the server. This is conservative rather than falsely completing a turn, so it is a liveness/watch item rather than an approval blocker.

2. **Callback discovery is capped at the first 100 post-baseline inbox rows with no pagination.**

   Both chat consumers repeatedly request `limit=100` after the original cursor (`web/src/features/workspace/useWorkspaceSession.ts:304-331`; `web/src/components/SessionChatPanel.tsx:251-270`). The backend returns ascending IDs and applies the limit (`src/cli_agent_orchestrator/clients/database.py:742-770`). If more than 100 messages arrive and a required direct-child callback lies beyond that first page, every poll rereads the same page and the turn times out despite having completed. This requires unusually high inbox traffic, but the cursor contract should eventually paginate or request a server-side completion proof.

3. **Normal retry states use exceptions as control flow in two manually synchronized pollers.**

   A still-running turn and a changed fingerprint deliberately throw and are immediately swallowed (`web/src/features/workspace/useWorkspaceSession.ts:321-353`; `web/src/components/SessionChatPanel.tsx:264-293`). This conflates expected pending/skew states with transport or parsing failures and duplicates the same completion loop in two components. It does not currently break correctness, but it violates the programming perspective and makes future diagnostics and changes easier to get wrong.

4. **Several central concurrency claims remain under-tested or implementation-mirroring.**

   `test_processing_rendered_pane_probe_is_coalesced` says concurrent HTTP polls are covered but invokes `get_status()` twice sequentially (`test/services/test_status_monitor.py:192-211`); it verifies cooldown reuse, not lock contention. The isolated-source bootstrap test asserts substrings generated from the same module constant instead of executing the command (`test/utils/test_mcp_resolution.py:156-171`). No focused test deliberately changes session/inbox state between the before/after fingerprint reads. Independent real bootstrap and live callback evidence reduce current risk, but these tests provide less regression protection than their names or nearby evidence imply.

5. **The completion API boundary is weaker than the invariant it enforces.**

   `status`, `caller_id`, `input_generation`, and `ready_generation` are optional on `TerminalMeta` (`web/src/api.ts:61-76`), although session completion requires all four to be trustworthy. Missing generations silently become zero. `getInboxMessages` also takes five positional parameters (`api.ts:225-233`), producing correctness-sensitive calls with placeholder `undefined` values. A required session-detail terminal type and an options object would make incompatible responses fail at the boundary instead of degrading into polling timeouts.

### LOW

1. **The MCP sibling health result is cached for the lifetime of the process.**

   `_sibling_environment_can_import_server()` uses `lru_cache(maxsize=1)` (`src/cli_agent_orchestrator/utils/mcp_resolution.py:58-75`). Repairing the sibling environment does not make it eligible until restart. The PATH/source-bootstrap fallbacks keep launch functional, so this is operationally minor.

2. **The classic and Workspace chat persistence contracts remain separate.**

   The latest read-modify-write merge and dedicated `workspacePendingReply` avoid the previously reproduced overwrite bug, and remount tests now cover unresolved sends. Two schemas and two poll loops still have to evolve together, which is a future drift risk rather than a current defect.

## Verified successes

- Every raw, pyte-screen, rendered-pane, and native Herdr detection result is tied to an input-generation snapshot before it can mutate status. Direct probes confirmed both native `PROCESSING -> COMPLETED` advancement (`1/1`) and native/scheduled-raw straddle rejection.
- Rendered-pane capture pins generation before the blocking capture, requires a later matching ready result, and excludes a rendered `IDLE` frame as active-turn proof.
- Herdr's native `get_status()` now participates in `_last_status` and ready-generation lifecycle; the focused regressions cover semantic transition and input interleaving.
- A newly discovered `idle` child at `0/0` blocks completion, while a semantically advanced `1/1` child with delivered sender-matching callback can complete. The initially failing regression was independently rerun after the fix and passed.
- Both chat surfaces persist the exact pending turn before awaiting `sendInput`, restore baselines/output after unmount/remount, and clear the pending record on an observed send failure.
- Output is accepted only when identical ready orchestration fingerprints bracket the output read. Interim worker-delegation output is not displayed while a descendant remains active.
- The inbox cursor is additive, authorized, bounded to 1..100, and deterministic by ID. Callback sender and delivered status are checked after the baseline cursor.
- The MCP resolver skips an unusable interpreter sibling, avoids reselecting it through PATH, and has an isolated trusted-source fallback. Independent prior execution of that fallback completed an MCP initialize handshake.
- Live read-only evidence shows direct Codex worker `2bd9e73e` at `idle` generation `1/1`, caller `53c5e264`, delivered callbacks 20/22, and a parent final response after the callback.

## Independent verification performed on the final snapshot

- Full Python suite: **4,698 passed, 21 skipped, 97 deselected** in 90.03s.
- Focused orchestration Python suite: **96 passed**; status-monitor's final focused evidence reports **38 passed**.
- Full frontend suite, standalone rerun: **350 passed**. JSDOM emitted the known non-fatal xterm canvas diagnostics.
- Focused frontend completion regression: **18 passed**; combined Workspace/session/completion evidence reports **42 passed**.
- `npx tsc --noEmit`: PASS.
- Production TypeScript/Vite build: PASS; existing >500 kB chunk warning remains.
- Black check on 10 reviewed Python files/tests: PASS.
- isort check on the same reviewed files/tests: PASS.
- `git diff --check`: PASS.
- Direct native lifecycle probe: `processing -> completed`, `input_generation=1`, `ready_generation=1`.
- Direct native input-straddle probe: stale completion discarded, current state remains `processing`, `input_generation=2`, `ready_generation=0`.

One initial full-frontend run was executed concurrently with the full Python suite and suffered Vitest worker-start/timeouts from resource contention. The immediate standalone full rerun passed all 350 tests, so that first run is not treated as a product failure.

## Blockers

None. The previous rendered-capture, Workspace persistence, temporal-skew, Herdr lifecycle, and zero-generation-child blockers are resolved in the current snapshot.
