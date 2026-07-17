// Pure slash-command filtering for the Composer autocomplete (Phase 2e spec
// §2e), kept separate from Composer.tsx so the ordering rule is independently
// unit-testable.
import type { SlashCommandInfo, SlashCommandProvider } from '../../api.ui'

/** True only for the two providers the backend can enumerate (spec: "그 외 provider는 ... 자동완성 기능 자체를 숨김" — every other provider hides the feature entirely, never an error toast). */
export function isSlashCommandProvider(provider: string | null | undefined): provider is SlashCommandProvider {
  return provider === 'claude_code' || provider === 'codex'
}

/**
 * Filters+orders `commands` for the text typed after the leading `/`
 * (case-insensitive, matched against each command's name with its own
 * leading `/` stripped so typing "comp" matches "/compact"). Spec:
 * "startsWith→includes 순 정렬" — every startsWith match precedes every
 * includes-only match, each group keeping the server's original relative
 * order (builtins first); a command matching neither is dropped. An empty
 * query returns the full list unchanged.
 */
export function filterSlashCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands

  const startsWith: SlashCommandInfo[] = []
  const includesOnly: SlashCommandInfo[] = []
  for (const cmd of commands) {
    const bare = cmd.name.replace(/^\//, '').toLowerCase()
    if (bare.startsWith(q)) startsWith.push(cmd)
    else if (bare.includes(q)) includesOnly.push(cmd)
  }
  return [...startsWith, ...includesOnly]
}
