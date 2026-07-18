# Phase 6c live verification — 2026-07-18

## Runtime and orchestration

- Latest checkout server: tmux `cao-source-server`, PID `8878`, `127.0.0.1:9889`, `/health` 200.
- `cao-7426da03`: detached; terminals `cff2a1e5`, `53c5e264`, `2bd9e73e` all completed.
- Link: worker `2bd9e73e.caller_id` is `53c5e264`.
- Message 21: `53c5e264 -> 2bd9e73e`, `EXACT_LATEST_CALLBACK`, delivered.
- Message 22: `2bd9e73e -> 53c5e264`, `LATEST_CALLBACK_OK`, delivered.
- Parent output: `LATEST_ORCHESTRATION_VERIFIED`.

## Red to green

- Before the fix, three catalog assertions failed because the live item still returned `npm install -g @anthropic-ai/skills`.
- Before the fix, the CLI version diff test received `undefined` instead of a Codex `0.144.4 -> 0.144.5` change.
- After the fix: catalog and generic adapter `39 passed`; focused EnvProfiles/Discover/Tooling `46 passed`.
- Final suites: backend `4698 passed, 21 skipped, 97 deselected`; frontend `362 passed`.
- `tsc --noEmit`, production build, design-token generation check, and `git diff --check` passed.

## Manual browser QA

- Live Skills CLI detail shows `https://github.com/vercel-labs/skills` and `npm install -g skills`.
- A live environment snapshot showed Claude Code `2.1.212`, Codex `0.144.5`, Hermes `0.16.0`, and Antigravity CLI `1.1.4`.
- A fresh comparison of that snapshot rendered `차이가 없어요 ✨`.
- Browser console errors: 0.
- Responsive screenshots: `sources-{375,768,1280}.png`, `envprofiles-{375,768,1280}.png`, and `envprofiles-no-diff-1280.png`.
- Two independent visual gates passed after the 375px tab grid and Sources header stack fix.

## Safety

- Env profile schema remains `cao-env-profile/v1`; `cli_versions` is optional for legacy imports.
- Provider fetch failure omits `cli_versions` and emits an explicit partial-failure warning; it never claims the CLI is absent.
- Snapshot CLI data is limited to `name`, `display_name`, and `version` for installed providers.
- No global package was installed. No commit or push was performed.
