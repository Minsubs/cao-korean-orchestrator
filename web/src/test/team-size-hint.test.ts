import { describe, expect, it } from 'vitest'
import { SLOW_TEAM_THRESHOLD, teamSizeHint } from '../features/workspace/teamSizeHint'

// User-reported: picking many agents made the first answer take a very long time
// (one run had scout + architect + developer, and the architect alone ran 9m50s),
// and the modal never said that would happen. The default is the whole 기본 팀, so
// most users hit the slow path without choosing it.

describe('teamSizeHint', () => {
  it('says the orchestrator handles it alone when nothing is delegated', () => {
    const hint = teamSizeHint(0)
    expect(hint.slow).toBe(false)
    expect(hint.text).toContain('직접 처리')
    expect(hint.text).toContain('빨리')
  })

  it('stays calm for one delegate', () => {
    const hint = teamSizeHint(1)
    expect(hint.slow).toBe(false)
    expect(hint.text).toContain('1개 역할')
  })

  it('names the count without warning below the slow threshold', () => {
    const hint = teamSizeHint(SLOW_TEAM_THRESHOLD - 1)
    expect(hint.slow).toBe(false)
    expect(hint.text).toContain(`${SLOW_TEAM_THRESHOLD - 1}개 역할`)
    expect(hint.text).not.toContain('몇 분')
  })

  it('warns about the wait once the team is large', () => {
    const hint = teamSizeHint(7)
    expect(hint.slow).toBe(true)
    expect(hint.text).toContain('7개 역할')
    expect(hint.text).toContain('몇 분')
  })

  it('treats the threshold itself as slow', () => {
    expect(teamSizeHint(SLOW_TEAM_THRESHOLD).slow).toBe(true)
  })

  it('never promises a specific duration it cannot know', () => {
    for (const n of [0, 1, 2, 3, 7, 20]) {
      // "몇 분 이상 걸릴 수 있어요" is a floor, not a claim — no exact ETA anywhere.
      expect(teamSizeHint(n).text).not.toMatch(/\d+\s*분\s*(안|내)/)
    }
  })

  it('tolerates a negative count without inventing a team', () => {
    expect(teamSizeHint(-1).text).toContain('직접 처리')
  })
})
