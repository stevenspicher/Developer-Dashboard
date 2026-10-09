import type { DragEvent, ReactNode } from 'react'

import type { PullRequest, StoryRequest } from '../bridge'
import { daysBetween } from '../bridge'
import { rowKeys } from '../keys'
import type { RowAction } from '../keys'
import type { PlanEntry } from '../plan'
import type { Reason } from '../ranking'
import { monthDay } from '../schedule'
import type { QueueSource, Task } from '../types'
import { Button, Checkbox, Chip, OnPlanBadge, PriorityBadge, Ref } from './atoms'
import { AcceptanceProgress } from './cockpit/Checklist'
import { SOURCE_COLOR } from './labels'

// The rows of the list-and-pane layouts. Each is a focusable `data-row` inside a
// `data-rows` list, driven by `rowKeys` (see keymap.ts); focusing or clicking one
// selects it. Actions that appear on hover also appear on focus.

export const ENTRY_DRAG = 'application/x-plan-entry'
// A review waiting this many days is flagged.
export const STALE_REVIEW_DAYS = 2

export type Handlers = Partial<Record<RowAction, () => void>>

const stop = (fn: () => void) => (e: React.SyntheticEvent) => { e.stopPropagation(); fn() }

function Row({ id, selected, onSelect, onActivate, handlers, draggable, onDragStart, onDragOver, onDrop, flash, tint, stripe, children }: {
  id: string
  selected: boolean
  onSelect: () => void
  // A click, as opposed to focus moving past the row (a narrow window opens the pane on it).
  onActivate?: () => void
  handlers: Handlers
  draggable?: boolean
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
  flash?: boolean
  tint?: boolean
  // The left edge's colour when not selected: the item's source.
  stripe?: string
  children: ReactNode
}) {
  return (
    <div
      data-row
      data-row-id={id}
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onFocus={onSelect}
      onClick={onActivate ?? onSelect}
      onKeyDown={rowKeys(handlers)}
      className={[
        'row group flex items-start gap-2.5 border-b border-line-soft border-l-4 py-2 pl-2 pr-2',
        selected ? 'border-l-accent bg-accent/[0.07]' : stripe ?? 'border-l-transparent',
        tint && !selected ? 'bg-ok/5' : '',
        flash ? 'row-flash' : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

// Buttons that show on hover and on keyboard focus.
const Quick = ({ children }: { children: ReactNode }) => (
  <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100">{children}</div>
)

// ─── Plan ─────────────────────────────────────────────────────────────────────

export function PlanListRow({ entry, task, id, selected, working, today, highlight, doneTarget, handlers, onSelect, onActivate, onReorder, onToggle, onStart }: {
  entry: PlanEntry
  task?: Task
  id: string
  selected: boolean
  working: boolean
  today: string
  highlight: boolean
  doneTarget: string | null
  handlers: Handlers
  onSelect: () => void
  onActivate?: () => void
  onReorder: (draggedId: string, beforeId: string) => void
  onToggle: () => void
  onStart?: () => void
}) {
  // Once a done reaches the source it can't be unticked from here.
  const locked = !!entry.doneAt
  const title = entry.origin === 'added' && task ? task.title : entry.text
  const origin = entry.origin === 'standup'
    ? entry.briefDate === today || !entry.briefDate ? 'From standup' : `From ${monthDay(entry.briefDate)} standup`
    : entry.addedOn < today ? `Since ${monthDay(entry.addedOn)}` : null
  const checkTitle = locked ? `Done in ${doneTarget ?? 'its source'}`
    : entry.done ? 'Mark not done (x)'
      : doneTarget ? `Mark done in ${doneTarget} (x)`
        : task ? 'Check off; this source is read-only (x)' : 'Check off (x)'

  return (
    <Row
      id={id}
      selected={selected}
      onSelect={onSelect}
      onActivate={onActivate}
      handlers={handlers}
      draggable
      flash={highlight}
      tint={working}
      stripe={task ? SOURCE_COLOR[task.source].stripe : entry.itemSource ? SOURCE_COLOR[entry.itemSource].stripe : undefined}
      onDragStart={e => { e.dataTransfer.setData(ENTRY_DRAG, entry.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (e.dataTransfer.types.includes(ENTRY_DRAG)) e.preventDefault() }}
      onDrop={e => {
        const dragged = e.dataTransfer.getData(ENTRY_DRAG)
        if (!dragged) return
        e.preventDefault()
        e.stopPropagation()
        onReorder(dragged, entry.id)
      }}
    >
      <span className="mt-0.5" onClick={e => e.stopPropagation()}>
        <Checkbox checked={!!entry.done} onChange={onToggle} label={entry.done ? 'Mark not done' : 'Mark done'} title={checkTitle} disabled={locked} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`line-clamp-2 text-body ${entry.done ? 'text-muted line-through' : 'text-ink'}`} title={title}>{title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {(task?.ref ?? entry.itemRef) && <Ref source={task?.source ?? entry.itemSource}>{task?.ref ?? entry.itemRef}</Ref>}
          {working && <Chip tone="ok">Working</Chip>}
          {task?.status === 'blocked' && <Chip tone="danger">Blocked</Chip>}
          {!entry.itemId && !entry.done && <Chip>Not linked</Chip>}
          {!task && entry.missing && <Chip title="It was reassigned, claimed by someone else, or removed">Not on your board</Chip>}
          {origin && <span className="text-meta text-muted">{origin}</span>}
        </div>
      </div>
      {onStart && !entry.done && !working && <Quick><Button onClick={stop(onStart)} title="Start working on it (s)" aria-label="Start">▶</Button></Quick>}
    </Row>
  )
}

// ─── Board items: queue, up next, blocked ─────────────────────────────────────

export function TaskListRow({ task, id, selected, reasons, onPlan, handlers, onSelect, onActivate, onDragStart, quick }: {
  task: Task
  id: string
  selected: boolean
  reasons?: Reason[]
  // A queue item that is in today's plan too.
  onPlan?: boolean
  handlers: Handlers
  onSelect: () => void
  onActivate?: () => void
  onDragStart: (e: DragEvent) => void
  quick?: ReactNode
}) {
  return (
    <Row id={id} selected={selected} onSelect={onSelect} onActivate={onActivate} handlers={handlers} draggable onDragStart={onDragStart} stripe={SOURCE_COLOR[task.source].stripe}>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-body text-ink" title={task.title}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {onPlan && <OnPlanBadge />}
          <Ref source={task.source}>{task.ref}</Ref>
          <PriorityBadge priority={task.priority} />
          {task.externalState && <Chip>{task.externalState}</Chip>}
          <AcceptanceProgress task={task} />
          {reasons?.slice(0, 2).map(r => <Chip key={r.text} tone={r.urgent ? 'warn' : 'neutral'}>{r.text}</Chip>)}
        </div>
      </div>
      {quick && <Quick>{quick}</Quick>}
    </Row>
  )
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export const reviewAge = (pr: PullRequest, today: string) => (pr.createdDate ? daysBetween(pr.createdDate.slice(0, 10), today) : 0)

export function ReviewListRow({ pr, id, selected, today, handlers, onSelect, onActivate }: {
  pr: PullRequest
  id: string
  selected: boolean
  today: string
  handlers: Handlers
  onSelect: () => void
  onActivate?: () => void
}) {
  const days = reviewAge(pr, today)
  return (
    <Row id={id} selected={selected} onSelect={onSelect} onActivate={onActivate} handlers={handlers}>
      <span className="mt-0.5 shrink-0 font-mono text-meta text-muted">#{pr.pullRequestId}</span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-body text-ink" title={pr.title}>{pr.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
          {pr.repo && <span className="font-mono">{pr.repo}</span>}
          {pr.author && <span>by {pr.author}</span>}
          <span className={days >= STALE_REVIEW_DAYS ? 'text-warn' : ''}>{days <= 0 ? 'opened today' : `${days}d waiting`}</span>
          {pr.isRequired && <Chip>Required</Chip>}
        </div>
      </div>
    </Row>
  )
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export function TeamListRow({ developer, text, blockedCount, id, selected, handlers, onSelect, onActivate }: {
  developer: string
  text: string
  blockedCount: number
  id: string
  selected: boolean
  handlers: Handlers
  onSelect: () => void
  onActivate?: () => void
}) {
  return (
    <Row id={id} selected={selected} onSelect={onSelect} onActivate={onActivate} handlers={handlers}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold text-ink">{developer}</span>
          {blockedCount > 0 && <Chip tone="danger">{blockedCount} blocked</Chip>}
        </div>
        <div className="mt-0.5 line-clamp-2 text-note text-dim">{text}</div>
      </div>
    </Row>
  )
}

// ─── User story requests (the story owner's list) ─────────────────────────────

export function RequestListRow({ request, today, id, selected, handlers, onSelect, onActivate }: {
  request: StoryRequest
  today: string
  id: string
  selected: boolean
  handlers: Handlers
  onSelect: () => void
  onActivate?: () => void
}) {
  const source = requestSource(request)
  const days = request.createdAt ? daysBetween(request.createdAt.slice(0, 10), today) : 0
  return (
    <Row id={id} selected={selected} onSelect={onSelect} onActivate={onActivate} handlers={handlers} stripe={source ? SOURCE_COLOR[source].stripe : undefined}>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-body text-ink" title={request.title}>{request.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
          {request.itemRef && <Ref source={source}>{request.itemRef}</Ref>}
          <span>{requesterName(request.requestedBy)}</span>
          <span>{days <= 0 ? 'today' : `${days}d ago`}</span>
        </div>
      </div>
    </Row>
  )
}

// The queue source a request's item came from, by the label stored on it.
export const requestSource = (r: StoryRequest): QueueSource | undefined =>
  (({ Tasks: 'tasks', Pulse: 'pulse', Solarwinds: 'solarwinds', ADS: 'ads' }) as Record<string, QueueSource>)[r.source]

// "philip.fiesta@bluefcu.com" → "Philip Fiesta".
export const requesterName = (email: string) =>
  email.split('@')[0].split(/[._]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
