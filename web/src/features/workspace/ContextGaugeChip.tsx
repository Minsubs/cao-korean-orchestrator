import { gaugeClassName } from './contextGauge'

interface ContextGaugeChipProps {
  /** `null`/`undefined` = no gauge available (not yet polled, or a non-gauge-eligible provider) — renders nothing, takes up no layout space (spec: "아무것도 렌더하지 않음 — 자리 차지 X"). */
  percentLeft: number | null | undefined
  className?: string
}

/**
 * Small "잔여 NN%" chip for the Phase 2d context gauge (spec §2d). Display
 * only — this component (and everything upstream of it) never triggers any
 * action; it just reflects `percent_left` as reported by the backend.
 */
export function ContextGaugeChip({ percentLeft, className }: ContextGaugeChipProps) {
  if (percentLeft === null || percentLeft === undefined) return null

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${gaugeClassName(percentLeft)} ${className ?? ''}`}
      title="남은 컨텍스트 — 표시 전용, 자동 동작 없음"
    >
      잔여 {percentLeft}%
    </span>
  )
}
