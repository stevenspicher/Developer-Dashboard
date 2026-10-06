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

// Writes use keepalive so one flushed while the page unloads still reaches the
// bridge (see the deferred "done" in App).
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })

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

// Whether a Notion page is finished: Status or State is Done/Resolved/Closed,
// or a Mark Done checkbox is ticked. Used when a planned item leaves the board.
export async function fetchPageDone(id: string): Promise<boolean> {
  const page = await request<{ properties?: { name: string; value: string }[] }>(`/pages/${id}`)
  return (page.properties ?? []).some(p =>
    ((p.name === 'Status' || p.name === 'State') && /^(done|resolved|closed)$/i.test(p.value)) ||
    (p.name === 'Mark Done' && p.value.startsWith('✓')))
}

// ─── ADO bridge (User Stories) ────────────────────────────────────────────────

const ADO_BASE = '/ado'
const ADO_ITERATION_TEMPLATE = 'Blue Digital\\Sprint {number} {year}'
const ADO_QUEUE_SLUG = 'ado-stories'
const ADO_DONE_STATE = 'Closed'
const ADO_CLOSED_STATES = new Set(['Closed', 'Removed']) // hidden from the board, as in ado-bridge
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
  request<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }, ADO_BASE)

const setAdoState = (adoId: string, state: string) => adoPut(`/workitems/${adoId}/state`, { state })

function iterationFor(sprint: Sprint | null): string {
  if (sprint?.number == null || !sprint.start) throw new Error('Current sprint unknown; cannot pick the ADO iteration')
  return ADO_ITERATION_TEMPLATE.replace('{number}', String(sprint.number)).replace('{year}', sprint.start.slice(0, 4))
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGURE', 'FOOTER', 'FORM',
  'HEADER', 'HR', 'MAIN', 'NAV', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TR',
])
const LINKABLE = /^(?:https?:|mailto:)/i

// ADO rich text → text that keeps its structure for RichText: a line break per
// block, blank lines between paragraphs, "• " / "1. " list items (indented
// when nested) and links as [label](url). Bold, italics and colours are dropped.
function htmlToText(html: string | null): string {
  if (!html) return ''
  let out = ''
  const afterMarker = () => /(?:^|\n) *(?:•|\d+\.) $/.test(out)
  const newline = () => { if (out && !out.endsWith('\n') && !afterMarker()) out += '\n' }
  const blankLine = () => { newline(); if (out && !out.endsWith('\n\n') && !afterMarker()) out += '\n' }

  const walk = (node: Node, depth: number, pre: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        let text = (child.textContent ?? '').replace(/ /g, ' ')
        if (!pre) {
          text = text.replace(/\s+/g, ' ')
          if (out === '' || /\s$/.test(out)) text = text.trimStart()
        }
        out += text
        continue
      }
      if (!(child instanceof Element)) continue
      const tag = child.tagName
      if (tag === 'BR') {
        out = out.replace(/ +$/, '') + '\n'
      } else if (tag === 'A' && LINKABLE.test(child.getAttribute('href') ?? '')) {
        // Encode ")" and spaces so the URL survives the [label](url) syntax.
        const href = child.getAttribute('href')!.trim().replace(/\)/g, '%29').replace(/\s/g, '%20')
        const label = (child.textContent ?? '').replace(/\s+/g, ' ').trim()
        out += !label || label === href ? href : `[${label.replace(/[[\]]/g, '')}](${href})`
      } else if (tag === 'IMG') {
        const src = child.getAttribute('src') ?? ''
        if (LINKABLE.test(src)) out += `[image](${src})`
      } else if (tag === 'UL' || tag === 'OL') {
        newline(); walk(child, depth + 1, pre); newline()
      } else if (tag === 'LI') {
        newline()
        const list = child.parentElement
        const marker = list?.tagName === 'OL'
          ? `${Array.from(list.children).filter(c => c.tagName === 'LI').indexOf(child) + 1}. `
          : '• '
        out += '  '.repeat(Math.max(0, depth - 1)) + marker
        walk(child, depth, pre)
        newline()
      } else if (tag === 'P' || /^H[1-6]$/.test(tag)) {
        const gap = child.closest('li') ? newline : blankLine
        gap(); walk(child, depth, pre); gap()
      } else if (tag === 'PRE') {
        newline(); walk(child, depth, true); newline()
      } else if (tag === 'TD' || tag === 'TH') {
        if (child.previousElementSibling) out += ' · '
        walk(child, depth, pre)
      } else if (tag === 'SCRIPT' || tag === 'STYLE') {
        continue
      } else if (BLOCK_TAGS.has(tag)) {
        newline(); walk(child, depth, pre); newline()
      } else {
        walk(child, depth, pre)
      }
    }
  }

  walk(new DOMParser().parseFromString(html, 'text/html').body, 0, false)
  return out
    .split('\n').map(line => line.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd()
}

// ADO acceptance criteria are HTML: one line per list item or paragraph.
function htmlToLines(html: string | null): string[] {
  return htmlToText(html)
    .split('\n')
    .map(line => line.replace(/^\s*(?:•|\d+\.)\s+/, '').trim())
    .filter(Boolean)
}

const LINK_MARKUP = /\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^\s)]+\)/g

// Text for previews: link labels without their URLs.
export const stripLinks = (text: string) => text.replace(LINK_MARKUP, '$1')

// Single-line preview text: links stripped and whitespace collapsed.
export const plainText = (text: string) => stripLinks(text).replace(/\s+/g, ' ').trim()

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
    priorityLabel: w.priority != null ? `P${w.priority}` : undefined,
    points: w.storyPoints ?? undefined,
    assignee: initials(w.assignedToName ?? ''),
    sprint: sprintNumber ? `SPR-${sprintNumber}` : undefined,
    tags: w.tags,
    status: 'queue',
    externalState: w.state ?? undefined,
    parentId: w.parentId != null ? String(w.parentId) : undefined,
  }
}

const storyPoints = (items: AdoWorkItem[]) => items.reduce((sum, s) => sum + (s.storyPoints ?? 0), 0)

function adoStoriesQueue(): QueueAdapter {
  return {
    source: 'stories',
    slug: ADO_QUEUE_SLUG,
    // Closed stories are fetched too, only to report sprint progress; the
    // board shows the rest.
    load: async (developer, sprint) => {
      const params = new URLSearchParams({ assignedTo: developer, iteration: iterationFor(sprint), includeClosed: 'true' })
      const all = await adoGet<AdoWorkItem[]>(`/workitems?${params}`)
      const stories = all.filter(s => !ADO_CLOSED_STATES.has(s.state ?? ''))
      const done = all.filter(s => s.state === ADO_DONE_STATE)
      const lanes: Record<string, Status> = {}
      for (const s of stories) {
        if (s.state === 'Active') lanes[String(s.adoId)] = 'today'
        else if (s.state === 'Blocked') lanes[String(s.adoId)] = 'blocked'
      }
      return {
        items: stories.map(adoStoryToTask),
        claimedIds: [],
        lanes,
        progress: {
          done: done.length,
          total: done.length + stories.length,
          donePoints: storyPoints(done),
          totalPoints: storyPoints(done) + storyPoints(stories),
        },
        doneIds: done.map(s => String(s.adoId)),
      }
    },
    move: async (task, _from, to) => {
      const state = ADO_LANE_STATES[to]
      if (!state || state === task.externalState) return
      await setAdoState(task.id, state)
      return { patch: { externalState: state }, did: `Set ${task.ref ?? task.id} to ${state}` }
    },
    // `task` is the card as it was before the move.
    revert: async task => {
      if (task.externalState) await setAdoState(task.id, task.externalState)
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

export interface TeamBlocker {
  assignee: string
  ref: string
  title: string
  url?: string
}

// Every blocked User Story in the current sprint, for a lead's team view. Only
// ADO has a shared Blocked state: a Notion task blocked on the board stays in
// that developer's browser.
export async function fetchTeamBlockers(sprint: Sprint | null): Promise<TeamBlocker[]> {
  const stories = await adoGet<AdoWorkItem[]>(`/workitems?${new URLSearchParams({ iteration: iterationFor(sprint) })}`)
  return stories
    .filter(s => s.state === 'Blocked')
    .map(s => ({ assignee: s.assignedToName ?? s.assignedTo ?? '', ref: `US-${s.adoId}`, title: s.title, url: s.url ?? undefined }))
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

// ADS Tickets use a Jira-style scale.
function adsPriority(value: string): Priority {
  switch (value.toLowerCase()) {
    case 'blocker': case 'critical': return 'critical'
    case 'major': return 'high'
    case 'minor': return 'medium'
    case 'trivial': return 'low'
    default: return 'none'
  }
}

function bridgeTask(item: BridgeItem, queue: string, fields: Pick<Task, 'ref' | 'type' | 'source' | 'priority'> & Partial<Task>): Task {
  return {
    id: item.id,
    queue,
    url: item.url ?? undefined,
    title: item.title,
    description: fields.notes ?? '',
    assignee: '',
    tags: [],
    status: 'queue',
    ...fields,
  }
}

// Done vs. committed work for the developer this sprint, for sources that can
// report it (ADO can; the Notion queues only return open items).
export interface QueueProgress {
  done: number
  total: number
  donePoints: number
  totalPoints: number
}

// A queue source the board knows how to load and act on. Notion queues go
// through notion-bridge; User Stories go through ado-bridge.
export interface QueueAdapter {
  source: QueueSource
  slug: string
  // Cards for the developer; claimedIds default to Todo when no lane is saved,
  // and `lanes` lets a source place cards from its own state (e.g. ADO Blocked).
  // `doneIds` are items the source knows are finished (ADO Closed), so a
  // planned item that leaves the board can be ticked off.
  load: (developer: string, sprint: Sprint | null) => Promise<{
    items: Task[]
    claimedIds: string[]
    lanes?: Record<string, Status>
    progress?: QueueProgress
    doneIds?: string[]
  }>
  // Writes a lane change to the source, if the source tracks it. `did` names
  // the write ("Claimed PULSE-…") for the undo toast; `patch` is merged into the card.
  move?: (task: Task, from: Status, to: Status, developer: string) => Promise<MoveResult | void>
  // Undoes a move's write; `task` is the card as it was before the move.
  revert?: (task: Task, from: Status, to: Status, developer: string) => Promise<void>
  done?: (task: Task, developer: string) => Promise<void>
  related?: (task: Task) => Promise<RelatedEntity[]>
}

export interface MoveResult {
  did: string
  patch?: Partial<Task>
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
        const ref = task.ref ?? task.title
        if (from === 'queue' && to !== 'queue') {
          await claimItem(task.id, slug, developer)
          return { did: `Claimed ${ref}` }
        }
        if (from !== 'queue' && to === 'queue') {
          await releaseItem(task.id, slug, developer)
          return { did: `Released ${ref}` }
        }
      }
      : undefined,
    revert: claimable
      ? async (task, from, to, developer) => {
        if (from === 'queue' && to !== 'queue') await releaseItem(task.id, slug, developer)
        else if (from !== 'queue' && to === 'queue') await claimItem(task.id, slug, developer)
      }
      : undefined,
    done: doneable ? (task, developer) => markItemDone(task.id, slug, developer).then(() => undefined) : undefined,
    related: task => fetchRelated(task.id, slug),
  }
}

// ADO User Stories are on by default and need ado-bridge running against Azure
// DevOps. Start the dev server with VITE_ADO_STORIES=false to hide them, e.g.
// while ado-bridge has no credentials.
export const ADO_STORIES_ENABLED = import.meta.env.VITE_ADO_STORIES !== 'false'

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
        priorityLabel: displayValue(item, 'Priority') || undefined,
        notes: displayValue(item, 'Description'),
        externalState: displayValue(item, 'State') || undefined,
        link: displayValue(item, 'Link') || undefined,
      })
    },
  }),
  notionQueue({
    source: 'ads',
    slug: 'ads-tickets',
    claimable: false,
    doneable: false,
    toTask: item => {
      const key = displayValue(item, 'Issue Key')
      return bridgeTask(item, 'ads-tickets', {
        ref: key || shortRef('ADS', item.id),
        type: 'ticket',
        source: 'ads',
        priority: adsPriority(displayValue(item, 'Priority')),
        priorityLabel: displayValue(item, 'Priority') || undefined,
        notes: displayValue(item, 'Description'),
        externalState: displayValue(item, 'Status') || undefined,
        link: displayValue(item, 'URL') || undefined,
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
