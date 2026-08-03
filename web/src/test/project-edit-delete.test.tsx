/**
 * Editing and deleting projects/groups from the sidebar.
 *
 * The data layer had `removeProject`/`removeGroup` from the start and nothing
 * ever called them; there was no rename at all. These cover both the pure
 * operations and the sidebar affordances that reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import {
  addGroup,
  addProject,
  emptyProjectsData,
  matchWorkingDirectoryToProject,
  removeGroup,
  removeProject,
  updateGroup,
  updateProject,
} from '../features/workspace/projects'
import { ProjectEditModal } from '../features/workspace/ProjectEditModal'

const base = addGroup(emptyProjectsData(), {
  name: '알람 솔루션',
  root: '/work/alarm',
  children: [
    { name: 'console', path: '/work/alarm/web' },
    { name: 'engine', path: '/work/alarm/engine' },
  ],
})
const data = addProject(base, { name: 'portal', path: '/work/portal' })
const groupId = data.groups[0]!.id
const childId = data.groups[0]!.children[0]!.id
const projectId = data.projects[0]!.id

describe('updateProject', () => {
  it('renames a standalone project', () => {
    const next = updateProject(data, projectId, { name: 'portal-v2', path: '/work/portal-v2' })
    expect(next.projects[0]).toMatchObject({ name: 'portal-v2', path: '/work/portal-v2' })
  })

  it('finds a project nested in a group', () => {
    // The caller only has an id and should not need to know which list it is in.
    const next = updateProject(data, childId, { name: 'console-web', path: '/work/alarm/console' })
    expect(next.groups[0]!.children[0]).toMatchObject({ name: 'console-web', path: '/work/alarm/console' })
  })

  it('keeps the id, so sessions stay mapped', () => {
    const next = updateProject(data, projectId, { name: 'renamed', path: '/work/renamed' })
    expect(next.projects[0]!.id).toBe(projectId)
  })

  it('leaves everything else untouched', () => {
    const next = updateProject(data, projectId, { name: 'renamed', path: '/work/renamed' })
    expect(next.groups).toEqual(data.groups)
  })
})

describe('updateGroup', () => {
  it('renames the group and moves its root', () => {
    const next = updateGroup(data, groupId, { name: '알람', root: '/srv/alarm' })
    expect(next.groups[0]).toMatchObject({ name: '알람', root: '/srv/alarm' })
  })

  it('does not rewrite child paths under the new root', () => {
    // A child can live outside the root; deriving paths from it would silently
    // break those.
    const next = updateGroup(data, groupId, { name: '알람', root: '/srv/alarm' })
    expect(next.groups[0]!.children.map(c => c.path)).toEqual(['/work/alarm/web', '/work/alarm/engine'])
  })
})

describe('delete', () => {
  it('removes a standalone project', () => {
    expect(removeProject(data, projectId).projects).toHaveLength(0)
  })

  it('removes a project nested in a group', () => {
    expect(removeGroup(data, groupId).groups).toHaveLength(0)
    expect(removeProject(data, childId).groups[0]!.children).toHaveLength(1)
  })

  it('leaves sessions mapped to a deleted project as 기타, not a stale name', () => {
    // The mapping is derived, so a removed project simply stops matching.
    const after = removeProject(data, projectId)
    expect(matchWorkingDirectoryToProject('/work/portal', after).label).toBe('기타')
  })

  it('drops a group\'s children with it', () => {
    const after = removeGroup(data, groupId)
    expect(matchWorkingDirectoryToProject('/work/alarm/web', after).label).toBe('기타')
  })
})

describe('ProjectEditModal', () => {
  beforeEach(() => {
    delete (window as { caoNative?: unknown }).caoNative
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens pre-filled with the current values', () => {
    render(
      <ProjectEditModal
        target={{ kind: 'project', id: projectId, name: 'portal', path: '/work/portal' }}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(screen.getByLabelText('이름')).toHaveValue('portal')
    expect(screen.getByLabelText('폴더 경로')).toHaveValue('/work/portal')
  })

  it('saves trimmed values', () => {
    const onSave = vi.fn()
    render(
      <ProjectEditModal
        target={{ kind: 'project', id: projectId, name: 'portal', path: '/work/portal' }}
        onClose={() => {}}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '  portal-v2  ' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(onSave).toHaveBeenCalledWith({ name: 'portal-v2', path: '/work/portal' })
  })

  it('refuses to save an empty name', () => {
    const onSave = vi.fn()
    render(
      <ProjectEditModal
        target={{ kind: 'project', id: projectId, name: 'portal', path: '/work/portal' }}
        onClose={() => {}}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('says a group edit leaves child paths alone', async () => {
    // Otherwise a user reasonably assumes moving the root moves the children.
    render(
      <ProjectEditModal
        target={{ kind: 'group', id: groupId, name: '알람 솔루션', path: '/work/alarm' }}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    expect(await screen.findByText(/하위 프로젝트의 경로는 그대로 유지/)).toBeInTheDocument()
    expect(screen.getByLabelText('그룹 루트 경로')).toHaveValue('/work/alarm')
  })

  it('takes a folder from the picker', async () => {
    // Desktop app path: the native dialog returns the chosen folder.
    ;(window as { caoNative?: unknown }).caoNative = {
      pickDirectory: vi.fn().mockResolvedValue('/work/picked'),
    }
    render(
      <ProjectEditModal
        target={{ kind: 'project', id: projectId, name: 'portal', path: '/work/portal' }}
        onClose={() => {}}
        onSave={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /찾아보기/ }))

    await waitFor(() => expect(screen.getByLabelText('폴더 경로')).toHaveValue('/work/picked'))
  })

  it('closes without saving on 취소', () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    render(
      <ProjectEditModal
        target={{ kind: 'project', id: projectId, name: 'portal', path: '/work/portal' }}
        onClose={onClose}
        onSave={onSave}
      />
    )

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }))

    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('Sidebar wiring', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'cao:projects:v1',
      JSON.stringify({
        groups: [
          {
            id: 'g1',
            name: '알람 솔루션',
            root: '/work/alarm',
            children: [{ id: 'c1', name: 'console', path: '/work/alarm/web' }],
          },
        ],
        projects: [{ id: 'p1', name: 'portal', path: '/work/portal' }],
        pinned: [],
      })
    )
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  async function renderSidebar() {
    const { Sidebar } = await import('../features/workspace/Sidebar')
    return render(
      <Sidebar
        collapsed={false}
        onToggleCollapsed={() => {}}
        activeSessionId={null}
        onSelectSession={() => {}}
        onNewTask={() => {}}
      />
    )
  }

  it('offers edit and delete on every project and group', async () => {
    // The data layer had remove* from the start; nothing in the UI called it.
    await renderSidebar()

    expect(await screen.findByRole('button', { name: 'portal 편집' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'portal 삭제' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '알람 솔루션 편집' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'console 삭제' })).toBeInTheDocument()
  })

  it('persists a rename', async () => {
    await renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: 'portal 편집' }))
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'portal-v2' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByText('portal-v2')).toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem('cao:projects:v1') ?? '{}').projects[0].name).toBe('portal-v2')
  })

  it('asks before deleting, and says what survives', async () => {
    // Only the list entry goes; the folder and any sessions stay.
    await renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: 'portal 삭제' }))

    expect(await screen.findByText('프로젝트를 삭제할까요?')).toBeInTheDocument()
    expect(screen.getByText(/폴더와 세션은 그대로/)).toBeInTheDocument()
  })

  it('keeps the project when the confirmation is dismissed', async () => {
    await renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: 'portal 삭제' }))
    fireEvent.click(await screen.findByRole('button', { name: '취소' }))

    expect(screen.getByText('portal')).toBeInTheDocument()
  })

  it('deletes on confirmation and persists it', async () => {
    await renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: 'portal 삭제' }))
    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))

    await waitFor(() => expect(screen.queryByText('portal')).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem('cao:projects:v1') ?? '{}').projects).toHaveLength(0)
  })

  it('warns how many children a group takes with it', async () => {
    await renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: '알람 솔루션 삭제' }))

    expect(await screen.findByText('그룹을 삭제할까요?')).toBeInTheDocument()
    expect(screen.getByText('1개')).toBeInTheDocument()
  })
})
