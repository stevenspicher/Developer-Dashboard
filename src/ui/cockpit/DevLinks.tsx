import type { DevLinks } from '../../bridge'
import { queueFor } from '../../bridge'
import type { Task } from '../../types'
import { BuildStatus, PrStatus, SectionLabel } from '../atoms'
import { useLoaded } from './load'

// Branches, pull requests, builds and links for a story, from ado-bridge.
export const linksKey = (task: Task) => (queueFor(task)?.devLinks ? `links:${task.queue}:${task.id}` : null)
export const useDevLinks = (task: Task) => useLoaded<DevLinks>(linksKey(task), () => queueFor(task)!.devLinks!(task))

function LinkRow({ kind, href, title, meta, status }: {
  kind: string
  href: string
  title: string
  meta?: string | null
  status?: React.ReactNode
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex items-baseline gap-2 rounded-xs px-1 py-1 hover:bg-tint/[0.04]">
      <span className="w-14 shrink-0 font-mono text-badge tracking-label text-muted">{kind}</span>
      <span className="min-w-0 flex-1 break-words text-note text-fg group-hover:text-ink">
        {title}
        {meta && <span className="ml-1.5 font-mono text-meta text-muted">{meta}</span>}
      </span>
      {status}
      <span aria-hidden className="shrink-0 text-accent">↗</span>
    </a>
  )
}

// Shown for any story, not only the one being worked on.
export function DevLinksPanel({ task }: { task: Task }) {
  const links = useDevLinks(task)
  if (!queueFor(task)?.devLinks) return null
  return (
    <div>
      <SectionLabel>DEV LINKS</SectionLabel>
      {links.status === 'loading' && <span className="text-meta text-muted">Loading…</span>}
      {links.status === 'error' && (
        <span className="text-meta text-danger-fg">
          {links.message === 'Not Found' ? 'Dev links need an updated ado-bridge' : `Dev links unavailable · ${links.message}`}
        </span>
      )}
      {links.status === 'ready' && <DevLinkRows links={links.value} />}
    </div>
  )
}

function DevLinkRows({ links }: { links: DevLinks }) {
  const empty = links.pullRequests.length + links.branches.length + links.builds.length + links.commits.length + links.hyperlinks.length === 0
  if (empty) return <span className="text-note text-muted">No branch, PR or build linked yet</span>
  return (
    <div className="-mx-1 flex flex-col">
      {links.pullRequests.map(pr => (
        <LinkRow key={`pr${pr.id}`} kind="PR" href={pr.url} title={pr.title || `Pull request ${pr.id}`} meta={pr.repo} status={<PrStatus pr={pr} />} />
      ))}
      {links.branches.map(b => <LinkRow key={`b${b.repo}${b.name}`} kind="BRANCH" href={b.url} title={b.name} meta={b.repo} />)}
      {links.builds.map(b => (
        <LinkRow key={`ci${b.id}`} kind="CI" href={b.url} title={b.definition || `Build ${b.id}`} meta={b.name} status={<BuildStatus build={b} />} />
      ))}
      {links.commits.map(c => <LinkRow key={`c${c.sha}`} kind="COMMIT" href={c.url} title={c.sha.slice(0, 8)} meta={c.repo} />)}
      {links.hyperlinks.map(h => <LinkRow key={h.url} kind="LINK" href={h.url} title={h.title} />)}
    </div>
  )
}
