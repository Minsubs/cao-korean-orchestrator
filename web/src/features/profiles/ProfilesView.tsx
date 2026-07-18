import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bot, Pencil, Plus, RefreshCw, SlidersHorizontal, Users, X } from 'lucide-react'
import { api, type AgentProfileInfo, type ProviderInfo } from '../../api'
import { fetchModelCatalog, type AgentProfileInfoWithModel, type ModelCatalogEntry } from '../../api.profiles'
import { EmptyState } from '../../components/EmptyState'
import { AgentAvatar } from '../workspace/AgentAvatar'
import { AddAgentModal } from './AddAgentModal'
import { EditProfileModal } from './EditProfileModal'
import { ModelCatalogSection } from './ModelCatalogSection'
import { providerLabel } from './roleData'
import { filterVisibleCatalogEntries, loadHiddenProviders, saveHiddenProviders, toggleHiddenProvider } from './hiddenProviders'
import {
  ADDITIONAL_ROLE_LABELS,
  PROFILE_SECTIONS,
  WORKER_GROUPS,
  additionalProfileRole,
  isOrchestratorProfile,
  profileDescription,
  profileDetail,
  profileDuplicateSources,
  profileLabel,
  profileOrder,
  profileSection,
  profileSource,
  workerGroup,
  type ProfileSectionId,
} from './profilePresentation'

/**
 * Agent 프로필 screen (Phase 5c). Card grid shows only what
 * `GET /agents/profiles` actually returns (name/description/source/
 * duplicated_in, plus the 5.5-A nullable provider/model fields — feedback
 * #6). Native provider profiles without CAO uiRole metadata are grouped from
 * their established agent names, but remain individual cards.
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

  const groupedProfiles = useMemo(() => {
    if (!profiles) return []
    const groups = new Map<ProfileSectionId, AgentProfileInfoWithModel[]>()
    profiles.forEach(profile => {
      const section = profileSection(profile)
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(profile)
    })
    return [...groups.entries()]
      .map(([id, items]) => ({
        id,
        items: [...items].sort((a, b) => profileOrder(a) - profileOrder(b) || profileLabel(a.name).localeCompare(profileLabel(b.name))),
      }))
      .sort((a, b) => PROFILE_SECTIONS[a.id].order - PROFILE_SECTIONS[b.id].order)
  }, [profiles])

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
          AI 팀과 에이전트
        </h1>
        <div className="relative">
          <button
            type="button"
            onClick={() => setProviderSettingsOpen(v => !v)}
            aria-expanded={providerSettingsOpen}
            aria-label="실행 AI 표시 설정"
            title="실행 AI 표시 설정 — 선택 화면과 모델 목록에 보일 AI를 골라요"
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <SlidersHorizontal size={13} />
            실행 AI 표시 설정
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
                aria-label="실행 AI 표시 설정"
                className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">표시할 실행 AI</span>
                  <button type="button" onClick={() => setProviderSettingsOpen(false)} aria-label="닫기" className="rounded p-0.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                    <X size={13} />
                  </button>
                </div>
                <div className="space-y-1">
                  {providers.length === 0 ? (
                    <p className="text-[11px] text-[var(--text-3)]">실행 AI 목록을 불러오는 중이거나 사용할 수 없어요.</p>
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
                  새 작업과 팀원 추가의 실행 AI 선택지, 아래 모델 목록에만 적용돼요. 이 기기에만 저장돼요.
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
          에이전트 만들기
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-3)]">
        한 명의 오케스트레이터가 탐색·구현·검증 역할에 작업을 나눠요. 내부 설치 위치보다 실제 역할을 기준으로 정리했습니다.
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
          <div className="space-y-5">
            {groupedProfiles.map(group => (
              <section key={group.id} aria-labelledby={`profile-section-${group.id}`}>
                <div className="mb-2 flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--accent-text)]">
                    <Bot size={13} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h2 id={`profile-section-${group.id}`} className="text-xs font-bold text-[var(--text)]">
                        {PROFILE_SECTIONS[group.id].label}
                      </h2>
                      <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--text-3)]">
                        {group.items.length}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-[var(--text-3)]">{PROFILE_SECTIONS[group.id].description}</p>
                  </div>
                </div>
                {group.id === 'team' ? (
                  <DefaultTeamGroups profiles={group.items} onEdit={setEditingProfile} />
                ) : group.id === 'additional' ? (
                  <AdditionalRoleGroups profiles={group.items} onEdit={setEditingProfile} />
                ) : (
                  <ProfileGrid profiles={group.items} onEdit={setEditingProfile} />
                )}
              </section>
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

function ProfileGrid({ profiles, onEdit }: { profiles: AgentProfileInfoWithModel[]; onEdit: (profile: AgentProfileInfoWithModel) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {profiles.map(profile => (
        <ProfileCard key={profile.name} profile={profile} onEdit={() => onEdit(profile)} />
      ))}
    </div>
  )
}

function DefaultTeamGroups({ profiles, onEdit }: { profiles: AgentProfileInfoWithModel[]; onEdit: (profile: AgentProfileInfoWithModel) => void }) {
  const orchestrators = profiles.filter(profile => isOrchestratorProfile(profile.name))
  const workerGroups = Object.entries(WORKER_GROUPS)
    .map(([id, presentation]) => ({ id, presentation, profiles: profiles.filter(profile => workerGroup(profile) === id) }))
    .filter(group => group.profiles.length > 0)
    .sort((a, b) => a.presentation.order - b.presentation.order)

  return (
    <div className="space-y-3">
      {orchestrators.length > 0 && (
        <ProfileSubgroup label="고정 오케스트레이터" description="역할은 같고 작업을 지휘할 실행 AI만 Codex 또는 Claude로 선택해요.">
          <ProfileGrid profiles={orchestrators} onEdit={onEdit} />
        </ProfileSubgroup>
      )}
      {workerGroups.map(group => (
        <ProfileSubgroup key={group.id} label={group.presentation.label} description={group.presentation.description}>
          <ProfileGrid profiles={group.profiles} onEdit={onEdit} />
        </ProfileSubgroup>
      ))}
    </div>
  )
}

function AdditionalRoleGroups({ profiles, onEdit }: { profiles: AgentProfileInfoWithModel[]; onEdit: (profile: AgentProfileInfoWithModel) => void }) {
  const groups = new Map<string, AgentProfileInfoWithModel[]>()
  profiles.forEach(profile => {
    const role = additionalProfileRole(profile)
    groups.set(role, [...(groups.get(role) ?? []), profile])
  })
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([role, items]) => (
        <ProfileSubgroup
          key={role}
          label={ADDITIONAL_ROLE_LABELS[role] ?? role}
          description={role === '기타' ? '역할 메타데이터가 없는 기존 프로필이에요.' : `${role} 역할로 직접 만든 에이전트예요.`}
        >
          <ProfileGrid profiles={items} onEdit={onEdit} />
        </ProfileSubgroup>
      ))}
    </div>
  )
}

function ProfileSubgroup({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold text-[var(--text)]">{label}</h3>
        <p className="truncate text-[10px] text-[var(--text-3)]">{description}</p>
      </div>
      {children}
    </div>
  )
}

function ProfileCard({ profile, onEdit }: { profile: AgentProfileInfoWithModel; onEdit: () => void }) {
  const duplicateSources = profileDuplicateSources(profile)
  const hasDuplicates = duplicateSources.length > 0
  const source = profileSource(profile.source)
  const description = profileDescription(profile)
  return (
    <div data-testid={`profile-card-${profile.name}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <AgentAvatar name={profile.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-[var(--text)]">{profileLabel(profile.name)}</div>
          <div className="truncate text-[10.5px] text-[var(--text-3)]">{profileDetail(profile)}</div>
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
      <div className="mt-1.5 truncate font-mono text-[9.5px] text-[var(--text-3)]" title={profile.name}>{profile.name}</div>
      {description && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--text-2)]">{description}</p>}

      {/* Feedback #6 — a distinct labeled row, deliberately never merged into
          the scope/source chip below so the two can't be mistaken for each
          other. Null (frontmatter didn't declare it) renders as '—', never guessed. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--text-3)]">
        <span>
          모델: <span className="font-mono text-[var(--text-2)]">{profile.model ?? '—'}</span>
        </span>
        <span>
          실행 AI: <span className="text-[var(--text-2)]">{profile.provider ? providerLabel(profile.provider) : '프로필에서 자동 결정'}</span>
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-md bg-[var(--surface-3)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-2)]"
          title={source.description}
        >
          {source.label}
        </span>
        {hasDuplicates && (
          <span
            className="flex items-center gap-1 rounded-md bg-[var(--warning-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]"
            title={`다른 위치에도 같은 내부 ID가 있어요: ${duplicateSources.map(item => profileSource(item).label).join(', ')} — 현재 표시된 프로필이 우선 적용돼요`}
          >
            <AlertTriangle size={10} />
            중복 {duplicateSources.length}건
          </span>
        )}
      </div>
    </div>
  )
}
