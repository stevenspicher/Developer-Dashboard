import type { QueueSource, Task } from '../types'
import { QUEUES } from '../bridge'

export const SOURCE_TABS = ([
  { id: 'stories',    label: 'Stories' },
  { id: 'tasks',      label: 'Tasks' },
  { id: 'pulse',      label: 'Pulse' },
  { id: 'solarwinds', label: 'Solarwinds' },
  { id: 'zendesk',    label: 'Zendesk' },
  { id: 'ads',        label: 'ADS' },
] satisfies { id: QueueSource; label: string }[])
  // Only sources with a live queue: Zendesk has none yet, and Stories is
  // hidden when VITE_ADO_STORIES=false.
  .filter(tab => QUEUES.some(q => q.source === tab.id))

// Writes that can be undone wait this long (done) or offer undo this long (moves).
export const UNDO_MS = 6000
export const HIGHLIGHT_MS = 2600

// Where an item's writes go.
export const sourceSystem = (task: Task) => (task.source === 'stories' ? 'ADO' : 'Notion')
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
