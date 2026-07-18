import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Plus, X } from 'lucide-react'
import { api, type ProviderInfo } from '../../api'
import type { AgentProfileInfoWithModel } from '../../api.profiles'
import { useStore } from '../../store'
import { CustomSelect, type SelectOption } from '../../components/CustomSelect'
import { filterVisibleProviders, loadHiddenProviders } from '../profiles/hiddenProviders'
import {
  isOrchestratorProfile,
  profileDescription,
  profileDetail,
  profileLabel,
  profileSectionLabel,
} from '../profiles/profilePresentation'
import { providerLabel } from '../profiles/roleData'
import { DirectoryPicker } from './DirectoryPicker'

// Mirrors AgentPanel.tsx's FALLBACK_PROVIDERS (classic "에이전트 추가" inline
// form) as a short literal rather than an import — importing from AgentPanel.tsx
// would drag its heavy transitive deps (TerminalView/xterm, SessionChatPanel, ...)
// into the Workspace bundle for the sake of one constant array.
const FALLBACK_PROVIDERS = [
  'kiro_cli',
  'claude_code',
  'q_cli',
  'codex',
  'gemini_cli',
  'hermes',
  'kimi_cli',
  'copilot_cli',
  'opencode_cli',
  'cursor_cli',
]

interface AddAgentModalProps {
  sessionName: string
  /** Session's own working directory (its supervisor terminal) — prefilled, editable (spec Phase 2c §2). */
  defaultWorkingDirectory: string | null
  onClose: () => void
  /** Fires once the new terminal is created, ahead of the next REST poll tick, so the caller can refresh the card list immediately. */
  onAdded: () => void
}

/**
 * Manually add a worker terminal to the active session — the Phase 2c
 * replacement surface for AgentPanel.tsx's classic "에이전트 추가" inline
 * form, wired to the exact same `addTerminalToSession` call (provider +
 * profile + working directory; the 90s timeout is already built into that
 * API call in api.ts, not reimplemented here).
 */
export function AddAgentModal({ sessionName, defaultWorkingDirectory, onClose, onAdded }: AddAgentModalProps) {
  const showSnackbar = useStore(s => s.showSnackbar)

  const [profiles, setProfiles] = useState<AgentProfileInfoWithModel[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [profile, setProfile] = useState('')
  const [provider, setProvider] = useState('kiro_cli')
  const [workingDirectory, setWorkingDirectory] = useState(defaultWorkingDirectory ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  // One-time read (feedback #8) — this is a short-lived modal, not worth a
  // live-storage subscription; ProfilesView's popover is the one place this
  // preference is actually edited.
  const [hiddenProviders] = useState<string[]>(() => loadHiddenProviders())

  useEffect(() => {
    api
      .listProfiles()
      .then(p => {
        // See NewTaskModal.tsx's identical cast: 5.5-A landed provider/model
        // on GET /agents/profiles; api.ts's own return type wasn't widened.
        setProfiles(p as AgentProfileInfoWithModel[])
        setLoadingProfiles(false)
      })
      .catch(() => setLoadingProfiles(false))
    api.listProviders().then(setProviders).catch(() => {})
  }, [])

  const visibleProviders = useMemo(
    () => filterVisibleProviders(providers.length > 0 ? providers : FALLBACK_PROVIDERS.map(n => ({ name: n, binary: '', installed: true })), hiddenProviders),
    [providers, hiddenProviders],
  )

  const workerProfiles = useMemo(() => profiles.filter(item => !isOrchestratorProfile(item.name)), [profiles])

  // Keep the selection pointed at a still-visible provider — e.g. the
  // 'kiro_cli' initial default is one of the feedback #8 defaults-hidden
  // entries, so without this the select would show a value with no matching
  // (visible) option the moment the provider/hidden lists first resolve.
  useEffect(() => {
    if (visibleProviders.length === 0) return
    if (!visibleProviders.some(p => p.name === provider)) setProvider(visibleProviders[0].name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProviders])

  const providerOptions: SelectOption[] = visibleProviders.map(p => ({
    value: p.name,
    label: providerLabel(p.name),
    sublabel: !p.installed ? '설치되지 않음' : undefined,
    disabled: !p.installed,
  }))

  const profileOptions: SelectOption[] = workerProfiles.map(p => ({
    value: p.name,
    label: profileLabel(p.name),
    sublabel: `${profileDetail(p)} · ${profileDescription(p) ?? p.name}`,
    group: profileSectionLabel(p),
  }))

  // Feedback #1's principle applied here too: once a profile with a real
  // `provider` is chosen, prefer it over whatever the dropdown happened to
  // default to — the person can still change it afterward, this just stops
  // it silently staying on an unrelated default.
  const handleProfileChange = (name: string) => {
    setProfile(name)
    const chosen = profiles.find(p => p.name === name)
    if (chosen?.provider) setProvider(chosen.provider)
  }

  const canSubmit = profile.trim().length > 0 && !adding

  const handleSubmit = async () => {
    if (!canSubmit) return
    setAdding(true)
    try {
      await api.addTerminalToSession(sessionName, provider, profile.trim(), workingDirectory.trim() || undefined)
      showSnackbar({ type: 'success', message: '세션에 에이전트를 추가했어요' })
      onAdded()
      onClose()
    } catch (error: unknown) {
      const err = error as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || '에이전트를 추가하지 못했어요' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="에이전트 추가">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Plus size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">에이전트 추가</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-[var(--text-3)]">
            이 세션에 팀원을 추가해요. 같은 세션의 에이전트는 서로 메시지를 보내고, 오케스트레이터가 작업을 위임할 수 있어요.
          </p>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">실행 AI</label>
            <CustomSelect value={provider} onChange={setProvider} placeholder="제공자 선택..." options={providerOptions} />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">에이전트 프로필</label>
            {loadingProfiles ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text-3)]">프로필 불러오는 중...</div>
            ) : workerProfiles.length > 0 ? (
              <CustomSelect value={profile} onChange={handleProfileChange} placeholder="프로필 선택..." options={profileOptions} />
            ) : (
              <input
                type="text"
                value={profile}
                onChange={e => setProfile(e.target.value)}
                placeholder="예: developer, reviewer"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">작업 디렉터리</label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <FolderOpen size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={e => setWorkingDirectory(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="/path/to/project"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-2.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
              >
                찾아보기
              </button>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40"
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {adding ? '추가 중...' : '추가'}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <DirectoryPicker
          initialPath={workingDirectory || defaultWorkingDirectory || undefined}
          onClose={() => setPickerOpen(false)}
          onSelect={path => setWorkingDirectory(path)}
        />
      )}
    </div>
  )
}
