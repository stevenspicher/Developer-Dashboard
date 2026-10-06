import { useEffect, useState } from 'react'

import { queueFor } from '../../bridge'
import type { Task } from '../../types'
import { Button, SectionLabel } from '../atoms'
import { useCockpit } from './context'
import { errorText } from './load'

// Unsaved text survives closing the panel or switching tasks.
const drafts = new Map<string, string>()

// For tests: forget any unsaved text.
export const resetNoteDrafts = () => drafts.clear()

// A note on the item, saved with the button or Ctrl/⌘+Enter: a comment on an
// ADO story, or a section of the item's Notion page.
export function NotesPanel({ task }: { task: Task }) {
  const { developer } = useCockpit()
  const notes = queueFor(task)?.notes
  const key = notes ? `notes:${task.queue}:${task.id}` : null
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | { error: string }>('loading')
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!key || !notes) return
    let live = true
    setState('loading')
    setJustSaved(false)
    notes.load(task)
      .then(text => {
        if (!live) return
        setSaved(text)
        setDraft(drafts.get(key) ?? text)
        setState('ready')
      })
      .catch(e => { if (live) setState({ error: errorText(e) }) })
    return () => { live = false }
    // The task is the same item while its id and queue are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key || !notes) return null

  const dirty = saved !== null && draft !== saved
  const setText = (text: string) => {
    setDraft(text)
    setJustSaved(false)
    if (text === saved) drafts.delete(key)
    else drafts.set(key, text)
  }
  const save = async () => {
    if (!dirty || state === 'saving') return
    const text = draft.trimEnd()
    setState('saving')
    try {
      await notes.save(task, text, developer)
      setSaved(text)
      setDraft(text)
      drafts.delete(key)
      setState('ready')
      setJustSaved(true)
    } catch (e) {
      setState({ error: `Couldn't save: ${errorText(e)}` })
    }
  }

  const target = task.source === 'stories' ? 'a comment on the ADO story' : "the item's Notion page"
  const failed = typeof state === 'object'
  return (
    <div>
      <SectionLabel>NOTES</SectionLabel>
      {state === 'loading' ? (
        <span className="text-meta text-muted">Loading…</span>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save() } }}
            disabled={saved === null}
            rows={4}
            placeholder="Decisions, blockers, who you spoke to…"
            aria-label="Notes"
            className="w-full resize-y rounded-xs border border-line-soft bg-sunken px-2 py-1.5 text-body text-fg placeholder:text-muted focus:border-focus focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button disabled={!dirty || state === 'saving'} onClick={() => void save()} title="Save (Ctrl or ⌘ + Enter)">
              {state === 'saving' ? 'Saving…' : 'Save note'}
            </Button>
            <span role={failed ? 'alert' : undefined} className={`min-w-0 flex-1 text-meta ${failed ? 'text-danger-fg' : 'text-muted'}`}>
              {failed ? state.error : dirty ? 'Unsaved changes' : justSaved ? `Saved to ${target}` : `Saved in ${target}`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
