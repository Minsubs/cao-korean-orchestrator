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
  type WorkspacePendingReply,
} from './orchestratorChat'
import { applyUiEvents, buildThreadItems, filterUiEventsForSession, mergeSeededCard, seedCardFromTerminalMeta, withCallerNames } from './threadReducer'
import { computeOrchestrationProgress, summarizeOrchestration, type OrchestrationSummary } from './orchestrationProgress'
import { classifyOrchestrationError, pendingTimeoutMessage, type ClassifiedError } from './orchestrationError'
import {
  isTurnQuiet,
  PENDING_POLL_MS,
  PENDING_QUIET_POLL_MS,
  progressFingerprint,
} from './pendingProgress'
import type { UiConnectionStatus } from './eventsClient'
import type { ChatEntry, DelegationCard, ThreadItem, UiEvent } from './types'
import { orchestrationReplyFingerprint, snapshotInputGenerations } from './sessionCompletion'
import { loadDelegationHistory, saveDelegationHistory } from './delegationHistory'
import { inferTeamRosterFromOutput, loadTeamRoster, saveTeamRoster, type TeamRosterProfile } from './teamRoster'

const SESSION_POLL_MS = 4000

export interface WorkspaceSessionState {
  loading: boolean
  terminals: TerminalMeta[]
  supervisorTerminalId: string | null
  cards: DelegationCard[]
  teamRoster: TeamRosterProfile[]
  threadItems: ThreadItem[]
  locations: Record<string, string | null>
  terminalStatuses: Record<string, string>
  chatEntries: ChatEntry[]
  sending: boolean
  /** ms epoch the pending turn was sent, or null when nothing is pending (or the stored turn predates Phase 2). */
  pendingSince: number | null
  /** Chat entry id of the pending assistant placeholder the progress card replaces. */
  pendingMessageId: string | null
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
  const [pendingReply, setPendingReply] = useState<WorkspacePendingReply | null>(null)
  const [teamRoster, setTeamRoster] = useState<TeamRosterProfile[]>([])
  const [delegationHistory, setDelegationHistory] = useState<Record<string, DelegationCard>>({})
  const lastOutputRef = useRef<Record<string, string>>({})
  const storedSupervisorOutputRef = useRef('')
  const skipPersistForSessionRef = useRef<string | null>(null)
  const rosterBackfillSessionRef = useRef<string | null>(null)
  // Latest card/status snapshot for the pending-reply effect, which must not
  // re-subscribe (and restart its poll) every time a status tick arrives.
  const cardsRef = useRef<DelegationCard[]>([])
  const terminalStatusesRef = useRef<Record<string, string>>({})

  const supervisorTerminalId = terminals[0]?.id ?? null

  // Reset + load persisted (supervisor-scoped) chat whenever the active session changes.
  useEffect(() => {
    if (!sessionName) {
      setChatEntries([])
      setTeamRoster([])
      setDelegationHistory({})
      return
    }
    const stored = loadStoredChat(sessionName)
    skipPersistForSessionRef.current = sessionName
    setChatEntries(stored.entries)
    storedSupervisorOutputRef.current = stored.lastOutput
    lastOutputRef.current = stored.pendingReply
      ? { [stored.pendingReply.terminalId]: stored.pendingReply.baseline }
      : {}
    setPendingReply(stored.pendingReply)
    setSending(Boolean(stored.pendingReply))
    setComposerTargetId(stored.pendingReply?.terminalId ?? null)
    setTeamRoster(loadTeamRoster(sessionName))
    setDelegationHistory(loadDelegationHistory(sessionName))
    rosterBackfillSessionRef.current = null
  }, [sessionName])

  // Keep Workspace-specific target/pending metadata in the shared storage
  // object while preserving the classic modal's supervisor-only fields.
  useEffect(() => {
    if (!sessionName) return
    if (skipPersistForSessionRef.current === sessionName) {
      skipPersistForSessionRef.current = null
      return
    }
    saveStoredChat(
      sessionName,
      chatEntries,
      lastOutputRef.current[supervisorTerminalId ?? ''] || storedSupervisorOutputRef.current,
      pendingReply,
    )
  }, [sessionName, chatEntries, supervisorTerminalId, pendingReply])

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

  // Before roster persistence existed, completed handoffs still recorded the
  // exact agent_profile arguments in supervisor output. Recover them once so
  // existing sessions gain the same full-team panel without recreation.
  useEffect(() => {
    if (!sessionName || loadTeamRoster(sessionName).length > 0) return
    const supervisor = terminals[0]
    if (!supervisor || supervisor.tmux_session !== sessionName) return
    if (rosterBackfillSessionRef.current === sessionName) return
    rosterBackfillSessionRef.current = sessionName
    let cancelled = false
    void api.getTerminalOutput(supervisor.id, 'full').then(result => {
      if (cancelled) return
      const inferred = inferTeamRosterFromOutput(result.output || '')
      if (inferred.length === 0) return
      saveTeamRoster(sessionName, inferred)
      setTeamRoster(inferred)
    }).catch(() => {
      // No retained output means only live/history cards can be recovered.
    })
    return () => {
      cancelled = true
    }
  }, [sessionName, terminals])

  // ── Card assembly: REST seed (always) + event overlay (when available) ──
  const cardsRecord = useMemo(() => {
    let cards: Record<string, DelegationCard> = { ...delegationHistory }
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
    const relevantEvents = filterUiEventsForSession(events, sessionIds, knownTerminalIds)

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
    if (supervisorTerminalId) delete cards[supervisorTerminalId]
    cards = withCallerNames(cards)
    return cards
  }, [terminals, terminalDetails, locations, events, sessionIdValue, sessionName, delegationHistory, supervisorTerminalId])

  const cards = useMemo(
    () => Object.values(cardsRecord).sort((a, b) => a.firstSeenAt - b.firstSeenAt),
    [cardsRecord],
  )

  useEffect(() => {
    if (!sessionName) return
    saveDelegationHistory(sessionName, cards)
  }, [sessionName, cards])

  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  useEffect(() => {
    terminalStatusesRef.current = terminalStatuses
  }, [terminalStatuses])

  const threadItems = useMemo(() => {
    const sessionIds = new Set([sessionIdValue, sessionName].filter((v): v is string => !!v))
    const knownTerminalIds = new Set(terminals.map(t => t.id))
    const relevantEvents = filterUiEventsForSession(events, sessionIds, knownTerminalIds)
    return buildThreadItems({ events: relevantEvents, chat: chatEntries, cards: cardsRecord })
  }, [events, chatEntries, cardsRecord, sessionIdValue, sessionName, terminals])

  const replaceChatEntry = useCallback(
    (id: string, content: string, raw?: string, progress?: OrchestrationSummary) => {
      setChatEntries(current =>
        current.map(e =>
          e.id === id
            ? {
                ...e,
                content,
                ...(raw !== undefined ? { raw } : {}),
                ...(progress !== undefined ? { progress } : {}),
              }
            : e,
        ),
      )
    },
    [],
  )

  /**
   * Turn a failed send into a user-facing bubble: the classified message is
   * what the user reads, the server's raw detail goes to `raw` (revealed only
   * by "원문 보기"), and `retryPrompt` arms the one-click 다시 보내기.
   */
  const failChatEntry = useCallback((id: string, classified: ClassifiedError, retryPrompt?: string) => {
    setChatEntries(current =>
      current.map(e =>
        e.id === id
          ? {
              ...e,
              content: classified.userMessage,
              ...(classified.raw !== undefined ? { raw: classified.raw } : {}),
              ...(retryPrompt !== undefined ? { retryPrompt } : {}),
            }
          : e,
      ),
    )
  }, [])

  const sendMessage = useCallback(
    async (text: string, explicitTargetId?: string) => {
      const prompt = text.trim()
      const targetId = explicitTargetId ?? composerTargetId ?? supervisorTerminalId
      if (!prompt || !targetId || sending || !sessionName) return

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
        const [sessionDetail, inboxMessages] = await Promise.all([
          api.getSession(sessionName),
          api.getInboxMessages(targetId, 1, undefined, undefined, true),
        ])
        const baselineGenerations = snapshotInputGenerations(sessionDetail.terminals)
        const baselineInboxMessageId = Math.max(0, ...inboxMessages.map(message => message.id))
        const nextPendingReply: WorkspacePendingReply = {
          messageId: replyId,
          baseline: lastOutputRef.current[targetId]
            || (targetId === supervisorTerminalId ? storedSupervisorOutputRef.current : ''),
          terminalId: targetId,
          baselineGenerations,
          baselineInboxMessageId,
          startedAt: Date.now(),
        }
        setPendingReply(nextPendingReply)
        await api.sendInput(targetId, prompt)
      } catch (error: unknown) {
        failChatEntry(replyId, classifyOrchestrationError(error), prompt)
        setPendingReply(null)
        setSending(false)
      }
    },
    [composerTargetId, supervisorTerminalId, sending, failChatEntry, sessionName],
  )

  // Generalized pending-reply poll — ported from SessionChatPanel, parameterized by target terminal.
  useEffect(() => {
    if (!pendingReply || !sessionName) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Inactivity, not a stopwatch: a multi-agent turn can legitimately run for
    // many minutes, so the clock resets whenever anything moves. Nothing is
    // discarded when it does go quiet — polling just slows down, so a late
    // answer still lands (the old flat 180s cleared pendingReply and the reply
    // could never be shown at all).
    let lastProgressAt = Date.now()
    let lastFingerprint = ''
    let announcedQuiet = false

    const poll = async () => {
      try {
        const [sessionBefore, inboxBefore] = await Promise.all([
          api.getSession(sessionName),
          api.getInboxMessages(
            pendingReply.terminalId,
            100,
            undefined,
            pendingReply.baselineInboxMessageId,
          ),
        ])
        if (cancelled) return
        const beforeFingerprint = orchestrationReplyFingerprint(
          sessionBefore.terminals,
          pendingReply.terminalId,
          pendingReply.baselineGenerations,
          inboxBefore,
          pendingReply.baselineInboxMessageId,
        )
        if (!beforeFingerprint) throw new Error('Orchestration is still running')

        const outputResult = await api.getTerminalOutput(pendingReply.terminalId, 'last')
        const [sessionAfter, inboxAfter] = await Promise.all([
          api.getSession(sessionName),
          api.getInboxMessages(
            pendingReply.terminalId,
            100,
            undefined,
            pendingReply.baselineInboxMessageId,
          ),
        ])
        if (cancelled) return
        const afterFingerprint = orchestrationReplyFingerprint(
          sessionAfter.terminals,
          pendingReply.terminalId,
          pendingReply.baselineGenerations,
          inboxAfter,
          pendingReply.baselineInboxMessageId,
        )
        if (beforeFingerprint !== afterFingerprint) throw new Error('Orchestration state changed during output read')

        // Any movement re-arms the wait — computed from the detail this round
        // already fetched, so watching for progress costs no extra request.
        const fingerprint = progressFingerprint({
          output: outputResult.output || '',
          generations: snapshotInputGenerations(sessionAfter.terminals),
          latestInboxId: inboxAfter.reduce((max, m) => Math.max(max, m.id), 0),
          statuses: terminalStatusesRef.current,
        })
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint
          lastProgressAt = Date.now()
          announcedQuiet = false
        }

        const clean = formatOrchestratorOutput(outputResult.output || '')
        if (clean && clean !== pendingReply.baseline) {
          // Freeze what this turn actually delegated, so the collapsed
          // "✓ 완료 · 워커 N · 소요 M" summary survives reload.
          const summary = summarizeOrchestration(
            computeOrchestrationProgress({
              pendingSince: pendingReply.startedAt ?? null,
              supervisorTerminalId,
              cards: cardsRef.current,
              terminalStatuses: terminalStatusesRef.current,
              now: Date.now(),
            }),
          )
          replaceChatEntry(pendingReply.messageId, clean, outputResult.output || '', summary)
          lastOutputRef.current[pendingReply.terminalId] = clean
          if (pendingReply.terminalId === supervisorTerminalId) storedSupervisorOutputRef.current = clean
          setPendingReply(null)
          setSending(false)
          return
        }
      } catch {
        // Transient poll failure — keep the sent prompt visible and keep retrying.
      }
      if (cancelled) return

      const quiet = isTurnQuiet(lastProgressAt, Date.now())
      if (quiet && !announcedQuiet) {
        announcedQuiet = true
        // Say so, but keep the turn alive so the answer can still replace this.
        replaceChatEntry(pendingReply.messageId, pendingTimeoutMessage())
      }
      if (!cancelled) timer = setTimeout(poll, quiet ? PENDING_QUIET_POLL_MS : PENDING_POLL_MS)
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pendingReply, replaceChatEntry, sessionName, supervisorTerminalId])

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
    teamRoster,
    threadItems,
    locations,
    terminalStatuses,
    chatEntries,
    sending,
    pendingSince: pendingReply?.startedAt ?? null,
    pendingMessageId: pendingReply?.messageId ?? null,
    composerTargetId,
    setComposerTarget: setComposerTargetId,
    sendMessage,
    requestStatusCheck,
    refreshTerminals: pollSession,
  }
}
