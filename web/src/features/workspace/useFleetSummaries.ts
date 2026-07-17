// Per-session `GET /sessions/{name}` polling, shared by the fleet Overview
// and (feedback #16) the Sidebar's per-session completion badge. Extracted
// out of Overview.tsx so both consumers read the exact same poll instead of
// running two independent intervals against the same endpoint — Workspace.tsx
// calls this once and hands the result to both (see its `summariesOverride`
// plumbing into Overview.tsx). Mount + 30s refresh; deliberately independent
// of useWorkspaceSession's own REST poll (that one only ever tracks whichever
// single session's Thread is open) — this needs every session's terminals at
// once, which this endpoint already gives cheaply — it enriches each terminal
// with a live `status` server-side (session_service.py get_session), see
// api.ui.ts's `TerminalMetaWithStatus`.
//
// A session whose fetch fails keeps its last-known summary rather than
// blanking out (same honesty-over-flicker contract as useWorkspaceSession's
// REST poll) — only a session removed from the store's session list is ever
// dropped from the map.
import { useEffect, useState } from 'react'
import { api, type Session } from '../../api'
import type { TerminalMetaWithStatus } from '../../api.ui'

const FLEET_POLL_MS = 30000

export interface FleetTerminal {
  id: string
  status: string | null
  agentProfile: string | null
  provider: string | null
}

export interface FleetSessionSummary {
  sessionId: string
  sessionName: string
  terminals: FleetTerminal[]
}

export interface FleetSummariesState {
  summaries: Record<string, FleetSessionSummary>
  loading: boolean
  allFailed: boolean
}

export function useFleetSummaries(sessions: Session[]): FleetSummariesState {
  const [summaries, setSummaries] = useState<Record<string, FleetSessionSummary>>({})
  const [loading, setLoading] = useState(true)
  const [allFailed, setAllFailed] = useState(false)

  useEffect(() => {
    if (sessions.length === 0) {
      setSummaries({})
      setLoading(false)
      setAllFailed(false)
      return
    }
    let cancelled = false

    const poll = async () => {
      const results = await Promise.allSettled(
        sessions.map(async s => {
          const detail = await api.getSession(s.name)
          const terminals = (detail.terminals as TerminalMetaWithStatus[]).map(t => ({
            id: t.id,
            status: t.status ?? null,
            agentProfile: t.agent_profile,
            provider: t.provider,
          }))
          return { sessionId: s.id, sessionName: s.name, terminals }
        }),
      )
      if (cancelled) return

      setSummaries(prev => {
        const next = { ...prev }
        const liveIds = new Set(sessions.map(s => s.id))
        for (const key of Object.keys(next)) {
          if (!liveIds.has(key)) delete next[key]
        }
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[sessions[i].id] = r.value
        })
        return next
      })
      setAllFailed(results.every(r => r.status === 'rejected'))
      setLoading(false)
    }

    void poll()
    const interval = setInterval(poll, FLEET_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint 없음: 세션 이름 목록이 바뀔 때만 새 폴링 루프를 시작한다
  }, [sessions.map(s => s.name).join(',')])

  return { summaries, loading, allFailed }
}
