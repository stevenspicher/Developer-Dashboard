import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import AtomsGallery from './ui/AtomsGallery'
import TokenSheet from './ui/TokenSheet'
import { applySavedPrefs } from './ui/theme'

// The saved theme and density are on <html> before the first paint, so the boot
// screen already has them. /?ui=tokens and /?ui=atoms show the design tokens and the
// shared components instead of the app.
applySavedPrefs()
const ui = new URLSearchParams(window.location.search).get('ui')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {ui === 'tokens' ? <TokenSheet /> : ui === 'atoms' ? <AtomsGallery /> : <App />}
  </React.StrictMode>,
)
