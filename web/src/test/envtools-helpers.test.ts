import { test, expect } from 'vitest'
import { formatBytes, formatMtime, KIND_LABELS } from '../features/tooling/envtools'

// Phase 6b Task 2 — pure helpers backing EnvToolsPane's CLI inventory section.
// Companion pane/tab test: test/tooling-envtools.test.tsx.

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
