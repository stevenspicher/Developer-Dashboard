import type { Task } from './types'

// ─── Acceptance-criteria ticks ────────────────────────────────────────────────

// Which acceptance criteria a developer has ticked, per item. Kept in this
// browser only (nothing is written back to ADO) and dropped when the item
// closes. Criteria are stored by their text, so reordering or editing the list
// in ADO doesn't tick the wrong line.
export type Ticks = Record<string, string[]>

const ticksKey = (developer: string) => `devDashboard.criteria.${developer}`

export function loadTicks(developer: string): Ticks {
  try {
    const raw = JSON.parse(localStorage.getItem(ticksKey(developer)) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

export function saveTicks(developer: string, ticks: Ticks) {
  try {
    localStorage.setItem(ticksKey(developer), JSON.stringify(ticks))
  } catch { /* storage unavailable */ }
}

export const isTicked = (ticks: Ticks, taskId: string, text: string) => ticks[taskId]?.includes(text) ?? false

export function toggleTick(ticks: Ticks, taskId: string, text: string): Ticks {
  const current = ticks[taskId] ?? []
  const next = current.includes(text) ? current.filter(t => t !== text) : [...current, text]
  const { [taskId]: _dropped, ...rest } = ticks
  return next.length > 0 ? { ...rest, [taskId]: next } : rest
}

// Forgets the ticks of closed items. Returns the same object when there was
// nothing to forget, so callers can skip a re-render and a save.
export function clearTicks(ticks: Ticks, taskIds: Iterable<string>): Ticks {
  const gone = [...taskIds].filter(id => id in ticks)
  if (gone.length === 0) return ticks
  const next = { ...ticks }
  for (const id of gone) delete next[id]
  return next
}

export const tickedCount = (ticks: Ticks, task: Task) =>
  (task.acceptanceCriteria ?? []).filter(text => isTicked(ticks, task.id, text)).length

// ─── Related items across sources ─────────────────────────────────────────────

// Refs as the dashboard shows them: US-12345, BLUEADS-222, SW-4021, DEV-A1B2C3.
const REF_TOKEN = /\b[A-Z][A-Z0-9]*-[0-9A-Z]{2,}\b/g
// ADO's own way to mention a work item.
const ADO_MENTION = /(?:^|[^\w&])#(\d{4,6})\b/g

export function refsIn(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(REF_TOKEN)) found.add(m[0].toUpperCase())
  for (const m of text.matchAll(ADO_MENTION)) found.add(`US-${m[1]}`)
  return [...found]
}

const textOf = (task: Task) => [task.title, task.description, task.notes ?? '', ...(task.acceptanceCriteria ?? [])].join('\n')

const MAX_CROSS_REFS = 5

export interface CrossRefs {
  mentions: Task[]
  mentionedBy: Task[]
}

// Other loaded items this one names by ref, and loaded items that name this
// one. Matching is on the ref text only, so a story and its ADS ticket link up
// when someone wrote one ref in the other.
export function crossRefs(task: Task, tasks: Task[]): CrossRefs {
  const others = tasks.filter(t => t.id !== task.id && t.ref)
  const byRef = new Map(others.map(t => [t.ref!.toUpperCase(), t]))
  const mentions = refsIn(textOf(task)).flatMap(ref => byRef.get(ref) ?? [])
  const mine = task.ref?.toUpperCase()
  const mentionedBy = mine ? others.filter(t => refsIn(textOf(t)).includes(mine)) : []
  return { mentions: mentions.slice(0, MAX_CROSS_REFS), mentionedBy: mentionedBy.slice(0, MAX_CROSS_REFS) }
}
