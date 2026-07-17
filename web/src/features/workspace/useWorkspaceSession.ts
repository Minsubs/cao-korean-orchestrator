import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type TerminalMeta } from '../../api'
import { apiUi, type TerminalDetail } from '../../api.ui'
import { useStore } from '../../store'
import {
  formatOrchestratorOutput,
  loadStoredChat,
  nextChatId,
  saveStoredChat,
  WAITING_MESSAGE,
} from './orchestratorChat'
import { applyUiEvents, buildThreadItems, mergeSeededCard, seedCardFromTerminalMeta, withCallerNames } from './threadReducer'
import type { UiConnectionStatus } from './eventsClient'
import type { ChatEntry, DelegationCard, ThreadItem, UiEvent } from './types'

const SESSION_POLL_MS = 4000
const SETTLED_STATUSES = ['completed', 'idle', 'waiting_user_answer', 'error']
const PENDING_TIMEOUT_MS = 180000

interface PendingReply {
  messageId: string
  baseline: string
  terminalId: string
}

function eventBelongsToSession(event: UiEvent, sessionIds: Set<string>, knownTerminalIds: Set<string>): boolean {
  const detail = event.detail as Record<string, unknown>
  const sid = typeof detail.session_id === 'string' ? detail.session_id : undefined
  if (sid) return sessionIds.has(sid)
  const tid = typeof detail.terminal_id === 'string' ? detail.terminal_id : undefined
  if (tid) return knownTerminalIds.has(tid)
  const receiver = typeof detail.receiver === 'string' ? detail.receiver : undefined
  if (receiver) return knownTerminalIds.has(receiver)
  return false
}

export interface WorkspaceSessionState {
  loading: boolean
  terminals: TerminalMeta[]
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  threadItems: ThreadItem[]
  locations: Record<string, string | null>
  terminalStatuses: Record<string, string>
  chatEntries: ChatEntry[]
  sending: boolean
  composerTargetId: string | null
  setComposerTarget: (id: string) => void
  sendMessage: (text: string, explicitTargetId?: string) => Promise<void>
  requestStatusCheck: (aboutTerminalId: string, agentName: string | null) => Promise<void>
  /** Re-runs the session/terminal REST poll immediately (e.g. right after manually adding a worker terminal — spec Phase 2c §2) instead of waiting up to SESSION_POLL_MS. */
  refreshTerminals: () => Promise<void>
}

/**
 * Combines REST session/terminal polling with the shared `/ui/events` stream
 * (passed in — one connection for the whole Workspace, see
 * useUiEventStream.ts) and the ported Supervisor-chat mechanic into the single
 * state the Thread/Composer/Agent panel render from.
 */
export function useWorkspaceSession(sessionName: string | null, events: UiEvent[]): WorkspaceSessionState {
  const setTerminalStatus = useStore(s => s.setTerminalStatus)
  const terminalStatuses = useStore(s => s.terminalStatuses)

  const [terminals, setTerminals] = useState<TerminalMeta[]>([])
  const [sessionIdValue, setSessionIdValue] = useState<string | null>(null)
  const [terminalDetails, setTerminalDetails] = useState<Record<string, TerminalDetail>>({})
  const [locations, setLocations] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)

  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([])
  const [sending, setSending] = useState(false)
  const [composerTargetId, setComposerTargetId] = useState<string | null>(null)
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null)
  const lastOutputRef = useRef<Record<string, string>>({})

  const supervisorTerminalId = terminals[0]?.id ?? null

  // Reset + load persisted (supervisor-scoped) chat whenever the active session changes.
  useEffect(() => {
    if (!sessionName) {
      setChatEntries([])
      return
    }
    const stored = loadStoredChat(sessionName)
    setChatEntries(stored.entries)
    lastOutputRef.current = {}
    setPendingReply(null)
    setSending(false)
    setComposerTargetId(null)
  }, [sessionName])

  // Persist only the supervisor-targeted conversation — matches the classic
  // SessionChatPanel's storage contract exactly (spec: "호환 유지").
  useEffect(() => {
    if (!sessionName) return
    const supervisorOnly = chatEntries.filter(e => !e.targetId || e.targetId === supervisorTerminalId)
    saveStoredChat(sessionName, supervisorOnly, lastOutputRef.current[supervisorTerminalId ?? ''] || '')
  }, [sessionName, chatEntries, supervisorTerminalId])

  // Default composer target to the supervisor once known; snap back if the
  // previously chosen target terminal disappears (closed/killed).
  useEffect(() => {
    if (!supervisorTerminalId) return
    setComposerTargetId(current => {
      if (current && terminals.some(t => t.id === current)) return current
      return supervisorTerminalId
    })
  }, [supervisorTerminalId, terminals])

  // Extracted so it's callable both from the interval below and on-demand
  // (refreshTerminals) — e.g. right after the AgentSidePanel's [+] modal adds
  // a worker terminal, so the new card appears without waiting for the next tick.
  const pollSession = useCallback(async () => {
    if (!sessionName) return
    try {
      const detail = await api.getSession(sessionName)
      // Defensive: a malformed/unexpected response shape must never store a
      // non-array here — every consumer (starting with `terminals[0]` a few
      // lines below) assumes an array, and this state persists across
      // renders, so a bad value doesn't just fail once, it crashes every
      // subsequent render until the next successful poll overwrites it.
      setTerminals(Array.isArray(detail.terminals) ? detail.terminals : [])
      setSessionIdValue(detail.session?.id ?? null)
    } catch {
      // A transient failure keeps the last-known terminal list rather than blanking the thread.
    }
  }, [sessionName])

  // Session/terminal REST polling — the always-available baseline (spec §backend
  // contract: Thread must keep functioning purely from this when events are down).
  useEffect(() => {
    if (!sessionName) {
      setTerminals([])
      setSessionIdValue(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    void (async () => {
      await pollSession()
      if (!cancelled) setLoading(false)
    })()
    const interval = setInterval(pollSession, SESSION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionName, pollSession])

  // Per-terminal extended detail (caller_id/last_output_at/agent_profile/status)
  // + working directory. One extended-detail call replaces the separate
  // status poll (also mirrors it into the shared store for other views).
  useEffect(() => {
    if (terminals.length === 0) return
    let cancelled = false

    const poll = async () => {
      await Promise.all(
        terminals.map(async t => {
          try {
            const [detail, wd] = await Promise.all([apiUi.getTerminalDetail(t.id), api.getWorkingDirectory(t.id)])
            if (cancelled) return
            setTerminalDetails(prev => ({ ...prev, [t.id]: detail }))
            setLocations(prev => ({ ...prev, [t.id]: wd.working_directory }))
            if (detail.status) setTerminalStatus(t.id, detail.status)
          } catch {
            // Leave prior known values in place — a single failed probe shouldn't blank a card.
          }
        }),
      )
    }

    void poll()
    const interval = setInterval(poll, SESSION_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [terminals, setTerminalStatus])

  // ── Card assembly: REST seed (always) + event overlay (when available) ──
  const cardsRecord = useMemo(() => {
    let cards: Record<string, DelegationCard> = {}
    terminals.slice(1).forEach(t => {
      const extra = {
        callerId: terminalDetails[t.id]?.caller_id ?? null,
        lastOutputAt: terminalDetails[t.id]?.last_output_at ?? null,
        location: locations[t.id] ?? null,
      }
      const seeded = seedCardFromTerminalMeta(t, extra)
      cards[t.id] = seeded
    })

    const sessionIds = new Set([sessionIdValue, sessionName].filter((v): v is string => !!v))
    const knownTerminalIds = new Set(terminals.map(t => t.id))
    const relevantEvents = events.filter(e => eventBelongsToSession(e, sessionIds, knownTerminalIds))

    // Fold in any event-known cards not yet visible via REST (e.g. a brand-new
    // terminal_created the next session poll hasn't reflected yet), then
    // re-merge REST truth (identity/location) over the result.
    const eventCards = applyUiEvents({}, relevantEvents)
    const merged: Record<string, DelegationCard> = {}
    for (const [id, seeded] of Object.entries(cards)) {
      merged[id] = mergeSeededCard(eventCards[id], seeded)
    }
    cards = { ...eventCards, ...merged }
    // Apply the same event set again so status/instruction/killed mutations
    // (which only ever update an existing card, never create one) land on the
    // REST-seeded cards too.
    cards = applyUiEvents(cards, relevantEvents)
    cards = withCallerNames(cards)
    return cards
  }, [terminals, terminalDetails, locations, events, sessionIdValue, sessionName])

  const cards = useMemo(
    () => Object.values(cardsRecord).sort((a, b) => a.firstSeenAt - b.firstSeenAt),
    [cardsRecord],
  )

  const threadItems = useMemo(() => {
    const sessionIds = new Set([sessionIdValue, sessionName].filter((v): v is string => !!v))
    const knownTerminalIds = new Set(terminals.map(t => t.id))
    const relevantEvents = events.filter(e => eventBelongsToSession(e, sessionIds, knownTerminalIds))
    return buildThreadItems({ events: relevantEvents, chat: chatEntries, cards: cardsRecord })
  }, [events, chatEntries, cardsRecord, sessionIdValue, sessionName, terminals])

  const replaceChatEntry = useCallback((id: string, content: string) => {
    setChatEntries(current => current.map(e => (e.id === id ? { ...e, content } : e)))
  }, [])

  const sendMessage = useCallback(
    async (text: string, explicitTargetId?: string) => {
      const prompt = text.trim()
      const targetId = explicitTargetId ?? composerTargetId ?? supervisorTerminalId
      if (!prompt || !targetId || sending) return

      const isSupervisor = targetId === supervisorTerminalId
      const replyId = nextChatId('assistant')
      const userEntry: ChatEntry = {
        id: nextChatId('user'),
        role: 'user',
        content: prompt,
        ts: Date.now(),
        targetId: isSupervisor ? undefined : targetId,
      }
      const pendingEntry: ChatEntry = {
        id: replyId,
        role: 'assistant',
        content: WAITING_MESSAGE,
        ts: Date.now() + 1,
        targetId: isSupervisor ? undefined : targetId,
      }
      setChatEntries(current => [...current, userEntry, pendingEntry])
      setSending(true)

      try {
        await api.sendInput(targetId, prompt)
        setPendingReply({ messageId: replyId, baseline: lastOutputRef.current[targetId] || '', terminalId: targetId })
      } catch (error: unknown) {
        const err = error as { detail?: string; message?: string }
        replaceChatEntry(replyId, err?.detail || err?.message || '메시지를 보내지 못했습니다.')
        setSending(false)
      }
    },
    [composerTargetId, supervisorTerminalId, sending, replaceChatEntry],
  )

  // Generalized pending-reply poll — ported from SessionChatPanel, parameterized by target terminal.
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
          api.getTerminalOutput(pendingReply.terminalId, 'last'),
          api.getTerminalStatus(pendingReply.terminalId),
        ])
        if (cancelled) return
        const clean = formatOrchestratorOutput(outputResult.output || '')
        const normalized = (terminalStatus || 'unknown').toLowerCase()

        if (clean && clean !== pendingReply.baseline) {
          replaceChatEntry(pendingReply.messageId, clean)
          lastOutputRef.current[pendingReply.terminalId] = clean
          if (clean === lastSeen) stableReads += 1
          else {
            lastSeen = clean
            stableReads = 0
          }
        }

        const settled = SETTLED_STATUSES.includes(normalized)
        const hasReply = clean.length > 0 && clean !== pendingReply.baseline
        if (hasReply && (settled || stableReads >= 2)) {
          setPendingReply(null)
          setSending(false)
          return
        }
      } catch {
        // Transient poll failure — keep the sent prompt visible and keep retrying.
      }
      if (!cancelled) timer = setTimeout(poll, 2000)
    }

    void poll()
    timeoutTimer = setTimeout(() => {
      if (cancelled) return
      replaceChatEntry(pendingReply.messageId, '응답이 계속 처리 중입니다. 잠시 후 새로고침해 확인하세요.')
      setPendingReply(null)
      setSending(false)
    }, PENDING_TIMEOUT_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }, [pendingReply, replaceChatEntry])

  const requestStatusCheck = useCallback(
    async (aboutTerminalId: string, agentName: string | null) => {
      if (!supervisorTerminalId) return
      const label = agentName || aboutTerminalId.slice(0, 8)
      await sendMessage(`${label} 에이전트의 진행 상황을 확인해서 알려줘.`, supervisorTerminalId)
    },
    [sendMessage, supervisorTerminalId],
  )

  return {
    loading,
    terminals,
    supervisorTerminalId,
    cards,
    threadItems,
    locations,
    terminalStatuses,
    chatEntries,
    sending,
    composerTargetId,
    setComposerTarget: setComposerTargetId,
    sendMessage,
    requestStatusCheck,
    refreshTerminals: pollSession,
  }
}
