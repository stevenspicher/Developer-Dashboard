import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { Priority, QueueSource, Status, Task, TaskType } from './types'
import {
  BRIDGE_REFRESH_MS, CALENDAR_LOOKAHEAD_DAYS, CONTEXT_REFRESH_MS, DEADLINE_TICKER_DAYS,
  ADO_STORIES_ENABLED, DEVELOPER_STORAGE_KEY, STALE_STANDUP_DAYS, TEST_DEVELOPERS,
  QUEUES, addDays, daysBetween, deadlineTickerText, fetchCurrentSprint, fetchDeadlines,
  fetchStandup, formatSprintRange, loadDeveloper, loadLanes, localIsoDate, plainText, queueFor, shortDate,
  stripLinks, updateLanes,
} from './bridge'
import type { BriefLine, Deadline, QueueProgress, RelatedEntity, Sprint, StandupBrief } from './bridge'
import BootScreen from './BootScreen'
import type { BootStep, BootStepState } from './BootScreen'
import { LinkedText, RichText } from './RichText'

// ─── Config ───────────────────────────────────────────────────────────────────

// Colour is kept for urgency: medium and low stay neutral so CRIT and HIGH
// stand out, and items without a priority show none.
const PRIORITY_CONFIG: Record<Priority, { label: string; text: string; dot: string } | null> = {
  critical: { label: 'CRIT', text: 'text-danger', dot: 'bg-danger shadow-[0_0_6px_var(--danger)]' },
  high:     { label: 'HIGH', text: 'text-warn',   dot: 'bg-warn' },
  medium:   { label: 'MED',  text: 'text-dim',    dot: 'bg-dim' },
  low:      { label: 'LOW',  text: 'text-muted',  dot: 'bg-faint' },
  none:     null,
}

const TYPE_LABELS: Record<TaskType, string> = {
  story: 'STORY', task: 'TASK', bug: 'BUG', spike: 'SPIKE', alert: 'ALERT', ticket: 'TICKET', incident: 'INCIDENT',
}

const SOURCE_TABS = ([
  { id: 'stories',    label: 'Stories' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'pulse',      label: 'Pulse' },
  { id: 'solarwinds', label: 'Solarwinds' },
  { id: 'zendesk',    label: 'Zendesk' },
  { id: 'ads',        label: 'ADS' },
] satisfies { id: QueueSource; label: string }[])
  // Only sources with a live queue: Zendesk and ADS have none yet, and Stories
  // is off while ado-bridge serves mock data.
  .filter(tab => QUEUES.some(q => q.source === tab.id))

type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'muted'
const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-fg', muted: 'text-muted',
}
const TONE_BG: Record<Tone, string> = {
  accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-dim', muted: 'bg-faint',
}

const sourceSystem = (task: Task) => (task.source === 'stories' ? 'ADO' : 'Notion')

// ─── Primitives ───────────────────────────────────────────────────────────────

function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-full bg-white/5">
      <div className={`h-full rounded-full transition-[width] duration-300 ${TONE_BG[tone]}`} style={{ width: `${value}%` }} />
    </div>
  )
}

function Avatar({ initials }: { initials: string }) {
  if (!initials) return null
  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-xs border border-accent/30 bg-accent/10 font-mono text-badge font-bold text-accent">
      {initials}
    </div>
  )
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const p = PRIORITY_CONFIG[priority]
  if (!p) return null
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-meta font-bold ${p.text}`}>
      <span className={`size-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  )
}

function DoneButton({ onDone, target }: { onDone: () => void; target: string }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onDone() }}
      title={`Mark done in ${target}`}
      className="rounded-xs border border-ok/30 bg-ok/10 px-1.5 font-mono text-meta tracking-label text-ok hover:bg-ok/20"
    >✓ DONE</button>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} title="Close (Esc)" className="btn-quiet flex size-6 items-center justify-center p-0">✕</button>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, onDragStart, compact = false, onClick, onDone }: {
  task: Task
  onDragStart: (e: React.DragEvent, id: string) => void
  compact?: boolean
  onClick?: () => void
  onDone?: () => void
}) {
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, task.id)}
      onClick={onClick}
      className={`task-card panel mb-1.5 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="chip">{TYPE_LABELS[task.type]}</span>
        <span className="ref">{task.ref ?? task.id}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <PriorityBadge priority={task.priority} />
          {task.points != null && <span className="chip">{task.points}pt</span>}
          {onDone && <DoneButton onDone={onDone} target={sourceSystem(task)} />}
        </div>
      </div>

      <div className={`text-body font-semibold text-ink ${compact ? '' : 'mb-1'}`}>{task.title}</div>

      {!compact && (
        <>
          {task.notes && <div className="mb-1.5 line-clamp-2 text-note text-dim">{plainText(task.notes)}</div>}
          <div className="mt-1 flex items-center gap-1.5">
            <Avatar initials={task.assignee} />
            {task.externalState && <span className="chip">{task.externalState}</span>}
            <div className="ml-auto flex items-center gap-2 font-mono text-meta text-muted">
              {task.standupAgeDays !== undefined && (
                <span className={task.standupAgeDays > STALE_STANDUP_DAYS ? 'text-warn' : ''}>STANDUP {task.standupAgeDays}d</span>
              )}
              {task.sprint && <span>{task.sprint}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const source = SOURCE_TABS.find(s => s.id === task.source)
  return (
    <Overlay onClose={onClose} className="max-h-[82vh] w-[720px]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-accent/15 bg-accent/5 px-4 py-2.5">
        <span className="chip">{TYPE_LABELS[task.type]}</span>
        <span className="ref">{task.ref ?? task.id}</span>
        {source && <span className="font-mono text-meta text-muted">via {source.label}</span>}
        <div className="ml-auto flex items-center gap-2">
          <PriorityBadge priority={task.priority} />
          {task.points != null && <span className="chip">{task.points} pts</span>}
          <CloseButton onClose={onClose} />
        </div>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-display font-bold text-ink">{task.title}</div>
            {task.description && <RichText text={task.description} className="text-read text-fg" />}
          </div>
          {(task.assignee || task.sprint) && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Avatar initials={task.assignee} />
              {task.sprint && <span className="ref">{task.sprint}</span>}
            </div>
          )}
        </div>

        {task.externalState && (
          <div className="flex flex-wrap gap-2">
            <MetaBadge label="STATE" value={task.externalState} />
          </div>
        )}

        {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
          <Section label="ACCEPTANCE CRITERIA">
            <AcceptanceCriteria items={task.acceptanceCriteria} />
          </Section>
        )}

        <Tags tags={task.tags} />
      </div>
    </Overlay>
  )
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xs border border-line-soft bg-white/[0.04] px-2 py-1">
      <div className="label text-badge">{label}</div>
      <div className="font-mono text-note text-fg">{value}</div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2 border-b border-line-soft pb-1.5">{label}</div>
      {children}
    </div>
  )
}

function AcceptanceCriteria({ items }: { items: string[] }) {
  return (
    <>
      {items.map((ac, i) => (
        <div key={i} className="flex items-start gap-2 border-b border-line-soft py-1.5 last:border-b-0">
          <span className="shrink-0 text-ok">◇</span>
          <span className="text-body text-fg"><LinkedText text={ac} /></span>
        </div>
      ))}
    </>
  )
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(t => <span key={t} className="chip">#{t}</span>)}
    </div>
  )
}

// ─── Working Space ────────────────────────────────────────────────────────────

const RELATION_LABELS: Record<string, string> = { initiative: 'INITIATIVE', issue: 'ISSUE', analystIssue: 'ANALYST ISSUE', parent: 'PARENT' }
const RELATION_FIELDS: Record<string, string[]> = {
  initiative: ['Status', 'Impact', 'Deadline', 'Countdown'],
  issue: ['Status', 'Priority'],
  analystIssue: ['Status', 'Priority'],
  parent: ['State', 'Assigned To', 'Iteration'],
}
const RELATION_TEXT_FIELDS = ['Description', 'Notes']

const linkTarget = (url: string) => (url.includes('dev.azure.com') ? 'ADO' : 'NOTION')

// ADO parents are labelled by their work item type (FEATURE, EPIC, …).
const relationLabel = (entity: RelatedEntity) => {
  const type = entity.relation === 'parent' ? entity.properties?.find(p => p.name === 'Type')?.value : undefined
  return (type || RELATION_LABELS[entity.relation] || entity.relation).toUpperCase()
}

function RelatedCard({ entity, onOpen }: { entity: RelatedEntity; onOpen: () => void }) {
  const prop = (name: string) => entity.properties?.find(p => p.name === name)?.value ?? ''
  const fields = (RELATION_FIELDS[entity.relation] ?? []).map(name => [name, prop(name)] as const).filter(([, v]) => v)
  const text = RELATION_TEXT_FIELDS.map(prop).find(Boolean) || entity.content || ''
  return (
    <div
      onClick={entity.error ? undefined : onOpen}
      title={entity.error ? undefined : 'Click to expand'}
      className={`rounded-xs border border-accent/15 bg-black/30 px-2.5 py-2 ${entity.error ? '' : 'cursor-zoom-in hover:border-accent/35'}`}
    >
      <div className="label mb-1 text-badge">{relationLabel(entity)}</div>
      {entity.error ? (
        <div className="font-mono text-meta text-danger-fg">Unavailable — {entity.error}</div>
      ) : (
        <>
          <div className="mb-1.5 text-body font-semibold leading-snug text-ink">{entity.title}</div>
          {fields.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {fields.map(([name, value]) => (
                <span key={name} className="chip">
                  <span className="mr-1 text-muted">{name.toUpperCase()}</span>{value}
                </span>
              ))}
            </div>
          )}
          {text && <div className="line-clamp-5 whitespace-pre-line text-note text-dim">{stripLinks(text)}</div>}
          {entity.url && (
            <a href={entity.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="link mt-1.5 inline-block font-mono text-meta">
              OPEN IN {linkTarget(entity.url)} ↗
            </a>
          )}
        </>
      )}
    </div>
  )
}

function RelatedPanel({ related }: { related: RelatedEntity[] | 'loading' | { error: string } | undefined }) {
  if (related === undefined || related === 'loading') {
    return <span className="font-mono text-meta text-muted">LOADING CONTEXT…</span>
  }
  if (!Array.isArray(related)) {
    return <span className="font-mono text-meta text-danger-fg">{related.error}</span>
  }
  const linked = related.filter(r => !r.empty)
  if (linked.length === 0) {
    return <span className="text-note text-muted">No linked initiative, issue, or parent</span>
  }
  return <RelatedCards linked={linked} />
}

function RelatedCards({ linked }: { linked: RelatedEntity[] }) {
  const [open, setOpen] = useState<RelatedEntity | null>(null)
  return (
    <>
      {linked.map(r => <RelatedCard key={`${r.relation}:${r.id}`} entity={r} onOpen={() => setOpen(r)} />)}
      {open && <RelatedModal entity={open} onClose={() => setOpen(null)} />}
    </>
  )
}

const notionPageUrl = (id: string) => `https://app.notion.com/p/${id.replace(/-/g, '')}`

function RelatedModal({ entity, onClose }: { entity: RelatedEntity; onClose: () => void }) {
  const props = (entity.properties ?? []).filter(p => p.value && p.type !== 'relation')
  const longText = props.filter(p => RELATION_TEXT_FIELDS.includes(p.name))
  const fields = props.filter(p => !RELATION_TEXT_FIELDS.includes(p.name))
  const content = (entity.content ?? '').split('\n').filter(l => !l.startsWith('[Sub-page:')).join('\n').trim()
  return (
    <Overlay onClose={onClose} className="h-[80vh] w-[760px]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-accent/15 bg-accent/5 px-4 py-2.5">
        <span className="label text-accent">{relationLabel(entity)}</span>
        {entity.url && (
          <a href={entity.url} target="_blank" rel="noreferrer" className="link font-mono text-meta">OPEN IN {linkTarget(entity.url)} ↗</a>
        )}
        <span className="ml-auto" />
        <CloseButton onClose={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
        <div className="text-display font-bold text-ink">{entity.title}</div>
        {fields.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fields.map(p => <MetaBadge key={p.name} label={p.name.toUpperCase()} value={p.value} />)}
          </div>
        )}
        {longText.map(p => (
          <Section key={p.name} label={p.name.toUpperCase()}>
            <RichText text={p.value} className="text-read text-fg" />
          </Section>
        ))}
        {content && (
          <Section label="PAGE CONTENT">
            <RichText text={content} className="text-read text-fg" />
          </Section>
        )}
        {entity.sub_pages && entity.sub_pages.length > 0 && (
          <Section label={`SUB-PAGES — ${entity.sub_pages.length}`}>
            {entity.sub_pages.map(sp => (
              <a key={sp.id} href={notionPageUrl(sp.id)} target="_blank" rel="noreferrer" className="link block py-1 text-read">
                {sp.title || 'Untitled'} ↗
              </a>
            ))}
          </Section>
        )}
        {!content && longText.length === 0 && (
          <span className="text-body text-muted">No description or page content.</span>
        )}
      </div>
    </Overlay>
  )
}

function WorkingSpace({ task, related, onClear, onDone, onDragStart }: {
  task: Task | null
  related?: RelatedEntity[] | 'loading' | { error: string }
  onClear: () => void
  onDone?: () => void
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  if (!task) {
    return (
      <div className="panel flex min-h-[200px] flex-1 items-center justify-center border-dashed border-accent/20">
        <div className="text-center font-mono tracking-label text-muted">
          <div className="mb-2.5 text-[28px] text-faint">◈</div>
          <div className="text-body">DRAG ANY ITEM HERE</div>
          <div className="text-meta">TO BEGIN WORKING</div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel hud-corner flex flex-1 flex-col overflow-hidden border-accent/30">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-accent/15 bg-linear-to-r from-accent/10 to-transparent px-3 py-2">
        <span className="pulse size-2 shrink-0 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
        <span className="font-mono text-meta font-bold tracking-label text-accent">ACTIVE</span>
        <span className="chip">{TYPE_LABELS[task.type]}</span>
        <span className="ref">{task.ref ?? task.id}</span>
        {task.externalState && <span className="chip">{task.externalState}</span>}
        {task.url && <a href={task.url} target="_blank" rel="noreferrer" className="link font-mono text-meta">{linkTarget(task.url)} ↗</a>}
        {task.link && <a href={task.link} target="_blank" rel="noreferrer" className="link font-mono text-meta">TICKET ↗</a>}
        <span className="ml-auto" />
        {onDone && <DoneButton onDone={onDone} target={sourceSystem(task)} />}
        <button
          draggable
          onDragStart={e => onDragStart(e, task.id)}
          onClick={onClear}
          className="btn-quiet"
          title="Drag back to queue or click to clear"
        >RETURN ×</button>
      </div>

      {/* Two-col body: task detail | project context */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto border-r border-accent/10 px-4 py-3.5">
          <div>
            <div className="mb-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 text-title font-bold text-ink">{task.title}</div>
                {task.description && <RichText text={task.description} className="text-body text-fg" />}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <PriorityBadge priority={task.priority} />
                {task.points != null && <span className="ref">{task.points}pt</span>}
                <Avatar initials={task.assignee} />
              </div>
            </div>
            <Tags tags={task.tags} />
          </div>

          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
            <Section label="ACCEPTANCE CRITERIA">
              <AcceptanceCriteria items={task.acceptanceCriteria} />
            </Section>
          )}
        </div>

        <div className="flex w-[280px] shrink-0 flex-col gap-2.5 overflow-y-auto px-3 py-3.5">
          <div className="label border-b border-line-soft pb-1.5">PROJECT CONTEXT</div>
          {task.queue
            ? <RelatedPanel related={related} />
            : <span className="text-note text-muted">No linked initiative, issue, or parent</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<'today' | 'working' | 'blocked' | 'queue' | null>(null)
  const [centerTab, setCenterTab] = useState<'brief' | 'calendar'>('brief')
  const [queueTab, setQueueTab] = useState<QueueSource>(SOURCE_TABS[0].id)
  const [modalTask, setModalTask] = useState<Task | null>(null)
  const today = useToday()
  const [bridgeLoading, setBridgeLoading] = useState(true)
  const [bridgeErrors, setBridgeErrors] = useState<Partial<Record<QueueSource, string>>>({})
  const [progress, setProgress] = useState<Partial<Record<QueueSource, QueueProgress>>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [sprint, setSprint] = useState<Sprint | null>(null)
  const [developer, setDeveloper] = useState(loadDeveloper)
  const [brief, setBrief] = useState<StandupBrief | { error: string } | null>(null)
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [related, setRelated] = useState<Record<string, RelatedEntity[] | 'loading' | { error: string }>>({})
  const [reader, setReader] = useState<ReaderTab | null>(null)
  const [booting, setBooting] = useState(true)
  const [sprintStatus, setSprintStatus] = useState<BootStepState>('pending')
  const [deadlinesStatus, setDeadlinesStatus] = useState<BootStepState>('pending')

  const changeDeveloper = (email: string) => {
    try { localStorage.setItem(DEVELOPER_STORAGE_KEY, email) } catch { /* storage unavailable */ }
    const bridgeSources = new Set(QUEUES.map(q => q.source))
    setTasks(prev => prev.filter(t => !bridgeSources.has(t.source)))
    setProgress({})
    setBridgeLoading(true)
    setBrief(null)
    setActionError(null)
    setSprintStatus('pending')
    setDeadlinesStatus('pending')
    setBooting(true)
    setDeveloper(email)
  }

  // Queues: rebuilt from the bridge on every refresh, with each item placed in
  // its saved lane (claimed Pulse items default to Todo).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const currentSprint = await fetchCurrentSprint().catch(() => null)
      if (cancelled) return
      setSprint(currentSprint)
      setSprintStatus(currentSprint ? 'ok' : 'fail')

      const results = await Promise.allSettled(QUEUES.map(q => q.load(developer, currentSprint)))
      if (cancelled) return

      const errors: Partial<Record<QueueSource, string>> = {}
      QUEUES.forEach((q, i) => {
        const r = results[i]
        if (r.status === 'rejected') errors[q.source] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      })
      const lanes = loadLanes(developer)
      setTasks(prev => {
        let next = prev
        QUEUES.forEach((q, i) => {
          const r = results[i]
          if (r.status === 'rejected') return
          const claimedIds = new Set(r.value.claimedIds)
          // A source-reported Blocked always wins; otherwise the saved lane, then
          // the source's hint, then claimed → Todo.
          const laneFor = (id: string): Status => {
            const hinted = r.value.lanes?.[id]
            if (hinted === 'blocked') return 'blocked'
            return lanes[id] ?? hinted ?? (claimedIds.has(id) ? 'today' : 'queue')
          }
          const fresh = r.value.items.map(task => ({ ...task, status: laneFor(task.id) }))
          next = [...next.filter(t => t.source !== q.source), ...fresh]
        })
        return next
      })
      setProgress(prev => {
        const next = { ...prev }
        QUEUES.forEach((q, i) => {
          const r = results[i]
          if (r.status === 'fulfilled') next[q.source] = r.value.progress
        })
        return next
      })
      setBridgeErrors(errors)
      setBridgeLoading(false)
    }
    load()
    const t = setInterval(load, BRIDGE_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  // Standup brief + deadlines change at most daily; poll every 5 minutes so a
  // newly generated brief shows up without a reload.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [b, d] = await Promise.allSettled([fetchStandup(developer), fetchDeadlines()])
      if (cancelled) return
      setBrief(b.status === 'fulfilled' ? b.value : { error: b.reason instanceof Error ? b.reason.message : String(b.reason) })
      if (d.status === 'fulfilled') setDeadlines(d.value)
      setDeadlinesStatus(d.status === 'fulfilled' ? 'ok' : 'fail')
    }
    load()
    const t = setInterval(load, CONTEXT_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  const workingTask = tasks.find(t => t.status === 'working') ?? null

  // Related Initiative / Issue / Analyst Issue for the active item.
  useEffect(() => {
    if (!workingTask?.queue || related[workingTask.id]) return
    const { id } = workingTask
    setRelated(prev => ({ ...prev, [id]: 'loading' }))
    const adapter = queueFor(workingTask)
    if (!adapter?.related) return
    adapter.related(workingTask)
      .then(r => setRelated(prev => ({ ...prev, [id]: r })))
      .catch(e => setRelated(prev => ({ ...prev, [id]: { error: e instanceof Error ? e.message : String(e) } })))
  }, [workingTask, related])

  // Move a card between lanes. Only one item can be in Working; the previous
  // one drops back to Todo. Claimable queues claim on leaving the queue and
  // release on returning to it; a failed write puts the card back.
  const moveTask = async (id: string, to: Status) => {
    const task = tasks.find(t => t.id === id)
    if (!task || task.status === to) return
    const from = task.status
    const displaced = to === 'working' ? tasks.find(t => t.status === 'working' && t.id !== id) : undefined

    const setLane = (lane: Status, displacedLane?: Status) => {
      setTasks(prev => prev.map(t =>
        t.id === id ? { ...t, status: lane } : displaced && t.id === displaced.id && displacedLane ? { ...t, status: displacedLane } : t))
      updateLanes(developer, { [id]: lane, ...(displaced && displacedLane ? { [displaced.id]: displacedLane } : {}) })
    }
    setLane(to, 'today')
    setActionError(null)

    const move = queueFor(task)?.move
    if (!move) return
    try {
      const patch = await move(task, from, to, developer)
      if (patch) setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    } catch (e) {
      setLane(from, 'working')
      setActionError(`Couldn't move ${task.ref ?? task.title}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const markDone = async (task: Task) => {
    const done = queueFor(task)?.done
    if (!done) return
    setActionError(null)
    try {
      await done(task, developer)
      setTasks(prev => prev.filter(t => t.id !== task.id))
      updateLanes(developer, { [task.id]: null })
      setModalTask(m => (m?.id === task.id ? null : m))
      // Count it as done straight away; the next refresh confirms it.
      setProgress(prev => {
        const p = prev[task.source]
        return p ? { ...prev, [task.source]: { ...p, done: p.done + 1, donePoints: p.donePoints + (task.points ?? 0) } } : prev
      })
    } catch (e) {
      setActionError(`Couldn't mark ${task.ref ?? task.title} done: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const doneHandler = (task: Task) => (queueFor(task)?.done ? () => markDone(task) : undefined)

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [])

  const handleDrop = (e: React.DragEvent, zone: Status) => {
    e.preventDefault()
    setDropTarget(null)
    if (dragId) moveTask(dragId, zone)
    setDragId(null)
  }

  const handleDragOver = useCallback((e: React.DragEvent, zone: 'today' | 'working' | 'blocked' | 'queue') => {
    e.preventDefault()
    setDropTarget(zone)
  }, [])

  const handleDragLeave = useCallback(() => setDropTarget(null), [])

  const queueTasks = tasks.filter(t => t.status === 'queue' && t.source === queueTab)
  const todayTasks = tasks.filter(t => t.status === 'today')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const allQueueTasks = tasks.filter(t => t.status === 'queue')
  const countOf = (source: QueueSource) => tasks.filter(t => t.source === source).length

  const sprintHeader = sprint ? [sprint.name.toUpperCase(), formatSprintRange(sprint)].filter(Boolean).join(' · ') : 'SPRINT —'
  const sprintDaysLeft = sprint?.end ? Math.max(0, daysBetween(today, sprint.end)) : null
  const sprintLength = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : null
  const sprintDay = sprint?.start && sprintLength ? Math.min(sprintLength, Math.max(1, daysBetween(sprint.start, today) + 1)) : null
  const storyProgress = progress.stories

  const briefData = brief && !('error' in brief) ? brief : null
  const tickerItems = [
    ...(briefData?.teamItems ?? []).map(l => ({ src: 'TEAM', text: l.text })),
    ...deadlines
      .map(d => deadlineTickerText(d, today, DEADLINE_TICKER_DAYS))
      .filter((t): t is string => t !== null)
      .map(text => ({ src: 'DATE', text })),
  ]
  const calendarEnd = sprint?.end ? addDays(sprint.end, CALENDAR_LOOKAHEAD_DAYS) : addDays(today, CALENDAR_LOOKAHEAD_DAYS)
  const calendarItems = deadlines
    .filter(d => (d.end ?? d.start) >= today && d.start <= calendarEnd)
    .sort((a, b) => a.start.localeCompare(b.start))
  const queuesFailed = QUEUES.every(q => bridgeErrors[q.source])
  const queuesStatus: BootStepState = bridgeLoading ? 'pending' : queuesFailed ? 'fail' : 'ok'
  const briefStatus: BootStepState = !brief ? 'pending' : 'error' in brief ? 'fail' : 'ok'
  const bootSteps: BootStep[] = [
    { label: 'establishing uplink to notion-bridge', state: sprintStatus === 'pending' ? 'pending' : sprintStatus === 'ok' || queuesStatus === 'ok' ? 'ok' : 'fail' },
    { label: 'syncing current sprint', state: sprintStatus },
    { label: `loading queues · ${ADO_STORIES_ENABLED ? 'stories / ' : ''}tasks / pulse / tickets`, state: queuesStatus },
    { label: 'compiling daily brief', state: briefStatus },
    { label: 'plotting deadlines & milestones', state: deadlinesStatus },
  ]
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const bootSummary = [
    briefData?.mode === 'brief' && plural(briefData.responsibilities.length, 'responsibility', 'responsibilities') + ' today',
    briefData?.mode === 'brief' && briefData.aging.length > 0 && `${briefData.aging.length} aging`,
    briefData?.mode === 'leadership' && plural(briefData.summaries.length, 'developer update', 'developer updates'),
    plural(countOf('tasks'), 'task', 'tasks'),
    `${countOf('pulse')} pulse`,
    plural(countOf('solarwinds'), 'ticket', 'tickets'),
  ].filter(Boolean).join(' · ')
  const currentDeveloper = TEST_DEVELOPERS.find(d => d.email === developer)
  const openMention = (line: BriefLine) => {
    const task = tasks.find(t => line.mentions.includes(t.id))
    if (task) {
      setReader(null)
      setModalTask(task)
    }
  }

  // Scroll the ticker at a constant, readable speed regardless of how much
  // content it holds (the track is two copies, so one loop is half its width).
  const tickerRef = useRef<HTMLDivElement>(null)
  const [tickerDuration, setTickerDuration] = useState(60)
  const tickerKey = tickerItems.map(t => t.text).join('|')
  useLayoutEffect(() => {
    const width = tickerRef.current?.scrollWidth ?? 0
    if (width) setTickerDuration(Math.max(20, width / 2 / TICKER_PX_PER_SEC))
  }, [tickerKey])

  const briefView = <BriefPanel brief={brief} tasks={tasks} onOpen={openMention} today={today} />
  const calendarView = (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="mb-1.5 flex justify-between font-mono text-meta">
        <span className="text-muted">{sprintHeader}</span>
        {sprintDaysLeft !== null && <span className="text-accent">{sprintDaysLeft} DAYS LEFT</span>}
      </div>
      <CalendarList items={calendarItems} sprint={sprint} today={today} />
    </div>
  )
  const tickerView = <TickerList items={tickerItems} />

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg font-sans">

      {/* ── Header ── */}
      <header className="z-10 flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-black/40 px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xs border border-accent/40 bg-accent/10 font-mono text-stat font-bold text-accent">◈</div>
          <div>
            <div className="font-mono text-note font-bold tracking-label text-ink">DEV COMMAND CENTER</div>
            <div className="font-mono text-meta text-muted">{sprintHeader}</div>
          </div>
        </div>

        {/* Ticker */}
        <div className="ticker-wrap relative mx-3 flex-1 cursor-zoom-in overflow-hidden" onClick={() => setReader('ticker')} title="Click to read all team items and dates">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-1 w-5 bg-linear-to-r from-bg to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-1 w-5 bg-linear-to-l from-bg to-transparent" />
          <div ref={tickerRef} className="ticker-track inline-flex items-center gap-7" style={{ animationDuration: `${tickerDuration}s` }}>
            {(tickerItems.length ? [...tickerItems, ...tickerItems] : [{ src: 'TEAM', text: 'No team items' }]).map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap text-note text-dim">
                <span className="text-badge text-accent">◆</span>
                <span className="rounded-xs bg-accent/10 px-1 font-mono text-badge text-muted">{b.src}</span>
                {b.text}
              </span>
            ))}
          </div>
        </div>

        {/* TEMP: developer switcher for testing */}
        <select
          value={developer}
          onChange={e => changeDeveloper(e.target.value)}
          title="Viewing as developer (testing only)"
          className="shrink-0 rounded-xs border border-dashed border-warn/40 bg-warn/10 px-1.5 py-1 font-mono text-meta text-warn"
        >
          {TEST_DEVELOPERS.map(d => <option key={d.email} value={d.email} className="bg-bg">{d.name}</option>)}
        </select>

        {/* Stats */}
        <div className="flex shrink-0 items-center gap-5">
          <Stat label="SPRINT DAY" value={sprintDay && sprintLength ? `${sprintDay}/${sprintLength}` : '—'} tone="accent" />
          <Stat label="TODAY" value={String(todayTasks.length)} tone="accent" />
          <Stat label="BLOCKED" value={String(blockedTasks.length)} tone={blockedTasks.length > 0 ? 'danger' : 'muted'} />
          <div className="h-6 w-px bg-accent/15" />
          <Clock />
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div className="grid flex-1 grid-cols-[clamp(300px,21vw,360px)_minmax(0,1fr)_clamp(232px,16vw,300px)] overflow-hidden">

        {/* ── LEFT: Queue Panel ── */}
        <div
          className={`flex flex-col overflow-hidden border-r border-line transition-all ${dropTarget === 'queue' ? 'drop-active' : ''}`}
          onDrop={e => handleDrop(e, 'queue')}
          onDragOver={e => handleDragOver(e, 'queue')}
          onDragLeave={handleDragLeave}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-line bg-black/25 px-2.5 pt-2.5">
            <div className="mb-2 flex items-center">
              <span className="label font-bold text-accent">QUEUES</span>
              <span className="ml-auto font-mono text-meta text-muted">{allQueueTasks.length} items</span>
            </div>
            {/* Source tabs */}
            <div className="flex overflow-x-auto">
              {SOURCE_TABS.map(tab => {
                const n = tasks.filter(t => t.status === 'queue' && t.source === tab.id).length
                const active = queueTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setQueueTab(tab.id)}
                    className={`shrink-0 whitespace-nowrap border-b-2 px-2 py-1.5 text-note font-medium transition-colors ${active ? 'border-accent bg-accent/5 text-accent' : 'border-transparent text-muted hover:text-fg'}`}
                  >
                    {tab.label}
                    {n > 0 && <span className="ml-1 font-mono text-badge">{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto p-2">
            {actionError && (
              <div onClick={() => setActionError(null)} title="Dismiss" className="mb-1.5 cursor-pointer rounded-xs border border-danger/25 bg-danger/10 px-2 py-1.5 font-mono text-meta text-danger-fg">
                {actionError} ✕
              </div>
            )}
            {bridgeErrors[queueTab] && (
              <div className="mb-1.5 rounded-xs border border-danger/25 bg-danger/10 px-2 py-1.5 font-mono text-meta text-danger-fg">
                BRIDGE ERROR · {bridgeErrors[queueTab]}
              </div>
            )}
            {bridgeLoading && QUEUES.some(q => q.source === queueTab) && queueTasks.length === 0 ? (
              <div className="px-2 py-5 text-center font-mono text-meta text-muted">LOADING…</div>
            ) : queueTasks.length === 0 ? (
              <div className="px-2 py-5 text-center font-mono text-meta text-muted">NO ITEMS IN QUEUE</div>
            ) : (
              queueTasks.map(t => (
                <TaskCard key={t.id} task={t} onDragStart={handleDragStart} onClick={() => setModalTask(t)} onDone={doneHandler(t)} />
              ))
            )}
          </div>

          {/* Drop-back indicator */}
          {dropTarget === 'queue' && (
            <div className="border-t border-accent/30 bg-accent/5 px-2.5 py-2 text-center font-mono text-meta tracking-label text-accent">↓ RETURN TO QUEUE</div>
          )}
        </div>

        {/* ── CENTER ── */}
        <div className="flex flex-col overflow-hidden">
          {/* Top row: Brief + Calendar + Sprint */}
          <div className="flex h-[clamp(200px,30vh,320px)] shrink-0 border-b border-line">
            <div className="flex flex-1 flex-col overflow-hidden border-r border-accent/10">
              <div className="flex shrink-0 border-b border-accent/10">
                {(['brief', 'calendar'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setCenterTab(tab)}
                    className={`flex-1 border-b-2 p-2 font-mono text-meta tracking-label ${centerTab === tab ? 'border-accent bg-accent/5 text-accent' : 'border-transparent text-muted hover:text-fg'}`}
                  >
                    {tab === 'brief' ? '◉ DAILY BRIEF' : '◈ SPRINT CALENDAR'}
                  </button>
                ))}
                <button onClick={() => setReader(centerTab)} title="Expand" className="border-l border-accent/10 px-3 text-body text-muted hover:text-accent">⤢</button>
              </div>

              <div onClick={() => setReader(centerTab)} title="Click to expand" className="flex flex-1 cursor-zoom-in flex-col overflow-hidden">
                {centerTab === 'brief' ? briefView : calendarView}
              </div>
            </div>

            {/* Sprint metrics */}
            <div className="flex w-[212px] shrink-0 flex-col gap-3 px-3 py-2.5">
              <div className="label font-bold text-accent">SPRINT</div>
              <SprintMetric
                label="TIME"
                value={sprintDay && sprintLength ? `DAY ${sprintDay}/${sprintLength}` : '—'}
                progress={sprintDay && sprintLength ? (sprintDay / sprintLength) * 100 : 0}
                tone="accent"
              />
              {ADO_STORIES_ENABLED && (
                <SprintMetric
                  label="STORIES"
                  title="Stories closed / committed this sprint · story points closed / committed"
                  value={storyProgress
                    ? `${storyProgress.done}/${storyProgress.total}${storyProgress.totalPoints ? ` · ${storyProgress.donePoints}/${storyProgress.totalPoints} PT` : ''}`
                    : '—'}
                  progress={storyProgress ? percent(storyProgress) : 0}
                  tone="ok"
                />
              )}
              <SprintMetric label="TASKS" value={`${countOf('tasks')} OPEN`} tone="neutral" />
              <SprintMetric label="PULSE + TICKETS" value={`${countOf('pulse') + countOf('solarwinds')} OPEN`} tone="neutral" />
            </div>
          </div>

          {/* Working Space */}
          <div
            className={`flex flex-1 flex-col gap-1.5 overflow-hidden p-2 transition-all ${dropTarget === 'working' ? 'drop-active' : ''}`}
            onDrop={e => handleDrop(e, 'working')}
            onDragOver={e => handleDragOver(e, 'working')}
            onDragLeave={handleDragLeave}
          >
            <div className="flex shrink-0 items-center gap-2">
              <span className="label font-bold text-accent">◈ WORKING SPACE</span>
              {workingTask && <span className="ref">— {workingTask.ref ?? workingTask.id}</span>}
              <span className={`ml-auto font-mono text-meta ${dropTarget === 'working' ? 'text-accent' : 'text-muted'}`}>DROP ITEM TO ACTIVATE</span>
            </div>
            <WorkingSpace
              task={workingTask}
              related={workingTask ? related[workingTask.id] : undefined}
              onDragStart={handleDragStart}
              onDone={workingTask ? doneHandler(workingTask) : undefined}
              onClear={() => { if (workingTask) moveTask(workingTask.id, 'queue') }}
            />
          </div>
        </div>

        {/* ── RIGHT: Today + Blocked ── */}
        <div className="flex flex-col overflow-hidden border-l border-line">
          {/* TODAY */}
          <div
            className={`flex flex-1 flex-col border-b border-line transition-all ${dropTarget === 'today' ? 'drop-active' : ''}`}
            onDrop={e => handleDrop(e, 'today')}
            onDragOver={e => handleDragOver(e, 'today')}
            onDragLeave={handleDragLeave}
          >
            <div className="panel-header shrink-0">
              <span className="size-1.5 shrink-0 rounded-full bg-accent" />
              TODO TODAY
              <span className="ml-auto rounded-xs bg-accent/10 px-1.5 text-badge text-accent">{todayTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {todayTasks.length === 0
                ? <EmptyDrop label="DROP TASKS HERE" />
                : todayTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} onDone={doneHandler(t)} />)
              }
            </div>
          </div>

          {/* BLOCKED */}
          <div
            className={`flex flex-1 flex-col transition-all ${dropTarget === 'blocked' ? 'drop-blocked-active' : ''}`}
            onDrop={e => handleDrop(e, 'blocked')}
            onDragOver={e => handleDragOver(e, 'blocked')}
            onDragLeave={handleDragLeave}
          >
            <div className="panel-header shrink-0">
              <span className={`size-1.5 shrink-0 rounded-full bg-danger shadow-[0_0_6px_var(--danger)] ${blockedTasks.length > 0 ? 'pulse' : ''}`} />
              BLOCKED
              <span className="ml-auto rounded-xs bg-danger/10 px-1.5 text-badge text-danger">{blockedTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {blockedTasks.length === 0
                ? <EmptyDrop label="NO BLOCKERS" />
                : blockedTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} onDone={doneHandler(t)} />)
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {modalTask && <DetailModal task={modalTask} onClose={() => setModalTask(null)} />}

      {reader && (
        <ReaderModal
          tab={reader}
          onTab={setReader}
          onClose={() => setReader(null)}
          views={{ brief: briefView, ticker: tickerView, calendar: calendarView }}
        />
      )}

      {booting && (
        <BootScreen
          key={developer}
          login={developer.split('@')[0]}
          firstName={(currentDeveloper?.name ?? developer).split(/\s+/)[0]}
          sprintNumber={sprint?.number ?? null}
          steps={bootSteps}
          summary={bootSummary}
          onDone={() => setBooting(false)}
        />
      )}
    </div>
  )
}

// Points when the stories have them, otherwise a count of stories.
const percent = (p: QueueProgress) =>
  p.totalPoints ? (p.donePoints / p.totalPoints) * 100 : p.total ? (p.done / p.total) * 100 : 0

// The local date, re-checked every minute so date-based views roll over at
// midnight without re-rendering the board every second.
function useToday() {
  const [today, setToday] = useState(() => localIsoDate())
  useEffect(() => {
    const t = setInterval(() => setToday(localIsoDate()), 60_000)
    return () => clearInterval(t)
  }, [])
  return today
}

// ─── Daily Brief ──────────────────────────────────────────────────────────────

function BriefPanel({ brief, tasks, onOpen, today }: {
  brief: StandupBrief | { error: string } | null
  tasks: Task[]
  onOpen: (line: BriefLine) => void
  today: string
}) {
  const shell = (children: React.ReactNode) => <div className="flex-1 overflow-y-auto px-3 py-2">{children}</div>
  if (!brief) return shell(<span className="label">LOADING BRIEF…</span>)
  if ('error' in brief) return shell(<span className="label text-danger-fg">BRIDGE ERROR · {brief.error}</span>)
  if (brief.mode === 'none' || !brief.date) return shell(<span className="label">NO STANDUP BRIEF YET THIS SPRINT</span>)

  const heading = `${shortDate(brief.date)} STANDUP · ${brief.mode === 'brief' ? 'MORNING BRIEF' : 'LEADERSHIP SUMMARY'}`
  const Line = ({ line, index, tone }: { line: BriefLine; index?: number; tone: string }) => {
    const task = tasks.find(t => line.mentions.includes(t.id))
    return (
      <div
        onClick={task ? e => { e.stopPropagation(); onOpen(line) } : undefined}
        className={`flex items-start gap-2 border-b border-line-soft py-1 ${task ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}
      >
        <span className={`mt-px min-w-4 shrink-0 font-mono text-meta ${tone}`}>{index !== undefined ? `${index + 1}.` : '•'}</span>
        <span className="text-body text-fg">
          <LinkedText text={line.text} />
          {task && <span className="ml-1.5 whitespace-nowrap font-mono text-meta text-accent">{task.ref ?? ''} ↗</span>}
        </span>
      </div>
    )
  }

  return shell(
    <>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="label text-accent">{heading}</span>
        {!brief.isToday && brief.date < today && <span className="label ml-auto text-warn">TODAY'S NOT POSTED YET</span>}
      </div>
      {brief.mode === 'brief' ? (
        <>
          <div className="label mt-1.5">YOUR RESPONSIBILITIES TODAY</div>
          {brief.responsibilities.length === 0
            ? <div className="py-1 text-body text-muted">None listed</div>
            : brief.responsibilities.map((l, i) => <Line key={i} line={l} index={i} tone="text-accent" />)}
          {brief.aging.length > 0 && (
            <>
              <div className="label mt-2.5 text-warn">AGING ITEMS</div>
              {brief.aging.map((l, i) => <Line key={i} line={l} tone="text-warn" />)}
            </>
          )}
        </>
      ) : (
        brief.summaries.map(s => (
          <div key={s.developer} className="flex items-start gap-2 border-b border-line-soft py-1.5">
            <span className="mt-px shrink-0 rounded-xs bg-accent/10 px-1.5 font-mono text-meta text-accent">{s.developer.toUpperCase()}</span>
            <span className="text-body text-fg"><LinkedText text={s.text} /></span>
          </div>
        ))
      )}
    </>,
  )
}

// ─── Reader (expanded brief / ticker / calendar) ──────────────────────────────

type ReaderTab = 'brief' | 'ticker' | 'calendar'
const TICKER_PX_PER_SEC = 35
const READER_TABS: { id: ReaderTab; label: string }[] = [
  { id: 'brief', label: '◉ DAILY BRIEF' },
  { id: 'ticker', label: '◆ TEAM ITEMS & DATES' },
  { id: 'calendar', label: '◈ SPRINT CALENDAR' },
]

function TickerList({ items }: { items: { src: string; text: string }[] }) {
  const groups = [
    { src: 'TEAM', label: 'TEAM ITEMS' },
    { src: 'DATE', label: `DEADLINES IN THE NEXT ${DEADLINE_TICKER_DAYS} DAYS` },
  ]
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map(g => {
        const rows = items.filter(i => i.src === g.src)
        return (
          <div key={g.src} className="mb-3">
            <div className="label mb-1">{g.label}</div>
            {rows.length === 0
              ? <div className="py-1 text-body text-muted">None</div>
              : rows.map((r, i) => (
                <div key={i} className="flex gap-2 border-b border-line-soft py-1">
                  <span className="shrink-0 font-mono text-meta text-accent">•</span>
                  <span className="text-body text-fg"><LinkedText text={r.text} /></span>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}

// Full-screen dimmed overlay with a centered HUD panel; Esc or a click
// outside closes it. `className` sizes the panel.
function Overlay({ onClose, className = '', children }: { onClose: () => void; className?: string; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div onClick={onClose} className="fixed inset-0 z-90 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        onClick={e => e.stopPropagation()}
        className={`panel hud-corner flex max-w-[calc(100vw-32px)] flex-col border-accent/35 shadow-[0_0_60px_rgba(0,212,255,0.12),0_0_120px_rgba(0,0,0,0.8)] ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

function ReaderModal({ tab, onTab, onClose, views }: {
  tab: ReaderTab
  onTab: (tab: ReaderTab) => void
  onClose: () => void
  views: Record<ReaderTab, React.ReactNode>
}) {
  return (
    <Overlay onClose={onClose} className="h-[80vh] w-[760px]">
      <div className="flex shrink-0 border-b border-accent/15 bg-accent/5">
        {READER_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`flex-1 border-b-2 p-2.5 font-mono text-meta tracking-label ${tab === t.id ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        ))}
        <button onClick={onClose} title="Close (Esc)" className="border-l border-accent/10 px-3.5 text-body text-muted hover:text-fg">✕</button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden px-2.5 py-1.5 [zoom:1.15]">
        {views[tab]}
      </div>
    </Overlay>
  )
}

// ─── Sprint Calendar ──────────────────────────────────────────────────────────

function CalendarList({ items, sprint, today }: { items: Deadline[]; sprint: Sprint | null; today: string }) {
  if (items.length === 0) return <span className="label">NO UPCOMING DEADLINES</span>

  const inSprint = (d: Deadline) => !!sprint?.end && d.start <= sprint.end
  const range = (d: Deadline) => (d.end && d.end !== d.start ? `${shortDate(d.start)} – ${shortDate(d.end)}` : shortDate(d.start))
  const sprintLen = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : 0
  const pct = (iso: string) => sprint?.start && sprintLen ? Math.min(100, Math.max(0, (daysBetween(sprint.start, iso) / sprintLen) * 100)) : 0

  const Row = ({ d }: { d: Deadline }) => {
    const active = d.start <= today
    return (
      <div className="border-b border-line-soft py-1">
        <div className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-body ${active ? 'text-ink' : 'text-fg'}`}>{d.title}</span>
          <span className={`shrink-0 font-mono text-meta ${active ? 'text-ok' : 'text-muted'}`}>
            {range(d)}{!active && ` · ${daysBetween(today, d.start)}d`}
          </span>
        </div>
        {inSprint(d) && sprintLen > 0 && (
          <div className="relative mt-1 h-[3px] rounded-full bg-white/5">
            <div className="absolute -top-0.5 h-[7px] w-px bg-accent" style={{ left: `${pct(today)}%` }} />
            <div
              className={`absolute h-[3px] rounded-full ${active ? 'bg-ok' : 'bg-accent/50'}`}
              style={{ left: `${pct(d.start)}%`, width: `${Math.max(2, pct(addDays(d.end ?? d.start, 1)) - pct(d.start))}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  const current = items.filter(inSprint)
  const upcoming = items.filter(d => !inSprint(d))
  return (
    <>
      {current.length > 0 && <div className="label mb-0.5">THIS SPRINT</div>}
      {current.map(d => <Row key={d.id} d={d} />)}
      {upcoming.length > 0 && <div className="label mb-0.5 mt-2">UPCOMING</div>}
      {upcoming.map(d => <Row key={d.id} d={d} />)}
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="text-right">
      <div className={`font-mono text-stat font-bold ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="mt-0.5 font-mono text-badge tracking-label text-muted">{label}</div>
    </div>
  )
}

function SprintMetric({ label, value, progress, tone, title }: { label: string; value: string; progress?: number; tone: Tone; title?: string }) {
  return (
    <div title={title}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label">{label}</span>
        <span className={`font-mono text-meta font-semibold ${TONE_TEXT[tone]}`}>{value}</span>
      </div>
      {progress !== undefined && <ProgressBar value={progress} tone={tone} />}
    </div>
  )
}

function EmptyDrop({ label }: { label: string }) {
  return (
    <div className="m-1 flex h-14 items-center justify-center rounded-xs border border-dashed border-white/10">
      <span className="font-mono text-meta tracking-label text-muted">{label}</span>
    </div>
  )
}

// Ticks every second on its own so the rest of the board doesn't re-render.
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-right">
      <div className="font-mono text-stat font-bold text-accent">
        {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </div>
      <div className="mt-0.5 font-mono text-badge text-muted">{shortDate(localIsoDate(now))} · {now.getFullYear()}</div>
    </div>
  )
}
