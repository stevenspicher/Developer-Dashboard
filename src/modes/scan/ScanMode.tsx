import { useEffect, useMemo, useRef, useState } from 'react'

import { QUEUES } from '../../bridge'
import { useBoardContext } from '../../board/BoardContext'
import { paneHandlers } from '../../board/paneHandlers'
import { SOURCE_TABS } from '../../board/constants'
import BootScreen from '../../BootScreen'
import { longDate as formatLongDate } from '../../schedule'
import { buildStandupDraft } from '../../standup'
import { StandupDraft } from '../../StandupDraft'
import type { Task } from '../../types'
import { Button, EmptyState, ErrorNote, Kbd, Tabs } from '../../ui/atoms'
import { CockpitContext } from '../../ui/cockpit/context'
import { CockpitPane } from '../../ui/cockpit/CockpitPane'
import { Header } from '../../ui/Header'
import { filterForKey, hintsFor } from '../../ui/keymap'
import type { Filter } from '../../ui/keymap'
import { LinkPicker } from '../../ui/LinkPicker'
import { DetailModal } from '../../ui/DetailModal'
import { BriefView, CalendarView, Reader, TickerView } from '../../ui/Reader'
import { PlanListRow, ReviewListRow, TaskListRow, TeamListRow } from '../../ui/rows'
import type { Handlers } from '../../ui/rows'
import { Toast } from '../../ui/Toast'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { EmptyPane, EntryPane, ReviewPane, TeamPane } from './panes'
import { groupTeam, resolvePane, rowId, sameSelection } from './selection'
import type { Selection } from './selection'

// Scan: a list on the left (plan, queue, next, reviews, blocked, and the team
// for a lead), and the selected thing in full on the right. Focus is the
// selection: moving through the list with j and k shows each item in the pane.

const LIST_WIDTH = 'w-[clamp(280px,24vw,360px)]'
const BRIEFLESS_PLAN = "Your standup responsibilities show up here once today's brief is posted. Meanwhile, add items from Up next or the queue."

export default function ScanMode() {
  const board = useBoardContext()
  const {
    visibleTasks, plan, tasksById, ticks, developer, currentDeveloper, today, sprint, brief, briefData, reviews, teamBlockers,
    bridgeLoading, bridgeErrors, actionError, toast, booting, workingTask, modalTask, linkFor, reader, queueTab, planned,
    queueTasks, blockedTasks, openEntries, upNext, planView, linkCandidates, unplannedCount, countOf, sprintHeader,
    sprintDay, sprintLength, tickerItems, calendarItems, bootSteps, bootSummary, actions, cockpit, doneHandler, moveTask,
    changeDeveloper, openMention, setQueueTab, closeDetail, startFromDetail, addFromDetail, dismissError,
    linkEntry, unlinkEntry, closePicker, setReader, closeReader, undoToast, dismissToast, finishBoot, startTask, addToPlan,
  } = board

  const wide = useMediaQuery('(min-width: 900px)')
  const [filter, setFilter] = useState<Filter>('plan')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [sheet, setSheet] = useState(false) // narrow windows: the pane replaces the list
  const paneRef = useRef<HTMLDivElement>(null)

  const lead = briefData?.mode === 'leadership'
  const reviewList = Array.isArray(reviews) ? reviews : []
  const team = useMemo(() => groupTeam(lead && briefData ? briefData.summaries : [], teamBlockers), [lead, briefData, teamBlockers])

  // Moves focus into the pane (or opens it, in a narrow window).
  const focusPane = () => {
    setSheet(true)
    requestAnimationFrame(() => {
      const pane = paneRef.current
      // The action buttons first: they are what Enter on a row is usually for.
      ;(pane?.querySelector<HTMLElement>('[role=toolbar] button') ?? pane?.querySelector<HTMLElement>('a[href], textarea'))?.focus()
    })
  }

  const handlersFor = (task: Task, inModal = false) => paneHandlers(board, task, inModal)

  // ── The list: every row carries the handlers it responds to, and the footer
  //    hints are built from those same handlers.
  interface Item { sel: Selection; handlers: Handlers; render: (selected: boolean) => React.ReactNode }
  const select = (sel: Selection) => () => setSelection(sel)
  // A click also opens the pane, in a narrow window where it replaces the list.
  const activate = (sel: Selection) => () => { setSelection(sel); if (!wide) setSheet(true) }

  const planItems: Item[] = plan.entries.map(entry => {
    const task = entry.itemId ? tasksById.get(entry.itemId) : undefined
    const working = !!task && task.id === workingTask?.id
    const locked = !!entry.doneAt
    const sel: Selection = { kind: 'entry', id: entry.id }
    const handlers: Handlers = {
      open: task ? focusPane : () => actions.pick(entry),
      toggle: locked ? undefined : () => actions.toggle(entry),
      start: task && !entry.done && !working ? () => actions.start(task) : undefined,
      block: task && !entry.done ? () => actions.block(task) : undefined,
      remove: () => actions.remove(entry),
      up: () => actions.shift(entry, -1),
      down: () => actions.shift(entry, 1),
    }
    return {
      sel, handlers,
      render: selected => (
        <PlanListRow
          key={entry.id} entry={entry} task={task} id={rowId(sel)} selected={selected} working={working} today={today}
          highlight={planView.highlight === entry.id}
          doneTarget={task ? actions.doneTarget(task) : entry.itemSource ? (entry.itemSource === 'stories' ? 'ADO' : 'Notion') : null}
          handlers={handlers} onSelect={select(sel)} onActivate={activate(sel)} onReorder={(id, before) => actions.reorder(id, before)}
          onToggle={() => actions.toggle(entry)} onStart={handlers.start}
        />
      ),
    }
  })

  const taskItems = (tasks: Task[], mode: 'queue' | 'next' | 'blocked', reasonsFor?: (t: Task) => { text: string; urgent?: boolean }[]): Item[] =>
    tasks.map(task => {
      const sel: Selection = { kind: 'task', id: task.id }
      const handlers: Handlers = {
        open: focusPane,
        start: () => actions.start(task),
        add: mode === 'blocked' ? () => actions.unblock(task) : () => actions.add(task),
        block: mode === 'blocked' ? undefined : () => actions.block(task),
        done: actions.doneTarget(task) ? () => actions.done(task) : undefined,
      }
      return {
        sel, handlers,
        render: selected => (
          <TaskListRow
            key={task.id} task={task} id={rowId(sel)} selected={selected} reasons={reasonsFor?.(task)} handlers={handlers}
            onSelect={select(sel)} onActivate={activate(sel)} onDragStart={e => actions.dragItem(e, task.id)}
            quick={
              <>
                {mode === 'blocked'
                  ? <Button onClick={e => { e.stopPropagation(); actions.unblock(task) }} title="Move back to today's plan (t)">Unblock</Button>
                  : <Button onClick={e => { e.stopPropagation(); actions.add(task) }} title={task.source === 'pulse' ? "Add to today's plan and claim it (t)" : "Add to today's plan (t)"}>{task.source === 'pulse' ? '＋ Claim' : '＋ Plan'}</Button>}
                <Button onClick={e => { e.stopPropagation(); actions.start(task) }} title="Start working on it (s)" aria-label="Start">▶</Button>
              </>
            }
          />
        ),
      }
    })

  const reviewItems: Item[] = reviewList.map(pr => {
    const sel: Selection = { kind: 'review', id: pr.pullRequestId }
    const handlers: Handlers = { open: () => window.open(pr.url, '_blank', 'noopener') }
    return { sel, handlers, render: selected => <ReviewListRow key={pr.pullRequestId} pr={pr} id={rowId(sel)} selected={selected} today={today} handlers={handlers} onSelect={select(sel)} onActivate={activate(sel)} /> }
  })

  const teamItems: Item[] = team.members.map(m => {
    const sel: Selection = { kind: 'team', name: m.developer }
    const handlers: Handlers = { open: focusPane }
    return { sel, handlers, render: selected => <TeamListRow key={m.developer} developer={m.developer} text={m.text} blockedCount={m.blockers.length} id={rowId(sel)} selected={selected} handlers={handlers} onSelect={select(sel)} onActivate={activate(sel)} /> }
  })

  const items: Item[] =
    filter === 'plan' ? planItems
      : filter === 'queue' ? taskItems(queueTasks, 'queue')
        : filter === 'next' ? taskItems(upNext.map(s => s.task), 'next', task => planView.reasons(task))
          : filter === 'reviews' ? reviewItems
            : filter === 'blocked' ? taskItems(blockedTasks, 'blocked')
              : teamItems

  // The hints cover every key some row in this list responds to.
  const hints = hintsFor(items.flatMap(i => Object.entries(i.handlers).filter(([, fn]) => fn).map(([action]) => action as never)))

  // ── Keys that act on the whole layout.
  const openFilter = (next: Filter) => {
    setFilter(next)
    setSelection(null) // the pane follows the new list, or shows what is being worked on
    setSheet(false)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-rows="scan"] [data-row]')?.focus())
  }
  const latest = useRef({ openFilter, selection, paneHasFocus: () => false as boolean })
  latest.current = { openFilter, selection, paneHasFocus: () => !!paneRef.current?.contains(document.activeElement) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (booting || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[data-overlay]')) return
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return
      const target = filterForKey(e.key)
      if (target) { latest.current.openFilter(target); e.preventDefault(); return }
      if (e.key === 'Escape' && latest.current.paneHasFocus()) {
        const s = latest.current.selection
        const row = (s && document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId(s))}"]`)) ?? document.querySelector<HTMLElement>('[data-rows="scan"] [data-row]')
        row?.focus()
        setSheet(false)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [booting])

  // ── The pane.
  const pane = resolvePane(selection, { plan, tasksById, reviews: reviewList, team: team.members, workingTask })
  const sourceLabel = (task: Task) => SOURCE_TABS.find(s => s.id === task.source)?.label
  const cockpitPane = (task: Task) => (
    <CockpitPane
      key={task.id}
      task={task}
      sourceLabel={sourceLabel(task)}
      planned={planned.has(task.id)}
      working={task.status === 'working'}
      doneTarget={actions.doneTarget(task)}
      handlers={handlersFor(task)}
      onReturnDragStart={task.status === 'working' ? e => actions.dragItem(e, task.id) : undefined}
    />
  )

  const emptyHint: Record<Filter, string> = {
    plan: 'Select an entry', queue: 'Select an item', next: 'Select an item', reviews: 'Select a pull request', blocked: 'Select an item', team: 'Select a developer',
  }
  let paneNode: React.ReactNode
  switch (pane.type) {
    case 'task': case 'working': paneNode = cockpitPane(pane.task); break
    case 'entry':
      paneNode = (
        <EntryPane
          key={pane.entry.id} entry={pane.entry} today={today} suggestion={planView.suggestions.get(pane.entry.id)}
          onLink={() => actions.pick(pane.entry)} onConfirm={t => actions.confirm(pane.entry, t)} onReject={t => actions.reject(pane.entry, t)}
          onToggle={() => actions.toggle(pane.entry)} onRemove={() => actions.remove(pane.entry)}
        />
      )
      break
    case 'review': paneNode = <ReviewPane key={pane.pr.pullRequestId} pr={pane.pr} today={today} />; break
    case 'team': paneNode = <TeamPane key={pane.member.developer} member={pane.member} />; break
    default: paneNode = <EmptyPane title={emptyHint[filter]} hint="Press j or k to move through the list." />
  }

  // ── Lists' own states.
  const tabs = [
    { id: 'plan' as Filter, label: 'Plan', count: openEntries },
    { id: 'queue' as Filter, label: 'Queue', count: unplannedCount() },
    { id: 'next' as Filter, label: 'Next', count: upNext.length },
    { id: 'reviews' as Filter, label: 'Reviews', count: reviewList.length },
    { id: 'blocked' as Filter, label: 'Blocked', count: blockedTasks.length },
    ...(lead ? [{ id: 'team' as Filter, label: 'Team', count: team.members.length }] : []),
  ]
  const dropFor: Partial<Record<Filter, 'today' | 'blocked' | 'queue'>> = { plan: 'today', blocked: 'blocked', queue: 'queue' }

  const emptyList = (() => {
    if (items.length > 0) return null
    if (filter === 'plan') return <EmptyState title="Nothing planned yet" hint={BRIEFLESS_PLAN} />
    if (filter === 'queue') {
      if (bridgeLoading && QUEUES.some(q => q.source === queueTab)) return <EmptyState title="Loading…" />
      return <EmptyState title={countOf(queueTab) === 0 ? 'No items in this queue' : 'Everything here is in your plan'} />
    }
    if (filter === 'next') return <EmptyState title="Nothing waiting outside your plan" />
    if (filter === 'reviews') {
      if (reviews === 'loading') return <EmptyState title="Loading…" />
      if (reviews && !Array.isArray(reviews)) return <div className="p-3"><ErrorNote>{reviews.error === 'Not Found' ? 'Reviews need an updated ado-bridge' : `Reviews unavailable · ${reviews.error}`}</ErrorNote></div>
      return <EmptyState title={reviews === null ? 'Reviews need ado-bridge' : 'No reviews waiting on you'} />
    }
    if (filter === 'blocked') return <EmptyState title="Nothing is blocked" hint="Press b on an item, or drop it on this tab." />
    return <EmptyState title="No developer updates in this summary" />
  })()

  const showList = wide || !sheet
  const showPane = wide || sheet

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

        <div className="flex min-h-0 flex-1">
          {showList && (
            <section aria-label="List" className={`flex min-h-0 shrink-0 flex-col border-r border-line ${wide ? LIST_WIDTH : 'w-full'}`}>
              <Tabs
                label="Lists"
                dense
                tabs={tabs}
                value={filter}
                onChange={openFilter}
                className="shrink-0 overflow-x-auto px-1"
                tabProps={id => {
                  const zone = dropFor[id]
                  return zone ? (actions.dropProps(zone) as React.HTMLAttributes<HTMLButtonElement>) : {}
                }}
              />
              {filter === 'queue' && (
                <Tabs
                  label="Sources"
                  dense
                  tabs={SOURCE_TABS.map(t => ({ id: t.id, label: t.label, count: unplannedCount(t.id) }))}
                  value={queueTab}
                  onChange={setQueueTab}
                  className="shrink-0 overflow-x-auto px-1"
                />
              )}
              <div className="shrink-0 empty:hidden">
                {actionError && <div className="p-2"><ErrorNote onDismiss={dismissError}>{actionError}</ErrorNote></div>}
                {filter === 'queue' && bridgeErrors[queueTab] && <div className="p-2"><ErrorNote>Bridge error · {bridgeErrors[queueTab]}</ErrorNote></div>}
              </div>
              <div data-rows="scan" className="min-h-0 flex-1 overflow-y-auto">
                {emptyList ?? items.map(item => item.render(sameSelection(selection, item.sel)))}
                {filter === 'team' && team.others.length > 0 && (
                  <div className="p-3 text-note text-muted">
                    Also blocked: {team.others.map(b => `${b.ref} (${b.assignee})`).join(', ')}
                  </div>
                )}
              </div>
              <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-meta text-muted">
                {hints.map(h => <span key={h.hint}><Kbd>{h.hint}</Kbd> {h.label}</span>)}
                <span className="ml-auto flex gap-2">
                  <button type="button" className="link" onClick={() => setReader('brief')}>Brief</button>
                  <button type="button" className="link" onClick={() => setReader('draft')}>Standup draft</button>
                </span>
              </footer>
            </section>
          )}

          {showPane && (
            <main ref={paneRef} aria-label="Selected item" className="flex min-h-0 min-w-0 flex-1 flex-col" {...(actions.dropProps('working') as React.HTMLAttributes<HTMLElement>)}>
              {!wide && (
                <div className="shrink-0 border-b border-line px-3 py-1.5">
                  <Button onClick={() => { setSheet(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-rows="scan"] [data-row]')?.focus()) }}>← List</Button>
                </div>
              )}
              {paneNode}
            </main>
          )}
        </div>

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

