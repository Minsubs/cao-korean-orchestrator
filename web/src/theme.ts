// Theme preference management for the app shell (Phase 1).
// The CSS variables themselves are emitted by design-tokens/gen.mjs into
// theme.generated.css; this module only controls which theme is active by
// stamping data-theme on <html> — the same contract the generated CSS keys on.

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'cao:theme'
// Product decision (2026-07-17): default to light; users can switch in the top bar.
const DEFAULT_PREFERENCE: ThemePreference = 'light'

export function getThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    // Storage unavailable (private mode) — fall through to default.
  }
  return DEFAULT_PREFERENCE
}

export function resolveTheme(pref: ThemePreference = getThemePreference()): ResolvedTheme {
  if (pref === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

function apply(pref: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(pref)
}

export function setTheme(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Persisting is best-effort; the session still gets the theme.
  }
  apply(pref)
}

/** Call once at startup (before first paint if possible). */
export function initTheme(): void {
  apply(getThemePreference())
}
