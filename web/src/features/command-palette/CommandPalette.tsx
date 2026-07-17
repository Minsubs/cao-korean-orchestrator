import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../../store'
import { resolveTheme, setTheme } from '../../theme'
import { STATIC_COMMANDS, type NavigateView, type PaletteAction } from './commands'

export interface CommandPaletteProps {
  /** Set true to request opening (e.g. the topbar ⌘K button). The component also self-registers the ⌘K/Ctrl+K hotkey — `open` is one-directional (can only ask it to open); closing always goes through `onClose`. */
  open: boolean
  onClose: () => void
  onNavigate: (view: NavigateView) => void
  onCommand: (id: string, arg?: string) => void
}

interface RenderItem {
  key: string
  group: string
  label: string
  icon: LucideIcon
  run: () => void
}

/**
 * ⌘K/Ctrl+K Command Palette (Phase 5c). Fully self-contained: registers its
 * own global hotkey listener rather than relying on AppShell to forward one
 * (per the phase spec — "전역 키 훅은 컴포넌트가 자체 등록"). `open`/`onClose`
 * still let a caller (e.g. a topbar button) request it open/observe it
 * closing; AppShell wiring itself happens at integration, not here.
 */
export function CommandPalette({ open, onClose, onNavigate, onCommand }: CommandPaletteProps) {
  const sessions = useStore(s => s.sessions)
  const [visible, setVisible] = useState(open)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // `open` can only ask the palette to open — closing always flows back out
  // through onClose so a parent that never resets `open` to false doesn't
  // trap the palette open forever.
  useEffect(() => {
    if (open) setVisible(true)
  }, [open])

  useEffect(() => {
    if (visible) {
      setQuery('')
      setHighlight(0)
      const t = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(t)
    }
  }, [visible])

  function runAction(action: PaletteAction) {
    if (action.kind === 'navigate') {
      onNavigate(action.view)
    } else if (action.kind === 'command') {
      // "새 작업 시작" resolved per phase spec: hand off via onCommand('new-task');
      // also nudge navigation to the Workspace rail so the integrator's default
      // AppShell wiring lands somewhere sensible even with a minimal onCommand.
      if (action.id === 'new-task') onNavigate('workspace')
      onCommand(action.id)
    } else {
      const current = resolveTheme()
      setTheme(current === 'dark' ? 'light' : 'dark')
    }
  }

  const items: RenderItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const staticItems: RenderItem[] = STATIC_COMMANDS.filter(c => c.label.toLowerCase().includes(q)).map((c, i) => ({
      key: `static-${i}`,
      group: c.group,
      label: c.label,
      icon: c.icon,
      run: () => runAction(c.action),
    }))
    // Session search: only surfaces once the person actually types something,
    // so opening the palette doesn't dump the whole session list every time.
    const sessionItems: RenderItem[] =
      q.length > 0
        ? sessions
            .filter(s => s.name.toLowerCase().includes(q))
            .slice(0, 8)
            .map(s => ({
              key: `session-${s.id}`,
              group: '세션',
              label: s.name,
              icon: Terminal,
              run: () => onCommand('open-session', s.name),
            }))
        : []
    return [...staticItems, ...sessionItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sessions])

  useEffect(() => {
    setHighlight(h => Math.min(h, Math.max(items.length - 1, 0)))
  }, [items.length])

  function closePalette() {
    setVisible(false)
    onClose()
  }

  function runItem(item: RenderItem) {
    item.run()
    closePalette()
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isHotkey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isHotkey) {
        e.preventDefault()
        setVisible(v => !v)
        return
      }
      if (!visible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closePalette()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => Math.min(h + 1, Math.max(items.length - 1, 0)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[highlight]) runItem(items[highlight])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, items, highlight])

  if (!visible) return null

  let lastGroup = ''

  return (
    <>
      <div className="fixed inset-0 z-[59] bg-black/40" onClick={closePalette} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        className="fixed left-1/2 top-[14vh] z-[60] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-soft)] px-4 py-3 text-[var(--text-3)]">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
            placeholder="명령 검색… (예: 세션, 업데이트, 터미널)"
            aria-label="명령 검색"
            className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
          />
          <span className="rounded border border-[var(--border)] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-2)]">ESC</span>
        </div>

        <div role="listbox" aria-label="명령 목록" className="max-h-[46vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-3)]">결과가 없어요</div>
          ) : (
            items.map((item, i) => {
              const showHeader = item.group !== lastGroup
              lastGroup = item.group
              const Icon = item.icon
              return (
                <div key={item.key}>
                  {showHeader && <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)]">{item.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => runItem(item)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs ${
                      i === highlight ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-[var(--text-2)]'
                    }`}
                  >
                    <Icon size={14} className={i === highlight ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)]'} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {i === highlight && <span className="font-mono text-[10px]">⏎</span>}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex gap-3 border-t border-[var(--border-soft)] px-3.5 py-2 text-[10.5px] text-[var(--text-3)]">
          <span>↑↓ 이동</span>
          <span>⏎ 실행</span>
          <span>ESC 닫기</span>
        </div>
      </div>
    </>
  )
}
