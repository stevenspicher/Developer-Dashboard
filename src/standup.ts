import { plainText } from './bridge'
import type { Ticks } from './cockpitLogic'
import { tickedCount } from './cockpitLogic'
import type { Plan } from './plan'
import { recentlyDone } from './plan'
import type { Task } from './types'

// A standup update to paste into chat, built from what's on the board: what
// got done, what's planned and what's blocked. Pull requests are left out:
// the board lists every open one, not just the developer's own reviews.
// It's a starting point to edit, not a record.

const withRef = (text: string, ref?: string) => {
  const line = plainText(text)
  return ref && !line.toLowerCase().includes(ref.toLowerCase()) ? `${line} (${ref})` : line
}

const section = (title: string, lines: string[]) => (lines.length ? [title, ...lines.map(l => `• ${l}`), ''] : [])

export interface StandupInput {
  today: string
  plan: Plan
  tasksById: Map<string, Task>
  blocked: Task[]
  ticks: Ticks
  longDate: string
}

export function buildStandupDraft({ plan, tasksById, blocked, ticks, longDate }: StandupInput): string {
  const done = recentlyDone(plan).map(r => withRef(r.text, r.ref))

  const planned = plan.entries.filter(e => !e.done).map(e => {
    const task = e.itemId ? tasksById.get(e.itemId) : undefined
    const total = task?.acceptanceCriteria?.length ?? 0
    const ticked = task ? tickedCount(ticks, task) : 0
    const progress = total > 0 && ticked > 0 ? ` — ${ticked}/${total} criteria done` : ''
    return withRef(e.text, e.itemRef) + progress
  })

  const blockedLines = blocked.map(t => `${t.ref ?? t.id} ${t.title}`)

  return [
    `Standup · ${longDate}`,
    '',
    ...section('Done', done),
    ...section('Today', planned.length ? planned : ['Nothing planned yet']),
    ...section('Blocked', blockedLines),
  ].join('\n').trimEnd() + '\n'
}
