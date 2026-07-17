import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Pencil, Plus, RefreshCw, SlidersHorizontal, Users, X } from 'lucide-react'
import { api, type AgentProfileInfo, type ProviderInfo } from '../../api'
import { fetchModelCatalog, type AgentProfileInfoWithModel, type ModelCatalogEntry } from '../../api.profiles'
import { EmptyState } from '../../components/EmptyState'
import { AgentAvatar } from '../workspace/AgentAvatar'
import { AddAgentModal } from './AddAgentModal'
import { EditProfileModal } from './EditProfileModal'
import { ModelCatalogSection } from './ModelCatalogSection'
import { providerLabel } from './roleData'
import { filterVisibleCatalogEntries, loadHiddenProviders, saveHiddenProviders, toggleHiddenProvider } from './hiddenProviders'

/**
 * Agent 프로필 screen (Phase 5c). Card grid shows only what
 * `GET /agents/profiles` actually returns (name/description/source/
 * duplicated_in, plus the 5.5-A nullable provider/model fields — feedback
 * #6) — no role badge, since the profile list endpoint doesn't carry one and
 * guessing it was explicitly out of scope.
 */
export function ProfilesView() {
  const [profiles, setProfiles] = useState<AgentProfileInfoWithModel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AgentProfileInfo | null>(null)

  const [catalog, setCatalog] = useState<ModelCatalogEntry[] | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [hiddenProviders, setHiddenProviders] = useState<string[]>(() => loadHiddenProviders())
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false)

  const loadProfiles = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .listProfiles()
      // 5.5-A landed provider/model on the wire; api.ts's own return type
      // wasn't widened (see api.profiles.ts's AgentProfileInfoWithModel).
      .then(data => setProfiles(data as AgentProfileInfoWithModel[]))
      .catch((e: unknown) => {
        const err = e as { detail?: string; message?: string }
        setError(err?.detail || err?.message || '프로필을 불러오지 못했어요')
        setProfiles(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true)
    setCatalogError(null)
    fetchModelCatalog()
      .then(data => setCatalog(data))
      .catch(() => {
        setCatalog(null)
        setCatalogError('모델 목록을 조회할 수 없어요 — 직접 입력하세요')
      })
      .finally(() => setCatalogLoading(false))
  }, [])

  useEffect(() => {
    loadProfiles()
    loadCatalog()
    api.listProviders().then(setProviders).catch(() => {})
  }, [loadProfiles, loadCatalog])

  // Feedback #8: pure display filter — never touches the profile card grid
  // (a profile's `source` is a different concept from provider) or the
  // Tooling/extensions screen (out of this ownership).
  const visibleCatalog = useMemo(() => (catalog ? filterVisibleCatalogEntries(catalog, hiddenProviders) : catalog), [catalog, hiddenProviders])

  const handleToggleProvider = (name: string) => {
    setHiddenProviders(prev => {
      const next = toggleHiddenProvider(prev, name)
      saveHiddenProviders(next)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-5">
      <div className="flex items-center gap-2.5">
        <h1 className="flex flex-1 items-center gap-2 text-lg font-bold text-[var(--text)]">
          <Users size={18} className="text-[var(--accent-text)]" />
          Agent 프로필
        </h1>
        <div className="relative">
          <button
            type="button"
            onClick={() => setProviderSettingsOpen(v => !v)}
            aria-expanded={providerSettingsOpen}
            aria-label="Provider 표시 설정"
            title="Provider 표시 설정 — 선택/카탈로그 화면에 보일 provider를 골라요"
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <SlidersHorizontal size={13} />
            Provider 표시 설정
          </button>
          {providerSettingsOpen && (
            <>
              {/* Click-outside-to-close catcher only — not a real control, so
                  it stays out of the tab order/accessibility tree entirely
                  (the header's own "닫기" button is the one actual close
                  affordance for keyboard/AT users). */}
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setProviderSettingsOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="dialog"
                aria-label="Provider 표시 설정"
                className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">표시할 Provider</span>
                  <button type="button" onClick={() => setProviderSettingsOpen(false)} aria-label="닫기" className="rounded p-0.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                    <X size={13} />
                  </button>
                </div>
                <div className="space-y-1">
                  {providers.length === 0 ? (
                    <p className="text-[11px] text-[var(--text-3)]">provider 목록을 불러오는 중이거나 사용할 수 없어요.</p>
                  ) : (
                    providers.map(p => (
                      <label key={p.name} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]">
                        <input
                          type="checkbox"
                          checked={!hiddenProviders.includes(p.name)}
                          onChange={() => handleToggleProvider(p.name)}
                          className="accent-[var(--accent)]"
                        />
                        {providerLabel(p.name)}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-3)]">
                  새 작업/워커 추가/에이전트 추가의 provider 선택지와 아래 모델 카탈로그 표시에만 적용돼요. 이 기기에만 저장돼요.
                </p>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={loadProfiles}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)] shadow-sm hover:brightness-105"
        >
          <Plus size={13} />
          에이전트 추가
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-3)]">
        역할·Provider·모델·권한을 가진 에이전트를 만들고 관리해요 · 설치 위치: <span className="font-mono">~/.aws/cli-agent-orchestrator/agents</span>
      </p>

      <div className="mt-4">
        {loading && !profiles && !error ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-[var(--surface-2)]" />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={<AlertTriangle size={20} />} title="프로필을 불러오지 못했어요" description={error} />
        ) : !profiles || profiles.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title="설치된 에이전트 프로필이 없어요" description="에이전트 추가 버튼으로 첫 프로필을 만들어 보세요." />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map(p => (
              <ProfileCard key={p.name} profile={p} onEdit={() => setEditingProfile(p)} />
            ))}
          </div>
        )}
      </div>

      <ModelCatalogSection entries={visibleCatalog} loading={catalogLoading} error={catalogError} onRefresh={loadCatalog} />

      {showAddModal && <AddAgentModal onClose={() => setShowAddModal(false)} onInstalled={loadProfiles} />}
      {editingProfile && (
        <EditProfileModal profile={editingProfile} onClose={() => setEditingProfile(null)} onSaved={loadProfiles} />
      )}
    </div>
  )
}

function ProfileCard({ profile, onEdit }: { profile: AgentProfileInfoWithModel; onEdit: () => void }) {
  const hasDuplicates = !!profile.duplicated_in && profile.duplicated_in.length > 0
  return (
    <div data-testid={`profile-card-${profile.name}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <AgentAvatar name={profile.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-[var(--text)]">{profile.name}</div>
          <div className="truncate text-[10.5px] text-[var(--text-3)]">{profile.source}</div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          title="프로필 수정"
          aria-label={`${profile.name} 프로필 수정`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        >
          <Pencil size={13} />
        </button>
      </div>
      {profile.description && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--text-2)]">{profile.description}</p>}

      {/* Feedback #6 — a distinct labeled row, deliberately never merged into
          the scope/source chip below so the two can't be mistaken for each
          other. Null (frontmatter didn't declare it) renders as '—', never guessed. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--text-3)]">
        <span>
          모델: <span className="font-mono text-[var(--text-2)]">{profile.model ?? '—'}</span>
        </span>
        <span>
          Provider: <span className="font-mono text-[var(--text-2)]">{profile.provider ?? '—'}</span>
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-[var(--surface-3)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-2)]">{profile.source}</span>
        {hasDuplicates && (
          <span
            className="flex items-center gap-1 rounded-md bg-[var(--warning-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]"
            title={`다음 디렉터리에도 동일한 이름의 프로필이 있어요: ${profile.duplicated_in?.join(', ')} — 위 source가 우선 적용돼요`}
          >
            <AlertTriangle size={10} />
            중복 {profile.duplicated_in?.length}건
          </span>
        )}
      </div>
    </div>
  )
}
