import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Pencil, RefreshCw, X } from 'lucide-react'
import type { AgentProfileInfo } from '../../api'
import { apiProfiles, fetchModelCatalog, type AgentProfileFullDetail, type ModelCatalogEntry } from '../../api.profiles'
import { useStore } from '../../store'
import { CUSTOM_OPTION } from './roleData'
import { yamlScalar } from './profileTemplate'

interface EditProfileModalProps {
  profile: AgentProfileInfo
  onClose: () => void
  /** Fires after a successful save so ProfilesView can refresh the card list. */
  onSaved: () => void
}

/**
 * "프로필 수정" (feedback #2). Loads the full parsed profile via
 * `GET /agents/profiles/{name}` (the server's AgentProfile model_dump: body is
 * `system_prompt`, plus arbitrary frontmatter keys like mcpServers /
 * allowedTools / role). Name is fixed (it's the filename, unrenamable without
 * moving the file). Only description/model/prompt-body are editable here, but
 * saving re-emits EVERY frontmatter field returned by the server so nothing is
 * silently dropped — stripping e.g. mcpServers on save would disconnect a
 * supervisor profile from the orchestration tools. Nested values are emitted
 * as JSON flow style, which is valid YAML for the server's frontmatter parser
 * (python-frontmatter/PyYAML). What is NOT preserved: comments and key order
 * of the original file — the notice below says so.
 */

/** Frontmatter keys that are not re-emitted: identity/body/edited-elsewhere. */
const FM_SKIP_KEYS = new Set(['name', 'description', 'system_prompt', 'provider', 'model'])

/**
 * Render one frontmatter value as a single-line YAML scalar/flow value.
 * JSON.stringify output is valid YAML (double-quoted scalars with \n escapes,
 * flow-style mappings/sequences), so it round-trips any JSON-able value the
 * server returned without a YAML emitter dependency.
 */
function yamlValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
export function EditProfileModal({ profile, onClose, onSaved }: EditProfileModalProps) {
  const showSnackbar = useStore(s => s.showSnackbar)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentProfileFullDetail | null>(null)

  const [description, setDescription] = useState(profile.description ?? '')
  // `model` mirrors AddAgentModal's split: either a real catalog model name or
  // the CUSTOM_OPTION sentinel, with the free-text fallback held separately in
  // `modelCustom` (see AddAgentModal.tsx for the reference pattern).
  const [model, setModel] = useState('')
  const [modelCustom, setModelCustom] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  const [catalog, setCatalog] = useState<ModelCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)

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
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    apiProfiles
      .getAgentProfileDetail(profile.name)
      .then((data: AgentProfileFullDetail) => {
        if (cancelled) return
        setDetail(data)
        setDescription(data.description ?? profile.description ?? '')
        setPrompt(data.system_prompt ?? '')
      })
      .catch(() => {
        if (cancelled) return
        setLoadError('프로필 상세 정보를 불러오지 못했어요 — 서버 연결을 확인해 주세요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [profile.name, profile.description])

  const detailProvider = detail?.provider ?? null
  const catalogEntry = useMemo(() => catalog?.find(e => e.provider === detailProvider) ?? null, [catalog, detailProvider])

  // Prefill the model select exactly once — after both the profile detail and
  // the (possibly failed) catalog fetch have settled — so a stored model that
  // isn't in the catalog lands in CUSTOM_OPTION mode with its value intact,
  // instead of silently being dropped or overwritten by a later catalog
  // refresh (guarded by the ref, not just the effect deps).
  const modelInitialized = useRef(false)
  useEffect(() => {
    if (modelInitialized.current) return
    if (!detail || catalogLoading) return
    const initial = (detail.model ?? '').trim()
    if (initial && catalogEntry && catalogEntry.models.some(m => m.name === initial)) {
      setModel(initial)
      setModelCustom('')
    } else {
      setModel(CUSTOM_OPTION)
      setModelCustom(initial)
    }
    modelInitialized.current = true
  }, [detail, catalogLoading, catalogEntry])

  const isCustomModel = model === CUSTOM_OPTION
  const effectiveModel = (isCustomModel ? modelCustom : model).trim()

  const canSave = !loading && !loadError && !saving && detail !== null && description.trim().length > 0

  async function handleSave() {
    if (!canSave || detail === null) return
    setSaving(true)
    try {
      const fm: string[] = ['---']
      fm.push(`name: ${profile.name}`)
      fm.push(`description: ${yamlScalar(description.trim())}`)
      if (detailProvider) fm.push(`provider: ${detailProvider}`)
      if (effectiveModel) fm.push(`model: ${yamlScalar(effectiveModel)}`)
      // Re-emit every remaining frontmatter field the server returned so a
      // save never strips settings the form doesn't edit (mcpServers,
      // allowedTools, role, permissionMode, ...).
      for (const [key, value] of Object.entries(detail)) {
        if (FM_SKIP_KEYS.has(key) || value === null || value === undefined) continue
        fm.push(`${key}: ${yamlValue(value)}`)
      }
      fm.push('---')
      const markdown = `${fm.join('\n')}\n\n${prompt}\n`

      await apiProfiles.installAgentProfileContent({
        name: profile.name,
        content: markdown,
        provider: detailProvider ?? undefined,
        overwrite: true,
      })
      showSnackbar({ type: 'success', message: `${profile.name} 프로필을 저장했어요` })
      onSaved()
      onClose()
    } catch (e) {
      const err = e as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || '프로필을 저장하지 못했어요' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`${profile.name} 프로필 수정`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Pencil size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 truncate text-sm font-semibold text-[var(--text)]">{profile.name} 프로필 수정</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="flex items-start gap-2 rounded-xl bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--warning)]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            설명·모델·프롬프트 본문만 편집할 수 있어요. 나머지 설정(mcpServers, allowedTools 등)은 그대로 보존되지만, 원본 파일의 주석과 필드 순서는 유지되지 않아요.
          </div>

          {loading ? (
            <p className="text-xs text-[var(--text-3)]">불러오는 중…</p>
          ) : loadError ? (
            <p className="text-xs text-[var(--danger)]">{loadError}</p>
          ) : (
            <>
              <div>
                <label htmlFor="ep-name" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  이름
                </label>
                <input
                  id="ep-name"
                  value={profile.name}
                  disabled
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-xs text-[var(--text-3)]"
                />
              </div>
              <div>
                <label htmlFor="ep-desc" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  설명
                </label>
                <textarea
                  id="ep-desc"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <label htmlFor="ep-model" className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
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
                      id="ep-model"
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
                      id="ep-model"
                      value={modelCustom}
                      onChange={e => setModelCustom(e.target.value)}
                      placeholder="예: sonnet"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    {catalogError && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[var(--warning)]">
                        <AlertTriangle size={12} />
                        {catalogError}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div>
                <label htmlFor="ep-prompt" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                  프롬프트 (시스템 프롬프트 본문)
                </label>
                <textarea
                  id="ep-prompt"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={8}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
