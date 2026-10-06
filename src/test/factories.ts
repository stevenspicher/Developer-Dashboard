import type { Deadline, Sprint } from '../bridge'
import type { Plan, PlanEntry } from '../plan'
import type { Task } from '../types'

// Builders for tests: a task or plan entry with sensible defaults.

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? 't1'
  return {
    id,
    ref: `DEV-${id.toUpperCase()}`,
    type: 'task',
    source: 'tasks',
    title: 'A task',
    description: '',
    priority: 'none',
    assignee: 'AL',
    tags: [],
    status: 'queue',
    ...overrides,
  }
}

export function makeEntry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return { id: 'e1', text: 'Do the thing', origin: 'added', addedOn: '2026-10-06', ...overrides }
}

export function makePlan(entries: PlanEntry[] = [], overrides: Partial<Plan> = {}): Plan {
  return { day: '2026-10-06', entries, mergedBriefs: [], ...overrides }
}

export const makeSprint = (overrides: Partial<Sprint> = {}): Sprint => ({
  name: 'Sprint 20', number: 20, start: '2026-09-23', end: '2026-10-06', ...overrides,
})

export const makeDeadline = (overrides: Partial<Deadline> = {}): Deadline => ({
  id: 'd1', title: 'UAT session', start: '2026-10-09', end: null, ...overrides,
})
