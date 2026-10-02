export type TaskType = 'story' | 'task' | 'bug' | 'spike' | 'alert' | 'ticket' | 'incident'
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type Status = 'queue' | 'today' | 'working' | 'blocked'
export type QueueSource = 'stories' | 'tasks' | 'pulse' | 'solarwinds' | 'zendesk' | 'ads'

export interface Task {
  id: string
  ref?: string
  queue?: string
  url?: string
  link?: string
  notes?: string
  standupAgeDays?: number
  // The item's own state in its source (ADO State, Solarwinds State).
  externalState?: string
  parentId?: string
  type: TaskType
  source: QueueSource
  title: string
  description: string
  priority: Priority
  points?: number
  assignee: string
  sprint?: string
  tags: string[]
  status: Status
  acceptanceCriteria?: string[]
}
