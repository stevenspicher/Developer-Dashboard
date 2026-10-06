// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFS, FORCE_DARK, SCAN_MIN_WIDTH, applyPrefs, applySavedPrefs, loadPrefs, resolveLayout, resolveTheme, savePrefs,
} from './theme'

describe('prefs storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to dark, comfortable and an automatic layout', () => {
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'dark', density: 'comfortable', layout: 'auto' })
  })

  it('saves per developer', () => {
    savePrefs('a@x.com', { theme: 'light', density: 'compact', layout: 'flow' })
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'light', density: 'compact', layout: 'flow' })
    expect(loadPrefs('b@x.com')).toEqual(DEFAULT_PREFS)
    expect(localStorage.getItem('devDashboard.ui.a@x.com')).not.toBeNull()
  })

  it('falls back field by field on bad values', () => {
    localStorage.setItem('devDashboard.ui.a@x.com', JSON.stringify({ theme: 'neon', density: 'compact', layout: 7 }))
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'dark', density: 'compact', layout: 'auto' })
    localStorage.setItem('devDashboard.ui.a@x.com', '{nope')
    expect(loadPrefs('a@x.com')).toEqual(DEFAULT_PREFS)
    localStorage.setItem('devDashboard.ui.a@x.com', 'null')
    expect(loadPrefs('a@x.com')).toEqual(DEFAULT_PREFS)
  })
})

describe('resolving', () => {
  it('resolveTheme follows the system only for "system", and is dark when unknown', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', null)).toBe('dark')
  })

  it('resolveLayout picks Scan from 1100px up and Flow below, unless chosen', () => {
    expect(resolveLayout('auto', SCAN_MIN_WIDTH)).toBe('scan')
    expect(resolveLayout('auto', SCAN_MIN_WIDTH - 1)).toBe('flow')
    expect(resolveLayout('flow', 1920)).toBe('flow')
    expect(resolveLayout('scan', 800)).toBe('scan')
  })
})

describe('applying', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
  })

  it('sets data-density, and data-theme (dark while the only layout is dark-only)', () => {
    applyPrefs({ theme: 'light', density: 'compact', layout: 'auto' }, false)
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.theme).toBe(FORCE_DARK ? 'dark' : 'light')
  })

  it('applies to any root element it is given', () => {
    const root = document.createElement('div')
    applyPrefs({ theme: 'dark', density: 'comfortable', layout: 'auto' }, true, root)
    expect(root.dataset).toMatchObject({ theme: 'dark', density: 'comfortable' })
  })

  it('applySavedPrefs reads the saved developer\'s preferences', () => {
    localStorage.setItem('devDashboard.developer', 'a@x.com')
    savePrefs('a@x.com', { theme: 'dark', density: 'compact', layout: 'auto' })
    applySavedPrefs()
    expect(document.documentElement.dataset.density).toBe('compact')
  })
})
