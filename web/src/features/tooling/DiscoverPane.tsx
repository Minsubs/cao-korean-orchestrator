import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, ExternalLink, Search, Star } from 'lucide-react'
import type { CatalogItem, CatalogKind, CatalogProviderSupport, ToolingAdapter, ToolingPlanRequest } from '../../api.tooling'
import { ActionButton, InstallPill, SkeletonBlock, TypeChip, initials, pastelFor, useDebouncedValue } from './shared'

/**
 * 탐색 탭 — Phase 5b: 인기 확장 카탈로그를 리스트로 보여주고 [설치]하면 실제
 * CLI에 적용한다. Reuses the Phase 4b write path wholesale (no new plumbing):
 * a catalog install is just `onRequestAction({action:'install', provider,
 * target:'catalog:<id>', params?})`, which is the same
 * useToolingOperations.requestAction → plan → PreviewModal → execute →
 * Operation Queue flow the Updates/Installed tabs already use — ToolingView's
 * existing "성공 시 Queue로 이동" behavior fires here too, unchanged.
 *
 * Availability stance matches the rest of the Tooling view: /tooling/catalog
 * can 404 independently (Phase 5a backend, "아직 발주 전" when this was
 * written) — ToolingView degrades only this tab (loading/error props below),
 * never falling back to mock/sample rows.
 */

// 'cli' added in Phase 6c — a bootstrap item like the backend's real
// "generic-skills-cli" (services/tooling/catalog.py), always method='manual'
// and shown whether or not the CLI itself is currently detected.
const KIND_OPTIONS: { value: CatalogKind; label: string }[] = [
  { value: 'mcp', label: 'MCP' },
  { value: 'plugin', label: 'Plugin' },
  { value: 'skill', label: 'Skill' },
  { value: 'cli', label: 'CLI' },
]
const KIND_LABEL: Record<CatalogKind, string> = { mcp: 'MCP', plugin: 'Plugin', skill: 'Skill', cli: 'CLI' }

const PATH_HELP_TEXT = '홈 디렉터리 기준 상대 경로만 입력할 수 있어요 (.. 이나 절대경로는 사용할 수 없어요)'

/**
 * Client-side pre-check only — a conservative mirror of the server's real
 * confinement rule (phase5a-spec.md: "fs/list와 동일한 홈 confinement 검증"),
 * which stays authoritative. This never blocks a path the server would
 * accept less strictly than this; it only catches obviously-unsafe input
 * before spending a plan round-trip on it.
 */
function isValidRelativePath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('..')) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return false
  // Reject ASCII control characters (code points below 0x20, i.e. space)
  // via a charCode check rather than a regex range, so no raw control byte
  // sits in the source file itself (invisible in a diff/PR review).
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 0x20) return false
  }
  return true
}

function providerLabel(adapters: ToolingAdapter[], id: string): string {
  return adapters.find(a => a.id === id)?.display_name ?? id
}

/** Same enable/disable + title decision shape as shared.tsx's gateCapability, but for the catalog's per-provider `supported` shape rather than an adapter's capabilities map. */
function gateSupport(support: CatalogProviderSupport | undefined): { disabled: boolean; title?: string } {
  if (!support) return { disabled: true, title: '이 provider에 대한 지원 정보가 없어요' }
  if (support.supported) return { disabled: false }
  return { disabled: true, title: support.reason ?? '이 환경에서는 지원되지 않아요' }
}

/** Whether the item is already installed for the given provider. */
function isInstalled(item: CatalogItem, providerId: string): boolean {
  return item.supported[providerId]?.install_status === 'installed'
}

interface DiscoverPaneProps {
  catalog: CatalogItem[]
  loading: boolean
  error: boolean
  onRetry: () => void
  adapters: ToolingAdapter[]
  onRequestAction: (request: ToolingPlanRequest) => void
}

export function DiscoverPane({ catalog, loading, error, onRetry, adapters, onRequestAction }: DiscoverPaneProps) {
  // These are chips, not checkboxes: selecting "Plugin 13" must show those
  // 13 plugins, not remove plugins from an initially-all set. `null` is the
  // explicit 전체 choice for both filter groups.
  const [kindFilter, setKindFilter] = useState<CatalogKind | null>(null)
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 200)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<CatalogKind, number>> = {}
    for (const item of catalog) counts[item.kind] = (counts[item.kind] ?? 0) + 1
    return counts
  }, [catalog])

  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of catalog) for (const p of item.providers) counts.set(p, (counts.get(p) ?? 0) + 1)
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({ value, label: providerLabel(adapters, value), count }))
  }, [catalog, adapters])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return catalog.filter(item => {
      if (kindFilter && item.kind !== kindFilter) return false
      if (providerFilter && !item.providers.includes(providerFilter)) return false
      const haystack = [
        item.name,
        item.description_ko,
        item.category,
        item.kind,
        KIND_LABEL[item.kind],
        ...item.providers,
        ...item.providers.map(provider => providerLabel(adapters, provider)),
      ].join(' ').toLowerCase()
      if (q && !haystack.includes(q)) return false
      return true
    })
  }, [catalog, kindFilter, providerFilter, search, adapters])

  // Keep the selection valid, same pattern as InstalledPane: default to the
  // first visible row whenever the current selection falls outside the
  // filtered set, never auto-select while the list is empty.
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!filtered.some(item => item.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selected = filtered.find(item => item.id === selectedId) ?? null

  if (loading) return <DiscoverSkeleton />

  if (error) {
    return (
      <div
        role="region"
        aria-label="카탈로그를 불러오지 못했어요"
        className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-sm font-semibold text-[var(--text)]">카탈로그를 불러오지 못했어요</h2>
        <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">서버 연결을 확인하고 다시 시도하세요</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:brightness-105"
        >
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 상단: 검색 + kind 필터 칩 + provider 필터 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
          <Search size={13} className="shrink-0 text-[var(--text-3)]" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="이름·설명·분류 검색…"
            aria-label="카탈로그 검색"
            className="w-full border-none bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
          />
        </div>
        <div role="group" aria-label="종류 필터" className="flex flex-wrap gap-1.5">
          <FilterChip label="전체" count={catalog.length} active={kindFilter === null} onClick={() => setKindFilter(null)} />
          {KIND_OPTIONS.map(o => (
            <FilterChip key={o.value} label={o.label} count={kindCounts[o.value] ?? 0} active={kindFilter === o.value} onClick={() => setKindFilter(o.value)} />
          ))}
        </div>
        {providerOptions.length > 0 && (
          <div role="group" aria-label="Provider 필터" className="flex flex-wrap gap-1.5">
            <FilterChip label="전체" count={catalog.length} active={providerFilter === null} onClick={() => setProviderFilter(null)} />
            {providerOptions.map(o => (
              <FilterChip
                key={o.value}
                label={o.label}
                count={o.count}
                active={providerFilter === o.value}
                onClick={() => setProviderFilter(o.value)}
              />
            ))}
          </div>
        )}
      </div>

      {/* List + Detail */}
      <div className="flex h-full min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="min-w-[280px] flex-1 overflow-y-auto border-r border-[var(--border)]">
          <div className="sticky top-0 z-10 border-b border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-[10.5px] text-[var(--text-3)]">
            검색 결과 <span className="font-bold text-[var(--text-2)]">{filtered.length}개</span> / 전체 {catalog.length}개
          </div>
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-3)]">
              {catalog.length === 0 ? '카탈로그가 비어 있어요' : '필터 조건에 맞는 항목이 없어요'}
            </div>
          ) : (
            <ul role="listbox" aria-label="확장 카탈로그 목록">
              {filtered.map(item => (
                <li key={item.id} role="presentation">
                  <CatalogRow item={item} adapters={adapters} active={item.id === selectedId} onClick={() => setSelectedId(item.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside
          role="region"
          aria-label="선택한 항목 상세"
          className="w-[340px] shrink-0 overflow-y-auto p-4"
        >
          {selected ? (
            <CatalogDetail item={selected} adapters={adapters} onRequestAction={onRequestAction} />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-xs leading-relaxed text-[var(--text-3)]">
              왼쪽 목록에서 확장을 선택하면 자세한 정보를 볼 수 있어요
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function DiscoverSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="카탈로그 불러오는 중">
      <SkeletonBlock className="h-9 w-full" />
      <SkeletonBlock className="h-16 w-full" />
      <SkeletonBlock className="h-16 w-full" />
      <SkeletonBlock className="h-16 w-full" />
    </div>
  )
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active ? 'border-transparent bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-3)] hover:bg-[var(--surface-2)]'
      }`}
    >
      {label}
      <span className="text-[10px] opacity-70">{count}</span>
    </button>
  )
}

function PopularBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[1px] text-[10px] font-bold"
      style={{ backgroundColor: 'var(--p-lemon)', color: 'var(--p-lemon-ink)' }}
    >
      <Star size={9} fill="currentColor" />
      인기
    </span>
  )
}

function ProviderStatusIcon({ providerId, label, installed }: { providerId: string; label: string; installed: boolean }) {
  const pastel = pastelFor(providerId)
  return (
    <span
      className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-[8px] font-bold"
      style={{ backgroundColor: pastel.bg, color: pastel.ink }}
      title={`${label} — ${installed ? '설치됨' : '미설치'}`}
    >
      {initials(label)}
      {installed && (
        <span className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[var(--success)] text-[var(--surface)]">
          <Check size={7} strokeWidth={4} />
        </span>
      )}
    </span>
  )
}

/**
 * A row is a `<div role="option">` (not `<button>`): it needs a real nested
 * `<a>` for "홈페이지 링크(새 탭)", and an anchor can't legally live inside a
 * button. tabIndex+onKeyDown keeps it keyboard-operable like the button-based
 * rows elsewhere in this feature.
 */
function CatalogRow({
  item,
  adapters,
  active,
  onClick,
}: {
  item: CatalogItem
  adapters: ToolingAdapter[]
  active: boolean
  onClick: () => void
}) {
  const pastel = pastelFor(item.name)
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`flex w-full cursor-pointer items-start gap-2.5 border-l-[3px] px-3 py-2.5 text-left transition-colors ${
        active ? 'border-l-[var(--accent)] bg-[var(--surface-2)]' : 'border-l-transparent hover:bg-[var(--surface-2)]'
      }`}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
        style={{ backgroundColor: pastel.bg, color: pastel.ink }}
      >
        {initials(item.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-[var(--text)]">{item.name}</span>
          {item.popular && <PopularBadge />}
          <TypeChip>{KIND_LABEL[item.kind]}</TypeChip>
          <TypeChip>{item.category}</TypeChip>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">{item.description_ko}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.providers.map(p => (
            <ProviderStatusIcon key={p} providerId={p} label={providerLabel(adapters, p)} installed={isInstalled(item, p)} />
          ))}
        </span>
      </span>
      {item.homepage && (
        <a
          href={item.homepage}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          title="홈페이지 열기"
          aria-label={`${item.name} 홈페이지 열기`}
          className="mt-0.5 shrink-0 text-[var(--text-3)] hover:text-[var(--accent-text)]"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  )
}

function CatalogDetail({
  item,
  adapters,
  onRequestAction,
}: {
  item: CatalogItem
  adapters: ToolingAdapter[]
  onRequestAction: (request: ToolingPlanRequest) => void
}) {
  const needsPath = Object.values(item.supported).some(s => s.requires_params?.includes('path'))
  const [pathValue, setPathValue] = useState('')
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null)
  const [copyFailedProvider, setCopyFailedProvider] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset the shared path draft + copy feedback whenever the selected item
  // changes, so neither leaks into a different item's install call/row.
  useEffect(() => {
    setPathValue('')
    setCopiedProvider(null)
    setCopyFailedProvider(null)
  }, [item.id])

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const pathTrimmed = pathValue.trim()
  const pathReady = !needsPath || isValidRelativePath(pathTrimmed)
  const pathInvalid = needsPath && pathTrimmed.length > 0 && !isValidRelativePath(pathTrimmed)

  async function handleCopy(providerId: string, command: string | undefined) {
    if (!command) return
    setCopyFailedProvider(null)
    try {
      await navigator.clipboard.writeText(command)
      setCopiedProvider(providerId)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedProvider(null), 1600)
    } catch {
      // Clipboard permissions denied or unavailable — the command stays
      // visible in the <pre> block above so the user can select it by hand.
      setCopyFailedProvider(providerId)
    }
  }

  function handleInstall(providerId: string) {
    if (!pathReady) return
    onRequestAction({
      action: 'install',
      provider: providerId,
      target: `catalog:${item.id}`,
      ...(needsPath ? { params: { path: pathTrimmed } } : {}),
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-bold text-[var(--text)]">{item.name}</span>
        {item.popular && <PopularBadge />}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-2)]">{item.description_ko}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <TypeChip>{KIND_LABEL[item.kind]}</TypeChip>
        <TypeChip>{item.category}</TypeChip>
      </div>

      {item.requires.length > 0 && (
        <div className="mt-2.5 text-[11px] text-[var(--text-3)]">
          필요 항목: <span className="font-mono text-[var(--text-2)]">{item.requires.join(', ')}</span>
        </div>
      )}

      {item.homepage && (
        <a
          href={item.homepage}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--accent-text)] hover:underline"
        >
          <ExternalLink size={12} />
          홈페이지
        </a>
      )}

      {needsPath && (
        <div className="mt-3">
          <label htmlFor="catalog-path-input" className="mb-1 block text-[11px] font-semibold text-[var(--text)]">
            설치 경로
          </label>
          <input
            id="catalog-path-input"
            value={pathValue}
            onChange={e => setPathValue(e.target.value)}
            placeholder="예: Documents/notes"
            aria-label="설치 경로"
            aria-invalid={pathInvalid}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <p className={`mt-1 text-[10.5px] ${pathInvalid ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>{PATH_HELP_TEXT}</p>
        </div>
      )}

      <div className="mt-3 space-y-2 border-t border-dashed border-[var(--border-soft)] pt-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)]">Provider별 설치</div>
        {item.providers.map(providerId => {
          const label = providerLabel(adapters, providerId)
          const installed = isInstalled(item, providerId)
          const support = item.supported[providerId]
          const gate = gateSupport(support)
          // A manual item (Phase 5b's code-review-pack, Phase 6c's kind='cli'
          // bootstrap items) never has a real non-interactive install path —
          // show copy-command + a *visible* reason instead of a disabled
          // "설치 불가" button that only carries the reason in a hover
          // tooltip (phase6c-tabs-front-spec.md §C: "수동 설치 항목은 설치
          // 버튼 대신 명령 복사+reason"). This applies whether or not the
          // item's own CLI is currently detected — install_status only flips
          // `installed` above (which still short-circuits to the plain
          // InstallPill once the manual bootstrap is actually present).
          const isManual = support?.method === 'manual'
          const showManualCopy = !installed && isManual && !!support?.command

          return (
            <div key={providerId} className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-xs font-semibold text-[var(--text)]">{label}</span>
                {installed ? (
                  <InstallPill installed />
                ) : isManual ? (
                  <TypeChip>수동 설치</TypeChip>
                ) : gate.disabled ? (
                  <ActionButton disabled title={gate.title}>
                    설치 불가
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="accent"
                    disabled={!pathReady}
                    title={!pathReady ? PATH_HELP_TEXT : undefined}
                    icon={<Download size={12} />}
                    onClick={() => handleInstall(providerId)}
                  >
                    {label}에 설치
                  </ActionButton>
                )}
              </div>

              {installed && item.new_session_required && (
                <div
                  className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info)' }}
                >
                  새 세션부터 적용돼요
                </div>
              )}

              {showManualCopy && (
                <div className="mt-2">
                  {support?.reason && <p className="mb-1.5 text-[10.5px] leading-relaxed text-[var(--text-3)]">{support.reason}</p>}
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--surface-3)] px-2.5 py-2 font-mono text-[10.5px] text-[var(--text-2)]">
                    {support?.command}
                  </pre>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <ActionButton icon={<Copy size={11} />} onClick={() => handleCopy(providerId, support?.command)}>
                      {copiedProvider === providerId ? '복사됨' : '명령 복사'}
                    </ActionButton>
                    {copyFailedProvider === providerId && (
                      <span className="text-[10.5px] text-[var(--danger)]">복사하지 못했어요 — 위 명령을 직접 선택해서 복사하세요</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
