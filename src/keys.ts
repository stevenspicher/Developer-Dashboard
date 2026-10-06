import type React from 'react'

export type RowAction = 'open' | 'start' | 'add' | 'toggle' | 'done' | 'block' | 'remove' | 'up' | 'down'

// Keyboard shortcuts for a focusable row (tabIndex 0, data-row, inside a
// data-rows list). j/k or the arrow keys move between rows; Alt+↑/↓ reorder;
// the other keys act on the row. When an action takes the row away (add,
// done, block, remove), focus moves to its neighbour.
export function rowKeys(actions: Partial<Record<RowAction, () => void>>) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return
    const row = e.currentTarget
    const rows = Array.from(row.closest('[data-rows]')?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
    const i = rows.indexOf(row)
    const run = (name: RowAction, leavesList = false) => {
      const action = actions[name]
      if (!action) return false
      const neighbour = rows[i + 1] ?? rows[i - 1]
      action()
      if (leavesList) requestAnimationFrame(() => { if (!row.isConnected) neighbour?.focus() })
      return true
    }

    let handled = false
    if (e.altKey) {
      if (e.key === 'ArrowUp') handled = run('up')
      else if (e.key === 'ArrowDown') handled = run('down')
    } else {
      switch (e.key) {
        case 'j': case 'ArrowDown': rows[i + 1]?.focus(); handled = true; break
        case 'k': case 'ArrowUp': rows[i - 1]?.focus(); handled = true; break
        case 'Enter': handled = run('open'); break
        case 's': handled = run('start'); break
        case 't': handled = run('add', true); break
        case 'x': case ' ': handled = run('toggle'); break
        case 'd': handled = run('done', true); break
        case 'b': handled = run('block', true); break
        case 'Delete': case 'Backspace': handled = run('remove', true); break
      }
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
}

// Focuses the first row of a list, e.g. from a global shortcut.
export function focusFirstRow(list: string) {
  document.querySelector<HTMLElement>(`[data-rows="${list}"] [data-row]`)?.focus()
}
