// api.env.ts — 환경 마이그레이션 & AGENTS.md/CLAUDE.md 지침 관리 API client.
// Phase 6b: read-only CLI environment inventory + instruction matrix, plus
// preview-only format conversion and a guarded instruction write.
//
// Talks to env_router.py (services/env_migration/), mounted at api/main.py:708.
// The contract is fixed — do not add fields the backend doesn't document.
// Mirrors api.tooling.ts's fetchJSON/ApiError/postJSON shape and reuses its
// exported ApiError rather than defining a duplicate.
import type { ApiError } from './api.tooling'

const BASE = ''  // Vite proxy handles routing to backend, same as api.ts

// Env endpoints are plain file-metadata reads/writes (no CLI subprocess
// probing like tooling's provider/catalog scans), so they don't need
// api.tooling.ts's 60s WSL-cold-start allowance — 10s is plenty.
const DEFAULT_TIMEOUT_MS = 10000

async function fetchJSON<T>(url: string, opts?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${url}`, { ...opts, signal: controller.signal })
    if (!res.ok) {
      // Best-effort read of the JSON error body to expose the server's
      // `detail` without leaking a full response. A non-JSON body is fine —
      // detail just stays undefined.
      let detail: string | undefined
      try {
        const body = await res.json()
        if (body && typeof body.detail === 'string') detail = body.detail
      } catch { /* non-JSON error body */ }
      const err: ApiError = new Error(`${res.status} ${res.statusText}`)
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

function postJSON<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  return fetchJSON<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
  })
}

export type EnvCliName = 'claude_code' | 'codex' | 'antigravity'

export interface EnvInventoryItem {
  rel_path: string
  kind: 'instruction' | 'settings' | 'command' | 'agent' | 'prompt' | 'skill' | 'mcp_config'
  size: number
  mtime: string | null
  mcp_servers_present?: boolean
}

export interface EnvInventoryCli {
  cli: string
  present: boolean
  items: EnvInventoryItem[]
  counts: Record<string, number>
  note: string | null
}

export interface EnvInventoryAll {
  clis: EnvInventoryCli[]
}

export interface EnvFileEntry {
  name: string
  exists: boolean
  size: number | null
  mtime: string | null
  sha256: string | null
  headline: string | null
  is_dir?: boolean
  command_count?: number
}

export interface EnvInstructionEntry {
  scope: 'global' | 'project'
  base_path: string
  files?: EnvFileEntry[]
  error?: string
}

export interface EnvInstructionsMatrix {
  entries: EnvInstructionEntry[]
}

export interface EnvConvertBody {
  source_kind: string
  target_kind: string
  /** Exactly one of path/content is expected by the backend. */
  path?: string
  content?: string
}

export interface EnvConvertResult {
  converted: string
  warnings: string[]
  lossy_fields: string[]
}

export interface EnvWriteBody {
  path: string
  content: string
  overwrite?: boolean
}

export interface EnvWriteResult {
  written: true
  path: string
  backup_path: string | null
  bytes: number
  created: boolean
}

export const envApi = {
  getInventory: (cli: 'all' | EnvCliName = 'all') =>
    fetchJSON<EnvInventoryAll | EnvInventoryCli>(`/env/inventory?cli=${cli}`),

  getInstructions: (paths: string[]) =>
    fetchJSON<EnvInstructionsMatrix>(`/env/instructions?${new URLSearchParams({ paths: paths.join(',') })}`),

  convert: (body: EnvConvertBody) => postJSON<EnvConvertResult>('/env/convert', body),

  writeInstruction: (body: EnvWriteBody) => postJSON<EnvWriteResult>('/env/instructions/write', body),
}
