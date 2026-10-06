import type { PullRequest, TeamBlocker } from '../../bridge'
import type { Plan, PlanEntry } from '../../plan'
import type { Task } from '../../types'

// What is selected in the list. A typed value rather than a bare id, so a plan
// entry, a board item, a pull request and a developer can never be mistaken for
// one another (a plan entry's id used to be looked up as an item id, which left
// the pane empty).
export type Selection =
  | { kind: 'entry'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'review'; id: number }
  | { kind: 'team'; name: string }

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  !!a && !!b && a.kind === b.kind && ('id' in a && 'id' in b ? a.id === b.id : 'name' in a && 'name' in b && a.name === b.name)

// A stable DOM id for a row, to find it again.
export const rowId = (s: Selection) => `${s.kind}:${'id' in s ? s.id : s.name}`

// One developer's update, with their blocked stories.
export interface TeamMember { developer: string; text: string; blockers: TeamBlocker[] }

// A lead's view: each developer's update, matched to their blocked ADO stories by
// first name. Blockers that match nobody come back as `others`.
export function groupTeam(summaries: { developer: string; text: string }[], blockers: TeamBlocker[]) {
  const firstName = (name: string) => name.trim().split(/\s+/)[0].toLowerCase()
  const members = new Map<string, TeamMember>(summaries.map(s => [s.developer.toLowerCase(), { developer: s.developer, text: s.text, blockers: [] }]))
  const others: TeamBlocker[] = []
  for (const b of blockers) {
    const member = members.get(firstName(b.assignee))
    if (member) member.blockers.push(b)
    else others.push(b)
  }
  return { members: [...members.values()], others }
}

export type PaneContent =
  | { type: 'task'; task: Task; entry?: PlanEntry }
  | { type: 'entry'; entry: PlanEntry }
  | { type: 'review'; pr: PullRequest }
  | { type: 'team'; member: TeamMember }
  | { type: 'working'; task: Task }
  | { type: 'empty' }

// What the pane shows for the selection. A plan entry that is linked to an item
// shows that item; an unlinked one shows the entry itself. With nothing (or
// something that has since left the board) selected, it shows the item being
// worked on, if there is one.
export function resolvePane(selection: Selection | null, data: {
  plan: Plan
  tasksById: Map<string, Task>
  reviews: PullRequest[]
  team: TeamMember[]
  workingTask: Task | null
}): PaneContent {
  const { plan, tasksById, reviews, team, workingTask } = data
  if (selection?.kind === 'entry') {
    const entry = plan.entries.find(e => e.id === selection.id)
    if (entry) {
      const task = entry.itemId ? tasksById.get(entry.itemId) : undefined
      return task ? { type: 'task', task, entry } : { type: 'entry', entry }
    }
  } else if (selection?.kind === 'task') {
    const task = tasksById.get(selection.id)
    if (task) return { type: 'task', task }
  } else if (selection?.kind === 'review') {
    const pr = reviews.find(r => r.pullRequestId === selection.id)
    if (pr) return { type: 'review', pr }
  } else if (selection?.kind === 'team') {
    const member = team.find(m => m.developer === selection.name)
    if (member) return { type: 'team', member }
  }
  return workingTask ? { type: 'working', task: workingTask } : { type: 'empty' }
}
