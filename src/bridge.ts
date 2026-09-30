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

// Which lane each item sits in, per developer, so the board survives reloads.
// A saved 'queue' records an explicit move back to the queue (it overrides a
// source's own lane hint); `null` forgets the item.
const lanesKey = (developer: string) => `devDashboard.lanes.${developer}`

export function loadLanes(developer: string): Record<string, Status> {
  try {
    return JSON.parse(localStorage.getItem(lanesKey(developer)) || '{}')
  } catch {
    return {}
  }
}

export function updateLanes(developer: string, changes: Record<string, Status | null>) {
  const lanes = loadLanes(developer)
  for (const [id, lane] of Object.entries(changes)) {
    if (lane === null) delete lanes[id]
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

async function request<T>(path: string, init?: RequestInit, base = BRIDGE_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, init)
  const body = await res.json().catch(() => null)
  // notion-bridge errors are { error }, ado-bridge (FastAPI) errors are { detail }.
  const message = body?.error || (typeof body?.detail === 'string' ? body.detail : null)
  if (!res.ok) throw new Error(message || `Bridge unreachable (HTTP ${res.status})`)
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

// ─── ADO bridge (User Stories) ────────────────────────────────────────────────

const ADO_BASE = '/ado'
const ADO_ITERATION_TEMPLATE = 'Blue Digital\\Sprint {number} {year}'
const ADO_QUEUE_SLUG = 'ado-stories'
const ADO_DONE_STATE = 'Closed'
const ADO_LANE_STATES: Partial<Record<Status, string>> = { today: 'Active', working: 'Active', blocked: 'Blocked' }

interface AdoWorkItem {
  adoId: number
  title: string
  state: string | null
  workItemType: string
  assignedTo: string | null
  assignedToName: string | null
  description: string | null
  acceptanceCriteria: string | null
  storyPoints: number | null
  priority: number | null
  tags: string[]
  iterationPath: string | null
  parentId: number | null
  url: string | null
}

const adoGet = <T>(path: string) => request<T>(path, undefined, ADO_BASE)
const adoPut = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ADO_BASE)

const setAdoState = (adoId: string, state: string) => adoPut(`/workitems/${adoId}/state`, { state })

function iterationFor(sprint: Sprint | null): string {
  if (sprint?.number == null || !sprint.start) throw new Error('Current sprint unknown; cannot pick the ADO iteration')
  return ADO_ITERATION_TEMPLATE.replace('{number}', String(sprint.number)).replace('{year}', sprint.start.slice(0, 4))
}

function htmlToText(html: string | null): string {
  if (!html) return ''
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+\n/g, '\n').trim()
}

// ADO acceptance criteria are HTML: prefer list items / paragraphs as lines.
function htmlToLines(html: string | null): string[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = [...doc.querySelectorAll('li, p')].map(el => el.textContent?.trim() ?? '').filter(Boolean)
  return blocks.length ? blocks : htmlToText(html).split('\n').map(l => l.trim()).filter(Boolean)
}

function adoPriority(p: number | null): Priority {
  if (p === 1) return 'high'
  if (p === 2) return 'medium'
  if (p != null && p >= 3) return 'low'
  return 'none'
}

function adoStoryToTask(w: AdoWorkItem): Task {
  const sprintNumber = w.iterationPath?.match(/Sprint (\d+)/)?.[1]
  const description = htmlToText(w.description)
  return {
    id: String(w.adoId),
    ref: `US-${w.adoId}`,
    queue: ADO_QUEUE_SLUG,
    url: w.url ?? undefined,
    type: w.workItemType === 'Bug' ? 'bug' : 'story',
    source: 'stories',
    title: w.title,
    description,
    notes: description,
    acceptanceCriteria: htmlToLines(w.acceptanceCriteria),
    priority: adoPriority(w.priority),
    points: w.storyPoints ?? undefined,
    progress: 0,
    assignee: initials(w.assignedToName ?? ''),
    sprint: sprintNumber ? `SPR-${sprintNumber}` : undefined,
    tags: w.tags,
    status: 'queue',
    comments: 0,
    externalState: w.state ?? undefined,
    affectedSystem: w.state ?? undefined,
    parentId: w.parentId != null ? String(w.parentId) : undefined,
  }
}

function adoStoriesQueue(): QueueAdapter {
  return {
    source: 'stories',
    slug: ADO_QUEUE_SLUG,
    load: async (developer, sprint) => {
      const params = new URLSearchParams({ assignedTo: developer, iteration: iterationFor(sprint) })
      const stories = await adoGet<AdoWorkItem[]>(`/workitems?${params}`)
      const lanes: Record<string, Status> = {}
      for (const s of stories) {
        if (s.state === 'Active') lanes[String(s.adoId)] = 'today'
        else if (s.state === 'Blocked') lanes[String(s.adoId)] = 'blocked'
      }
      return { items: stories.map(adoStoryToTask), claimedIds: [], lanes }
    },
    move: async (task, _from, to) => {
      const state = ADO_LANE_STATES[to]
      if (!state || state === task.externalState) return
      await setAdoState(task.id, state)
      return { externalState: state, affectedSystem: state }
    },
    done: task => setAdoState(task.id, ADO_DONE_STATE).then(() => undefined),
    related: async task => {
      if (!task.parentId) return [{ relation: 'parent', id: null, empty: true }]
      try {
        const p = await adoGet<AdoWorkItem>(`/workitems/${task.parentId}`)
        return [{
          relation: 'parent',
          id: String(p.adoId),
          url: p.url,
          title: p.title,
          properties: [
            { name: 'Type', type: 'text', value: p.workItemType },
            { name: 'State', type: 'text', value: p.state ?? '' },
            { name: 'Assigned To', type: 'text', value: p.assignedToName ?? p.assignedTo ?? '' },
            { name: 'Iteration', type: 'text', value: p.iterationPath ?? '' },
          ],
          content: htmlToText(p.description),
        }]
      } catch (e) {
        return [{ relation: 'parent', id: task.parentId, error: e instanceof Error ? e.message : String(e) }]
      }
    },
  }
}

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

// A queue source the board knows how to load and act on. Notion queues go
// through notion-bridge; User Stories go through ado-bridge.
export interface QueueAdapter {
  source: QueueSource
  slug: string
  // Cards for the developer; claimedIds default to Todo when no lane is saved,
  // and `lanes` lets a source place cards from its own state (e.g. ADO Blocked).
  load: (developer: string, sprint: Sprint | null) => Promise<{ items: Task[]; claimedIds: string[]; lanes?: Record<string, Status> }>
  // Returns fields to merge into the card after a successful write.
  move?: (task: Task, from: Status, to: Status, developer: string) => Promise<Partial<Task> | void>
  done?: (task: Task, developer: string) => Promise<void>
  related?: (task: Task) => Promise<RelatedEntity[]>
}

function notionQueue({ source, slug, claimable, doneable, toTask }: {
  source: QueueSource
  slug: string
  claimable: boolean // drag out of the queue claims, drag back releases
  doneable: boolean
  toTask: (item: BridgeItem, currentSprint: number | null) => Task
}): QueueAdapter {
  return {
    source,
    slug,
    load: async (developer, sprint) => {
      const { items, claimed } = await fetchQueue(slug, developer)
      const seen = new Set<string>()
      const all = [...items, ...claimed].filter(i => !seen.has(i.id) && seen.add(i.id))
      return { items: all.map(i => toTask(i, sprint?.number ?? null)), claimedIds: claimed.map(i => i.id) }
    },
    move: claimable
      ? async (task, from, to, developer) => {
        if (from === 'queue' && to !== 'queue') await claimItem(task.id, slug, developer)
        else if (from !== 'queue' && to === 'queue') await releaseItem(task.id, slug, developer)
      }
      : undefined,
    done: doneable ? (task, developer) => markItemDone(task.id, slug, developer).then(() => undefined) : undefined,
    related: task => fetchRelated(task.id, slug),
  }
}

// ADO User Stories stay off while ado-bridge serves mock data (ADO_MOCK=true).
// Start the dev server with VITE_ADO_STORIES=true to turn them back on.
export const ADO_STORIES_ENABLED = import.meta.env.VITE_ADO_STORIES === 'true'

export const QUEUES: QueueAdapter[] = [
  ...(ADO_STORIES_ENABLED ? [adoStoriesQueue()] : []),
  notionQueue({
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
  }),
  notionQueue({
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
  }),
  notionQueue({
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
  }),
]

export const queueFor = (task: Task) => QUEUES.find(q => q.slug === task.queue)

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
