import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, Loader2, Send, WifiOff } from 'lucide-react'
import type { UiConnectionStatus } from './eventsClient'
import { AgentAvatar } from './AgentAvatar'
import { STORAGE_KEYS } from './constants'
import { apiUi, type SlashCommandInfo } from '../../api.ui'
import { filterSlashCommands, isSlashCommandProvider } from './slashCommands'

export interface ComposerTarget {
  id: string
  label: string
  provider?: string | null
}

interface ComposerProps {
  sessionName: string
  target: ComposerTarget | null
  targets: ComposerTarget[]
  onChangeTarget: (id: string) => void
  onSend: (text: string) => void
  sending: boolean
  /** Phase 5: tri-state so `connecting` (client already retrying) reads differently from a dead stream. */
  streamStatus: UiConnectionStatus
  /**
   * Phase 2e (spec §2e) slash-command source: the chat target's (the
   * terminal the message is addressed to) provider, and the session's
   * (supervisor's) working directory. Either missing, or a provider the
   * backend can't enumerate, silently disables the dropdown (spec: "기능
   * 자체를 숨김") — never an error toast.
   */
  slashProvider?: string | null
  slashCwd?: string | null
}

const SCOPE_LABEL: Record<string, string> = { builtin: '내장', user: '사용자', project: '프로젝트' }

function historyKey(sessionName: string): string {
  return `${STORAGE_KEYS.composerHistory}${sessionName}`
}

function loadHistory(sessionName: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(historyKey(sessionName)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function pushHistory(sessionName: string, text: string) {
  try {
    const current = loadHistory(sessionName)
    const next = [text, ...current.filter(t => t !== text)].slice(0, 50)
    window.localStorage.setItem(historyKey(sessionName), JSON.stringify(next))
  } catch {
    // History is a convenience — losing it silently is fine.
  }
}

export function Composer({
  sessionName,
  target,
  targets,
  onChangeTarget,
  onSend,
  sending,
  streamStatus,
  slashProvider = null,
  slashCwd = null,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const popoverRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Phase 2e: slash-command autocomplete state ──────────────────────────
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([])
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)

  const slashSupported = isSlashCommandProvider(slashProvider)
  // Dropdown mode only ever activates for a message that IS a slash command
  // (the whole box starts with '/'), never one that merely contains one —
  // matches the spec's own gate: "입력값이 /로 시작하면".
  const slashOpen = slashSupported && text.startsWith('/') && !slashDismissed
  const slashQuery = text.slice(1)
  const filteredSlash = useMemo(
    () => (slashOpen ? filterSlashCommands(slashCommands, slashQuery) : []),
    [slashOpen, slashCommands, slashQuery],
  )

  useEffect(() => {
    historyRef.current = loadHistory(sessionName)
    historyIndexRef.current = -1
  }, [sessionName])

  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  // Load the command list once per (provider, cwd) whenever the dropdown
  // becomes eligible to open — never per keystroke (spec: "타이핑마다 fetch
  // 금지"). Filtering while typing happens purely client-side against this
  // already-fetched list (see `filteredSlash` above); api.ui.ts's own 30s
  // cache additionally absorbs a close/reopen within that window.
  useEffect(() => {
    // Re-check the provider guard here (not just via the outer `slashSupported`
    // boolean) so TypeScript narrows `slashProvider` to `SlashCommandProvider`
    // for the call below, and — just as importantly — so this effect truly
    // only fires while the dropdown is actually open, never eagerly on mount.
    if (!slashOpen || !isSlashCommandProvider(slashProvider)) return
    let cancelled = false
    apiUi
      .getSlashCommands(slashProvider, slashCwd ?? undefined)
      .then(res => {
        if (!cancelled) setSlashCommands(res.commands)
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [slashOpen, slashProvider, slashCwd])

  // Re-anchor the highlighted row to the top whenever the visible list
  // changes (a new query, or the fetched list itself arriving) — otherwise a
  // numeric index left over from a longer list could silently point at an
  // unrelated row.
  useEffect(() => {
    setHighlightIndex(0)
  }, [slashQuery, slashCommands])

  const submit = () => {
    const value = text.trim()
    if (!value || sending) return
    pushHistory(sessionName, value)
    historyRef.current = [value, ...historyRef.current.filter(t => t !== value)].slice(0, 50)
    historyIndexRef.current = -1
    onSend(value)
    setText('')
  }

  const selectSlashCommand = (cmd: SlashCommandInfo) => {
    setText(`${cmd.name} `)
    setSlashDismissed(true)
    textareaRef.current?.focus()
  }

  const handleTextChange = (value: string) => {
    setText(value)
    // Any real edit re-opens the dropdown fresh even after an Escape dismissal.
    setSlashDismissed(false)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex(i => Math.min(i + 1, Math.max(0, filteredSlash.length - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
      // Enter/Tab are consumed as "select" only while there's something to
      // select — Cmd/Ctrl+Enter is deliberately excluded so it keeps its
      // existing unconditional "send now" meaning even mid-slash-typing, and
      // a query with zero matches falls through unchanged below instead of
      // silently swallowing the key.
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) {
        const chosen = filteredSlash[highlightIndex]
        if (chosen) {
          e.preventDefault()
          selectSlashCommand(chosen)
          return
        }
      }
    }

    // ── Existing behavior below, untouched — only reached when the dropdown
    // is closed (or open with no key match above), so Cmd/Ctrl+Enter send and
    // history recall keep working exactly as before (no regression). ──
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    // A plain Enter sends; Shift+Enter is the newline — which is what the
    // placeholder has always advertised while only ⌘/Ctrl+Enter actually sent.
    //
    // The IME guard is not optional here: this UI is Korean-first, and Enter is
    // the key that commits an in-flight Hangul composition. Sending on that
    // keystroke would fire off a half-typed sentence almost every time. Some
    // IMEs report the commit with `isComposing`, others only as keyCode 229, so
    // both are checked.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
      if (native.isComposing || native.keyCode === 229) return
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'ArrowUp' && text.length === 0 && historyRef.current.length > 0) {
      e.preventDefault()
      historyIndexRef.current = Math.min(historyIndexRef.current + 1, historyRef.current.length - 1)
      setText(historyRef.current[historyIndexRef.current] ?? '')
      return
    }
    if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
      e.preventDefault()
      historyIndexRef.current -= 1
      setText(historyIndexRef.current >= 0 ? historyRef.current[historyIndexRef.current] : '')
    }
  }

  return (
    <div className="shrink-0 px-5 pb-4 pt-2.5">
      <div className="relative mx-auto max-w-[780px]">
        {slashOpen && (
          <div
            role="listbox"
            aria-label="슬래시 명령"
            className="absolute bottom-full left-0 right-0 z-20 mb-1.5 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
          >
            {filteredSlash.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-[var(--text-3)]">일치하는 명령이 없어요</p>
            ) : (
              filteredSlash.map((cmd, i) => (
                <button
                  key={`${cmd.scope}-${cmd.name}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlightIndex}
                  // Prevents the textarea from ever blurring on this click, so
                  // the click's onClick still fires normally instead of racing
                  // the dropdown's own onBlur-close handler.
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onClick={() => selectSlashCommand(cmd)}
                  className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left ${
                    i === highlightIndex ? 'bg-[var(--surface-2)]' : ''
                  }`}
                >
                  <span className="shrink-0 font-mono text-[12px] font-semibold text-[var(--text)]">{cmd.name}</span>
                  <span className="shrink-0 rounded bg-[var(--surface-3)] px-1 py-0.5 text-[9.5px] font-bold text-[var(--text-2)]">
                    {SCOPE_LABEL[cmd.scope] ?? cmd.scope}
                  </span>
                  {cmd.kind === 'skill' && (
                    <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1 py-0.5 text-[9.5px] font-bold text-[var(--accent-text)]">스킬</span>
                  )}
                  {cmd.interactive && (
                    <span className="shrink-0 rounded bg-[var(--warning-bg)] px-1 py-0.5 text-[9.5px] font-bold text-[var(--warning)]">터미널 대화형</span>
                  )}
                  {cmd.description && <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--text-3)]">{cmd.description}</span>}
                </button>
              ))
            )}
          </div>
        )}

        <div className="rounded-2xl border-[1.5px] border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm focus-within:border-[var(--accent)]">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-3)]">받는 대상</span>
            <div className="relative" ref={popoverRef}>
              <button
                type="button"
                onClick={() => setPopoverOpen(v => !v)}
                className="flex h-6 items-center gap-1.5 rounded-full bg-[var(--surface-2)] py-0 pl-1 pr-2 text-[11.5px] font-semibold text-[var(--text-2)]"
                aria-haspopup="listbox"
                aria-expanded={popoverOpen}
              >
                {target && <AgentAvatar name={target.label} size="sm" />}
                {target?.label ?? '대상 없음'}
                <ChevronDown size={12} />
              </button>
              {popoverOpen && (
                <div role="listbox" className="absolute bottom-full left-0 z-10 mb-1.5 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                  {targets.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={t.id === target?.id}
                      onClick={() => {
                        onChangeTarget(t.id)
                        setPopoverOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--surface-2)] ${
                        t.id === target?.id ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'
                      }`}
                    >
                      <AgentAvatar name={t.label} size="sm" />
                      <span className="truncate">{t.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (slashOpen) setSlashDismissed(true)
            }}
            rows={2}
            placeholder="오케스트레이터에게 작업을 요청하세요 · Shift+Enter 줄바꿈"
            aria-label="메시지 입력"
            className="max-h-40 min-h-[44px] w-full resize-none border-none bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
          />

          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10.5px] text-[var(--text-3)]">↑ 입력 이력 · ⏎ 전송 · Shift+⏎ 줄바꿈</span>
            {streamStatus === 'connecting' && (
              <span className="flex items-center gap-1 text-[10.5px] text-[var(--info)]">
                <Loader2 size={11} className="animate-spin" />
                이벤트 스트림 재연결 중 — 전송은 계속 가능해요
              </span>
            )}
            {streamStatus === 'disconnected' && (
              <span className="flex items-center gap-1 text-[10.5px] text-[var(--warning)]">
                <WifiOff size={11} />
                이벤트 스트림 끊김 — 전송은 계속 가능해요
              </span>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || sending}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-xs font-bold text-[var(--on-accent)] disabled:opacity-40"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {sending ? '전송 중' : '보내기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
