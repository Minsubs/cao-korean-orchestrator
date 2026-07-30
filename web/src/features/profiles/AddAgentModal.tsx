import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, Key, Loader2, RefreshCw, Sparkles, Users, X } from 'lucide-react'
import { api, type ProviderInfo } from '../../api'
import { apiProfiles, fetchModelCatalog, type ModelCatalogEntry } from '../../api.profiles'
import { useStore } from '../../store'
import { AVATAR_PALETTE, type AvatarColorKey } from '../workspace/constants'
import { avatarVars } from '../workspace/avatar'
import { BUILTIN_PRESETS, CUSTOM_OPTION, ROLES, SPECS, builtinRoleFor, providerLabel } from './roleData'
import { PROFILE_NAME_RE, buildProfileMarkdown, type BuiltProfile } from './profileTemplate'
import { filterVisibleProviders, loadHiddenProviders } from './hiddenProviders'

interface AddAgentModalProps {
  onClose: () => void
  /** Called after a successful in-app install so the profile list can refresh. */
  onInstalled?: () => void
}

/** Small pastel "face" sticker matching AgentAvatar.tsx's drawing, but parameterized by an explicitly chosen color (not a name hash) — this modal lets the person creating the agent preview/pick a color. */
function Face({ color, antenna }: { color: AvatarColorKey; antenna: boolean }) {
  const { bg, ink } = avatarVars(color)
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: bg }}>
      <svg viewBox="0 0 32 32" width={30} height={30}>
        <rect x="6" y="9" width="20" height="15" rx="7" fill={ink} opacity="0.18" />
        <circle cx="12.5" cy="16" r="1.9" fill={ink} />
        <circle cx="19.5" cy="16" r="1.9" fill={ink} />
        <path d="M13 20.6 Q16 22.6 19 20.6" stroke={ink} strokeWidth="1.7" fill="none" strokeLinecap="round" />
        {antenna && (
          <>
            <line x1="16" y1="9" x2="16" y2="6" stroke={ink} strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="16" cy="5.4" r="1.3" fill={ink} />
          </>
        )}
      </svg>
    </div>
  )
}

function specialtyDescriptionFor(role: string, specialtyName: string): string {
  const found = (SPECS[role] ?? []).find(s => s[0] === specialtyName)
  return found ? `${found[0]} — ${found[1]}` : ''
}

export function AddAgentModal({ onClose, onInstalled }: AddAgentModalProps) {
  const showSnackbar = useStore(s => s.showSnackbar)

  const [name, setName] = useState('nova')
  const [color, setColor] = useState<AvatarColorKey>(AVATAR_PALETTE[0])
  const [role, setRole] = useState<string>(ROLES[0].name)
  const [specialty, setSpecialty] = useState<string>(SPECS[ROLES[0].name][0][0])
  const [specialtyCustom, setSpecialtyCustom] = useState('')
  const [description, setDescription] = useState(specialtyDescriptionFor(ROLES[0].name, SPECS[ROLES[0].name][0][0]))

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [provider, setProvider] = useState('claude_code')
  // One-time read (feedback #8) — ProfilesView's popover is where this is edited.
  const [hiddenProviders] = useState<string[]>(() => loadHiddenProviders())
  const visibleProviders = useMemo(() => filterVisibleProviders(providers, hiddenProviders), [providers, hiddenProviders])

  const [catalog, setCatalog] = useState<ModelCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [model, setModel] = useState('')
  const [modelCustom, setModelCustom] = useState('')

  const [result, setResult] = useState<BuiltProfile | null>(null)
  const [copied, setCopied] = useState(false)

  // Real install directory (settings-backed, CAO_HOME_DIR-aware) shown next to
  // the name field — must never be a hardcoded `~/.aws/...` guess, since
  // CAO_HOME_DIR can be overridden (see settings_service.get_agent_dirs).
  // `codex` is the settings key for the shared CAO agent-store that
  // install_agent_content() actually writes new profiles into.
  const [installDir, setInstallDir] = useState<string | null>(null)

  const loadCatalog = () => {
    setCatalogLoading(true)
    setCatalogError(null)
    fetchModelCatalog()
      .then(entries => {
        setCatalog(entries)
        setCatalogError(null)
      })
      .catch(() => {
        setCatalog(null)
        setCatalogError('모델 목록을 조회할 수 없어요 — 직접 입력하세요')
      })
      .finally(() => setCatalogLoading(false))
  }

  useEffect(() => {
    api
      .listProviders()
      .then(list => {
        setProviders(list)
        // Feedback #8: default selection must land on a *visible* provider —
        // filtered inline (not via the `visibleProviders` memo, computed from
        // state that hasn't re-rendered yet at this point in the same tick).
        const visible = filterVisibleProviders(list, hiddenProviders)
        const firstInstalled = visible.find(p => p.installed)
        if (firstInstalled) setProvider(firstInstalled.name)
        else if (visible[0]) setProvider(visible[0].name)
      })
      .catch(() => setProvidersError('실행 AI 목록을 불러오지 못했어요 — 기본값(Claude Code)으로 진행해요'))
    loadCatalog()
    api
      .getAgentDirs()
      .then(settings => setInstallDir(settings.agent_dirs.codex ?? settings.agent_dirs.cao_installed ?? null))
      .catch(() => setInstallDir(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const catalogEntry = useMemo(() => catalog?.find(e => e.provider === provider) ?? null, [catalog, provider])

  // Whenever the provider (or a freshly-loaded catalog) changes the available
  // model list, keep `model` pointed at a real option instead of a stale one
  // from the previous provider.
  useEffect(() => {
    if (catalogEntry && catalogEntry.models.length > 0) {
      setModel(prev => (catalogEntry.models.some(m => m.name === prev) ? prev : catalogEntry.models[0].name))
    } else {
      setModel(CUSTOM_OPTION)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, catalog])

  function applyRole(nextRole: string) {
    setRole(nextRole)
    const firstSpec = SPECS[nextRole]?.[0]?.[0] ?? ''
    setSpecialty(firstSpec)
    setSpecialtyCustom('')
    setDescription(specialtyDescriptionFor(nextRole, firstSpec))
  }

  function applySpecialty(nextSpecialty: string) {
    setSpecialty(nextSpecialty)
    if (nextSpecialty === CUSTOM_OPTION) {
      setDescription('')
    } else {
      setDescription(specialtyDescriptionFor(role, nextSpecialty))
    }
  }

  const isCustomSpecialty = specialty === CUSTOM_OPTION
  const effectiveSpecialtyName = isCustomSpecialty ? specialtyCustom.trim() : specialty
  const isCustomModel = model === CUSTOM_OPTION
  const effectiveModel = isCustomModel ? modelCustom.trim() : model
  const builtin = builtinRoleFor(role)
  const preset = BUILTIN_PRESETS[builtin]

  const nameValid = PROFILE_NAME_RE.test(name.trim())
  const canSubmit =
    nameValid && effectiveSpecialtyName.length > 0 && description.trim().length > 0 && provider.length > 0 && effectiveModel.length > 0

  async function handleCreate() {
    if (!canSubmit) return
    const built = buildProfileMarkdown({
      name: name.trim(),
      uiRole: role,
      specialtyName: effectiveSpecialtyName,
      description: description.trim(),
      provider,
      model: effectiveModel,
    })
    setResult(built)
    await installBuilt(built)
  }

  function handleDownload() {
    if (!result) return
    const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)

  async function installBuilt(built: BuiltProfile) {
    if (installing) return
    setInstalling(true)
    try {
      await apiProfiles.installAgentProfileContent({
        name: name.trim(),
        content: built.markdown,
        provider,
      })
      setInstalled(true)
      showSnackbar({ type: 'success', message: `${name.trim()} 프로필을 설치했어요 — 새 세션부터 사용할 수 있어요` })
      onInstalled?.()
      onClose()
    } catch (e) {
      const detail = (e as { detail?: string; message?: string })
      showSnackbar({ type: 'error', message: detail.detail || detail.message || '프로필을 설치하지 못했어요' })
    } finally {
      setInstalling(false)
    }
  }

  async function handleInstall() {
    if (!result) return
    await installBuilt(result)
  }

  async function handleCopyCommand() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      showSnackbar({ type: 'error', message: '명령을 복사하지 못했어요 — 직접 선택해서 복사해 주세요' })
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="에이전트 추가">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Users size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">에이전트 추가</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        {result ? (
          <ResultStep
            result={result}
            provider={provider}
            copied={copied}
            installing={installing}
            installed={installed}
            onInstall={() => void handleInstall()}
            onDownload={handleDownload}
            onCopyCommand={handleCopyCommand}
            onClose={onClose}
            onBack={() => setResult(null)}
          />
        ) : (
          <>
            <div className="space-y-4 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <label htmlFor="ag-name" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                    이름
                  </label>
                  <input
                    id="ag-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="예: nova"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <div className="mt-1 text-[10.5px] text-[var(--text-3)]">
                    설치 위치:{' '}
                    <span className="font-mono">
                      {installDir ? `${installDir}/${name.trim() || '<이름>'}.md` : '불러오는 중…'}
                    </span>
                    {!nameValid && name.length > 0 && (
                      <span className="ml-1 text-[var(--danger)]">영문/숫자/-/_ 1~64자만 사용할 수 있어요</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">아바타</div>
                  <div className="flex items-center gap-2" role="radiogroup" aria-label="아바타 색">
                    <Face color={color} antenna={role === 'Supervisor'} />
                    <div className="flex flex-wrap gap-1.5">
                      {AVATAR_PALETTE.map(k => {
                        const v = avatarVars(k)
                        return (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={color === k}
                            aria-label={k}
                            title={k}
                            onClick={() => setColor(k)}
                            className="h-5 w-5 rounded-md border-2"
                            style={{ background: v.bg, borderColor: color === k ? v.ink : 'transparent' }}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  기본 역할 (role) — CAO 도구 권한 프리셋이 정해져요
                </label>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="기본 역할">
                  {ROLES.map(r => (
                    <button
                      key={r.name}
                      type="button"
                      role="radio"
                      aria-checked={role === r.name}
                      aria-label={r.name}
                      onClick={() => applyRole(r.name)}
                      className={`rounded-xl border px-2.5 py-2 text-left ${
                        role === r.name ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="text-xs font-bold text-[var(--text)]">{r.name}</div>
                      <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-3)]">{r.summary}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 text-[10.5px] text-[var(--text-3)]">
                  {role}: {ROLES.find(r => r.name === role)?.permission}
                </div>
              </div>

              <div>
                <label htmlFor="ag-spec" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  전문 분야 (Specialty)
                </label>
                <select
                  id="ag-spec"
                  value={specialty}
                  onChange={e => applySpecialty(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {(SPECS[role] ?? []).map(([specName]) => (
                    <option key={specName} value={specName}>
                      {specName}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>직접 입력…</option>
                </select>
                {isCustomSpecialty && (
                  <input
                    value={specialtyCustom}
                    onChange={e => setSpecialtyCustom(e.target.value)}
                    placeholder="직접 입력 — 예: 결제 모듈 Developer, 접근성 Reviewer"
                    className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                )}
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--text-3)]">
                  전문 분야는 시스템 프롬프트·기본 Skill·권장 작업 폴더를 정해요. 권한(도구 접근)은 위의 기본 역할이 정하고, 전문 분야는 자유롭게 늘릴 수 있어요.
                </p>
              </div>

              <div>
                <label htmlFor="ag-desc" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  에이전트 설명 (description)
                </label>
                <textarea
                  id="ag-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--text-3)]">
                  프로필의 description으로 저장돼요 — Supervisor가 위임 대상을 고를 때 이 설명을 읽어요. 역할·전문 분야에 맞춰 자동 생성되며 자유롭게 고칠 수 있어요.
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">실행 AI</div>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="실행 AI">
                  {visibleProviders.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      role="radio"
                      aria-checked={provider === p.name}
                      disabled={!p.installed}
                      title={p.installed ? undefined : '이 환경에서 감지되지 않았어요 — 설치 후 사용할 수 있어요'}
                      onClick={() => setProvider(p.name)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                        provider === p.name ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-2)]'
                      }`}
                    >
                      {providerLabel(p.name)}
                      {!p.installed && ' · 미설치'}
                    </button>
                  ))}
                </div>
                {providersError && <p className="mt-1.5 text-[10.5px] text-[var(--warning)]">{providersError}</p>}
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <label htmlFor="ag-model" className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                    모델
                  </label>
                  <button
                    type="button"
                    onClick={loadCatalog}
                    className="ml-auto flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                  >
                    <RefreshCw size={11} className={catalogLoading ? 'animate-spin' : ''} />
                    목록 새로고침
                  </button>
                </div>
                {catalogEntry ? (
                  <>
                    <select
                      id="ag-model"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    >
                      {catalogEntry.models.map(m => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                      <option value={CUSTOM_OPTION}>직접 입력…</option>
                    </select>
                    {isCustomModel && (
                      <input
                        value={modelCustom}
                        onChange={e => setModelCustom(e.target.value)}
                        placeholder="모델 문자열 직접 입력 — CLI에 그대로 전달돼요"
                        className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                    <div className="mt-1 text-[10.5px] text-[var(--text-3)]">
                      모델 출처: {catalogEntry.source === 'known' ? '알려진 모델 별칭 목록 + 직접 입력' : `실시간 조회됨${catalogEntry.probed_at ? ` · ${new Date(catalogEntry.probed_at).toLocaleString('ko-KR')}` : ''}`}
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      id="ag-model"
                      value={modelCustom}
                      onChange={e => setModelCustom(e.target.value)}
                      placeholder="모델 문자열 직접 입력 — CLI에 그대로 전달돼요"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[var(--warning)]">
                      <AlertTriangle size={12} />
                      {catalogError ?? (catalogLoading ? '모델 목록을 조회하는 중…' : '모델 목록을 조회할 수 없어요 — 직접 입력하세요')}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--info)]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  권한 요약: <b>{role}</b> · {ROLES.find(r => r.name === role)?.permission}
                  {provider === 'codex' && ` · Codex는 approval ${preset.codexApprovalPolicy} + sandbox ${preset.codexSandbox}로 생성돼요`}
                </span>
              </div>
              <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-2)]">
                <Key size={13} className="mt-0.5 shrink-0" />
                <span>에이전트 만들기를 누르면 이 서버에 바로 설치되고 목록에 추가돼요. 실행 중 세션에는 영향이 없어요.</span>
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
              <button type="button" onClick={onClose} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canSubmit}
                className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40"
              >
                <Check size={13} />
                에이전트 만들기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ResultStep({
  result,
  provider,
  copied,
  installing,
  installed,
  onInstall,
  onDownload,
  onCopyCommand,
  onClose,
  onBack,
}: {
  result: BuiltProfile
  provider: string
  copied: boolean
  installing: boolean
  installed: boolean
  onInstall: () => void
  onDownload: () => void
  onCopyCommand: () => void
  onClose: () => void
  onBack: () => void
}) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-start gap-2 rounded-xl bg-[var(--success-bg)] px-3 py-2.5 text-xs leading-relaxed text-[var(--success)]">
        <Sparkles size={14} className="mt-0.5 shrink-0" />
        <span>{installing ? '프로필을 이 서버에 설치하고 있어요.' : installed ? '프로필을 설치했어요.' : '설치하지 못했어요. 다시 시도하거나 파일로 내려받을 수 있어요.'}</span>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">바로 설치</div>
        <button
          type="button"
          onClick={onInstall}
          disabled={installing || installed}
          className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-[var(--on-accent)] disabled:opacity-50"
        >
          {installed ? <Check size={13} /> : <Sparkles size={13} />}
          {installed ? '설치됨 — 새 세션부터 사용 가능' : installing ? '설치 중…' : '이 서버에 설치'}
        </button>
      </div>

      <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">또는 — 1. 프로필 파일 다운로드</div>
        <button
          type="button"
          onClick={onDownload}
          className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)]"
        >
          <Download size={13} />
          {result.filename} 다운로드
        </button>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">2. 설치 명령 실행 (다운로드한 폴더에서)</div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-[var(--text)]">{result.installCommand}</code>
          <button
            type="button"
            onClick={onCopyCommand}
            className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-[10.5px] font-semibold text-[var(--text-2)] hover:bg-[var(--surface-3)]"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '복사됨' : '복사'}
          </button>
        </div>
        <p className="mt-1.5 text-[10.5px] text-[var(--text-3)]">실행 AI: {providerLabel(provider)} · 설치 후 새 세션부터 이 에이전트를 사용할 수 있어요.</p>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">생성된 파일 미리보기</div>
        <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-2)]">
          {result.markdown}
        </pre>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border-soft)] pt-3">
        <button type="button" onClick={onBack} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
          이전으로
        </button>
        <button type="button" onClick={onClose} className="h-8 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)]">
          닫기
        </button>
      </div>
    </div>
  )
}
