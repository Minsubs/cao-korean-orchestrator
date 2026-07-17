import { Blocks, Brain, MessageSquare, Moon, Plus, RefreshCw, Sliders, Users, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Matches AppShell.tsx's own `ViewKey` union exactly (`web/src/app/AppShell.tsx`,
 * read-only reference — AppShell wiring happens at integration, not here).
 * Kept as a local literal type rather than an import so this feature has zero
 * dependency on the AppShell module.
 */
export type NavigateView = 'workspace' | 'automation' | 'tooling' | 'agent-profiles' | 'memory' | 'settings'

export type PaletteAction =
  | { kind: 'navigate'; view: NavigateView }
  | { kind: 'command'; id: string }
  | { kind: 'theme' }

export interface StaticCommand {
  group: string
  label: string
  icon: LucideIcon
  action: PaletteAction
}

// Group labels and wording reused from the Phase 5c mockup's Command Palette
// (CMDS array — 이동/작업/도구 groups), narrowed to the command set the phase
// spec actually asks the real component to wire up.
export const STATIC_COMMANDS: StaticCommand[] = [
  { group: '이동', label: '작업공간 열기', icon: MessageSquare, action: { kind: 'navigate', view: 'workspace' } },
  { group: '이동', label: '자동 실행(Flows) 열기', icon: Zap, action: { kind: 'navigate', view: 'automation' } },
  { group: '이동', label: '도구 및 확장 열기', icon: Blocks, action: { kind: 'navigate', view: 'tooling' } },
  { group: '이동', label: 'Agent 프로필 열기', icon: Users, action: { kind: 'navigate', view: 'agent-profiles' } },
  { group: '이동', label: '메모리 열기', icon: Brain, action: { kind: 'navigate', view: 'memory' } },
  { group: '이동', label: '설정 열기', icon: Sliders, action: { kind: 'navigate', view: 'settings' } },
  { group: '작업', label: '새 작업 시작', icon: Plus, action: { kind: 'command', id: 'new-task' } },
  { group: '도구', label: '테마 전환 (다크/라이트)', icon: Moon, action: { kind: 'theme' } },
  { group: '도구', label: '업데이트 확인', icon: RefreshCw, action: { kind: 'navigate', view: 'tooling' } },
]
