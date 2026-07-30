import { useEffect } from 'react'
import { useStore } from './store'
import { AppShell } from './app/AppShell'
import { CheckCircle, Info, XCircle } from 'lucide-react'

// Global toast overlay — unchanged from the pre-Phase-1b App.tsx, just kept
// in this file while the actual page layout moved to app/AppShell.tsx.
function Snackbar() {
  const { snackbar, hideSnackbar } = useStore()

  useEffect(() => {
    if (snackbar) {
      const timer = setTimeout(hideSnackbar, 3000)
      return () => clearTimeout(timer)
    }
  }, [snackbar, hideSnackbar])

  if (!snackbar) return null

  const colors = {
    success: 'bg-[var(--accent)] border-[var(--accent)]',
    error: 'bg-[var(--danger)] border-[var(--danger)]',
    info: 'bg-[var(--info)] border-[var(--info)]',
  }
  const icons = {
    success: <CheckCircle size={18} />,
    error: <XCircle size={18} />,
    info: <Info size={18} />,
  }

  return (
    <div role="alert" className={`fixed bottom-4 right-4 z-[100] px-4 py-3 rounded-lg border shadow-lg flex items-center gap-2 text-[var(--on-accent)] ${colors[snackbar.type]}`}>
      {icons[snackbar.type]}
      <span className="text-sm">{snackbar.message}</span>
    </div>
  )
}

export default function App() {
  return (
    <>
      <AppShell />
      <Snackbar />
    </>
  )
}
