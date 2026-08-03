import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl, normalizeInitialPath } from '../src/bridge-guards'

describe('isSafeExternalUrl', () => {
  it('accepts https', () => {
    expect(isSafeExternalUrl('https://github.com/Minsubs/cao-korean-orchestrator')).toBe(true)
  })

  it.each([
    ['javascript:alert(1)', 'script scheme'],
    ['data:text/html,<script>alert(1)</script>', 'inline document'],
    ['file:///etc/passwd', 'local file'],
    ['http://example.com', 'plaintext'],
  ])('rejects %s (%s)', url => {
    // The renderer displays agent output and catalog entries, so a URL reaching
    // this handler is not necessarily one we wrote.
    expect(isSafeExternalUrl(url)).toBe(false)
  })

  it.each([[''], ['not a url'], ['//example.com']])('rejects unparseable %j', value => {
    expect(isSafeExternalUrl(value)).toBe(false)
  })

  it.each([[null], [undefined], [42], [{ toString: () => 'https://x.dev' }]])(
    'rejects non-string %j',
    value => {
      // An object with a toString would sail through a naive string coercion.
      expect(isSafeExternalUrl(value)).toBe(false)
    }
  )
})

describe('normalizeInitialPath', () => {
  it('passes a real path through', () => {
    expect(normalizeInitialPath('/home/dev/projects')).toBe('/home/dev/projects')
  })

  it.each([[''], ['   '], [null], [undefined], [7]])('treats %j as no preference', value => {
    expect(normalizeInitialPath(value)).toBeUndefined()
  })
})
