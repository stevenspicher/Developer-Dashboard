import { DEADLINE_TICKER_DAYS, addDays, daysBetween, shortDate } from '../bridge'
import type { BriefLine, Deadline, Sprint, StandupBrief } from '../bridge'
import { LinkedText } from '../RichText'
import type { Task } from '../types'
import { SectionLabel, Tabs } from './atoms'
import { Overlay } from './Overlay'

// The brief, team items, sprint calendar and standup draft in one overlay.

export type ReaderTab = 'brief' | 'ticker' | 'calendar' | 'draft'

const TABS: { id: ReaderTab; label: string }[] = [
  { id: 'brief', label: 'Daily brief' },
  { id: 'ticker', label: 'Team items & dates' },
  { id: 'calendar', label: 'Sprint calendar' },
  { id: 'draft', label: 'Standup draft' },
]

export function Reader({ tab, onTab, onClose, views }: {
  tab: ReaderTab
  onTab: (tab: ReaderTab) => void
  onClose: () => void
  views: Record<ReaderTab, React.ReactNode>
}) {
  return (
    <Overlay label="Brief, dates and standup draft" onClose={onClose} className="h-[80vh] w-[760px]">
      <div className="flex shrink-0 items-end gap-2 border-b border-line px-3 pt-2">
        <Tabs label="Reader" tabs={TABS} value={tab} onChange={onTab} className="flex-1 border-b-0" />
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="mb-1 px-2 text-muted hover:text-fg">✕</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3" role="tabpanel">{views[tab]}</div>
    </Overlay>
  )
}

const scroller = (children: React.ReactNode) => <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

// ─── Daily brief ──────────────────────────────────────────────────────────────

export function BriefView({ brief, tasks, onOpen, today }: {
  brief: StandupBrief | { error: string } | null
  tasks: Task[]
  onOpen: (line: BriefLine) => void
  today: string
}) {
  if (!brief) return scroller(<span className="text-note text-muted">Loading brief…</span>)
  if ('error' in brief) return scroller(<span role="alert" className="text-note text-danger-fg">Bridge error · {brief.error}</span>)
  if (brief.mode === 'none' || !brief.date) return scroller(<span className="text-note text-muted">No standup brief yet this sprint</span>)

  const heading = `${shortDate(brief.date)} standup · ${brief.mode === 'brief' ? 'Morning brief' : 'Leadership summary'}`
  const Line = ({ line, index, tone }: { line: BriefLine; index?: number; tone: string }) => {
    const task = tasks.find(t => line.mentions.includes(t.id))
    const body = (
      <>
        <span className={`mt-px min-w-4 shrink-0 font-mono text-meta ${tone}`}>{index !== undefined ? `${index + 1}.` : '•'}</span>
        <span className="text-body text-fg">
          <LinkedText text={line.text} />
          {task && <span className="ml-1.5 whitespace-nowrap font-mono text-meta text-accent">{task.ref ?? ''} ↗</span>}
        </span>
      </>
    )
    return task
      ? <button type="button" onClick={() => onOpen(line)} className="flex w-full items-start gap-2 border-b border-line-soft py-1 text-left hover:bg-tint/[0.03]">{body}</button>
      : <div className="flex items-start gap-2 border-b border-line-soft py-1">{body}</div>
  }

  return scroller(
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-note font-semibold text-ink">{heading}</span>
        {!brief.isToday && brief.date < today && <span className="ml-auto text-meta text-warn">Today's brief isn't posted yet</span>}
      </div>
      {brief.mode === 'brief' ? (
        <>
          <SectionLabel>YOUR RESPONSIBILITIES TODAY</SectionLabel>
          {brief.responsibilities.length === 0
            ? <div className="py-1 text-body text-muted">None listed</div>
            : brief.responsibilities.map((l, i) => <Line key={i} line={l} index={i} tone="text-accent" />)}
          {brief.aging.length > 0 && (
            <div className="mt-4">
              <SectionLabel>AGING ITEMS</SectionLabel>
              {brief.aging.map((l, i) => <Line key={i} line={l} tone="text-warn" />)}
            </div>
          )}
        </>
      ) : (
        brief.summaries.map(s => (
          <div key={s.developer} className="flex items-start gap-2 border-b border-line-soft py-1.5">
            <span className="mt-px shrink-0 rounded-xs bg-raised px-1.5 font-mono text-meta text-dim">{s.developer.toUpperCase()}</span>
            <span className="text-body text-fg"><LinkedText text={s.text} /></span>
          </div>
        ))
      )}
    </>,
  )
}

// ─── Team items and dates ─────────────────────────────────────────────────────

export function TickerView({ items }: { items: { src: string; text: string }[] }) {
  const groups = [
    { src: 'TEAM', label: 'TEAM ITEMS' },
    { src: 'DATE', label: `DEADLINES IN THE NEXT ${DEADLINE_TICKER_DAYS} DAYS` },
  ]
  return scroller(
    groups.map(g => {
      const rows = items.filter(i => i.src === g.src)
      return (
        <div key={g.src} className="mb-4">
          <SectionLabel>{g.label}</SectionLabel>
          {rows.length === 0
            ? <div className="py-1 text-body text-muted">None</div>
            : rows.map((r, i) => (
              <div key={i} className="flex gap-2 border-b border-line-soft py-1">
                <span className="shrink-0 font-mono text-meta text-accent">•</span>
                <span className="text-body text-fg"><LinkedText text={r.text} /></span>
              </div>
            ))}
        </div>
      )
    }),
  )
}

// ─── Sprint calendar ──────────────────────────────────────────────────────────

export function CalendarView({ items, sprint, today, header }: { items: Deadline[]; sprint: Sprint | null; today: string; header: React.ReactNode }) {
  const inSprint = (d: Deadline) => !!sprint?.end && d.start <= sprint.end
  const range = (d: Deadline) => (d.end && d.end !== d.start ? `${shortDate(d.start)} – ${shortDate(d.end)}` : shortDate(d.start))
  const sprintLen = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : 0
  const pct = (iso: string) => sprint?.start && sprintLen ? Math.min(100, Math.max(0, (daysBetween(sprint.start, iso) / sprintLen) * 100)) : 0

  const Row = ({ d }: { d: Deadline }) => {
    const active = d.start <= today
    return (
      <div className="border-b border-line-soft py-1">
        <div className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-body ${active ? 'text-ink' : 'text-fg'}`}>{d.title}</span>
          <span className={`shrink-0 font-mono text-meta ${active ? 'text-ok' : 'text-muted'}`}>{range(d)}{!active && ` · ${daysBetween(today, d.start)}d`}</span>
        </div>
        {inSprint(d) && sprintLen > 0 && (
          <div className="relative mt-1 h-[3px] rounded-full bg-tint/5" aria-hidden>
            <div className="absolute -top-0.5 h-[7px] w-px bg-accent" style={{ left: `${pct(today)}%` }} />
            <div
              className={`absolute h-[3px] rounded-full ${active ? 'bg-ok' : 'bg-accent/50'}`}
              style={{ left: `${pct(d.start)}%`, width: `${Math.max(2, pct(addDays(d.end ?? d.start, 1)) - pct(d.start))}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  const current = items.filter(inSprint)
  const upcoming = items.filter(d => !inSprint(d))
  return scroller(
    <>
      <div className="mb-2">{header}</div>
      {items.length === 0 && <span className="text-note text-muted">No upcoming deadlines</span>}
      {current.length > 0 && <SectionLabel>THIS SPRINT</SectionLabel>}
      {current.map(d => <Row key={d.id} d={d} />)}
      {upcoming.length > 0 && <div className="mt-4"><SectionLabel>UPCOMING</SectionLabel></div>}
      {upcoming.map(d => <Row key={d.id} d={d} />)}
    </>,
  )
}
