import type { Plan } from '../../plan'

// The one-line summary under Flow's day header: where everything is, in the
// order the page reads (plan, working, blocked, done). Each part links to its
// section, so it also stands in for the overview a board would give.

export type StripPart = 'plan' | 'working' | 'blocked' | 'done'

export interface StripItem { part: StripPart; count: number; label: string }

export function dayStrip({ plan, workingId, blockedCount }: { plan: Plan; workingId: string | null; blockedCount: number }): StripItem[] {
  const open = plan.entries.filter(e => !e.done)
  // The item being worked on is counted once, as working.
  const toDo = open.filter(e => !(workingId && e.itemId === workingId)).length
  return [
    { part: 'plan', count: toDo, label: 'to do' },
    { part: 'working', count: workingId ? 1 : 0, label: 'working' },
    { part: 'blocked', count: blockedCount, label: 'blocked' },
    { part: 'done', count: plan.entries.length - open.length, label: 'done today' },
  ]
}

// Where each part scrolls to. Done has no section of its own: it is the ticked rows of the plan.
export const STRIP_TARGET: Record<StripPart, string> = {
  plan: 'flow-plan', working: 'flow-working', blocked: 'flow-blocked', done: 'flow-plan',
}
