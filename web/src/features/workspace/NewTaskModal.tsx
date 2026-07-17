import { useEffect, useMemo, useState } from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import { api } from '../../api'
import { createSessionWithOptionalProvider, type AgentProfileInfoWithModel } from '../../api.profiles'
import { useStore } from '../../store'
import { CustomSelect, type SelectOption } from '../../components/CustomSelect'
import { providerLabel } from '../profiles/roleData'
import { findGroupById, groupContextLine, listProjectTargets } from './projects'
import type { ProjectsData } from './types'

interface NewTaskModalProps {
  projects: ProjectsData
  defaultTarget?: { targetPath?: string; targetLabel?: string }
  onClose: () => void
  onCreated: (sessionId: string) => void
}

const DIRECT_KEY = '__direct__'

/**
 * Server rule (utils/terminal.py `_VALID_TMUX_NAME`, confirmed by 5.5-A):
 * first char alnum/underscore, then alnum/underscore/dash, max 60 user chars
 * — the server prepends its own 4-char `cao-` prefix for tmux's 64-char cap.
 * Empty is fine (means "auto-generate"); enforced at `canSubmit` below, not
 * here, so an empty field never blocks submit on its own.
 */
const SESSION_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,59}$/

export function NewTaskModal({ projects, defaultTarget, onClose, onCreated }: NewTaskModalProps) {
  const showSnackbar = useStore(s => s.showSnackbar)
  const fetchSessions = useStore(s => s.fetchSessions)

  const targets = useMemo(() => listProjectTargets(projects), [projects])

  const [instruction, setInstruction] = useState('')
  const [targetKey, setTargetKey] = useState<string>(() => {
    if (defaultTarget?.targetPath) {
      const match = targets.find(t => t.path === defaultTarget.targetPath)
      if (match) return match.key
    }
    return targets[0]?.key ?? DIRECT_KEY
  })
  const [directPath, setDirectPath] = useState('')
  const [profiles, setProfiles] = useState<AgentProfileInfoWithModel[]>([])
  const [supervisorProfile, setSupervisorProfile] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [presetChecks, setPresetChecks] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // The runtime objects already carry provider/model — 5.5-A landed that
    // backend field on GET /agents/profiles. api.ts's own AgentProfileInfo
    // type intentionally wasn't widened (forbidden file for this change; see
    // api.profiles.ts's AgentProfileInfoWithModel docstring) — this cast just
    // describes what's actually on the wire now, not asserting something false.
    api
      .listProfiles()
      .then(list => setProfiles(list as AgentProfileInfoWithModel[]))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPresetChecks(prev => {
      const next = { ...prev }
      profiles.forEach(p => {
        if (!(p.name in next)) next[p.name] = true
      })
      return next
    })
  }, [profiles])

  const selectedProfile = profiles.find(p => p.name === supervisorProfile) ?? null
  // Feedback #1: the profile's own (now real, nullable) `provider` field is
  // authoritative. Never force a fallback (the confirmed bug: an unresolved
  // provider silently became the literal string 'claude_code' at submit
  // time) — null flows straight through to createSessionWithOptionalProvider,
  // which omits the query param entirely so the backend resolves it from the
  // profile's own frontmatter instead of a guessed/incorrect one.
  const effectiveProvider = selectedProfile?.provider ?? null

  const selectOptions: SelectOption[] = [
    ...targets.map(t => ({
      value: t.key,
      label: t.label,
      sublabel: t.path,
      group: t.kind === 'project' ? '독립 프로젝트' : findGroupById(projects, t.groupId ?? '')?.name,
    })),
    { value: DIRECT_KEY, label: '직접 경로 입력…' },
  ]

  const targetHelp = (() => {
    if (targetKey === DIRECT_KEY) return '직접 입력한 경로에서 세션을 시작해요.'
    const opt = targets.find(t => t.key === targetKey)
    if (opt?.kind === 'group-root') {
      return '그룹에 지시해요 — Supervisor가 그룹 루트에서 시작해 하위 프로젝트 중 어디 작업인지 판단하고, 워커를 해당 프로젝트 폴더에서 실행해요.'
    }
    return '이 프로젝트 폴더에서 바로 세션을 시작해요.'
  })()

  const sessionNameValid = sessionName.length === 0 || SESSION_NAME_RE.test(sessionName)

  // Feedback #11: same candidate list the checklist renders, grouped by
  // provider — reused again at submit time (#5) so both features read one
  // source of truth instead of drifting apart.
  const presetCandidates = useMemo(() => profiles.filter(p => p.name !== supervisorProfile).slice(0, 8), [profiles, supervisorProfile])

  const presetGroups = useMemo(() => {
    const order: string[] = []
    const byKey = new Map<string, AgentProfileInfoWithModel[]>()
    presetCandidates.forEach(p => {
      // Real `provider` wins; a profile with none yet falls back to its
      // `source` tag purely so it still lands in *a* labeled group instead
      // of being dropped — never fabricates a provider value.
      const key = p.provider ?? p.source
      if (!byKey.has(key)) {
        byKey.set(key, [])
        order.push(key)
      }
      byKey.get(key)!.push(p)
    })
    return order.map(key => ({ key, items: byKey.get(key)! }))
  }, [presetCandidates])

  const canSubmit = instruction.trim().length > 0 && supervisorProfile.trim().length > 0 && sessionNameValid && !creating

  const handleSubmit = async () => {
    if (!canSubmit) return
    setCreating(true)
    try {
      let workingDirectory: string | undefined
      const contextLines: string[] = []
      if (targetKey === DIRECT_KEY) {
        workingDirectory = directPath.trim() || undefined
      } else {
        const opt = targets.find(t => t.key === targetKey)
        workingDirectory = opt?.path
        if (opt?.kind === 'group-root' && opt.groupId) {
          const group = findGroupById(projects, opt.groupId)
          if (group) contextLines.push(groupContextLine(group))
        }
      }

      // Feedback #5: name the checked preset profiles for the Supervisor so
      // assign/handoff has concrete names to target — omitted entirely when
      // nothing is checked (never an empty "[팀]" line).
      const checkedPresetNames = presetCandidates.filter(p => presetChecks[p.name] !== false).map(p => p.name)
      if (checkedPresetNames.length > 0) {
        contextLines.push(`[팀] 위임 가능한 워커 프로필: ${checkedPresetNames.join(', ')} — assign/handoff 시 이 프로필 이름을 사용하세요.`)
      }
      const contextPrefix = contextLines.length > 0 ? `${contextLines.join('\n')}\n\n` : ''

      const terminal = await createSessionWithOptionalProvider(
        effectiveProvider,
        supervisorProfile.trim(),
        sessionName.trim() || undefined,
        workingDirectory,
      )
      await api.sendInput(terminal.id, `${contextPrefix}${instruction.trim()}`)
      showSnackbar({ type: 'success', message: '작업을 시작했어요' })
      await fetchSessions()
      onCreated(terminal.session_name)
      onClose()
    } catch (error: unknown) {
      const err = error as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || '작업을 시작하지 못했어요' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="새 작업">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Send size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">새 작업</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">작업 지시 — 무엇을 할까요?</label>
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              rows={3}
              placeholder="예: 세션 만료 후 재로그인하면 토큰 갱신이 두 번 실행돼. 원인 찾아서 고치고 회귀 테스트까지 돌려줘."
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">대상</label>
            <CustomSelect value={targetKey} onChange={setTargetKey} options={selectOptions} />
            {targetKey === DIRECT_KEY && (
              <input
                value={directPath}
                onChange={e => setDirectPath(e.target.value)}
                placeholder="~/work/my-project"
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
            <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[var(--info-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--info)]">
              <Sparkles size={12} className="mt-0.5 shrink-0" />
              {targetHelp}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              세션 이름 <span className="font-normal normal-case text-[var(--text-3)]">(비우면 자동 생성)</span>
            </label>
            <input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="예: login-retry-fix"
              aria-invalid={!sessionNameValid}
              className={`w-full rounded-lg border bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] ${
                sessionNameValid ? 'border-[var(--border)]' : 'border-[var(--danger)]'
              }`}
            />
            {!sessionNameValid && <p className="mt-1 text-[10.5px] text-[var(--danger)]">세션 이름은 영문/숫자/-/_만 가능해요</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">Supervisor</label>
            <CustomSelect
              value={supervisorProfile}
              onChange={setSupervisorProfile}
              placeholder="프로필 선택..."
              options={profiles.map(p => ({ value: p.name, label: p.name, sublabel: p.description || undefined, group: p.source }))}
            />
            {selectedProfile && (
              <p className="mt-1 text-[10.5px] text-[var(--text-3)]">provider: {effectiveProvider ?? '프로필 기본값 사용 (자동 판단)'}</p>
            )}
          </div>

          {presetGroups.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">팀 프리셋 — Supervisor가 위임할 수 있는 에이전트</label>
              <div className="space-y-1.5">
                {presetGroups.map(group => (
                  <details key={group.key} open className="rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold text-[var(--text-2)]">
                      {providerLabel(group.key)} <span className="font-normal text-[var(--text-3)]">({group.items.length})</span>
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {group.items.map(p => (
                        <label key={p.name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                          <input
                            type="checkbox"
                            checked={presetChecks[p.name] !== false}
                            onChange={e => setPresetChecks(prev => ({ ...prev, [p.name]: e.target.checked }))}
                            className="accent-[var(--accent)]"
                          />
                          <span className="text-xs font-medium text-[var(--text)]">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
              <p className="mt-1 text-[10.5px] text-[var(--text-3)]">
                표시용 로스터예요 — 실제 워커 터미널은 Supervisor가 작업을 나눌 때 생성돼요. 미리 실행되지 않아요. 체크된 이름은 Supervisor의 첫 지시에 함께 전달돼요.
              </p>
            </div>
          )}
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
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            작업 시작
          </button>
        </div>
      </div>
    </div>
  )
}
