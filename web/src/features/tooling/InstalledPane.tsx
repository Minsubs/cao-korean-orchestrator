import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, Info, Search, Trash2 } from 'lucide-react'
import type { ExtensionKind, ExtensionScope, ToolingAdapter, ToolingExtension, ToolingPlanRequest } from '../../api.tooling'
import { ActionButton, GENERIC_SKILLS_ADAPTER_ID, TypeChip, UNKNOWN, gateCapability, initials, pastelFor, useDebouncedValue } from './shared'

// 'mcp' (Phase 5b) — provider-native items 5a's claude_code/codex/antigravity
// adapters report (e.g. `claude mcp list`), integrated into this same
// Type/Provider filter set rather than a separate screen — see "설치됨 탭
// 확장" in the phase5b spec.
const KIND_OPTIONS: { value: ExtensionKind; label: string }[] = [
  { value: 'skill', label: '스킬 (Skill)' },
  { value: 'plugin', label: '플러그인 (Plugin)' },
  { value: 'profile', label: '에이전트 (Profile)' },
  { value: 'mcp', label: 'MCP' },
]
const SCOPE_OPTIONS: { value: ExtensionScope; label: string }[] = [
  { value: 'built-in', label: '기본 제공 (Built-in)' },
  { value: 'user', label: '직접 설치 (User)' },
]
const KIND_LABEL: Record<ExtensionKind, string> = { skill: '스킬', plugin: '플러그인', profile: '에이전트', mcp: 'MCP' }
const SCOPE_LABEL: Record<ExtensionScope, string> = { 'built-in': '기본 제공', user: '직접 설치' }
/** Shared "provider unset" bucket for the Provider filter — keeps null providers visible/filterable instead of silently vanishing. */
const NO_PROVIDER = '__none__'

interface InstalledPaneProps {
  extensions: ToolingExtension[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Phase 4b — 설치됨 탭 상세 연결: kind=skill의 [업데이트]/[삭제] 활성화 여부는 generic_skills 어댑터 capability가 기준. */
  adapters: ToolingAdapter[]
  adaptersLoading: boolean
  adaptersError: boolean
  onRequestAction: (request: ToolingPlanRequest) => void
}

export function InstalledPane({ extensions, selectedId, onSelect, adapters, adaptersLoading, adaptersError, onRequestAction }: InstalledPaneProps) {
  const [kindFilter, setKindFilter] = useState<Set<ExtensionKind>>(() => new Set(KIND_OPTIONS.map(o => o.value)))
  const [scopeFilter, setScopeFilter] = useState<Set<ExtensionScope>>(() => new Set(SCOPE_OPTIONS.map(o => o.value)))
  // Provider is open-ended (5a adds claude_code/codex/antigravity over time),
  // so unlike kind/scope this can't be seeded from a fixed options list —
  // `null` means "not yet touched by the user", i.e. everything passes.
  const [providerFilter, setProviderFilter] = useState<Set<string> | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 200)

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<ExtensionKind, number>> = {}
    for (const e of extensions) counts[e.kind] = (counts[e.kind] ?? 0) + 1
    return counts
  }, [extensions])
  const scopeCounts = useMemo(() => {
    const counts: Partial<Record<ExtensionScope, number>> = {}
    for (const e of extensions) counts[e.scope] = (counts[e.scope] ?? 0) + 1
    return counts
  }, [extensions])
  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of extensions) {
      const key = e.provider ?? NO_PROVIDER
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({
        value,
        label:
          value === NO_PROVIDER
            ? UNKNOWN
            : value === 'cao'
              ? 'MS Orchestrator'
              : adapters.find(adapter => adapter.id === value)?.display_name ?? value,
        count,
      }))
  }, [extensions, adapters])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return extensions.filter(e => {
      if (!kindFilter.has(e.kind)) return false
      if (!scopeFilter.has(e.scope)) return false
      if (providerFilter && !providerFilter.has(e.provider ?? NO_PROVIDER)) return false
      const providerName = providerOptions.find(option => option.value === (e.provider ?? NO_PROVIDER))?.label ?? ''
      const haystack = [e.name, e.description ?? '', e.kind, KIND_LABEL[e.kind], e.scope, SCOPE_LABEL[e.scope], e.provider ?? '', providerName].join(' ').toLowerCase()
      if (q && !haystack.includes(q)) return false
      return true
    })
  }, [extensions, kindFilter, scopeFilter, providerFilter, providerOptions, search])

  // Keep the selection valid: default to the first visible row whenever the
  // current selection falls outside the filtered set (initial load, a filter
  // change, or a search) — never auto-select while the list is empty.
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) onSelect(null)
      return
    }
    if (!filtered.some(e => e.id === selectedId)) {
      onSelect(filtered[0].id)
    }
  }, [filtered, selectedId, onSelect])

  const selected = filtered.find(e => e.id === selectedId) ?? null

  const toggleKind = (v: ExtensionKind) => {
    setKindFilter(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }
  const toggleScope = (v: ExtensionScope) => {
    setScopeFilter(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }
  const toggleProvider = (v: string) => {
    setProviderFilter(prev => {
      const next = new Set(prev ?? providerOptions.map(o => o.value))
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-[420px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      {/* Filters */}
      <aside className="w-[180px] shrink-0 overflow-y-auto border-r border-[var(--border)] p-3">
        <FilterGroup title="종류">
          {KIND_OPTIONS.map(o => (
            <FilterCheckbox
              key={o.value}
              label={o.label}
              count={kindCounts[o.value] ?? 0}
              checked={kindFilter.has(o.value)}
              onChange={() => toggleKind(o.value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup title="설치 위치">
          {SCOPE_OPTIONS.map(o => (
            <FilterCheckbox
              key={o.value}
              label={o.label}
              count={scopeCounts[o.value] ?? 0}
              checked={scopeFilter.has(o.value)}
              onChange={() => toggleScope(o.value)}
            />
          ))}
        </FilterGroup>
        {providerOptions.length > 0 && (
          <FilterGroup title="연결 도구">
            {providerOptions.map(o => (
              <FilterCheckbox
                key={o.value}
                label={o.label}
                count={o.count}
                checked={providerFilter ? providerFilter.has(o.value) : true}
                onChange={() => toggleProvider(o.value)}
              />
            ))}
          </FilterGroup>
        )}
      </aside>

      {/* List */}
      <div className="min-w-[260px] flex-1 overflow-y-auto border-r border-[var(--border)]">
        <div className="sticky top-0 z-10 bg-[var(--surface)] p-3">
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5">
            <Search size={13} className="shrink-0 text-[var(--text-3)]" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="이름·설명·종류·도구 검색…"
              aria-label="설치된 확장 검색"
              className="w-full border-none bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-[var(--text-3)]">
            검색 결과 <span className="font-bold text-[var(--text-2)]">{filtered.length}개</span> / 전체 {extensions.length}개
          </p>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-3)]">
            {extensions.length === 0 ? '설치된 확장이 없어요' : '필터 조건에 맞는 확장이 없어요'}
          </div>
        ) : (
          <ul role="listbox" aria-label="설치된 확장 목록">
            {filtered.map(ext => (
              <li key={ext.id} role="presentation">
                <ExtensionRow ext={ext} active={ext.id === selectedId} onClick={() => onSelect(ext.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail */}
      <aside className="w-[300px] shrink-0 overflow-y-auto p-4">
        {selected ? (
          <ExtensionDetail
            ext={selected}
            adapters={adapters}
            adaptersLoading={adaptersLoading}
            adaptersError={adaptersError}
            onRequestAction={onRequestAction}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs leading-relaxed text-[var(--text-3)]">
            왼쪽 목록에서 확장을 선택하면 자세한 정보를 볼 수 있어요
          </div>
        )}
      </aside>
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)]">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function FilterCheckbox({
  label,
  count,
  checked,
  onChange,
}: {
  label: string
  count: number
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)]">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 accent-[var(--accent)]" />
      <span className="flex-1">{label}</span>
      <span className="text-[10px] text-[var(--text-3)]">{count}</span>
    </label>
  )
}

function ExtensionRow({ ext, active, onClick }: { ext: ToolingExtension; active: boolean; onClick: () => void }) {
  const pastel = pastelFor(ext.provider ?? ext.kind)
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 border-l-[3px] px-3 py-2.5 text-left transition-colors ${
        active ? 'border-l-[var(--accent)] bg-[var(--surface-2)]' : 'border-l-transparent hover:bg-[var(--surface-2)]'
      }`}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
        style={{ backgroundColor: pastel.bg, color: pastel.ink }}
      >
        {initials(ext.provider ?? ext.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-[var(--text)]">{ext.name}</span>
          <TypeChip>{KIND_LABEL[ext.kind]}</TypeChip>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">{ext.description || '설명 없음'}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <TypeChip>{SCOPE_LABEL[ext.scope]}</TypeChip>
          {!ext.enabled && (
            <span className="rounded-full px-1.5 py-[1px] text-[10px] font-bold" style={{ backgroundColor: 'var(--neutral-bg)', color: 'var(--neutral)' }}>
              비활성
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function ExtensionDetail({
  ext,
  adapters,
  adaptersLoading,
  adaptersError,
  onRequestAction,
}: {
  ext: ToolingExtension
  adapters: ToolingAdapter[]
  adaptersLoading: boolean
  adaptersError: boolean
  onRequestAction: (request: ToolingPlanRequest) => void
}) {
  const isSkill = ext.kind === 'skill'
  // Phase 5b — provider-native items (kind='mcp', from 5a's claude_code/codex/
  // antigravity adapters) gate on *their own* adapter's real capabilities
  // (matched by ext.provider), same as skill does for generic_skills. Any
  // other kind (plugin/profile) keeps the unconditional Phase 5 placeholder —
  // no adapter backs those yet, so a capability lookup there would just be a
  // different-looking fake.
  const isMcp = ext.kind === 'mcp'
  const skillsAdapter = adapters.find(a => a.id === GENERIC_SKILLS_ADAPTER_ID)
  const providerAdapter = ext.provider ? adapters.find(a => a.id === ext.provider) : undefined
  const adapterMissingReason = adaptersError
    ? '어댑터 정보를 불러오지 못했어요'
    : adaptersLoading
      ? '어댑터 정보를 확인하는 중…'
      : '감지된 어댑터가 없어요'
  const otherKindReason = '이 유형의 관리는 Phase 5에서 제공돼요'

  const updateGate = isSkill
    ? gateCapability(skillsAdapter, 'canUpdate', { adapterMissingReason })
    : isMcp
      ? gateCapability(providerAdapter, 'canUpdate', { adapterMissingReason })
      : { disabled: true, title: otherKindReason }
  const removeGate = isSkill
    ? gateCapability(skillsAdapter, 'canRemove', { adapterMissingReason })
    : isMcp
      ? gateCapability(providerAdapter, 'canRemove', { adapterMissingReason })
      : { disabled: true, title: otherKindReason }
  const activeAdapter = isSkill ? skillsAdapter : isMcp ? providerAdapter : undefined

  return (
    <div>
      <div className="text-sm font-bold text-[var(--text)]">{ext.name}</div>
      {ext.description && <p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">{ext.description}</p>}
      <dl className="mt-4 space-y-2 text-[11px]">
        <DetailRow label="ID" value={ext.id} mono />
        <DetailRow label="종류" value={KIND_LABEL[ext.kind]} />
        <DetailRow label="범위" value={SCOPE_LABEL[ext.scope]} />
        <DetailRow label="연결 도구" value={ext.provider === 'cao' ? 'MS Orchestrator' : activeAdapter?.display_name ?? ext.provider ?? UNKNOWN} />
        <DetailRow label="활성화" value={ext.enabled ? '예' : '아니오'} />
        <DetailRow label="소스 경로" value={ext.source_path ?? UNKNOWN} mono breakAll />
      </dl>
      <div className="mt-4 flex gap-2">
        <ActionButton
          disabled={updateGate.disabled}
          title={updateGate.title}
          icon={<Download size={12} />}
          onClick={() => activeAdapter && onRequestAction({ action: 'update', provider: activeAdapter.id, target: ext.name })}
        >
          {isSkill ? '최신화' : '업데이트'}
        </ActionButton>
        <ActionButton
          variant="danger"
          disabled={removeGate.disabled}
          title={removeGate.title}
          icon={<Trash2 size={12} />}
          onClick={() => activeAdapter && onRequestAction({ action: 'remove', provider: activeAdapter.id, target: ext.name })}
        >
          삭제
        </ActionButton>
      </div>
      {!isSkill && !isMcp && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-2)]">
          <Info size={13} className="mt-0.5 shrink-0" />
          {otherKindReason}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono, breakAll }: { label: string; value: string; mono?: boolean; breakAll?: boolean }) {
  return (
    <div className="grid grid-cols-[70px_1fr] gap-2">
      <dt className="text-[var(--text-3)]">{label}</dt>
      <dd className={`min-w-0 text-[var(--text)] ${mono ? 'font-mono' : ''} ${breakAll ? 'break-all' : 'truncate'}`} title={value}>
        {value}
      </dd>
    </div>
  )
}
