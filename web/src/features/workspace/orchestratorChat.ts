// Ported from web/src/components/SessionChatPanel.tsx (the validated, tested
// output-cleaning + localStorage logic — spec: "이식", not import, since the
// original file is left untouched for the preserved classic modal path).
// Keep this in sync by hand if SessionChatPanel's cleaning rules change;
// storage key prefix is intentionally identical so history is shared between
// the classic modal and this inline Thread surface.
import { STORAGE_KEYS } from './constants'
import type { ChatEntry } from './types'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

const TOOL_CALL_LINE = /^\s*•\s*Called\b/
const SEPARATOR_LINE = /^\s*─{20,}\s*$/m
export const WAITING_MESSAGE = '오케스트레이터 응답을 기다리는 중…'

function sanitizeResponseBlock(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/^(?:❯|>)\s*$/.test(trimmed)) return false
      if (/^[✻✽✶✢✳·*]\s+.*\bfor\s+\d+(?:\.\d+)?s\b/.test(trimmed)) return false
      if (/^⎿\s*Stop says:/.test(trimmed)) return false
      if (/^(?:high|medium|low|max)\s*·\s*\/effort$/i.test(trimmed)) return false
      if (/^─+\s*Worked for\s+\d+/i.test(trimmed)) return false
      return true
    })
    .join('\n')
    .trim()
    .replace(/^•\s+/, '')
}

/** Reduce a provider transcript to the final user-facing assistant response. */
export function formatOrchestratorOutput(rawOutput: string): string {
  const clean = stripAnsi(rawOutput || '').replace(/\r/g, '').trim()
  if (!clean) return ''

  if (SEPARATOR_LINE.test(clean)) {
    const segments = clean
      .split(/^\s*─{20,}\s*$/m)
      .map(sanitizeResponseBlock)
      .filter(Boolean)
    if (segments.length > 1) return segments[segments.length - 1]
  }

  const lines = clean.split('\n')
  let lastToolCall = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (TOOL_CALL_LINE.test(lines[index])) lastToolCall = index
  }

  if (lastToolCall >= 0) {
    const finalStart = lines.findIndex((line, index) => index > lastToolCall && /^•\s+(?!Called\b)/.test(line))
    if (finalStart < 0) return ''
    return sanitizeResponseBlock(lines.slice(finalStart).join('\n'))
  }

  return sanitizeResponseBlock(clean)
}

interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface StoredChat {
  messages: StoredChatMessage[]
  lastOutput: string
}

let sequence = 0
export function nextChatId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}-${Date.now().toString(36)}`
}

function storageKey(sessionName: string): string {
  return `${STORAGE_KEYS.sessionChat}${sessionName}`
}

/** Load prior chat history for `sessionName`, assigning a monotonic synthetic `ts` (array order preserved). */
export function loadStoredChat(sessionName: string): { entries: ChatEntry[]; lastOutput: string } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(sessionName)) || '{}') as Partial<StoredChat>
    const raw = Array.isArray(parsed.messages)
      ? parsed.messages.filter(
          (m: unknown): m is StoredChatMessage =>
            !!m &&
            typeof (m as StoredChatMessage).id === 'string' &&
            ['user', 'assistant', 'system'].includes((m as StoredChatMessage).role) &&
            typeof (m as StoredChatMessage).content === 'string',
        )
      : []
    const cleaned = raw
      .map(m => (m.role === 'assistant' ? { ...m, content: formatOrchestratorOutput(m.content) } : m))
      .filter(m => m.content.length > 0)
      .slice(-100)
    const baseTs = Date.now() - cleaned.length * 1000
    const entries: ChatEntry[] = cleaned.map((m, i) => ({ ...m, ts: baseTs + i * 1000 }))
    return { entries, lastOutput: typeof parsed.lastOutput === 'string' ? parsed.lastOutput : '' }
  } catch {
    return { entries: [], lastOutput: '' }
  }
}

export function saveStoredChat(sessionName: string, entries: ChatEntry[], lastOutput: string): void {
  try {
    const messages: StoredChatMessage[] = entries.slice(-100).map(({ id, role, content }) => ({ id, role, content }))
    window.localStorage.setItem(storageKey(sessionName), JSON.stringify({ messages, lastOutput }))
  } catch {
    // Chat remains usable in-memory even when storage is disabled or full.
  }
}
