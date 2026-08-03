import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ShellSettingsCard } from '../features/desktop/ShellSettingsCard'

afterEach(() => {
  delete (window as { caoNative?: unknown }).caoNative
  vi.restoreAllMocks()
})

const SETTINGS = {
  mode: 'auto',
  fellBackToAuto: false,
  autoResolvesTo: '/bin/zsh',
  restartRequired: true,
  choices: [
    { mode: 'auto', label: '자동', available: true },
    { mode: 'posix:/bin/zsh', label: 'zsh', available: true },
    { mode: 'posix:/bin/fish', label: 'fish', available: false, unavailableReason: '설치되어 있지 않아요' },
    { mode: 'powershell', label: 'PowerShell 7', available: true, caveat: '에이전트 터미널은 WSL 에서 실행됩니다' },
  ],
}

function installBridge(shellConfig: Record<string, unknown>) {
  ;(window as { caoNative?: unknown }).caoNative = { shellConfig }
}

describe('ShellSettingsCard', () => {
  it('renders nothing in a browser', async () => {
    const { container } = render(<ShellSettingsCard />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing when the bridge throws, rather than breaking Settings', async () => {
    installBridge({ get: vi.fn().mockRejectedValue(new Error('ipc gone')) })
    const { container } = render(<ShellSettingsCard />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows what 자동 resolves to instead of leaving it a black box', async () => {
    installBridge({ get: vi.fn().mockResolvedValue(SETTINGS) })
    render(<ShellSettingsCard />)

    expect(await screen.findByText('→ /bin/zsh')).toBeInTheDocument()
  })

  it('disables an uninstalled shell and shows why', async () => {
    installBridge({ get: vi.fn().mockResolvedValue(SETTINGS) })
    render(<ShellSettingsCard />)

    const fish = await screen.findByRole('radio', { name: /fish/ })
    expect(fish).toBeDisabled()
    expect(screen.getByText('설치되어 있지 않아요')).toBeInTheDocument()
  })

  it('surfaces the PowerShell caveat where the choice is made', async () => {
    // Picking PowerShell does not move agent terminals off tmux; the limit has
    // to be visible at the point of choosing, not in a doc.
    installBridge({ get: vi.fn().mockResolvedValue(SETTINGS) })
    render(<ShellSettingsCard />)

    expect(await screen.findByText(/에이전트 터미널은 WSL 에서 실행됩니다/)).toBeInTheDocument()
  })

  it('saves a choice and says a restart is needed', async () => {
    // A running server cannot move into another shell; silence would read as
    // "the setting did not take".
    const set = vi.fn().mockResolvedValue({ ok: true })
    installBridge({ get: vi.fn().mockResolvedValue(SETTINGS), set })
    render(<ShellSettingsCard />)

    fireEvent.click(await screen.findByRole('radio', { name: /^zsh$/ }))

    await waitFor(() => expect(set).toHaveBeenCalledWith('posix:/bin/zsh'))
    expect(await screen.findByText(/서버를 다시 시작하면 적용됩니다/)).toBeInTheDocument()
  })

  it("reports main's rejection instead of pretending the save worked", async () => {
    const set = vi.fn().mockResolvedValue({ ok: false, error: '지금 사용할 수 없는 선택이에요' })
    installBridge({ get: vi.fn().mockResolvedValue(SETTINGS), set })
    render(<ShellSettingsCard />)

    fireEvent.click(await screen.findByRole('radio', { name: /^zsh$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('지금 사용할 수 없는 선택이에요')
    expect(screen.queryByText(/다시 시작하면 적용됩니다/)).not.toBeInTheDocument()
  })

  it('explains a stale choice that was dropped', async () => {
    installBridge({ get: vi.fn().mockResolvedValue({ ...SETTINGS, fellBackToAuto: true }) })
    render(<ShellSettingsCard />)

    expect(await screen.findByRole('status')).toHaveTextContent('자동')
  })
})
