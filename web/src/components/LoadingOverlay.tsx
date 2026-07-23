import './LoadingOverlay.css'
import huniUrl from '../assets/huni.png'
import { useStore } from '../store'

export function LoadingOverlay() {
  const overlay = useStore(s => s.overlay)
  if (overlay.count <= 0) return null
  return (
    <div className="busy-overlay" role="alert" aria-live="assertive">
      <div className="busy-box">
        <div className="busy-huni-wrap">
          <img className="busy-huni" src={huniUrl} alt="huni 로딩" />
          <div className="busy-huni-shadow" />
        </div>
        <div className="busy-msg">{overlay.message || '처리 중…'}</div>
        {overlay.sub && <div className="busy-sub">{overlay.sub}</div>}
      </div>
    </div>
  )
}
