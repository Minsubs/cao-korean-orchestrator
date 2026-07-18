import { STORAGE_KEYS } from './constants'

export interface TeamRosterProfile {
  name: string
  provider: string | null
}

const PROFILE_IN_OUTPUT_RE = /["']agent_profile["']\s*:\s*["']([A-Za-z0-9_-]{1,100})["']/g

function key(sessionName: string): string {
  return `${STORAGE_KEYS.teamRoster}${sessionName}`
}

export function loadTeamRoster(sessionName: string): TeamRosterProfile[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(sessionName)) || '[]')
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    return parsed
      .filter((item): item is TeamRosterProfile => (
        typeof item?.name === 'string'
        && item.name.length > 0
        && (item.provider === null || typeof item.provider === 'string')
      ))
      .filter(item => {
        if (seen.has(item.name)) return false
        seen.add(item.name)
        return true
      })
      .slice(0, 50)
  } catch {
    return []
  }
}

export function saveTeamRoster(sessionName: string, profiles: TeamRosterProfile[]): void {
  try {
    window.localStorage.setItem(key(sessionName), JSON.stringify(profiles.map(profile => ({
      name: profile.name,
      provider: profile.provider ?? null,
    }))))
  } catch {
    // The session still works when localStorage is unavailable.
  }
}

/** Recover bounded profile IDs from synchronous handoff output for legacy sessions. */
export function inferTeamRosterFromOutput(output: string): TeamRosterProfile[] {
  const profiles: TeamRosterProfile[] = []
  const seen = new Set<string>()
  for (const match of output.matchAll(PROFILE_IN_OUTPUT_RE)) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    const provider = name.startsWith('claude_') ? 'claude' : name.startsWith('codex_') ? 'codex' : null
    profiles.push({ name, provider })
    if (profiles.length >= 50) break
  }
  return profiles
}
