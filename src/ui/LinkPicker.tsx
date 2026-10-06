import { useMemo, useState } from 'react'

import { focusFirstRow, rowKeys } from '../keys'
import { rankByTitle } from '../plan'
import type { PlanEntry } from '../plan'
import type { Task } from '../types'
import { Button, Chip, Ref, TypeChip } from './atoms'
import { Overlay } from './Overlay'

// Links a plan entry to a board item: the closest titles first, filterable by
// title or ref. Enter links the first match; the down arrow moves into the list.
export function LinkPicker({ entry, tasks, onLink, onUnlink, onClose }: {
  entry: PlanEntry
  tasks: Task[]
  onLink: (task: Task) => void
  onUnlink: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => {
    const scores = new Map(rankByTitle(entry.text, tasks).map(r => [r.task.id, r.score]))
    const q = query.trim().toLowerCase()
    return tasks
      .filter(t => !q || t.title.toLowerCase().includes(q) || (t.ref ?? '').toLowerCase().includes(q))
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
  }, [entry.text, tasks, query])

  return (
    <Overlay label="Link to a board item" onClose={onClose} className="max-h-[80vh] w-[640px]">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="text-note font-semibold text-ink">Link to a board item</span>
        <span className="ml-auto" />
        <Button onClick={onClose} aria-label="Close" title="Close (Esc)">✕</Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="text-body text-fg">{entry.text}</div>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && candidates[0]) onLink(candidates[0])
            if (e.key === 'ArrowDown') { e.preventDefault(); focusFirstRow('picker') }
          }}
          aria-label="Filter by title or ref"
          placeholder="Filter by title or ref"
          className="rounded-xs border border-line bg-sunken px-2.5 py-1.5 text-body text-fg outline-none placeholder:text-muted focus:border-focus"
        />
        <div data-rows="picker" className="min-h-0 flex-1 overflow-y-auto">
          {candidates.map(t => (
            <div
              key={t.id}
              data-row
              tabIndex={0}
              onClick={() => onLink(t)}
              onKeyDown={rowKeys({ open: () => onLink(t) })}
              className="row flex cursor-pointer items-center gap-2 border-b border-line-soft px-1 py-1.5"
            >
              <TypeChip type={t.type} />
              <Ref>{t.ref}</Ref>
              <span className="min-w-0 flex-1 truncate text-note text-fg">{t.title}</span>
              {t.id === entry.itemId && <Chip tone="ok">Linked</Chip>}
            </div>
          ))}
          {candidates.length === 0 && <div className="py-3 text-note text-muted">No items match.</div>}
        </div>
        {entry.itemId && <Button className="self-start" onClick={onUnlink}>Remove link</Button>}
      </div>
    </Overlay>
  )
}
