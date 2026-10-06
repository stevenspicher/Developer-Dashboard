// @vitest-environment jsdom
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RowAction } from '../keys'
import { rowKeys } from '../keys'
import { FLOW_KEYS, GLOBAL_KEYS, MOVE_HINT, ROW_KEYS, filterForKey, flowTargetForKey, hintsFor } from './keymap'

// Presses `combo` ("t", "Alt+ArrowUp") on a row that only has `action`.
function press(action: RowAction, combo: string) {
  document.body.innerHTML = '<div data-rows="x"><div data-row id="r"></div></div>'
  const row = document.getElementById('r')!
  const fn = vi.fn()
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  rowKeys({ [action]: fn })({
    key, currentTarget: row, target: row, altKey: parts.includes('Alt'), metaKey: false, ctrlKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement>)
  return fn
}

describe('ROW_KEYS', () => {
  it('has every key it lists actually run its action', () => {
    for (const k of ROW_KEYS) {
      for (const combo of k.keys) expect(press(k.action, combo), `${combo} should run ${k.action}`).toHaveBeenCalledOnce()
    }
  })

  it('lists each action once, so the footer never repeats a hint', () => {
    const actions = ROW_KEYS.map(k => k.action)
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('covers every action a row can have, except movement', () => {
    const all: RowAction[] = ['open', 'start', 'add', 'toggle', 'done', 'block', 'remove', 'up', 'down']
    expect(ROW_KEYS.map(k => k.action).sort()).toEqual([...all].sort())
  })
})

describe('GLOBAL_KEYS', () => {
  it('maps each key to its list, and nothing else', () => {
    for (const g of GLOBAL_KEYS) expect(filterForKey(g.key)).toBe(g.filter)
    expect(filterForKey('z')).toBeUndefined()
  })

  it('does not reuse a key that a row already answers to', () => {
    const rowKeyNames = new Set(ROW_KEYS.flatMap(k => k.keys))
    for (const g of GLOBAL_KEYS) expect(rowKeyNames.has(g.key), `${g.key} is also a row key`).toBe(false)
  })
})

describe('hintsFor', () => {
  it('shows movement, the keys for the actions a row has, and the list shortcuts', () => {
    const hints = hintsFor(['open', 'start', 'add'])
    expect(hints.map(h => h.label)).toEqual(['move', 'open', 'start', 'add to plan', 'jump to a list'])
    expect(hints[0]).toEqual(MOVE_HINT)
    expect(hints.at(-1)?.hint).toBe(GLOBAL_KEYS.map(g => g.key).join(' '))
  })

  it('never advertises a key for an action the row does not have', () => {
    const labels = hintsFor(['open']).map(h => h.label)
    expect(labels).not.toContain('start')
    expect(labels).not.toContain('done')
  })

  it('keeps the table order whatever order the actions arrive in', () => {
    expect(hintsFor(['block', 'open']).map(h => h.label)).toEqual(['move', 'open', 'block', 'jump to a list'])
  })
})

describe('FLOW_KEYS', () => {
  it('maps each key to its target, and nothing else', () => {
    for (const g of FLOW_KEYS) expect(flowTargetForKey(g.key)).toBe(g.target)
    expect(flowTargetForKey('z')).toBeUndefined()
  })

  it('does not reuse a key that a row already answers to', () => {
    const rowKeyNames = new Set(ROW_KEYS.flatMap(k => k.keys))
    for (const g of FLOW_KEYS) expect(rowKeyNames.has(g.key), `${g.key} is also a row key`).toBe(false)
  })

  it('ends the hints with the section shortcuts in a flow layout', () => {
    const last = hintsFor(['open'], 'flow').at(-1)
    expect(last).toEqual({ hint: 'p n r q', label: 'jump to a section' })
  })
})
