import type { BriefLine, QueueProgress, StandupBrief, TeamBlocker } from '../../bridge'
import { LinkedText } from '../../RichText'
import type { DayEvent } from '../../schedule'
import { dayLabel, longDate, monthDay } from '../../schedule'
import { Chip, Ref, SectionLabel } from '../../ui/atoms'
import type { ReaderTab } from '../../ui/Reader'
import { groupTeam } from '../scan/selection'
import { STRIP_TARGET } from './dayStrip'
import type { StripItem } from './dayStrip'

// The pieces of Flow's column that aren't lists of rows: the day header, and the
// read-only sections (the team, coming up, team notes).

// A titled block of the column. `id` is what the day strip scrolls to.
export function Section({ id, label, count, right, tone, className = '', children, ...rest }: {
  id?: string
  label: string
  count?: string | number
  right?: React.ReactNode
  tone?: 'danger'
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section id={id} aria-label={label} className={`mt-6 scroll-mt-4 rounded-xs first:mt-0 ${className}`} {...rest}>
      <div className={tone === 'danger' ? 'text-danger-fg' : ''}>
        <SectionLabel count={count} right={right}>{label}</SectionLabel>
      </div>
      {children}
    </section>
  )
}

export const SectionLink = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className="link font-mono text-meta" onClick={onClick}>{children}</button>
)

// ─── Day header ───────────────────────────────────────────────────────────────

function BriefChip({ brief, onReader }: { brief: StandupBrief | { error: string } | null; onReader: (tab: ReaderTab) => void }) {
  if (!brief) return <Chip>Loading brief…</Chip>
  if ('error' in brief) return <Chip tone="danger" title={brief.error}>Brief unavailable</Chip>
  if (brief.mode === 'none' || !brief.date) return <Chip>No standup brief this sprint</Chip>
  const fresh = brief.isToday
  return (
    <button
      type="button"
      onClick={() => onReader('brief')}
      className={`chip ${fresh ? 'border-ok/30 bg-ok/10 text-ok hover:bg-ok/20' : 'border-warn/30 bg-warn/10 text-warn hover:bg-warn/20'}`}
    >
      {fresh ? "✓ Today's brief is in" : `Today's brief isn't posted yet · showing ${monthDay(brief.date)}`}
    </button>
  )
}

export function DayHeader({ today, sprintLine, brief, storyProgress, strip, onReader, onJump }: {
  today: string
  sprintLine: string
  brief: StandupBrief | { error: string } | null
  storyProgress?: QueueProgress
  strip: StripItem[]
  onReader: (tab: ReaderTab) => void
  onJump: (id: string) => void
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">My day · {longDate(today)}</h1>
          <div className="font-mono text-meta text-muted">{sprintLine}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BriefChip brief={brief} onReader={onReader} />
          <button type="button" className="chip hover:text-ink" onClick={() => onReader('draft')} title="A standup update built from your day, ready to copy">
            Standup draft
          </button>
          {storyProgress && storyProgress.total > 0 && (
            <Chip title="Stories closed / committed this sprint · story points closed / committed">
              Stories {storyProgress.done}/{storyProgress.total}{storyProgress.totalPoints ? ` · ${storyProgress.donePoints}/${storyProgress.totalPoints} pt` : ''}
            </Chip>
          )}
        </div>
      </div>
      <nav aria-label="Day summary" className="mt-3 flex flex-wrap gap-x-1 text-note text-dim">
        {strip.map((item, i) => (
          <span key={item.part}>
            {i > 0 && <span aria-hidden className="mr-1 text-faint">·</span>}
            <button
              type="button"
              onClick={() => onJump(STRIP_TARGET[item.part])}
              className={`hover:text-ink hover:underline ${item.part === 'blocked' && item.count > 0 ? 'text-danger-fg' : ''}`}
            >
              <span className="font-mono text-fg">{item.count}</span> {item.label}
            </button>
          </span>
        ))}
      </nav>
    </header>
  )
}

// ─── Coming up and team notes ─────────────────────────────────────────────────

const KIND_MARK: Record<DayEvent['kind'], { mark: string; what: string }> = {
  deadline: { mark: '◆', what: 'Deadlines and Milestones' },
  sprint: { mark: '◈', what: 'Sprint' },
  team: { mark: '•', what: 'From the team notes' },
}

export function ComingUp({ events, today }: { events: DayEvent[]; today: string }) {
  if (events.length === 0) return <div className="py-2 text-note text-muted">Nothing dated in the next three weeks.</div>
  return (
    <ul>
      {events.map(e => (
        <li key={`${e.date}:${e.label}`} className="flex items-baseline gap-2.5 py-0.5" title={e.detail ? `From the team notes: ${e.detail}` : KIND_MARK[e.kind].what}>
          <span className={`w-[78px] shrink-0 font-mono text-meta ${e.date <= today ? 'text-warn' : 'text-muted'}`}>
            {dayLabel(e.date, today)}{e.end ? `–${Number(e.end.slice(8))}` : ''}
          </span>
          <span aria-hidden className="shrink-0 text-meta text-muted">{KIND_MARK[e.kind].mark}</span>
          <span className="text-note text-fg">{e.label}</span>
        </li>
      ))}
    </ul>
  )
}

export function TeamNotes({ lines }: { lines: BriefLine[] }) {
  return (
    <ul>
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2 border-b border-line-soft py-1 last:border-b-0">
          <span aria-hidden className="shrink-0 font-mono text-meta text-muted">•</span>
          <span className="text-note text-fg"><LinkedText text={l.text} /></span>
        </li>
      ))}
    </ul>
  )
}

// ─── A lead's view of the team ────────────────────────────────────────────────

export function TeamToday({ summaries, blockers }: { summaries: { developer: string; text: string }[]; blockers: TeamBlocker[] }) {
  const { members, others } = groupTeam(summaries, blockers)
  return (
    <div title="Notion tasks blocked on a developer's board are only visible in that developer's browser">
      {members.length === 0 && <div className="py-2 text-note text-muted">No developer updates in this summary.</div>}
      {members.map(m => (
        <div key={m.developer} className="border-b border-line-soft py-2 last:border-b-0">
          <div className="flex items-start gap-2">
            <span className="mt-px shrink-0 rounded-xs bg-accent/10 px-1.5 font-mono text-meta text-accent">{m.developer.toUpperCase()}</span>
            <span className="text-body text-fg"><LinkedText text={m.text} /></span>
          </div>
          {m.blockers.map(b => <BlockerLine key={b.ref} blocker={b} />)}
        </div>
      ))}
      {others.length > 0 && (
        <div className="py-2">
          <div className="label mb-1">Also blocked</div>
          {others.map(b => <BlockerLine key={b.ref} blocker={b} showWho />)}
        </div>
      )}
    </div>
  )
}

function BlockerLine({ blocker, showWho = false }: { blocker: TeamBlocker; showWho?: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 pl-1">
      <Chip tone="danger">Blocked</Chip>
      {blocker.url
        ? <a href={blocker.url} target="_blank" rel="noreferrer" className="ref hover:text-accent">{blocker.ref} ↗</a>
        : <Ref>{blocker.ref}</Ref>}
      <span className="truncate text-note text-dim">{showWho && `${blocker.assignee}: `}{blocker.title}</span>
    </div>
  )
}
