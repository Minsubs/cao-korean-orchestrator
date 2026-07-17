import { useState, useEffect, useRef } from 'react'
import { api, InboxMessage } from '../api'
import { X, Send, Mail, Loader2 } from 'lucide-react'

interface InboxPanelProps {
  terminalId: string
  onClose: () => void
  /** Render inline (no fixed overlay/backdrop) for the Workbench dock. Default false preserves the classic modal exactly. */
  embedded?: boolean
}

type StatusFilter = 'all' | 'pending' | 'delivered' | 'failed'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '대기 중' },
  { key: 'delivered', label: '전달됨' },
  { key: 'failed', label: '실패' },
]

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 0) return '방금'
  if (diffSec < 60) return `${diffSec}초 전`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}시간 전`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}일 전`
}

function MessageStatusBadge({ status }: { status: InboxMessage['status'] }) {
  const config = {
    delivered: { bg: 'bg-emerald-400/10', text: 'text-emerald-400', label: '전달됨' },
    pending: { bg: 'bg-amber-400/10', text: 'text-amber-400', label: '대기 중' },
    failed: { bg: 'bg-red-400/10', text: 'text-red-400', label: '실패' },
  }
  const c = config[status] || config.pending
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

export function InboxPanel({ terminalId, onClose, embedded = false }: InboxPanelProps) {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchMessages = async () => {
    try {
      const status = filter === 'all' ? undefined : filter
      const data = await api.getInboxMessages(terminalId, 50, status)
      setMessages(data)
    } catch {
      // silently fail — will retry
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchMessages()
    const interval = setInterval(fetchMessages, 5000)
    return () => clearInterval(interval)
  }, [terminalId, filter])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = async () => {
    const text = sendText.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await api.sendInboxMessage(terminalId, 'ui', text)
      setSendText('')
      await fetchMessages()
    } catch {
      // send failed — user can retry
    }
    setSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isReceiver = (msg: InboxMessage) => msg.receiver_id === terminalId

  const filterTabs = (
    <div className={`shrink-0 overflow-x-auto border-b border-gray-700/30 ${embedded ? 'px-3 py-2' : 'px-5 py-3'}`}>
      <div className="flex gap-2">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )

  const messageList = (
    <div className={`flex-1 overflow-y-auto space-y-3 min-h-[200px] ${embedded ? 'px-3 py-3' : 'px-5 py-4'}`}>
      {loading && messages.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-gray-500" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Mail size={32} className="mb-3 opacity-40" />
          <p className="text-sm">아직 메시지가 없습니다</p>
          <p className="text-xs text-gray-600 mt-1">에이전트가 handoff, assign 또는 send_message로 통신하면 여기에 표시됩니다. 아래에서 직접 메시지를 보낼 수도 있습니다.</p>
        </div>
      ) : (
        messages.map(msg => {
          const incoming = isReceiver(msg)
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${incoming ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                  incoming
                    ? 'bg-gray-800 border border-gray-700/40'
                    : 'bg-emerald-900/30 border border-emerald-700/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-gray-500">
                    {incoming ? msg.sender_id.slice(0, 8) : msg.receiver_id.slice(0, 8)}
                  </span>
                  <MessageStatusBadge status={msg.status} />
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{msg.message}</p>
                {msg.created_at && (
                  <p className="text-[10px] text-gray-600 mt-1">{formatRelativeTime(msg.created_at)}</p>
                )}
              </div>
            </div>
          )
        })
      )}
      <div ref={messagesEndRef} />
    </div>
  )

  const sendForm = (
    <div className={`shrink-0 border-t border-gray-700/50 ${embedded ? 'px-3 py-3' : 'px-5 py-4'}`}>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={sendText}
          onChange={e => setSendText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요..."
          className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:border-emerald-500 focus:outline-none placeholder-gray-600"
        />
        <button
          onClick={handleSend}
          disabled={!sendText.trim() || sending}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          {sending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          보내기
        </button>
      </div>
    </div>
  )

  // Embedded (Workbench dock): no backdrop/modal card/header — the
  // Workbench's own tab bar/context row already identifies this terminal.
  if (embedded) {
    return (
      <div className="flex h-full w-full flex-col bg-gray-900">
        {filterTabs}
        {messageList}
        {sendForm}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700/50 rounded-2xl shadow-2xl w-full max-w-[600px] mx-4 flex flex-col" style={{ maxHeight: 'calc(100vh - 80px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/50 flex items-center justify-center">
              <Mail size={16} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">에이전트 받은편지함</h3>
              <p className="text-[11px] text-gray-500">이 세션의 에이전트 간 메시지 <span className="font-mono">({terminalId})</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
            title="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {filterTabs}
        {messageList}
        {sendForm}
      </div>
    </div>
  )
}
