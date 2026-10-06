import type { PullRequest } from './bridge'
import { daysBetween, plainText } from './bridge'
import type { Ticks } from './cockpitLogic'
import { tickedCount } from './cockpitLogic'
import type { Plan } from './plan'
import { recentlyDone } from './plan'
import type { Task } from './types'

// A standup update to paste into chat, built from what's on the board: what
// got done, what's planned, the reviews waiting on you and what's blocked.
// It's a starting point to edit, not a record.

const withRef = (text: string, ref?: string) => {
  const line = plainText(text)
  return ref && !line.toLowerCase().includes(ref.toLowerCase()) ? `${line} (${ref})` : line
}

const ageLabel = (days: number) => (days <= 0 ? 'today' : days === 1 ? '1 day old' : `${days} days old`)

const section = (title: string, lines: string[]) => (lines.length ? [title, ...lines.map(l => `• ${l}`), ''] : [])

export interface StandupInput {
  today: string
  plan: Plan
  tasksById: Map<string, Task>
  blocked: Task[]
  reviews: PullRequest[]
  ticks: Ticks
  longDate: string
}

export function buildStandupDraft({ today, plan, tasksById, blocked, reviews, ticks, longDate }: StandupInput): string {
  const done = recentlyDone(plan).map(r => withRef(r.text, r.ref))

  const planned = plan.entries.filter(e => !e.done).map(e => {
    const task = e.itemId ? tasksById.get(e.itemId) : undefined
    const total = task?.acceptanceCriteria?.length ?? 0
    const ticked = task ? tickedCount(ticks, task) : 0
    const progress = total > 0 && ticked > 0 ? ` — ${ticked}/${total} criteria done` : ''
    return withRef(e.text, e.itemRef) + progress
  })

  const reviewLines = reviews.map(pr => {
    const days = pr.createdDate ? daysBetween(pr.createdDate.slice(0, 10), today) : 0
    const where = [pr.repo, ageLabel(days)].filter(Boolean).join(', ')
    return `Review PR ${pr.pullRequestId}: ${plainText(pr.title)} (${where})`
  })

  const blockedLines = blocked.map(t => `${t.ref ?? t.id} ${t.title}`)

  return [
    `Standup · ${longDate}`,
    '',
    ...section('Done', done),
    ...section('Today', planned.length || reviewLines.length ? [...planned, ...reviewLines] : ['Nothing planned yet']),
    ...section('Blocked', blockedLines),
  ].join('\n').trimEnd() + '\n'
}
