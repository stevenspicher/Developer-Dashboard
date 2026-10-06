import type { Task } from '../types'
import type { PaneActionId } from '../ui/cockpit/actions'
import type { Board } from './useBoard'

// What each button of an item's action bar does. In the detail modal, Start and
// Plan also close it.
export function paneHandlers(board: Pick<Board, 'actions' | 'moveTask' | 'doneHandler' | 'startTask' | 'addToPlan' | 'startFromDetail' | 'addFromDetail'>, task: Task, inModal = false): Partial<Record<PaneActionId, () => void>> {
  const { actions, moveTask, doneHandler, startTask, addToPlan, startFromDetail, addFromDetail } = board
  return {
    start: () => (inModal ? startFromDetail(task) : startTask(task)),
    add: () => (inModal ? addFromDetail(task) : addToPlan(task)),
    block: () => moveTask(task.id, 'blocked'),
    unblock: () => actions.unblock(task),
    return: () => moveTask(task.id, 'today'),
    done: doneHandler(task),
  }
}
