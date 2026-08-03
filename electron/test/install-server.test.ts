import { describe, it, expect } from 'vitest'
import {
  buildInstallPlan,
  buildNpmLookupPlan,
  buildUvLookupPlan,
  parseBinaryPath,
  buildWslPathPlan,
  parseUncWslPath,
  summarizeInstall,
  verifyCheckout,
} from '../src/install-server'

const GOOD_PYPROJECT = '[project]\nname = "cli-agent-orchestrator"\nversion = "2.3.0"\n'

describe('verifyCheckout', () => {
  it('accepts a real checkout', () => {
    expect(verifyCheckout(() => true, GOOD_PYPROJECT)).toEqual({ ok: true })
  })

  it('rejects a folder missing the package directory', () => {
    expect(verifyCheckout(p => p === 'pyproject.toml', GOOD_PYPROJECT)).toEqual({
      ok: false,
      reason: 'missing-marker',
    })
  })

  it('rejects some other Python project', () => {
    // Every Python project has a pyproject.toml; installing a random one fails
    // late and confusingly.
    expect(verifyCheckout(() => true, '[project]\nname = "something-else"\n')).toEqual({
      ok: false,
      reason: 'wrong-project',
    })
  })

  it('rejects a folder with no pyproject at all', () => {
    expect(verifyCheckout(() => true, null)).toEqual({ ok: false, reason: 'wrong-project' })
  })
})

describe('buildInstallPlan', () => {
  it('installs the checkout, never the PyPI package', () => {
    // `uv tool install cli-agent-orchestrator` would fetch upstream CAO and
    // produce a server missing everything this fork adds.
    const plan = buildInstallPlan({ wslCheckoutPath: '/home/dev/repo', uvPath: '/usr/bin/uv', needsWebBuild: false, distro: 'Ubuntu' })
    const script = plan.args[plan.args.length - 1] ?? ''

    expect(plan.command).toBe('wsl.exe')
    expect(plan.args.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--'])
    // --reinstall matters: plain `tool install .` is a no-op when the same
    // version is already installed, so a rebuilt UI never lands.
    expect(script).toContain("'/usr/bin/uv' tool install --reinstall .")
    expect(script).not.toContain('cli-agent-orchestrator')
  })

  it('runs through a login shell so uv itself is on PATH', () => {
    expect(buildInstallPlan({ wslCheckoutPath: '/home/dev/repo', uvPath: '/usr/bin/uv', needsWebBuild: false }).args).toContain('-lc')
  })

  it('quotes a path with spaces', () => {
    const script = buildInstallPlan({ wslCheckoutPath: '/home/dev/my repo', uvPath: '/usr/bin/uv', needsWebBuild: false }).args.at(-1) ?? ''
    expect(script).toContain("cd '/home/dev/my repo'")
  })

  it('omits the distro flag when none is chosen', () => {
    expect(buildInstallPlan({ wslCheckoutPath: '/home/dev/repo', uvPath: '/usr/bin/uv', needsWebBuild: false }).args.slice(0, 1)).toEqual(['--'])
  })
})

describe('buildWslPathPlan', () => {
  it('delegates UNC and drive paths to wslpath', () => {
    // \\wsl.localhost\Ubuntu\... cannot be cd'd into, and C:\ needs /mnt/c.
    const plan = buildWslPathPlan('\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo')
    expect(plan.args).toContain('wslpath')
    expect(plan.args.at(-1)).toBe('\\\\wsl.localhost\\Ubuntu\\home\\dev\\repo')
  })
})

describe('summarizeInstall', () => {
  it('reports success', () => {
    expect(summarizeInstall(0, 'Installed 1 executable: cao-server')).toMatchObject({ ok: true })
  })

  it('surfaces the tail of a failure, where the reason lives', () => {
    const output = ['line1', 'line2', 'line3', 'line4', 'error: no such option'].join('\n')
    const result = summarizeInstall(1, output)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('error: no such option')
    expect(result.message).not.toContain('line1')
  })

  it('still says something when the process produced no output', () => {
    expect(summarizeInstall(127, '   ')).toMatchObject({ ok: false, message: expect.stringContaining('127') })
  })
})

describe('parseUncWslPath', () => {
  it('reads the distro and the POSIX path out of a wsl.localhost path', () => {
    // Measured failure this exists for: wslpath turned
    // \\wsl.localhost\Ubuntu\home\me\repo into
    // /mnt/c/wsl.localhostUbuntuhomemerepo and the install cd'd nowhere.
    expect(parseUncWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo')).toEqual({
      distro: 'Ubuntu',
      path: '/home/me/repo',
    })
  })

  it('handles the older wsl$ form', () => {
    expect(parseUncWslPath('\\\\wsl$\\Debian\\srv\\app')).toEqual({
      distro: 'Debian',
      path: '/srv/app',
    })
  })

  it('returns the distro root when nothing follows it', () => {
    expect(parseUncWslPath('\\\\wsl.localhost\\Ubuntu')).toEqual({ distro: 'Ubuntu', path: '/' })
  })

  it.each([['C:\\src\\repo'], ['\\\\server\\share\\repo'], ['/home/me/repo'], ['']])(
    'leaves %j to wslpath',
    input => {
      expect(parseUncWslPath(input)).toBeNull()
    }
  )
})

describe('uv lookup', () => {
  it('checks PATH first, then the known install locations', () => {
    // The login shell wsl.exe starts inherits nothing, so a uv put on PATH by an
    // interactive rc (linuxbrew's shellenv, typically) is invisible — measured:
    // `command -v uv` works inside WSL and fails through wsl.exe.
    const script = buildUvLookupPlan().args.at(-1) ?? ''
    expect(script).toContain('command -v uv')
    expect(script).toContain('/home/linuxbrew/.linuxbrew/bin/uv')
    expect(script).toContain('$HOME/.local/bin/uv')
    // No double quotes: Node's Windows command-line quoting mangles them on the
    // way to wsl.exe. Measured — the quoted form returned exit 1 and no output
    // where the unquoted one printed the path.
    expect(script).not.toContain('"')
  })

  it('targets the chosen distro', () => {
    expect(buildUvLookupPlan('Ubuntu').args.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--'])
  })

  it('takes the first non-empty line of output', () => {
    expect(parseBinaryPath('\n/home/linuxbrew/.linuxbrew/bin/uv\n')).toBe('/home/linuxbrew/.linuxbrew/bin/uv')
  })

  it('reports absence rather than an empty command', () => {
    expect(parseBinaryPath('   \n\n')).toBeNull()
  })
})

describe('web build step', () => {
  const inputs = {
    wslCheckoutPath: '/home/dev/repo',
    uvPath: '/usr/bin/uv',
    npmPath: '/home/linuxbrew/.linuxbrew/bin/npm',
    needsWebBuild: true,
  }

  it('builds the UI before installing when the bundle is missing', () => {
    // Without it the install succeeds and the app then shows
    // {"detail":"Not Found"} — a broken-looking app from a missing build step.
    const script = buildInstallPlan(inputs).args.at(-1) ?? ''
    expect(script).toContain('npm')
    expect(script.indexOf('run build')).toBeLessThan(script.indexOf('tool install --reinstall .'))
  })

  it("puts npm's own directory first on PATH so its node wins", () => {
    const script = buildInstallPlan(inputs).args.at(-1) ?? ''
    // Fully quoted and interop-free: an unquoted :$PATH pulls in Windows entries
    // like /mnt/c/Program Files (x86)/… and bash dies on the parenthesis.
    expect(script).toContain("export PATH='/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin'")
    expect(script).not.toContain(':$PATH')
  })

  it('skips the build entirely when the bundle is already there', () => {
    const script = buildInstallPlan({ ...inputs, needsWebBuild: false }).args.at(-1) ?? ''
    expect(script).not.toContain('run build')
  })
})

describe('parseBinaryPath', () => {
  it('rejects a Windows binary reached through interop', () => {
    // WSL puts the Windows PATH on the Linux PATH, so `command -v npm` answers
    // /mnt/c/Program Files/nodejs/npm on a distro with no Linux node at all.
    expect(parseBinaryPath('/mnt/c/Program Files/nodejs/npm\n')).toBeNull()
  })

  it('takes a real distro path', () => {
    expect(parseBinaryPath('/mnt/c/Program Files/nodejs/npm\n/usr/bin/npm\n')).toBe('/usr/bin/npm')
  })
})

describe('buildNpmLookupPlan', () => {
  it('includes nvm and linuxbrew locations', () => {
    const script = buildNpmLookupPlan().args.at(-1) ?? ''
    expect(script).toContain('.nvm/versions/node/*/bin/npm')
    expect(script).toContain('/home/linuxbrew/.linuxbrew/bin/npm')
  })
})

describe('lookup does not short-circuit on a Windows hit', () => {
  it('emits both PATH and candidate results', () => {
    // `command -v npm ||  ls …` never reaches the fallback, because the Windows
    // npm on the interop PATH makes the first half succeed. Measured: the real
    // npm sat in nvm, unused, and the build step was skipped.
    const script = buildNpmLookupPlan().args.at(-1) ?? ''
    expect(script).not.toContain('||')
    expect(script).toContain('command -v npm;')
    expect(script).toContain('sort -Vr')
    expect(script).toContain('.nvm/versions/node/*/bin/npm')
  })
})
