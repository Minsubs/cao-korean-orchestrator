import { useEffect, useRef, useState } from 'react'
import { api, type Session } from '../../api'

const REFRESH_MS = 15000

/**
 * Resolves each session's working directory (via its first/supervisor
 * terminal) so the Sidebar can map sessions onto known projects/groups
 * (spec §1: "세션 상세의 터미널 working-directory API 재사용"). Cached per
 * session name; a session missing from the result is either still loading
 * or genuinely unmappable (→ "기타").
 */
export function useSessionLocations(sessions: Session[]): Record<string, string | null> {
  const [locations, setLocations] = useState<Record<string, string | null>>({})
  const inFlight = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    const resolveOne = async (name: string) => {
      if (inFlight.current.has(name)) return
      inFlight.current.add(name)
      try {
        const detail = await api.getSession(name)
        const supervisor = detail.terminals[0]
        if (!supervisor) {
          if (!cancelled) setLocations(prev => ({ ...prev, [name]: null }))
          return
        }
        const wd = await api.getWorkingDirectory(supervisor.id)
        if (!cancelled) setLocations(prev => ({ ...prev, [name]: wd.working_directory }))
      } catch {
        if (!cancelled) setLocations(prev => (name in prev ? prev : { ...prev, [name]: null }))
      } finally {
        inFlight.current.delete(name)
      }
    }

    const resolveAll = () => {
      sessions.forEach(s => void resolveOne(s.name))
    }

    resolveAll()
    const interval = setInterval(resolveAll, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessions.map(s => s.name).join(',')])

  return locations
}
