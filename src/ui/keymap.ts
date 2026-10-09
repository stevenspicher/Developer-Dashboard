import type { RowAction } from '../keys'

// The keyboard shortcuts of the list-and-pane layouts, in one table. The row
// handlers (`rowKeys`) and the footer hints are both built from it, and a test
// presses every key here, so a hint can't advertise a key that does nothing.

export interface RowKey {
  keys: string[]      // the keys that trigger it ("j", "Enter", "Alt+ArrowUp")
  action: RowAction   // the action it runs on a focused row
  hint: string        // how the footer names it ("j k")
  label: string       // what it does
}

export const ROW_KEYS: RowKey[] = [
  { keys: ['Enter'], action: 'open', hint: 'Enter', label: 'open' },
  { keys: ['s'], action: 'start', hint: 's', label: 'start' },
  { keys: ['t'], action: 'add', hint: 't', label: 'add to plan' },
  { keys: ['x', ' '], action: 'toggle', hint: 'x', label: 'tick' },
  { keys: ['d'], action: 'done', hint: 'd', label: 'done' },
  { keys: ['b'], action: 'block', hint: 'b', label: 'block' },
  { keys: ['Delete', 'Backspace'], action: 'remove', hint: 'Del', label: 'remove' },
  { keys: ['Alt+ArrowUp'], action: 'up', hint: 'Alt ↑', label: 'move up' },
  { keys: ['Alt+ArrowDown'], action: 'down', hint: 'Alt ↓', label: 'move down' },
]

// Moving between rows works on every list, whatever the row can do.
export const MOVE_HINT = { hint: 'j k', label: 'move' }

export type Filter = 'plan' | 'queue' | 'next' | 'reviews' | 'blocked' | 'team' | 'requests'

// Keys that act on the whole layout, not a row.
export interface GlobalKey {
  key: string
  filter?: Filter     // switches to this list and focuses its first row
  label: string
}

export const GLOBAL_KEYS: GlobalKey[] = [
  { key: 'p', filter: 'plan', label: 'plan' },
  { key: 'q', filter: 'queue', label: 'queue' },
  { key: 'n', filter: 'next', label: 'up next' },
  { key: 'r', filter: 'reviews', label: 'open pull requests' },
]

export const filterForKey = (key: string): Filter | undefined => GLOBAL_KEYS.find(g => g.key === key)?.filter

// Flow: one column of sections instead of lists, so the keys jump to a section
// (or open the queues drawer) rather than switching a filter.
export type FlowTarget = 'plan' | 'next' | 'reviews' | 'drawer'

export const FLOW_KEYS: { key: string; target: FlowTarget; label: string }[] = [
  { key: 'p', target: 'plan', label: 'plan' },
  { key: 'n', target: 'next', label: 'up next' },
  { key: 'r', target: 'reviews', label: 'open pull requests' },
  { key: 'q', target: 'drawer', label: 'queues' },
]

export const flowTargetForKey = (key: string): FlowTarget | undefined => FLOW_KEYS.find(g => g.key === key)?.target

// The footer hints for a row that can do `available`: movement, each key whose
// action it has (in table order), then the shortcuts that jump elsewhere.
export function hintsFor(available: Iterable<RowAction>, layout: 'lists' | 'flow' = 'lists'): { hint: string; label: string }[] {
  const have = new Set(available)
  const jump = layout === 'flow'
    ? { hint: FLOW_KEYS.map(g => g.key).join(' '), label: 'jump to a section' }
    : { hint: GLOBAL_KEYS.map(g => g.key).join(' '), label: 'jump to a list' }
  return [MOVE_HINT, ...ROW_KEYS.filter(k => have.has(k.action)), jump]
}
