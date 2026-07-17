import { useEffect, useState } from 'react'
import { Check, Loader2, X, Zap } from 'lucide-react'
import { api, type AgentProfileInfo, type ProviderInfo } from '../../api'
import { useStore } from '../../store'

interface NewFlowModalProps {
  onClose: () => void
  onCreated: () => void
}

const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: '매일 09:00', cron: '0 9 * * *' },
  { label: '평일 09:00', cron: '0 9 * * 1-5' },
  { label: '매주 월 09:00', cron: '0 9 * * 1' },
  { label: '매시간', cron: '0 * * * *' },
  { label: '5분마다', cron: '*/5 * * * *' },
]
const CUSTOM_SCHEDULE = '__custom__'

/**
 * profile.source is often the provider slug directly (e.g. "codex"), same
 * best-effort mapping idea NewTaskModal.tsx uses for the Workspace "새 작업"
 * modal — duplicated here (that function is a private, unexported const, and
 * this feature must not import from features/workspace beyond the avatar
 * utilities the spec calls out) rather than reused. Falling back to the first
 * installed provider (instead of leaving it blank) matters here: the backend
 * defaults an omitted `provider` to "kiro_cli" (CreateFlowRequest), which is
 * usually not what's installed.
 */
const SOURCE_TO_PROVIDER: Record<string, string> = { kiro: 'kiro_cli' }

function inferProvider(profile: AgentProfileInfo | undefined, providers: ProviderInfo[]): string {
  if (profile) {
    const candidates = [profile.source, SOURCE_TO_PROVIDER[profile.source]].filter(Boolean) as string[]
    const match = candidates.find(c => providers.some(p => p.name === c && p.installed))
    if (match) return match
  }
  return providers.find(p => p.installed)?.name ?? 'kiro_cli'
}

export function NewFlowModal({ onClose, onCreated }: NewFlowModalProps) {
  const showSnackbar = useStore(s => s.showSnackbar)

  const [name, setName] = useState('')
  const [scheduleChoice, setScheduleChoice] = useState<string>(SCHEDULE_PRESETS[1].cron)
  const [customCron, setCustomCron] = useState(SCHEDULE_PRESETS[1].cron)
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [agentProfile, setAgentProfile] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch(() => {})
    api.listProviders().then(setProviders).catch(() => {})
  }, [])

  const isCustomSchedule = scheduleChoice === CUSTOM_SCHEDULE
  const effectiveCron = isCustomSchedule ? customCron.trim() : scheduleChoice
  const selectedProfile = profiles.find(p => p.name === agentProfile)
  const inferredProvider = inferProvider(selectedProfile, providers)

  const canSubmit = name.trim().length > 0 && effectiveCron.length > 0 && agentProfile.trim().length > 0 && promptTemplate.trim().length > 0 && !creating

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      await api.createFlow({
        name: name.trim(),
        schedule: effectiveCron,
        agent_profile: agentProfile.trim(),
        provider: inferredProvider,
        prompt_template: promptTemplate,
      })
      showSnackbar({ type: 'success', message: `"${name.trim()}" Flow를 만들었어요` })
      onCreated()
      onClose()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      showSnackbar({ type: 'error', message: err?.detail || err?.message || 'Flow를 만들지 못했어요' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="새 Flow">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <Zap size={16} className="text-[var(--accent-text)]" />
          <span className="flex-1 text-sm font-semibold text-[var(--text)]">새 Flow — 스케줄 자동 실행</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label htmlFor="fl-name" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              이름
            </label>
            <input
              id="fl-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: nightly-regression"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex gap-2.5">
            <div className="flex-1">
              <label htmlFor="fl-preset" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                스케줄
              </label>
              <select
                id="fl-preset"
                value={scheduleChoice}
                onChange={e => {
                  setScheduleChoice(e.target.value)
                  if (e.target.value !== CUSTOM_SCHEDULE) setCustomCron(e.target.value)
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {SCHEDULE_PRESETS.map(p => (
                  <option key={p.cron} value={p.cron}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_SCHEDULE}>직접 입력…</option>
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="fl-cron" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
                Cron 표현식
              </label>
              <input
                id="fl-cron"
                value={effectiveCron}
                onChange={e => {
                  setCustomCron(e.target.value)
                  setScheduleChoice(CUSTOM_SCHEDULE)
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="fl-agent" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              실행할 에이전트
            </label>
            <select
              id="fl-agent"
              value={agentProfile}
              onChange={e => setAgentProfile(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="">프로필 선택...</option>
              {profiles.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[10.5px] text-[var(--text-3)]">
              provider: {inferredProvider}{!providers.some(p => p.installed) && ' (감지된 provider가 없어요 — 확인 후 실행하세요)'} · 실행 시마다 새 세션이 만들어져요.
            </div>
          </div>

          <div>
            <label htmlFor="fl-prompt" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
              프롬프트 템플릿
            </label>
            <textarea
              id="fl-prompt"
              value={promptTemplate}
              onChange={e => setPromptTemplate(e.target.value)}
              rows={3}
              placeholder="예: 어제 커밋을 검토하고 회귀 위험이 있는 변경을 요약해줘."
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
          <button type="button" onClick={onClose} className="h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-2)]">
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSubmit}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-40"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Flow 만들기
          </button>
        </div>
      </div>
    </div>
  )
}
