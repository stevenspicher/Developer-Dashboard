import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { checkAll, checkTheme, composite, contrastRatio, parseColor, readTokens } from './contrast'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('parseColor', () => {
  it('reads hex, rgb and rgba in the forms index.css uses', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#0d1626')).toEqual({ r: 13, g: 22, b: 38, a: 1 })
    expect(parseColor('rgba(0, 212, 255, 0.5)')).toEqual({ r: 0, g: 212, b: 255, a: 0.5 })
    expect(parseColor('rgb(255 255 255 / 0.04)')).toEqual({ r: 255, g: 255, b: 255, a: 0.04 })
    expect(parseColor('rgb(0 0 0 / 50%)').a).toBe(0.5)
  })

  it('rejects what it cannot read', () => {
    expect(() => parseColor('transparent')).toThrow()
    expect(() => parseColor('var(--x)')).toThrow()
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#7090a8', '#7090a8')).toBeCloseTo(1, 5)
  })

  it('matches published values for known pairs', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2) // the classic AA grey
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('composites a translucent colour over its background first', () => {
    expect(composite({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
    expect(contrastRatio('rgba(255,255,255,0.5)', '#000000')).toBeLessThan(contrastRatio('#ffffff', '#000000'))
  })
})

describe('the tokens in index.css', () => {
  it('has a dark and a light block with the same token names', () => {
    const dark = Object.keys(readTokens(css, 'dark')).sort()
    const light = Object.keys(readTokens(css, 'light')).sort()
    expect(light).toEqual(dark)
  })

  it('keeps today\'s dark palette', () => {
    const dark = readTokens(css, 'dark')
    expect(dark).toMatchObject({ bg: '#060b14', surface: '#0d1626', muted: '#7090a8', accent: '#00d4ff', ok: '#00ff88', warn: '#ffaa00', danger: '#ff3355' })
  })

  it('passes AA (4.5:1) for every text token on every surface, in both themes', () => {
    const failing = checkAll(css).filter(r => !r.pass).map(r => `${r.theme}: ${r.text} on ${r.surface} ${r.ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('would catch a failing colour', () => {
    const weak = css.replace(/(\[data-theme='light'\] \{[\s\S]*?--muted: )#5a6676/, '$1#a0aec0')
    expect(weak).not.toBe(css)
    expect(checkTheme(weak, 'light').filter(r => !r.pass).map(r => r.text)).toContain('muted')
  })

  it('keeps faint out of the text checks, since it is decoration only', () => {
    expect(checkAll(css).some(r => r.text === 'faint')).toBe(false)
  })
})
