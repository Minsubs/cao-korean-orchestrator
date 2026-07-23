import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewTaskModal } from '../features/workspace/NewTaskModal'
import type { ProjectsData } from '../features/workspace/types'

// NOTE: the brief's sketch (`open`/`profiles`/`onClose`/`onCreate` props) doesn't
// match the real component — NewTaskModal takes `projects`/`defaultTarget`/
// `onClose`/`onCreated` and fetches profiles itself via `api.listProfiles()`
// (GET /agents/profiles), same pattern as AddAgentModal's existing test
// (workspace-add-agent.test.tsx). So this stubs that fetch instead of passing
// profiles as a prop, and awaits the radios since they only appear once the
// profiles response resolves.

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

const EMPTY_PROJECTS: ProjectsData = { groups: [], projects: [], pinned: [] }

function installMockFetch() {
  const mockFetch = vi.fn(async (url: string) => {
    if (url.startsWith('/agents/profiles')) {
      return jsonResponse([
        { name: 'codex_orchestrator_sol', provider: 'codex' },
        { name: 'claude_orchestrator_sonnet', provider: 'claude_code' },
        { name: 'antigravity_orchestrator_agy', provider: 'antigravity_cli' },
      ])
    }
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

describe('NewTaskModal orchestrator choices', () => {
  it('offers Antigravity as a third orchestrator option', async () => {
    installMockFetch()
    render(<NewTaskModal projects={EMPTY_PROJECTS} onClose={() => {}} onCreated={() => {}} />)

    expect(await screen.findByRole('radio', { name: 'Antigravity 오케스트레이터' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Codex 오케스트레이터' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Claude 오케스트레이터' })).toBeInTheDocument()
  })
})
