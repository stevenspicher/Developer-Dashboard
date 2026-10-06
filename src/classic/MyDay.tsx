import { useState } from 'react'

import type { Task } from '../types'
import type { BriefLine, PullRequest, QueueProgress, Sprint, StandupBrief, TeamBlocker } from '../bridge'
import { daysBetween } from '../bridge'
import { rowKeys } from '../keys'
import type { PlanEntry } from '../plan'
import type { Reason, Suggestion } from '../ranking'
import { LinkedText } from '../RichText'
import type { DayEvent } from '../schedule'
import { dayLabel, longDate, monthDay, weekdayShort, workingDaysAfter } from '../schedule'

// ─── My Day ───────────────────────────────────────────────────────────────────
// The centre of the board when nothing is being worked on: today's plan (the
// standup's responsibilities plus anything added), ranked suggestions, blocked
// items, coming dates and the team's notes.
import type { DayActions, PlanView, Reviews } from '../board/types'
export type { DayActions, DropZone, PlanView, ReaderTab, Reviews } from '../board/types'

const UP_NEXT_SHOWN = 6
// A review waiting this many days is flagged.
const STALE_REVIEW_DAYS = 2
const ENTRY_DRAG = 'application/x-plan-entry'

const stop = (fn: () => void) => (e: React.SyntheticEvent) => {
  e.stopPropagation()
  fn()
}

export function MyDay({ today, sprint, brief, planView, upNext, reviews, events, teamItems, blocked, working, storyProgress, teamBlockers, dragging, actions }: {
  today: string
  sprint: Sprint | null
  brief: StandupBrief | { error: string } | null
  planView: PlanView
  upNext: Suggestion[]
  reviews: Reviews
  events: DayEvent[]
  teamItems: BriefLine[]
  blocked: Task[]
  working: Task | null
  storyProgress?: QueueProgress
  teamBlockers: TeamBlocker[]
  dragging: boolean
  actions: DayActions
}) {
  const [allUpNext, setAllUpNext] = useState(false)
  const briefData = brief && !('error' in brief) ? brief : null
  const lead = briefData?.mode === 'leadership'
  const entries = planView.plan.entries
  const open = entries.filter(e => !e.done).length
  const shownUpNext = allUpNext ? upNext : upNext.slice(0, UP_NEXT_SHOWN)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {working && (
        <div className="flex shrink-0 items-center gap-2 border-b border-ok/20 bg-ok/5 px-4 py-2">
          <span className="pulse size-2 shrink-0 rounded-full bg-ok" />
          <span className="truncate text-note text-fg">
            Working on <span className="ref">{working.ref}</span> {working.title}
          </span>
          <button className="btn-quiet ml-auto shrink-0" onClick={actions.resume} title="Back to the item (Esc toggles)">RESUME</button>
        </div>
      )}

      <DayHeader today={today} sprint={sprint} brief={brief} storyProgress={storyProgress} onReader={actions.openReader} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-line px-4 py-3">
          {lead && briefData && <TeamToday summaries={briefData.summaries} blockers={teamBlockers} />}

          <section {...actions.dropProps('today')} className="drop-zone rounded-xs">
            <SectionHead
              label={lead ? 'YOUR PLAN' : "TODAY'S PLAN"}
              count={entries.length ? `${open} to do · ${entries.length - open} done` : undefined}
              right={entries.length > 1 ? 'drag or Alt+↑↓ to reorder' : undefined}
            />
            <div
              data-rows="plan"
              onDragOver={e => { if (e.dataTransfer.types.includes(ENTRY_DRAG)) e.preventDefault() }}
              onDrop={e => {
                const id = e.dataTransfer.getData(ENTRY_DRAG)
                if (id) { e.preventDefault(); e.stopPropagation(); actions.reorder(id, null) }
              }}
            >
              {entries.map(e => <PlanRow key={e.id} entry={e} view={planView} actions={actions} today={today} />)}
            </div>
            {entries.length === 0 && (
              <div className="rounded-xs border border-dashed border-tint/10 px-3 py-4 text-note text-muted">
                {briefData?.mode === 'brief' || lead
                  ? 'Nothing planned yet. Add items from Up next, or drag them in from the queues.'
                  : "Your standup responsibilities show up here once today's brief is posted. Meanwhile, add items from Up next."}
              </div>
            )}
          </section>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-3">
          <section>
            <SectionHead
              label="UP NEXT"
              count={upNext.length ? String(upNext.length) : undefined}
              right={upNext.length > UP_NEXT_SHOWN && (
                <button className="link font-mono text-meta" onClick={() => setAllUpNext(v => !v)}>
                  {allUpNext ? 'SHOW FEWER' : `SHOW ALL ${upNext.length}`}
                </button>
              )}
            />
            <div data-rows="upnext">
              {shownUpNext.map(s => <UpNextRow key={s.task.id} suggestion={s} actions={actions} />)}
            </div>
            {upNext.length === 0 && <div className="py-2 text-note text-muted">Nothing waiting outside your plan.</div>}
          </section>

          {reviews !== null && (
            <section className="mt-5">
              <SectionHead
                label="REVIEWS WAITING"
                count={Array.isArray(reviews) && reviews.length ? String(reviews.length) : undefined}
                tone={Array.isArray(reviews) && reviews.some(pr => reviewAge(pr, today) >= STALE_REVIEW_DAYS) ? 'text-warn' : 'text-accent'}
              />
              <ReviewList reviews={reviews} today={today} />
            </section>
          )}

          {(blocked.length > 0 || dragging) && (
            <section {...actions.dropProps('blocked')} className="drop-zone drop-zone-blocked mt-5 rounded-xs">
              <SectionHead label="BLOCKED" count={String(blocked.length)} tone="text-danger" />
              <div data-rows="blocked">
                {blocked.map(t => <BlockedRow key={t.id} task={t} actions={actions} />)}
              </div>
              {blocked.length === 0 && <div className="py-2 text-note text-muted">Drop here to mark it blocked.</div>}
            </section>
          )}

          <section className="mt-5">
            <SectionHead
              label="COMING UP"
              right={<button className="link font-mono text-meta" onClick={() => actions.openReader('calendar')}>CALENDAR ⤢</button>}
            />
            <ComingUp events={events} today={today} />
          </section>

          {teamItems.length > 0 && (
            <section className="mt-5">
              <SectionHead
                label="TEAM NOTES"
                right={<button className="link font-mono text-meta" onClick={() => actions.openReader('brief')}>BRIEF ⤢</button>}
              />
              {teamItems.map((l, i) => (
                <div key={i} className="flex gap-2 border-b border-line-soft py-1 last:border-b-0">
                  <span className="shrink-0 font-mono text-meta text-accent">•</span>
                  <span className="text-note text-fg"><LinkedText text={l.text} /></span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      <KeyHints />
    </div>
  )
}

const reviewAge = (pr: PullRequest, today: string) => (pr.createdDate ? daysBetween(pr.createdDate.slice(0, 10), today) : 0)

function ReviewList({ reviews, today }: { reviews: Reviews; today: string }) {
  if (reviews === 'loading') return <div className="py-2 font-mono text-meta text-muted">LOADING…</div>
  if (reviews && !Array.isArray(reviews)) {
    return (
      <div className="py-2 font-mono text-meta text-danger-fg">
        {reviews.error === 'Not Found' ? 'Reviews need an updated ado-bridge' : `Reviews unavailable · ${reviews.error}`}
      </div>
    )
  }
  if (!reviews || reviews.length === 0) return <div className="py-2 text-note text-muted">No reviews waiting on you.</div>
  return (
    <>
      {reviews.map(pr => {
        const days = reviewAge(pr, today)
        return (
          <a
            key={pr.pullRequestId}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            title="Open the pull request in Azure DevOps"
            className="group flex items-start gap-2 border-b border-line-soft py-1.5 last:border-b-0"
          >
            <span className="mt-0.5 shrink-0 font-mono text-meta text-muted">#{pr.pullRequestId}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-note text-fg group-hover:text-ink">{pr.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-meta text-muted">
                {pr.repo && <span>{pr.repo}</span>}
                {pr.author && <span>by {pr.author}</span>}
                <span className={days >= STALE_REVIEW_DAYS ? 'text-warn' : ''}>{days <= 0 ? 'opened today' : `${days}d waiting`}</span>
                {pr.isRequired && <span className="chip">REQUIRED</span>}
              </span>
            </span>
            <span className="shrink-0 text-accent">↗</span>
          </a>
        )
      })}
    </>
  )
}

function DayHeader({ today, sprint, brief, storyProgress, onReader }: {
  today: string
  sprint: Sprint | null
  brief: StandupBrief | { error: string } | null
  storyProgress?: QueueProgress
  onReader: DayActions['openReader']
}) {
  const length = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : null
  const day = sprint?.start && length ? Math.min(length, Math.max(1, daysBetween(sprint.start, today) + 1)) : null
  const left = sprint?.end && sprint.end >= today ? workingDaysAfter(today, sprint.end) : null
  const sprintLine = sprint
    ? [
      sprint.name,
      day && length && `day ${day} of ${length}`,
      sprint.end && `ends ${weekdayShort(sprint.end)}`,
      left !== null && `${left} working ${left === 1 ? 'day' : 'days'} after today`,
    ].filter(Boolean).join(' · ')
    : 'Sprint not loaded'

  let briefChip: React.ReactNode
  if (!brief) briefChip = <span className="chip">Loading brief…</span>
  else if ('error' in brief) briefChip = <span className="chip border-danger/30 bg-danger/10 text-danger-fg" title={brief.error}>Brief unavailable</span>
  else if (brief.mode === 'none' || !brief.date) briefChip = <span className="chip">No standup brief this sprint</span>
  else if (brief.isToday) {
    briefChip = <button className="chip border-ok/30 bg-ok/10 text-ok hover:bg-ok/20" onClick={() => onReader('brief')}>✓ Today's brief is in</button>
  } else {
    briefChip = (
      <button className="chip border-warn/30 bg-warn/10 text-warn hover:bg-warn/20" onClick={() => onReader('brief')}>
        Today's brief isn't posted yet · showing {monthDay(brief.date)}
      </button>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
      <div>
        <div className="text-title font-bold text-ink">My day · {longDate(today)}</div>
        <div className="font-mono text-meta text-muted">{sprintLine}</div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {briefChip}
        <button className="chip hover:text-ink" onClick={() => onReader('draft')} title="A standup update built from your day, ready to copy">
          STANDUP DRAFT
        </button>
        {storyProgress && storyProgress.total > 0 && (
          <span className="chip" title="Stories closed / committed this sprint · story points closed / committed">
            Stories {storyProgress.done}/{storyProgress.total}
            {storyProgress.totalPoints ? ` · ${storyProgress.donePoints}/${storyProgress.totalPoints} pt` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function SectionHead({ label, count, right, tone = 'text-accent' }: { label: string; count?: string; right?: React.ReactNode; tone?: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 border-b border-line pb-1.5">
      <span className={`label font-bold ${tone}`}>{label}</span>
      {count && <span className="font-mono text-meta text-muted">{count}</span>}
      {right && <span className="ml-auto font-mono text-meta text-muted">{right}</span>}
    </div>
  )
}

function Reasons({ reasons, max = 3 }: { reasons: Reason[]; max?: number }) {
  return (
    <>
      {reasons.slice(0, max).map(r => (
        <span key={r.text} className={`chip ${r.urgent ? 'border-warn/30 bg-warn/10 text-warn' : ''}`}>{r.text}</span>
      ))}
    </>
  )
}

function PlanRow({ entry, view, actions, today, compact = false }: {
  entry: PlanEntry
  view: PlanView
  actions: DayActions
  today: string
  compact?: boolean
}) {
  const task = entry.itemId ? view.tasksById.get(entry.itemId) : undefined
  const suggestion = view.suggestions.get(entry.id)
  const working = !!task && task.id === view.workingId
  // Where ✓ writes; for an item that has left the board, the system it was in.
  const target = task ? actions.doneTarget(task) : entry.itemSource ? (entry.itemSource === 'stories' ? 'ADO' : 'Notion') : null
  // Once a done reaches the source it can't be unticked from here.
  const locked = !!entry.doneAt
  const duplicate = task ? view.duplicates.get(task.id) : undefined
  const title = entry.origin === 'added' && task ? task.title : entry.text
  const origin = entry.origin === 'standup'
    ? entry.briefDate === today || !entry.briefDate ? 'From standup' : `From ${monthDay(entry.briefDate)} standup`
    : entry.addedOn < today ? `Since ${monthDay(entry.addedOn)}` : null
  const checkTitle = locked
    ? `Done in ${target ?? 'its source'}`
    : entry.done ? 'Mark not done (x)'
      : target ? `Mark done in ${target} (x)`
        : task ? 'Check off; this source is read-only (x)' : 'Check off (x)'

  return (
    <div
      data-row
      data-entry={entry.id}
      tabIndex={0}
      draggable
      onDragStart={e => { e.dataTransfer.setData(ENTRY_DRAG, entry.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (e.dataTransfer.types.includes(ENTRY_DRAG)) e.preventDefault() }}
      onDrop={e => {
        const id = e.dataTransfer.getData(ENTRY_DRAG)
        if (!id) return
        e.preventDefault()
        e.stopPropagation()
        actions.reorder(id, entry.id)
      }}
      onKeyDown={rowKeys({
        toggle: locked ? undefined : () => actions.toggle(entry),
        open: task ? () => actions.open(task) : () => actions.pick(entry),
        start: task && !entry.done && !working ? () => actions.start(task) : undefined,
        block: task && !entry.done ? () => actions.block(task) : undefined,
        remove: () => actions.remove(entry),
        up: () => actions.shift(entry, -1),
        down: () => actions.shift(entry, 1),
      })}
      className={`row group flex items-start gap-2.5 border-b border-line-soft px-1 ${compact ? 'py-1.5' : 'py-2'} ${working ? 'bg-ok/5' : ''} ${view.highlight === entry.id ? 'row-flash' : ''}`}
    >
      <button
        role="checkbox"
        aria-checked={!!entry.done}
        aria-label={entry.done ? 'Mark not done' : 'Mark done'}
        title={checkTitle}
        disabled={locked}
        onClick={stop(() => actions.toggle(entry))}
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border text-badge ${entry.done ? 'border-ok/60 bg-ok/15 text-ok' : 'border-muted hover:border-accent'}`}
      >
        {entry.done ? '✓' : ''}
      </button>

      <div className="min-w-0 flex-1">
        <div
          title={compact ? title : undefined}
          className={`${compact ? 'line-clamp-2 text-note' : 'text-body'} ${entry.done ? 'text-muted line-through' : 'text-ink'}`}
        >{title}</div>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {(task || entry.itemRef) && (
              <button className="ref hover:text-accent" onClick={stop(() => actions.pick(entry))} title="Change or remove the link">
                {task?.ref ?? entry.itemRef}
              </button>
            )}
            {working && <span className="chip border-ok/30 bg-ok/10 text-ok">Working</span>}
            {task?.status === 'blocked' && <span className="chip border-danger/30 bg-danger/10 text-danger-fg">Blocked</span>}
            {origin && <span className="chip">{origin}</span>}
            {!task && entry.missing && <span className="chip" title="It was reassigned, claimed by someone else, or removed">Not on your board</span>}
            {task?.externalState && !(task.status === 'blocked' && /^blocked$/i.test(task.externalState)) && (
              <span className="chip">{task.externalState}</span>
            )}
            {task && !entry.done && <Reasons reasons={view.reasons(task)} max={2} />}
            {duplicate && (
              <span className="chip border-warn/30 bg-warn/10 text-warn" title={duplicate.title}>Possible duplicate of {duplicate.ref}</span>
            )}
            {!entry.itemId && !entry.done && (suggestion ? (
              <>
                <span className="chip" title={suggestion.title}>Looks like {suggestion.ref}</span>
                <button className="btn-quiet" onClick={stop(() => actions.confirm(entry, suggestion))} title={`Link to ${suggestion.ref}: ${suggestion.title}`}>CONFIRM</button>
                <button className="btn-quiet" onClick={stop(() => actions.reject(entry, suggestion))} title="Not this one" aria-label="Not this one">✕</button>
              </>
            ) : (
              <span className="chip">Not linked</span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {task && !entry.done && !working && (
          <button className="btn-quiet" onClick={stop(() => actions.start(task))} title="Start working on it (s)">{compact ? '▶' : '▶ START'}</button>
        )}
        {!compact && !entry.itemId && !entry.done && (
          <button className="btn-quiet" onClick={stop(() => actions.pick(entry))} title="Link to a board item (Enter)">LINK</button>
        )}
        <button
          className="btn-quiet opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100"
          onClick={stop(() => actions.remove(entry))}
          title="Remove from today's plan (Delete)"
          aria-label="Remove from today's plan"
        >×</button>
      </div>
    </div>
  )
}

function UpNextRow({ suggestion, actions }: { suggestion: Suggestion; actions: DayActions }) {
  const { task } = suggestion
  const claims = task.source === 'pulse'
  return (
    <div
      data-row
      tabIndex={0}
      draggable
      onDragStart={e => actions.dragItem(e, task.id)}
      onClick={() => actions.open(task)}
      onKeyDown={rowKeys({
        open: () => actions.open(task),
        start: () => actions.start(task),
        add: () => actions.add(task),
        block: () => actions.block(task),
        done: actions.doneTarget(task) ? () => actions.done(task) : undefined,
      })}
      className="row group flex cursor-pointer items-start gap-2.5 border-b border-line-soft px-1 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="text-body text-ink">{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="ref">{task.ref}</span>
          <Reasons reasons={suggestion.reasons} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          className="btn-quiet"
          onClick={stop(() => actions.add(task))}
          title={claims ? "Add to today's plan and claim it in Notion (t)" : "Add to today's plan (t)"}
        >{claims ? '＋ CLAIM' : '＋ PLAN'}</button>
        <button className="btn-quiet" onClick={stop(() => actions.start(task))} title="Start working on it (s)" aria-label="Start">▶</button>
      </div>
    </div>
  )
}

function BlockedRow({ task, actions }: { task: Task; actions: DayActions }) {
  return (
    <div
      data-row
      tabIndex={0}
      onClick={() => actions.open(task)}
      onKeyDown={rowKeys({ open: () => actions.open(task), start: () => actions.start(task), add: () => actions.unblock(task) })}
      className="row group flex cursor-pointer items-center gap-2 border-b border-line-soft px-1 py-1.5"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-danger" />
      <span className="ref">{task.ref}</span>
      <span className="min-w-0 flex-1 truncate text-note text-fg">{task.title}</span>
      <button className="btn-quiet shrink-0" onClick={stop(() => actions.unblock(task))} title="Move back to today's plan (t)">UNBLOCK</button>
    </div>
  )
}

const KIND_MARK: Record<DayEvent['kind'], { mark: string; tone: string; what: string }> = {
  deadline: { mark: '◆', tone: 'text-accent', what: 'Deadlines and Milestones' },
  sprint: { mark: '◈', tone: 'text-accent', what: 'Sprint' },
  team: { mark: '•', tone: 'text-muted', what: 'From the team notes' },
}

function ComingUp({ events, today }: { events: DayEvent[]; today: string }) {
  if (events.length === 0) return <div className="py-2 text-note text-muted">Nothing dated in the next three weeks.</div>
  return (
    <>
      {events.map(e => (
        <div key={`${e.date}:${e.label}`} className="flex items-baseline gap-2.5 py-0.5" title={e.detail ? `From the team notes: ${e.detail}` : KIND_MARK[e.kind].what}>
          <span className={`w-[78px] shrink-0 font-mono text-meta ${e.date <= today ? 'text-warn' : 'text-muted'}`}>
            {dayLabel(e.date, today)}{e.end ? `–${Number(e.end.slice(8))}` : ''}
          </span>
          <span className={`shrink-0 text-meta ${KIND_MARK[e.kind].tone}`}>{KIND_MARK[e.kind].mark}</span>
          <span className="text-note text-fg">{e.label}</span>
        </div>
      ))}
    </>
  )
}

// A lead's view of the team: each developer's standup update, plus any of
// their ADO stories in the Blocked state.
function TeamToday({ summaries, blockers }: { summaries: { developer: string; text: string }[]; blockers: TeamBlocker[] }) {
  const firstName = (name: string) => name.trim().split(/\s+/)[0].toLowerCase()
  const byDeveloper = new Map(summaries.map(s => [s.developer.toLowerCase(), [] as TeamBlocker[]]))
  const others: TeamBlocker[] = []
  for (const b of blockers) (byDeveloper.get(firstName(b.assignee)) ?? others).push(b)

  return (
    <section className="mb-5">
      <SectionHead label="TEAM TODAY" count={summaries.length ? `${summaries.length} updates` : undefined} />
      {summaries.length === 0 && <div className="py-2 text-note text-muted">No developer updates in this summary.</div>}
      {summaries.map(s => (
        <div key={s.developer} className="border-b border-line-soft py-2 last:border-b-0">
          <div className="flex items-start gap-2">
            <span className="mt-px shrink-0 rounded-xs bg-accent/10 px-1.5 font-mono text-meta text-accent">{s.developer.toUpperCase()}</span>
            <span className="text-body text-fg"><LinkedText text={s.text} /></span>
          </div>
          {byDeveloper.get(s.developer.toLowerCase())?.map(b => <BlockerLine key={b.ref} blocker={b} />)}
        </div>
      ))}
      {others.length > 0 && (
        <div className="py-2">
          <div className="label mb-1">ALSO BLOCKED</div>
          {others.map(b => <BlockerLine key={b.ref} blocker={b} showWho />)}
        </div>
      )}
    </section>
  )
}

function BlockerLine({ blocker, showWho = false }: { blocker: TeamBlocker; showWho?: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 pl-1">
      <span className="chip border-danger/30 bg-danger/10 text-danger-fg">Blocked</span>
      {blocker.url
        ? <a href={blocker.url} target="_blank" rel="noreferrer" className="ref hover:text-accent">{blocker.ref} ↗</a>
        : <span className="ref">{blocker.ref}</span>}
      <span className="truncate text-note text-dim">{showWho && `${blocker.assignee}: `}{blocker.title}</span>
    </div>
  )
}

const KEYS: [string, string][] = [
  ['j k', 'move'],
  ['Enter', 'open'],
  ['s', 'start'],
  ['t', 'add to plan'],
  ['x', 'check off'],
  ['d', 'done'],
  ['b', 'block'],
  ['Alt ↑↓', 'reorder'],
  ['p n q', 'jump to plan, up next, queues'],
]

function KeyHints() {
  return (
    <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-meta text-muted">
      {KEYS.map(([keys, what]) => (
        <span key={keys}><kbd className="font-mono text-dim">{keys}</kbd> {what}</span>
      ))}
    </div>
  )
}

// ─── While working: the plan beside the item ──────────────────────────────────

export function FocusBar({ task, next, onBack, onStart }: {
  task: Task
  next: { entry: PlanEntry; task?: Task } | null
  onBack: () => void
  onStart: (task: Task) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button className="btn-quiet" onClick={onBack} title="Back to My day (Esc)">← MY DAY</button>
      <span className="label font-bold text-accent">◈ WORKING SPACE</span>
      <span className="ref">— {task.ref ?? task.id}</span>
      {next && (
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <span className="label shrink-0">NEXT</span>
          <span className="truncate text-note text-dim">{next.task?.title ?? next.entry.text}</span>
          {next.task && (
            <button className="btn-quiet shrink-0" onClick={() => onStart(next.task!)} title="Start the next item in your plan">▶</button>
          )}
        </span>
      )}
    </div>
  )
}

export function PlanRail({ planView, blocked, today, actions }: {
  planView: PlanView
  blocked: Task[]
  today: string
  actions: DayActions
}) {
  const entries = planView.plan.entries
  const open = entries.filter(e => !e.done).length
  return (
    <div className="flex flex-col overflow-hidden border-l border-line">
      <div {...actions.dropProps('today')} className="drop-zone flex min-h-0 flex-1 flex-col">
        <div className="panel-header shrink-0">
          <span className="size-1.5 shrink-0 rounded-full bg-accent" />
          TODAY'S PLAN
          <span className="ml-auto rounded-xs bg-accent/10 px-1.5 text-badge text-accent">{open}</span>
        </div>
        <div data-rows="plan" className="flex-1 overflow-y-auto px-2 py-1">
          {entries.map(e => <PlanRow key={e.id} entry={e} view={planView} actions={actions} today={today} compact />)}
          {entries.length === 0 && <div className="px-1 py-3 text-note text-muted">Nothing planned yet.</div>}
        </div>
      </div>
      <div {...actions.dropProps('blocked')} className="drop-zone drop-zone-blocked flex max-h-[40%] min-h-[120px] flex-col border-t border-line">
        <div className="panel-header shrink-0">
          <span className={`size-1.5 shrink-0 rounded-full bg-danger ${blocked.length ? 'pulse' : ''}`} />
          BLOCKED
          <span className="ml-auto rounded-xs bg-danger/10 px-1.5 text-badge text-danger">{blocked.length}</span>
        </div>
        <div data-rows="blocked" className="overflow-y-auto px-2 py-1">
          {blocked.map(t => <BlockedRow key={t.id} task={t} actions={actions} />)}
          {blocked.length === 0 && <div className="px-1 py-3 text-note text-muted">No blockers. Drop an item here to block it.</div>}
        </div>
      </div>
    </div>
  )
}
