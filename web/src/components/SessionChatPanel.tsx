import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, MessageCircle, RefreshCw, Send, User, X } from 'lucide-react'
import { api } from '../api'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

const TOOL_CALL_LINE = /^\s*•\s*Called\b/
const SEPARATOR_LINE = /^\s*─{20,}\s*$/m
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
    // While the turn is still inside a tool trace there is no chat response yet.
    const finalStart = lines.findIndex((line, index) => (
      index > lastToolCall && /^•\s+(?!Called\b)/.test(line)
    ))
    if (finalStart < 0) return ''
    return sanitizeResponseBlock(lines.slice(finalStart).join('\n'))
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
}

interface PendingReply {
  messageId: string
  baseline: string
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
    return {
      messages,
      lastOutput: typeof parsed.lastOutput === 'string' ? parsed.lastOutput : '',
    }
  } catch {
    return { messages: [], lastOutput: '' }
  }
}

function saveStoredChat(sessionName: string, messages: ChatMessage[], lastOutput: string) {
  try {
    window.localStorage.setItem(storageKey(sessionName), JSON.stringify({
      messages: messages.slice(-100),
      lastOutput,
    }))
  } catch {
    // Chat remains usable when storage is disabled or full.
  }
}

export function SessionChatPanel({ sessionName, terminalId, onClose }: SessionChatPanelProps) {
  const initialChat = useRef<StoredChat | null>(null)
  if (initialChat.current === null) initialChat.current = loadStoredChat(sessionName)
  const initialPendingMessage = [...initialChat.current.messages].reverse().find(message => (
    message.role === 'assistant' && message.content === WAITING_MESSAGE
  ))

  const [messages, setMessages] = useState<ChatMessage[]>(initialChat.current.messages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(Boolean(initialPendingMessage))
  const [status, setStatus] = useState<string | null>(null)
  const [lastOutput, setLastOutput] = useState(initialChat.current.lastOutput)
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(initialPendingMessage ? {
    messageId: initialPendingMessage.id,
    baseline: initialChat.current.lastOutput,
  } : null)
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
      if (clean) {
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
        if (pendingReply && clean !== pendingReply.baseline) {
          setPendingReply(null)
          setSending(false)
        }
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
    saveStoredChat(sessionName, messages, lastOutput)
  }, [sessionName, messages, lastOutput])

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
    let lastSeen = pendingReply.baseline
    let stableReads = 0

    const poll = async () => {
      try {
        const [outputResult, terminalStatus] = await Promise.all([
          api.getTerminalOutput(terminalId, 'last'),
          api.getTerminalStatus(terminalId),
        ])
        if (cancelled) return

        const clean = formatOrchestratorOutput(outputResult.output || '')
        const normalizedStatus = terminalStatus?.toLowerCase() || 'unknown'
        setStatus(terminalStatus)

        if (clean && clean !== pendingReply.baseline) {
          replaceMessage(pendingReply.messageId, clean)
          setLastOutput(clean)
          if (clean === lastSeen) stableReads += 1
          else {
            lastSeen = clean
            stableReads = 0
          }
        }

        const settled = ['completed', 'idle', 'waiting_user_answer', 'error'].includes(normalizedStatus)
        const hasReply = clean.length > 0 && clean !== pendingReply.baseline
        if (hasReply && (settled || stableReads >= 2)) {
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
  }, [pendingReply, terminalId])

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
      await api.sendInput(terminalId, prompt)
      setPendingReply({ messageId: replyId, baseline: lastOutput })
    } catch (error: any) {
      replaceMessage(replyId, error?.detail || error?.message || '프롬프트를 보내지 못했습니다.')
      setSending(false)
    }
  }

  const statusKey = status?.toLowerCase() || 'unknown'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`${sessionName} 오케스트레이터 채팅`}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 h-[78vh] max-h-[760px] min-h-[520px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/40 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center shrink-0">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">{sessionName} 오케스트레이터 채팅</h3>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="font-mono truncate">{terminalId}</span>
                <span>·</span>
                <span className={statusKey === 'error' ? 'text-red-400' : statusKey === 'processing' ? 'text-amber-400' : 'text-emerald-400'}>
                  {STATUS_LABELS[statusKey] || status || '상태 확인 중'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadRecentOutput(true)}
              disabled={loading || sending}
              className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors rounded-lg hover:bg-gray-800"
              title="최근 응답 새로고침"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-gray-800" title="닫기">
              <X size={17} />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-gray-950/40">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-gray-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <Bot size={34} className="text-gray-700 mb-3" />
              <p className="text-gray-400 text-sm">오케스트레이터에게 첫 작업을 요청해 보세요.</p>
              <p className="text-gray-600 text-xs mt-1">역할 배분과 검토 순서는 세션 운영 규칙에 따라 자동으로 처리됩니다.</p>
            </div>
          ) : messages.map(message => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role !== 'user' && (
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${message.role === 'system' ? 'bg-red-900/40 text-red-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                message.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-md'
                  : message.role === 'system'
                    ? 'bg-red-950/50 border border-red-900/50 text-red-300 rounded-bl-md'
                    : 'bg-gray-800 border border-gray-700/50 text-gray-200 rounded-bl-md font-mono'
              }`}>
                {message.content}
              </div>
              {message.role === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-blue-900/40 text-blue-400 flex items-center justify-center shrink-0">
                  <User size={14} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-gray-700/40 p-4 bg-gray-900 shrink-0">
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
              className="flex-1 resize-none bg-gray-950 border border-gray-700 text-gray-200 text-sm rounded-xl px-4 py-3 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              className="h-11 px-4 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {sending ? '응답 대기 중' : '보내기'}
            </button>
          </div>
          <p className="text-[11px] text-gray-600 mt-2">Enter로 전송 · Shift+Enter로 줄바꿈 · 대화 기록은 이 브라우저에 세션별로 저장됩니다.</p>
        </div>
      </div>
    </div>
  )
}
