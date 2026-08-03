import { describe, it, expect } from 'vitest'
import {
  buildCaoHomeProbePlan,
  needsSafeCaoHome,
  parseCaoHomeProbe,
  safeCaoHome,
} from '../src/cao-home'

describe('buildCaoHomeProbePlan', () => {
  it('falls back down the path, since the home may not exist yet', () => {
    // ~/.aws itself can be the symlink onto the Windows mount, so statting
    // $HOME alone would answer for the wrong filesystem.
    const script = buildCaoHomeProbePlan().args.at(-1) ?? ''
    expect(script).toContain('$HOME/.aws/cli-agent-orchestrator')
    expect(script.match(/stat -f -c %T/g)).toHaveLength(3)
  })

  it('uses no variable assignments, which the interop path swallows', () => {
    // Measured: `p=$HOME/.aws; echo [$p]` through wsl.exe prints `[]`.
    expect(buildCaoHomeProbePlan().args.at(-1) ?? '').not.toMatch(/[a-z_]+=\$/)
  })

  it('uses no double quotes, which wsl.exe argv passing mangles', () => {
    expect(buildCaoHomeProbePlan().args.at(-1) ?? '').not.toContain('"')
  })

  it('targets the chosen distro', () => {
    expect(buildCaoHomeProbePlan('Ubuntu').args.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--'])
  })
})

describe('parseCaoHomeProbe', () => {
  it('reads both fields', () => {
    expect(parseCaoHomeProbe('HOME=/home/dev\nFS=9p\n')).toEqual({ home: '/home/dev', fsType: '9p' })
  })

  it('tolerates login-shell noise around the output', () => {
    // A login shell can print motd or rc chatter before our echoes.
    expect(parseCaoHomeProbe('some banner\nHOME=/home/dev\nFS=ext2/ext3\n')).toEqual({
      home: '/home/dev',
      fsType: 'ext2/ext3',
    })
  })

  it('returns null when the probe produced nothing usable', () => {
    expect(parseCaoHomeProbe('bash: stat: command not found')).toBeNull()
  })
})

describe('needsSafeCaoHome', () => {
  it.each([['9p'], ['v9fs'], ['drvfs'], ['cifs'], ['NTFS']])('overrides on %s', fsType => {
    // Windows filesystems seen from WSL cannot host FIFOs; mkfifo fails with
    // ENOTSUP and only session creation reveals it.
    expect(needsSafeCaoHome(fsType)).toBe(true)
  })

  it.each([['ext2/ext3'], ['btrfs'], ['xfs'], ['overlayfs']])('leaves %s alone', fsType => {
    // Overriding a home that already works would move a working user's data.
    expect(needsSafeCaoHome(fsType)).toBe(false)
  })
})

describe('safeCaoHome', () => {
  it('lands inside the distro filesystem', () => {
    expect(safeCaoHome('/home/dev')).toBe('/home/dev/.local/share/cao-home')
  })

  it('does not double a trailing slash', () => {
    expect(safeCaoHome('/home/dev/')).toBe('/home/dev/.local/share/cao-home')
  })
})
