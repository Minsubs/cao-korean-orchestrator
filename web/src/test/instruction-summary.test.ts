import { describe, expect, it } from 'vitest'
import { instructionSummary, stripInstructionPlumbing } from '../features/workspace/instructionSummary'

// User-reported: the 배정 line on a delegation card dumped the entire raw
// instruction — several hundred characters, including internal plumbing the user
// should never see ("[Assigned by terminal 75c0c44a … using send_message]",
// "[CAO Handoff] Supervisor terminal ID: …"). It has to read as a summary, with
// the full text available on demand.
//
// Fixtures below are the real strings observed on the live server, not invented.

const ASSIGNED = `배정: 최종 정확성/보안/릴리즈 리뷰 전용, 파일 수정 금지. 작업 디렉터리 /home/minsub57/hunesion_workspace/AI_Rule/i-oneNGS/k8s-access-control. 신규 \`i-oneNGS-for-K8s-통합설계.html\`을 기존 문서와 비교하라. 중점: (1) 핵심 설계 누락/왜곡/상충, (2) 확정·가정·제안·미결정 분류 정확성. finding은 severity, 파일 line, 근거, 최소 수정안으로 작성. HANDOFF/PROGRESS/커밋/외부 변경 금지. 150줄 이내 callback. [Assigned by terminal 75c0c44a. When done, send results back to terminal 75c0c44a using send_message]`

const HANDOFF = `[CAO Handoff] Supervisor terminal ID: 747b1186. This is a blocking handoff — the orchestrator will automatically capture your response when you finish. Complete the task and output your results directly. Do NOT use send_message to notify the supervisor unless explicitly needed — just do the work and present your deliverables. 테스트 확인용 단일 작업입니다. 최종 응답으로 정확히 다음 문자열만 회신하세요: PHASE2_LIVE_OK`

describe('stripInstructionPlumbing', () => {
  it('removes the trailing assign plumbing with its terminal ids', () => {
    const out = stripInstructionPlumbing(ASSIGNED)
    expect(out).not.toContain('Assigned by terminal')
    expect(out).not.toContain('send_message')
    expect(out).not.toContain('75c0c44a')
    expect(out).toContain('최종 정확성/보안/릴리즈 리뷰 전용')
  })

  it('removes the CAO Handoff preamble and keeps the actual task', () => {
    const out = stripInstructionPlumbing(HANDOFF)
    expect(out).not.toContain('[CAO Handoff]')
    expect(out).not.toContain('Supervisor terminal ID')
    expect(out).not.toContain('send_message')
    expect(out).toContain('테스트 확인용 단일 작업입니다')
  })

  it('collapses runaway whitespace and newlines into single spaces', () => {
    expect(stripInstructionPlumbing('첫 줄\n\n\n  둘째   줄')).toBe('첫 줄 둘째 줄')
  })

  it('leaves an ordinary instruction untouched', () => {
    expect(stripInstructionPlumbing('테스트를 돌려줘')).toBe('테스트를 돌려줘')
  })

  it('never returns only whitespace, even if the text was pure plumbing', () => {
    const out = stripInstructionPlumbing('[Assigned by terminal abcdef12. When done, send results back to terminal abcdef12 using send_message]')
    expect(out).toBe('')
  })
})

describe('instructionSummary', () => {
  it('shortens a long instruction and marks that it was shortened', () => {
    const { text, truncated } = instructionSummary(ASSIGNED)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThan(140)
    expect(text.endsWith('…')).toBe(true)
    // The opening of the real instruction survives — that is the useful part.
    expect(text).toContain('최종 정확성/보안/릴리즈 리뷰 전용')
  })

  it('does not mark a short instruction as truncated', () => {
    const { text, truncated } = instructionSummary('테스트를 돌려줘')
    expect(truncated).toBe(false)
    expect(text).toBe('테스트를 돌려줘')
  })

  it('cuts on a word boundary rather than mid-word', () => {
    const long = `${'가나다라마바사아자차 '.repeat(30)}끝`
    const { text } = instructionSummary(long)
    expect(text.endsWith('…')).toBe(true)
    // The kept body must be a prefix of the original that ends exactly where a
    // space was — i.e. a whole token, never a sliced one.
    const body = text.slice(0, -1)
    expect(long.startsWith(body)).toBe(true)
    expect(long[body.length]).toBe(' ')
  })

  it('reports nothing to show when the instruction was pure plumbing', () => {
    const { text, truncated } = instructionSummary('[Assigned by terminal abcdef12. When done, send results back to terminal abcdef12 using send_message]')
    expect(text).toBe('')
    expect(truncated).toBe(false)
  })

  it('handles null/undefined without throwing', () => {
    expect(instructionSummary(null).text).toBe('')
    expect(instructionSummary(undefined).text).toBe('')
  })
})
