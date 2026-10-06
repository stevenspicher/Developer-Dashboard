// @vitest-environment jsdom
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { focusFirstRow, rowKeys } from './keys'

// Three rows in one list; `press` sends a key to the middle row's handler.
function setup(actions: Parameters<typeof rowKeys>[0]) {
  document.body.innerHTML = '<div data-rows="plan"><div data-row tabindex="0" id="r1"></div><div data-row tabindex="0" id="r2"></div><div data-row tabindex="0" id="r3"></div></div>'
  const rows = ['r1', 'r2', 'r3'].map(id => document.getElementById(id)!)
  const handler = rowKeys(actions)
  const press = (key: string, init: Partial<KeyboardEvent> = {}, row = rows[1], target: EventTarget = row) => {
    const event = {
      key, currentTarget: row, target, metaKey: false, ctrlKey: false, altKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init,
    }
    handler(event as unknown as React.KeyboardEvent<HTMLElement>)
    return event
  }
  return { rows, press }
}

describe('rowKeys', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('moves focus between rows with j/k and the arrow keys', () => {
    const { rows, press } = setup({})
    press('j')
    expect(document.activeElement).toBe(rows[2])
    press('k')
    expect(document.activeElement).toBe(rows[0])
    press('ArrowDown')
    expect(document.activeElement).toBe(rows[2])
    press('ArrowUp')
    expect(document.activeElement).toBe(rows[0])
  })

  it('stays put at the ends of the list', () => {
    const { rows, press } = setup({})
    rows[0].focus()
    press('k', {}, rows[0])
    expect(document.activeElement).toBe(rows[0])
  })

  it('runs the matching action and stops the key reaching other handlers', () => {
    const open = vi.fn(), start = vi.fn(), toggle = vi.fn()
    const { press } = setup({ open, start, toggle })
    const event = press('Enter')
    expect(open).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    press('s')
    press('x')
    press(' ')
    expect(start).toHaveBeenCalledOnce()
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('maps t, d, b and Delete to add, done, block and remove', () => {
    const add = vi.fn(), done = vi.fn(), block = vi.fn(), remove = vi.fn()
    const { press } = setup({ add, done, block, remove })
    press('t'); press('d'); press('b'); press('Delete'); press('Backspace')
    expect([add, done, block].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('reorders with Alt+Arrow, and not with a plain arrow', () => {
    const up = vi.fn(), down = vi.fn()
    const { press } = setup({ up, down })
    press('ArrowUp', { altKey: true })
    press('ArrowDown', { altKey: true })
    expect([up.mock.calls.length, down.mock.calls.length]).toEqual([1, 1])
  })

  it('ignores a key without a matching action, so other handlers still see it', () => {
    const { press } = setup({})
    const event = press('d')
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('ignores keys pressed in something inside the row, and Ctrl or Cmd combinations', () => {
    const open = vi.fn()
    const { rows, press } = setup({ open })
    press('Enter', {}, rows[1], document.createElement('input'))
    press('Enter', { ctrlKey: true })
    press('Enter', { metaKey: true })
    expect(open).not.toHaveBeenCalled()
  })

  it('moves focus to a neighbour when an action takes the row away', async () => {
    const { rows, press } = setup({ done: () => rows[1].remove() })
    press('d')
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    expect(document.activeElement).toBe(rows[2])
  })
})

describe('focusFirstRow', () => {
  it('focuses the first row of the named list', () => {
    const { rows } = setup({})
    focusFirstRow('plan')
    expect(document.activeElement).toBe(rows[0])
  })

  it('does nothing when the list is missing', () => {
    document.body.innerHTML = ''
    expect(() => focusFirstRow('plan')).not.toThrow()
  })
})
