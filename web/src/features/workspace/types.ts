// Shared types for the Phase 2b Orchestration Workspace feature.
//
// The `UiEvent*` shapes mirror the backend contract in
// src/cli_agent_orchestrator/services/ui_event_service.py +
// src/cli_agent_orchestrator/plugins/builtin/ui_event_publisher.py (Phase 2a,
// implemented in parallel — read there, never edited here). Event envelope:
// `{id: number, ts: iso8601, type, detail}`, original CAO vocabulary preserved.

export type UiEventType =
  | 'session_created'
  | 'session_killed'
  | 'terminal_created'
  | 'terminal_killed'
  | 'message_sent'
  | 'status_changed'
  | 'activity'

export interface SessionCreatedDetail {
  session_name: string
  session_id: string
}

export interface SessionKilledDetail {
  session_name: string
  session_id: string
}

export interface TerminalCreatedDetail {
  terminal_id: string
  agent_name: string | null
  provider: string
  session_id: string
}

export interface TerminalKilledDetail {
  terminal_id: string
  agent_name: string | null
  provider: string | null
  session_id: string
}

/** `assign`/`handoff` delegate work (attach to a card); `send_message` is a peer note (inner-message group). */
export type OrchestrationType = 'assign' | 'handoff' | 'send_message' | string

export interface MessageSentDetail {
  sender: string
  receiver: string
  message: string
  orchestration_type: OrchestrationType
  session_id: string
}

export interface StatusChangedDetail {
  terminal_id: string
  status: string
  prev: string | null
}

export interface ActivityDetail {
  terminal_id: string
}

export type UiEventDetail =
  | SessionCreatedDetail
  | SessionKilledDetail
  | TerminalCreatedDetail
  | TerminalKilledDetail
  | MessageSentDetail
  | StatusChangedDetail
  | ActivityDetail

/** One event as delivered by `/ui/events` (SSE) or `/ui/events/history`. */
export interface UiEvent {
  id: number
  ts: string
  type: UiEventType
  detail: Record<string, unknown>
}

// ── Thread rendering model ──────────────────────────────────────────────

/** A delegated worker terminal, rendered as a persistent card (never re-added, only updated in place). */
export interface DelegationCard {
  terminalId: string
  sessionId: string | null
  /** Best-known identity: REST `agent_profile` once fetched, else the event's `agent_name` hint. */
  agentName: string | null
  provider: string | null
  callerId: string | null
  /** Display name of the caller/parent terminal, resolved once known. */
  callerAgentName: string | null
  status: string | null
  prevStatus: string | null
  /** Working directory tail, fetched lazily via the existing working-directory API. */
  location: string | null
  locationLoaded: boolean
  /** Latest assign/handoff instruction addressed to this terminal. */
  instruction: string | null
  instructionType: OrchestrationType | null
  instructionFromId: string | null
  killed: boolean
  /** ms epoch of the most recent activity signal (activity event or last_output_at), for stall calc. */
  lastActivityAt: number | null
  lastOutputAt: string | null
  /** ms epoch this card first appeared — fixes its position in the thread. */
  firstSeenAt: number
  /** True once at least one signal (event or REST) has been observed for this terminal. */
  hasSignal: boolean
}

export interface InnerMessage {
  id: string
  sender: string
  receiver: string
  message: string
  ts: number
}

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  /** Set only when addressed to a non-supervisor terminal (composer target switched); undefined = supervisor conversation. */
  targetId?: string
}

export type ThreadItem =
  | { kind: 'chat'; id: string; ts: number; entry: ChatEntry }
  | { kind: 'system'; id: string; ts: number; text: string }
  | { kind: 'card'; id: string; ts: number; card: DelegationCard }
  | { kind: 'inner-group'; id: string; ts: number; messages: InnerMessage[] }

// ── Projects/groups sidebar model (localStorage `cao:projects:v1`) ──────

export interface ProjectRef {
  id: string
  name: string
  path: string
}

export interface ProjectGroup {
  id: string
  name: string
  root: string
  children: ProjectRef[]
}

export interface ProjectsData {
  groups: ProjectGroup[]
  projects: ProjectRef[]
  pinned: string[]
}

/** A sidebar-selectable target: a standalone project, a group root, or a group child. */
export interface ProjectTargetOption {
  key: string
  label: string
  path: string
  kind: 'group-root' | 'group-child' | 'project'
  groupId?: string
}
