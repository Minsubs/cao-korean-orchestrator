import { describe, expect, it } from 'vitest'
import { providerAccent } from '../features/profiles/providerAccent'

describe('providerAccent', () => {
  it('maps known providers to CSS var tokens (no hardcoded hex)', () => {
    for (const p of ['codex', 'claude_code', 'antigravity_cli']) {
      const a = providerAccent(p)
      expect(a.bg).toMatch(/^var\(--prov-/)
      expect(a.fg).toMatch(/^var\(--prov-/)
    }
  })
  it('falls back to neutral tokens for unknown providers', () => {
    const a = providerAccent('something_else')
    expect(a.bg).toMatch(/^var\(--/)
    expect(a.fg).toMatch(/^var\(--/)
  })
})
