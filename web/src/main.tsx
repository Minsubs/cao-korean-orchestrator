import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initTheme } from './theme'
import './index.css'

// Stamp data-theme on <html> before first paint so the app never flashes the
// wrong theme (Phase 1b app shell + Phase 1a theme.generated.css).
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
