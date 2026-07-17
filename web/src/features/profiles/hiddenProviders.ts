// UI-local "Provider 표시 설정" preference (feedback #8) — purely a display
// filter, never sent to the backend. Applies to provider *choice* lists (새
// 작업/워커 추가/에이전트 추가 provider pickers) and the profile screen's model
// catalog; explicitly does NOT touch the profile card grid (a profile's
// `source` is a directory/scope tag, a different concept from provider) or
// the Tooling/extensions screen (features/tooling — out of this ownership).
export const HIDDEN_PROVIDERS_KEY = 'cao:hidden-providers:v1'

export const DEFAULT_HIDDEN_PROVIDERS: readonly string[] = ['kiro_cli', 'kimi_cli', 'cursor_cli', 'hermes']

export function loadHiddenProviders(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_PROVIDERS_KEY)
    if (raw === null) return [...DEFAULT_HIDDEN_PROVIDERS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_HIDDEN_PROVIDERS]
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return [...DEFAULT_HIDDEN_PROVIDERS]
  }
}

export function saveHiddenProviders(hidden: string[]): void {
  try {
    window.localStorage.setItem(HIDDEN_PROVIDERS_KEY, JSON.stringify(hidden))
  } catch {
    // Best-effort — the toggle still works for the session even if storage is full/disabled.
  }
}

export function toggleHiddenProvider(hidden: string[], providerName: string): string[] {
  return hidden.includes(providerName) ? hidden.filter(name => name !== providerName) : [...hidden, providerName]
}

/** Filter any `{name}`-shaped list (ProviderInfo, provider select option, ...) down to the visible ones. */
export function filterVisibleProviders<T extends { name: string }>(items: T[], hidden: string[]): T[] {
  return items.filter(item => !hidden.includes(item.name))
}

/** Same filter for `{provider}`-shaped items (ModelCatalogEntry's own field name). */
export function filterVisibleCatalogEntries<T extends { provider: string }>(items: T[], hidden: string[]): T[] {
  return items.filter(item => !hidden.includes(item.provider))
}
