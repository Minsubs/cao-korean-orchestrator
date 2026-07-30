import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api, AgentProfileInfo, ProviderInfo } from '../api'
import { Bot, Play, Trash2, ChevronRight, Terminal as TermIcon, Monitor, Package, FolderOpen, Tag, Search, Mail, Plus, LogOut, Send, FileText, X, MessageCircle, Loader2 } from 'lucide-react'
import { TerminalView } from './TerminalView'
import { ConfirmModal } from './ConfirmModal'
import { InboxPanel } from './InboxPanel'
import { CustomSelect, SelectOption } from './CustomSelect'
import { TerminalMeta } from '../api'
import { StatusBadge } from './StatusBadge'
import { OutputViewer } from './OutputViewer'
import { SessionChatPanel } from './SessionChatPanel'
import {
  isOrchestratorProfile,
  profileDescription,
  profileLabel,
  profileSectionLabel,
} from '../features/profiles/profilePresentation'
import { providerLabel } from '../features/profiles/roleData'

export const FALLBACK_PROVIDERS = ['kiro_cli', 'claude_code', 'q_cli', 'codex', 'gemini_cli', 'hermes', 'kimi_cli', 'copilot_cli', 'opencode_cli', 'cursor_cli']

const SESSION_STATUS_LABELS: Record<string, string> = {
  active: '활성',
  attached: '연결됨',
  detached: '분리됨',
  inactive: '비활성',
  dead: '종료됨',
  unknown: '알 수 없음',
}

export function AgentPanel() {
  const { sessions, fetchSessions, activeSession, activeSessionDetail, selectSession, createSession, deleteSession, terminalStatuses, setTerminalStatus } = useStore()
  const [provider, setProvider] = useState('kiro_cli')
  const [profile, setProfile] = useState('')
  const [creating, setCreating] = useState(false)
  // Synchronous in-flight lock: prevents a second submit (rapid double-click or
  // Enter in the form inputs, which bypass the button's disabled state) from
  // firing before the `creating` state re-renders and creating a duplicate session.
  const creatingRef = useRef(false)
  const [liveTerminal, setLiveTerminal] = useState<{ id: string; provider?: string; agentProfile?: string | null } | null>(null)
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  useEffect(() => {
    api.listProviders()
      .then(p => {
        setProviders(p)
        // Default to first installed provider
        const firstInstalled = p.find(prov => prov.installed)
        if (firstInstalled) setProvider(firstInstalled.name)
      })
      .catch(() => {})
  }, [])
  const [pendingClose, setPendingClose] = useState<TerminalMeta | null>(null)
  const [closingTerminal, setClosingTerminal] = useState<string | null>(null)
  const [sessionSearch, setSessionSearch] = useState('')
  const [inboxTerminalId, setInboxTerminalId] = useState<string | null>(null)
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [terminalWorkDirs, setTerminalWorkDirs] = useState<Record<string, string | null>>({})
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [addProvider, setAddProvider] = useState('kiro_cli')
  const [addProfile, setAddProfile] = useState('')
  const [addWorkDir, setAddWorkDir] = useState('')
  const [addingAgent, setAddingAgent] = useState(false)
  const [pendingExit, setPendingExit] = useState<TerminalMeta | null>(null)
  const [exitingTerminal, setExitingTerminal] = useState<string | null>(null)
  const [sendInputOpen, setSendInputOpen] = useState<Record<string, boolean>>({})
  const [sendInputValues, setSendInputValues] = useState<Record<string, string>>({})
  const [sendingInput, setSendingInput] = useState<string | null>(null)
  const { showSnackbar } = useStore()
  const [outputTerminalId, setOutputTerminalId] = useState<string | null>(null)
  const [showSpawnModal, setShowSpawnModal] = useState(false)
  const [sessionChat, setSessionChat] = useState<{ sessionName: string; terminalId: string } | null>(null)
  const [openingChat, setOpeningChat] = useState<string | null>(null)

  const openSessionChat = async (sessionName: string) => {
    setOpeningChat(sessionName)
    try {
      const detail = await api.getSession(sessionName)
      const orchestrator = detail.terminals[0]
      if (!orchestrator) throw new Error('오케스트레이터 터미널을 찾을 수 없습니다')
      setSessionChat({ sessionName, terminalId: orchestrator.id })
    } catch (error: any) {
      showSnackbar({ type: 'error', message: error?.message || '오케스트레이터 채팅을 열지 못했습니다' })
    } finally {
      setOpeningChat(null)
    }
  }

  const handleDeleteTerminal = async () => {
    if (!pendingClose) return
    const id = pendingClose.id
    setClosingTerminal(id)
    try {
      await api.deleteTerminal(id)
      if (liveTerminal?.id === id) setLiveTerminal(null)
      if (activeSession) await selectSession(activeSession)
      showSnackbar({ type: 'success', message: `터미널 ${id}을(를) 닫고 tmux 창을 종료했습니다` })
    } catch {
      showSnackbar({ type: 'error', message: `터미널 ${id}을(를) 닫지 못했습니다` })
    }
    setClosingTerminal(null)
    setPendingClose(null)
  }

  const handleExitTerminal = async () => {
    if (!pendingExit) return
    const id = pendingExit.id
    setExitingTerminal(id)
    try {
      await api.exitTerminal(id)
      if (activeSession) await selectSession(activeSession)
      showSnackbar({ type: 'success', message: `터미널 ${id}에 정상 종료 명령을 보냈습니다` })
    } catch {
      showSnackbar({ type: 'error', message: `터미널 ${id}에 종료 명령을 보내지 못했습니다` })
    }
    setExitingTerminal(null)
    setPendingExit(null)
  }

  const handleSendInput = async (terminalId: string) => {
    const message = (sendInputValues[terminalId] || '').trim()
    if (!message) return
    setSendingInput(terminalId)
    try {
      await api.sendInput(terminalId, message)
      setSendInputValues(prev => ({ ...prev, [terminalId]: '' }))
      showSnackbar({ type: 'success', message: `터미널 ${terminalId}에 메시지를 보냈습니다` })
    } catch {
      showSnackbar({ type: 'error', message: `터미널 ${terminalId}에 메시지를 보내지 못했습니다` })
    }
    setSendingInput(null)
  }

  useEffect(() => {
    api.listProfiles()
      .then(p => { setProfiles(p); setLoadingProfiles(false) })
      .catch(() => setLoadingProfiles(false))
  }, [])

  useEffect(() => {
    if (activeSession) {
      selectSession(activeSession)
      const interval = setInterval(() => selectSession(activeSession), 5000)
      return () => clearInterval(interval)
    }
  }, [activeSession])

  // Poll terminal statuses for visible terminals in the session detail
  useEffect(() => {
    if (!activeSessionDetail?.terminals.length) return
    const terminalIds = activeSessionDetail.terminals.map(t => t.id)
    const fetchStatuses = () => {
      terminalIds.forEach(id => {
        api.getTerminalStatus(id)
          .then(status => { if (status) setTerminalStatus(id, status) })
          .catch(() => {})
      })
    }
    fetchStatuses()
    const interval = setInterval(fetchStatuses, 3000)
    return () => clearInterval(interval)
  }, [activeSessionDetail?.terminals.map(t => t.id).join(',')])

  const handleCreate = async () => {
    if (creatingRef.current || !profile.trim()) return
    creatingRef.current = true
    setCreating(true)
    try {
      await createSession(provider, profile.trim(), workingDirectory.trim() || undefined, sessionName.trim() || undefined)
      setShowSpawnModal(false)
      setProfile('')
      setWorkingDirectory('')
      setSessionName('')
    } finally {
      setCreating(false)
      creatingRef.current = false
    }
  }

  const openTerminal = (terminalId: string, provider?: string, agentProfile?: string | null) => {
    setLiveTerminal({ id: terminalId, provider, agentProfile })
  }

  // Fetch working directories for terminals in session detail
  useEffect(() => {
    if (!activeSessionDetail?.terminals.length) return
    activeSessionDetail.terminals.forEach(t => {
      if (terminalWorkDirs[t.id] === undefined) {
        api.getWorkingDirectory(t.id)
          .then(res => setTerminalWorkDirs(prev => ({ ...prev, [t.id]: res.working_directory })))
          .catch(() => setTerminalWorkDirs(prev => ({ ...prev, [t.id]: null })))
      }
    })
  }, [activeSessionDetail?.terminals.map(t => t.id).join(',')])

  const handleAddAgent = async () => {
    if (!addProfile.trim() || !activeSession) return
    setAddingAgent(true)
    try {
      await api.addTerminalToSession(activeSession, addProvider, addProfile.trim(), addWorkDir.trim() || undefined)
      showSnackbar({ type: 'success', message: '세션에 에이전트를 추가했습니다' })
      setShowAddAgent(false)
      setAddProfile('')
      setAddWorkDir('')
      if (activeSession) await selectSession(activeSession)
    } catch (e: any) {
      showSnackbar({ type: 'error', message: e.message || '에이전트를 추가하지 못했습니다' })
    }
    setAddingAgent(false)
  }

  // Group profiles by source
  const profilesBySource = profiles.reduce<Record<string, AgentProfileInfo[]>>((acc, p) => {
    const key = p.source || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Sessions List */}
      <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">
            세션 ({sessions.length})
          </h3>
          <div className="flex items-center gap-2">
            {sessions.length > 3 && (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                <input
                  type="text"
                  value={sessionSearch}
                  onChange={e => setSessionSearch(e.target.value)}
                  placeholder="세션 검색..."
                  className="bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-xs rounded-lg pl-8 pr-3 py-1.5 w-48 focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}
            <button
              onClick={() => setShowSpawnModal(true)}
              className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              에이전트 실행
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-3)] mb-4">
          세션은 에이전트가 협업하는 작업 공간입니다. 여러 에이전트가 메시지로 통신할 수 있습니다. 세션을 누르면 소속 에이전트를 확인할 수 있습니다.
        </p>
        {sessions.length === 0 ? (
          <p className="text-[var(--text-3)] text-sm">활성 세션이 없습니다. 위에서 에이전트를 실행해 세션을 만드세요.</p>
        ) : (
          <div className="space-y-2">
            {sessions.filter(s => !sessionSearch || s.id.includes(sessionSearch) || s.name.includes(sessionSearch)).map(s => (
              <div
                key={s.id}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  activeSession === s.id ? 'bg-[var(--accent-soft)] border border-[var(--accent)]' : 'bg-[var(--surface)] border border-[var(--border-soft)] hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => selectSession(activeSession === s.id ? null : s.id)}
              >
                <div className="flex items-center gap-3">
                  <Bot size={16} className="text-[var(--accent-text)]" />
                  <span className="text-sm text-[var(--text)] font-mono">{s.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-3)] text-[var(--text-3)]'}`}>
                    {SESSION_STATUS_LABELS[s.status] || s.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); void openSessionChat(s.id) }}
                    disabled={openingChat === s.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--accent-text)] hover:text-[var(--on-accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent)] disabled:opacity-40 border border-[var(--accent)] rounded-lg transition-colors"
                    title={`${s.id} 오케스트레이터에게 프롬프트 보내기`}
                    aria-label={`${s.id} 오케스트레이터 채팅`}
                  >
                    {openingChat === s.id ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                    채팅
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteSession(s.id) }}
                    className="p-1.5 text-[var(--text-3)] hover:text-[var(--danger)] transition-colors rounded"
                    title="세션 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={14} className={`text-[var(--text-3)] transition-transform ${activeSession === s.id ? 'rotate-90' : ''}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session Detail */}
      {activeSessionDetail && (
        <div className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-2)] uppercase tracking-wide">
              {activeSession}의 터미널
            </h3>
            <button
              onClick={() => setShowAddAgent(!showAddAgent)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-3)] hover:text-[var(--accent-text)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border-soft)] hover:border-[var(--accent)] rounded-lg transition-colors"
              title="협업할 에이전트를 이 세션에 추가"
            >
              <Plus size={14} />
              에이전트 추가
            </button>
          </div>

          {/* Add Agent Inline Form */}
          {showAddAgent && (
            <div className="mb-4 p-4 bg-[var(--surface)] border border-[var(--border-soft)] rounded-lg space-y-3">
              <p className="text-xs text-[var(--text-3)]">
                이 세션에 에이전트를 추가합니다. 같은 세션의 에이전트는 서로 메시지를 보내고 작업을 조율할 수 있으며, 오케스트레이터가 추가된 에이전트에게 작업을 위임할 수 있습니다.
              </p>
              <div className="flex gap-3 items-end flex-wrap">
                <div className="min-w-[160px]">
                  <label className="block text-xs text-[var(--text-3)] mb-1">제공자</label>
                  <CustomSelect
                    value={addProvider}
                    onChange={setAddProvider}
                    placeholder="제공자 선택..."
                    options={(providers.length > 0 ? providers : FALLBACK_PROVIDERS.map(n => ({ name: n, binary: '', installed: true }))).map(p => ({
                      value: p.name,
                      label: providerLabel(p.name),
                      sublabel: !p.installed ? '설치되지 않음' : undefined,
                      disabled: !p.installed,
                    }))}
                  />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs text-[var(--text-3)] mb-1">에이전트 프로필</label>
                  {profiles.length > 0 ? (
                    <CustomSelect
                      value={addProfile}
                      onChange={setAddProfile}
                      placeholder="프로필 선택..."
                      options={profiles.filter(p => !isOrchestratorProfile(p.name)).map(p => ({
                        value: p.name,
                        label: profileLabel(p.name),
                        sublabel: profileDescription(p),
                        group: profileSectionLabel(p),
                      }))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={addProfile}
                      onChange={e => setAddProfile(e.target.value)}
                      placeholder="예: developer, reviewer"
                      className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                    />
                  )}
                </div>
                <button
                  onClick={handleAddAgent}
                  disabled={!addProfile.trim() || addingAgent}
                  className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus size={14} />
                  {addingAgent ? '추가 중…' : '추가'}
                </button>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">작업 디렉터리</label>
                <div className="relative">
                  <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                  <input
                    type="text"
                    value={addWorkDir}
                    onChange={e => setAddWorkDir(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddAgent()}
                    placeholder="/path/to/project (선택 사항)"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm font-mono rounded-lg pl-9 pr-3 py-2 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {activeSessionDetail.terminals.map(t => (
              <div key={t.id} className="bg-[var(--surface)] border border-[var(--border-soft)] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TermIcon size={14} className="text-[var(--text-3)]" />
                    <span className="text-sm font-mono text-[var(--text-2)]">{t.id}</span>
                    <StatusBadge status={terminalStatuses[t.id] || null} />
                    <span className="text-xs text-[var(--text-3)]">{t.provider}</span>
                    {t.agent_profile && <span className="text-xs text-[var(--accent-text)]">{profileLabel(t.agent_profile)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setInboxTerminalId(t.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] text-[var(--text)] text-xs font-medium rounded-lg transition-colors"
                      title="받은편지함 보기"
                    >
                      <Mail size={14} />
                      받은편지함
                    </button>
                    <button
                      onClick={() => openTerminal(t.id, t.provider, t.agent_profile)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--on-accent)] text-xs font-medium rounded-lg transition-colors"
                      title="실시간 터미널 열기"
                    >
                      <Monitor size={14} />
                      터미널 열기
                    </button>
                    <button
                      onClick={() => setOutputTerminalId(t.id)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-hover)] text-[var(--text)] text-xs font-medium rounded-lg transition-colors"
                      title="출력 보기"
                    >
                      <FileText size={14} />
                      출력
                    </button>
                    <button
                      onClick={() => setPendingExit(t as TerminalMeta)}
                      disabled={exitingTerminal === t.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[var(--warning)] hover:bg-[var(--warning)] disabled:opacity-40 text-[var(--on-accent)] text-xs font-medium rounded-lg transition-colors"
                      title="정상 종료"
                    >
                      <LogOut size={14} />
                      {exitingTerminal === t.id ? '종료 중…' : '정상 종료'}
                    </button>
                    <button
                      onClick={() => setPendingClose(t as TerminalMeta)}
                      disabled={closingTerminal === t.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[var(--danger)] hover:bg-[var(--danger)] disabled:opacity-40 text-[var(--on-accent)] text-xs font-medium rounded-lg transition-colors"
                      title="터미널 닫기"
                    >
                      <Trash2 size={14} />
                      {closingTerminal === t.id ? '닫는 중…' : '닫기'}
                    </button>
                  </div>
                </div>
                {/* Working Directory Display */}
                {terminalWorkDirs[t.id] && (
                  <div className="flex items-center gap-1.5" title={terminalWorkDirs[t.id]!}>
                    <FolderOpen size={12} className="text-[var(--text-3)] shrink-0" />
                    <span className="text-xs font-mono text-[var(--text-3)] truncate max-w-[400px]">{terminalWorkDirs[t.id]}</span>
                  </div>
                )}
                {/* Quick Send Input */}
                {!sendInputOpen[t.id] ? (
                  <button
                    onClick={() => setSendInputOpen(prev => ({ ...prev, [t.id]: true }))}
                    className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
                  >
                    에이전트에게 메시지...
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={sendInputValues[t.id] || ''}
                      onChange={e => setSendInputValues(prev => ({ ...prev, [t.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendInput(t.id) }}
                      placeholder="메시지를 입력하세요..."
                      className="flex-1 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm font-mono rounded-lg px-3 py-1.5 focus:border-[var(--accent)] focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSendInput(t.id)}
                      disabled={sendingInput === t.id || !(sendInputValues[t.id] || '').trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-xs font-medium rounded-lg transition-colors"
                    >
                      <Send size={12} />
                      {sendingInput === t.id ? '보내는 중…' : '보내기'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inbox Panel */}
      {inboxTerminalId && (
        <InboxPanel terminalId={inboxTerminalId} onClose={() => setInboxTerminalId(null)} />
      )}

      {/* Live Terminal */}
      {liveTerminal && (
        <TerminalView
          terminalId={liveTerminal.id}
          provider={liveTerminal.provider}
          agentProfile={liveTerminal.agentProfile}
          onClose={() => setLiveTerminal(null)}
        />
      )}

      {/* Output Viewer Modal */}
      {outputTerminalId && (
        <OutputViewer
          terminalId={outputTerminalId}
          onClose={() => setOutputTerminalId(null)}
        />
      )}

      {sessionChat && (
        <SessionChatPanel
          sessionName={sessionChat.sessionName}
          terminalId={sessionChat.terminalId}
          onClose={() => setSessionChat(null)}
        />
      )}

      {/* Close Confirmation Modal */}
      <ConfirmModal
        open={!!pendingClose}
        title="터미널 닫기"
        message="tmux 창을 닫고 에이전트 프로세스를 종료합니다. 이 작업은 되돌릴 수 없습니다."
        details={pendingClose ? [
          { label: '터미널 ID', value: pendingClose.id },
          { label: '제공자', value: pendingClose.provider },
          { label: '프로필', value: pendingClose.agent_profile ? profileLabel(pendingClose.agent_profile) : '없음' },
          { label: '세션', value: pendingClose.tmux_session },
        ] : []}
        confirmLabel="터미널 닫기"
        variant="danger"
        loading={!!closingTerminal}
        onConfirm={handleDeleteTerminal}
        onCancel={() => setPendingClose(null)}
      />

      {/* Graceful Exit Confirmation Modal */}
      <ConfirmModal
        open={!!pendingExit}
        title="정상 종료"
        message="제공자별 종료 명령(예: /exit)을 보냅니다. 에이전트가 정상적으로 종료됩니다."
        details={pendingExit ? [
          { label: '터미널 ID', value: pendingExit.id },
          { label: '제공자', value: pendingExit.provider },
          { label: '프로필', value: pendingExit.agent_profile ? profileLabel(pendingExit.agent_profile) : '없음' },
          { label: '세션', value: pendingExit.tmux_session },
        ] : []}
        confirmLabel="종료 명령 보내기"
        variant="warning"
        loading={!!exitingTerminal}
        onConfirm={handleExitTerminal}
        onCancel={() => setPendingExit(null)}
      />

      {/* Spawn Agent Modal */}
      {showSpawnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSpawnModal(false)} />
          <div className="relative bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-soft)]">
              <div>
                <h3 className="text-base font-semibold text-[var(--text)]">에이전트 실행</h3>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  새로운 AI 에이전트를 독립된 tmux 세션에서 실행합니다.
                </p>
              </div>
              <button
                onClick={() => setShowSpawnModal(false)}
                className="p-1.5 text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors rounded-lg hover:bg-[var(--surface-3)]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">제공자</label>
                <CustomSelect
                  value={provider}
                  onChange={setProvider}
                  placeholder="제공자 선택..."
                  options={(providers.length > 0 ? providers : FALLBACK_PROVIDERS.map(n => ({ name: n, binary: '', installed: true }))).map(p => ({
                    value: p.name,
                    label: providerLabel(p.name),
                    sublabel: !p.installed ? '설치되지 않음' : undefined,
                    disabled: !p.installed,
                  }))}
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">에이전트 프로필</label>
                {loadingProfiles ? (
                  <div className="bg-[var(--surface)] border border-[var(--border)] text-[var(--text-3)] text-sm rounded-lg px-3 py-2.5">프로필 불러오는 중…</div>
                ) : profiles.length > 0 ? (
                  <CustomSelect
                    value={profile}
                    onChange={setProfile}
                    placeholder="프로필 선택..."
                    options={profiles.map(p => ({
                      value: p.name,
                      label: profileLabel(p.name),
                      sublabel: profileDescription(p),
                      group: profileSectionLabel(p),
                    }))}
                  />
                ) : (
                  <input
                    type="text"
                    value={profile}
                    onChange={e => setProfile(e.target.value)}
                    placeholder="예: developer, reviewer"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg px-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">세션 이름 <span className="text-[var(--text-3)]">(선택 사항)</span></label>
                <div className="relative">
                  <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                  <input
                    type="text"
                    value={sessionName}
                    onChange={e => setSessionName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="my-session (비우면 cao-a1b2c3d4 같은 임의 ID 사용)"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm rounded-lg pl-9 pr-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">작업 디렉터리 <span className="text-[var(--text-3)]">(선택 사항)</span></label>
                <div className="relative">
                  <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
                  <input
                    type="text"
                    value={workingDirectory}
                    onChange={e => setWorkingDirectory(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="/path/to/project (기본값: 홈 디렉터리)"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm font-mono rounded-lg pl-9 pr-3 py-2.5 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Quick-pick profiles */}
              {profiles.length > 0 && (
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-2">빠른 선택</label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                    {profiles.slice(0, 12).map(p => (
                      <button
                        key={`${p.source}-${p.name}`}
                        onClick={() => setProfile(p.name)}
                        className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all ${
                          profile === p.name
                            ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-text)]'
                            : 'bg-[var(--surface)] border-[var(--border-soft)] hover:bg-[var(--surface-2)] text-[var(--text-2)]'
                        }`}
                      >
                        <span className="font-medium">{profileLabel(p.name)}</span>
                        <span className="text-[10px] text-[var(--text-3)] ml-1.5">{profileSectionLabel(p)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--border-soft)]">
              <button
                onClick={() => setShowSpawnModal(false)}
                className="px-4 py-2 text-sm text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={!profile.trim() || creating}
                className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <Play size={14} />
                {creating ? '실행 중…' : '에이전트 실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
