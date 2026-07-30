import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, MessageCircle, RefreshCw, Send, User, X } from 'lucide-react'
import { api } from '../api'
import { orchestrationReplyFingerprint, snapshotInputGenerations } from '../features/workspace/sessionCompletion'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

const TOOL_CALL_LINE = /^\s*•\s*Called\b/
const SEPARATOR_LINE = /^\s*─{20,}\s*$/m
const ACTIVE_PROGRESS_LINE = /^\s*•.*\((?:(?:\d+h\s+)?(?:\d+m\s+)?)\d+s\s*•\s*esc to interrupt\)\s*$/m
const WAITING_MESSAGE = '오케스트레이터 응답을 기다리는 중…'
const STORAGE_PREFIX = 'cao:session-chat:v2:'

function sanitizeResponseBlock(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^(?:❯|>)\s*$/.test(trimmed)) return false
      if (/^[✻✽✶✢✳·*]\s+.*\bfor\s+\d+(?:\.\d+)?s\b/.test(trimmed)) return false
      if (/^⎿\s*Stop says:/.test(trimmed)) return false
      if (/^(?:high|medium|low|max)\s*·\s*\/effort$/i.test(trimmed)) return false
      if (/^─+\s*Worked for\s+\d+/i.test(trimmed)) return false
      // 도구 결과 continuation ("  └ {...}") 및 단독 도구 metadata JSON 라인
      if (/^└/.test(trimmed)) return false
      if (/^\{.*"(?:terminal_id|sender_id|message_id|thread_id|agent_id|success)"\s*:.*\}$/.test(trimmed)) return false
      // 도구 호출 불릿
      if (/^•\s*Called\b/.test(trimmed)) return false
      // 단독 내부 마커 (대문자+숫자+밑줄로만 이뤄진 토큰 1~수개; 공백 외 다른 문자 없음)
      if (/^[A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]*)*$/.test(trimmed) && /_/.test(trimmed)) return false
      // 내부 상태 나레이션 (오케스트레이션 전용 문구)
      if (/(콜백.*(대기|기다|전달)|assign.*접수|완료(로| 처리).*(간주|하지 않)|워커.*(생성 여부|콜백)|응답을 회수)/.test(trimmed)) return false
      // 재할당/메시지 도착은 흔한 단어 — 불릿 나레이션 라인에서만 제거 (과다 제거 방지)
      if (/^[•\-*]/.test(trimmed) && /(재할당|메시지 도착)/.test(trimmed)) return false
      return true
    })
    .join('\n')
    .trim()
    .replace(/^•\s+/, '')
}

/** Reduce a provider transcript to the final user-facing assistant response. */
export function formatOrchestratorOutput(rawOutput: string): string {
  const clean = stripAnsi(rawOutput || '').replace(/\r/g, '').trim()
  if (!clean) return ''
  // Never promote a live Codex progress frame to a chat reply. Status polling
  // normally blocks this first, but this output-level guard also protects the
  // brief pane/status race around synchronous handoff tool completions.
  if (ACTIVE_PROGRESS_LINE.test(clean)) return ''

  // CAO places the final answer between full-width separators after tool calls.
  // Taking the last useful segment hides tool payloads and loaded skill bodies.
  if (SEPARATOR_LINE.test(clean)) {
    const segments = clean
      .split(/^\s*─{20,}\s*$/m)
      .map(sanitizeResponseBlock)
      .filter(Boolean)
    if (segments.length > 1) return segments[segments.length - 1]
  }

  const lines = clean.split('\n')
  let lastToolCall = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (TOOL_CALL_LINE.test(lines[index])) lastToolCall = index
  }

  if (lastToolCall >= 0) {
    const finalStart = lines.findIndex((line, index) => index > lastToolCall && /^•\s+(?!Called\b)/.test(line))
    if (finalStart >= 0) return sanitizeResponseBlock(lines.slice(finalStart).join('\n'))
    // 최종 답변이 불릿이 아닌 평범한 산문일 때: 전체를 버리지 않고 마지막 도구호출 이후를 정리해 보존 (과다 제거 방지).
    // 도구호출만 있고 실제 답변이 아직 없으면 정리 결과가 비어 '' 반환 → WAITING 유지.
    return sanitizeResponseBlock(lines.slice(lastToolCall + 1).join('\n'))
  }

  return sanitizeResponseBlock(clean)
}

type ChatRole = 'user' | 'assistant' | 'system'

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
}

interface StoredChat {
  messages: ChatMessage[]
  lastOutput: string
  pendingReply: PendingReply | null
}

interface PendingReply {
  messageId: string
  baseline: string
  baselineGenerations: Record<string, number>
  baselineInboxMessageId: number
}

interface SessionChatPanelProps {
  sessionName: string
  terminalId: string
  onClose: () => void
}

const STATUS_LABELS: Record<string, string> = {
  idle: '대기',
  processing: '작업 중',
  completed: '완료',
  waiting_user_answer: '입력 대기',
  error: '오류',
  unknown: '상태 확인 중',
}

let messageSequence = 0
function messageId(prefix: string): string {
  messageSequence += 1
  return `${prefix}-${messageSequence}`
}

function storageKey(sessionName: string): string {
  return `${STORAGE_PREFIX}${sessionName}`
}

function loadStoredChat(sessionName: string): StoredChat {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(sessionName)) || '{}')
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter((message: any) => (
        typeof message?.id === 'string'
        && ['user', 'assistant', 'system'].includes(message?.role)
        && typeof message?.content === 'string'
      )).map((message: ChatMessage) => (
        message.role === 'assistant'
          ? { ...message, content: formatOrchestratorOutput(message.content) }
          : message
      )).filter((message: ChatMessage) => message.content.length > 0).slice(-100)
      : []
    const pending = parsed.pendingReply
    const validGenerations = pending?.baselineGenerations
      && typeof pending.baselineGenerations === 'object'
      && !Array.isArray(pending.baselineGenerations)
      && Object.values(pending.baselineGenerations).every(value => (
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      ))
    const pendingReply = pending
      && typeof pending.messageId === 'string'
      && typeof pending.baseline === 'string'
      && validGenerations
      && typeof pending.baselineInboxMessageId === 'number'
      && Number.isFinite(pending.baselineInboxMessageId)
      && pending.baselineInboxMessageId >= 0
      ? pending as PendingReply
      : null
    return {
      messages,
      lastOutput: typeof parsed.lastOutput === 'string' ? parsed.lastOutput : '',
      pendingReply,
    }
  } catch {
    return { messages: [], lastOutput: '', pendingReply: null }
  }
}

function saveStoredChat(
  sessionName: string,
  messages: ChatMessage[],
  lastOutput: string,
  pendingReply: PendingReply | null,
) {
  try {
    const existing = JSON.parse(window.localStorage.getItem(storageKey(sessionName)) || '{}') as Record<string, unknown>
    window.localStorage.setItem(storageKey(sessionName), JSON.stringify({
      ...existing,
      messages: messages.slice(-100),
      lastOutput,
      pendingReply,
    }))
  } catch {
    // Chat remains usable when storage is disabled or full.
  }
}

export function SessionChatPanel({ sessionName, terminalId, onClose }: SessionChatPanelProps) {
  const initialChat = useRef<StoredChat | null>(null)
  if (initialChat.current === null) initialChat.current = loadStoredChat(sessionName)

  const [messages, setMessages] = useState<ChatMessage[]>(initialChat.current.messages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(Boolean(initialChat.current.pendingReply))
  const [status, setStatus] = useState<string | null>(null)
  const [lastOutput, setLastOutput] = useState(initialChat.current.lastOutput)
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(initialChat.current.pendingReply)
  const scrollRef = useRef<HTMLDivElement>(null)

  const replaceMessage = (id: string, content: string) => {
    setMessages(current => current.map(message => message.id === id ? { ...message, content } : message))
  }

  const loadRecentOutput = async (appendIfNew = false) => {
    setLoading(true)
    try {
      const [outputResult, terminalStatus] = await Promise.all([
        api.getTerminalOutput(terminalId, 'last'),
        api.getTerminalStatus(terminalId),
      ])
      const clean = formatOrchestratorOutput(outputResult.output || '')
      setStatus(terminalStatus)
      if (clean && !pendingReply) {
        setMessages(current => {
          const pendingIndex = current.findIndex(message => (
            message.role === 'assistant' && message.content === WAITING_MESSAGE
          ))
          if (pendingIndex >= 0 && clean !== lastOutput) {
            return current.map((message, index) => index === pendingIndex ? { ...message, content: clean } : message)
          }
          const alreadyPresent = current.some(message => message.role === 'assistant' && message.content === clean)
          if (current.length === 0 || (appendIfNew && !alreadyPresent)) {
            return [...current, { id: messageId('recent'), role: 'assistant', content: clean }]
          }
          return current
        })
        setLastOutput(clean)
      }
    } catch {
      setMessages(current => current.length > 0 ? current : [
        { id: messageId('error'), role: 'system', content: '최근 오케스트레이터 출력을 불러오지 못했습니다.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecentOutput()
  }, [terminalId])

  useEffect(() => {
    saveStoredChat(sessionName, messages, lastOutput, pendingReply)
  }, [sessionName, messages, lastOutput, pendingReply])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!pendingReply) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const [sessionBefore, inboxBefore] = await Promise.all([
          api.getSession(sessionName),
          api.getInboxMessages(terminalId, 100, undefined, pendingReply.baselineInboxMessageId),
        ])
        if (cancelled) return

        const beforeFingerprint = orchestrationReplyFingerprint(
          sessionBefore.terminals,
          terminalId,
          pendingReply.baselineGenerations,
          inboxBefore,
          pendingReply.baselineInboxMessageId,
        )
        if (!beforeFingerprint) throw new Error('Orchestration is still running')

        const outputResult = await api.getTerminalOutput(terminalId, 'last')
        const [sessionAfter, inboxAfter] = await Promise.all([
          api.getSession(sessionName),
          api.getInboxMessages(terminalId, 100, undefined, pendingReply.baselineInboxMessageId),
        ])
        if (cancelled) return
        const afterFingerprint = orchestrationReplyFingerprint(
          sessionAfter.terminals,
          terminalId,
          pendingReply.baselineGenerations,
          inboxAfter,
          pendingReply.baselineInboxMessageId,
        )
        if (beforeFingerprint !== afterFingerprint) throw new Error('Orchestration state changed during output read')

        const clean = formatOrchestratorOutput(outputResult.output || '')
        const terminalStatus = sessionAfter.terminals.find(item => item.id === terminalId)?.status ?? null
        setStatus(terminalStatus)

        if (clean && clean !== pendingReply.baseline) {
          replaceMessage(pendingReply.messageId, clean)
          setLastOutput(clean)
          setPendingReply(null)
          setSending(false)
          return
        }
      } catch {
        // A temporary polling failure should not discard a successfully sent prompt.
      }

      if (!cancelled) timer = setTimeout(poll, 2000)
    }

    void poll()
    timeoutTimer = setTimeout(() => {
      if (cancelled) return
      replaceMessage(pendingReply.messageId, '응답이 계속 처리 중입니다. 잠시 후 새로고침해 확인하세요.')
      setPendingReply(null)
      setSending(false)
    }, 180000)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }, [pendingReply, sessionName, terminalId])

  const handleSend = async () => {
    const prompt = input.trim()
    if (!prompt || sending) return

    const replyId = messageId('assistant')
    setMessages(current => [
      ...current,
      { id: messageId('user'), role: 'user', content: prompt },
      { id: replyId, role: 'assistant', content: WAITING_MESSAGE },
    ])
    setInput('')
    setSending(true)

    try {
      const [sessionDetail, inboxMessages] = await Promise.all([
        api.getSession(sessionName),
        api.getInboxMessages(terminalId, 1, undefined, undefined, true),
      ])
      const baselineGenerations = snapshotInputGenerations(sessionDetail.terminals)
      const baselineInboxMessageId = Math.max(0, ...inboxMessages.map(message => message.id))
      const nextPendingReply: PendingReply = {
        messageId: replyId,
        baseline: lastOutput,
        baselineGenerations,
        baselineInboxMessageId,
      }
      setPendingReply(nextPendingReply)
      await api.sendInput(terminalId, prompt)
    } catch (error: any) {
      replaceMessage(replyId, error?.detail || error?.message || '프롬프트를 보내지 못했습니다.')
      setPendingReply(null)
      setSending(false)
    }
  }

  const statusKey = status?.toLowerCase() || 'unknown'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`${sessionName} 오케스트레이터 채팅`}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--surface)] border border-[var(--border-soft)] rounded-2xl shadow-2xl w-full max-w-3xl mx-4 h-[78vh] max-h-[760px] min-h-[520px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)] flex items-center justify-center shrink-0">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text)] truncate">{sessionName} 오케스트레이터 채팅</h3>
              <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                <span className="font-mono truncate">{terminalId}</span>
                <span>·</span>
                <span className={statusKey === 'error' ? 'text-[var(--danger)]' : statusKey === 'processing' ? 'text-[var(--warning)]' : 'text-[var(--accent-text)]'}>
                  {STATUS_LABELS[statusKey] || status || '상태 확인 중'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadRecentOutput(true)}
              disabled={loading || sending}
              className="p-2 text-[var(--text-3)] hover:text-[var(--text)] disabled:opacity-30 transition-colors rounded-lg hover:bg-[var(--surface-2)]"
              title="최근 응답 새로고침"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-2 text-[var(--text-3)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-2)]" title="닫기">
              <X size={17} />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-[var(--bg)]">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[var(--text-3)]" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <Bot size={34} className="text-[var(--text-3)] mb-3" />
              <p className="text-[var(--text-3)] text-sm">오케스트레이터에게 첫 작업을 요청해 보세요.</p>
              <p className="text-[var(--text-3)] text-xs mt-1">역할 배분과 검토 순서는 세션 운영 규칙에 따라 자동으로 처리됩니다.</p>
            </div>
          ) : messages.map(message => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role !== 'user' && (
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${message.role === 'system' ? 'bg-[var(--danger-bg)] text-[var(--danger)]' : 'bg-[var(--accent-soft)] text-[var(--accent-text)]'}`}>
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                message.role === 'user'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] rounded-br-md'
                  : message.role === 'system'
                    ? 'bg-[var(--danger-bg)] border border-[var(--danger)] text-[var(--danger)] rounded-bl-md'
                    : 'bg-[var(--surface-2)] border border-[var(--border-soft)] text-[var(--text)] rounded-bl-md font-mono'
              }`}>
                {message.content}
              </div>
              {message.role === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-[var(--info-bg)] text-[var(--info)] flex items-center justify-center shrink-0">
                  <User size={14} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--border-soft)] p-4 bg-[var(--surface)] shrink-0">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              disabled={sending}
              rows={3}
              placeholder="오케스트레이터에게 작업을 요청하세요. Shift+Enter로 줄바꿈"
              aria-label="오케스트레이터 프롬프트"
              className="flex-1 resize-none bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-sm rounded-xl px-4 py-3 focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              className="h-11 px-4 flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-40 text-[var(--on-accent)] text-sm font-medium rounded-xl transition-colors"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {sending ? '응답 대기 중' : '보내기'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-3)] mt-2">Enter로 전송 · Shift+Enter로 줄바꿈 · 대화 기록은 이 브라우저에 세션별로 저장됩니다.</p>
        </div>
      </div>
    </div>
  )
}
