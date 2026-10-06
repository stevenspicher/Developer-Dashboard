import { DEVELOPER_STORAGE_KEY } from '../bridge'

// The look a developer has chosen: theme, density and layout. Saved per
// developer in this browser (devDashboard.ui.<email>) and applied to <html> as
// data-theme and data-density, which the tokens in index.css respond to.

export type Theme = 'dark' | 'light' | 'system'
export type Density = 'comfortable' | 'compact'
// 'auto' picks Scan on wide windows and Flow on narrow ones.
export type Layout = 'auto' | 'scan' | 'flow'

export interface UiPrefs {
  theme: Theme
  density: Density
  layout: Layout
}

// Dark is the default for the first release; System becomes the default once
// the light theme has had real use.
export const DEFAULT_PREFS: UiPrefs = { theme: 'dark', density: 'comfortable', layout: 'auto' }

// Windows at least this wide get Scan when the layout is 'auto'.
export const SCAN_MIN_WIDTH = 1100

// The only layout that exists today is not ready for the light theme, so it
// stays dark whatever is saved. Turn this off when Scan and Flow ship.
export const FORCE_DARK = true

const THEMES: Theme[] = ['dark', 'light', 'system']
const DENSITIES: Density[] = ['comfortable', 'compact']
const LAYOUTS: Layout[] = ['auto', 'scan', 'flow']

const prefsKey = (developer: string) => `devDashboard.ui.${developer}`

const pick = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

export function loadPrefs(developer: string): UiPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey(developer)) ?? 'null')
    if (saved && typeof saved === 'object') {
      return {
        theme: pick(saved.theme, THEMES, DEFAULT_PREFS.theme),
        density: pick(saved.density, DENSITIES, DEFAULT_PREFS.density),
        layout: pick(saved.layout, LAYOUTS, DEFAULT_PREFS.layout),
      }
    }
  } catch { /* storage unavailable or corrupt */ }
  return DEFAULT_PREFS
}

export function savePrefs(developer: string, prefs: UiPrefs) {
  try { localStorage.setItem(prefsKey(developer), JSON.stringify(prefs)) } catch { /* storage unavailable */ }
}

// 'system' follows the operating system, and is dark when that isn't known.
export const resolveTheme = (theme: Theme, systemDark: boolean | null): 'dark' | 'light' =>
  theme === 'system' ? (systemDark === false ? 'light' : 'dark') : theme

export const resolveLayout = (layout: Layout, width: number): 'scan' | 'flow' =>
  layout === 'auto' ? (width >= SCAN_MIN_WIDTH ? 'scan' : 'flow') : layout

export const systemPrefersDark = (): boolean | null =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : null

// Sets data-theme and data-density on the root element.
export function applyPrefs(prefs: UiPrefs, systemDark: boolean | null = systemPrefersDark(), root: HTMLElement = document.documentElement) {
  root.dataset.theme = FORCE_DARK ? 'dark' : resolveTheme(prefs.theme, systemDark)
  root.dataset.density = prefs.density
}

// Applied before the first paint, so the boot screen already has the saved look.
export function applySavedPrefs() {
  let developer = ''
  try { developer = localStorage.getItem(DEVELOPER_STORAGE_KEY) ?? '' } catch { /* storage unavailable */ }
  applyPrefs(loadPrefs(developer))
}
