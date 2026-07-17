import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWorkbenchContext, saveWorkbenchContext } from '../features/workspace/workbenchContext'

describe('workbenchContext (feedback #14)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('returns null when nothing is stored for a session', () => {
    expect(loadWorkbenchContext('sess-1')).toBeNull()
  })

  it('round-trips a saved context for its own session key', () => {
    saveWorkbenchContext('sess-1', { terminalId: 'aaaaaaaa', tab: 'output' })
    expect(loadWorkbenchContext('sess-1')).toEqual({ terminalId: 'aaaaaaaa', tab: 'output' })
    expect(window.localStorage.getItem('cao:workbench:v1:sess-1')).not.toBeNull()
  })

  it('keeps each session isolated under its own key', () => {
    saveWorkbenchContext('sess-1', { terminalId: 'aaaaaaaa', tab: 'term' })
    saveWorkbenchContext('sess-2', { terminalId: 'bbbbbbbb', tab: 'inbox' })
    expect(loadWorkbenchContext('sess-1')).toEqual({ terminalId: 'aaaaaaaa', tab: 'term' })
    expect(loadWorkbenchContext('sess-2')).toEqual({ terminalId: 'bbbbbbbb', tab: 'inbox' })
  })

  it('degrades an invalid stored tab to "term" instead of throwing', () => {
    window.localStorage.setItem('cao:workbench:v1:sess-1', JSON.stringify({ terminalId: 'aaaaaaaa', tab: 'not-a-real-tab' }))
    expect(loadWorkbenchContext('sess-1')).toEqual({ terminalId: 'aaaaaaaa', tab: 'term' })
  })

  it('degrades corrupt JSON to null rather than throwing', () => {
    window.localStorage.setItem('cao:workbench:v1:sess-1', '{not json')
    expect(loadWorkbenchContext('sess-1')).toBeNull()
  })

  it('degrades a missing terminalId to null', () => {
    window.localStorage.setItem('cao:workbench:v1:sess-1', JSON.stringify({ tab: 'term' }))
    expect(loadWorkbenchContext('sess-1')).toBeNull()
  })
})
