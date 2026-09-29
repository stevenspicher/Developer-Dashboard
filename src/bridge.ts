import type { Priority, QueueSource, Status, Task } from './types'

// ─── Config ───────────────────────────────────────────────────────────────────

const BRIDGE_BASE = '/bridge'
export const BRIDGE_REFRESH_MS = 60_000
export const CONTEXT_REFRESH_MS = 5 * 60_000
export const STALE_STANDUP_DAYS = 6
export const DEADLINE_TICKER_DAYS = 14
export const CALENDAR_LOOKAHEAD_DAYS = 42

// TEMP: developer switcher for testing per-developer queues.
export const TEST_DEVELOPERS = [
  { name: 'Steven Spicher', email: 'steven.spicher@bluefcu.com' },
  { name: 'Philip Fiesta', email: 'philip.fiesta@bluefcu.com' },
  { name: 'Justice', email: 'justice.dunn@bluefcu.com' },
  { name: 'Luiz Padredi', email: 'luiz.padredi@bluefcu.com' },
  { name: 'Brett Owers', email: 'brett.owers@bluefcu.com' },
  { name: 'Taylor Miller', email: 'taylor.miller@bluefcu.com' },
]
export const DEVELOPER_STORAGE_KEY = 'devDashboard.developer'

export function loadDeveloper() {
  try {
    const saved = localStorage.getItem(DEVELOPER_STORAGE_KEY)
    if (saved && TEST_DEVELOPERS.some(d => d.email === saved)) return saved
  } catch { /* storage unavailable */ }
  return TEST_DEVELOPERS[0].email
}

// Which lane (Todo/Working/Blocked) each item sits in, per developer, so the
// board survives reloads. Items absent from the map are in the queue.
const lanesKey = (developer: string) => `devDashboard.lanes.${developer}`

export function loadLanes(developer: string): Record<string, Status> {
  try {
    return JSON.parse(localStorage.getItem(lanesKey(developer)) || '{}')
  } catch {
    return {}
  }
}

export function updateLanes(developer: string, changes: Record<string, Status>) {
  const lanes = loadLanes(developer)
  for (const [id, lane] of Object.entries(changes)) {
    if (lane === 'queue') delete lanes[id]
    else lanes[id] = lane
  }
  try { localStorage.setItem(lanesKey(developer), JSON.stringify(lanes)) } catch { /* storage unavailable */ }
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface BridgeItem {
  id: string
  url: string | null
  title: string
  display: { name: string; value: string }[]
}

export interface Sprint {
  name: string
  number: number | null
  start: string | null
  end: string | null
}

export interface BriefLine {
  text: string
  mentions: string[]
}

export interface StandupBrief {
  date: string | null
  isToday: boolean
  mode: 'brief' | 'leadership' | 'none'
  title?: string
  teamItems: BriefLine[]
  responsibilities: BriefLine[]
  aging: BriefLine[]
  summaries: { developer: string; text: string }[]
}

export interface RelatedEntity {
  relation: string
  id: string | null
  url?: string | null
  title?: string
  properties?: { name: string; type: string; value: string }[]
  content?: string
  sub_pages?: { id: string; title: string }[]
  empty?: boolean
  error?: string
}

export interface Deadline {
  id: string
  title: string
  start: string
  end: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BRIDGE_BASE}${path}`, init)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Bridge unreachable (HTTP ${res.status})`)
  return body
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const dev = (developer: string) => `developer=${encodeURIComponent(developer)}`

export const fetchQueue = (slug: string, developer: string) =>
  request<{ items: BridgeItem[]; claimed: BridgeItem[] }>(`/queues/${slug}?${dev(developer)}`)

export const fetchCurrentSprint = () => request<Sprint>('/sprint/current')

export const fetchStandup = (developer: string) => request<StandupBrief>(`/standup/today?${dev(developer)}`)

export const fetchRelated = (id: string, queue: string) =>
  request<{ related: RelatedEntity[] }>(`/items/${id}/related?queue=${encodeURIComponent(queue)}`).then(b => b.related)

export async function fetchDeadlines(): Promise<Deadline[]> {
  const { items } = await request<{ items: BridgeItem[] }>('/databases/deadlines-milestones/query')
  return items
    .map(item => ({
      id: item.id,
      title: item.title,
      start: displayValue(item, 'Start Date').slice(0, 10),
      end: displayValue(item, 'End Date').slice(0, 10) || null,
    }))
    .filter(d => d.start)
}

export const claimItem = (id: string, queue: string, developer: string) =>
  post(`/items/${id}/claim`, { developer, queue, includeRelated: false })

export const releaseItem = (id: string, queue: string, developer: string) =>
  post(`/items/${id}/release`, { developer, queue })

export const markItemDone = (id: string, queue: string, developer: string) =>
  post(`/items/${id}/done`, { developer, queue })

// ─── Mapping bridge items to cards ────────────────────────────────────────────

export function displayValue(item: BridgeItem, name: string): string {
  return item.display.find(d => d.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function displayNumber(item: BridgeItem, name: string): number | undefined {
  const v = displayValue(item, name)
  return v === '' || isNaN(Number(v)) ? undefined : Number(v)
}

function shortRef(prefix: string, id: string) {
  return `${prefix}-${id.replace(/-/g, '').slice(-6).toUpperCase()}`
}

function initials(people: string) {
  const first = people.split(',')[0].trim()
  if (!first || /^[0-9a-f-]{32,36}$/i.test(first)) return first ? '?' : ''
  return first.split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

function sprintLabel(n: number | undefined) {
  return n === undefined ? undefined : `SPR-${n}`
}

function pulsePriority(itemSprint: number | undefined, currentSprint: number | null): Priority {
  if (itemSprint === undefined || currentSprint === null) return 'medium'
  const behind = currentSprint - itemSprint
  if (behind >= 2) return 'critical'
  if (behind === 1) return 'high'
  return 'medium'
}

function selectPriority(value: string): Priority {
  const p = value.toLowerCase()
  return p === 'critical' || p === 'high' || p === 'medium' || p === 'low' ? p : 'none'
}

function bridgeTask(item: BridgeItem, queue: string, fields: Pick<Task, 'ref' | 'type' | 'source' | 'priority'> & Partial<Task>): Task {
  return {
    id: item.id,
    queue,
    url: item.url ?? undefined,
    title: item.title,
    description: fields.notes ?? '',
    progress: 0,
    assignee: '',
    tags: [],
    status: 'queue',
    comments: 0,
    ...fields,
  }
}

export interface BridgeQueue {
  source: QueueSource
  slug: string
  claimable: boolean // drag out of the queue claims, drag back releases
  doneable: boolean  // shows the Mark done button
  toTask: (item: BridgeItem, currentSprint: number | null) => Task
}

export const BRIDGE_QUEUES: BridgeQueue[] = [
  {
    source: 'tasks',
    slug: 'sprint-developer-items',
    claimable: false,
    doneable: true,
    toTask: item => {
      const age = displayNumber(item, 'Standup Age (days)')
      return bridgeTask(item, 'sprint-developer-items', {
        ref: shortRef('DEV', item.id),
        type: 'task',
        source: 'tasks',
        priority: age !== undefined && age > STALE_STANDUP_DAYS ? 'high' : 'none',
        notes: displayValue(item, 'Notes'),
        assignee: initials(displayValue(item, 'Developer')),
        sprint: sprintLabel(displayNumber(item, 'Sprint')),
        standupAgeDays: age,
      })
    },
  },
  {
    source: 'pulse',
    slug: 'pulse-queue',
    claimable: true,
    doneable: true,
    toTask: (item, currentSprint) => {
      const sprint = displayNumber(item, 'Sprint')
      return bridgeTask(item, 'pulse-queue', {
        ref: shortRef('PULSE', item.id),
        type: 'alert',
        source: 'pulse',
        priority: pulsePriority(sprint, currentSprint),
        notes: displayValue(item, 'Description'),
        sprint: sprintLabel(sprint),
        link: displayValue(item, 'Link') || undefined,
      })
    },
  },
  {
    source: 'solarwinds',
    slug: 'solarwinds',
    claimable: false,
    doneable: false,
    toTask: item => {
      const number = displayValue(item, 'Number')
      return bridgeTask(item, 'solarwinds', {
        ref: number ? `SW-${number}` : shortRef('SW', item.id),
        type: 'ticket',
        source: 'solarwinds',
        priority: selectPriority(displayValue(item, 'Priority')),
        notes: displayValue(item, 'Description'),
        affectedSystem: displayValue(item, 'State') || undefined,
        link: displayValue(item, 'Link') || undefined,
      })
    },
  },
]

export const bridgeQueueFor = (task: Task) => BRIDGE_QUEUES.find(q => q.slug === task.queue)

// ─── Dates ────────────────────────────────────────────────────────────────────

export function localIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localIsoDate(d)
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86_400_000)
}

export function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

export function formatSprintRange(s: Sprint) {
  return s.start && s.end ? `${shortDate(s.start)} – ${shortDate(s.end)}` : ''
}

// "starts in 5d" / "ends in 3d" / "today" for deadlines within `withinDays`.
export function deadlineTickerText(d: Deadline, today: string, withinDays: number): string | null {
  const end = d.end ?? d.start
  if (end < today) return null
  if (d.start > today) {
    const n = daysBetween(today, d.start)
    return n <= withinDays ? `${d.title} · starts in ${n}d` : null
  }
  if (d.end && d.end > today) {
    const n = daysBetween(today, d.end)
    return n <= withinDays ? `${d.title} · ends in ${n}d` : null
  }
  return `${d.title} · today`
}
