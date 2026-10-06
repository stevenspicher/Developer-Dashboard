import type { Sprint } from '../../bridge'
import { daysBetween } from '../../bridge'
import { weekdayShort, workingDaysAfter } from '../../schedule'

// "Sprint 20 · day 4 of 10 · ends Tue · 3 working days after today"
export function sprintLine(sprint: Sprint | null, today: string): string {
  if (!sprint) return 'Sprint not loaded'
  const length = sprint.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : null
  const day = sprint.start && length ? Math.min(length, Math.max(1, daysBetween(sprint.start, today) + 1)) : null
  const left = sprint.end && sprint.end >= today ? workingDaysAfter(today, sprint.end) : null
  return [
    sprint.name,
    day && length && `day ${day} of ${length}`,
    sprint.end && `ends ${weekdayShort(sprint.end)}`,
    left !== null && `${left} working ${left === 1 ? 'day' : 'days'} after today`,
  ].filter(Boolean).join(' · ')
}
