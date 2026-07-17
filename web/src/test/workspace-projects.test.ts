import { describe, expect, it } from 'vitest'
import {
  addGroup,
  addProject,
  emptyProjectsData,
  groupContextLine,
  listProjectTargets,
  matchWorkingDirectoryToProject,
  removeGroup,
  removeProject,
  togglePinned,
} from '../features/workspace/projects'

describe('projects: group/session mapping (spec §1)', () => {
  const base = addGroup(emptyProjectsData(), {
    name: '알람 솔루션',
    root: '~/work/alarm-solution',
    children: [
      { name: 'alarm-console', path: '~/work/alarm-solution/web' },
      { name: 'alarm-engine', path: '~/work/alarm-solution/engine' },
    ],
  })
  const withStandalone = addProject(base, { name: 'hanwha-portal', path: '~/work/hanwha-portal' })

  it('maps a working directory that exactly matches a group child', () => {
    const match = matchWorkingDirectoryToProject('~/work/alarm-solution/web', withStandalone)
    expect(match.label).toBe('알람 솔루션 · alarm-console')
    expect(match.groupId).toBe(base.groups[0].id)
  })

  it('maps a working directory that exactly matches the group root itself', () => {
    const match = matchWorkingDirectoryToProject('~/work/alarm-solution', withStandalone)
    expect(match.label).toBe('알람 솔루션 · 그룹 루트')
  })

  it('maps a working directory nested under a group root but not a registered child to the group name', () => {
    const match = matchWorkingDirectoryToProject('~/work/alarm-solution/docs', withStandalone)
    expect(match.label).toBe('알람 솔루션')
  })

  it('maps a standalone project by exact path', () => {
    const match = matchWorkingDirectoryToProject('~/work/hanwha-portal', withStandalone)
    expect(match.label).toBe('hanwha-portal')
  })

  it('falls back to "기타" for an unrelated or missing working directory — never guesses', () => {
    expect(matchWorkingDirectoryToProject('~/work/unrelated-project', withStandalone).label).toBe('기타')
    expect(matchWorkingDirectoryToProject(null, withStandalone).label).toBe('기타')
    expect(matchWorkingDirectoryToProject(undefined, withStandalone).label).toBe('기타')
  })

  it('is tolerant of a trailing slash on either side of the comparison', () => {
    const match = matchWorkingDirectoryToProject('~/work/alarm-solution/web/', withStandalone)
    expect(match.label).toBe('알람 솔루션 · alarm-console')
  })

  it('lists group root + children + standalone projects as New-Task target options', () => {
    const targets = listProjectTargets(withStandalone)
    expect(targets.map(t => t.label)).toEqual([
      '알람 솔루션 · 그룹 루트',
      'alarm-console · 알람 솔루션',
      'alarm-engine · 알람 솔루션',
      'hanwha-portal',
    ])
    expect(targets.find(t => t.kind === 'group-root')?.path).toBe('~/work/alarm-solution')
  })

  it('builds the group-root context line listing every sub-project path (spec §2)', () => {
    const line = groupContextLine(base.groups[0])
    expect(line).toContain('알람 솔루션')
    expect(line).toContain('alarm-console(~/work/alarm-solution/web)')
    expect(line).toContain('alarm-engine(~/work/alarm-solution/engine)')
  })

  it('toggles a session in/out of the pinned list idempotently', () => {
    const pinned = togglePinned(withStandalone, 'session-a')
    expect(pinned.pinned).toEqual(['session-a'])
    const unpinned = togglePinned(pinned, 'session-a')
    expect(unpinned.pinned).toEqual([])
  })

  it('removeProject/removeGroup drop only the targeted entry', () => {
    const withoutStandalone = removeProject(withStandalone, withStandalone.projects[0].id)
    expect(withoutStandalone.projects).toHaveLength(0)
    expect(withoutStandalone.groups).toHaveLength(1)

    const withoutGroup = removeGroup(withStandalone, base.groups[0].id)
    expect(withoutGroup.groups).toHaveLength(0)
    expect(withoutGroup.projects).toHaveLength(1)
  })
})
