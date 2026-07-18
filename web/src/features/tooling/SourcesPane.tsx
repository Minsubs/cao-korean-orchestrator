import { useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, FolderTree, Library, RefreshCw, Store } from 'lucide-react'
import type { ToolingAdapter, ToolingCatalogSummary, ToolingMarketplace, ToolingSourceDirectory, ToolingSources } from '../../api.tooling'
import { SkeletonBlock, TypeChip, initials, kindLabel, pastelFor } from './shared'

/**
 * 소스 탭 — Phase 6c: 스킬/명령/프롬프트/에이전트가 실제로 어느 디렉터리에서
 * 왔는지, 큐레이션 카탈로그의 출처는 무엇인지, provider별 마켓플레이스는
 * 어떤 상태인지 한 화면에서 정직하게 보여준다. 여기서 설치/삭제 등 쓰기
 * 동작은 하지 않는다 — 그건 탐색/설치됨/업데이트 탭의 몫이고, 이 탭은 순수
 * 조회 + "탐색 탭으로 보내기" 내비게이션 + 마켓플레이스 관리 명령 복사뿐이다.
 *
 * 백엔드 계약(`GET /tooling/sources`)은 별도 세션이 병렬로 구현 중이라 이
 * 화면이 만들어진 시점에는 아직 404일 수 있다 — ToolingView가 다른 탭과
 * 독립적으로 로딩/에러를 소유하고(다른 탭은 영향받지 않음), 실패 시 기존
 * ToolingView 전체화면 에러와 같은 문구/스타일("Tooling API에 연결할 수
 * 없어요")를 이 탭 영역에만 재사용한다 — mock/샘플 데이터로 채우지 않는다.
 */

interface SourcesPaneProps {
  sources: ToolingSources | null
  loading: boolean
  error: boolean
  onRetry: () => void
  adapters: ToolingAdapter[]
  onNavigateToDiscover: () => void
}

const SCOPE_LABEL: Record<string, string> = { store: 'Store', user: 'User' }

export function SourcesPane({ sources, loading, error, onRetry, adapters, onNavigateToDiscover }: SourcesPaneProps) {
  if (loading) return <SourcesSkeleton />

  if (error || !sources) {
    return (
      <div
        role="region"
        aria-label="Tooling API에 연결할 수 없어요"
        className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-sm font-semibold text-[var(--text)]">Tooling API에 연결할 수 없어요</h2>
        <p className="max-w-sm text-xs leading-relaxed text-[var(--text-3)]">서버 버전을 확인하세요</p>
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

  const marketplaceEntries = Object.entries(sources.marketplaces)

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--text-3)]">스킬·명령·프롬프트·에이전트가 어디에서 오는지 한눈에 확인해요</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        >
          <RefreshCw size={13} />
          새로고침
        </button>
      </div>

      {/* 디렉터리 소스 */}
      <div>
        <SectionHeader icon={<FolderTree size={13} />} label="디렉터리 소스" />
        {sources.directory_sources.length === 0 ? (
          <EmptyRow>등록된 디렉터리 소스가 없어요</EmptyRow>
        ) : (
          <div
            role="list"
            aria-label="디렉터리 소스 목록"
            className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
          >
            {sources.directory_sources.map((s, i) => (
              <SourceDirectoryRow key={`${s.path}-${i}`} source={s} adapters={adapters} withBorder={i > 0} />
            ))}
          </div>
        )}
      </div>

      {/* 큐레이션 카탈로그 */}
      <div>
        <SectionHeader icon={<Library size={13} />} label="큐레이션 카탈로그" />
        <CatalogSummaryCard catalog={sources.catalog} onNavigateToDiscover={onNavigateToDiscover} />
      </div>

      {/* 마켓플레이스 — provider 키가 있는 것만 (백엔드가 이미 관련 provider로 필터링) */}
      {marketplaceEntries.length > 0 && (
        <div>
          <SectionHeader icon={<Store size={13} />} label="마켓플레이스" />
          <div className="space-y-3">
            {marketplaceEntries.map(([providerId, marketplace]) => (
              <MarketplaceCard key={providerId} providerId={providerId} marketplace={marketplace} adapters={adapters} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SourcesSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="소스 불러오는 중">
      <SkeletonBlock className="h-8 w-full" />
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-24 w-full" />
      <SkeletonBlock className="h-24 w-full" />
    </div>
  )
}

function SectionHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-3)]">
      {icon}
      {label}
    </div>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
      {children}
    </div>
  )
}

function SourceDirectoryRow({
  source,
  adapters,
  withBorder,
}: {
  source: ToolingSourceDirectory
  adapters: ToolingAdapter[]
  withBorder: boolean
}) {
  const cliLabel = source.cli ? (adapters.find(a => a.id === source.cli)?.display_name ?? source.cli) : null
  const pastel = pastelFor(source.cli ?? source.kind)

  return (
    <div
      role="listitem"
      className={`flex items-center gap-3 px-4 py-2.5 ${withBorder ? 'border-t border-dashed border-[var(--border-soft)]' : ''} ${
        source.exists ? '' : 'opacity-50'
      }`}
    >
      {cliLabel && (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
          style={{ backgroundColor: pastel.bg, color: pastel.ink }}
          title={cliLabel}
        >
          {initials(cliLabel)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-[var(--text)]" title={source.path}>
          {source.path}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <TypeChip>{kindLabel(source.kind)}</TypeChip>
          {source.scope && <TypeChip>{SCOPE_LABEL[source.scope] ?? source.scope}</TypeChip>}
          {cliLabel && <TypeChip>{cliLabel}</TypeChip>}
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold text-[var(--text-2)]">{source.count}개</span>
      {!source.exists && (
        <span
          className="shrink-0 rounded-full px-2 py-[1px] text-[10px] font-bold"
          style={{ backgroundColor: 'var(--neutral-bg)', color: 'var(--neutral)' }}
        >
          아직 없어요
        </span>
      )}
    </div>
  )
}

function CatalogSummaryCard({ catalog, onNavigateToDiscover }: { catalog: ToolingCatalogSummary; onNavigateToDiscover: () => void }) {
  const kindEntries = Object.entries(catalog.kinds)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-bold tabular-nums text-[var(--text)]">{catalog.count}</span>
        <span className="text-xs text-[var(--text-3)]">개 항목</span>
        {catalog.origin && (
          <span className="ml-auto rounded-full px-2 py-[1px] text-[10px] font-bold" style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-2)' }}>
            출처: {catalog.origin}
          </span>
        )}
      </div>
      {kindEntries.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {kindEntries.map(([kind, count]) => (
            <TypeChip key={kind}>
              {kindLabel(kind)} {count}
            </TypeChip>
          ))}
        </div>
      )}
      {catalog.note && <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-3)]">{catalog.note}</p>}
      <button
        type="button"
        onClick={onNavigateToDiscover}
        className="mt-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      >
        탐색 탭에서 보기
      </button>
    </div>
  )
}

function MarketplaceCard({
  providerId,
  marketplace,
  adapters,
}: {
  providerId: string
  marketplace: ToolingMarketplace
  adapters: ToolingAdapter[]
}) {
  const label = adapters.find(a => a.id === providerId)?.display_name ?? providerId
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function handleCopy() {
    if (!marketplace.manage_hint) return
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(marketplace.manage_hint)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard permissions denied or unavailable — the command stays
      // visible in the <pre> block above so the user can select it by hand.
      setCopyFailed(true)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Store size={14} className="text-[var(--text-2)]" />
        <span className="text-xs font-bold text-[var(--text)]">{label} 마켓플레이스</span>
      </div>

      {marketplace.supported ? (
        marketplace.items && marketplace.items.length > 0 ? (
          <ul className="mt-2.5 space-y-1">
            {marketplace.items.map((item, i) => (
              <li
                key={`${item.name}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs"
              >
                <span className="font-semibold text-[var(--text)]">{item.name}</span>
                {item.source && (
                  <span className="min-w-0 truncate font-mono text-[10.5px] text-[var(--text-3)]" title={item.source}>
                    {item.source}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2.5 text-xs text-[var(--text-3)]">등록된 항목이 없어요</p>
        )
      ) : (
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-3)]">{marketplace.reason ?? '이 환경에서는 지원되지 않아요'}</p>
      )}

      {marketplace.manage_hint && (
        <div className="mt-3 border-t border-dashed border-[var(--border-soft)] pt-3">
          <p className="text-[10.5px] leading-relaxed text-[var(--text-3)]">
            여기서 직접 추가/삭제는 아직 지원하지 않아요 — 명령을 복사해 실행하세요
          </p>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--surface-3)] px-2.5 py-2 font-mono text-[10.5px] text-[var(--text-2)]">
            {marketplace.manage_hint}
          </pre>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <Copy size={11} />
              {copied ? '복사됨' : '명령 복사'}
            </button>
            {copyFailed && <span className="text-[10.5px] text-[var(--danger)]">복사하지 못했어요 — 위 명령을 직접 선택해서 복사하세요</span>}
          </div>
        </div>
      )}
    </div>
  )
}
