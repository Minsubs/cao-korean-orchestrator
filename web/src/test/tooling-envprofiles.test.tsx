import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import type { AgentProfileInfoWithModel } from '../api.profiles'
import { toolingApi } from '../api.tooling'
import { EnvProfilesPane } from '../features/tooling/EnvProfilesPane'
import { ENV_SNAPSHOT_SCHEMA, type EnvSnapshot } from '../features/tooling/envProfile'

const CAPTURED_AT = '2026-07-18T00:00:00.000Z'

function savedSnapshot(version = '0.144.4'): EnvSnapshot {
  return {
    schema: ENV_SNAPSHOT_SCHEMA,
    captured_at: CAPTURED_AT,
    label: 'saved mac',
    environment: {
      os: 'macOS', os_version: '26.5', arch: 'arm64', shell: '/bin/zsh', is_wsl: false,
      server_version: '2.3.0', python_version: '3.11.15', checked_at: null,
    },
    cli_versions: [{ name: 'codex', display_name: 'Codex CLI', version }],
    extensions_summary: [],
    agent_profiles: [{ name: 'reviewer', provider: 'codex', model: 'gpt-5' }],
    inventory_counts: { codex: { total: 2, skill: 2 } },
  }
}

function store(snapshot: EnvSnapshot) {
  window.localStorage.setItem('cao:env-profiles:v1', JSON.stringify([snapshot]))
}

describe('EnvProfilesPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(toolingApi, 'getEnvironment').mockResolvedValue({
      os: 'macOS', os_version: '26.5', arch: 'arm64', shell: '/bin/zsh', is_wsl: false,
      server_version: '2.3.0', python_version: '3.11.15', checked_at: null,
    })
    vi.spyOn(toolingApi, 'listProviders').mockResolvedValue([
      { name: 'codex', display_name: 'Codex CLI', binary: 'codex', installed: true, path: '/bin/codex', version: '0.144.5', version_error: null, checked_at: null },
    ])
    vi.spyOn(toolingApi, 'listExtensions').mockResolvedValue([])
    const profiles: AgentProfileInfoWithModel[] = [
      { name: 'reviewer', description: 'Review', source: 'built-in', provider: 'codex', model: 'gpt-5' },
    ]
    vi.spyOn(api, 'listProfiles').mockResolvedValue(profiles)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ clis: [{ cli: 'codex', counts: { total: 2, skill: 2 } }] }), { status: 200 })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('creates, stores, and renders a snapshot with the real CLI version', async () => {
    render(<EnvProfilesPane />)
    fireEvent.change(screen.getByLabelText('스냅샷 이름'), { target: { value: 'home mac' } })
    fireEvent.click(screen.getByRole('button', { name: '스냅샷 생성' }))

    expect(await screen.findByText('home mac')).toBeInTheDocument()
    expect(screen.getByText('Codex CLI 0.144.5')).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem('cao:env-profiles:v1') ?? '[]')
    expect(stored[0].cli_versions).toEqual([{ name: 'codex', display_name: 'Codex CLI', version: '0.144.5' }])
  })

  it('saves other sections while reporting a provider-only failure honestly', async () => {
    vi.mocked(toolingApi.listProviders).mockRejectedValueOnce(new Error('offline'))
    render(<EnvProfilesPane />)
    fireEvent.change(screen.getByLabelText('스냅샷 이름'), { target: { value: 'partial' } })
    fireEvent.click(screen.getByRole('button', { name: '스냅샷 생성' }))

    expect(await screen.findByText('/tooling/providers 조회 실패 — 이 항목 제외')).toBeInTheDocument()
    expect(screen.getByText('partial')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('cao:env-profiles:v1') ?? '[]')[0]).not.toHaveProperty('cli_versions')
  })

  it('rejects malformed pasted snapshots with the schema error', () => {
    render(<EnvProfilesPane />)
    fireEvent.change(screen.getByLabelText('스냅샷 JSON 붙여넣기'), { target: { value: '{bad' } })
    fireEvent.click(screen.getByRole('button', { name: '가져오기' }))
    expect(screen.getByText(`${ENV_SNAPSHOT_SCHEMA} 형식이 아니에요`)).toBeInTheDocument()
  })

  it('refetches current data and renders a real CLI version drift', async () => {
    store(savedSnapshot('0.144.4'))
    render(<EnvProfilesPane />)
    fireEvent.change(screen.getByLabelText('비교할 스냅샷'), { target: { value: CAPTURED_AT } })
    fireEvent.click(screen.getByRole('button', { name: '현재 환경과 비교' }))

    expect(await screen.findByText('CLI 버전 차이')).toBeInTheDocument()
    expect(screen.getByText('0.144.4 → 0.144.5')).toBeInTheDocument()
    expect(toolingApi.listProviders).toHaveBeenCalledOnce()
  })

  it('renders no-diff only after a fresh matching comparison', async () => {
    store(savedSnapshot('0.144.5'))
    render(<EnvProfilesPane />)
    fireEvent.change(screen.getByLabelText('비교할 스냅샷'), { target: { value: CAPTURED_AT } })
    fireEvent.click(screen.getByRole('button', { name: '현재 환경과 비교' }))
    expect(await screen.findByText('차이가 없어요 ✨')).toBeInTheDocument()
  })

  it('does not save when every source fails', async () => {
    vi.mocked(toolingApi.getEnvironment).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(toolingApi.listProviders).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(toolingApi.listExtensions).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(api.listProfiles).mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<EnvProfilesPane />)
    fireEvent.click(screen.getByRole('button', { name: '스냅샷 생성' }))

    expect(await screen.findByText('환경 정보를 하나도 가져오지 못했어요 — 서버 연결을 확인하세요')).toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem('cao:env-profiles:v1')).toBeNull())
  })
})
