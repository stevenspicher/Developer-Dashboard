export type TaskType = 'story' | 'task' | 'bug' | 'spike' | 'alert' | 'ticket' | 'incident'
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type Status = 'queue' | 'today' | 'working' | 'blocked'
export type QueueSource = 'stories' | 'tasks' | 'pulse' | 'solarwinds' | 'zendesk' | 'ads'

export interface Initiative {
  id: string
  name: string
  goal: string
  owner: string
  progress: number
  dueDate: string
  status: 'on-track' | 'at-risk' | 'blocked'
}

export interface Task {
  id: string
  ref?: string
  queue?: string
  url?: string
  link?: string
  notes?: string
  standupAgeDays?: number
  type: TaskType
  source: QueueSource
  title: string
  description: string
  priority: Priority
  points?: number
  progress: number
  assignee: string
  sprint?: string
  tags: string[]
  status: Status
  blockedReason?: string
  subtasks?: { title: string; done: boolean }[]
  comments: number
  branch?: string
  initiative?: Initiative
  acceptanceCriteria?: string[]
  severity?: string
  affectedSystem?: string
  reportedBy?: string
  environment?: string
  activity?: { user: string; time: string; text: string }[]
}
