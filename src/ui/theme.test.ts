// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_DEVELOPERS } from '../bridge'

import {
  DEFAULT_PREFS, SCAN_MIN_WIDTH, applyPrefs, applySavedPrefs, loadPrefs, resolveLayout, resolveTheme, savePrefs,
} from './theme'

describe('prefs storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to dark, comfortable and an automatic layout', () => {
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'dark', density: 'comfortable', layout: 'auto', hud: false })
  })

  it('saves per developer', () => {
    savePrefs('a@x.com', { theme: 'light', density: 'compact', layout: 'flow', hud: true })
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'light', density: 'compact', layout: 'flow', hud: true })
    expect(loadPrefs('b@x.com')).toEqual(DEFAULT_PREFS)
    expect(localStorage.getItem('devDashboard.ui.a@x.com')).not.toBeNull()
  })

  it('falls back field by field on bad values', () => {
    localStorage.setItem('devDashboard.ui.a@x.com', JSON.stringify({ theme: 'neon', density: 'compact', layout: 7, hud: 'yes' }))
    expect(loadPrefs('a@x.com')).toEqual({ theme: 'dark', density: 'compact', layout: 'auto', hud: false })
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

  it('sets data-theme, data-density and data-hud', () => {
    applyPrefs({ theme: 'light', density: 'compact', layout: 'auto', hud: true }, false)
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.hud).toBe('on')
  })

  it('applies to any root element it is given', () => {
    const root = document.createElement('div')
    applyPrefs({ theme: 'dark', density: 'comfortable', layout: 'auto', hud: false }, true, root)
    expect(root.dataset).toMatchObject({ theme: 'dark', density: 'comfortable', hud: 'off' })
  })

  it('applySavedPrefs reads the saved developer\'s preferences', () => {
    localStorage.setItem('devDashboard.developer', TEST_DEVELOPERS[1].email)
    savePrefs(TEST_DEVELOPERS[1].email, { theme: 'dark', density: 'compact', layout: 'auto', hud: false })
    applySavedPrefs()
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('applySavedPrefs uses the developer the board defaults to when none is saved', () => {
    savePrefs(TEST_DEVELOPERS[0].email, { theme: 'light', density: 'comfortable', layout: 'auto', hud: false })
    applySavedPrefs()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
