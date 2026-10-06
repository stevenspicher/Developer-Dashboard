import { loadDeveloper } from '../bridge'

// The look a developer has chosen: theme, density, layout and the HUD ornaments.
// Saved per developer in this browser (devDashboard.ui.<email>) and applied to
// <html> as data-theme, data-density and data-hud, which index.css responds to.

export type Theme = 'dark' | 'light' | 'system'
export type Density = 'comfortable' | 'compact'
// 'auto' picks Scan on wide windows and Flow on narrow ones.
export type Layout = 'auto' | 'scan' | 'flow'

export interface UiPrefs {
  theme: Theme
  density: Density
  layout: Layout
  // Corner brackets and a glowing top edge on panels, as the original look had.
  hud: boolean
}

// Dark is the default for the first release; System becomes the default once
// the light theme has had real use.
export const DEFAULT_PREFS: UiPrefs = { theme: 'dark', density: 'comfortable', layout: 'auto', hud: false }

// Windows at least this wide get Scan when the layout is 'auto'.
export const SCAN_MIN_WIDTH = 1100

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
        hud: typeof saved.hud === 'boolean' ? saved.hud : DEFAULT_PREFS.hud,
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

// Sets data-theme, data-density and data-hud on the root element.
export function applyPrefs(prefs: UiPrefs, systemDark: boolean | null = systemPrefersDark(), root: HTMLElement = document.documentElement) {
  root.dataset.theme = resolveTheme(prefs.theme, systemDark)
  root.dataset.density = prefs.density
  root.dataset.hud = prefs.hud ? 'on' : 'off'
}

// Applied before the first paint, so the boot screen already has the saved look.
// The developer is the one the board will show (the first test developer when
// none is saved), so the look doesn't change once the board loads.
export function applySavedPrefs() {
  applyPrefs(loadPrefs(loadDeveloper()))
}
