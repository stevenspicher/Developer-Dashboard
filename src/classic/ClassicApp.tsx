import { useEffect, useMemo, useState } from 'react'

import type { Priority, Task, TaskType } from '../types'
import {
  DEADLINE_TICKER_DAYS, QUEUES, STALE_STANDUP_DAYS, TEST_DEVELOPERS, addDays, daysBetween, localIsoDate, plainText,
  shortDate,
} from '../bridge'
import type { BriefLine, Deadline, Sprint, StandupBrief } from '../bridge'
import { useBoardContext } from '../board/BoardContext'
import { SOURCE_TABS, sourceSystem } from '../board/constants'
import BootScreen from '../BootScreen'
import { focusFirstRow, rowKeys } from '../keys'
import { FocusBar, MyDay, PlanRail } from './MyDay'
import type { ReaderTab } from './MyDay'
import { rankByTitle } from '../plan'
import type { PlanEntry } from '../plan'
import { AcceptanceProgress } from '../ui/cockpit/Checklist'
import { CockpitContext } from '../ui/cockpit/context'
import { CockpitPane } from '../ui/cockpit/CockpitPane'
import type { PaneActionId } from '../ui/cockpit/actions'
import { LinkedText } from '../RichText'
import { longDate as formatLongDate } from '../schedule'
import { buildStandupDraft } from '../standup'
import { StandupDraft } from '../StandupDraft'

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


type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'muted'
const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-fg', muted: 'text-muted',
}

// My Day takes the whole centre; while working, the plan moves to a right rail.
const GRID_DAY = 'grid-cols-[clamp(300px,21vw,360px)_minmax(0,1fr)]'
const GRID_FOCUS = 'grid-cols-[clamp(300px,21vw,360px)_minmax(0,1fr)_clamp(232px,16vw,300px)]'


// ─── Primitives ───────────────────────────────────────────────────────────────

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
      title={`Mark done in ${target} (d)`}
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

function TaskCard({ task, onDragStart, compact = false, onClick, onDone, onAdd, onStart, onBlock }: {
  task: Task
  onDragStart: (e: React.DragEvent, id: string) => void
  compact?: boolean
  onClick?: () => void
  onDone?: () => void
  onAdd?: () => void
  onStart?: () => void
  onBlock?: () => void
}) {
  return (
    <div
      data-row
      tabIndex={0}
      draggable
      onDragStart={e => onDragStart(e, task.id)}
      onClick={onClick}
      onKeyDown={rowKeys({ open: onClick, done: onDone, add: onAdd, start: onStart, block: onBlock })}
      className={`task-card panel group mb-1.5 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
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
            <AcceptanceProgress task={task} />
            <div className="ml-auto flex items-center gap-2 font-mono text-meta text-muted">
              {task.standupAgeDays !== undefined && (
                <span className={task.standupAgeDays > STALE_STANDUP_DAYS ? 'text-warn' : ''}>STANDUP {task.standupAgeDays}d</span>
              )}
              {task.sprint && <span>{task.sprint}</span>}
            </div>
          </div>
        </>
      )}

      {/* Shown on hover or keyboard focus, over the card's bottom right. */}
      {(onAdd || onStart) && (
        <div className="absolute bottom-2 right-2 hidden items-center gap-1 rounded-xs bg-surface pl-1 group-hover:flex group-focus:flex group-focus-within:flex">
          {onAdd && (
            <button
              className="btn-quiet"
              onClick={e => { e.stopPropagation(); onAdd() }}
              title={task.source === 'pulse' ? "Add to today's plan and claim it in Notion (t)" : "Add to today's plan (t)"}
            >{task.source === 'pulse' ? '＋ CLAIM' : '＋ PLAN'}</button>
          )}
          {onStart && (
            <button className="btn-quiet" onClick={e => { e.stopPropagation(); onStart() }} title="Start working on it (s)" aria-label="Start">▶</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Link picker ──────────────────────────────────────────────────────────────

// Links a plan entry to a board item: closest titles first, filterable.
function LinkPicker({ entry, tasks, onLink, onUnlink, onClose }: {
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
    <Overlay onClose={onClose} className="max-h-[80vh] w-[640px]">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-accent/15 bg-accent/5 px-4 py-2.5">
        <span className="label text-accent">LINK TO A BOARD ITEM</span>
        <span className="ml-auto" />
        <CloseButton onClose={onClose} />
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
          placeholder="Filter by title or ref"
          className="rounded-xs border border-line bg-sunken px-2.5 py-1.5 text-body text-fg outline-none placeholder:text-muted focus:border-accent"
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
              <span className="chip">{TYPE_LABELS[t.type]}</span>
              <span className="ref">{t.ref}</span>
              <span className="min-w-0 flex-1 truncate text-note text-fg">{t.title}</span>
              {t.id === entry.itemId && <span className="chip border-ok/30 bg-ok/10 text-ok">Linked</span>}
            </div>
          ))}
          {candidates.length === 0 && <div className="py-3 text-note text-muted">No items match.</div>}
        </div>
        {entry.itemId && <button className="btn-quiet self-start" onClick={onUnlink}>REMOVE LINK</button>}
      </div>
    </Overlay>
  )
}

// ─── Detail modal and working space ───────────────────────────────────────────

// Any item, opened in full: the cockpit pane in a modal.
function DetailModal({ task, planned, onClose, handlers, doneTarget }: {
  task: Task
  planned: boolean
  onClose: () => void
  handlers: Partial<Record<PaneActionId, () => void>>
  doneTarget: string | null
}) {
  return (
    <Overlay onClose={onClose} className="h-[82vh] w-[920px]">
      <CockpitPane
        key={task.id}
        task={task}
        sourceLabel={SOURCE_TABS.find(s => s.id === task.source)?.label}
        planned={planned}
        doneTarget={doneTarget}
        handlers={handlers}
        onClose={onClose}
      />
    </Overlay>
  )
}

// The item being worked on, in the middle of the board.
function WorkingSpace({ task, handlers, doneTarget, onReturnDragStart }: {
  task: Task
  handlers: Partial<Record<PaneActionId, () => void>>
  doneTarget: string | null
  onReturnDragStart: (e: React.DragEvent) => void
}) {
  return (
    <div className="panel hud-corner flex min-h-0 flex-1 flex-col border-accent/30">
      <CockpitPane
        key={task.id}
        task={task}
        sourceLabel={SOURCE_TABS.find(s => s.id === task.source)?.label}
        planned
        working
        doneTarget={doneTarget}
        handlers={handlers}
        onReturnDragStart={onReturnDragStart}
      />
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function ClassicApp() {
  const board = useBoardContext()
  const {
    visibleTasks, plan, tasksById, ticks, developer, currentDeveloper, today, sprint, brief, briefData, reviews, teamBlockers, progress,
    bridgeLoading, bridgeErrors, actionError, toast, booting, focusing, workingTask, modalTask, linkFor, reader,
    queueTab, dragId, dropTarget, planned, queueTasks, blockedTasks, openEntries, upNext, events, planView, nextUp,
    linkCandidates, unplannedCount, countOf, sprintHeader, sprintDay, sprintLength, sprintDaysLeft, tickerItems,
    calendarItems, bootSteps, bootSummary, actions, cockpit, doneHandler, startTask, addToPlan, moveTask, changeDeveloper,
    openMention, handleDragStart, handleDragOver, handleDragLeave, handleDrop, setQueueTab, setModalTask, closeDetail,
    startFromDetail, addFromDetail, backToMyDay, returnToPlan, dismissError, linkEntry, unlinkEntry, closePicker,
    setReader, closeReader, undoToast, finishBoot,
  } = board

  // What the cockpit pane's buttons do. In the modal, Start and Plan also close it.
  const paneHandlers = (task: Task, inModal = false): Partial<Record<PaneActionId, () => void>> => ({
    start: () => (inModal ? startFromDetail(task) : startTask(task)),
    add: () => (inModal ? addFromDetail(task) : addToPlan(task)),
    block: () => moveTask(task.id, 'blocked'),
    unblock: () => actions.unblock(task),
    return: () => returnToPlan(task),
    done: doneHandler(task),
  })
  // The modal's item as it is now, so its buttons follow its lane.
  const shownTask = modalTask ? tasksById.get(modalTask.id) : undefined

  const draftView = (
    <StandupDraft
      draft={buildStandupDraft({
        today,
        plan,
        tasksById,
        blocked: blockedTasks,
        reviews: Array.isArray(reviews) ? reviews : [],
        ticks,
        longDate: formatLongDate(today),
      })}
    />
  )

  const briefView = <BriefPanel brief={brief} tasks={visibleTasks} onOpen={openMention} today={today} />
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
    <CockpitContext.Provider value={cockpit}>
    <div className="flex h-screen flex-col overflow-hidden bg-bg font-sans">

      {/* ── Header ── */}
      <header className="z-10 flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-shade/40 px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xs border border-accent/40 bg-accent/10 font-mono text-stat font-bold text-accent">◈</div>
          <div>
            <div className="font-mono text-note font-bold tracking-label text-ink">DEV COMMAND CENTER</div>
            <div className="font-mono text-meta text-muted">{sprintHeader}</div>
          </div>
        </div>

        <div className="flex-1" />

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
          <Stat label="PLANNED" value={String(openEntries)} tone="accent" />
          <Stat label="BLOCKED" value={String(blockedTasks.length)} tone={blockedTasks.length > 0 ? 'danger' : 'muted'} />
          <div className="h-6 w-px bg-accent/15" />
          <Clock />
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div className={`grid flex-1 overflow-hidden ${focusing ? GRID_FOCUS : GRID_DAY}`}>

        {/* ── LEFT: Queue Panel ── */}
        <div
          className={`flex flex-col overflow-hidden border-r border-line transition-all ${dropTarget === 'queue' ? 'drop-active' : ''}`}
          onDrop={e => handleDrop(e, 'queue')}
          onDragOver={e => handleDragOver(e, 'queue')}
          onDragLeave={handleDragLeave}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-line bg-shade/25 px-2.5 pt-2.5">
            <div className="mb-2 flex items-center">
              <span className="label font-bold text-accent">QUEUES</span>
              <span className="ml-auto font-mono text-meta text-muted" title="Items not in today's plan">{unplannedCount()} not planned</span>
            </div>
            {/* Source tabs */}
            <div className="flex overflow-x-auto">
              {SOURCE_TABS.map(tab => {
                const n = unplannedCount(tab.id)
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
          <div data-rows="queue" className="flex-1 overflow-y-auto p-2">
            {actionError && (
              <div onClick={dismissError} title="Dismiss" className="mb-1.5 cursor-pointer rounded-xs border border-danger/25 bg-danger/10 px-2 py-1.5 font-mono text-meta text-danger-fg">
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
              <div className="px-2 py-5 text-center font-mono text-meta text-muted">
                {countOf(queueTab) === 0 ? 'NO ITEMS IN QUEUE' : 'EVERYTHING HERE IS IN YOUR PLAN'}
              </div>
            ) : (
              queueTasks.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onDragStart={handleDragStart}
                  onClick={() => setModalTask(t)}
                  onDone={doneHandler(t)}
                  onAdd={() => addToPlan(t)}
                  onStart={() => startTask(t)}
                  onBlock={() => moveTask(t.id, 'blocked')}
                />
              ))
            )}
          </div>

          {/* Drop-back indicator */}
          {dropTarget === 'queue' && (
            <div className="border-t border-accent/30 bg-accent/5 px-2.5 py-2 text-center font-mono text-meta tracking-label text-accent">↓ RETURN TO QUEUE</div>
          )}
        </div>

        {/* ── CENTER: My Day, or the item being worked on ── */}
        {focusing && workingTask ? (
          <div
            className={`flex min-h-0 flex-col gap-1.5 overflow-hidden p-2 transition-all ${dropTarget === 'working' ? 'drop-active' : ''}`}
            onDrop={e => handleDrop(e, 'working')}
            onDragOver={e => handleDragOver(e, 'working')}
            onDragLeave={handleDragLeave}
          >
            <FocusBar task={workingTask} next={nextUp} onBack={backToMyDay} onStart={startTask} />
            <WorkingSpace
              task={workingTask}
              handlers={paneHandlers(workingTask)}
              doneTarget={actions.doneTarget(workingTask)}
              onReturnDragStart={e => handleDragStart(e, workingTask.id)}
            />
          </div>
        ) : (
          <MyDay
            today={today}
            sprint={sprint}
            brief={brief}
            planView={planView}
            upNext={upNext}
            reviews={reviews}
            events={events}
            teamItems={briefData?.teamItems ?? []}
            blocked={blockedTasks}
            working={workingTask}
            storyProgress={progress.stories}
            teamBlockers={teamBlockers}
            dragging={!!dragId}
            actions={actions}
          />
        )}

        {/* ── RIGHT: the plan beside the item being worked on ── */}
        {focusing && <PlanRail planView={planView} blocked={blockedTasks} today={today} actions={actions} />}
      </div>

      {/* ── Detail Modal ── */}
      {modalTask && (
        <DetailModal
          task={shownTask ?? modalTask}
          planned={planned.has(modalTask.id)}
          onClose={closeDetail}
          handlers={paneHandlers(shownTask ?? modalTask, true)}
          doneTarget={actions.doneTarget(shownTask ?? modalTask)}
        />
      )}

      {linkFor && (
        <LinkPicker
          entry={linkFor}
          tasks={linkCandidates}
          onLink={task => linkEntry(linkFor, task)}
          onUnlink={() => unlinkEntry(linkFor)}
          onClose={closePicker}
        />
      )}

      {reader && (
        <ReaderModal
          tab={reader}
          onTab={setReader}
          onClose={closeReader}
          views={{ brief: briefView, ticker: tickerView, calendar: calendarView, draft: draftView }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-150 flex -translate-x-1/2 items-center gap-4 rounded-sm border border-accent/30 bg-surface px-4 py-2 shadow-[0_8px_30px_var(--shadow-toast)]">
          <span className="text-body text-fg">{toast.text}</span>
          {toast.undo && (
            <button
              className="font-mono text-meta font-bold tracking-label text-accent hover:underline"
              onClick={undoToast}
            >UNDO</button>
          )}
        </div>
      )}

      {booting && (
        <BootScreen
          key={developer}
          login={developer.split('@')[0]}
          firstName={(currentDeveloper?.name ?? developer).split(/\s+/)[0]}
          sprintNumber={sprint?.number ?? null}
          steps={bootSteps}
          summary={bootSummary}
          onDone={finishBoot}
        />
      )}
    </div>
    </CockpitContext.Provider>
  )
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
        className={`flex items-start gap-2 border-b border-line-soft py-1 ${task ? 'cursor-pointer hover:bg-tint/[0.03]' : ''}`}
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

// ─── Reader (expanded brief / team items / calendar) ──────────────────────────

const READER_TABS: { id: ReaderTab; label: string }[] = [
  { id: 'brief', label: '◉ DAILY BRIEF' },
  { id: 'ticker', label: '◆ TEAM ITEMS & DATES' },
  { id: 'calendar', label: '◈ SPRINT CALENDAR' },
  { id: 'draft', label: '✎ STANDUP DRAFT' },
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
    <div data-overlay onClick={onClose} className="fixed inset-0 z-90 flex items-center justify-center bg-shade/75 backdrop-blur-sm">
      <div
        onClick={e => e.stopPropagation()}
        className={`panel hud-corner flex max-w-[calc(100vw-32px)] flex-col border-accent/35 shadow-[0_0_60px_var(--glow),0_0_120px_var(--shadow-modal)] ${className}`}
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
          <div className="relative mt-1 h-[3px] rounded-full bg-tint/5">
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
