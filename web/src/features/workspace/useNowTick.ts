import { useEffect, useState } from 'react'

/** Re-renders the caller every `intervalMs`, returning the current epoch ms — for stall/elapsed-time displays. */
export function useNowTick(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
