import { useEffect, useRef } from 'react'

import { Button } from './atoms'

// A panel on the right edge holding the queues, so items can be picked from or
// dragged out of them without leaving the page. It is not modal: Esc closes it,
// and a click outside does too, except while something is being dragged (the
// click-catcher steps aside so a card can reach the plan). In a narrow window it
// fills the width, and fades out while a card is dragged so the page shows through.
export function QueueDrawer({ onClose, dragging, wide, dropProps, children }: {
  onClose: () => void
  dragging: boolean
  wide: boolean
  dropProps?: React.HTMLAttributes<HTMLElement> & { 'data-drop'?: 'on' }
  children: React.ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  // What had focus when it opened, read while rendering so a child's autoFocus can't hide it.
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-overlay]')) return
      e.preventDefault()
      close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const back = opener.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  return (
    <>
      {!dragging && <div data-testid="drawer-catcher" aria-hidden onClick={onClose} className="fixed inset-0 z-40 bg-shade/30" />}
      <aside
        ref={panel}
        aria-label="Queues"
        {...dropProps}
        className={[
          'drop-zone fixed inset-y-0 right-0 z-50 flex flex-col border-l border-line-strong bg-surface shadow-[0_0_40px_var(--shadow-modal)]',
          wide ? 'w-[360px]' : 'w-full',
          dragging && !wide ? 'pointer-events-none opacity-0' : '',
        ].join(' ')}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="text-body font-semibold text-ink">Queues</h2>
          <span className="text-meta text-muted">Drag a card to your plan, or press t</span>
          <Button onClick={onClose} aria-label="Close queues" title="Close (Esc)" className="ml-auto">✕</Button>
        </header>
        {children}
      </aside>
    </>
  )
}
