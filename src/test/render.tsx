import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

// Renders a component into the jsdom page and gives back helpers to drive it.
// Tests that use it start with `// @vitest-environment jsdom`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    render: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => { act(() => root.unmount()); container.remove() },
  }
}

// Runs a DOM interaction inside act() so React flushes its updates.
export const run = (fn: () => void) => act(fn)

export const click = (el: Element) => run(() => (el as HTMLElement).click())

export const key = (target: Element | Window, key: string, init: KeyboardEventInit = {}) =>
  run(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })) })
