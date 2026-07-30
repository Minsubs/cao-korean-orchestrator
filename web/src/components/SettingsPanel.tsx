import { useState, useEffect } from 'react'
import { api, AgentDirsSettings } from '../api'
import { useStore } from '../store'
import { FolderOpen, Plus, X, RefreshCw } from 'lucide-react'
import { UsageAccountsSection } from '../features/usage/UsageAccountsSection'

/** A small on/off switch (GH #280). */
function Toggle({ on, onClick, disabled, label }: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      title={on ? '활성화됨 — 이 디렉터리를 건너뛰려면 클릭' : '비활성화됨 — 이 디렉터리를 검색하려면 클릭'}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<AgentDirsSettings | null>(null)
  const [newDir, setNewDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [profileCount, setProfileCount] = useState<number | null>(null)
  const [dupCount, setDupCount] = useState(0)
  const { showSnackbar } = useStore()

  const load = async () => {
    try {
      setSettings(await api.getAgentDirs())
    } catch {
      showSnackbar({ type: 'error', message: '설정을 불러오지 못했습니다' })
    }
  }

  const refreshProfiles = async () => {
    try {
      const profiles = await api.listProfiles()
      setProfileCount(profiles.length)
      setDupCount(profiles.filter(p => (p.duplicated_in?.length ?? 0) > 0).length)
    } catch {}
  }

  useEffect(() => {
    load()
    refreshProfiles()
  }, [])

  // Every mutation persists immediately and re-reads the effective server
  // state, so the UI never claims a save that didn't stick (GH #281).
  const apply = async (
    data: { extra_dirs?: string[]; disabled_dirs?: string[] },
    message: string,
  ) => {
    setBusy(true)
    try {
      const result = await api.setAgentDirs(data)
      setSettings(result)
      showSnackbar({ type: 'success', message })
      refreshProfiles()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '설정을 변경하지 못했습니다' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return <div className="text-[var(--text-3)] text-sm py-8 text-center">설정 불러오는 중…</div>
  }

  const disabled = new Set(settings.disabled_dirs ?? [])
  // Provider defaults are de-duped by path (claude_code & codex share one).
  const defaultDirs = Array.from(new Set(Object.values(settings.agent_dirs))).filter(Boolean)
  const extraDirs = settings.extra_dirs.filter(d => !defaultDirs.includes(d))

  const toggle = (dir: string) => {
    const next = new Set(disabled)
    if (next.has(dir)) {
      next.delete(dir)
    } else {
      next.add(dir)
    }
    apply(
      { disabled_dirs: Array.from(next) },
      next.has(dir) ? '디렉터리를 비활성화했습니다' : '디렉터리를 활성화했습니다',
    )
  }

  const addDir = () => {
    const trimmed = newDir.trim()
    if (!trimmed || extraDirs.includes(trimmed) || defaultDirs.includes(trimmed)) return
    setNewDir('')
    apply({ extra_dirs: [...settings.extra_dirs, trimmed] }, '디렉터리를 추가했습니다')
  }

  const removeDir = (dir: string) => {
    apply(
      {
        extra_dirs: settings.extra_dirs.filter(d => d !== dir),
        disabled_dirs: (settings.disabled_dirs ?? []).filter(d => d !== dir),
      },
      '디렉터리를 제거했습니다',
    )
  }

  const row = (dir: string, isDefault: boolean) => {
    const off = disabled.has(dir)
    return (
      <div
        key={dir}
        data-testid={`dir-row-${dir}`}
        className={`flex items-center gap-2.5 bg-[var(--surface)] border border-[var(--border-soft)] rounded-lg px-3 py-2.5 ${
          off ? 'opacity-55' : ''
        }`}
      >
        <FolderOpen size={14} className={off ? 'text-[var(--text-3)] shrink-0' : 'text-[var(--accent-text)] shrink-0'} />
        <span className="text-sm text-[var(--text-2)] font-mono flex-1 truncate" title={dir}>{dir}</span>
        {isDefault && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-3)] shrink-0">기본값</span>
        )}
        <Toggle on={!off} onClick={() => toggle(dir)} disabled={busy} label={`${dir} 활성화`} />
        {!isDefault && (
          <button
            onClick={() => removeDir(dir)}
            disabled={busy}
            className="text-[var(--text-3)] hover:text-[var(--danger)] transition-colors shrink-0 disabled:opacity-40"
            title="디렉터리 제거"
            aria-label={`${dir} 제거`}
          >
            <X size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">
            에이전트 프로필 디렉터리
          </h3>
          {profileCount !== null && (
            <span className="text-xs text-[var(--text-3)]" data-testid="profile-count">
              프로필 {profileCount}개 발견
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-3)] mb-4">
          CAO는 이 디렉터리에서 에이전트 프로필 <code className="text-[var(--text-3)]">.md</code> 파일을 검색합니다.
          디렉터리를 삭제하지 않고 검색에서 제외하려면 토글을 끄세요. 실험용 복사본을 보관하거나
          이름이 같은 에이전트가 있는 두 디렉터리를 전환할 때 유용합니다. 기본 제공 디렉터리는
          비활성화할 수 있지만 제거할 수는 없습니다.
        </p>

        {defaultDirs.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-2">기본 제공</div>
            <div className="space-y-2 mb-4">{defaultDirs.map(d => row(d, true))}</div>
          </>
        )}

        <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)] mb-2">사용자 지정</div>
        {extraDirs.length > 0 ? (
          <div className="space-y-2 mb-4">{extraDirs.map(d => row(d, false))}</div>
        ) : (
          <div className="text-center py-5 mb-4 bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-lg">
            <p className="text-[var(--text-3)] text-sm">사용자 지정 디렉터리가 없습니다.</p>
            <p className="text-[var(--text-3)] text-xs mt-1">더 많은 에이전트 프로필을 찾으려면 아래에서 추가하세요.</p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDir()}
            placeholder="/path/to/agent-profiles"
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 font-mono focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={addDir}
            disabled={!newDir.trim() || busy}
            className="flex items-center gap-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] disabled:opacity-40 text-[var(--text)] text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> 추가
          </button>
        </div>

        {dupCount > 0 && (
          <p className="text-xs text-[var(--warning)] mt-4" data-testid="dup-note">
            프로필 이름 {dupCount}개가 둘 이상의 활성 디렉터리에 중복되어 있습니다.
            먼저 검색된 항목이 사용됩니다. 사용할 항목을 바꾸려면 디렉터리를 비활성화하세요.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { refreshProfiles(); showSnackbar({ type: 'info', message: '프로필 새로고침 중…' }) }}
          className="flex items-center gap-2 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] text-[var(--text)] text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <RefreshCw size={14} /> 프로필 새로고침
        </button>
      </div>

      {/* Moved here when the header's 사용량 button became always-visible bars —
          the bars are display-only, so the account detail, the Claude 한도 실측
          opt-in and 새로고침 need a home that is still reachable. */}
      <UsageAccountsSection />
    </div>
  )
}
