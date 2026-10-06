import type { BriefLine, Deadline, Sprint } from './bridge'
import { addDays } from './bridge'
import { overlap, words } from './plan'

// ─── Coming up ────────────────────────────────────────────────────────────────
// One dated list from the Deadlines and Milestones calendar, the sprint end,
// and dates mentioned in the standup's team items ("Code Jam at HQ on Oct. 8").

export interface DayEvent {
  date: string
  end?: string
  label: string
  kind: 'deadline' | 'sprint' | 'team'
  detail?: string            // the team item a date was read from
}

export const COMING_UP_DAYS = 21
const KIND_ORDER = { deadline: 0, sprint: 1, team: 2 }
const SAME_EVENT_AT = 0.5

export function comingUp({ deadlines, sprint, teamItems, today, days = COMING_UP_DAYS }: {
  deadlines: Deadline[]
  sprint: Sprint | null
  teamItems: BriefLine[]
  today: string
  days?: number
}): DayEvent[] {
  const until = addDays(today, days)
  const events: DayEvent[] = []
  for (const d of deadlines) {
    const end = d.end ?? d.start
    if (end < today || d.start > until) continue
    // Something already under way is listed on the day it ends.
    if (d.start >= today) events.push({ date: d.start, end: d.end && d.end !== d.start ? d.end : undefined, label: d.title, kind: 'deadline' })
    else events.push({ date: end, label: `${d.title} ends`, kind: 'deadline' })
  }
  if (sprint?.end && sprint.end >= today && sprint.end <= until) {
    events.push({ date: sprint.end, label: `${sprint.name} ends`, kind: 'sprint' })
  }
  for (const e of teamDates(teamItems, today)) {
    if ((e.end ?? e.date) < today || e.date > until) continue
    const known = events.some(x => x.date === e.date && overlap(words(x.label), words(e.label)).score >= SAME_EVENT_AT)
    if (!known) events.push(e)
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

// ─── Dates in free text ───────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DATE_PHRASE = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[–-]\s*(\d{1,2})(?:st|nd|rd|th)?)?\b/g
// Sentences, then clauses joined by commas, semicolons or "so"/"before"/"after".
const CLAUSE_BREAK = /(?<=[.!?])\s+(?=[A-Z])|;\s+|,\s+(?:and\s+)?|\s+(?:so|before|after|while|but)\s+/
const LEADING_FILLER = /^(?:(?:and|but|so|then|the|a|an|is|are|on|by|with|only|also)\s+)+/i
const TRAILING_FILLER = /(?:\s+(?:on|by|at|from|until|around|beginning|starting|due|for|the|is|are|of|in|to))+$/i
const MAX_LABEL = 70

// "Oct. 13" → the date in the year that keeps it within ~6 months of today.
function isoFor(month: number, day: number, today: string) {
  const year = Number(today.slice(0, 4))
  const iso = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const candidate = iso(year)
  if (candidate < addDays(today, -183)) return iso(year + 1)
  if (candidate > addDays(today, 183)) return iso(year - 1)
  return candidate
}

// The clause around a date, without the date: "Code Jam at HQ on Oct. 8" → "Code Jam at HQ".
function labelFor(clause: string, phrase: string) {
  let label = clause.replace(phrase, ' ').replace(/^[^:]{0,40}:\s*/, '').replace(/\s+/g, ' ').trim()
  for (let prev = ''; prev !== label;) {
    prev = label
    label = label.replace(LEADING_FILLER, '').replace(TRAILING_FILLER, '').replace(/[\s.,;:]+$/, '').trim()
  }
  if (label.length < 3) label = clause.trim().replace(/[.;,]+$/, '')
  label = label.charAt(0).toUpperCase() + label.slice(1)
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

export function teamDates(lines: BriefLine[], today: string): DayEvent[] {
  const events: DayEvent[] = []
  for (const line of lines) {
    for (const clause of line.text.split(CLAUSE_BREAK)) {
      for (const m of clause.matchAll(DATE_PHRASE)) {
        const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
        const date = isoFor(month, Number(m[2]), today)
        const end = m[3] ? isoFor(month, Number(m[3]), today) : undefined
        events.push({ date, end, label: labelFor(clause, m[0]), kind: 'team', detail: line.text })
      }
    }
  }
  return events
}

// ─── Day arithmetic ───────────────────────────────────────────────────────────

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00`).getDay()

// Weekdays after `today`, up to and including `end`.
export function workingDaysAfter(today: string, end: string) {
  let n = 0
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
    const day = weekdayOf(d)
    if (day !== 0 && day !== 6) n++
  }
  return n
}

// "Today", "Tomorrow", "Thu 8", or "Mon Nov 2" in another month.
export function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  const d = new Date(`${iso}T00:00:00`)
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' })
  return iso.slice(0, 7) === today.slice(0, 7)
    ? `${wd} ${d.getDate()}`
    : `${wd} ${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`
}

export function longDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export const monthDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const weekdayShort = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
