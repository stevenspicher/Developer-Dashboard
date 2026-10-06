import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { applyPrefs, loadPrefs, resolveLayout, savePrefs, SCAN_MIN_WIDTH, systemPrefersDark } from './theme'
import type { UiPrefs } from './theme'
import { useMediaQuery } from './useMediaQuery'

// The saved look for the developer being viewed, shared with whatever needs to
// show or change it. Changing it saves it (per developer, in this browser) and
// applies it to <html> straight away; switching developer loads theirs.

export type ActiveLayout = 'scan' | 'flow' | 'classic'

interface PrefsValue {
  prefs: UiPrefs
  setPrefs: (patch: Partial<UiPrefs>) => void
  // What is showing: the chosen layout, or Scan or Flow by window width when it is 'auto'.
  layout: ActiveLayout
}

const PrefsContext = createContext<PrefsValue | null>(null)

// `override` is a layout named in the address (/?ui=flow, /?ui=classic). It wins
// until the developer picks a layout themselves.
export function PrefsProvider({ developer, override, children }: { developer: string; override?: ActiveLayout | null; children: ReactNode }) {
  const [state, setState] = useState(() => ({ developer, prefs: loadPrefs(developer) }))
  const [overridden, setOverridden] = useState(override ?? null)
  // Another developer: their saved look replaces this one, in the same render.
  const prefs = state.developer === developer ? state.prefs : loadPrefs(developer)
  if (state.developer !== developer) setState({ developer, prefs })

  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (!window.matchMedia) return
    const list = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])

  // The classic layout has no light theme, so it stays dark.
  const classic = overridden === 'classic'
  useEffect(() => { applyPrefs(classic ? { ...prefs, theme: 'dark' } : prefs, systemDark) }, [prefs, systemDark, classic])

  const setPrefs = useCallback((patch: Partial<UiPrefs>) => {
    const next = { ...prefs, ...patch }
    setState({ developer, prefs: next })
    savePrefs(developer, next)
    if (patch.layout) setOverridden(null)
  }, [developer, prefs])

  const wide = useMediaQuery(`(min-width: ${SCAN_MIN_WIDTH}px)`)
  const layout: ActiveLayout = overridden ?? resolveLayout(prefs.layout, wide ? SCAN_MIN_WIDTH : 0)
  const value = useMemo(() => ({ prefs, setPrefs, layout }), [prefs, setPrefs, layout])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsValue {
  const value = useContext(PrefsContext)
  if (!value) throw new Error('usePrefs must be used inside a PrefsProvider')
  return value
}
