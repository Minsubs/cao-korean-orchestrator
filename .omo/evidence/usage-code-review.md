# Usage feature code-quality review

## Verdict

- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- Review scope: current usage backend/frontend files, TopBar/router integration, and usage tests against `docs/specs/usage-backend-spec.md` and `docs/specs/usage-front-spec.md`.
- Review was read-only with respect to implementation files.

## Skill-perspective check

The required `omo:programming` and `omo:remove-ai-slops` skill perspectives were loaded and applied before judging maintainability and tests.

- `programming`: **minor violation remains**. The final Python type/style gates pass, but the frontend API client still trusts `Response.json()` as a generic type without parsing the network boundary.
- `remove-ai-slops`: **violations remain**. The timer-cleanup test can pass when polling never existed, and the usage API client extracts error-detail data that no consumer reads.

## Findings

### CRITICAL

None.

### HIGH

None remain. The previously observed mypy narrowing error and Black drift were corrected and independently re-run green.

### MEDIUM

1. **The frontend does not parse the HTTP success boundary and can crash the TopBar on a malformed HTTP-200 body.**
   - `web/src/api.usage.ts:15-33` returns `res.json()` as unconstrained generic `T`; `web/src/api.usage.ts:93-94` labels that unchecked value `UsageAccountsResponse`.
   - `web/src/features/usage/useUsageAccounts.ts:51-55` commits `res.accounts` directly. A body such as `{}` sets `accounts` to `undefined`; `web/src/features/usage/UsageButton.tsx:13` then reaches `maxUsedPercent`, whose `.map` call crashes rendering.
   - This violates the programming perspective's parse-at-boundaries rule and leaves no regression test for malformed 2xx data.

2. **The response and per-file caches are thread-safe dictionaries but not single-flight.**
   - `src/cli_agent_orchestrator/api/usage_router.py:59-66` releases `_CACHE_LOCK` before `_scan_accounts`; two simultaneous cold requests both scan. An independent two-thread probe observed `concurrent_router_scans=2` for the same query mode.
   - The same check-parse-store gap exists at `src/cli_agent_orchestrator/services/usage/claude_transcripts.py:170-180` and `src/cli_agent_orchestrator/services/usage/codex_rollouts.py:153-162`.
   - This weakens the explicit performance guarantee for large unchanged JSONL files and can duplicate the opted-in Anthropic call on a cold burst. Current memo tests cover only sequential reuse.

3. **Two tests give weaker regression confidence than their names imply.**
   - `web/src/test/usage.test.tsx:193-208` only asserts that no fetch occurs after unmount. It still passes if the 60-second polling interval is deleted entirely; it should first prove that one interval refresh occurs while mounted.
   - `test/api/test_usage_router.py:111-122` inspects a dependency function's `__qualname__`, but never proves READ/WRITE/ADMIN authorization behavior or even the exact requested scopes. It is implementation-mirroring rather than a behavioral scope-gate test.

4. **The frontend API client contains unused error parsing/normalization.**
   - `web/src/api.usage.ts:10-31` creates `ApiUsageError.status/detail` and parses a JSON error body, but the only consumer (`web/src/features/usage/useUsageAccounts.ts:57-63`) discards the error and shows one fixed message.
   - Under the remove-ai-slops perspective this is needless production extraction and an unused abstraction, not goal-required behavior.

### LOW

1. `web/src/features/usage/UsageButton.tsx:16-25` and `web/src/features/usage/UsagePopover.tsx:38-44` implement outside-pointer and Escape closing, but only Escape has manual-QA evidence; there is no automated outside-click regression.

## Positive verification

- StrictMode mounted-state handling and stale-request suppression are now present in `web/src/features/usage/useUsageAccounts.ts:32-65`.
- Future-dated usage is excluded from both weekly aggregators.
- Claude redirects are disabled, non-finite limit values are rejected, and successful cache entries do not outlive credential expiry.
- Final targeted backend: **19 passed**.
- Final targeted web usage + AppShell: **23 passed**; TypeScript no-emit: **passed**.
- Final Python Black/isort checks: **passed**; mypy on the four usage source files: **passed**; `git diff --check`: **passed**.
- Earlier broad regression run: backend **4682 passed, 14 skipped**; web **334 passed**. These broad runs preceded the final small expiry/race hardening, so only the final targeted runs describe the exact last snapshot.
- Earlier production build: **passed** with the existing bundle-size warning.

## Blockers before approval

None. The remaining MEDIUM/LOW findings are follow-up quality debt rather than approval blockers for this goal.
