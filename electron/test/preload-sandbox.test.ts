/**
 * Guards the one preload rule that no unit test can catch by importing the
 * module: a sandboxed preload may not require anything but `electron`.
 *
 * The first packaged run failed exactly here — `require('./bridge-contract')`
 * threw `module not found`, the preload died, and `window.caoNative` was simply
 * absent. Main logged nothing; the app looked like an ordinary browser. So this
 * test reads the source instead of executing it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHANNELS } from '../src/bridge-contract'

const PRELOAD = readFileSync(join(__dirname, '..', 'src', 'preload.ts'), 'utf8')

/** `import ... from '...'` statements that survive compilation. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /^import\s+(type\s+)?([\s\S]*?)from\s+'([^']+)'/gm
  for (const match of source.matchAll(pattern)) {
    const isTypeOnly = Boolean(match[1]) || /^\s*type\s/.test(match[2] ?? '')
    if (!isTypeOnly) specifiers.push(match[3] ?? '')
  }
  return specifiers
}

describe('preload sandbox constraints', () => {
  it('requires nothing but electron at runtime', () => {
    expect(runtimeImports(PRELOAD)).toEqual(['electron'])
  })

  it('imports the contract for types only', () => {
    // Type-only imports are erased, so they are safe — but they must stay
    // type-only.
    expect(PRELOAD).toContain("import type * as Contract from './bridge-contract'")
  })

  it('carries every channel as an inline literal', () => {
    // Drift is caught by tsc (CHANNELS is `as const`), but a missing channel
    // would mean a bridge method that silently never reaches main.
    for (const channel of Object.values(CHANNELS)) {
      expect(PRELOAD).toContain(`'${channel}'`)
    }
  })
})
