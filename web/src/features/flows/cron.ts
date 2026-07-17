// Cron -> human-readable Korean, covering only the simple minute/hour/weekday
// base cases the phase spec asks for ("분/시/요일 기본 케이스만"). Anything
// else (step ranges, comma lists, day-of-month, month fields, …) falls back
// to the raw cron string verbatim — never a guessed/approximate label.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad2(n: string): string {
  return n.padStart(2, '0')
}

export function humanizeCron(cron: string): string {
  const trimmed = cron.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length !== 5) return trimmed
  const [min, hour, dom, mon, dow] = parts

  // Every N minutes: "*/N * * * *"
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `${min.slice(2)}분마다`
  }

  // Every N hours, on the hour: "0 */N * * *"
  if (/^\d+$/.test(min) && Number(min) === 0 && /^\*\/\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return `${hour.slice(2)}시간마다`
  }

  // Hourly at :MM — "MM * * * *"
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `매시 ${pad2(min)}분`
  }

  const isFixedTime = /^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*'
  if (isFixedTime) {
    const time = `${pad2(hour)}:${pad2(min)}`
    if (dow === '*') return `매일 ${time}`
    if (dow === '1-5') return `평일 ${time}`
    if (/^[0-6]$/.test(dow)) return `매주 ${WEEKDAYS[Number(dow)]} ${time}`
  }

  return trimmed
}
