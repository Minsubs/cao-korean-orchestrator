import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, Terminal as TermIcon } from 'lucide-react'

interface TerminalViewProps {
  terminalId: string
  provider?: string
  agentProfile?: string | null
  onClose: () => void
  /** Render inline (no fixed overlay/header chrome) for the Workbench dock. Default false preserves the classic modal exactly. */
  embedded?: boolean
}

export function TerminalView({ terminalId, provider, agentProfile, onClose, embedded = false }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      scrollback: 10000,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#c9d1d9',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)

    // Connect WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/terminals/${terminalId}/ws`)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      // Fit once the connection is live so we send correct dimensions
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }))
    }

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data))
      }
    }

    ws.onclose = () => {
      term.write('\r\n\x1b[33m[연결이 종료되었습니다]\x1b[0m\r\n')
    }

    // Copy selection to clipboard on mouse-up
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {})
      }
    })

    // Ctrl+Shift+C to copy selection
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const selection = term.getSelection()
        if (selection) navigator.clipboard.writeText(selection).catch(() => {})
        return false
      }
      return true
    })

    // onData handles ALL input including paste — xterm.js
    // receives pasted text through the browser's input system
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Handle resize — debounce to avoid flooding
    let resizeTimer: ReturnType<typeof setTimeout>
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }))
        }
      }, 50)
    })
    resizeObserver.observe(el)

    // Initial fit after layout settles
    const initialFit = requestAnimationFrame(() => {
      fitAddon.fit()
    })

    term.focus()

    return () => {
      cancelAnimationFrame(initialFit)
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
    }
  }, [terminalId])

  // Terminal — absolute positioning gives xterm.js real pixel dimensions to measure
  const terminalArea = (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    </div>
  )

  // Embedded (Workbench dock): no fixed overlay, no header chrome — the
  // Workbench's own tab bar already shows terminal id/provider context.
  if (embedded) {
    return (
      <div className="flex h-full w-full flex-col" style={{ background: '#0d1117' }}>
        {terminalArea}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0d1117' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--surface)] border-b border-[var(--border-soft)] shrink-0">
        <div className="flex items-center gap-3">
          <TermIcon size={16} className="text-[var(--accent-text)]" />
          <span className="text-sm font-mono text-[var(--text-2)]">{terminalId}</span>
          {provider && <span className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] px-2 py-0.5 rounded">{provider}</span>}
          {agentProfile && <span className="text-xs text-[var(--accent-text)] bg-[var(--accent-soft)] px-2 py-0.5 rounded">{agentProfile}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--text-3)]">X를 눌러 닫기</span>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-3)] hover:text-[var(--text)] transition-colors rounded"
            title="터미널 닫기"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {terminalArea}
    </div>
  )
}
