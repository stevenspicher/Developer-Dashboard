import type { Priority, QueueSource, TaskType } from '../types'

// The words and tones the shared components use for item data. Status colours
// (accent = interactive, ok = done or active, warn = needs attention, danger =
// critical, blocked or failed) carry status only, and MED and LOW stay neutral
// so CRIT and HIGH stand out. Each source has its own colour (the --src-*
// tokens), so Stories, Tasks, Pulse, Solarwinds and ADS items tell apart at a glance.

export type Tone = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'danger'

export const TYPE_LABELS: Record<TaskType, string> = {
  story: 'STORY', task: 'TASK', bug: 'BUG', spike: 'SPIKE', alert: 'ALERT', ticket: 'TICKET', incident: 'INCIDENT',
}

// Each source's colour, as whole class names so Tailwind sees them: `stripe` is
// a row's left edge, `text` its ref, `chip` the type chip.
export const SOURCE_COLOR: Record<QueueSource, { stripe: string; text: string; chip: string }> = {
  stories: { stripe: 'border-l-src-stories', text: 'text-src-stories', chip: 'border-src-stories/40 bg-src-stories/10 text-src-stories' },
  tasks: { stripe: 'border-l-src-tasks', text: 'text-src-tasks', chip: 'border-src-tasks/40 bg-src-tasks/10 text-src-tasks' },
  pulse: { stripe: 'border-l-src-pulse', text: 'text-src-pulse', chip: 'border-src-pulse/40 bg-src-pulse/10 text-src-pulse' },
  solarwinds: { stripe: 'border-l-src-solarwinds', text: 'text-src-solarwinds', chip: 'border-src-solarwinds/40 bg-src-solarwinds/10 text-src-solarwinds' },
  ads: { stripe: 'border-l-src-ads', text: 'text-src-ads', chip: 'border-src-ads/40 bg-src-ads/10 text-src-ads' },
  zendesk: { stripe: 'border-l-line-strong', text: 'text-dim', chip: '' },
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
