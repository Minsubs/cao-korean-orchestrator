import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Composer, type ComposerTarget } from '../features/workspace/Composer'

// Phase 2e (spec §2e): Composer slash-command dropdown. The critical
// regression guard here is the Enter keymap: it must only be consumed as
// "select from the dropdown" while the dropdown is open — with it closed,
// the existing Cmd/Ctrl+Enter-to-send (and plain-Enter-does-not-send)
// behavior must be byte-for-byte unchanged (see workspace.test.tsx's own
// "sends a Composer message on Cmd+Enter" test for the sibling coverage this
// must never break).

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

const CLAUDE_COMMANDS = [
  { name: '/compact', scope: 'builtin', kind: 'command', description: 'Compact the conversation', interactive: false },
  { name: '/recompact', scope: 'user', kind: 'command', description: 'user-scoped, only an includes match for "comp"', interactive: false },
  { name: '/clear', scope: 'builtin', kind: 'command', description: 'Clear the conversation', interactive: false },
  { name: '/model', scope: 'builtin', kind: 'command', description: 'Switch the active model', interactive: true },
  { name: '/my-skill', scope: 'user', kind: 'skill', description: null, interactive: false },
]

function installMockFetch(commands: unknown = CLAUDE_COMMANDS) {
  const mockFetch = vi.fn(async (url: string) => {
    if (url.startsWith('/ui/slash-commands')) return jsonResponse({ provider: 'claude_code', cwd: '/home/user/project', commands })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

const DEFAULT_TARGET: ComposerTarget = { id: 'aaaaaaaa', label: 'sol · Supervisor' }

// apiUi.getSlashCommands caches by (provider, cwd) for 30s (spec: client
// cache) — a module-level Map that outlives any single test. Giving every
// test its own `cwd` keeps that cache from serving one test's fetch mock
// results (or call count) to a completely different test.
let uniqueCwdCounter = 0

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = overrides.onSend ?? vi.fn()
  const slashCwd = overrides.slashCwd ?? `/home/user/project-${uniqueCwdCounter}`
  return {
    onSend,
    ...render(
      <Composer
        sessionName="sess-1"
        target={DEFAULT_TARGET}
        targets={[DEFAULT_TARGET]}
        onChangeTarget={() => {}}
        onSend={onSend}
        sending={false}
        streamStatus="connected"
        slashProvider="claude_code"
        {...overrides}
        slashCwd={slashCwd}
      />,
    ),
  }
}

describe('Composer slash-command dropdown (Phase 2e spec §2e)', () => {
  beforeEach(() => {
    uniqueCwdCounter += 1
    installMockFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('does not open for ordinary (non-slash) text, and never fetches', () => {
    const mockFetch = installMockFetch()
    renderComposer()
    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: 'hello there' } })
    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/ui/slash-commands'))).toBe(false)
  })

  it('opens on a lone "/" and lists the full command set', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: '/' } })
    expect(screen.getByRole('listbox', { name: '슬래시 명령' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(CLAUDE_COMMANDS.length))
  })

  it('orders startsWith matches before includes-only matches as the user types a filter', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toContain('/compact')
    expect(options[1].textContent).toContain('/recompact')
  })

  it('shows scope, skill, and interactive badges', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: '/my-sk' } })
    const option = await screen.findByRole('option', { name: /\/my-skill/ })
    expect(option.textContent).toContain('사용자')
    expect(option.textContent).toContain('스킬')

    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: '/model' } })
    const modelOption = await screen.findByRole('option', { name: /\/model/ })
    expect(modelOption.textContent).toContain('내장')
    expect(modelOption.textContent).toContain('터미널 대화형')
  })

  it('fetches the command list once per open, never once per keystroke', async () => {
    const mockFetch = installMockFetch()
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '/' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(CLAUDE_COMMANDS.length))
    fireEvent.change(textarea, { target: { value: '/c' } })
    fireEvent.change(textarea, { target: { value: '/co' } })
    fireEvent.change(textarea, { target: { value: '/com' } })
    await waitFor(() => {
      const slashCalls = mockFetch.mock.calls.filter(([u]) => (u as string).startsWith('/ui/slash-commands'))
      expect(slashCalls).toHaveLength(1)
    })
  })

  it('Enter selects the highlighted command, inserting "/name " and closing the dropdown — without sending', async () => {
    const { onSend } = renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await screen.findByRole('option', { name: /\/compact/ })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(textarea.value).toBe('/compact ')
    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Tab selects the same way Enter does', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/cle' } })
    await screen.findByRole('option', { name: /\/clear/ })

    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(textarea.value).toBe('/clear ')
  })

  it('ArrowDown moves the highlighted row, and Enter selects whichever row is highlighted', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2)) // /compact, /recompact

    fireEvent.keyDown(textarea, { key: 'ArrowDown' }) // index 0 (/compact) -> index 1 (/recompact)
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(textarea.value).toBe('/recompact ')
  })

  it('mouse click selects a command', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/cle' } })
    const option = await screen.findByRole('option', { name: /\/clear/ })

    fireEvent.click(option)

    expect(textarea.value).toBe('/clear ')
  })

  it('Escape dismisses the dropdown without touching the typed text', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await screen.findByRole('option', { name: /\/compact/ })

    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
    expect(textarea.value).toBe('/comp')
  })

  it('typing further after an Escape dismissal re-opens the dropdown', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await screen.findByRole('option', { name: /\/compact/ })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()

    fireEvent.change(textarea, { target: { value: '/compa' } })

    expect(screen.getByRole('listbox', { name: '슬래시 명령' })).toBeInTheDocument()
  })

  it('closes the dropdown on blur', async () => {
    renderComposer()
    const textarea = screen.getByLabelText('메시지 입력')
    fireEvent.change(textarea, { target: { value: '/comp' } })
    await screen.findByRole('option', { name: /\/compact/ })

    fireEvent.blur(textarea)

    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
  })

  it('regression guard: with the dropdown CLOSED, Cmd/Ctrl+Enter still sends exactly as before', () => {
    const { onSend } = renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '진행 상황 알려줘' } })
    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()

    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(onSend).toHaveBeenCalledWith('진행 상황 알려줘')
    expect(textarea.value).toBe('')
  })

  it('regression guard: with the dropdown CLOSED, plain Enter does not send (unchanged no-op passthrough)', () => {
    const { onSend } = renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '진행 상황 알려줘' } })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('Cmd/Ctrl+Enter still sends even while a slash dropdown is open (an explicit "send now" always wins)', async () => {
    const { onSend } = renderComposer()
    const textarea = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/compact' } })
    await screen.findByRole('option', { name: /\/compact/ })

    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(onSend).toHaveBeenCalledWith('/compact')
  })

  it('disables the feature entirely for a provider the backend cannot enumerate — no dropdown, no fetch', () => {
    const mockFetch = installMockFetch()
    renderComposer({ slashProvider: 'kiro_cli' })
    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: '/compact' } })

    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/ui/slash-commands'))).toBe(false)
  })

  it('disables the feature when no context terminal/provider is known yet', () => {
    const mockFetch = installMockFetch()
    renderComposer({ slashProvider: null })
    fireEvent.change(screen.getByLabelText('메시지 입력'), { target: { value: '/compact' } })

    expect(screen.queryByRole('listbox', { name: '슬래시 명령' })).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([u]) => (u as string).startsWith('/ui/slash-commands'))).toBe(false)
  })
})
