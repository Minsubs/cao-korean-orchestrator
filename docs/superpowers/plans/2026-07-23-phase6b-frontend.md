# Phase 6b Frontend (환경 마이그레이션 · AGENTS/CLAUDE 지침 관리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing frontend for the already-shipped Phase 6b `/env` backend — a new "도구 및 확장" sub-tab that lets a user see each CLI's environment inventory, view the AGENTS.md/CLAUDE.md instruction matrix across global + project scopes, preview format conversions (migration), and (guarded) write/edit instruction files.

**Architecture:** New `web/src/api.env.ts` client (mirrors `api.tooling.ts`). One new Tooling sub-tab `envtools` rendering `EnvToolsPane`, whose data is loaded eagerly in `ToolingView` (same ownership pattern as Sources/Catalog). The pane composes read-only sections (inventory, instruction matrix) + a convert-preview interaction + a guarded write action. No new backend.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + @testing-library/react, Tailwind with design tokens (`var(--…)` only). Backend already at `/env/*` (mounted `api/main.py:708`).

## Global Constraints

- 한국어 UI only. Never expose internal identifiers, raw markers, or file **content** the backend didn't intend — the inventory endpoint returns metadata only; instruction `headline` is already secret-masked + 80-char truncated by the backend (never re-fetch or synthesize full content client-side).
- Colors: `var(--…)` design tokens ONLY. No hardcoded hex/rgb. Mirror `SourcesPane.tsx` token usage exactly. (`rgba(0,0,0,…)` scrims/shadows are the one allowed literal, matching existing modal convention.)
- Gate (every task): `cd web && npx tsc --noEmit && npm test && npm run build`. All must pass before commit.
- Frontend build output is gitignored (`src/cli_agent_orchestrator/web_ui/`); never `git add` it.
- Backend `/env` routes require auth scopes (reads: any of READ/WRITE/ADMIN; POST convert + write: WRITE/ADMIN). The dev server runs with sufficient scope; the client just calls the routes — no scope handling needed client-side, but surface a 401/403 as a normal error state.
- Do NOT modify the backend (`src/cli_agent_orchestrator/api/env_router.py`, `services/env_migration/*`) — it is the fixed contract.
- Do NOT touch `web/src/features/tooling/envProfileSnapshot.ts` / `EnvProfilesPane.tsx` — that is the unrelated "환경 프로필" snapshot feature (different concept). This plan is a NEW pane.

## Backend contract (fixed — copy types verbatim)

`GET /env/inventory?cli=all` → `{ clis: EnvInventoryCli[] }` (order: claude_code, codex, antigravity).
`GET /env/inventory?cli=<one>` → a single `EnvInventoryCli`.
```
EnvInventoryCli  = { cli: string; present: boolean; items: EnvInventoryItem[]; counts: Record<string, number>; note: string | null }
EnvInventoryItem = { rel_path: string; kind: 'instruction'|'settings'|'command'|'agent'|'prompt'|'skill'|'mcp_config'; size: number; mtime: string | null; mcp_servers_present?: boolean }
```
`GET /env/instructions?paths=<comma-separated ABS paths>` (param name is exactly `paths`) → `{ entries: EnvInstructionEntry[] }`. entries[0] is always the global scope; then one entry per non-blank path, in order. A path outside `$HOME` yields an entry with `error` and no `files` (still HTTP 200).
```
EnvInstructionEntry = { scope: 'global'|'project'; base_path: string; files?: EnvFileEntry[]; error?: string }
EnvFileEntry        = { name: string; exists: boolean; size: number | null; mtime: string | null; sha256: string | null; headline: string | null; is_dir?: boolean; command_count?: number }
```
`POST /env/convert` body `{ source_kind: string; target_kind: string; path?: string; content?: string }` (exactly one of path/content) → `{ converted: string; warnings: string[]; lossy_fields: string[] }`. Supported pairs only: `claude_agent→cao_profile`, `claude_command↔codex_prompt`, `instruction→counterpart_instruction`. Unsupported → 400 `UnsupportedConversion`. Preview only (writes nothing).
`POST /env/instructions/write` body `{ path: string; content: string; overwrite?: boolean }` → `{ written: true; path: string; backup_path: string | null; bytes: number; created: boolean }`. Errors: 400 (outside home / bad filename / >256KiB), 409 `InstructionExists` when exists && !overwrite.

## Patterns to mirror (read these before coding)

- Client: `web/src/api.tooling.ts` — `fetchJSON<T>` (AbortController + `timeoutMs`), `ApiError` (`.status`, `.detail`), the `toolingApi = {…}` export object (`api.tooling.ts:324-341`). Build `api.env.ts` the same shape.
- Tab registration + eager-load ownership: `web/src/features/tooling/ToolingView.tsx` — `TabKey` union (`:23`), `TABS` array (`:31-39`), per-tab `useState`+loader+`useEffect` on mount (`:106-152`), `handleRetry` reloads array (`:272-278`), render block (`:433`).
- Pane skeleton (loading/error/empty/success, tokens, Korean copy): `web/src/features/tooling/SourcesPane.tsx` (esp. the error block `:34-55` — verbatim "Tooling API에 연결할 수 없어요" heading + "다시 시도" button; and `SkeletonBlock` usage).
- Tests: `web/src/test/tooling-sources.test.tsx` — single `mockFetch` covering every URL `<ToolingView/>` requests, `jsonResponse(data,status)`, drive through `<ToolingView/>`, click the tab via `screen.findByRole('tab',{name:/…/})`, assert per-tab error isolation + retry recovery + refetch-on-remount. Add `/env/*` branches to the dispatcher.

---

## File Structure

- `web/src/api.env.ts` (Create) — typed `/env` client + exported `envApi`.
- `web/src/features/tooling/EnvToolsPane.tsx` (Create) — the pane: inventory + instruction-matrix + convert-preview + write.
- `web/src/features/tooling/envtools.ts` (Create) — small pure helpers (kind labels, byte/mtime formatters, convert-pair list) — keeps the pane lean and unit-testable without DOM.
- `web/src/features/tooling/ToolingView.tsx` (Modify) — register the `envtools` tab + eager-load `/env/inventory?cli=all` and the global instruction matrix; pass to pane.
- `web/src/api.env.ts` test, pane tests, helper tests under `web/src/test/`.

---

### Task 1: `api.env.ts` client + types

**Files:**
- Create: `web/src/api.env.ts`
- Test: `web/src/test/api-env.test.ts`

**Interfaces:**
- Produces: `envApi = { getInventory(cli?: 'all'|'claude_code'|'codex'|'antigravity'): Promise<EnvInventoryAll|EnvInventoryCli>, getInstructions(paths: string[]): Promise<EnvInstructionsMatrix>, convert(body: EnvConvertBody): Promise<EnvConvertResult>, writeInstruction(body: EnvWriteBody): Promise<EnvWriteResult> }` and all exported interfaces below. `ApiError` re-exported/shared with the tooling client (import from `api.tooling.ts` if it exports one; otherwise define an identical `EnvApiError` — check `api.tooling.ts` first and reuse).

- [ ] **Step 1: Read** `web/src/api.tooling.ts` fully — copy its `fetchJSON`/`ApiError`/timeout/`postJSON` shape and export style. Note whether `ApiError` is exported (reuse it) or private (define an equivalent).

- [ ] **Step 2: Write failing test** `web/src/test/api-env.test.ts` — mock `global.fetch`; assert:
  - `getInventory()` GETs `/env/inventory?cli=all` and returns the parsed `{clis:[…]}`.
  - `getInstructions(['/a','/b'])` GETs `/env/instructions?paths=%2Fa%2C%2Fb` (paths comma-joined then URL-encoded) and returns `{entries:[…]}`; `getInstructions([])` still calls with `paths=` empty (global-only).
  - `convert({source_kind,target_kind,content})` POSTs JSON to `/env/convert`, returns `{converted,warnings,lossy_fields}`.
  - `writeInstruction({path,content,overwrite:true})` POSTs to `/env/instructions/write`.
  - a non-2xx (e.g. 409 with `{detail:'…'}`) rejects with an error carrying `.status===409` and `.detail`.
  Follow the mock-fetch style used in existing `web/src/test/*.ts` api tests.

- [ ] **Step 3: Run** `cd web && npx vitest run src/test/api-env.test.ts` — expect FAIL (module missing).

- [ ] **Step 4: Implement** `web/src/api.env.ts`: the interfaces from the "Backend contract" section verbatim (`EnvInventoryItem`, `EnvInventoryCli`, `EnvInventoryAll = {clis: EnvInventoryCli[]}`, `EnvFileEntry`, `EnvInstructionEntry`, `EnvInstructionsMatrix = {entries: EnvInstructionEntry[]}`, `EnvConvertBody = {source_kind:string; target_kind:string; path?:string; content?:string}`, `EnvConvertResult`, `EnvWriteBody = {path:string; content:string; overwrite?:boolean}`, `EnvWriteResult`), plus the `fetchJSON`/`postJSON`/`ApiError` mirror and `envApi`. `getInstructions` builds the query as `new URLSearchParams({ paths: paths.join(',') })`. Default timeout 10000ms.

- [ ] **Step 5: Run** the test → PASS. Then full gate `cd web && npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 6: Commit** `git add web/src/api.env.ts web/src/test/api-env.test.ts && git commit -m "feat(env): typed /env API client (inventory/instructions/convert/write)"`

---

### Task 2: Register `envtools` tab + `EnvToolsPane` with CLI 인벤토리 section

**Files:**
- Create: `web/src/features/tooling/EnvToolsPane.tsx`
- Create: `web/src/features/tooling/envtools.ts`
- Modify: `web/src/features/tooling/ToolingView.tsx` (tab union + TABS entry + eager-load inventory + render block + handleRetry)
- Test: `web/src/test/tooling-envtools.test.tsx`, `web/src/test/envtools-helpers.test.ts`

**Interfaces:**
- Consumes: `envApi.getInventory` (Task 1).
- Produces: `EnvToolsPane` props `{ inventory: EnvInventoryAll | null; inventoryLoading: boolean; inventoryError: boolean; onRetry: () => void }` (later tasks extend props for instructions/convert — additive). Pure helpers in `envtools.ts`: `formatBytes(n: number): string`, `formatMtime(iso: string | null): string`, `KIND_LABELS: Record<string,string>` (Korean labels: instruction→"지침", settings→"설정", command→"명령", agent→"에이전트", prompt→"프롬프트", skill→"스킬", mcp_config→"MCP 설정").

- [ ] **Step 1: Read** `SourcesPane.tsx` (skeleton + error block + tokens) and `ToolingView.tsx:23,31-39,106-152,272-278,433`.

- [ ] **Step 2: Write failing helper test** `web/src/test/envtools-helpers.test.ts`:
```ts
import { formatBytes, formatMtime, KIND_LABELS } from '../features/tooling/envtools'
test('formatBytes', () => { expect(formatBytes(0)).toBe('0 B'); expect(formatBytes(1024)).toBe('1.0 KB'); expect(formatBytes(1536)).toBe('1.5 KB') })
test('formatMtime null → dash', () => { expect(formatMtime(null)).toBe('—') })
test('kind labels are Korean', () => { expect(KIND_LABELS.instruction).toBe('지침'); expect(KIND_LABELS.mcp_config).toBe('MCP 설정') })
```

- [ ] **Step 3: Write failing pane/tab test** `web/src/test/tooling-envtools.test.tsx` — mirror `tooling-sources.test.tsx`'s mockFetch-covers-all-URLs approach; add branch `url.startsWith('/env/inventory')` → return `{clis:[{cli:'claude_code',present:true,items:[{rel_path:'CLAUDE.md',kind:'instruction',size:12,mtime:null}],counts:{total:1,instruction:1},note:null},{cli:'codex',present:false,items:[],counts:{total:0},note:null},{cli:'antigravity',present:true,items:[],counts:{total:0},note:'~/.gemini/config/mcp_config.json만 확인해요'}]}`. Assert: clicking the tab (`screen.findByRole('tab',{name:/환경·지침/})`) renders a heading for each CLI and the item `CLAUDE.md`; the agy `note` text appears; a forced `/env/inventory` 500 shows the section error ("Tooling API에 연결할 수 없어요") while other tabs stay unaffected, and "다시 시도" recovers it.

- [ ] **Step 4: Run** both tests → FAIL.

- [ ] **Step 5: Implement helpers** `envtools.ts` (formatBytes: B/KB/MB with one decimal for KB+; formatMtime: `null→'—'`, else localized short date via `new Date(iso).toLocaleString('ko-KR')`; KIND_LABELS as above).

- [ ] **Step 6: Implement `EnvToolsPane`** — for now only the inventory section: 3 states (loading → reuse a `SkeletonBlock` group like SourcesPane; error → the verbatim SourcesPane error block with `onRetry`; success → one card per `clis[]` entry: CLI display name, present badge, a counts summary line, and an items list grouped/labelled via `KIND_LABELS` showing `rel_path` + `formatBytes(size)` + `formatMtime(mtime)`; render `note` as a muted line when present; `mcp_config` items show a "MCP 서버 있음/없음" chip from `mcp_servers_present`). Tokens only.

- [ ] **Step 7: Wire into `ToolingView.tsx`**: add `'envtools'` to `TabKey`; add `{ key: 'envtools', label: '환경·지침', active: true }` to `TABS`; add `const [envInventory,setEnvInventory]=useState<EnvInventoryAll|null>(null)` + `envInventoryLoading`/`envInventoryError` + a `loadEnvInventory=useCallback(async()=>{…envApi.getInventory('all')…},[])` fired by its own `useEffect(()=>{loadEnvInventory()},[loadEnvInventory])`; push `loadEnvInventory()` into the `handleRetry` reloads array; add render block `{tab==='envtools' && <EnvToolsPane inventory={envInventory} inventoryLoading={envInventoryLoading} inventoryError={envInventoryError} onRetry={handleRetry} />}`. Import `envApi`, `EnvToolsPane`, and the `EnvInventoryAll` type.

- [ ] **Step 8: Run** tests → PASS. Full gate.

- [ ] **Step 9: Commit** `git add web/src/features/tooling/EnvToolsPane.tsx web/src/features/tooling/envtools.ts web/src/features/tooling/ToolingView.tsx web/src/test/tooling-envtools.test.tsx web/src/test/envtools-helpers.test.ts && git commit -m "feat(env): 환경·지침 tab with CLI inventory section"`

---

### Task 3: 지침(AGENTS/CLAUDE) 매트릭스 section + project-path add

**Files:**
- Modify: `web/src/features/tooling/EnvToolsPane.tsx` (add instructions section + local project-path state)
- Modify: `web/src/features/tooling/ToolingView.tsx` (eager-load global instruction matrix; pass down + a re-fetch callback that accepts paths)
- Test: `web/src/test/tooling-envtools.test.tsx` (extend)

**Interfaces:**
- Consumes: `envApi.getInstructions` (Task 1), `EnvToolsPane` props extended with `{ instructions: EnvInstructionsMatrix | null; instructionsLoading: boolean; instructionsError: boolean; onReloadInstructions: (paths: string[]) => void }`.
- Produces: (no new exports)

- [ ] **Step 1: Write failing test** — extend `tooling-envtools.test.tsx`: add mockFetch branch `url.startsWith('/env/instructions')` → `{entries:[{scope:'global',base_path:'$HOME',files:[{name:'.claude/CLAUDE.md',exists:true,size:20,mtime:null,sha256:'abc',headline:'# 내 지침'},{name:'.codex/AGENTS.md',exists:false,size:null,mtime:null,sha256:null,headline:null}]}]}`. Assert on the envtools tab: the global scope shows both file names, an "있음/없음" state per file, and the masked `headline` "# 내 지침" for the existing one; a non-existing file shows "없음" and no headline.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `EnvToolsPane`: a "지침 매트릭스 (AGENTS·CLAUDE)" section rendering `instructions.entries`. For each entry: header = scope label ("전역"/"프로젝트") + `base_path`; if `entry.error` present, render it as a muted warning row (e.g. the "홈 디렉터리 밖 경로는 다룰 수 없어요" text) instead of files; else a row per `files[]`: `name`, an exists chip ("있음"/"없음", token-colored), `formatBytes(size)`+`formatMtime(mtime)` when exists, `headline` as a muted single-line preview when present, and for the commands-dir entry (`is_dir`) show `command_count`개 명령. 3-state (loading/error/success) like the inventory section, driven by `instructionsLoading`/`instructionsError`. Add a "프로젝트 경로 추가" text input + "추가" button that appends an absolute path to a local `useState<string[]>` and calls `onReloadInstructions([...paths])`; show the current added paths as removable chips.

- [ ] **Step 4: Wire `ToolingView.tsx`**: add `const [envInstructions,setEnvInstructions]=useState<EnvInstructionsMatrix|null>(null)` + loading/error + `loadEnvInstructions=useCallback(async(paths:string[]=[])=>{…envApi.getInstructions(paths)…},[])`; `useEffect(()=>{loadEnvInstructions([])},[loadEnvInstructions])` (global on mount); push `()=>loadEnvInstructions([])` into `handleRetry`; pass `instructions`/`instructionsLoading`/`instructionsError`/`onReloadInstructions={loadEnvInstructions}` to `EnvToolsPane`.

- [ ] **Step 5: Run** → PASS. Full gate.

- [ ] **Step 6: Commit** `git add web/src/features/tooling/EnvToolsPane.tsx web/src/features/tooling/ToolingView.tsx web/src/test/tooling-envtools.test.tsx && git commit -m "feat(env): instruction matrix (AGENTS/CLAUDE) section + project-path scan"`

---

### Task 4: 변환 미리보기 (convert, preview-only)

**Files:**
- Modify: `web/src/features/tooling/EnvToolsPane.tsx` (add convert section)
- Modify: `web/src/features/tooling/envtools.ts` (add `CONVERT_PAIRS`)
- Test: `web/src/test/tooling-envtools.test.tsx` (extend), `web/src/test/envtools-helpers.test.ts` (CONVERT_PAIRS)

**Interfaces:**
- Consumes: `envApi.convert` (Task 1).
- Produces: `envtools.ts` `CONVERT_PAIRS: { source_kind: string; target_kind: string; label: string }[]` = exactly the supported pairs: `{source_kind:'claude_agent',target_kind:'cao_profile',label:'Claude 에이전트 → CAO 프로필'}`, `{source_kind:'claude_command',target_kind:'codex_prompt',label:'Claude 명령 → Codex 프롬프트'}`, `{source_kind:'codex_prompt',target_kind:'claude_command',label:'Codex 프롬프트 → Claude 명령'}`, `{source_kind:'instruction',target_kind:'counterpart_instruction',label:'CLAUDE.md ↔ AGENTS.md'}`.

- [ ] **Step 1: Write failing test** — extend `tooling-envtools.test.tsx`: mockFetch branch for `POST /env/convert` → `{converted:'# 변환됨\n본문',warnings:['일부 필드 유실'],lossy_fields:['tools']}`. Assert: selecting a pair, pasting content into a textarea, clicking "미리보기" calls convert and renders the `converted` text in a read-only preview area + the warnings + lossy_fields chips. Also add to `envtools-helpers.test.ts`: `expect(CONVERT_PAIRS).toHaveLength(4)` and every entry has non-empty label.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `CONVERT_PAIRS` in `envtools.ts`; a "변환 미리보기" section in the pane: a `<select>` of `CONVERT_PAIRS` labels, a `<textarea>` for source `content` (this MVP uses `content`, not `path`, to stay preview-only and avoid path handling), a "미리보기" button → `envApi.convert({source_kind,target_kind,content})`; render `converted` in a read-only `<pre>` (token bg, `overflow-x:auto`), `warnings[]` as muted lines, `lossy_fields[]` as warning chips. On `ApiError` (e.g. 400 `UnsupportedConversion`) show an inline error message (do NOT crash the pane, do NOT a global error). A loading spinner on the button while pending. This section owns its own local state (input + result + inline error + pending) — it is not part of the eager-load props.

- [ ] **Step 4: Run** → PASS. Full gate.

- [ ] **Step 5: Commit** `git add web/src/features/tooling/EnvToolsPane.tsx web/src/features/tooling/envtools.ts web/src/test/tooling-envtools.test.tsx web/src/test/envtools-helpers.test.ts && git commit -m "feat(env): instruction/command/agent conversion preview (preview-only)"`

---

### Task 5: 지침 저장 (guarded write with overwrite + backup)

**Files:**
- Modify: `web/src/features/tooling/EnvToolsPane.tsx` (add a write action to the convert-preview result)
- Test: `web/src/test/tooling-envtools.test.tsx` (extend)

**Interfaces:**
- Consumes: `envApi.writeInstruction` (Task 1).

- [ ] **Step 1: Write failing test** — extend `tooling-envtools.test.tsx`: after a convert preview producing `converted`, a "지침으로 저장…" button opens a small confirm UI with a path input (prefilled empty) + an "덮어쓰기" checkbox. mockFetch: `POST /env/instructions/write` → default `{written:true,path:'/home/u/CLAUDE.md',backup_path:null,bytes:10,created:true}`; a second variant where the path already exists returns 409 `{detail:'이미 있어요'}`. Assert: writing a new path shows a success message with the returned `path` and "새로 만들어졌어요"; a 409 shows the conflict message and reveals/points to the "덮어쓰기" checkbox; writing again with overwrite=true returns `{…,backup_path:'/home/u/CLAUDE.md.bak.…',created:false}` and the success message surfaces the `backup_path` ("백업: …").

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**: a "지침으로 저장…" affordance on the convert result (only shown when a `converted` preview exists). It opens an inline confirm block (NOT a full-screen modal — keep it in the section): a path `<input>` (placeholder `~/CLAUDE.md 또는 절대경로`), an "덮어쓰기" checkbox (default off), and a "저장" button → `envApi.writeInstruction({path,content:converted,overwrite})`. On success: green success line with `path`, `created ? '새로 만들어졌어요' : '덮어썼어요'`, and if `backup_path` show "백업: {backup_path}". On 409 `InstructionExists`: show "이미 있는 파일이에요 — 덮어쓰려면 체크하세요" and do not write. On other 400s (outside home / bad name / too large): show the backend `detail` inline. Never silently succeed; never write without an explicit button click. This is the only mutation in the feature — keep the confirm explicit.

- [ ] **Step 4: Run** → PASS. Full gate.

- [ ] **Step 5: Commit** `git add web/src/features/tooling/EnvToolsPane.tsx web/src/test/tooling-envtools.test.tsx && git commit -m "feat(env): guarded write of AGENTS/CLAUDE instructions (overwrite + backup surfaced)"`

---

## Self-Review

**1. Spec coverage:** inventory view (T2) ✓, instruction matrix + project scan (T3) ✓, migration/convert preview (T4) ✓, instruction write/management (T5) ✓, client for all 4 endpoints (T1) ✓. Placement = new Tooling tab per recon recommendation ✓. codex-gauge and agy-gauge are separate work (not this plan).

**2. Placeholder scan:** no TBD/"handle errors" placeholders — each task names the exact states and copy. Convert uses `content` (not `path`) in MVP to avoid path-handling in preview; write handles path explicitly with backend-enforced allow-list. Test data shapes match the contract verbatim.

**3. Type consistency:** `EnvInventoryAll={clis:[]}`, `EnvInstructionsMatrix={entries:[]}`, `EnvFileEntry.headline`, `EnvConvertResult.{converted,warnings,lossy_fields}`, `EnvWriteResult.{written,path,backup_path,bytes,created}` used consistently across T1→T5. `envApi` method names (`getInventory/getInstructions/convert/writeInstruction`) stable. Pane prop growth is additive per task.

**4. Risk notes for the executor:** (a) confirm `api.tooling.ts` `ApiError` export before reusing (T1 Step 1); (b) the instructions query param is `paths` not `project_paths`; (c) `cli=all` returns `{clis}` while a single cli returns the bare object — `getInventory('all')` is what the pane uses; (d) design-tokens: enforce `var(--…)` by inspection (no automated check script in `web/`).
