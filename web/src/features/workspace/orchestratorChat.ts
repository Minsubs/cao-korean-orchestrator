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
const ACTIVE_PROGRESS_LINE = /^\s*•.*\((?:(?:\d+h\s+)?(?:\d+m\s+)?)\d+s\s*•\s*esc to interrupt\)\s*$/m
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
      // 도구 결과 continuation ("  └ {...}") 및 단독 도구 metadata JSON 라인
      if (/^└/.test(trimmed)) return false
      if (/^\{.*"(?:terminal_id|sender_id|message_id|thread_id|agent_id|success)"\s*:.*\}$/.test(trimmed)) return false
      // 도구 호출 불릿
      if (/^•\s*Called\b/.test(trimmed)) return false
      // 단독 내부 마커 (대문자+숫자+밑줄로만 이뤄진 토큰 1~수개; 공백 외 다른 문자 없음)
      if (/^[A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]*)*$/.test(trimmed) && /_/.test(trimmed)) return false
      // 내부 상태 나레이션 (오케스트레이션 전용 문구)
      if (/(콜백.*(대기|기다|전달)|assign.*접수|완료(로| 처리).*(간주|하지 않)|워커.*(생성 여부|콜백)|응답을 회수)/.test(trimmed)) return false
      // 재할당/메시지 도착은 흔한 단어 — 불릿 나레이션 라인에서만 제거 (과다 제거 방지)
      if (/^[•\-*]/.test(trimmed) && /(재할당|메시지 도착)/.test(trimmed)) return false
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
  if (ACTIVE_PROGRESS_LINE.test(clean)) return ''

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
    if (finalStart >= 0) return sanitizeResponseBlock(lines.slice(finalStart).join('\n'))
    // 최종 답변이 불릿이 아닌 평범한 산문일 때: 전체를 버리지 않고 마지막 도구호출 이후를 정리해 보존 (과다 제거 방지).
    // 도구호출만 있고 실제 답변이 아직 없으면 정리 결과가 비어 '' 반환 → WAITING 유지.
    return sanitizeResponseBlock(lines.slice(lastToolCall + 1).join('\n'))
  }

  return sanitizeResponseBlock(clean)
}

interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  targetId?: string
  raw?: string
}

interface StoredChat {
  messages: StoredChatMessage[]
  workspaceMessages?: StoredChatMessage[]
  lastOutput: string
  workspacePendingReply?: WorkspacePendingReply | null
}

export interface WorkspacePendingReply {
  messageId: string
  baseline: string
  terminalId: string
  baselineGenerations: Record<string, number>
  baselineInboxMessageId: number
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
export function loadStoredChat(sessionName: string): {
  entries: ChatEntry[]
  lastOutput: string
  pendingReply: WorkspacePendingReply | null
} {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(sessionName)) || '{}') as Partial<StoredChat>
    const sourceMessages = Array.isArray(parsed.workspaceMessages) ? parsed.workspaceMessages : parsed.messages
    const raw = Array.isArray(sourceMessages)
      ? sourceMessages.filter(
          (m: unknown): m is StoredChatMessage =>
            !!m &&
            typeof (m as StoredChatMessage).id === 'string' &&
            ['user', 'assistant', 'system'].includes((m as StoredChatMessage).role) &&
            typeof (m as StoredChatMessage).content === 'string' &&
            ((m as StoredChatMessage).targetId === undefined || typeof (m as StoredChatMessage).targetId === 'string'),
        )
      : []
    const cleaned = raw
      .map(m => (m.role === 'assistant' ? { ...m, raw: (m as StoredChatMessage).raw ?? m.content, content: formatOrchestratorOutput((m as StoredChatMessage).raw ?? m.content) } : m))
      .filter(m => m.content.length > 0)
      .slice(-100)
    const baseTs = Date.now() - cleaned.length * 1000
    const entries: ChatEntry[] = cleaned.map((m, i) => ({ ...m, ts: baseTs + i * 1000 }))
    const pending = parsed.workspacePendingReply
    const validGenerations = !!pending?.baselineGenerations
      && typeof pending.baselineGenerations === 'object'
      && !Array.isArray(pending.baselineGenerations)
      && Object.values(pending.baselineGenerations).every(value => (
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      ))
    const pendingReply = pending
      && typeof pending.messageId === 'string'
      && typeof pending.baseline === 'string'
      && typeof pending.terminalId === 'string'
      && validGenerations
      && typeof pending.baselineInboxMessageId === 'number'
      && Number.isFinite(pending.baselineInboxMessageId)
      && pending.baselineInboxMessageId >= 0
      && entries.some(entry => entry.id === pending.messageId && entry.role === 'assistant')
      ? pending as WorkspacePendingReply
      : null
    return {
      entries,
      lastOutput: typeof parsed.lastOutput === 'string' ? parsed.lastOutput : '',
      pendingReply,
    }
  } catch {
    return { entries: [], lastOutput: '', pendingReply: null }
  }
}

export function saveStoredChat(
  sessionName: string,
  entries: ChatEntry[],
  lastOutput: string,
  pendingReply: WorkspacePendingReply | null,
): void {
  try {
    const existing = JSON.parse(window.localStorage.getItem(storageKey(sessionName)) || '{}') as Record<string, unknown>
    const workspaceMessages: StoredChatMessage[] = entries
      .slice(-100)
      .map(({ id, role, content, targetId, raw }) => ({ id, role, content, ...(targetId ? { targetId } : {}), ...(raw ? { raw } : {}) }))
    const messages = workspaceMessages.filter(message => !message.targetId)
    window.localStorage.setItem(storageKey(sessionName), JSON.stringify({
      ...existing,
      messages,
      workspaceMessages,
      lastOutput,
      workspacePendingReply: pendingReply,
    }))
  } catch {
    // Chat remains usable in-memory even when storage is disabled or full.
  }
}
