import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  group?: string
  sublabel?: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}

export function CustomSelect({ value, onChange, options, placeholder = '선택하세요...', className = '' }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const selected = options.find(o => o.value === value)

  // Group options
  const groups: { label: string | null; items: SelectOption[] }[] = []
  const seen = new Set<string>()
  for (const opt of options) {
    const g = opt.group || null
    const key = g || '__ungrouped__'
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ label: g, items: options.filter(o => (o.group || null) === g) })
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg px-3 py-2.5 focus:border-[var(--accent)] focus:outline-none transition-colors hover:border-[var(--accent-soft)]"
      >
        <span className={selected ? 'text-[var(--text)]' : 'text-[var(--text-3)]'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className={`text-[var(--text-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold bg-[var(--surface-2)] sticky top-0">
                  {group.label}
                </div>
              )}
              {group.items.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => {
                    if (!opt.disabled) {
                      onChange(opt.value)
                      setOpen(false)
                    }
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                    opt.disabled
                      ? 'text-[var(--text-3)] opacity-60 cursor-not-allowed'
                      : value === opt.value
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                        : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="text-sm block truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="text-[11px] text-[var(--text-3)] block truncate">{opt.sublabel}</span>
                    )}
                  </div>
                  {value === opt.value && <Check size={14} className="text-[var(--accent-text)] shrink-0 ml-2" />}
                </button>
              ))}
            </div>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-4 text-sm text-[var(--text-3)] text-center">선택할 수 있는 항목이 없습니다</div>
          )}
        </div>
      )}
    </div>
  )
}
