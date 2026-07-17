import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryPanel } from '../components/MemoryPanel'

const MEMORIES = [
  {
    key: 'project-conventions',
    scope: 'project',
    scope_id: 'my-proj',
    memory_type: 'project',
    tags: 'style,conventions',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  },
  {
    key: 'user-preferences',
    scope: 'global',
    scope_id: null,
    memory_type: 'user',
    tags: '',
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-06-11T00:00:00Z',
  },
]

describe('MemoryPanel', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockListResponse(data: unknown) {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(data),
    })
  }

  it('renders memory rows after fetch', async () => {
    mockListResponse(MEMORIES)
    render(<MemoryPanel />)
    expect(await screen.findByText('project-conventions')).toBeInTheDocument()
    expect(screen.getByText('user-preferences')).toBeInTheDocument()
    expect(screen.getByText('전역')).toBeInTheDocument()
    expect(screen.getByText('style,conventions')).toBeInTheDocument()
  })

  it('shows empty state when no memories', async () => {
    mockListResponse([])
    render(<MemoryPanel />)
    expect(await screen.findByText('저장된 메모리가 없습니다.')).toBeInTheDocument()
  })

  it('shows ConfirmModal when delete is clicked', async () => {
    mockListResponse(MEMORIES)
    render(<MemoryPanel />)
    await screen.findByText('project-conventions')
    const deleteButtons = screen.getAllByTitle('메모리 삭제')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(screen.getByText(/메모리와 기록을 영구적으로 삭제합니다/)).toBeInTheDocument()
    })
    // Modal details echo the row's key (row + modal both show it)
    expect(screen.getAllByText('project-conventions').length).toBe(2)
  })

  it('disables Clear scope button when no scope filter is selected', async () => {
    mockListResponse(MEMORIES)
    render(<MemoryPanel />)
    await screen.findByText('project-conventions')
    const clearButton = screen.getByText('범위 비우기…').closest('button')
    expect(clearButton).toBeDisabled()
  })

  it('filters rows by key search client-side', async () => {
    mockListResponse(MEMORIES)
    render(<MemoryPanel />)
    await screen.findByText('project-conventions')
    fireEvent.change(screen.getByPlaceholderText('키 검색...'), { target: { value: 'user-pref' } })
    expect(screen.queryByText('project-conventions')).not.toBeInTheDocument()
    expect(screen.getByText('user-preferences')).toBeInTheDocument()
  })
})
