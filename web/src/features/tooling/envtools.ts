// envtools.ts — pure display helpers for EnvToolsPane's CLI inventory section
// (Phase 6b Task 2). No fetch/state here — see api.env.ts for the client and
// ToolingView.tsx for the load/error wiring.

/** `n` bytes → "0 B" / "1.0 KB" / "1.5 MB" — one decimal once we're past bytes. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** `null` (unknown mtime) → an em dash; otherwise a localized short date/time. */
export function formatMtime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR')
}

/** Korean labels for `EnvInventoryItem.kind` (services/env_migration/inventory.py). */
export const KIND_LABELS: Record<string, string> = {
  instruction: '지침',
  settings: '설정',
  command: '명령',
  agent: '에이전트',
  prompt: '프롬프트',
  skill: '스킬',
  mcp_config: 'MCP 설정',
}

/**
 * Phase 6b Task 4 — the exact (source_kind, target_kind) pairs
 * `POST /env/convert` supports (services/env_migration). Any other
 * combination is a backend 400 `UnsupportedConversion`, so this is the
 * client-side menu, not an open-ended guess — do not add pairs the backend
 * doesn't document.
 */
export interface ConvertPair {
  source_kind: string
  target_kind: string
  label: string
}

export const CONVERT_PAIRS: ConvertPair[] = [
  { source_kind: 'claude_agent', target_kind: 'cao_profile', label: 'Claude 에이전트 → CAO 프로필' },
  { source_kind: 'claude_command', target_kind: 'codex_prompt', label: 'Claude 명령 → Codex 프롬프트' },
  { source_kind: 'codex_prompt', target_kind: 'claude_command', label: 'Codex 프롬프트 → Claude 명령' },
  { source_kind: 'instruction', target_kind: 'counterpart_instruction', label: 'CLAUDE.md ↔ AGENTS.md' },
]
