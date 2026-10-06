import { useEffect, useRef, useState } from 'react'

// The standup update, editable and ready to copy. It follows the board until
// you edit it; after that your text stays, and RESET rebuilds it.
export function StandupDraft({ draft }: { draft: string }) {
  const [text, setText] = useState(draft)
  const [edited, setEdited] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => { if (!edited) setText(draft) }, [draft, edited])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard access can be refused; selecting the text lets the user copy it by hand.
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Standup draft"]')?.select()
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 py-1">
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setEdited(true) }}
        aria-label="Standup draft"
        spellCheck={false}
        className="min-h-0 flex-1 resize-none rounded-xs border border-line-soft bg-sunken px-3 py-2.5 font-mono text-note leading-relaxed text-fg focus:border-accent/50 focus:outline-none"
      />
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn-quiet" onClick={() => void copy()}>{copied ? 'COPIED ✓' : 'COPY'}</button>
        <button className="btn-quiet" onClick={() => { setText(draft); setEdited(false) }} disabled={!edited}>RESET</button>
        <span className="font-mono text-meta text-muted">
          {edited ? 'Edited. RESET rebuilds it from your board.' : 'Built from your plan, what you finished, reviews and blockers.'}
        </span>
      </div>
    </div>
  )
}
