import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// A dimmed full-screen layer with a centred panel. Esc or a click outside
// closes it; focus moves in, Tab stays inside, and focus goes back to what
// opened it when it closes. `className` sizes the panel.
export function Overlay({ onClose, label, className = '', children }: {
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current
    first?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // Keeps Tab and Shift+Tab inside the panel.
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) { e.preventDefault(); return }
    const [first, last] = [items[0], items[items.length - 1]]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div data-overlay onClick={() => onClose()} className="fixed inset-0 z-90 flex items-center justify-center bg-shade/75 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={trap}
        className={`panel flex max-w-[calc(100vw-32px)] flex-col border-line-strong shadow-[0_0_60px_var(--glow),0_0_120px_var(--shadow-modal)] outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
