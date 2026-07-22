// Provider slug → Korean display name for the usage widget. The
// `/usage/accounts` contract only carries the raw slug (unlike
// api.tooling.ts's ToolingProvider, which already has a server-supplied
// `display_name`) — kept local to this feature rather than importing
// tooling's copy, since features/tooling is out of this feature's ownership
// and under active parallel work. Falls back to the raw slug for any
// provider not listed here (same "untranslated but honest" fallback as
// features/tooling/shared.tsx's kindLabel).
const PROVIDER_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  antigravity_cli: 'Antigravity',
}

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

/** Claude 한도 실측 옵트인은 이 provider에만 적용된다 (spec delta). */
export const CLAUDE_PROVIDER = 'claude_code'
