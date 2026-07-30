import { describe, expect, it } from 'vitest'

// Phase 6 로딩 상태 일관화.
//
// The loading *pattern* was already consistent across the app (Loader2 +
// animate-spin + "불러오는 중"). What was not consistent was the ellipsis: 22
// progress labels used three ASCII dots while newer surfaces used the real
// ellipsis character. Mixed on one screen it reads as sloppy, and it is exactly
// the kind of thing that drifts back the next time someone types "...".
//
// Guarded at the source-text level rather than per-component, because the drift
// is textual and spread across a dozen files. `…` (U+2026) is the target — what
// the newer surfaces already used.
//
// Sources are pulled through Vite's import.meta.glob (raw) rather than node:fs:
// this project's web/tsconfig.json is browser-only and carries no @types/node,
// so fs/path/__dirname do not type-check here.
const sources = import.meta.glob('../{app,components,features}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('loading copy uses one ellipsis convention', () => {
  it('finds source files to check (guards against a broken glob silently passing)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('never spells a progress label with three ASCII dots', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, index) => {
        // "…중..." — a Korean progress label ending in ASCII dots.
        if (/중\.\.\./.test(line)) offenders.push(`${path}:${index + 1}  ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
