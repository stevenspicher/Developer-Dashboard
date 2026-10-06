import { useEffect, useRef, useState } from 'react'

import { Button, Checkbox, RadioGroup } from './atoms'
import { usePrefs } from './prefs'
import type { Density, Layout, Theme } from './theme'

// What goes in the header to change how the dashboard looks: the layout switcher,
// and a menu for theme, density and the HUD ornaments.

const LAYOUTS: { id: Layout; label: string; title: string }[] = [
  { id: 'auto', label: 'Auto', title: 'Scan in a wide window, Flow in a narrow one' },
  { id: 'scan', label: 'Scan', title: 'A list and a pane' },
  { id: 'flow', label: 'Flow', title: 'The day as one column' },
]
const THEMES: { id: Theme; label: string }[] = [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }]
const DENSITIES: { id: Density; label: string }[] = [{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]

export function ModeSwitcher() {
  const { prefs, setPrefs } = usePrefs()
  return <RadioGroup label="Layout" options={LAYOUTS} value={prefs.layout} onChange={layout => setPrefs({ layout })} />
}

export function LookMenu() {
  const { prefs, setPrefs } = usePrefs()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown) }
  }, [open])

  return (
    <div ref={root} className="relative">
      <Button aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)} title="Theme, density and ornaments">Look ▾</Button>
      {open && (
        <div role="group" aria-label="Look" className="absolute right-0 top-full z-60 mt-1 flex w-[260px] flex-col gap-3 rounded-sm border border-line-strong bg-raised p-3 shadow-[0_8px_30px_var(--shadow-toast)]">
          <div>
            <div className="label mb-1">Theme</div>
            <RadioGroup label="Theme" options={THEMES} value={prefs.theme} onChange={theme => setPrefs({ theme })} />
          </div>
          <div>
            <div className="label mb-1">Density</div>
            <RadioGroup label="Density" options={DENSITIES} value={prefs.density} onChange={density => setPrefs({ density })} />
          </div>
          <span className="flex items-center gap-2 text-note text-fg">
            <Checkbox checked={prefs.hud} onChange={() => setPrefs({ hud: !prefs.hud })} label="HUD ornaments" />
            HUD ornaments
          </span>
        </div>
      )}
    </div>
  )
}
