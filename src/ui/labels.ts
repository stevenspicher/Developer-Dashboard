import type { Priority, TaskType } from '../types'

// The words and tones the shared components use for item data. Colour carries
// status only (accent = interactive, ok = done or active, warn = needs
// attention, danger = critical, blocked or failed); sources and item types are
// never colour-coded, and MED and LOW stay neutral so CRIT and HIGH stand out.

export type Tone = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'danger'

export const TYPE_LABELS: Record<TaskType, string> = {
  story: 'STORY', task: 'TASK', bug: 'BUG', spike: 'SPIKE', alert: 'ALERT', ticket: 'TICKET', incident: 'INCIDENT',
}

// Items without a priority show none.
export const PRIORITY: Record<Priority, { label: string; tone: Tone; dot: string } | null> = {
  critical: { label: 'CRIT', tone: 'danger', dot: 'bg-danger' },
  high: { label: 'HIGH', tone: 'warn', dot: 'bg-warn' },
  medium: { label: 'MED', tone: 'neutral', dot: 'bg-dim' },
  low: { label: 'LOW', tone: 'muted', dot: 'bg-faint' },
  none: null,
}

export interface Status { label: string; tone: Tone }

// A pull request: draft, open, merged or abandoned.
export function prStatus(pr: { status?: string | null; isDraft?: boolean }): Status | null {
  if (pr.isDraft && pr.status === 'active') return { label: 'DRAFT', tone: 'muted' }
  switch (pr.status) {
    case 'active': return { label: 'OPEN', tone: 'accent' }
    case 'completed': return { label: 'MERGED', tone: 'ok' }
    case 'abandoned': return { label: 'ABANDONED', tone: 'muted' }
    default: return null
  }
}

// A build's result, or RUNNING while it hasn't finished.
export function buildStatus(build: { result?: string | null; status?: string | null }): Status | null {
  switch (build.result) {
    case 'succeeded': return { label: 'PASSED', tone: 'ok' }
    case 'failed': return { label: 'FAILED', tone: 'danger' }
    case 'partiallySucceeded': return { label: 'PARTIAL', tone: 'warn' }
    case 'canceled': return { label: 'CANCELED', tone: 'muted' }
  }
  return build.status === 'inProgress' || build.status === 'notStarted' ? { label: 'RUNNING', tone: 'muted' } : null
}
