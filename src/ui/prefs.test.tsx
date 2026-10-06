// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { click, key, mount } from '../test/render'
import { RadioGroup } from './atoms'
import { LookMenu, ModeSwitcher } from './LookControls'
import { PrefsProvider, usePrefs } from './prefs'
import { loadPrefs, savePrefs, DEFAULT_PREFS } from './theme'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme') })
afterEach(() => { document.body.innerHTML = '' })

const Layout = () => <output>{usePrefs().layout}</output>
const app = (developer = 'a@x.com', override?: 'scan' | 'flow' | 'classic') => (
  <PrefsProvider developer={developer} override={override}>
    <ModeSwitcher /><LookMenu /><Layout />
  </PrefsProvider>
)
const radio = (c: HTMLElement, name: string) => [...c.querySelectorAll<HTMLElement>('[role=radio]')].find(r => r.textContent === name)!

describe('RadioGroup', () => {
  it('has one tab stop and moves the choice with the arrow keys', () => {
    let value = 'a'
    const options = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
    const ui = mount(<RadioGroup label="Pick" options={options} value={value} onChange={v => { value = v }} />)
    const radios = [...ui.container.querySelectorAll('[role=radio]')]
    expect(radios.map(r => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    key(radios[0], 'ArrowLeft')
    expect(value).toBe('c')
    key(radios[0], 'ArrowRight')
    expect(value).toBe('b')
    ui.unmount()
  })
})

describe('PrefsProvider, ModeSwitcher and LookMenu', () => {
  it('shows the layout by window width until one is chosen, then keeps the choice', () => {
    const ui = mount(app())
    expect(ui.container.querySelector('output')!.textContent).toBe('flow') // jsdom has no matchMedia, so "narrow"
    expect(radio(ui.container, 'Auto').getAttribute('aria-checked')).toBe('true')
    click(radio(ui.container, 'Scan'))
    expect(ui.container.querySelector('output')!.textContent).toBe('scan')
    expect(loadPrefs('a@x.com').layout).toBe('scan')
    ui.unmount()
  })

  it('lets the address choose a layout until the developer picks one', () => {
    const ui = mount(app('a@x.com', 'classic'))
    expect(ui.container.querySelector('output')!.textContent).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('dark')
    click(radio(ui.container, 'Flow'))
    expect(ui.container.querySelector('output')!.textContent).toBe('flow')
    ui.unmount()
  })

  it('changes and saves the theme, density and ornaments from the menu, and applies them', () => {
    const ui = mount(app())
    click(ui.container.querySelector('button[aria-haspopup]')!)
    click(radio(ui.container, 'Light'))
    click(radio(ui.container, 'Compact'))
    click(ui.container.querySelector('[role=checkbox]')!)
    expect(loadPrefs('a@x.com')).toMatchObject({ theme: 'light', density: 'compact', hud: true })
    expect(document.documentElement.dataset).toMatchObject({ theme: 'light', density: 'compact', hud: 'on' })
    key(window, 'Escape')
    expect(ui.container.querySelector('[role=group]')).toBeNull()
    ui.unmount()
  })

  it('loads each developer\'s own look when the developer changes', () => {
    savePrefs('b@x.com', { ...DEFAULT_PREFS, theme: 'light', layout: 'flow' })
    const ui = mount(app('a@x.com'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    ui.render(app('b@x.com'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(ui.container.querySelector('output')!.textContent).toBe('flow')
    ui.unmount()
  })
})
