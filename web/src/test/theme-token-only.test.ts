import { describe, expect, it } from 'vitest'

// 라이트 모드 회귀 방지 — 색은 토큰으로만 쓴다.
//
// The theme switch works by re-defining CSS variables per theme block in
// theme.generated.css (:root, prefers-color-scheme: dark, [data-theme="dark"],
// [data-theme="light"]). A hardcoded Tailwind palette class renders the *same*
// value in every theme, so each one is a spot where light mode silently keeps
// dark-mode colors. That is how the 대상 선택 field shipped unreadable in light
// mode (fixed in the CustomSelect pass), and ~580 more occurrences were still
// spread across the panel components afterwards.
//
// Per-component render assertions can't cover this: the defect is the *absence*
// of theme response, which a single-theme jsdom render looks fine in. So the
// guard is textual, over the same sources the browser ships.
//
// Deliberately NOT flagged:
//   - `bg-black/NN`, `bg-white/NN` — scrims and glass overlays that are meant to
//     be the same wash in both themes.
//   - anything already in `[var(--…)]` form.
//   - emulator/canvas paint values (hex strings, xterm theme objects): those are
//     not Tailwind utilities and this regex does not match them.
//
// Sources come through Vite's import.meta.glob (raw) rather than node:fs —
// web/tsconfig.json is browser-only with no @types/node, so fs/path/__dirname
// would not type-check here.
const sources = import.meta.glob('../{app,components,features}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|')

const UTILITY = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'to',
  'via',
  'divide',
  'placeholder',
  'outline',
  'decoration',
  'accent',
  'fill',
  'stroke',
  'shadow',
].join('|')

/** e.g. `bg-gray-900`, `hover:text-emerald-400`, `border-gray-700/50` */
const HARDCODED = new RegExp(`\\b(?:${UTILITY})-(?:${PALETTE})-\\d{2,3}(?:/\\d{1,3})?\\b`, 'g')

describe('theme colors come from design tokens only', () => {
  it('finds source files to check (a broken glob must not pass silently)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('has no hardcoded Tailwind palette color class in shipped UI source', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, index) => {
        const hits = line.match(HARDCODED)
        if (hits) offenders.push(`${path}:${index + 1}  ${[...new Set(hits)].join(' ')}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('detects a hardcoded class when one is present (guard is not vacuous)', () => {
    expect('className="bg-gray-900 text-emerald-400"'.match(HARDCODED)).toEqual(['bg-gray-900', 'text-emerald-400'])
    expect('className="bg-[var(--surface)] text-[var(--accent-text)]"'.match(HARDCODED)).toBeNull()
    expect('className="bg-black/40 bg-white/10"'.match(HARDCODED)).toBeNull()
  })
})
