import { useEffect, useState } from 'react'

import type { Density } from './theme'

// Theme and density toggles for the developer pages (/?ui=tokens, /?ui=atoms).
// /?theme=light&density=compact picks the look from the address.
export function useLook() {
  const params = new URLSearchParams(window.location.search)
  const [theme, setTheme] = useState<'dark' | 'light'>(params.get('theme') === 'light' ? 'light' : 'dark')
  const [density, setDensity] = useState<Density>(params.get('density') === 'compact' ? 'compact' : 'comfortable')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.density = density
  }, [theme, density])
  return { theme, setTheme, density, setDensity }
}

export function ThemeControls({ look }: { look: ReturnType<typeof useLook> }) {
  return (
    <div className="ml-auto flex items-center gap-2">
      {(['dark', 'light'] as const).map(t => (
        <button key={t} className="btn-quiet" aria-pressed={look.theme === t} onClick={() => look.setTheme(t)}>{t.toUpperCase()}</button>
      ))}
      {(['comfortable', 'compact'] as const).map(d => (
        <button key={d} className="btn-quiet" aria-pressed={look.density === d} onClick={() => look.setDensity(d)}>{d.toUpperCase()}</button>
      ))}
    </div>
  )
}
