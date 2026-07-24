import { test, expect } from 'vitest'
import { CONVERT_PAIRS, formatBytes, formatMtime, KIND_LABELS } from '../features/tooling/envtools'

// Phase 6b Task 2 — pure helpers backing EnvToolsPane's CLI inventory section.
// Companion pane/tab test: test/tooling-envtools.test.tsx.
//
// Phase 6b Task 4 adds CONVERT_PAIRS — the exact 4 (source_kind, target_kind)
// pairs the backend's /env/convert supports (services/env_migration). Any
// other pair combination is a backend 400 UnsupportedConversion, so this list
// is the client-side menu, not an open-ended guess.

test('formatBytes', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1024)).toBe('1.0 KB')
  expect(formatBytes(1536)).toBe('1.5 KB')
})

test('formatMtime null → dash', () => {
  expect(formatMtime(null)).toBe('—')
})

test('kind labels are Korean', () => {
  expect(KIND_LABELS.instruction).toBe('지침')
  expect(KIND_LABELS.mcp_config).toBe('MCP 설정')
})

test('CONVERT_PAIRS is exactly the 4 backend-supported conversions', () => {
  expect(CONVERT_PAIRS).toHaveLength(4)
  for (const pair of CONVERT_PAIRS) {
    expect(pair.label.trim().length).toBeGreaterThan(0)
    expect(pair.source_kind.trim().length).toBeGreaterThan(0)
    expect(pair.target_kind.trim().length).toBeGreaterThan(0)
  }
  expect(CONVERT_PAIRS).toEqual([
    { source_kind: 'claude_agent', target_kind: 'cao_profile', label: 'Claude 에이전트 → CAO 프로필' },
    { source_kind: 'claude_command', target_kind: 'codex_prompt', label: 'Claude 명령 → Codex 프롬프트' },
    { source_kind: 'codex_prompt', target_kind: 'claude_command', label: 'Codex 프롬프트 → Claude 명령' },
    { source_kind: 'instruction', target_kind: 'counterpart_instruction', label: 'CLAUDE.md ↔ AGENTS.md' },
  ])
})
