import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Inbox as InboxIcon, List, Maximize2, FileText, Terminal as TermIcon } from 'lucide-react'
import { TerminalView } from '../../components/TerminalView'
import { OutputViewer } from '../../components/OutputViewer'
import { InboxPanel } from '../../components/InboxPanel'
import { STORAGE_KEYS } from './constants'
import { AgentAvatar } from './AgentAvatar'
import { ContextGaugeChip } from './ContextGaugeChip'
import type { UiEvent } from './types'

type WbTab = 'term' | 'output' | 'inbox' | 'logs'

interface WorkbenchState {
  open: boolean
  tall: boolean
  tab: WbTab
}

const DEFAULT_STATE: WorkbenchState = { open: false, tall: false, tab: 'term' }

function loadState(): WorkbenchState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.workbench) || '{}')
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULT_STATE.open,
      tall: typeof parsed.tall === 'boolean' ? parsed.tall : DEFAULT_STATE.tall,
      tab: (['term', 'output', 'inbox', 'logs'] as WbTab[]).includes(parsed.tab) ? parsed.tab : DEFAULT_STATE.tab,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function saveState(state: WorkbenchState) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.workbench, JSON.stringify(state))
  } catch {
    // View-preference persistence is best-effort.
  }
}

function summarizeEvent(event: UiEvent): string {
  const d = event.detail as Record<string, unknown>
  switch (event.type) {
    case 'session_created':
      return `session_created ${d.session_name ?? ''}`
    case 'session_killed':
      return `session_killed ${d.session_name ?? ''}`
    case 'terminal_created':
      return `terminal_created ${String(d.terminal_id ?? '').slice(0, 8)} (${d.agent_name ?? '?'} · ${d.provider ?? '?'})`
    case 'terminal_killed':
      return `terminal_killed ${String(d.terminal_id ?? '').slice(0, 8)}`
    case 'message_sent':
      return `message_sent[${d.orchestration_type}] ${String(d.sender ?? '').slice(0, 8)} → ${String(d.receiver ?? '').slice(0, 8)}`
    case 'status_changed':
      return `status_changed ${String(d.terminal_id ?? '').slice(0, 8)} ${d.prev ?? '?'} → ${d.status}`
    case 'activity':
      return `activity ${String(d.terminal_id ?? '').slice(0, 8)}`
    default:
      return event.type
  }
}

interface WorkbenchProps {
  events: UiEvent[]
  contextTerminalId: string | null
  contextLabel: string | null
  contextProvider: string | null
  /** Phase 2d (spec §2d) remaining-context gauge for the context terminal — `null`/absent renders no chip at all. */
  contextPercentLeft?: number | null
  /** Set together whenever a card/panel action asks for a specific tab (e.g. "터미널 열기") — bump `requestNonce` even for a repeat of the same tab so the dock still (re)opens. */
  requestedTab: WbTab | null
  requestNonce: number
}

/** Bottom dock hosting the classic Terminal/Output/Inbox views inline, plus a structured (never raw-output) Logs tab. Default collapsed; Terminal only mounts while its tab is active and the dock is open. */
export function Workbench({ events, contextTerminalId, contextLabel, contextProvider, contextPercentLeft = null, requestedTab, requestNonce }: WorkbenchProps) {
  const [state, setState] = useState<WorkbenchState>(loadState)

  // An external request (nonce bump) syncs the active tab and pops the dock
  // open exactly once per bump — tracked via ref (not state) so a later manual
  // tab switch or collapse isn't immediately overridden by a stale comparison.
  const prevNonceRef = useRef(requestNonce)
  if (prevNonceRef.current !== requestNonce) {
    prevNonceRef.current = requestNonce
    const next = { ...state, open: true, tab: requestedTab ?? state.tab }
    saveState(next)
    setState(next)
  }

  const update = (patch: Partial<WorkbenchState>) => {
    setState(current => {
      const next = { ...current, ...patch }
      saveState(next)
      return next
    })
  }

  const tabs: { key: WbTab; label: string; icon: JSX.Element }[] = [
    { key: 'term', label: 'Terminal', icon: <TermIcon size={13} /> },
    { key: 'output', label: 'Output', icon: <FileText size={13} /> },
    { key: 'inbox', label: 'Inbox', icon: <InboxIcon size={13} /> },
    { key: 'logs', label: 'Logs', icon: <List size={13} /> },
  ]

  return (
    <div className="flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="flex h-[38px] shrink-0 items-center gap-1 px-2.5">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={state.tab === t.key}
            onClick={() => update({ tab: t.key, open: true })}
            className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold ${
              state.tab === t.key ? 'bg-[var(--surface-3)] text-[var(--text)]' : 'text-[var(--text-3)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <span className="ml-2 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-3)]">
          {contextTerminalId ? (
            <>
              컨텍스트:
              <AgentAvatar name={contextLabel} size="sm" />
              <b className="text-[var(--text)]">{contextLabel ?? contextTerminalId.slice(0, 8)}</b>
              {contextProvider && <span>{contextProvider}</span>}
              <span className="font-mono">{contextTerminalId.slice(0, 8)}</span>
              <ContextGaugeChip percentLeft={contextPercentLeft} />
            </>
          ) : (
            '컨텍스트: 선택된 에이전트 없음'
          )}
        </span>
        <span className="ml-auto flex gap-0.5">
          <button
            type="button"
            title="높이 전환"
            aria-label="워크벤치 높이 전환"
            onClick={() => update({ tall: !state.tall })}
            className="rounded-lg p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            title={state.open ? '워크벤치 접기' : '워크벤치 열기'}
            aria-label={state.open ? '워크벤치 접기' : '워크벤치 열기'}
            aria-expanded={state.open}
            onClick={() => update({ open: !state.open })}
            className="rounded-lg p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            {state.open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </span>
      </div>

      {state.open && (
        <div className="overflow-hidden border-t border-[var(--border-soft)]" style={{ height: state.tall ? '55vh' : 'var(--panel-workbench-h)' }}>
          {/* Logs is session-wide and never needs a selected terminal; Term/Output/Inbox do. */}
          {state.tab !== 'logs' && !contextTerminalId ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-3)]">에이전트 카드에서 터미널/Output/Inbox를 선택하면 여기에 표시돼요.</div>
          ) : state.tab === 'term' && contextTerminalId ? (
            <TerminalView key={contextTerminalId} terminalId={contextTerminalId} provider={contextProvider ?? undefined} onClose={() => update({ open: false })} embedded />
          ) : state.tab === 'output' && contextTerminalId ? (
            <OutputViewer key={contextTerminalId} terminalId={contextTerminalId} onClose={() => update({ open: false })} embedded />
          ) : state.tab === 'inbox' && contextTerminalId ? (
            <InboxPanel key={contextTerminalId} terminalId={contextTerminalId} onClose={() => update({ open: false })} embedded />
          ) : (
            <div className="h-full overflow-y-auto py-2">
              {events.length === 0 ? (
                <p className="px-3.5 text-[11px] text-[var(--text-3)]">이벤트 없음</p>
              ) : (
                [...events]
                  .slice(-200)
                  .reverse()
                  .map(event => (
                    <div key={event.id} className="px-3.5 py-0.5 font-mono text-[11px] text-[var(--text-2)]">
                      {new Date(event.ts).toLocaleTimeString('ko-KR', { hour12: false })} {summarizeEvent(event)}
                    </div>
                  ))
              )}
              <div className="px-3.5 pt-1 text-[10.5px] text-[var(--text-3)]">— raw terminal 출력은 여기 표시하지 않아요 · Terminal 탭에서 확인 —</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
