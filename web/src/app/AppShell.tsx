import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Blocks,
  Brain,
  Command,
  MessageSquare,
  Moon,
  Sliders,
  Sun,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import { api } from '../api'
import { useStore } from '../store'
import { resolveTheme, setTheme, type ResolvedTheme } from '../theme'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ToolingView } from '../features/tooling/ToolingView'
import { ProfilesView } from '../features/profiles/ProfilesView'
import { FlowsView } from '../features/flows/FlowsView'
import { CommandPalette } from '../features/command-palette/CommandPalette'
import { MemoryPanel } from '../components/MemoryPanel'
import { SettingsPanel } from '../components/SettingsPanel'
import { NotificationCenter } from '../components/NotificationCenter'
import { Workspace } from '../features/workspace/Workspace'
import { useUiEventStream } from '../features/workspace/useUiEventStream'
import { PENDING_SELECT_KEY } from '../features/workspace/constants'
import { UsageButton } from '../features/usage/UsageButton'

// Phase 1b App Shell: left icon rail + top bar + a single content region that
// swaps between views. Replaces the old 5-tab top bar (App.tsx). FlowsPanel/
// SettingsPanel/MemoryPanel are reused as-is — moved under new rail entries,
// not rebuilt. The Workspace rail item's own classic DashboardHome/AgentPanel
// sub-tabs (Phase 1b/2b) were retired in Phase 2c: Workspace now always
// renders its Phase 2b/2c chat-centric UI (Thread when a session is
// selected, the fleet Overview otherwise) — see docs/ui-refactor-plan.md and
// the Phase 2c spec's feature-mapping table for where each classic feature
// lives now. DashboardHome/AgentPanel are intentionally left in place under
// components/ (unused here, not deleted) per that spec.
type ViewKey = 'workspace' | 'automation' | 'tooling' | 'agent-profiles' | 'memory' | 'settings'

interface RailItem {
  key: ViewKey
  label: string
  icon: ReactNode
}

// `pinned` items render in their own bottom-anchored group (mt-auto) so
// Settings sits at the foot of the rail visually, while still participating
// in the same visible-order list that drives Alt+N numbering below.
const RAIL_ITEMS: (RailItem & { pinned?: boolean })[] = [
  { key: 'workspace', label: '작업공간', icon: <MessageSquare size={20} /> },
  { key: 'automation', label: '자동화', icon: <Zap size={20} /> },
  { key: 'tooling', label: '도구 및 확장', icon: <Blocks size={20} /> },
  { key: 'agent-profiles', label: 'Agent 프로필', icon: <Users size={20} /> },
  { key: 'memory', label: '메모리', icon: <Brain size={20} /> },
  { key: 'settings', label: '설정', icon: <Sliders size={20} />, pinned: true },
]

function RailButton({
  item,
  active,
  shortcutIndex,
  onSelect,
}: {
  item: RailItem
  active: boolean
  shortcutIndex: number
  onSelect: (key: ViewKey) => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={item.label}
      title={`${item.label} (Alt+${shortcutIndex})`}
      onClick={() => onSelect(item.key)}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
          : 'text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
      }`}
    >
      {item.icon}
    </button>
  )
}

/** Existing connection chip, relocated from the old header verbatim. */
function ConnectionChip({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5" title={connected ? '연결됨' : '연결 끊김'}>
      {connected ? (
        <Wifi size={14} className="text-emerald-400" />
      ) : (
        <WifiOff size={14} className="text-red-400" />
      )}
      <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
        {connected ? '연결됨' : '오프라인'}
      </span>
    </div>
  )
}

export function AppShell() {
  const { sessions, connected, fetchSessions } = useStore()
  // Default false (fail-closed): a dead backend hides the rail item rather
  // than showing a broken panel. Carried over from the old App.tsx.
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [activeView, setActiveView] = useState<ViewKey>('workspace')
  const [theme, setThemeState] = useState<ResolvedTheme>(() => resolveTheme())
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Owned here (not inside Workspace) so navigating the rail never tears down
  // the connection: Workspace fully unmounts on every non-workspace view (see
  // renderView below), and a hook's effect cleanup runs on unmount — a
  // useUiEventStream() call living inside Workspace used to close the
  // EventSource on every menu switch and open a fresh one on return. One
  // subscription for the life of the app; passed down as props.
  const { events, status: streamStatus } = useUiEventStream()
  // Same reasoning: lives above the view switch so a session stays selected
  // across a manual rail navigation away and back, instead of resetting when
  // Workspace remounts.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // Palette commands that need Workspace-internal state cross a CustomEvent
  // seam: AppShell owns navigation, Workspace owns its modals/selection.
  const handlePaletteCommand = (id: string, arg?: string) => {
    if (id === 'new-task') {
      setActiveView('workspace')
      window.dispatchEvent(new CustomEvent('cao:open-new-task'))
    } else if (id === 'open-session' && arg) {
      setActiveView('workspace')
      window.dispatchEvent(new CustomEvent('cao:select-session', { detail: arg }))
    }
  }

  const visibleRailItems = useMemo(
    () => RAIL_ITEMS.filter(item => item.key !== 'memory' || memoryEnabled),
    [memoryEnabled],
  )
  const mainRailItems = useMemo(() => visibleRailItems.filter(item => !item.pinned), [visibleRailItems])
  const pinnedRailItems = useMemo(() => visibleRailItems.filter(item => item.pinned), [visibleRailItems])

  useEffect(() => {
    fetchSessions()
    api.getMemoryStatus()
      .then(s => setMemoryEnabled(s.enabled))
      .catch(() => {})
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [])

  // Feedback #17: a `cao:select-session` can also originate outside AppShell
  // (NotificationCenter's completed-session click). Workspace only listens
  // while mounted — if another view is active, the event fires into the
  // unmount gap and the selection would be lost. Stash it (session-scoped)
  // and switch views; Workspace consumes the stash on mount. The functional
  // updater reads the CURRENT view without re-registering the listener.
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<string>).detail
      setActiveView(prev => {
        if (prev !== 'workspace' && typeof name === 'string' && name) {
          sessionStorage.setItem(PENDING_SELECT_KEY, name)
        }
        return 'workspace'
      })
    }
    window.addEventListener('cao:select-session', handler)
    return () => window.removeEventListener('cao:select-session', handler)
  }, [])

  // Keyboard shortcuts: Alt+1..N over the currently visible rail items, in
  // on-screen top-to-bottom order (main group, then the pinned settings
  // item) — succeeds the old top-tab Alt+N behavior 1:1.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= String(visibleRailItems.length)) {
        e.preventDefault()
        setActiveView(visibleRailItems[parseInt(e.key, 10) - 1].key)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visibleRailItems])

  const handleToggleTheme = () => {
    const next: ResolvedTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  const renderView = () => {
    switch (activeView) {
      case 'workspace':
        return (
          <Workspace
            events={events}
            status={streamStatus}
            selectedSessionId={selectedSessionId}
            setSelectedSessionId={setSelectedSessionId}
          />
        )
      case 'automation':
        return <FlowsView />
      case 'tooling':
        return <ToolingView />
      case 'agent-profiles':
        return <ProfilesView />
      case 'memory':
        return (
          <div className="legacy-view">
            <MemoryPanel />
          </div>
        )
      case 'settings':
        return (
          <div className="legacy-view">
            <SettingsPanel />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {/* Left icon rail */}
      <nav
        role="tablist"
        aria-label="주요 화면 전환"
        aria-orientation="vertical"
        className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--surface)] py-3"
      >
        <div className="flex flex-col items-center gap-1">
          {mainRailItems.map(item => (
            <RailButton
              key={item.key}
              item={item}
              active={activeView === item.key}
              shortcutIndex={visibleRailItems.indexOf(item) + 1}
              onSelect={setActiveView}
            />
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          {pinnedRailItems.map(item => (
            <RailButton
              key={item.key}
              item={item}
              active={activeView === item.key}
              shortcutIndex={visibleRailItems.indexOf(item) + 1}
              onSelect={setActiveView}
            />
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-[50px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-sm font-bold text-[var(--on-accent)]">
              M
            </div>
            <span className="text-sm font-semibold text-[var(--text)]">MS Orchestrator</span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationCenter sessions={sessions} />
            <UsageButton />
            <span className="text-xs text-[var(--text-3)]">세션 {sessions.length}개</span>
            <ConnectionChip connected={connected} />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Command Palette 열기"
              title="Command Palette (⌘K / Ctrl+K)"
              className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface-2)]"
            >
              <Command size={13} />
              <kbd className="rounded bg-[var(--surface-3)] px-1 font-mono text-[10px] text-[var(--text-3)]">⌘K</kbd>
            </button>
            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
              title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
              className="rounded-lg p-1.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary>
            <Suspense fallback={<div className="py-12 text-center text-sm text-[var(--text-3)]">불러오는 중...</div>}>
              {activeView === 'workspace' ? (
                <div className="min-h-0 flex-1">{renderView()}</div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-7xl px-6 py-6">{renderView()}</div>
                </div>
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={view => setActiveView(view as ViewKey)}
        onCommand={handlePaletteCommand}
      />
    </div>
  )
}
