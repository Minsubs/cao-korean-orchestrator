import { AVATAR_PALETTE, type AvatarColorKey } from './constants'

/**
 * Deterministic hash → one of the 6 pastel avatar pairs (`--p-*`/`--p-*-ink` in
 * theme.generated.css). Same profile name always resolves to the same color,
 * across reloads and across every card/avatar that renders it.
 */
export function avatarColorFor(name: string | null | undefined): AvatarColorKey {
  const key = name && name.length > 0 ? name : '__unknown__'
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export function avatarVars(color: AvatarColorKey): { bg: string; ink: string } {
  return { bg: `var(--p-${color})`, ink: `var(--p-${color}-ink)` }
}
