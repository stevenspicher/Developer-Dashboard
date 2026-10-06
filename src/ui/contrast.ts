// WCAG 2.x contrast for the colour tokens in index.css, so a theme can't ship
// text that fails AA. Colours with alpha are composited over the surface they
// sit on.

export interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (n: number) => Math.min(255, Math.max(0, n))

// #rgb, #rrggbb, rgb(), rgba(), commas or spaces, an optional "/ alpha".
export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase()
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map(Number)
      const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : Number(parts[3])
      if ([r, g, b, a].every(Number.isFinite)) return { r: clamp(r), g: clamp(g), b: clamp(b), a }
    }
  }
  throw new Error(`Can't read the colour "${value}"`)
}

// `top` drawn over an opaque `bottom`.
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  }
}

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export const luminance = ({ r, g, b }: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

export function contrastRatio(text: string, background: string): number {
  const bg = parseColor(background)
  const fg = composite(parseColor(text), bg)
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

// ─── Reading the tokens ───────────────────────────────────────────────────────

export type ThemeName = 'dark' | 'light'

// The declarations of the dark (:root) or light ([data-theme='light']) block.
export function readTokens(css: string, theme: ThemeName): Record<string, string> {
  const selector = theme === 'dark' ? /:root,\s*\[data-theme='dark'\]\s*\{/ : /\[data-theme='light'\]\s*\{/
  const start = css.search(selector)
  if (start < 0) throw new Error(`No ${theme} token block found`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const tokens: Record<string, string> = {}
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim()
  return tokens
}

// ─── The checks ───────────────────────────────────────────────────────────────

// Text colours, and the surfaces they must read on. --faint is decoration only.
export const TEXT_TOKENS = ['ink', 'fg', 'dim', 'muted', 'accent', 'ok', 'warn', 'danger', 'danger-fg'] as const
export const SURFACE_TOKENS = ['bg', 'surface', 'sunken', 'raised'] as const
export const MIN_RATIO = 4.5

export interface ContrastResult {
  theme: ThemeName
  text: string
  surface: string
  ratio: number
  pass: boolean
}

export function checkTheme(css: string, theme: ThemeName): ContrastResult[] {
  const tokens = readTokens(css, theme)
  const results: ContrastResult[] = []
  const add = (text: string, surface: string) => {
    const ratio = contrastRatio(tokens[text], tokens[surface])
    results.push({ theme, text, surface, ratio, pass: ratio >= MIN_RATIO })
  }
  for (const text of TEXT_TOKENS) for (const surface of SURFACE_TOKENS) add(text, surface)
  // The boot terminal's text on its own background.
  add('phosphor', 'boot-bg')
  return results
}

export const checkAll = (css: string) => [...checkTheme(css, 'dark'), ...checkTheme(css, 'light')]
