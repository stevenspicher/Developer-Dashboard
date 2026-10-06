import type { QueueSource, Task } from './types'
import { daysBetween } from './bridge'
import type { StandupBrief } from './bridge'

// ─── The day's plan ───────────────────────────────────────────────────────────
// A checklist built from the standup's responsibilities plus anything the
// developer adds. Unfinished entries carry over to the next day. An entry can
// be linked to a board item, so starting or ticking it acts on that item.
// Stored per developer in localStorage.

export interface PlanEntry {
  id: string
  text: string
  origin: 'standup' | 'added'
  addedOn: string            // day the entry first appeared (YYYY-MM-DD)
  briefDate?: string         // standup the line came from
  mentions?: string[]        // Notion pages @mentioned in the standup line
  itemId?: string            // linked board item
  itemRef?: string           // its ref and source, kept for when it leaves the board
  itemSource?: QueueSource
  linkedBy?: 'mention' | 'ref' | 'match' | 'you'
  rejected?: string[]        // suggested items the developer turned down
  done?: boolean
  doneAt?: string            // set once the done write has gone through
  missing?: boolean          // the linked item left the board without being done
}

// What was finished on an earlier day, kept for a week so the standup draft
// can say what got done.
export interface DoneRecord {
  day: string
  text: string
  ref?: string
}

export interface Plan {
  day: string
  entries: PlanEntry[]
  mergedBriefs: string[]     // standup dates already turned into entries
  doneLog?: DoneRecord[]
}

const DONE_LOG_DAYS = 7
const DONE_LOG_MAX = 60

const planKey = (developer: string) => `devDashboard.plan.${developer}`

export function loadPlan(developer: string, today: string): Plan {
  try {
    const saved = JSON.parse(localStorage.getItem(planKey(developer)) || 'null')
    if (saved && Array.isArray(saved.entries)) {
      // Entry ids key the rows, so keep only the first of any repeated id.
      const seen = new Set<string>()
      const entries = (saved.entries as PlanEntry[]).filter(e => !seen.has(e.id) && seen.add(e.id))
      return rollover({ ...saved, entries }, today)
    }
  } catch { /* storage unavailable or corrupt */ }
  return { day: today, entries: [], mergedBriefs: [] }
}

export function savePlan(developer: string, plan: Plan) {
  try { localStorage.setItem(planKey(developer), JSON.stringify(plan)) } catch { /* storage unavailable */ }
}

// A new day drops finished entries (noting them in the done log); unfinished
// ones carry over.
export function rollover(plan: Plan, today: string): Plan {
  if (plan.day === today) return plan
  const finished = plan.entries.filter(e => e.done).map(e => ({ day: plan.day, text: e.text, ref: e.itemRef }))
  const doneLog = [...(plan.doneLog ?? []), ...finished]
    .filter(r => daysBetween(r.day, today) <= DONE_LOG_DAYS)
    .slice(-DONE_LOG_MAX)
  return { day: today, entries: plan.entries.filter(e => !e.done), mergedBriefs: plan.mergedBriefs.slice(-14), doneLog }
}

// What's been finished: the most recent earlier day that had anything done
// (yesterday, or Friday on a Monday), then whatever is ticked off today.
export function recentlyDone(plan: Plan): DoneRecord[] {
  const log = (plan.doneLog ?? []).filter(r => r.day < plan.day)
  const lastDay = log.reduce((latest, r) => (r.day > latest ? r.day : latest), '')
  const today = plan.entries.filter(e => e.done).map(e => ({ day: plan.day, text: e.text, ref: e.itemRef }))
  return [...log.filter(r => r.day === lastDay), ...today]
}

// Adds a standup's responsibilities once per standup date, at the top in the
// brief's order. A responsibility repeated from an earlier standup refreshes
// that entry instead of adding a second one.
export function mergeBrief(plan: Plan, brief: StandupBrief | null): Plan {
  if (!brief || brief.mode !== 'brief' || !brief.date || plan.mergedBriefs.includes(brief.date)) return plan
  const date = brief.date
  const entries = [...plan.entries]
  const fresh: PlanEntry[] = []
  brief.responsibilities.forEach((line, i) => {
    if (!line.text) return
    const update = { text: line.text, briefDate: date, mentions: line.mentions, addedOn: plan.day }
    const lineWords = words(line.text)
    const repeat = entries.findIndex(e =>
      e.origin === 'standup' && !e.done && e.briefDate !== date && isRepeat(overlap(words(e.text), lineWords)))
    if (repeat >= 0) entries[repeat] = { ...entries[repeat], ...update }
    else fresh.push({ id: `standup:${date}:${i}`, origin: 'standup', ...update })
  })
  return { ...plan, entries: [...fresh, ...entries], mergedBriefs: [...plan.mergedBriefs, date].slice(-14) }
}

export function addItem(plan: Plan, task: Task): Plan {
  if (plan.entries.some(e => e.itemId === task.id && !e.done)) return plan
  // An item reopened after being done today gets a second entry.
  let id = `item:${task.id}:${plan.day}`
  for (let n = 2; plan.entries.some(e => e.id === id); n++) id = `item:${task.id}:${plan.day}:${n}`
  const entry: PlanEntry = {
    id,
    text: task.title,
    origin: 'added',
    addedOn: plan.day,
    ...linkTo(task),
    linkedBy: 'you',
  }
  return { ...plan, entries: [...plan.entries, entry] }
}

export const linkTo = (task: Task) => ({ itemId: task.id, itemRef: task.ref, itemSource: task.source })

// Items any entry points at, done or not, so they stay out of "Up next" today.
export const plannedIds = (plan: Plan) => new Set(plan.entries.flatMap(e => (e.itemId ? [e.itemId] : [])))

// Applies a change to every entry linked to an item.
export function updateItemEntries(plan: Plan, itemId: string, change: Partial<PlanEntry>): Plan {
  if (!plan.entries.some(e => e.itemId === itemId)) return plan
  return { ...plan, entries: plan.entries.map(e => (e.itemId === itemId ? { ...e, ...change } : e)) }
}

export function updateEntry(plan: Plan, id: string, change: Partial<PlanEntry> | ((e: PlanEntry) => Partial<PlanEntry>)): Plan {
  return {
    ...plan,
    entries: plan.entries.map(e => (e.id === id ? { ...e, ...(typeof change === 'function' ? change(e) : change) } : e)),
  }
}

export function removeEntry(plan: Plan, id: string): Plan {
  return { ...plan, entries: plan.entries.filter(e => e.id !== id) }
}

// Undoes addItem: drops the entry added for an item (standup entries stay).
export function removeAddedEntry(plan: Plan, itemId: string): Plan {
  return { ...plan, entries: plan.entries.filter(e => !(e.origin === 'added' && e.itemId === itemId && !e.done)) }
}

// Moves an entry before another one (or to the end when `beforeId` is null).
export function reorder(plan: Plan, id: string, beforeId: string | null): Plan {
  const moving = plan.entries.find(e => e.id === id)
  if (!moving || id === beforeId) return plan
  const rest = plan.entries.filter(e => e.id !== id)
  const at = beforeId ? rest.findIndex(e => e.id === beforeId) : -1
  return { ...plan, entries: at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)] }
}

export function shift(plan: Plan, id: string, delta: number): Plan {
  const i = plan.entries.findIndex(e => e.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= plan.entries.length) return plan
  const entries = [...plan.entries]
  ;[entries[i], entries[j]] = [entries[j], entries[i]]
  return { ...plan, entries }
}

// ─── Linking entries to board items ───────────────────────────────────────────

// An @mention or an ADO number links exactly. Otherwise a title match links
// when it's clearly the best one, and a weaker match is only suggested.
const LINK_AT = 0.6
const SUGGEST_AT = 0.4
const LINK_MARGIN = 0.1
const DUPLICATE_AT = 0.8

// `#` isn't a word character, so a `\b` in front of it never matches after a space.
const ADO_REF = /(?<![\w&])(?:US-?|#)(\d{4,6})\b/gi
const adoRefs = (text: string) => [...text.matchAll(ADO_REF)].map(m => m[1])

// Links every unlinked entry it can. Returns the same plan when nothing changed.
export function linkEntries(plan: Plan, tasks: Task[]): Plan {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const taken = new Set(plan.entries.flatMap(e => (e.itemId ? [e.itemId] : [])))
  const links = new Map<string, Partial<PlanEntry>>()
  const link = (entry: PlanEntry, task: Task, linkedBy: PlanEntry['linkedBy']) => {
    links.set(entry.id, { ...linkTo(task), linkedBy })
    taken.add(task.id)
  }
  const open = plan.entries.filter(e => !e.itemId && !e.done)

  for (const entry of open) {
    const mention = entry.mentions?.find(id => byId.has(id) && !taken.has(id))
    const ref = mention ? undefined : adoRefs(entry.text).find(id => byId.has(id) && !taken.has(id))
    if (mention) link(entry, byId.get(mention)!, 'mention')
    else if (ref) link(entry, byId.get(ref)!, 'ref')
  }

  // Best pairs first, so each item is linked to the entry it fits best.
  const pairs: { entry: PlanEntry; task: Task; score: number }[] = []
  for (const entry of open) {
    if (links.has(entry.id)) continue
    const [best, second] = rankByTitle(entry.text, tasks.filter(t => !taken.has(t.id) && !entry.rejected?.includes(t.id)))
    if (best && best.score >= LINK_AT && best.shared >= 3 && best.score - (second?.score ?? 0) >= LINK_MARGIN) {
      pairs.push({ entry, task: best.task, score: best.score })
    }
  }
  for (const { entry, task } of pairs.sort((a, b) => b.score - a.score)) {
    if (!taken.has(task.id)) link(entry, task, 'match')
  }

  if (links.size === 0) return plan
  return { ...plan, entries: plan.entries.map(e => (links.has(e.id) ? { ...e, ...links.get(e.id) } : e)) }
}

// A likely item for each entry that's still unlinked, for the developer to confirm.
export function suggestLinks(plan: Plan, tasks: Task[]): Map<string, Task> {
  const taken = new Set(plan.entries.flatMap(e => (e.itemId ? [e.itemId] : [])))
  const free = tasks.filter(t => !taken.has(t.id))
  const suggestions = new Map<string, Task>()
  for (const entry of plan.entries) {
    if (entry.itemId || entry.done) continue
    const [best] = rankByTitle(entry.text, free.filter(t => !entry.rejected?.includes(t.id)))
    if (best && best.score >= SUGGEST_AT && best.shared >= 2) suggestions.set(entry.id, best.task)
  }
  return suggestions
}

// Items whose titles say the same thing, e.g. one task entered twice.
export function findDuplicates(tasks: Task[]): Map<string, Task> {
  const duplicates = new Map<string, Task>()
  const titled = tasks.map(t => ({ task: t, words: words(t.title) }))
  titled.forEach((a, i) => {
    for (const b of titled.slice(i + 1)) {
      const o = overlap(a.words, b.words)
      if (o.score >= DUPLICATE_AT && o.shared >= 3) {
        if (!duplicates.has(a.task.id)) duplicates.set(a.task.id, b.task)
        if (!duplicates.has(b.task.id)) duplicates.set(b.task.id, a.task)
      }
    }
  })
  return duplicates
}

// The brief's aging lines end with "— active since Aug. 31." or similar; the
// last em or en dash separates the item's title from that note.
export function agingLabel(line: string): { title: string; since: string } {
  const cut = Math.max(line.lastIndexOf(' — '), line.lastIndexOf(' – '))
  const since = (cut >= 0 ? line.slice(cut) : '').match(/since\s+([A-Z][a-z]{2,8})\.?\s+(\d{1,2})/)
  return { title: cut >= 0 ? line.slice(0, cut) : line, since: since ? `${since[1]} ${since[2]}` : '' }
}

// The item an aging line refers to, if one matches well enough.
export function matchLine(text: string, tasks: Task[]): Task | undefined {
  const [best, second] = rankByTitle(text, tasks)
  return best && best.score >= LINK_AT && best.shared >= 3 && best.score - (second?.score ?? 0) >= LINK_MARGIN
    ? best.task
    : undefined
}

// ─── Title similarity ─────────────────────────────────────────────────────────

const STOP = new Set((
  'a an and are as at be by can for from in into is it its need needed of on one or our existing ' +
  'remaining so that the their them they this to with your'
).split(' '))

function stem(word: string) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function words(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) ?? []) {
    if (!STOP.has(word)) out.add(stem(word))
  }
  return out
}

// How many words two texts share, and that count over the shorter text's words
// (1 when one is contained in the other).
export function overlap(a: Set<string>, b: Set<string>) {
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return { shared, score: a.size && b.size ? shared / Math.min(a.size, b.size) : 0 }
}

const isRepeat = (o: { shared: number; score: number }) => o.score >= LINK_AT && o.shared >= 3

export function rankByTitle(text: string, tasks: Task[]) {
  const textWords = words(text)
  return tasks
    .map(task => ({ task, ...overlap(textWords, words(task.title)) }))
    .filter(r => r.shared > 0)
    .sort((a, b) => b.score - a.score || b.shared - a.shared)
}
