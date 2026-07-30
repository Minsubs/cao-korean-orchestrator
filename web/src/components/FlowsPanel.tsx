import { useState, useEffect } from 'react'
import { api, Flow, AgentProfileInfo, ProviderInfo } from '../api'
import { useStore } from '../store'
import { ConfirmModal } from './ConfirmModal'
import { Clock, Play, Trash2, Plus, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { CustomSelect } from './CustomSelect'

const SCHEDULE_PRESETS = [
  { label: '5분마다', cron: '*/5 * * * *' },
  { label: '15분마다', cron: '*/15 * * * *' },
  { label: '매시간', cron: '0 * * * *' },
  { label: '6시간마다', cron: '0 */6 * * *' },
  { label: '매일 오전 9시', cron: '0 9 * * *' },
  { label: '평일 오전 9시', cron: '0 9 * * 1-5' },
  { label: '매주 월요일 오전 9시', cron: '0 9 * * 1' },
  { label: '매월 1일 자정', cron: '0 0 1 * *' },
]

const CUSTOM_CRON_VALUE = '__custom__'

function cronToLabel(cron: string): string {
  return SCHEDULE_PRESETS.find(p => p.cron === cron)?.label || cron
}

export function FlowsPanel() {
  const { showSnackbar } = useStore()

  // Flow list state
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [togglingFlow, setTogglingFlow] = useState<string | null>(null)
  const [runningFlow, setRunningFlow] = useState<string | null>(null)

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<Flow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom'>('preset')
  const [agentProfile, setAgentProfile] = useState('')
  const [provider, setProvider] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [creating, setCreating] = useState(false)

  // Profiles & providers for dropdowns
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  const fetchFlows = async () => {
    try {
      const data = await api.listFlows()
      setFlows(data)
    } catch {
      setFlows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFlows()
    api.listProfiles()
      .then(p => setProfiles(p))
      .catch(() => {})
    api.listProviders()
      .then(p => {
        setProviders(p)
        const firstInstalled = p.find(prov => prov.installed)
        if (firstInstalled) setProvider(firstInstalled.name)
      })
      .catch(() => {})
  }, [])

  const resetForm = () => {
    setName('')
    setSchedule('')
    setScheduleMode('preset')
    setAgentProfile('')
    setPromptTemplate('')
  }

  const handleCreate = async () => {
    if (!name.trim() || !schedule.trim() || !agentProfile.trim() || !promptTemplate.trim()) return
    setCreating(true)
    try {
      await api.createFlow({
        name: name.trim(),
        schedule: schedule.trim(),
        agent_profile: agentProfile.trim(),
        provider: provider || undefined,
        prompt_template: promptTemplate,
      })
      showSnackbar({ type: 'success', message: `자동화 "${name.trim()}"을(를) 만들었습니다` })
      resetForm()
      setShowCreateModal(false)
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '자동화를 만들지 못했습니다' })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (flow: Flow) => {
    setTogglingFlow(flow.name)
    try {
      if (flow.enabled) {
        await api.disableFlow(flow.name)
        showSnackbar({ type: 'success', message: `자동화 "${flow.name}"을(를) 비활성화했습니다` })
      } else {
        await api.enableFlow(flow.name)
        showSnackbar({ type: 'success', message: `자동화 "${flow.name}"을(를) 활성화했습니다` })
      }
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '자동화 상태를 변경하지 못했습니다' })
    } finally {
      setTogglingFlow(null)
    }
  }

  const handleRun = async (flow: Flow) => {
    setRunningFlow(flow.name)
    try {
      await api.runFlow(flow.name)
      showSnackbar({ type: 'success', message: `자동화 "${flow.name}"을(를) 실행했습니다` })
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '자동화를 실행하지 못했습니다' })
    } finally {
      setRunningFlow(null)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteFlow(pendingDelete.name)
      showSnackbar({ type: 'success', message: `자동화 "${pendingDelete.name}"을(를) 삭제했습니다` })
      await fetchFlows()
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '자동화를 삭제하지 못했습니다' })
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  if (loading) {
    return <div className="text-[var(--text-3)] text-sm py-8 text-center">자동화 불러오는 중…</div>
  }

  const scheduleSelectOptions = [
    ...SCHEDULE_PRESETS.map(p => ({
      value: p.cron,
      label: p.label,
      sublabel: p.cron,
    })),
    { value: CUSTOM_CRON_VALUE, label: '사용자 지정 cron 표현식', sublabel: '직접 일정을 입력합니다' },
  ]

  return (
    <div className="space-y-6">
      {/* Flow List */}
      <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">
            예약 자동화 ({flows.length})
          </h3>
          <button
            onClick={() => { resetForm(); setShowCreateModal(true) }}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} />
            자동화 만들기
          </button>
        </div>

        {flows.length === 0 ? (
          <div className="text-center py-8">
            <Clock size={32} className="mx-auto text-[var(--text-3)] mb-3" />
            <p className="text-[var(--text-3)] text-sm">설정된 자동화가 없습니다.</p>
            <p className="text-[var(--text-3)] text-xs mt-1">
              위의 "자동화 만들기"를 누르거나 CLI를 사용하세요: <code className="text-[var(--accent-text)]">cao schedule add &lt;file.md&gt;</code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {flows.map(f => (
              <div key={f.name} className="bg-[var(--surface)] border border-[var(--border-soft)] rounded-lg">
                {/* Row header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                  onClick={() => setExpanded(expanded === f.name ? null : f.name)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock size={14} className="text-[var(--text-3)] shrink-0" />
                    <span className="text-sm text-[var(--text)] font-medium truncate">{f.name}</span>
                    <span className="text-xs text-[var(--text-3)] shrink-0" title={f.schedule}>
                      {cronToLabel(f.schedule)}
                    </span>
                    <span className="text-xs text-[var(--text-3)] shrink-0">{f.agent_profile}</span>
                    {f.provider && (
                      <span className="text-xs text-[var(--text-3)] shrink-0">{f.provider}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${f.enabled ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-3)] text-[var(--text-3)]'}`}>
                      {f.enabled ? '활성' : '비활성'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {/* Toggle enable/disable */}
                    <button
                      onClick={e => { e.stopPropagation(); handleToggle(f) }}
                      disabled={togglingFlow === f.name}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        f.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'
                      } ${togglingFlow === f.name ? 'opacity-50' : ''}`}
                      title={f.enabled ? '자동화 비활성화' : '자동화 활성화'}
                    >
                      {togglingFlow === f.name ? (
                        <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-[var(--text)]" />
                      ) : (
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                          f.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`} />
                      )}
                    </button>

                    {/* Run Now */}
                    <button
                      onClick={e => { e.stopPropagation(); handleRun(f) }}
                      disabled={runningFlow === f.name}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-xs font-medium rounded-lg transition-colors"
                      title="자동화 지금 실행"
                    >
                      {runningFlow === f.name ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      {runningFlow === f.name ? '실행 중…' : '지금 실행'}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); setPendingDelete(f) }}
                      className="p-1.5 text-[var(--text-3)] hover:text-[var(--danger)] transition-colors rounded"
                      title="자동화 삭제"
                    >
                      <Trash2 size={14} />
                    </button>

                    {/* Expand chevron */}
                    {expanded === f.name ? (
                      <ChevronDown size={14} className="text-[var(--text-3)]" />
                    ) : (
                      <ChevronRight size={14} className="text-[var(--text-3)]" />
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {expanded === f.name && (
                  <div className="px-3 pb-3 text-xs text-[var(--text-3)] space-y-3 border-t border-[var(--border-soft)] pt-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      <div>일정: <span className="text-[var(--text-2)] font-mono">{f.schedule}</span></div>
                      <div>제공자: <span className="text-[var(--text-2)]">{f.provider || '기본값'}</span></div>
                      <div>프로필: <span className="text-[var(--text-2)]">{f.agent_profile}</span></div>
                      <div>마지막 실행: <span className="text-[var(--text-2)]">{f.last_run ? new Date(f.last_run).toLocaleString('ko-KR') : '실행 기록 없음'}</span></div>
                      <div>다음 실행: <span className="text-[var(--text-2)]">{f.next_run ? new Date(f.next_run).toLocaleString('ko-KR') : '해당 없음'}</span></div>
                      {f.file_path && (
                        <div className="col-span-2">파일: <span className="text-[var(--text-2)] font-mono">{f.file_path}</span></div>
                      )}
                    </div>
                    {f.prompt_template && (
                      <div>
                        <div className="text-[11px] text-[var(--text-3)] uppercase tracking-wider mb-1.5">프롬프트</div>
                        <div className="bg-[var(--bg)] border border-[var(--border-soft)] rounded-lg p-3 text-sm text-[var(--text-2)] font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                          {f.prompt_template}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Flow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="relative bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-soft)]">
              <div>
                <h3 className="text-base font-semibold text-[var(--text)]">자동화 만들기</h3>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  에이전트를 반복 일정에 따라 자동으로 실행합니다.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors rounded-lg hover:bg-[var(--surface-3)]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="my-daily-review"
                  className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">일정</label>
                <CustomSelect
                  value={scheduleMode === 'custom' ? CUSTOM_CRON_VALUE : schedule}
                  onChange={val => {
                    if (val === CUSTOM_CRON_VALUE) {
                      setScheduleMode('custom')
                      setSchedule('')
                    } else {
                      setScheduleMode('preset')
                      setSchedule(val)
                    }
                  }}
                  placeholder="일정 선택..."
                  options={scheduleSelectOptions}
                />
                {scheduleMode === 'custom' && (
                  <input
                    type="text"
                    value={schedule}
                    onChange={e => setSchedule(e.target.value)}
                    placeholder="*/30 * * * *"
                    className="w-full mt-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 font-mono focus:border-[var(--accent)] focus:outline-none"
                    autoFocus
                  />
                )}
                {schedule && (
                  <p className="text-[11px] text-[var(--accent-text)] mt-1.5">
                    {cronToLabel(schedule)}{scheduleMode === 'custom' && schedule ? ` — ${schedule}` : ''}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1">에이전트 프로필</label>
                  {profiles.length > 0 ? (
                    <CustomSelect
                      value={agentProfile}
                      onChange={setAgentProfile}
                      placeholder="프로필 선택..."
                      options={profiles.map(p => ({
                        value: p.name,
                        label: p.name,
                        sublabel: p.description || undefined,
                      }))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={agentProfile}
                      onChange={e => setAgentProfile(e.target.value)}
                      placeholder="예: developer"
                      className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                    />
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1">제공자</label>
                  <CustomSelect
                    value={provider}
                    onChange={setProvider}
                    placeholder="기본값"
                    options={providers.map(p => ({
                      value: p.name,
                      label: p.name.replace(/_/g, ' '),
                      sublabel: !p.installed ? '설치되지 않음' : undefined,
                      disabled: !p.installed,
                    }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">프롬프트</label>
                <textarea
                  value={promptTemplate}
                  onChange={e => setPromptTemplate(e.target.value)}
                  placeholder="이 자동화가 수행할 작업을 설명하세요..."
                  rows={5}
                  className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 font-mono focus:border-[var(--accent)] focus:outline-none resize-y"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--border-soft)]">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !schedule.trim() || !agentProfile.trim() || !promptTemplate.trim() || creating}
                className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? '만드는 중…' : '자동화 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!pendingDelete}
        title="자동화 삭제"
        message="자동화와 일정을 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다."
        details={pendingDelete ? [
          { label: '이름', value: pendingDelete.name },
          { label: '일정', value: pendingDelete.schedule },
          { label: '프로필', value: pendingDelete.agent_profile },
          { label: '제공자', value: pendingDelete.provider || '기본값' },
        ] : []}
        confirmLabel="자동화 삭제"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
