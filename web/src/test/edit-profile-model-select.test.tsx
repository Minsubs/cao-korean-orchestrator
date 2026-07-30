import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { EditProfileModal } from '../features/profiles/EditProfileModal'
import type { AgentProfileInfo } from '../api'
import type { AgentProfileFullDetail } from '../api.profiles'
import type { ModelCatalogEntry } from '../api.profiles'

// The edit modal's model field used to be a bare free-text <input> — the Add
// Agent modal already gets this right (catalog-driven <select> + "직접
// 입력…" fallback), so this file pins the edit modal to the same behaviour
// and, most importantly, that a profile's already-saved model is never
// silently rewritten when it doesn't happen to be in the catalog.

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: () => Promise.resolve(data),
  }
}

const PROFILE: AgentProfileInfo = { name: 'nova', description: '설명', source: 'user' }

const MODEL_CATALOG: ModelCatalogEntry[] = [
  { provider: 'claude_code', source: 'known', models: [{ name: 'sonnet' }, { name: 'opus' }], probed_at: null },
]

const DETAIL_IN_CATALOG: AgentProfileFullDetail = {
  name: 'nova',
  description: '설명',
  provider: 'claude_code',
  model: 'sonnet',
  system_prompt: 'You are nova.',
}

// A model string the catalog doesn't know about — e.g. hand-edited
// frontmatter, or a model that predates/postdates the known-alias list.
const DETAIL_NOT_IN_CATALOG: AgentProfileFullDetail = {
  name: 'nova',
  description: '설명',
  provider: 'claude_code',
  model: 'custom-model-xyz',
  system_prompt: 'You are nova.',
}

function installMockFetch(detail: AgentProfileFullDetail) {
  const mockFetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/agents/profiles/nova') return jsonResponse(detail)
    if (url === '/tooling/models') return jsonResponse(MODEL_CATALOG)
    if (url === '/agents/profiles' && opts?.method === 'POST') return jsonResponse({ success: true, message: 'ok' })
    return jsonResponse({ detail: `unhandled in test: ${url}` }, 404)
  })
  vi.stubGlobal('fetch', mockFetch)
  return mockFetch
}

function findSavePostCall(mockFetch: ReturnType<typeof vi.fn>) {
  return mockFetch.mock.calls.find(([u, o]) => u === '/agents/profiles' && (o as RequestInit | undefined)?.method === 'POST') as
    | [string, RequestInit]
    | undefined
}

describe('EditProfileModal — model field as a catalog selection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the model field as a <select> (not free text) once the catalog has models for the profile provider', async () => {
    installMockFetch(DETAIL_IN_CATALOG)
    render(<EditProfileModal profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'nova 프로필 수정' })

    // Regression guard: this used to be `<input id="ep-model">` — asserting
    // the tag name (not just presence) is what actually pins "selection, not
    // free text".
    await waitFor(() => expect(within(dialog).getByLabelText('모델')).toHaveValue('sonnet'))
    expect(within(dialog).getByLabelText('모델').tagName).toBe('SELECT')
  })

  it('picking a model from the list and saving writes that model', async () => {
    const mockFetch = installMockFetch(DETAIL_IN_CATALOG)
    render(<EditProfileModal profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'nova 프로필 수정' })

    await waitFor(() => expect(within(dialog).getByLabelText('모델')).toHaveValue('sonnet'))
    fireEvent.change(within(dialog).getByLabelText('모델'), { target: { value: 'opus' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(findSavePostCall(mockFetch)).toBeTruthy())
    const [, postOpts] = findSavePostCall(mockFetch)!
    const body = JSON.parse(postOpts.body as string)
    // yamlScalar() double-quotes every frontmatter string value (see
    // profileTemplate.ts) — matching the quoted form pins the real emitted line.
    expect(body.content).toContain('model: "opus"')
  })

  it('a stored model NOT in the catalog opens in "직접 입력…" mode with its value intact, and saving unchanged preserves it', async () => {
    const mockFetch = installMockFetch(DETAIL_NOT_IN_CATALOG)
    render(<EditProfileModal profile={PROFILE} onClose={() => {}} onSaved={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'nova 프로필 수정' })

    // The revealed free-text box is the stable, user-facing signal that
    // "직접 입력…" is selected — the underlying CUSTOM_OPTION sentinel value
    // on the <select> is an implementation detail, not something to assert on.
    const customInput = await within(dialog).findByPlaceholderText('모델 문자열 직접 입력 — CLI에 그대로 전달돼요')
    expect(customInput).toHaveValue('custom-model-xyz')

    // Saving without touching the field must round-trip the exact original
    // value — this is the "never silently rewrites an unrelated profile's
    // model" guarantee the task depends on.
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(findSavePostCall(mockFetch)).toBeTruthy())
    const [, postOpts] = findSavePostCall(mockFetch)!
    const body = JSON.parse(postOpts.body as string)
    expect(body.content).toContain('model: "custom-model-xyz"')
  })
})
