/**
 * Defensive normalisation of Windows paths on their way to the server.
 *
 * The shell converts folder-dialog results now, but paths already saved in
 * localStorage keep the old `\\wsl.localhost\…` form, and an app build without
 * that fix keeps producing them. Both still reach session creation, which is
 * where they fail.
 */
import { describe, it, expect } from 'vitest'
import { needsShellTranslation, normalizeServerPath } from '../features/workspace/serverPath'

describe('normalizeServerPath', () => {
  it('converts the path from the reported failure', () => {
    expect(normalizeServerPath('\\\\wsl.localhost\\ubuntu\\home\\minsub57\\hunesion_workspace\\i-oneNGS')).toBe(
      '/home/minsub57/hunesion_workspace/i-oneNGS'
    )
  })

  it('handles the older wsl$ form', () => {
    expect(normalizeServerPath('\\\\wsl$\\Debian\\srv\\app')).toBe('/srv/app')
  })

  it('gives the distro root when nothing follows it', () => {
    expect(normalizeServerPath('\\\\wsl.localhost\\Ubuntu')).toBe('/')
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(normalizeServerPath('  \\\\wsl.localhost\\Ubuntu\\home\\me  ')).toBe('/home/me')
  })

  it('leaves a POSIX path exactly as it is', () => {
    expect(normalizeServerPath('/home/me/project')).toBe('/home/me/project')
  })

  it('leaves ~ and relative paths alone', () => {
    expect(normalizeServerPath('~/work/app')).toBe('~/work/app')
  })

  it('passes a drive path through untouched', () => {
    // Converting C:\ needs wslpath, which only the shell can run. Guessing here
    // would replace the server's accurate error with our invention.
    expect(normalizeServerPath('C:\\src\\repo')).toBe('C:\\src\\repo')
  })

  it('is not fooled by an ordinary network share', () => {
    expect(normalizeServerPath('\\\\fileserver\\share\\dir')).toBe('\\\\fileserver\\share\\dir')
  })
})

describe('needsShellTranslation', () => {
  it.each([['C:\\src', true], ['d:/x', true], ['/home/me', false], ['\\\\wsl$\\U\\x', false]])(
    '%j → %s',
    (value, expected) => {
      expect(needsShellTranslation(value as string)).toBe(expected)
    }
  )
})
