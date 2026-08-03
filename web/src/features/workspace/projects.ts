// Project/group sidebar data model — persisted client-side only
// (`localStorage['cao:projects:v1']`). The backend has no concept of
// "projects" or "groups"; this is a pure UI convenience layer that maps CAO
// sessions onto folders the user tells it about (§ui-refactor-plan.md #6:
// "백엔드 무변경 — UI 데이터 모델 + localStorage").
import { STORAGE_KEYS } from './constants'
import type { ProjectGroup, ProjectRef, ProjectsData, ProjectTargetOption } from './types'

export function emptyProjectsData(): ProjectsData {
  return { groups: [], projects: [], pinned: [] }
}

function isProjectRef(value: unknown): value is ProjectRef {
  const v = value as ProjectRef
  return !!v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.path === 'string'
}

function isProjectGroup(value: unknown): value is ProjectGroup {
  const v = value as ProjectGroup
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.root === 'string' &&
    Array.isArray(v.children) &&
    v.children.every(isProjectRef)
  )
}

/** Parse + validate localStorage content; unreadable/invalid data degrades to empty (never throws). */
export function loadProjectsData(): ProjectsData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.projects)
    if (!raw) return emptyProjectsData()
    const parsed = JSON.parse(raw)
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.filter(isProjectGroup) : []
    const projects = Array.isArray(parsed?.projects) ? parsed.projects.filter(isProjectRef) : []
    const pinned = Array.isArray(parsed?.pinned) ? parsed.pinned.filter((p: unknown) => typeof p === 'string') : []
    return { groups, projects, pinned }
  } catch {
    return emptyProjectsData()
  }
}

export function saveProjectsData(data: ProjectsData): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(data))
  } catch {
    // Best-effort persistence — the sidebar remains usable for the session even if storage is full/disabled.
  }
}

export function generateId(prefix: string): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return `${prefix}-${g.crypto.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function addProject(data: ProjectsData, input: { name: string; path: string; groupId?: string }): ProjectsData {
  const project: ProjectRef = { id: generateId('proj'), name: input.name, path: input.path }
  if (input.groupId) {
    return {
      ...data,
      groups: data.groups.map(g => (g.id === input.groupId ? { ...g, children: [...g.children, project] } : g)),
    }
  }
  return { ...data, projects: [...data.projects, project] }
}

export function addGroup(
  data: ProjectsData,
  input: { name: string; root: string; children: { name: string; path: string }[] },
): ProjectsData {
  const group: ProjectGroup = {
    id: generateId('group'),
    name: input.name,
    root: input.root,
    children: input.children.map(c => ({ id: generateId('proj'), name: c.name, path: c.path })),
  }
  return { ...data, groups: [...data.groups, group] }
}

/**
 * Rename a project and/or move it to a different folder.
 *
 * Looks in both places a project can live — standalone and inside a group —
 * because the caller only has an id and should not have to know which.
 */
export function updateProject(
  data: ProjectsData,
  projectId: string,
  input: { name: string; path: string },
): ProjectsData {
  const apply = (project: ProjectRef): ProjectRef =>
    project.id === projectId ? { ...project, name: input.name, path: input.path } : project
  return {
    ...data,
    projects: data.projects.map(apply),
    groups: data.groups.map(group => ({ ...group, children: group.children.map(apply) })),
  }
}

/**
 * Rename a group and/or point it at a different root.
 *
 * Children keep their own paths: a group's root is a label for where the group
 * starts, not a prefix the children are derived from, so rewriting them would
 * silently break projects that live outside the new root.
 */
export function updateGroup(
  data: ProjectsData,
  groupId: string,
  input: { name: string; root: string },
): ProjectsData {
  return {
    ...data,
    groups: data.groups.map(group =>
      group.id === groupId ? { ...group, name: input.name, root: input.root } : group,
    ),
  }
}

export function removeProject(data: ProjectsData, projectId: string): ProjectsData {
  return {
    ...data,
    projects: data.projects.filter(p => p.id !== projectId),
    groups: data.groups.map(g => ({ ...g, children: g.children.filter(c => c.id !== projectId) })),
  }
}

export function removeGroup(data: ProjectsData, groupId: string): ProjectsData {
  return { ...data, groups: data.groups.filter(g => g.id !== groupId) }
}

export function togglePinned(data: ProjectsData, sessionName: string): ProjectsData {
  const pinned = data.pinned.includes(sessionName)
    ? data.pinned.filter(name => name !== sessionName)
    : [...data.pinned, sessionName]
  return { ...data, pinned }
}

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, '')
}

export interface ProjectMatch {
  label: string
  groupId?: string
  projectId?: string
}

/**
 * Map a terminal's working directory onto a known project/group. Exact
 * matches win; a path nested under a known group root falls back to the
 * group name. No match at all → "기타" (Other), never a guess.
 */
export function matchWorkingDirectoryToProject(workingDirectory: string | null | undefined, data: ProjectsData): ProjectMatch {
  if (!workingDirectory) return { label: '기타' }
  const wd = normalizePath(workingDirectory)

  for (const group of data.groups) {
    const root = normalizePath(group.root)
    for (const child of group.children) {
      if (normalizePath(child.path) === wd) return { label: `${group.name} · ${child.name}`, groupId: group.id, projectId: child.id }
    }
    if (root === wd) return { label: `${group.name} · 그룹 루트`, groupId: group.id }
  }
  for (const project of data.projects) {
    if (normalizePath(project.path) === wd) return { label: project.name, projectId: project.id }
  }
  for (const group of data.groups) {
    const root = normalizePath(group.root)
    if (root && wd.startsWith(`${root}/`)) return { label: group.name, groupId: group.id }
  }
  return { label: '기타' }
}

/** Flatten groups (root + children) and standalone projects into the New-Task target picker options. */
export function listProjectTargets(data: ProjectsData): ProjectTargetOption[] {
  const options: ProjectTargetOption[] = []
  for (const group of data.groups) {
    options.push({ key: `group:${group.id}:root`, label: `${group.name} · 그룹 루트`, path: group.root, kind: 'group-root', groupId: group.id })
    for (const child of group.children) {
      options.push({
        key: `group:${group.id}:child:${child.id}`,
        label: `${child.name} · ${group.name}`,
        path: child.path,
        kind: 'group-child',
        groupId: group.id,
      })
    }
  }
  for (const project of data.projects) {
    options.push({ key: `project:${project.id}`, label: project.name, path: project.path, kind: 'project' })
  }
  return options
}

/** One context line inserted ahead of the user's instruction when a group root is the target (spec §2). */
export function groupContextLine(group: ProjectGroup): string {
  const names = group.children.length > 0 ? group.children.map(c => `${c.name}(${c.path})`).join(', ') : '없음'
  return `[그룹 "${group.name}" 루트(${group.root})에서 시작 — 하위 프로젝트: ${names}]`
}

export function findGroupById(data: ProjectsData, groupId: string): ProjectGroup | undefined {
  return data.groups.find(g => g.id === groupId)
}
