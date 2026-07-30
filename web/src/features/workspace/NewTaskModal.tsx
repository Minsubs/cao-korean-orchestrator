import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Loader2, Lock, Send, Sparkles, X } from 'lucide-react'
import { api } from '../../api'
import { createSessionWithOptionalProvider, type AgentProfileInfoWithModel } from '../../api.profiles'
import { useStore } from '../../store'
import { CustomSelect, type SelectOption } from '../../components/CustomSelect'
import {
  ADDITIONAL_ROLE_LABELS,
  additionalProfileRole,
  defaultTeamWorkers,
  ORCHESTRATOR_PROFILES,
  profileDetail,
  profileLabel,
  profileSection,
  type OrchestratorProvider,
  workerGroup,
  WORKER_GROUPS,
} from '../profiles/profilePresentation'
import { findGroupById, groupContextLine, listProjectTargets } from './projects'
import { saveTeamRoster } from './teamRoster'
import { newTaskBlockReason } from './newTaskGate'
import type { ProjectsData } from './types'

interface NewTaskModalProps {
  projects: ProjectsData
  defaultTarget?: { targetPath?: string; targetLabel?: string }
  onClose: () => void
  onCreated: (sessionId: string) => void
}

const DIRECT_KEY = '__direct__'

const ORCHESTRATOR_CHOICES: Array<{
  provider: OrchestratorProvider
  label: string
  description: string
}> = [
  { provider: 'codex', label: 'Codex', description: '정확한 구현 조율과 최종 판단에 적합해요.' },
  { provider: 'claude_code', label: 'Claude', description: '긴 맥락의 분석과 설계 조율에 적합해요.' },
  { provider: 'antigravity_cli', label: 'Antigravity', description: '여러 AI를 교차 조율하고 빠르게 처리해요.' },
]

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
  const showOverlay = useStore(s => s.showOverlay)
  const hideOverlay = useStore(s => s.hideOverlay)

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
  const [orchestratorProvider, setOrchestratorProvider] = useState<OrchestratorProvider>('codex')
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
    if (profiles.length === 0) return
    const currentProfile = ORCHESTRATOR_PROFILES[orchestratorProvider]
    if (profiles.some(profile => profile.name === currentProfile)) return
    const fallback = ORCHESTRATOR_CHOICES.find(choice =>
      profiles.some(profile => profile.name === ORCHESTRATOR_PROFILES[choice.provider]),
    )
    if (fallback) setOrchestratorProvider(fallback.provider)
  }, [orchestratorProvider, profiles])

  useEffect(() => {
    setPresetChecks(prev => {
      const next = { ...prev }
      profiles.forEach(p => {
        // The compact default team is ready to use. Discovered specialist
        // agents stay individually selectable but opt-in, so importing a
        // detailed roster never silently dispatches every agent.
        if (!(p.name in next)) next[p.name] = workerGroup(p) !== null
      })
      return next
    })
  }, [profiles])

  const selectedProfile =
    profiles.find(profile => profile.name === ORCHESTRATOR_PROFILES[orchestratorProvider]) ?? null

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
      return '그룹에 지시해요 — 오케스트레이터가 그룹 루트에서 시작해 하위 프로젝트 중 어디 작업인지 판단하고, 워커를 해당 프로젝트 폴더에서 실행해요.'
    }
    return '이 프로젝트 폴더에서 바로 세션을 시작해요.'
  })()

  const sessionNameValid = sessionName.length === 0 || SESSION_NAME_RE.test(sessionName)

  const presetCandidates = useMemo(() => defaultTeamWorkers(profiles), [profiles])
  const additionalCandidates = useMemo(
    () => profiles.filter(profile => profileSection(profile) === 'additional'),
    [profiles],
  )
  const delegatableCandidates = useMemo(
    () => [...presetCandidates, ...additionalCandidates],
    [presetCandidates, additionalCandidates],
  )

  const presetGroups = useMemo(() => {
    const byKey = new Map<string, AgentProfileInfoWithModel[]>()
    presetCandidates.forEach(p => {
      const key = workerGroup(p)
      if (!key) return
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(p)
    })
    return [...byKey.entries()]
      .map(([key, items]) => ({ key: key as keyof typeof WORKER_GROUPS, items }))
      .sort((a, b) => WORKER_GROUPS[a.key].order - WORKER_GROUPS[b.key].order)
  }, [presetCandidates])

  const additionalGroups = useMemo(() => {
    const byRole = new Map<string, AgentProfileInfoWithModel[]>()
    additionalCandidates.forEach(profile => {
      const role = additionalProfileRole(profile)
      byRole.set(role, [...(byRole.get(role) ?? []), profile])
    })
    return [...byRole.entries()]
  }, [additionalCandidates])

  const canSubmit = instruction.trim().length > 0 && selectedProfile !== null && sessionNameValid && !creating
  const blockReason = newTaskBlockReason({
    instruction,
    hasOrchestrator: selectedProfile !== null,
    sessionNameValid,
    creating,
  })

  const handleSubmit = async () => {
    if (!canSubmit) return
    setCreating(true)
    showOverlay('새 작업을 준비하고 있어요', '실행 AI를 시작하는 중이에요')
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
      const checkedPresetNames = delegatableCandidates.filter(p => presetChecks[p.name] === true).map(p => p.name)
      if (checkedPresetNames.length > 0) {
        contextLines.push(`[팀] 위임 가능한 워커 프로필: ${checkedPresetNames.join(', ')} — assign/handoff 시 이 프로필 이름을 사용하세요.`)
      }
      const contextPrefix = contextLines.length > 0 ? `${contextLines.join('\n')}\n\n` : ''

      const terminal = await createSessionWithOptionalProvider(
        orchestratorProvider,
        selectedProfile.name,
        sessionName.trim() || undefined,
        workingDirectory,
      )
      saveTeamRoster(terminal.session_name, checkedPresetNames.map(name => {
        const profile = delegatableCandidates.find(candidate => candidate.name === name)
        return { name, provider: profile?.provider ?? null }
      }))
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
      hideOverlay()
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
            {/* Phase 6 접근성: 라벨을 실제로 연결해 스크린리더가 이 입력을 읽을 수 있게 한다. */}
            <label
              htmlFor="new-task-instruction"
              className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]"
            >
              작업 지시 — 무엇을 할까요?
            </label>
            <textarea
              id="new-task-instruction"
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

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="mb-2.5 flex items-start gap-2">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
                <Lock size={14} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-[var(--text)]">오케스트레이터</span>
                  <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[9.5px] font-bold text-[var(--text-3)]">고정 역할</span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--text-3)]">
                  오케스트레이터로 실행할 AI만 고르세요. 팀 구성과 결과 종합은 같은 고정 역할이 맡아요.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="오케스트레이터 실행 AI">
              {ORCHESTRATOR_CHOICES.map(choice => {
                const profileName = ORCHESTRATOR_PROFILES[choice.provider]
                const profile = profiles.find(entry => entry.name === profileName)
                const available = !!profile
                // Phase 6 내부용어 정리: the raw profile id used to sit here. The
                // model is the part a user actually cares about, and the card
                // title already names the provider — so show only the model, and
                // nothing at all when it is unknown rather than a placeholder.
                const modelLabel = profile?.model ?? null
                const selected = orchestratorProvider === choice.provider
                return (
                  <button
                    key={choice.provider}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${choice.label} 오케스트레이터`}
                    disabled={!available}
                    onClick={() => setOrchestratorProvider(choice.provider)}
                    className={`rounded-xl border p-2.5 text-left transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--surface)] shadow-sm'
                        : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-soft)]'
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--text)]">
                      <Bot size={13} className="text-[var(--accent-text)]" />
                      {choice.label}
                      {selected && <Check size={12} className="ml-auto text-[var(--accent-text)]" />}
                    </span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-3)]">{choice.description}</span>
                    {(!available || modelLabel) && (
                      <span className="mt-1 block font-mono text-[9px] text-[var(--text-3)]">
                        {available ? modelLabel : '프로필 설치 필요'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* spec §4e: 기본 노출은 작업 지시 + 오케스트레이터 선택까지. 팀 구성은
              기본값으로 이미 충분하므로 "고급"으로 접어 둔다(기본 접힘). */}
          {(presetGroups.length > 0 || additionalGroups.length > 0) && (
          <details className="rounded-xl border border-[var(--border)] px-3 py-2">
            <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              고급 — 팀 구성 바꾸기
            </summary>
            <p className="mt-1.5 text-[10.5px] text-[var(--text-3)]">
              그냥 두면 기본 팀으로 진행해요. 특정 역할만 쓰고 싶을 때 조정하세요.
            </p>
            <div className="mt-2 space-y-3">
          {presetGroups.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">기본 팀 — 오케스트레이터가 위임할 역할</label>
              <div className="space-y-1.5">
                {presetGroups.map(group => (
                  <details key={group.key} open className="rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold text-[var(--text-2)]">
                      {WORKER_GROUPS[group.key].label} <span className="font-normal text-[var(--text-3)]">({group.items.length})</span>
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
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-[var(--text)]">{profileLabel(p.name)}</span>
                            <span className="block truncate text-[9.5px] text-[var(--text-3)]">{profileDetail(p)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
              <p className="mt-1 text-[10.5px] text-[var(--text-3)]">
                체크한 역할은 후보로만 전달돼요. 실제 담당자는 오케스트레이터가 작업을 나눌 때 필요한 만큼만 만들어요.
              </p>
            </div>
          )}

          {additionalGroups.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">추가 전문 에이전트 — 필요할 때 선택</label>
              <div className="space-y-1.5">
                {additionalGroups.map(([role, items]) => (
                  <details key={role} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold text-[var(--text-2)]">
                      {ADDITIONAL_ROLE_LABELS[role] ?? role} <span className="font-normal text-[var(--text-3)]">({items.length})</span>
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {items.map(profile => (
                        <label key={profile.name} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                          <input
                            type="checkbox"
                            checked={presetChecks[profile.name] === true}
                            onChange={event => setPresetChecks(prev => ({ ...prev, [profile.name]: event.target.checked }))}
                            className="accent-[var(--accent)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-[var(--text)]">{profileLabel(profile.name)}</span>
                            <span className="block truncate text-[9.5px] text-[var(--text-3)]">{profileDetail(profile)}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
            </div>
          </details>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          {blockReason && (
            <p className="mr-auto text-[10.5px] text-[var(--text-3)]" role="status">
              {blockReason}
            </p>
          )}
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
