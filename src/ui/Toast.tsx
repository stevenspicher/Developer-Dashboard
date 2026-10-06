// A short message at the bottom of the screen, with an optional UNDO. It is
// announced to screen readers; the owner decides how long it stays.
export function Toast({ text, onUndo, onDismiss }: { text: string; onUndo?: () => void; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-150 flex -translate-x-1/2 items-center gap-3 rounded-sm border border-line-strong bg-raised px-4 py-2 shadow-[0_8px_30px_var(--shadow-toast)]"
    >
      <span className="text-body text-fg">{text}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} className="text-note font-semibold text-accent hover:underline focus-visible:outline-1 focus-visible:outline-focus">
          Undo
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="text-muted hover:text-fg">✕</button>
      )}
    </div>
  )
}
