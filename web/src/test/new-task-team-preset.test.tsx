import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NewTaskModal } from '../features/workspace/NewTaskModal'
import type { ProjectsData } from '../features/workspace/types'

// User-reported: picking many agents made the first answer take minutes, and the
// modal never said so. The default is the whole 기본 팀, so most runs hit the slow
// path unchosen — and the only way to reduce it was buried inside 고급.
//
// These pin the visible control and that the hint tracks the real submit rule
// (delegatableCandidates with presetChecks === true), not a separate count.

const PROJECTS: ProjectsData = { groups: [], projects: [], pinned: [] }

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

function mountModal() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/agents/profiles')) {
        return jsonResponse([
          { name: 'codex_orchestrator_sol', provider: 'codex' },
          { name: 'claude_scout_haiku', provider: 'claude_code' },
          { name: 'claude_architect_opus', provider: 'claude_code' },
          { name: 'claude_developer_sonnet', provider: 'claude_code' },
          { name: 'codex_qa_terra', provider: 'codex' },
        ])
      }
      return jsonResponse([])
    }),
  )
  return render(<NewTaskModal projects={PROJECTS} onClose={() => {}} onCreated={() => {}} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('NewTaskModal team preset + size hint', () => {
  it('shows the preset controls without expanding 고급', async () => {
    mountModal()
    expect(await screen.findByRole('button', { name: '오케스트레이터만' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '기본 팀' })).toBeTruthy()
  })

  it('warns about the wait while the default full team is selected', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText(/개 역할에 나눠 위임해요/)).toBeTruthy())
    expect(screen.getByText(/몇 분/)).toBeTruthy()
  })

  it('오케스트레이터만 drops every delegate and switches the explanation', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText(/몇 분/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '오케스트레이터만' }))

    expect(screen.getByText(/직접 처리/)).toBeTruthy()
    expect(screen.queryByText(/몇 분/)).toBeNull()
    expect(screen.getByText('위임 후보 0개')).toBeTruthy()
  })

  it('기본 팀 restores the delegates after clearing them', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText(/몇 분/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '오케스트레이터만' }))
    expect(screen.getByText('위임 후보 0개')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '기본 팀' }))
    expect(screen.queryByText('위임 후보 0개')).toBeNull()
    expect(screen.getByText(/몇 분/)).toBeTruthy()
  })

  it('marks which preset is active for assistive tech', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByRole('button', { name: '기본 팀' })).toBeTruthy())
    expect(screen.getByRole('button', { name: '기본 팀' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '오케스트레이터만' }))
    expect(screen.getByRole('button', { name: '오케스트레이터만' })).toHaveAttribute('aria-pressed', 'true')
  })
})
