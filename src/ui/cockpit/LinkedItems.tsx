import { adoRef, storyUrl } from '../../bridge'
import { crossRefs } from '../../cockpitLogic'
import type { Task } from '../../types'
import { SectionLabel } from '../atoms'
import { useCockpit } from './context'
import { linksKey, useDevLinks } from './DevLinks'

const RELATION_LABEL = { child: 'CHILD', related: 'RELATED' } as const

function ItemRow({ kind, title, state, onOpen, href }: {
  kind: string
  title: string
  state?: string | null
  onOpen?: () => void
  href?: string | null
}) {
  const body = (
    <>
      <span className="w-16 shrink-0 font-mono text-badge tracking-label text-muted">{kind}</span>
      <span className="min-w-0 flex-1 break-words text-note text-fg group-hover:text-ink">{title}</span>
      {state && <span className="shrink-0 font-mono text-meta text-muted">{state}</span>}
    </>
  )
  const cls = 'group flex w-full items-baseline gap-2 rounded-xs px-1 py-1 text-left hover:bg-tint/[0.04]'
  if (onOpen) return <button type="button" className={cls} onClick={onOpen}>{body}</button>
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer">{body}</a>
  return <div className={cls}>{body}</div>
}

// Items tied to this one: ADO child and related work items, the items linked
// to a story or bug through a user story request (or, for such an item, its
// story), and items on the board that name this one by ref (or that this one
// names). The ADO parent has its own card under Project Context.
export function LinkedItemsPanel({ task }: { task: Task }) {
  const { tasks, openTask, requests, storyRequest } = useCockpit()
  const links = useDevLinks(task)
  const { mentions, mentionedBy } = crossRefs(task, tasks)
  const onBoard = new Map(tasks.map(t => [t.id, t]))
  const seen = new Set<string>()

  const rows: React.ReactNode[] = []
  if (task.source === 'stories') {
    for (const r of requests.filter(r => r.storyId != null && String(r.storyId) === task.id)) {
      const loaded = onBoard.get(r.itemId)
      seen.add(r.itemId)
      rows.push(
        <ItemRow key={`req${r.id}`} kind="LINKED" title={`${r.itemRef} ${r.title}`.trim()}
          onOpen={loaded ? () => openTask(loaded) : undefined} href={loaded ? undefined : r.itemUrl} />,
      )
    }
  } else {
    const storyId = storyRequest(task)?.storyId
    if (storyId != null) {
      const story = onBoard.get(String(storyId))
      seen.add(String(storyId))
      rows.push(
        <ItemRow key={`story${storyId}`} kind="STORY" title={story ? `${story.ref} ${story.title}` : `US-${storyId}`}
          state={story?.externalState} onOpen={story ? () => openTask(story) : undefined} href={story ? undefined : storyUrl(storyId)} />,
      )
    }
  }
  if (links.status === 'ready') {
    for (const w of links.value.workItems) {
      if (w.relation === 'parent' || seen.has(String(w.adoId))) continue
      const loaded = onBoard.get(String(w.adoId))
      seen.add(String(w.adoId))
      rows.push(
        <ItemRow
          key={`ado${w.adoId}`}
          kind={RELATION_LABEL[w.relation]}
          title={`${w.workItemType ? adoRef(w.adoId, w.workItemType) : `#${w.adoId}`} ${w.title ?? ''}`.trim()}
          state={w.state}
          onOpen={loaded ? () => openTask(loaded) : undefined}
          href={loaded ? undefined : w.url}
        />,
      )
    }
  }
  for (const [kind, list] of [['MENTIONS', mentions], ['MENTIONED BY', mentionedBy]] as const) {
    for (const t of list) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      rows.push(<ItemRow key={`${kind}${t.id}`} kind={kind} title={`${t.ref} ${t.title}`} state={t.externalState} onOpen={() => openTask(t)} />)
    }
  }

  const waiting = !!linksKey(task) && links.status === 'loading'
  return (
    <div>
      <SectionLabel>LINKED ITEMS</SectionLabel>
      {rows.length > 0 && <div className="-mx-1 flex flex-col">{rows}</div>}
      {rows.length === 0 && <span className="text-note text-muted">{waiting ? 'Loading…' : 'Nothing linked or mentioned'}</span>}
    </div>
  )
}
