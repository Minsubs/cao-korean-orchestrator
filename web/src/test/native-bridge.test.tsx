/**
 * The desktop bridge as seen from the web build.
 *
 * The browser stays a first-class target, so every case here has a "no bridge"
 * counterpart: the point is not that the native path works, it is that its
 * absence changes nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { DesktopChip } from '../features/desktop/DesktopChip'
import { DirectoryPicker } from '../features/workspace/DirectoryPicker'
import { fetchAppInfo, getNative, hasNative, openExternal, pickDirectoryNative } from '../native'

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { caoNative?: unknown }).caoNative
  vi.restoreAllMocks()
})

function installBridge(bridge: Record<string, unknown>) {
  ;(window as { caoNative?: unknown }).caoNative = bridge
}

describe('capability detection', () => {
  it('reports no bridge in a plain browser', () => {
    expect(getNative()).toBeNull()
    expect(hasNative('pickDirectory')).toBe(false)
  })

  it('detects per method, not per app', () => {
    // An older shell may expose a smaller contract than this build knows about.
    installBridge({ openExternal: () => {} })

    expect(hasNative('openExternal')).toBe(true)
    expect(hasNative('pickDirectory')).toBe(false)
  })

  it('ignores a non-function of the right name', () => {
    installBridge({ pickDirectory: 'yes please' })
    expect(hasNative('pickDirectory')).toBe(false)
  })
})

describe('pickDirectoryNative', () => {
  it('reports unsupported rather than failing when there is no bridge', async () => {
    await expect(pickDirectoryNative()).resolves.toEqual({ supported: false })
  })

  it('passes the initial path through and returns the choice', async () => {
    const pickDirectory = vi.fn().mockResolvedValue('/home/dev/projects')
    installBridge({ pickDirectory })

    await expect(pickDirectoryNative('/home/dev')).resolves.toEqual({
      supported: true,
      path: '/home/dev/projects',
    })
    expect(pickDirectory).toHaveBeenCalledWith('/home/dev')
  })

  it('treats a cancelled dialog as a real answer, not a failure', async () => {
    installBridge({ pickDirectory: vi.fn().mockResolvedValue(null) })
    await expect(pickDirectoryNative()).resolves.toEqual({ supported: true, path: null })
  })

  it('falls back when the bridge throws', async () => {
    // A broken bridge must not strand the user: the web picker still works.
    installBridge({ pickDirectory: vi.fn().mockRejectedValue(new Error('ipc gone')) })
    await expect(pickDirectoryNative()).resolves.toEqual({ supported: false })
  })
})

describe('openExternal', () => {
  it('uses window.open in a browser', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)

    openExternal('https://example.dev')

    expect(open).toHaveBeenCalledWith('https://example.dev', '_blank', 'noopener,noreferrer')
  })

  it('routes through the bridge in the desktop app', () => {
    // target=_blank would try to open a window inside Electron, which main
    // refuses; the bridge hands it to the real browser instead.
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const bridgeOpen = vi.fn()
    installBridge({ openExternal: bridgeOpen })

    openExternal('https://example.dev')

    expect(bridgeOpen).toHaveBeenCalledWith('https://example.dev')
    expect(open).not.toHaveBeenCalled()
  })
})

describe('fetchAppInfo', () => {
  it('is null in a browser', async () => {
    await expect(fetchAppInfo()).resolves.toBeNull()
  })

  it('is null when the bridge throws', async () => {
    installBridge({ appInfo: vi.fn().mockRejectedValue(new Error('nope')) })
    await expect(fetchAppInfo()).resolves.toBeNull()
  })
})

describe('DirectoryPicker', () => {
  it('shows the in-app browser when there is no bridge', async () => {
    render(<DirectoryPicker onClose={() => {}} onSelect={() => {}} />)
    expect(await screen.findByRole('dialog', { name: '폴더 선택' })).toBeInTheDocument()
  })

  it('opens the OS dialog instead of the modal, and never renders both', async () => {
    const pickDirectory = vi.fn().mockResolvedValue('/home/dev/chosen')
    installBridge({ pickDirectory })
    const onSelect = vi.fn()

    render(<DirectoryPicker initialPath="/home/dev" onClose={() => {}} onSelect={onSelect} />)

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('/home/dev/chosen'))
    expect(screen.queryByRole('dialog', { name: '폴더 선택' })).not.toBeInTheDocument()
  })

  it('closes without selecting when the OS dialog is cancelled', async () => {
    installBridge({ pickDirectory: vi.fn().mockResolvedValue(null) })
    const onClose = vi.fn()
    const onSelect = vi.fn()

    render(<DirectoryPicker onClose={onClose} onSelect={onSelect} />)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('falls back to the modal when the bridge throws mid-flight', async () => {
    installBridge({ pickDirectory: vi.fn().mockRejectedValue(new Error('ipc gone')) })

    render(<DirectoryPicker onClose={() => {}} onSelect={() => {}} />)

    expect(await screen.findByRole('dialog', { name: '폴더 선택' })).toBeInTheDocument()
  })
})

describe('DesktopChip', () => {
  it('renders nothing in a browser', () => {
    const { container } = render(<DesktopChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says the app owns the server when it spawned one', async () => {
    installBridge({
      appInfo: vi.fn().mockResolvedValue({
        platform: 'darwin',
        version: '0.1.0',
        serverMode: 'spawned',
        port: 9889,
      }),
    })

    render(<DesktopChip />)

    expect(await screen.findByText('macOS')).toBeInTheDocument()
    expect(screen.getByText('앱이 서버 실행 중')).toBeInTheDocument()
  })

  it('distinguishes an attached server, which outlives the window', async () => {
    installBridge({
      appInfo: vi.fn().mockResolvedValue({
        platform: 'win32',
        version: '0.1.0',
        serverMode: 'attached',
        port: 9890,
        distro: 'Ubuntu',
      }),
    })

    render(<DesktopChip />)

    expect(await screen.findByText('Windows')).toBeInTheDocument()
    expect(screen.getByText('실행 중인 서버에 연결됨')).toBeInTheDocument()
    expect(screen.getByTitle(/Ubuntu · 실행 중인 서버에 연결됨 · 포트 9890/)).toBeInTheDocument()
  })
})
