import { describe, expect, it } from 'vitest'
import { formatOrchestratorOutput } from '../features/workspace/orchestratorChat'
import pane from './fixtures/codex-final-report-pane.json'

// 실측 회귀: 오케스트레이터의 완료 보고가 채팅에 안 뜨던 문제.
//
// Reported from the live server: a long multi-agent run showed the 배정 cards but
// never a completion report. The orchestrator HAD produced one — a 7/8 result
// table plus the reason the eighth failed — so the loss was on the extraction
// side, not the agent's.
//
// The fixture is the byte-exact `GET /terminals/{id}/output?mode=last` payload
// captured from that very session (codex TUI, ANSI intact), which is the same
// bytes the chat feeds to formatOrchestratorOutput. Hand-written samples are what
// let this slip: they never carried the TUI's trailing composer redraw.
const raw = (pane as { output: string }).output

describe('formatOrchestratorOutput on a real codex completion turn', () => {
  const reply = formatOrchestratorOutput(raw)

  it('returns the completion report', () => {
    expect(reply).toContain('7/8')
    expect(reply).toContain('크로스 응답 테스트 결과')
  })

  it('keeps the per-profile result table the report is built around', () => {
    expect(reply).toContain('claude_scout_haiku')
    expect(reply).toContain('documentation-writer')
  })

  it('drops the table rules that made the reply look broken in the bubble', () => {
    // This is what the user saw: the codex TUI drew the report as a table, so the
    // chat showed rows of ━━━━━ and ─────  ──────. The bubble is
    // whitespace-pre-wrap, so the column alignment still reads correctly once the
    // rules are gone — they were pure noise.
    expect(reply).not.toMatch(/[─-╿]/)
    // …and the rows they separated must survive the removal.
    expect(reply).toMatch(/claude_scout_haiku\s+정상/)
    expect(reply).toMatch(/documentation-writer\s+실패/)
  })

  it('keeps the explanation of the one failure', () => {
    // The actionable half of the report. Dropping it would leave the user with a
    // bare "7/8" and no idea what broke.
    expect(reply).toContain('스키마 검증')
  })

  it('strips the provider status bar wherever the capture puts it', () => {
    // Reported verbatim from the live chat: the reply contained
    //   gpt-5.6-sol high fast · ~/…/k8s-access-control · Context 28% used · weekly 30% left · Fast on · Read Only
    // The redraw lands at different offsets depending on when the pane is read, so
    // the line must be recognised by content — including when it opens the block,
    // which is where the user found it.
    const withStatusBar = [
      'gpt-5.6-sol high fast · ~/hunesion_workspace/AI_Rule · Context 28% used · weekly 30% left · Fast on · Read Only',
      '',
      '• 크로스 응답 테스트 결과: 7/8 정상입니다.',
      '  codex_docs_luna            정상',
    ].join('\n')
    const cleaned = formatOrchestratorOutput(withStatusBar)
    expect(cleaned).toContain('7/8')
    expect(cleaned).not.toContain('Context 28% used')
    expect(cleaned).not.toContain('gpt-5.6-sol')
  })

  it('keeps a sentence that merely mentions a status word', () => {
    // The status-bar rule keys on the `·` separated readout, so ordinary prose
    // containing the same words must survive.
    const prose = '이 작업 디렉터리는 Read Only 상태라 파일을 바꾸지 않았습니다.'
    expect(formatOrchestratorOutput(prose)).toContain('Read Only')
  })

  it('does not leak the TUI chrome into the reply', () => {
    // The pane's trailing redraw carries the composer placeholder and the status
    // line; both sit after the last separator, so a "take the final segment"
    // rule can pick them up instead of the answer.
    expect(reply).not.toContain('Run /review')
    expect(reply).not.toContain('Context 28% used')
    expect(reply).not.toContain('esc to interrupt')
  })

  it('drops the tool-call and plan bookkeeping that preceded the report', () => {
    expect(reply).not.toContain('delete_terminal')
    expect(reply).not.toContain('Updated Plan')
  })
})
