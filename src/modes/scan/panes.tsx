import type { PullRequest } from '../../bridge'
import { LinkedText, RichText } from '../../RichText'
import type { PlanEntry } from '../../plan'
import { monthDay } from '../../schedule'
import type { Task } from '../../types'
import { Button, Chip, Ref, SectionLabel } from '../../ui/atoms'
import { STALE_REVIEW_DAYS, reviewAge } from '../../ui/rows'
import type { TeamMember } from './selection'

// The panes of Scan that aren't a cockpit: a plan entry with no item behind it,
// a pull request, a developer on the team, and nothing selected.

export function EmptyPane({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <div className="text-body text-muted">{title}</div>
      {hint && <div className="text-meta text-muted">{hint}</div>}
    </div>
  )
}

function PaneFrame({ title, eyebrow, children, actions }: { title: string; eyebrow: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line px-4 py-2.5"><div className="flex flex-wrap items-center gap-2">{eyebrow}</div></header>
      {actions && <div role="toolbar" aria-label="Actions" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-sunken px-4 py-2">{actions}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-title font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ─── A plan entry that isn't linked to an item ────────────────────────────────

export function EntryPane({ entry, suggestion, today, onLink, onConfirm, onReject, onToggle, onRemove }: {
  entry: PlanEntry
  suggestion?: Task
  today: string
  onLink: () => void
  onConfirm: (task: Task) => void
  onReject: (task: Task) => void
  onToggle: () => void
  onRemove: () => void
}) {
  const origin = entry.origin === 'standup'
    ? `From the ${entry.briefDate && entry.briefDate !== today ? `${monthDay(entry.briefDate)} ` : ''}standup`
    : 'Added by you'
  return (
    <PaneFrame
      title={entry.text}
      eyebrow={<><Chip>Plan entry</Chip><span className="text-meta text-muted">{origin}</span>{entry.missing && <Chip>Not on your board</Chip>}</>}
      actions={
        <>
          {!entry.done && <Button onClick={onLink}>Link to an item</Button>}
          <Button onClick={onToggle} disabled={!!entry.doneAt}>{entry.done ? 'Mark not done' : '✓ Mark done'}</Button>
          <Button variant="danger" onClick={onRemove}>Remove from plan</Button>
        </>
      }
    >
      {entry.done ? (
        <p className="text-note text-muted">Done. It leaves the plan tomorrow.</p>
      ) : suggestion ? (
        <div className="rounded-xs border border-line bg-sunken p-3">
          <SectionLabel>LOOKS LIKE</SectionLabel>
          <div className="mb-2 flex items-center gap-2"><Ref>{suggestion.ref}</Ref><span className="text-body text-ink">{suggestion.title}</span></div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => onConfirm(suggestion)}>Confirm: link it</Button>
            <Button onClick={() => onReject(suggestion)}>Not this one</Button>
          </div>
        </div>
      ) : (
        <p className="text-note text-muted">This entry isn't linked to a board item. Link it to start it, tick it off in its source, and see its notes and links here.</p>
      )}
    </PaneFrame>
  )
}

// ─── A pull request waiting on you ────────────────────────────────────────────

export function ReviewPane({ pr, today }: { pr: PullRequest; today: string }) {
  const days = reviewAge(pr, today)
  return (
    <PaneFrame
      title={pr.title}
      eyebrow={
        <>
          <Chip>Pull request</Chip>
          <Ref>#{pr.pullRequestId}</Ref>
          {pr.isRequired && <Chip>Required</Chip>}
        </>
      }
      actions={<a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xs border border-accent bg-accent px-2.5 py-1 text-note font-medium text-bg hover:brightness-110">Open in Azure DevOps ↗</a>}
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-body">
        {pr.repo && <><dt className="text-muted">Repository</dt><dd className="font-mono text-fg">{pr.repo}</dd></>}
        {pr.author && <><dt className="text-muted">Author</dt><dd className="text-fg">{pr.author}</dd></>}
        <dt className="text-muted">Waiting</dt>
        <dd className={days >= STALE_REVIEW_DAYS ? 'text-warn' : 'text-fg'}>{days <= 0 ? 'Opened today' : `${days} ${days === 1 ? 'day' : 'days'}`}</dd>
      </dl>
    </PaneFrame>
  )
}

// ─── A developer on the team (leads) ──────────────────────────────────────────

export function TeamPane({ member }: { member: TeamMember }) {
  return (
    <PaneFrame title={member.developer} eyebrow={<Chip>Team update</Chip>}>
      <RichText text={member.text} className="mb-4 text-read text-fg" />
      <SectionLabel count={member.blockers.length}>BLOCKED STORIES</SectionLabel>
      {member.blockers.length === 0 && <span className="text-note text-muted">None in the Blocked state.</span>}
      {member.blockers.map(b => (
        <div key={b.ref} className="flex items-center gap-2 border-b border-line-soft py-1.5">
          <Chip tone="danger">Blocked</Chip>
          {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="ref hover:text-accent">{b.ref} ↗</a> : <Ref>{b.ref}</Ref>}
          <span className="min-w-0 flex-1 text-body text-fg"><LinkedText text={b.title} /></span>
        </div>
      ))}
      <p className="mt-3 text-meta text-muted">Notion tasks blocked on a developer's board are only visible in that developer's browser.</p>
    </PaneFrame>
  )
}
