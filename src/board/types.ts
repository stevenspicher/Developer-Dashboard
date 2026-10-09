import type { PullRequest, StoryRequest } from '../bridge'
import type { Plan, PlanEntry } from '../plan'
import type { Reason } from '../ranking'
import type { Task } from '../types'

// Shared by the board hook and whichever views render it.


export type DropZone = 'today' | 'working' | 'blocked' | 'queue'
export type ReaderTab = 'brief' | 'ticker' | 'calendar' | 'draft'

// Pull requests waiting on the developer. Null when there's no ado-bridge to ask.
export type Reviews = PullRequest[] | 'loading' | { error: string } | null
export type StoryRequests = StoryRequest[] | 'loading' | { error: string }

// What the layouts ask the board to do.
export interface DayActions {
  toggle: (entry: PlanEntry) => void
  start: (task: Task) => void
  add: (task: Task) => void
  remove: (entry: PlanEntry) => void
  shift: (entry: PlanEntry, delta: number) => void
  reorder: (id: string, beforeId: string | null) => void
  confirm: (entry: PlanEntry, task: Task) => void
  reject: (entry: PlanEntry, task: Task) => void
  pick: (entry: PlanEntry) => void
  open: (task: Task) => void
  block: (task: Task) => void
  unblock: (task: Task) => void
  done: (task: Task) => void
  openReader: (tab: ReaderTab) => void
  dragItem: (e: React.DragEvent, id: string) => void
  dropProps: (zone: DropZone) => React.HTMLAttributes<HTMLElement> & { 'data-drop'?: 'on' }
  doneTarget: (task: Task) => string | null // where ✓ writes, or null when the source is read-only
}

// The plan plus what each entry needs to render.
export interface PlanView {
  plan: Plan
  tasksById: Map<string, Task>
  suggestions: Map<string, Task> // entry id → item it probably refers to
  reasons: (task: Task) => Reason[]
  duplicates: Map<string, Task>
  highlight: string | null // entry to draw the eye to, e.g. the next one after a done
  workingId: string | null
}

// A message with an optional undo, shown for a few seconds.
export interface Toast {
  id: number
  text: string
  undo?: () => void
}

// A done that is waiting out its undo window.
export interface PendingDone {
  timer: number
  run: () => Promise<void>
}
