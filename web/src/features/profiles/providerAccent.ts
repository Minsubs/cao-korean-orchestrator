// Agent-viz (Phase 4-C) provider accent chip colors. Maps a CLI provider id to
// its `--prov-<id>-bg`/`-fg` design tokens (design-tokens/tokens.json ->
// web/src/theme.generated.css) — never hardcoded hex. Unknown providers fall
// back to the neutral surface/text tokens.
export interface ProviderAccent {
  bg: string
  fg: string
}

const MAP: Record<string, ProviderAccent> = {
  codex: { bg: 'var(--prov-codex-bg)', fg: 'var(--prov-codex-fg)' },
  claude_code: { bg: 'var(--prov-claude-bg)', fg: 'var(--prov-claude-fg)' },
  antigravity_cli: { bg: 'var(--prov-agy-bg)', fg: 'var(--prov-agy-fg)' },
}

const FALLBACK: ProviderAccent = { bg: 'var(--surface-3)', fg: 'var(--text-2)' }

export function providerAccent(provider: string): ProviderAccent {
  return MAP[provider] ?? FALLBACK
}
