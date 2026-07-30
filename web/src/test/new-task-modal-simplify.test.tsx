import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NewTaskModal } from '../features/workspace/NewTaskModal'
import type { ProjectsData } from '../features/workspace/types'

// spec §4e (모달 간결화) + Phase 6 (비활성 사유 안내). Asserts the surface a user
// meets first: only 작업 지시 + 오케스트레이터 선택 are expanded, the team
// pickers sit behind a collapsed 고급 section, and the greyed-out 작업 시작
// button says why it is greyed out.

const PROJECTS: ProjectsData = { groups: [], projects: [], pinned: [] }

// `/agents/profiles` returns a bare array (see new-task-orchestrator.test.tsx).
function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountModal() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/agents/profiles')) {
        return jsonResponse([
          { name: 'codex_orchestrator_sol', provider: 'codex' },
          { name: 'codex_qa_terra', provider: 'codex' },
        ])
      }
      return jsonResponse([])
    }),
  )
  return render(<NewTaskModal projects={PROJECTS} onClose={() => {}} onCreated={() => {}} />)
}

describe('NewTaskModal — 간결화된 기본 노출', () => {
  it('keeps the team pickers behind a collapsed 고급 section', async () => {
    const { container } = mountModal()
    await waitFor(() => expect(screen.getByText('고급 — 팀 구성 바꾸기')).toBeTruthy())

    const advanced = [...container.querySelectorAll('details')].find(
      el => el.querySelector('summary')?.textContent?.includes('고급'),
    )
    expect(advanced).toBeTruthy()
    // `open` absent = collapsed. The content still exists in the DOM, which is
    // exactly why this has to be asserted on the attribute, not by query.
    expect(advanced!.hasAttribute('open')).toBe(false)
  })

  it('keeps the instruction field and the orchestrator choice expanded', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText('작업 지시 — 무엇을 할까요?')).toBeTruthy())
    expect(screen.getByRole('radiogroup', { name: '오케스트레이터 실행 AI' })).toBeTruthy()
  })

  it('drops the internal-jargon wording about profile IDs', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText('고급 — 팀 구성 바꾸기')).toBeTruthy())
    expect(screen.queryByText(/내부 프로필 ID/)).toBeNull()
  })

  // Phase 6 내부용어 정리: the orchestrator cards used to print the raw profile
  // id (codex_orchestrator_sol …) under each description. Internal identifiers
  // are not user-facing copy.
  it('never prints a raw orchestrator profile id on the cards', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Codex 오케스트레이터' })).toBeTruthy())
    expect(screen.queryByText('codex_orchestrator_sol')).toBeNull()
    expect(screen.queryByText('claude_orchestrator_opus')).toBeNull()
    expect(screen.queryByText('antigravity_orchestrator_agy')).toBeNull()
  })

  it('still says so when the orchestrator profile is not installed', async () => {
    mountModal()
    // Only codex_orchestrator_sol is installed in the harness, so the Claude and
    // Antigravity cards must keep their honest unavailable wording.
    await waitFor(() => expect(screen.getAllByText('프로필 설치 필요').length).toBeGreaterThan(0))
  })
})

describe('NewTaskModal — 작업 시작 비활성 사유', () => {
  it('explains that an instruction is needed while the button is disabled', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText('작업 지시를 입력하면 시작할 수 있어요.')).toBeTruthy())
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeDisabled()
  })

  it('drops the reason once the instruction is filled in', async () => {
    mountModal()
    await waitFor(() => expect(screen.getByText('작업 지시를 입력하면 시작할 수 있어요.')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('작업 지시 — 무엇을 할까요?'), { target: { value: '테스트 돌려줘' } })
    await waitFor(() => expect(screen.queryByText('작업 지시를 입력하면 시작할 수 있어요.')).toBeNull())
  })
})
