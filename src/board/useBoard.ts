import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { QueueSource, Status, Task } from '../types'
import {
  BRIDGE_REFRESH_MS, CALENDAR_LOOKAHEAD_DAYS, CONTEXT_REFRESH_MS, DEADLINE_TICKER_DAYS,
  ADO_STORIES_ENABLED, DEVELOPER_STORAGE_KEY, STALE_STANDUP_DAYS, TEST_DEVELOPERS,
  QUEUES, addDays, daysBetween, deadlineTickerText, fetchCurrentSprint, fetchDeadlines, fetchPageDone,
  fetchReviews, fetchStandup, fetchTeamBlockers, formatSprintRange, loadDeveloper, loadLanes, localIsoDate, queueFor,
  updateLanes,
} from '../bridge'
import type { BriefLine, Deadline, QueueProgress, RelatedEntity, Sprint, StandupBrief, TeamBlocker } from '../bridge'
import type { BootStep, BootStepState } from '../BootScreen'
import type { CockpitValue } from '../Cockpit'
import { clearTicks, loadTicks, saveTicks, toggleTick } from '../cockpitLogic'
import { focusFirstRow } from '../keys'
import {
  addItem, agingLabel, findDuplicates, linkEntries, linkTo, loadPlan, matchLine, mergeBrief, plannedIds,
  removeAddedEntry, removeEntry, reorder, rollover, savePlan, shift, suggestLinks, updateEntry, updateItemEntries,
} from '../plan'
import type { PlanEntry } from '../plan'
import { rankUpNext, reasonsFor } from '../ranking'
import type { RankContext } from '../ranking'
import { comingUp, workingDaysAfter } from '../schedule'
import { HIGHLIGHT_MS, SOURCE_TABS, UNDO_MS, errorText, sourceSystem } from './constants'
import type { DayActions, DropZone, PendingDone, PlanView, ReaderTab, Reviews, Toast } from './types'

// All of the board's state, effects and actions: loading the queues, the plan,
// lanes, done-with-undo, ticks, the standup and the derived views. It has no
// markup, so any layout can render it.
export function useBoard() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropZone | null>(null)
  const [queueTab, setQueueTab] = useState<QueueSource>(SOURCE_TABS[0].id)
  const [modalTask, setModalTask] = useState<Task | null>(null)
  const today = useToday()
  const [bridgeLoading, setBridgeLoading] = useState(true)
  const [bridgeErrors, setBridgeErrors] = useState<Partial<Record<QueueSource, string>>>({})
  const [progress, setProgress] = useState<Partial<Record<QueueSource, QueueProgress>>>({})
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set()) // items their source reports finished
  const [actionError, setActionError] = useState<string | null>(null)
  const [sprint, setSprint] = useState<Sprint | null>(null)
  const [developer, setDeveloper] = useState(loadDeveloper)
  const [plan, setPlan] = useState(() => loadPlan(developer, localIsoDate()))
  const [ticks, setTicks] = useState(() => loadTicks(developer)) // ticked acceptance criteria, this browser only
  const [view, setView] = useState<'myday' | 'focus'>('focus')
  const [highlight, setHighlight] = useState<string | null>(null)
  const [linkFor, setLinkFor] = useState<PlanEntry | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set()) // marked done, still in the undo window
  const [teamBlockers, setTeamBlockers] = useState<TeamBlocker[]>([])
  const [reviews, setReviews] = useState<Reviews>(ADO_STORIES_ENABLED ? 'loading' : null) // PRs waiting on the developer
  const [brief, setBrief] = useState<StandupBrief | { error: string } | null>(null)
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [related, setRelated] = useState<Record<string, RelatedEntity[] | 'loading' | { error: string }>>({})
  const [reader, setReader] = useState<ReaderTab | null>(null)
  const [booting, setBooting] = useState(true)
  const [sprintStatus, setSprintStatus] = useState<BootStepState>('pending')
  const [deadlinesStatus, setDeadlinesStatus] = useState<BootStepState>('pending')
  const pendingDone = useRef(new Map<string, PendingDone>())
  const toastTimer = useRef(0)
  const checking = useRef(new Set<string>())

  const showToast = (text: string, undo?: () => void) => {
    const id = Date.now()
    setToast({ id, text, undo })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), UNDO_MS)
  }

  // Sends any done still waiting out its undo window (switching developer,
  // closing the tab).
  const flushPendingDone = () => {
    for (const pending of [...pendingDone.current.values()]) {
      window.clearTimeout(pending.timer)
      void pending.run()
    }
  }
  useEffect(() => {
    window.addEventListener('pagehide', flushPendingDone)
    return () => window.removeEventListener('pagehide', flushPendingDone)
  }, [])

  const changeDeveloper = (email: string) => {
    flushPendingDone()
    try { localStorage.setItem(DEVELOPER_STORAGE_KEY, email) } catch { /* storage unavailable */ }
    const bridgeSources = new Set(QUEUES.map(q => q.source))
    setTasks(prev => prev.filter(t => !bridgeSources.has(t.source)))
    setProgress({})
    setDoneIds(new Set())
    setTeamBlockers([])
    setReviews(ADO_STORIES_ENABLED ? 'loading' : null)
    setPlan(loadPlan(email, today))
    setTicks(loadTicks(email))
    setView('focus')
    setHighlight(null)
    setToast(null)
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
        if (r.status === 'rejected') errors[q.source] = errorText(r.reason)
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
      setDoneIds(new Set(results.flatMap(r => (r.status === 'fulfilled' ? r.value.doneIds ?? [] : []))))
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
      setBrief(b.status === 'fulfilled' ? b.value : { error: errorText(b.reason) })
      if (d.status === 'fulfilled') setDeadlines(d.value)
      setDeadlinesStatus(d.status === 'fulfilled' ? 'ok' : 'fail')
    }
    load()
    const t = setInterval(load, CONTEXT_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  const briefData = brief && !('error' in brief) ? brief : null
  const lead = briefData?.mode === 'leadership'

  // A lead's team view: blocked ADO stories across the sprint.
  useEffect(() => {
    if (!ADO_STORIES_ENABLED || !lead || !sprint) {
      setTeamBlockers([])
      return
    }
    let cancelled = false
    fetchTeamBlockers(sprint)
      .then(b => { if (!cancelled) setTeamBlockers(b) })
      .catch(() => { if (!cancelled) setTeamBlockers([]) })
    return () => { cancelled = true }
  }, [lead, sprint?.number, developer])

  // Pull requests waiting on this developer's review.
  useEffect(() => {
    if (!ADO_STORIES_ENABLED) return
    let cancelled = false
    const load = () => fetchReviews(developer)
      .then(r => { if (!cancelled) setReviews(r) })
      .catch(e => { if (!cancelled) setReviews({ error: errorText(e) }) })
    load()
    const t = setInterval(load, CONTEXT_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  // ── The day's plan ──
  useEffect(() => { setPlan(p => rollover(p, today)) }, [today])
  useEffect(() => { savePlan(developer, plan) }, [developer, plan])
  useEffect(() => { saveTicks(developer, ticks) }, [developer, ticks])
  // Ticks only matter while the item is open: clear them once its source reports it closed.
  useEffect(() => { setTicks(t => clearTicks(t, doneIds)) }, [doneIds])
  useEffect(() => { if (briefData) setPlan(p => mergeBrief(p, briefData)) }, [briefData])

  const visibleTasks = useMemo(() => tasks.filter(t => !hidden.has(t.id)), [tasks, hidden])
  const cockpit = useMemo<CockpitValue>(() => ({
    tasks: visibleTasks,
    ticks,
    developer,
    toggleTick: (task, criterion) => setTicks(t => toggleTick(t, task.id, criterion)),
    openTask: setModalTask,
  }), [visibleTasks, ticks, developer])
  const tasksById = useMemo(() => new Map(visibleTasks.map(t => [t.id, t])), [visibleTasks])

  // Link entries to board items, and put anything pulled into Todo or Working
  // in the plan too (but not an item whose done is waiting out its undo
  // window: its entry is already ticked). Both return the same plan when
  // there's nothing new, so re-running on every plan change settles at once.
  useEffect(() => {
    if (bridgeLoading) return
    setPlan(p => {
      let next = linkEntries(p, tasks)
      for (const t of tasks) {
        if ((t.status === 'today' || t.status === 'working') && !hidden.has(t.id)) next = addItem(next, t)
      }
      return next
    })
  }, [tasks, bridgeLoading, plan, hidden])

  // A linked item that leaves the board was either finished elsewhere (tick
  // the entry) or reassigned or claimed by someone else (flag it).
  useEffect(() => {
    if (bridgeLoading) return
    const present = new Set(tasks.map(t => t.id))
    for (const entry of plan.entries) {
      const id = entry.itemId
      if (!id || entry.done) continue
      if (present.has(id)) {
        if (entry.missing) setPlan(p => updateItemEntries(p, id, { missing: false }))
        continue
      }
      if (entry.missing || checking.current.has(id) || !entry.itemSource || bridgeErrors[entry.itemSource]) continue
      checking.current.add(id)
      const finished = entry.itemSource === 'stories' ? Promise.resolve(doneIds.has(id)) : fetchPageDone(id)
      finished
        .then(done => setPlan(p => updateItemEntries(p, id, done ? { done: true, doneAt: new Date().toISOString() } : { missing: true })))
        .catch(() => { /* check again on the next refresh */ })
        .finally(() => checking.current.delete(id))
    }
  }, [tasks, bridgeLoading])

  const workingTask = visibleTasks.find(t => t.status === 'working') ?? null
  const focusing = !!workingTask && view === 'focus'

  // Related Initiative / Issue / Analyst Issue for the active item.
  useEffect(() => {
    if (!workingTask?.queue || related[workingTask.id]) return
    const { id } = workingTask
    setRelated(prev => ({ ...prev, [id]: 'loading' }))
    const adapter = queueFor(workingTask)
    if (!adapter?.related) return
    adapter.related(workingTask)
      .then(r => setRelated(prev => ({ ...prev, [id]: r })))
      .catch(e => setRelated(prev => ({ ...prev, [id]: { error: errorText(e) } })))
  }, [workingTask, related])

  // Move a card between lanes. Only one item can be in Working; the previous
  // one drops back to Todo. Sources that track lanes (Pulse claims, ADO state)
  // write the change and offer an undo, which also runs `onUndo`; a failed
  // write puts the card back.
  const moveTask = async (id: string, to: Status, onUndo?: () => void) => {
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

    const adapter = queueFor(task)
    if (!adapter?.move) return
    try {
      const result = await adapter.move(task, from, to, developer)
      if (!result) return
      if (result.patch) setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...result.patch } : t)))
      showToast(result.did, async () => {
        onUndo?.()
        setLane(from, 'working')
        setTasks(prev => prev.map(t => (t.id === id ? { ...t, externalState: task.externalState } : t)))
        try {
          await adapter.revert?.(task, from, to, developer)
        } catch (e) {
          setActionError(`Couldn't undo ${task.ref ?? task.title}: ${errorText(e)}`)
        }
      })
    } catch (e) {
      setLane(from, 'working')
      setActionError(`Couldn't move ${task.ref ?? task.title}: ${errorText(e)}`)
    }
  }

  // Draw the eye to the next open plan entry after `itemId`'s.
  const highlightNext = (itemId: string) => {
    const at = plan.entries.findIndex(e => e.itemId === itemId)
    const isNext = (e: PlanEntry) => !e.done && e.itemId !== itemId
    const next = plan.entries.slice(at + 1).find(isNext) ?? plan.entries.find(isNext)
    if (next) setHighlight(next.id)
  }
  useEffect(() => {
    if (!highlight) return
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-entry="${highlight}"]`)?.focus())
    const t = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(t)
  }, [highlight])

  // Mark an item done: it leaves the board at once, and the write waits out
  // the undo window (it's sent straight away if the page closes).
  const scheduleDone = (task: Task) => {
    const done = queueFor(task)?.done
    if (!done || pendingDone.current.has(task.id)) return
    const who = developer
    setActionError(null)
    setHidden(prev => new Set(prev).add(task.id))
    setPlan(p => updateItemEntries(p, task.id, { done: true }))
    setModalTask(m => (m?.id === task.id ? null : m))
    if (task.status === 'working') highlightNext(task.id)

    const run = async () => {
      pendingDone.current.delete(task.id)
      try {
        await done(task, who)
        setTasks(prev => prev.filter(t => t.id !== task.id))
        updateLanes(who, { [task.id]: null })
        setTicks(t => clearTicks(t, [task.id]))
        setPlan(p => updateItemEntries(p, task.id, { done: true, doneAt: new Date().toISOString() }))
        // Count it as done straight away; the next refresh confirms it.
        setProgress(prev => {
          const p = prev[task.source]
          return p ? { ...prev, [task.source]: { ...p, done: p.done + 1, donePoints: p.donePoints + (task.points ?? 0) } } : prev
        })
      } catch (e) {
        setPlan(p => updateItemEntries(p, task.id, { done: false }))
        setActionError(`Couldn't mark ${task.ref ?? task.title} done: ${errorText(e)}`)
      } finally {
        setHidden(prev => { const next = new Set(prev); next.delete(task.id); return next })
      }
    }
    pendingDone.current.set(task.id, { timer: window.setTimeout(run, UNDO_MS), run })
    showToast(`Marked ${task.ref ?? task.title} done in ${sourceSystem(task)}`, () => cancelDone(task.id))
  }

  const cancelDone = (id: string) => {
    const pending = pendingDone.current.get(id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    pendingDone.current.delete(id)
    setHidden(prev => { const next = new Set(prev); next.delete(id); return next })
    setPlan(p => updateItemEntries(p, id, { done: false }))
  }

  const doneHandler = (task: Task) => (queueFor(task)?.done ? () => scheduleDone(task) : undefined)

  // Undoing a start or an add also takes back the plan entry it created.
  const forgetIfNew = (task: Task) =>
    planned.has(task.id) ? undefined : () => setPlan(p => removeAddedEntry(p, task.id))

  const startTask = (task: Task) => {
    const onUndo = forgetIfNew(task)
    setPlan(p => addItem(p, task))
    setView('focus')
    moveTask(task.id, 'working', onUndo)
  }

  const addToPlan = (task: Task) => {
    const onUndo = forgetIfNew(task)
    setPlan(p => addItem(p, task))
    if (task.status === 'queue') moveTask(task.id, 'today', onUndo)
  }

  const toggleEntry = (entry: PlanEntry) => {
    if (entry.doneAt) return
    if (entry.done) {
      if (entry.itemId && pendingDone.current.has(entry.itemId)) cancelDone(entry.itemId)
      else setPlan(p => updateEntry(p, entry.id, { done: false }))
      return
    }
    const task = entry.itemId ? tasksById.get(entry.itemId) : undefined
    if (task && queueFor(task)?.done) scheduleDone(task)
    else setPlan(p => updateEntry(p, entry.id, { done: true }))
  }

  const removeFromPlan = (entry: PlanEntry) => {
    setPlan(p => removeEntry(p, entry.id))
    const task = entry.itemId ? tasksById.get(entry.itemId) : undefined
    if (task?.status === 'today') moveTask(task.id, 'queue')
  }

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [])

  const handleDrop = (e: React.DragEvent, zone: DropZone) => {
    e.preventDefault()
    setDropTarget(null)
    if (dragId) {
      const task = tasksById.get(dragId)
      if (task && zone === 'today') addToPlan(task)
      else if (task && zone === 'working') startTask(task)
      else moveTask(dragId, zone)
    }
    setDragId(null)
  }

  const handleDragOver = useCallback((e: React.DragEvent, zone: DropZone) => {
    e.preventDefault()
    setDropTarget(zone)
  }, [])

  const handleDragLeave = useCallback(() => setDropTarget(null), [])

  // A drag that ends outside any drop zone.
  useEffect(() => {
    const end = () => { setDragId(null); setDropTarget(null) }
    window.addEventListener('dragend', end)
    return () => window.removeEventListener('dragend', end)
  }, [])

  const dropProps = (zone: DropZone) => ({
    onDragOver: (e: React.DragEvent) => handleDragOver(e, zone),
    onDragLeave: handleDragLeave,
    onDrop: (e: React.DragEvent) => handleDrop(e, zone),
    'data-drop': dropTarget === zone ? ('on' as const) : undefined,
  })

  // Global shortcuts; rows handle their own keys first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (booting || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[data-overlay]')) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape' && workingTask) setView(v => (v === 'focus' ? 'myday' : 'focus'))
      else if (e.key === 'p') focusFirstRow('plan')
      else if (e.key === 'n') focusFirstRow('upnext')
      else if (e.key === 'q') focusFirstRow('queue')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Derived views ──
  const planned = useMemo(() => plannedIds(plan), [plan])
  const queueTasks = visibleTasks.filter(t => t.status === 'queue' && t.source === queueTab && !planned.has(t.id))
  const unplannedCount = (source?: QueueSource) =>
    visibleTasks.filter(t => t.status === 'queue' && !planned.has(t.id) && (!source || t.source === source)).length
  const blockedTasks = visibleTasks.filter(t => t.status === 'blocked')
  const countOf = (source: QueueSource) => visibleTasks.filter(t => t.source === source).length
  const openEntries = plan.entries.filter(e => !e.done).length

  const aging = useMemo(() => {
    const items = new Map<string, string>()
    for (const line of briefData?.aging ?? []) {
      const { title, since } = agingLabel(line.text)
      const task = line.mentions.map(id => tasksById.get(id)).find(Boolean) ?? matchLine(title, visibleTasks)
      if (task) items.set(task.id, since)
    }
    return items
  }, [briefData, tasksById, visibleTasks])
  const rankContext: RankContext = {
    sprint,
    staleDays: STALE_STANDUP_DAYS,
    aging,
    workingDaysLeft: sprint?.end && sprint.end >= today ? workingDaysAfter(today, sprint.end) : null,
  }
  const upNext = rankUpNext(visibleTasks, planned, rankContext)
  const suggestions = useMemo(() => suggestLinks(plan, visibleTasks), [plan, visibleTasks])
  const duplicates = useMemo(() => findDuplicates(visibleTasks), [visibleTasks])
  const events = useMemo(
    () => comingUp({ deadlines, sprint, teamItems: briefData?.teamItems ?? [], today }),
    [deadlines, sprint, briefData, today],
  )
  const planView: PlanView = {
    plan,
    tasksById,
    suggestions,
    reasons: task => reasonsFor(task, rankContext),
    duplicates,
    highlight,
    workingId: workingTask?.id ?? null,
  }
  const nextUp = (() => {
    const at = plan.entries.findIndex(e => e.itemId === workingTask?.id)
    const open = plan.entries.map((entry, i) => ({ entry, i })).filter(({ entry }) => !entry.done && entry.itemId !== workingTask?.id)
    const next = open.find(({ i }) => i > at) ?? open[0]
    return next ? { entry: next.entry, task: next.entry.itemId ? tasksById.get(next.entry.itemId) : undefined } : null
  })()

  const actions: DayActions = {
    toggle: toggleEntry,
    start: startTask,
    add: addToPlan,
    remove: removeFromPlan,
    shift: (entry, delta) => setPlan(p => shift(p, entry.id, delta)),
    reorder: (id, beforeId) => setPlan(p => reorder(p, id, beforeId)),
    confirm: (entry, task) => setPlan(p => updateEntry(p, entry.id, { ...linkTo(task), linkedBy: 'you', missing: false })),
    reject: (entry, task) => setPlan(p => updateEntry(p, entry.id, e => ({ rejected: [...(e.rejected ?? []), task.id] }))),
    pick: entry => setLinkFor(entry),
    open: task => setModalTask(task),
    block: task => moveTask(task.id, 'blocked'),
    unblock: task => { setPlan(p => addItem(p, task)); moveTask(task.id, 'today') },
    done: scheduleDone,
    resume: () => setView('focus'),
    openReader: tab => setReader(tab),
    dragItem: handleDragStart,
    dropProps,
    doneTarget: task => (queueFor(task)?.done ? sourceSystem(task) : null),
  }

  const sprintHeader = sprint ? [sprint.name.toUpperCase(), formatSprintRange(sprint)].filter(Boolean).join(' · ') : 'SPRINT —'
  const sprintDaysLeft = sprint?.end ? Math.max(0, daysBetween(today, sprint.end)) : null
  const sprintLength = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : null
  const sprintDay = sprint?.start && sprintLength ? Math.min(sprintLength, Math.max(1, daysBetween(sprint.start, today) + 1)) : null

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
    const task = visibleTasks.find(t => line.mentions.includes(t.id))
    if (task) {
      setReader(null)
      setModalTask(task)
    }
  }

  const linkCandidates = linkFor
    ? visibleTasks.filter(t => t.id === linkFor.itemId || !planned.has(t.id))
    : []

  // Named actions for what the views do inline.
  const closeDetail = () => setModalTask(null)
  const startFromDetail = (task: Task) => { setModalTask(null); startTask(task) }
  const addFromDetail = (task: Task) => { setModalTask(null); addToPlan(task) }
  const backToMyDay = () => setView('myday')
  const returnToPlan = (task: Task) => { setView('myday'); moveTask(task.id, 'today') }
  const dismissError = () => setActionError(null)
  const linkEntry = (entry: PlanEntry, task: Task) => { actions.confirm(entry, task); setLinkFor(null) }
  const unlinkEntry = (entry: PlanEntry) => {
    setPlan(p => updateEntry(p, entry.id, e => ({
      itemId: undefined, itemRef: undefined, itemSource: undefined, linkedBy: undefined, missing: false,
      rejected: e.itemId ? [...(e.rejected ?? []), e.itemId] : e.rejected,
    })))
    setLinkFor(null)
  }
  const closePicker = () => setLinkFor(null)
  const closeReader = () => setReader(null)
  const undoToast = () => { toast?.undo?.(); setToast(null) }
  const finishBoot = () => setBooting(false)

  return {
    // state
    tasks, visibleTasks, tasksById, plan, ticks, developer, currentDeveloper, today, sprint, brief, briefData, deadlines,
    reviews, teamBlockers, progress, related, bridgeLoading, bridgeErrors, actionError, toast, booting,
    view, focusing, workingTask, modalTask, linkFor, reader, queueTab, dragId, dropTarget,
    // derived
    planned, queueTasks, blockedTasks, openEntries, upNext, events, planView, nextUp, linkCandidates,
    unplannedCount, countOf, sprintHeader, sprintDay, sprintLength, sprintDaysLeft, tickerItems, calendarItems,
    bootSteps, bootSummary,
    // actions
    actions, cockpit, doneHandler, startTask, addToPlan, moveTask, changeDeveloper, openMention,
    handleDragStart, handleDragOver, handleDragLeave, handleDrop,
    setQueueTab, setModalTask, closeDetail, startFromDetail, addFromDetail, backToMyDay, returnToPlan,
    dismissError, linkEntry, unlinkEntry, closePicker, setReader, closeReader, undoToast, finishBoot,
  }
}

export type Board = ReturnType<typeof useBoard>

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
