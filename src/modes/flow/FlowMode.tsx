import { useEffect, useMemo, useRef, useState } from 'react'

import { QUEUES } from '../../bridge'
import { useBoardContext } from '../../board/BoardContext'
import type { Board } from '../../board/useBoard'
import { paneHandlers } from '../../board/paneHandlers'
import { SOURCE_TABS } from '../../board/constants'
import BootScreen from '../../BootScreen'
import type { RowAction } from '../../keys'
import type { PlanEntry } from '../../plan'
import { longDate as formatLongDate } from '../../schedule'
import { buildStandupDraft } from '../../standup'
import { StandupDraft } from '../../StandupDraft'
import type { Task } from '../../types'
import { Button, EmptyState, ErrorNote, Kbd, Tabs } from '../../ui/atoms'
import { CockpitContext } from '../../ui/cockpit/context'
import { CockpitPane } from '../../ui/cockpit/CockpitPane'
import { DetailModal } from '../../ui/DetailModal'
import { Header } from '../../ui/Header'
import { flowTargetForKey, hintsFor } from '../../ui/keymap'
import { LinkPicker } from '../../ui/LinkPicker'
import { QueueDrawer } from '../../ui/QueueDrawer'
import { BriefView, CalendarView, Reader, TickerView } from '../../ui/Reader'
import { ENTRY_DRAG, PlanListRow, ReviewListRow, TaskListRow, reviewAge, STALE_REVIEW_DAYS } from '../../ui/rows'
import type { Handlers } from '../../ui/rows'
import { Toast } from '../../ui/Toast'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { EntryPane } from '../scan/panes'
import { dayStrip } from './dayStrip'
import { sprintLine } from './sprintLine'
import { ComingUp, DayHeader, Section, SectionLink, TeamNotes, TeamToday } from './sections'

// Flow: the day as one centred column, read top to bottom. The plan, what is being
// worked on, what is blocked, what could come next, reviews, dates and the team's
// notes. Items open in place (a plan row expands) or in a dialog, and the queues
// live in a drawer on the right. Nothing here is stored: it all comes from the board.

const UP_NEXT_SHOWN = 6
const BRIEFLESS_PLAN = "Your standup responsibilities show up here once today's brief is posted. Meanwhile, add items from Up next or the queues."

const stop = (fn: () => void) => (e: React.SyntheticEvent) => { e.stopPropagation(); fn() }
const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
const focusRow = (list: string) => document.querySelector<HTMLElement>(`[data-rows="${list}"] [data-row]`)?.focus()

type Actions = Board['actions']

// A row for an item in Up next, Blocked or the drawer.
function ItemRow({ task, mode, actions, reasons, onUsed }: {
  task: Task
  mode: 'queue' | 'next' | 'blocked'
  actions: Actions
  reasons?: { text: string; urgent?: boolean }[]
  onUsed: (h: Handlers) => void
}) {
  const handlers: Handlers = {
    open: () => actions.open(task),
    start: () => actions.start(task),
    add: mode === 'blocked' ? () => actions.unblock(task) : () => actions.add(task),
    block: mode === 'blocked' ? undefined : () => actions.block(task),
    done: actions.doneTarget(task) ? () => actions.done(task) : undefined,
  }
  onUsed(handlers)
  return (
    <TaskListRow
      task={task}
      id={`task:${mode}:${task.id}`}
      selected={false}
      reasons={reasons}
      handlers={handlers}
      onSelect={() => {}}
      onActivate={() => actions.open(task)}
      onDragStart={e => actions.dragItem(e, task.id)}
      quick={
        <>
          {mode === 'blocked'
            ? <Button onClick={stop(() => actions.unblock(task))} title="Move back to today's plan (t)">Unblock</Button>
            : <Button onClick={stop(() => actions.add(task))} title={task.source === 'pulse' ? "Add to today's plan and claim it (t)" : "Add to today's plan (t)"}>{task.source === 'pulse' ? '＋ Claim' : '＋ Plan'}</Button>}
          <Button onClick={stop(() => actions.start(task))} title="Start working on it (s)" aria-label="Start">▶</Button>
        </>
      }
    />
  )
}

export default function FlowMode() {
  const board = useBoardContext()
  const {
    visibleTasks, plan, tasksById, ticks, developer, currentDeveloper, today, sprint, brief, briefData, reviews, teamBlockers,
    bridgeLoading, bridgeErrors, actionError, toast, booting, workingTask, modalTask, linkFor, reader, queueTab, planned,
    queueTasks, blockedTasks, openEntries, upNext, planView, linkCandidates, unplannedCount, countOf, progress, events,
    sprintHeader, sprintDay, sprintLength, tickerItems, calendarItems, bootSteps, bootSummary, actions, cockpit, dragId,
    moveTask, changeDeveloper, openMention, setQueueTab, closeDetail, dismissError, linkEntry, unlinkEntry, closePicker,
    setReader, closeReader, undoToast, dismissToast, finishBoot,
  } = board

  const wide = useMediaQuery('(min-width: 900px)')
  const [expanded, setExpanded] = useState<string | null>(null) // a plan entry opened in place
  const [drawer, setDrawer] = useState(false)
  const [allUpNext, setAllUpNext] = useState(false)
  const [entryDrag, setEntryDrag] = useState<string | null>(null) // a plan row being dragged
  const dragging = dragId !== null || entryDrag !== null

  const lead = briefData?.mode === 'leadership'
  const reviewList = Array.isArray(reviews) ? reviews : []
  const sourceLabel = (task: Task) => SOURCE_TABS.find(s => s.id === task.source)?.label
  const handlersFor = (task: Task, inModal = false) => paneHandlers(board, task, inModal)

  // Every action some row can do, for the key hints below.
  const used = new Set<RowAction>()
  const noteUsed = (h: Handlers) => (Object.keys(h) as RowAction[]).forEach(action => { if (h[action]) used.add(action) })

  // ── Keys that act on the whole page.
  const openDrawer = () => setDrawer(true)
  const latest = useRef({ expanded, drawer, openDrawer })
  latest.current = { expanded, drawer, openDrawer }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (booting || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[data-overlay]')) return
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return
      const { expanded: open, drawer: drawerOpen } = latest.current
      if (e.key === 'Escape') {
        // The drawer closes itself; otherwise a row expanded in place collapses.
        if (!drawerOpen && open) {
          setExpanded(null)
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(`entry:${open}`)}"]`)?.focus())
          e.preventDefault()
        }
        return
      }
      const target = flowTargetForKey(e.key)
      if (!target) return
      if (target === 'drawer') {
        if (drawerOpen) focusRow('queue')
        else latest.current.openDrawer()
      } else if (!drawerOpen) {
        focusRow(target === 'next' ? 'upnext' : target)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [booting])

  // Opening the drawer moves focus to its first card (or its source tabs when it is empty).
  useEffect(() => {
    if (!drawer) return
    const id = requestAnimationFrame(() => {
      ;(document.querySelector<HTMLElement>('[data-rows="queue"] [data-row]') ?? document.querySelector<HTMLElement>('aside[aria-label="Queues"] [role=tab][aria-selected=true]'))?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [drawer])

  // ── Drop zones. A plan row dragged onto one acts on the item it is linked to.
  const entryZone = (zone: 'working' | 'blocked' | 'queue', onEntry: (entry: PlanEntry, task: Task | undefined) => void) => {
    const base = actions.dropProps(zone)
    return {
      ...base,
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        const id = e.dataTransfer.getData(ENTRY_DRAG)
        const entry = id ? plan.entries.find(x => x.id === id) : undefined
        if (entry) onEntry(entry, entry.itemId ? tasksById.get(entry.itemId) : undefined)
        base.onDrop?.(e)
        setEntryDrag(null)
      },
    }
  }
  const toWorking = entryZone('working', (_, task) => { if (task) actions.start(task) })
  const toBlocked = entryZone('blocked', (_, task) => { if (task) actions.block(task) })
  const toQueue = entryZone('queue', entry => actions.remove(entry))

  // ── The plan.
  const toggleExpanded = (id: string) => setExpanded(cur => (cur === id ? null : id))
  const planRows = plan.entries.map(entry => {
    const task = entry.itemId ? tasksById.get(entry.itemId) : undefined
    const isWorking = !!task && task.id === workingTask?.id
    const locked = !!entry.doneAt
    const open = expanded === entry.id
    const handlers: Handlers = {
      open: task ? () => toggleExpanded(entry.id) : () => actions.pick(entry),
      toggle: locked ? undefined : () => actions.toggle(entry),
      start: task && !entry.done && !isWorking ? () => actions.start(task) : undefined,
      block: task && !entry.done ? () => actions.block(task) : undefined,
      remove: () => actions.remove(entry),
      up: () => actions.shift(entry, -1),
      down: () => actions.shift(entry, 1),
    }
    noteUsed(handlers)
    return (
      <div key={entry.id}>
        <PlanListRow
          entry={entry} task={task} id={`entry:${entry.id}`} selected={open} working={isWorking} today={today}
          highlight={planView.highlight === entry.id}
          doneTarget={task ? actions.doneTarget(task) : entry.itemSource ? (entry.itemSource === 'stories' ? 'ADO' : 'Notion') : null}
          handlers={handlers} onSelect={() => {}} onActivate={() => toggleExpanded(entry.id)}
          onReorder={(id, before) => actions.reorder(id, before)} onToggle={() => actions.toggle(entry)} onStart={handlers.start}
        />
        {open && (
          <div className="border-b border-line-soft bg-sunken">
            <div className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5">
              {task && <Button onClick={() => actions.open(task)} title="Open it in a dialog">Open full</Button>}
              <Button onClick={() => setExpanded(null)} title="Collapse (Esc)">Collapse</Button>
            </div>
            {task ? (
              <CockpitPane
                key={task.id} layout="compact" task={task} sourceLabel={sourceLabel(task)} planned={planned.has(task.id)}
                working={isWorking} doneTarget={actions.doneTarget(task)} handlers={handlersFor(task)}
              />
            ) : (
              <EntryPane
                key={entry.id} entry={entry} today={today} suggestion={planView.suggestions.get(entry.id)}
                onLink={() => actions.pick(entry)} onConfirm={t => actions.confirm(entry, t)} onReject={t => actions.reject(entry, t)}
                onToggle={() => actions.toggle(entry)} onRemove={() => actions.remove(entry)}
              />
            )}
          </div>
        )}
      </div>
    )
  })

  const strip = useMemo(
    () => dayStrip({ plan, workingId: workingTask?.id ?? null, blockedCount: blockedTasks.length }),
    [plan, workingTask, blockedTasks.length],
  )

  const shownUpNext = allUpNext ? upNext : upNext.slice(0, UP_NEXT_SHOWN)
  const planLabel = lead ? 'Your plan' : "Today's plan"
  const hints = hintsFor(used, 'flow')

  return (
    <CockpitContext.Provider value={cockpit}>
      <div className="flex h-screen flex-col overflow-hidden bg-bg font-sans text-fg">
        <Header
          sprintLine={sprintHeader}
          developer={developer}
          onDeveloper={changeDeveloper}
          sprintDay={sprintDay && sprintLength ? `${sprintDay}/${sprintLength}` : null}
          planned={openEntries}
          blocked={blockedTasks.length}
        />

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-4 py-6">
            <DayHeader
              today={today}
              sprintLine={sprintLine(sprint, today)}
              brief={brief}
              storyProgress={progress.stories}
              strip={strip}
              onReader={setReader}
              onJump={jumpTo}
            />

            {actionError && <div className="mb-4"><ErrorNote onDismiss={dismissError}>{actionError}</ErrorNote></div>}

            {lead && briefData && (
              <Section id="flow-team" label="Team today" count={briefData.summaries.length ? `${briefData.summaries.length} updates` : undefined}>
                <TeamToday summaries={briefData.summaries} blockers={teamBlockers} />
              </Section>
            )}

            <Section
              id="flow-plan"
              label={planLabel}
              count={plan.entries.length ? `${openEntries} open · ${plan.entries.length - openEntries} done` : undefined}
              right={
                <span className="flex items-center gap-3">
                  {plan.entries.length > 1 && <span className="font-mono text-meta text-muted">drag or Alt+↑↓ to reorder</span>}
                  <Button onClick={openDrawer} title="Open the queues (q)">＋ Add item</Button>
                </span>
              }
              className="drop-zone"
              {...actions.dropProps('today')}
            >
              <div
                data-rows="plan"
                onDragStart={e => {
                  const rowId = (e.target as HTMLElement).closest<HTMLElement>('[data-row-id]')?.dataset.rowId
                  if (rowId?.startsWith('entry:')) setEntryDrag(rowId.slice('entry:'.length))
                }}
                onDragEnd={() => setEntryDrag(null)}
                onDragOver={e => { if (e.dataTransfer.types.includes(ENTRY_DRAG)) e.preventDefault() }}
                onDrop={e => {
                  const id = e.dataTransfer.getData(ENTRY_DRAG)
                  if (id) { e.preventDefault(); e.stopPropagation(); actions.reorder(id, null) }
                }}
              >
                {planRows}
              </div>
              {plan.entries.length === 0 && <EmptyState title="Nothing planned yet" hint={briefData ? 'Add items from Up next, or drag them in from the queues.' : BRIEFLESS_PLAN} />}
            </Section>

            <Section id="flow-working" label="Working" {...toWorking} className="drop-zone">
              {workingTask ? (
                <div className="overflow-hidden rounded-xs border border-ok/30">
                  <CockpitPane
                    key={workingTask.id}
                    layout="flow"
                    task={workingTask}
                    sourceLabel={sourceLabel(workingTask)}
                    planned={planned.has(workingTask.id)}
                    working
                    doneTarget={actions.doneTarget(workingTask)}
                    handlers={handlersFor(workingTask)}
                    onReturnDragStart={e => actions.dragItem(e, workingTask.id)}
                  />
                </div>
              ) : (
                <div className="rounded-xs border border-dashed border-line px-3 py-4 text-note text-muted">
                  Nothing in progress. Press <Kbd>s</Kbd> on a row to start it, or drop an item here.
                </div>
              )}
            </Section>

            {(blockedTasks.length > 0 || dragging) && (
              <Section id="flow-blocked" label="Blocked" count={blockedTasks.length} tone="danger" {...toBlocked} className="drop-zone drop-zone-blocked">
                <div data-rows="blocked">
                  {blockedTasks.map(t => <ItemRow key={t.id} task={t} mode="blocked" actions={actions} onUsed={noteUsed} />)}
                </div>
                {blockedTasks.length === 0 && <div className="py-2 text-note text-muted">Drop here to mark it blocked.</div>}
              </Section>
            )}

            <Section
              id="flow-next"
              label="Up next"
              count={upNext.length || undefined}
              right={upNext.length > UP_NEXT_SHOWN && <SectionLink onClick={() => setAllUpNext(v => !v)}>{allUpNext ? 'Show fewer' : `Show all ${upNext.length}`}</SectionLink>}
            >
              <div data-rows="upnext">
                {shownUpNext.map(s => <ItemRow key={s.task.id} task={s.task} mode="next" actions={actions} reasons={s.reasons} onUsed={noteUsed} />)}
              </div>
              {upNext.length === 0 && <div className="py-2 text-note text-muted">Nothing waiting outside your plan.</div>}
            </Section>

            {reviews !== null && (
              <Section id="flow-reviews" label="Reviews waiting" count={reviewList.length || undefined}>
                <div data-rows="reviews">
                  {reviewList.map(pr => {
                    const open = () => window.open(pr.url, '_blank', 'noopener')
                    const handlers: Handlers = { open }
                    noteUsed(handlers)
                    return <ReviewListRow key={pr.pullRequestId} pr={pr} id={`review:${pr.pullRequestId}`} selected={false} today={today} handlers={handlers} onSelect={() => {}} onActivate={open} />
                  })}
                </div>
                {reviews === 'loading' && <div className="py-2 font-mono text-meta text-muted">Loading…</div>}
                {reviews && !Array.isArray(reviews) && reviews !== 'loading' && (
                  <ErrorNote>{reviews.error === 'Not Found' ? 'Reviews need an updated ado-bridge' : `Reviews unavailable · ${reviews.error}`}</ErrorNote>
                )}
                {Array.isArray(reviews) && reviews.length === 0 && <div className="py-2 text-note text-muted">No reviews waiting on you.</div>}
                {reviewList.some(pr => reviewAge(pr, today) >= STALE_REVIEW_DAYS) && <div className="sr-only">Some reviews have waited {STALE_REVIEW_DAYS} days or more.</div>}
              </Section>
            )}

            <Section id="flow-coming" label="Coming up" right={<SectionLink onClick={() => setReader('calendar')}>Calendar ⤢</SectionLink>}>
              <ComingUp events={events} today={today} />
            </Section>

            {(briefData?.teamItems.length ?? 0) > 0 && (
              <Section id="flow-notes" label="Team notes" right={<SectionLink onClick={() => setReader('brief')}>Brief ⤢</SectionLink>}>
                <TeamNotes lines={briefData!.teamItems} />
              </Section>
            )}
          </div>
        </main>

        <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-1.5 text-meta text-muted">
          {hints.map(h => <span key={h.hint}><Kbd>{h.hint}</Kbd> {h.label}</span>)}
        </footer>

        {drawer && (
          <QueueDrawer onClose={() => setDrawer(false)} dragging={dragging} wide={wide} dropProps={toQueue}>
            <Tabs
              label="Sources"
              dense
              tabs={SOURCE_TABS.map(t => ({ id: t.id, label: t.label, count: unplannedCount(t.id) }))}
              value={queueTab}
              onChange={setQueueTab}
              className="shrink-0 overflow-x-auto px-1"
            />
            {bridgeErrors[queueTab] && <div className="shrink-0 p-2"><ErrorNote>Bridge error · {bridgeErrors[queueTab]}</ErrorNote></div>}
            <div data-rows="queue" className="min-h-0 flex-1 overflow-y-auto">
              {queueTasks.map(t => <ItemRow key={t.id} task={t} mode="queue" actions={actions} onUsed={noteUsed} />)}
              {queueTasks.length === 0 && (
                bridgeLoading && QUEUES.some(q => q.source === queueTab)
                  ? <EmptyState title="Loading…" />
                  : <EmptyState title={countOf(queueTab) === 0 ? 'No items in this queue' : 'Everything here is in your plan'} />
              )}
            </div>
          </QueueDrawer>
        )}

        {modalTask && (() => {
          const task = tasksById.get(modalTask.id) ?? modalTask
          return (
            <DetailModal
              task={task}
              sourceLabel={sourceLabel(task)}
              planned={planned.has(task.id)}
              doneTarget={actions.doneTarget(task)}
              handlers={handlersFor(task, true)}
              onClose={closeDetail}
            />
          )
        })()}

        {linkFor && (
          <LinkPicker entry={linkFor} tasks={linkCandidates} onLink={t => linkEntry(linkFor, t)} onUnlink={() => unlinkEntry(linkFor)} onClose={closePicker} />
        )}

        {reader && (
          <Reader
            tab={reader}
            onTab={setReader}
            onClose={closeReader}
            views={{
              brief: <BriefView brief={brief} tasks={visibleTasks} onOpen={openMention} today={today} />,
              ticker: <TickerView items={tickerItems} />,
              calendar: <CalendarView items={calendarItems} sprint={sprint} today={today} header={<span className="font-mono text-meta text-muted">{sprintHeader}</span>} />,
              draft: <StandupDraft draft={buildStandupDraft({ today, plan, tasksById, blocked: blockedTasks, reviews: reviewList, ticks, longDate: formatLongDate(today) })} />,
            }}
          />
        )}

        {toast && <Toast text={toast.text} onUndo={toast.undo ? undoToast : undefined} onDismiss={dismissToast} />}

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
