import { describe, expect, it } from 'vitest'
import { filterSlashCommands, isSlashCommandProvider } from '../features/workspace/slashCommands'
import type { SlashCommandInfo } from '../api.ui'

function cmd(overrides: Partial<SlashCommandInfo> & { name: string }): SlashCommandInfo {
  return { scope: 'builtin', kind: 'command', description: null, interactive: false, ...overrides }
}

describe('isSlashCommandProvider (spec §2e — unsupported provider hides the feature entirely)', () => {
  it('accepts exactly claude_code and codex', () => {
    expect(isSlashCommandProvider('claude_code')).toBe(true)
    expect(isSlashCommandProvider('codex')).toBe(true)
  })

  it('rejects every other value, including null/undefined/empty', () => {
    expect(isSlashCommandProvider('kiro_cli')).toBe(false)
    expect(isSlashCommandProvider(null)).toBe(false)
    expect(isSlashCommandProvider(undefined)).toBe(false)
    expect(isSlashCommandProvider('')).toBe(false)
  })
})

describe('filterSlashCommands (spec §2e — "startsWith→includes 순 정렬")', () => {
  const commands = [
    cmd({ name: '/compact', description: 'Compact the conversation' }),
    cmd({ name: '/recompact', scope: 'user', description: 'only matches "comp" via includes' }),
    cmd({ name: '/clear' }),
    cmd({ name: '/model', interactive: true }),
    cmd({ name: '/my-skill', scope: 'user', kind: 'skill' }),
  ]

  it('returns the full list, unfiltered, for an empty query', () => {
    expect(filterSlashCommands(commands, '')).toEqual(commands)
    expect(filterSlashCommands(commands, '   ')).toEqual(commands)
  })

  it('puts every startsWith match before every includes-only match', () => {
    const result = filterSlashCommands(commands, 'comp')
    expect(result.map(c => c.name)).toEqual(['/compact', '/recompact'])
  })

  it('drops commands matching neither startsWith nor includes', () => {
    const result = filterSlashCommands(commands, 'zzz')
    expect(result).toEqual([])
  })

  it('matches against the name with its leading "/" stripped, case-insensitively', () => {
    expect(filterSlashCommands(commands, 'CLEAR').map(c => c.name)).toEqual(['/clear'])
    expect(filterSlashCommands(commands, '/clear').map(c => c.name)).toEqual([]) // query itself isn't slash-stripped — a literal "/" never appears in a bare name
  })

  it('preserves each group\'s original relative order (server order: builtins first)', () => {
    const reordered = [commands[3], commands[0], commands[1]] // model, compact, recompact
    const result = filterSlashCommands(reordered, 'c')
    // 'model' doesn't match 'c' at all; compact/recompact both startsWith 'c', in their given order.
    expect(result.map(c => c.name)).toEqual(['/compact', '/recompact'])
  })
})
