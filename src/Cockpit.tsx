import { createContext, useContext, useEffect, useRef, useState } from 'react'

import type { DevLinks } from './bridge'
import { queueFor } from './bridge'
import { crossRefs, isTicked, tickedCount } from './cockpitLogic'
import type { Ticks } from './cockpitLogic'
import { LinkedText } from './RichText'
import type { Task } from './types'

// The task cockpit: what a developer needs open next to a task to finish it.
// The parts (checklist, dev links, linked items, notes) are used by the detail
// modal and the focus view, and read the board through this context.

export interface CockpitValue {
  tasks: Task[]
  ticks: Ticks
  developer: string
  toggleTick: (task: Task, criterion: string) => void
  openTask: (task: Task) => void
}

export const CockpitContext = createContext<CockpitValue | null>(null)

const useCockpit = () => {
  const value = useContext(CockpitContext)
  if (!value) throw new Error('Cockpit parts must render inside a CockpitContext')
  return value
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function PanelLabel({ children, count }: { children: React.ReactNode; count?: string }) {
  return (
    <div className="label mb-2 flex items-baseline gap-2 border-b border-line-soft pb-1.5">
      {children}
      {count && <span className="ml-auto font-mono text-meta text-muted">{count}</span>}
    </div>
  )
}

// ─── Loading with a short cache ───────────────────────────────────────────────

type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string }

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: unknown }>()
const inFlight = new Map<string, Promise<unknown>>()

// One request per key at a time, so two panels asking for the same story's
// links share a fetch.
function fetchCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const request = load()
    .then(value => { cache.set(key, { at: Date.now(), value }); return value })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

// Shows the last result at once and refreshes it when it's older than a minute.
function useLoaded<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!key) { setState({ status: 'loading' }); return }
    let live = true
    const hit = cache.get(key)
    setState(hit ? { status: 'ready', value: hit.value as T } : { status: 'loading' })
    if (hit && Date.now() - hit.at < CACHE_MS) return
    fetchCached(key, () => loadRef.current())
      .then(value => { if (live) setState({ status: 'ready', value }) })
      .catch(e => { if (live) setState({ status: 'error', message: errorText(e) }) })
    return () => { live = false }
  }, [key])
  return state
}

// ─── Acceptance criteria checklist ────────────────────────────────────────────

export function Checklist({ task }: { task: Task }) {
  const { ticks, toggleTick } = useCockpit()
  const items = task.acceptanceCriteria ?? []
  if (items.length === 0) return null
  const done = tickedCount(ticks, task)
  return (
    <div>
      <PanelLabel count={`${done}/${items.length}`}>ACCEPTANCE CRITERIA</PanelLabel>
      {items.map((text, i) => {
        const ticked = isTicked(ticks, task.id, text)
        return (
          <div key={i} className="flex items-start gap-2 border-b border-line-soft py-1.5 last:border-b-0">
            <button
              role="checkbox"
              aria-checked={ticked}
              aria-label={ticked ? 'Untick criterion' : 'Tick criterion'}
              onClick={() => toggleTick(task, text)}
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border text-badge ${ticked ? 'border-ok/60 bg-ok/15 text-ok' : 'border-muted hover:border-accent'}`}
            >{ticked ? '✓' : ''}</button>
            <span className={`text-body ${ticked ? 'text-muted line-through' : 'text-fg'}`}><LinkedText text={text} /></span>
          </div>
        )
      })}
      <div className="mt-1.5 font-mono text-meta text-muted">Ticks stay in this browser and clear when the item closes.</div>
    </div>
  )
}

// How many criteria are ticked, for the board card.
export function AcceptanceProgress({ task }: { task: Task }) {
  const value = useContext(CockpitContext)
  const total = task.acceptanceCriteria?.length ?? 0
  if (!value || total === 0) return null
  const done = tickedCount(value.ticks, task)
  return <span className={`chip ${done === total ? 'text-ok' : ''}`} title="Acceptance criteria ticked">AC {done}/{total}</span>
}

// ─── Dev links ────────────────────────────────────────────────────────────────

const linksKey = (task: Task) => (queueFor(task)?.devLinks ? `links:${task.queue}:${task.id}` : null)
const useDevLinks = (task: Task) => useLoaded<DevLinks>(linksKey(task), () => queueFor(task)!.devLinks!(task))

const PR_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'OPEN', tone: 'text-accent' },
  completed: { label: 'MERGED', tone: 'text-ok' },
  abandoned: { label: 'ABANDONED', tone: 'text-muted' },
}

function prBadge(pr: DevLinks['pullRequests'][number]) {
  if (pr.isDraft && pr.status === 'active') return { label: 'DRAFT', tone: 'text-muted' }
  return PR_STATUS[pr.status ?? ''] ?? null
}

function buildBadge(build: DevLinks['builds'][number]) {
  switch (build.result) {
    case 'succeeded': return { label: 'PASSED', tone: 'text-ok' }
    case 'failed': return { label: 'FAILED', tone: 'text-danger-fg' }
    case 'partiallySucceeded': return { label: 'PARTIAL', tone: 'text-warn' }
    case 'canceled': return { label: 'CANCELED', tone: 'text-muted' }
  }
  if (build.status === 'inProgress' || build.status === 'notStarted') return { label: 'RUNNING', tone: 'text-muted' }
  return null
}

function LinkRow({ kind, href, title, meta, badge }: {
  kind: string
  href: string
  title: string
  meta?: string | null
  badge?: { label: string; tone: string } | null
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex items-baseline gap-2 rounded-xs px-1 py-1 hover:bg-white/[0.04]">
      <span className="w-12 shrink-0 font-mono text-badge tracking-label text-muted">{kind}</span>
      <span className="min-w-0 flex-1 break-words text-note text-fg group-hover:text-ink">
        {title}
        {meta && <span className="ml-1.5 font-mono text-meta text-muted">{meta}</span>}
      </span>
      {badge && <span className={`shrink-0 font-mono text-meta ${badge.tone}`}>{badge.label}</span>}
      <span className="shrink-0 text-accent">↗</span>
    </a>
  )
}

export function DevLinksPanel({ task }: { task: Task }) {
  const links = useDevLinks(task)
  if (!queueFor(task)?.devLinks) return null
  return (
    <div>
      <PanelLabel>DEV LINKS</PanelLabel>
      {links.status === 'loading' && <span className="font-mono text-meta text-muted">LOADING…</span>}
      {links.status === 'error' && (
        <span className="font-mono text-meta text-danger-fg">
          {links.message === 'Not Found'
            ? 'Dev links need an updated ado-bridge'
            : `Dev links unavailable · ${links.message}`}
        </span>
      )}
      {links.status === 'ready' && <DevLinkRows links={links.value} />}
    </div>
  )
}

function DevLinkRows({ links }: { links: DevLinks }) {
  const empty = links.pullRequests.length + links.branches.length + links.builds.length + links.commits.length + links.hyperlinks.length === 0
  if (empty) return <span className="text-note text-muted">No branch, PR or build linked yet</span>
  return (
    <div className="-mx-1 flex flex-col">
      {links.pullRequests.map(pr => (
        <LinkRow key={`pr${pr.id}`} kind="PR" href={pr.url} title={pr.title || `Pull request ${pr.id}`} meta={pr.repo} badge={prBadge(pr)} />
      ))}
      {links.branches.map(b => <LinkRow key={`b${b.repo}${b.name}`} kind="BRANCH" href={b.url} title={b.name} meta={b.repo} />)}
      {links.builds.map(b => (
        <LinkRow key={`ci${b.id}`} kind="CI" href={b.url} title={b.definition || `Build ${b.id}`} meta={b.name} badge={buildBadge(b)} />
      ))}
      {links.commits.map(c => <LinkRow key={`c${c.sha}`} kind="COMMIT" href={c.url} title={c.sha.slice(0, 8)} meta={c.repo} />)}
      {links.hyperlinks.map(h => <LinkRow key={h.url} kind="LINK" href={h.url} title={h.title} />)}
    </div>
  )
}

// ─── Linked items ─────────────────────────────────────────────────────────────

const RELATION_LABEL = { child: 'CHILD', related: 'RELATED' } as const

function ItemRow({ kind, title, state, onOpen, href }: {
  kind: string
  title: string
  state?: string | null
  onOpen?: () => void
  href?: string | null
}) {
  const body = (
    <>
      <span className="w-14 shrink-0 font-mono text-badge tracking-label text-muted">{kind}</span>
      <span className="min-w-0 flex-1 break-words text-note text-fg group-hover:text-ink">{title}</span>
      {state && <span className="shrink-0 font-mono text-meta text-muted">{state}</span>}
    </>
  )
  const cls = 'group flex w-full items-baseline gap-2 rounded-xs px-1 py-1 text-left hover:bg-white/[0.04]'
  if (onOpen) return <button className={cls} onClick={onOpen}>{body}</button>
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer">{body}</a>
  return <div className={cls}>{body}</div>
}

// Items tied to this one: ADO child and related work items, and items on the
// board that name this one by ref (or that this one names). The ADO parent has
// its own card under Project Context.
export function LinkedItemsPanel({ task }: { task: Task }) {
  const { tasks, openTask } = useCockpit()
  const links = useDevLinks(task)
  const { mentions, mentionedBy } = crossRefs(task, tasks)
  const onBoard = new Map(tasks.map(t => [t.id, t]))
  const seen = new Set<string>()

  const rows: React.ReactNode[] = []
  if (links.status === 'ready') {
    for (const w of links.value.workItems) {
      if (w.relation === 'parent') continue
      const loaded = onBoard.get(String(w.adoId))
      seen.add(String(w.adoId))
      rows.push(
        <ItemRow
          key={`ado${w.adoId}`}
          kind={RELATION_LABEL[w.relation]}
          title={`${w.workItemType === 'User Story' ? 'US-' : '#'}${w.adoId} ${w.title ?? ''}`.trim()}
          state={w.state}
          onOpen={loaded ? () => openTask(loaded) : undefined}
          href={loaded ? undefined : w.url}
        />,
      )
    }
  }
  for (const [kind, list] of [['MENTIONS', mentions], ['MENTIONED', mentionedBy]] as const) {
    for (const t of list) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      rows.push(<ItemRow key={`${kind}${t.id}`} kind={kind} title={`${t.ref} ${t.title}`} state={t.externalState} onOpen={() => openTask(t)} />)
    }
  }

  const waiting = !!linksKey(task) && links.status === 'loading'
  return (
    <div>
      <PanelLabel>LINKED ITEMS</PanelLabel>
      {rows.length > 0 && <div className="-mx-1 flex flex-col">{rows}</div>}
      {rows.length === 0 && (
        <span className="text-note text-muted">{waiting ? 'LOADING…' : 'Nothing linked or mentioned'}</span>
      )}
    </div>
  )
}

// ─── Notes ────────────────────────────────────────────────────────────────────

// Unsaved text survives closing the panel or switching tasks.
const drafts = new Map<string, string>()

export function NotesPanel({ task }: { task: Task }) {
  const { developer } = useCockpit()
  const adapter = queueFor(task)
  const notes = adapter?.notes
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
      <PanelLabel>NOTES</PanelLabel>
      {state === 'loading' ? (
        <span className="font-mono text-meta text-muted">LOADING…</span>
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
            className="w-full resize-y rounded-xs border border-line-soft bg-sunken px-2 py-1.5 text-body text-fg placeholder:text-muted focus:border-accent/50 focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button className="btn-quiet" disabled={!dirty || state === 'saving'} onClick={() => void save()} title="Save (Ctrl or ⌘ + Enter)">
              {state === 'saving' ? 'SAVING…' : 'SAVE NOTE'}
            </button>
            <span className={`min-w-0 flex-1 font-mono text-meta ${failed ? 'text-danger-fg' : 'text-muted'}`}>
              {failed ? state.error : dirty ? 'Unsaved changes' : justSaved ? `Saved to ${target}` : `Saved in ${target}`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
