import type { Task } from '../types'
import { CockpitPane } from './cockpit/CockpitPane'
import type { PaneActionId } from './cockpit/actions'
import { Overlay } from './Overlay'

// An item opened from a list: the whole cockpit in a dialog.
export function DetailModal({ task, sourceLabel, planned, doneTarget, handlers, onClose }: {
  task: Task
  sourceLabel?: string
  planned: boolean
  doneTarget: string | null
  handlers: Partial<Record<PaneActionId, () => void>>
  onClose: () => void
}) {
  return (
    <Overlay label="Item details" onClose={onClose} className="h-[82vh] w-[920px]">
      <CockpitPane
        key={task.id}
        task={task}
        sourceLabel={sourceLabel}
        planned={planned}
        doneTarget={doneTarget}
        handlers={handlers}
        onClose={onClose}
      />
    </Overlay>
  )
}
