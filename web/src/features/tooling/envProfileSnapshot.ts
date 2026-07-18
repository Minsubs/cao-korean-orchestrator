import { api } from '../../api'
import type { AgentProfileInfoWithModel } from '../../api.profiles'
import { toolingApi } from '../../api.tooling'

export const ENV_SNAPSHOT_SCHEMA = 'cao-env-profile/v1' as const

export interface EnvExtensionSummaryItem {
  kind: string
  name: string
  scope?: string
}

export interface EnvAgentProfileSummary {
  name: string
  provider: string | null
  model: string | null
}

export interface EnvCliVersionSummary {
  name: string
  display_name: string
  version: string | null
}

export interface EnvSnapshot {
  schema: typeof ENV_SNAPSHOT_SCHEMA
  captured_at: string
  label: string
  environment: unknown
  extensions_summary: EnvExtensionSummaryItem[]
  agent_profiles: EnvAgentProfileSummary[]
  inventory_counts: Record<string, Record<string, number>>
  /** Optional so previously saved/imported v1 snapshots remain valid. */
  cli_versions?: EnvCliVersionSummary[]
}

export type EnvSnapshotSection = 'environment' | 'providers' | 'extensions' | 'agent_profiles' | 'inventory'

export const ENV_SNAPSHOT_SECTIONS: EnvSnapshotSection[] = [
  'environment',
  'providers',
  'extensions',
  'agent_profiles',
  'inventory',
]

export const ENV_SNAPSHOT_SECTION_LABEL: Record<EnvSnapshotSection, string> = {
  environment: '/tooling/environment',
  providers: '/tooling/providers',
  extensions: '/tooling/extensions',
  agent_profiles: '/agents/profiles',
  inventory: '/env/inventory',
}

export function defaultSnapshotLabel(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

interface EnvInventoryCliEntry {
  cli: string
  counts: Record<string, number>
}

interface EnvInventoryAllResponse {
  clis: EnvInventoryCliEntry[]
}

async function fetchInventoryAll(): Promise<EnvInventoryAllResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch('/env/inventory?cli=all', { signal: controller.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as EnvInventoryAllResponse
  } finally {
    clearTimeout(timeout)
  }
}

export interface BuildSnapshotOutcome {
  snapshot: EnvSnapshot
  failedSections: EnvSnapshotSection[]
}

/** Assemble a snapshot from independent read-only sources. One failed source never hides the successful sections. */
export async function buildEnvSnapshot(label: string): Promise<BuildSnapshotOutcome> {
  const [envRes, providerRes, extRes, profRes, invRes] = await Promise.allSettled([
    toolingApi.getEnvironment(),
    toolingApi.listProviders(),
    toolingApi.listExtensions(),
    api.listProfiles(),
    fetchInventoryAll(),
  ])

  const failedSections: EnvSnapshotSection[] = []
  let environment: unknown = null
  if (envRes.status === 'fulfilled') environment = envRes.value
  else failedSections.push('environment')

  let cli_versions: EnvCliVersionSummary[] | undefined
  if (providerRes.status === 'fulfilled') {
    cli_versions = providerRes.value
      .filter(provider => provider.installed)
      .map(provider => ({
        name: provider.name,
        display_name: provider.display_name,
        version: provider.version,
      }))
  } else {
    failedSections.push('providers')
  }

  let extensions_summary: EnvExtensionSummaryItem[] = []
  if (extRes.status === 'fulfilled') {
    extensions_summary = extRes.value.map(extension => ({
      kind: extension.kind,
      name: extension.name,
      ...(extension.scope ? { scope: extension.scope } : {}),
    }))
  } else {
    failedSections.push('extensions')
  }

  let agent_profiles: EnvAgentProfileSummary[] = []
  if (profRes.status === 'fulfilled') {
    const profiles = profRes.value as AgentProfileInfoWithModel[]
    agent_profiles = profiles.map(profile => ({
      name: profile.name,
      provider: profile.provider ?? null,
      model: profile.model ?? null,
    }))
  } else {
    failedSections.push('agent_profiles')
  }

  let inventory_counts: Record<string, Record<string, number>> = {}
  if (invRes.status === 'fulfilled') {
    inventory_counts = Object.fromEntries(invRes.value.clis.map(cli => [cli.cli, cli.counts]))
  } else {
    failedSections.push('inventory')
  }

  const snapshot: EnvSnapshot = {
    schema: ENV_SNAPSHOT_SCHEMA,
    captured_at: new Date().toISOString(),
    label: label.trim() || defaultSnapshotLabel(),
    environment,
    extensions_summary,
    agent_profiles,
    inventory_counts,
    ...(cli_versions !== undefined ? { cli_versions } : {}),
  }
  return { snapshot, failedSections }
}

export function environmentSummaryChips(environment: unknown): { os: string | null; serverVersion: string | null } {
  if (!environment || typeof environment !== 'object') return { os: null, serverVersion: null }
  const env = environment as Record<string, unknown>
  return {
    os: typeof env.os === 'string' ? env.os : null,
    serverVersion: typeof env.server_version === 'string' ? env.server_version : null,
  }
}
