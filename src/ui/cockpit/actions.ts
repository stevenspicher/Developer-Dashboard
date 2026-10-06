import type { ButtonVariant } from '../atoms'
import type { Task } from '../../types'

// Which buttons an item's action bar shows, by the lane it is in:
//   queue   → Start, Plan (Claim and plan for a Pulse item), unless it is already in the plan
//   today   → Start, Block
//   working → Return to plan, Block
//   blocked → Unblock
// plus Done wherever the item's source can be written to.
export type PaneActionId = 'start' | 'add' | 'block' | 'unblock' | 'return' | 'done'

export interface PaneAction {
  id: PaneActionId
  label: string
  variant: ButtonVariant
}

export function laneActions(task: Pick<Task, 'status' | 'source'>, { planned, canDone }: { planned: boolean; canDone: boolean }) {
  const actions: PaneAction[] = []
  switch (task.status) {
    case 'queue':
      actions.push({ id: 'start', label: '▶ Start', variant: 'quiet' })
      if (!planned) actions.push({ id: 'add', label: task.source === 'pulse' ? '＋ Claim and plan' : '＋ Plan', variant: 'quiet' })
      break
    case 'today':
      actions.push({ id: 'start', label: '▶ Start', variant: 'quiet' }, { id: 'block', label: 'Block', variant: 'quiet' })
      break
    case 'working':
      actions.push({ id: 'return', label: 'Return to plan', variant: 'quiet' }, { id: 'block', label: 'Block', variant: 'quiet' })
      break
    case 'blocked':
      actions.push({ id: 'unblock', label: 'Unblock', variant: 'quiet' })
      break
  }
  if (canDone) actions.push({ id: 'done', label: '✓ Done', variant: 'done' })
  // A queue item that is in the plan already says so instead of offering Plan.
  return { actions, inPlan: planned && task.status === 'queue' }
}
