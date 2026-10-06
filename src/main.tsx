import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import TokenSheet from './ui/TokenSheet'
import { applySavedPrefs } from './ui/theme'

// The saved theme and density are on <html> before the first paint, so the boot
// screen already has them. /?ui=tokens shows the design tokens instead of the app.
applySavedPrefs()
const showTokens = new URLSearchParams(window.location.search).get('ui') === 'tokens'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {showTokens ? <TokenSheet /> : <App />}
  </React.StrictMode>,
)
