import { describe, it, expect } from 'vitest'
import {
  buildDrivePathPlan,
  isDrivePath,
  isPosixPath,
  parseUncWslPath,
  toUncPath,
} from '../src/wsl-paths'

describe('parseUncWslPath', () => {
  it('converts a folder inside the distro to its POSIX path', () => {
    // Live report: the dialog's result went to the server verbatim and produced
    // "Working directory does not exist: \\wsl.localhost\ubuntu\home\me\p".
    expect(parseUncWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\hunesion_workspace\\i-oneNGS')).toEqual({
      distro: 'Ubuntu',
      path: '/home/me/hunesion_workspace/i-oneNGS',
    })
  })

  it('handles the older wsl$ form', () => {
    expect(parseUncWslPath('\\\\wsl$\\Debian\\srv\\app')).toEqual({ distro: 'Debian', path: '/srv/app' })
  })

  it('is case-tolerant about the distro segment it returns', () => {
    // Windows reports the distro with whatever casing the share used; the path
    // after it is what matters.
    expect(parseUncWslPath('\\\\wsl.localhost\\ubuntu\\home\\me')?.path).toBe('/home/me')
  })

  it.each([['C:\\src\\repo'], ['\\\\server\\share\\dir'], ['/home/me/repo'], ['']])(
    'returns null for %j',
    value => {
      expect(parseUncWslPath(value)).toBeNull()
    }
  )
})

describe('path shape checks', () => {
  it.each([['/home/me', true], ['C:\\src', false], ['\\\\wsl.localhost\\Ubuntu\\x', false]])(
    'isPosixPath(%j) === %s',
    (value, expected) => {
      expect(isPosixPath(value as string)).toBe(expected)
    }
  )

  it.each([['C:\\src', true], ['d:/src', true], ['/home/me', false], ['\\\\wsl$\\U\\x', false]])(
    'isDrivePath(%j) === %s',
    (value, expected) => {
      expect(isDrivePath(value as string)).toBe(expected)
    }
  )
})

describe('toUncPath', () => {
  it('renders a POSIX path for a Windows dialog', () => {
    // The renderer stores POSIX paths because that is what the server speaks;
    // handing one to a Windows dialog as the starting folder opens nothing.
    expect(toUncPath('/home/me/projects', 'Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\projects')
  })

  it('survives a leading slash and nested segments', () => {
    expect(toUncPath('/srv/a/b', 'Debian')).toBe('\\\\wsl.localhost\\Debian\\srv\\a\\b')
  })
})

describe('buildDrivePathPlan', () => {
  it('sends a drive path to wslpath', () => {
    const plan = buildDrivePathPlan('C:\\src\\repo', 'Ubuntu')
    expect(plan.command).toBe('wsl.exe')
    expect(plan.args).toEqual(['-d', 'Ubuntu', '--', 'wslpath', '-u', 'C:\\src\\repo'])
  })
})
