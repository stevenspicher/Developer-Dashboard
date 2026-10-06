// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { click, key, mount } from '../test/render'
import { QueueDrawer } from './QueueDrawer'

afterEach(() => { document.body.innerHTML = '' })

const drawer = (props: Partial<React.ComponentProps<typeof QueueDrawer>> = {}) => {
  const onClose = vi.fn()
  const ui = mount(<QueueDrawer onClose={onClose} dragging={false} wide {...props}><button>card</button></QueueDrawer>)
  return { ui, onClose }
}

describe('QueueDrawer', () => {
  it('closes on Esc, on its close button and on a click outside', () => {
    const { ui, onClose } = drawer()
    key(window, 'Escape')
    click(ui.container.querySelector('button[aria-label="Close queues"]')!)
    click(ui.container.querySelector('[data-testid=drawer-catcher]')!)
    expect(onClose).toHaveBeenCalledTimes(3)
    ui.unmount()
  })

  it('leaves Esc to an open dialog above it', () => {
    const { ui, onClose } = drawer()
    document.body.insertAdjacentHTML('beforeend', '<div data-overlay></div>')
    key(window, 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    ui.unmount()
  })

  it('drops its click-catcher while a card is dragged, so the card can reach the page', () => {
    const { ui } = drawer({ dragging: true })
    expect(ui.container.querySelector('[data-testid=drawer-catcher]')).toBeNull()
    expect(ui.container.querySelector('aside')).not.toBeNull()
    ui.unmount()
  })

  it('fills the width in a narrow window, and steps aside while dragging', () => {
    const { ui } = drawer({ wide: false, dragging: true })
    const aside = ui.container.querySelector('aside')!
    expect(aside.className).toContain('w-full')
    expect(aside.className).toContain('opacity-0')
    ui.unmount()
  })

  it('gives focus back to what opened it', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { ui } = drawer()
    ui.unmount()
    expect(document.activeElement).toBe(opener)
  })
})
