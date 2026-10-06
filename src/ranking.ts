import type { Task } from './types'
import type { Sprint } from './bridge'

// ─── Up next ──────────────────────────────────────────────────────────────────
// Ranks the items that aren't in today's plan yet. Each signal adds a weight
// and shows its reason, so the order explains itself. Sources describe
// urgency differently, so each reason uses the source's own terms.

export interface Reason {
  text: string
  urgent?: boolean
}

export interface Suggestion {
  task: Task
  score: number
  reasons: Reason[]
}

export interface RankContext {
  sprint: Sprint | null
  staleDays: number                  // standup age that counts as stale
  aging: Map<string, string>         // item id → "Aug 31" from the brief's aging lines ('' if no date)
  workingDaysLeft: number | null     // working days left in the sprint after today
}

const WEIGHTS = {
  aging: 50,
  staleStandup: 25,
  pulseTwoSprints: 30,
  pulseLastSprint: 15,
  pulseThisSprint: 5,
  adoP1: 25,
  adoP2: 15,
  adoOther: 3,
  sprintEnding: 10,
  ticket: { critical: 30, high: 20, medium: 10, low: 0, none: 0 },
}
const SPRINT_ENDING_DAYS = 3

const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })

function sprintsBehind(task: Task, sprint: Sprint | null) {
  const n = Number(task.sprint?.replace(/^SPR-/, ''))
  return sprint?.number != null && Number.isFinite(n) ? sprint.number - n : 0
}

// Every reason a task deserves attention, with its weight.
function signals(task: Task, ctx: RankContext): { weight: number; reason: Reason }[] {
  const out: { weight: number; reason: Reason }[] = []
  const add = (weight: number, text: string, urgent = false) => out.push({ weight, reason: { text, urgent } })

  const aging = ctx.aging.get(task.id)
  if (aging !== undefined) add(WEIGHTS.aging, aging ? `Aging since ${aging}` : 'Aging', true)

  switch (task.source) {
    case 'tasks':
      if (task.standupAgeDays !== undefined && task.standupAgeDays > ctx.staleDays) {
        add(WEIGHTS.staleStandup, `In standup ${task.standupAgeDays} days`, true)
      }
      break
    case 'pulse': {
      const behind = sprintsBehind(task, ctx.sprint)
      if (behind >= 2) add(WEIGHTS.pulseTwoSprints, `${behind} sprints old`, true)
      else if (behind === 1) add(WEIGHTS.pulseLastSprint, 'From last sprint')
      else add(WEIGHTS.pulseThisSprint, 'Member request')
      break
    }
    case 'stories':
      if (task.priorityLabel === 'P1') add(WEIGHTS.adoP1, 'P1', true)
      else if (task.priorityLabel === 'P2') add(WEIGHTS.adoP2, 'P2')
      else if (task.priorityLabel) add(WEIGHTS.adoOther, task.priorityLabel)
      if (ctx.sprint?.end && ctx.workingDaysLeft !== null && ctx.workingDaysLeft <= SPRINT_ENDING_DAYS) {
        add(WEIGHTS.sprintEnding, `Sprint ends ${weekday(ctx.sprint.end)}`)
      }
      if (task.points) add(0, `${task.points} pt`)
      break
    case 'solarwinds':
      if (task.priorityLabel) {
        add(WEIGHTS.ticket[task.priority], `${task.priorityLabel} priority`, task.priority === 'critical' || task.priority === 'high')
      }
      if (task.externalState) add(0, task.externalState)
      break
  }
  return out
}

// The reasons for one task, strongest first (also shown on planned items).
export function reasonsFor(task: Task, ctx: RankContext): Reason[] {
  return signals(task, ctx).sort((a, b) => b.weight - a.weight).map(s => s.reason)
}

// Queue items not in the plan, best first; ties keep the board's order.
export function rankUpNext(tasks: Task[], planned: Set<string>, ctx: RankContext): Suggestion[] {
  return tasks
    .filter(t => t.status === 'queue' && !planned.has(t.id))
    .map((task, index) => {
      const s = signals(task, ctx).sort((a, b) => b.weight - a.weight)
      return { task, index, score: s.reduce((sum, x) => sum + x.weight, 0), reasons: s.map(x => x.reason) }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ task, score, reasons }) => ({ task, score, reasons }))
}
