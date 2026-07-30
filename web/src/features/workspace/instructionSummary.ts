// Delegation-card 배정 문구 정리.
//
// The raw instruction handed to a worker carries orchestration plumbing that is
// meaningless to a person reading the card — "[Assigned by terminal <id>. When
// done, send results back to terminal <id> using send_message]" on assign, and a
// "[CAO Handoff] Supervisor terminal ID: …" preamble on handoff. It then runs for
// hundreds of characters. Cards dumped all of it verbatim.
//
// Strip the plumbing (same rule as the rest of the UI: internal identifiers are
// never user-facing copy), collapse whitespace, and cut to a readable length. The
// full text stays available behind a toggle in the card, so nothing is lost.

/** Longest summary we render inline before offering "전체 보기". */
export const SUMMARY_MAX = 120

const PLUMBING_PATTERNS: RegExp[] = [
  // assign: trailing bracketed callback contract, with terminal ids
  /\[\s*Assigned by terminal[\s\S]*?send_message\s*\]/gi,
  // handoff: leading preamble up to and including the send_message advisory
  /\[CAO Handoff\][\s\S]*?present your deliverables\.\s*/gi,
  // defensive: a bare Supervisor-terminal-ID sentence if the preamble shifts
  /Supervisor terminal ID:\s*[0-9a-f]{6,}\.\s*/gi,
]

/** Remove orchestration plumbing and normalise whitespace. May return ''. */
export function stripInstructionPlumbing(raw: string | null | undefined): string {
  if (!raw) return ''
  let text = raw
  for (const pattern of PLUMBING_PATTERNS) text = text.replace(pattern, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

export interface InstructionSummary {
  /** Cleaned, possibly shortened text. '' when there was nothing but plumbing. */
  text: string
  /** True when `text` is a shortened form and the full text is worth offering. */
  truncated: boolean
}

export function instructionSummary(raw: string | null | undefined): InstructionSummary {
  const clean = stripInstructionPlumbing(raw)
  if (clean.length <= SUMMARY_MAX) return { text: clean, truncated: false }

  // Cut on the last word boundary inside the budget so a token is not sliced in
  // half; fall back to a hard cut for text with no spaces (e.g. a long path).
  const window = clean.slice(0, SUMMARY_MAX)
  const lastSpace = window.lastIndexOf(' ')
  const body = lastSpace > SUMMARY_MAX * 0.5 ? window.slice(0, lastSpace) : window
  return { text: `${body.trimEnd()}…`, truncated: true }
}
