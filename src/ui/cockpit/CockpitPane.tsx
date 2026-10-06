import { RichText } from '../../RichText'
import type { Task } from '../../types'
import { Avatar, Button, Chip, PriorityBadge, Ref, TypeChip } from '../atoms'
import { laneActions } from './actions'
import type { PaneActionId } from './actions'
import { Checklist } from './Checklist'
import { DevLinksPanel } from './DevLinks'
import { linkTarget } from './links'
import { LinkedItemsPanel } from './LinkedItems'
import { NotesPanel } from './Notes'
import { ProjectContext } from './ProjectContext'

// Everything needed to finish an item, in one place: a header, an action bar
// that follows the item's lane, then the description, checklist and notes with
// dev links, project context and linked items beside them (below them when the
// pane is narrow). `layout` says where it sits: 'pane' fills its parent and
// scrolls inside it; 'flow' grows with its content inside a page that scrolls;
// 'compact' is 'flow' with one column, for expanding a row in place. Render it with `key={task.id}` so one item's notes and
// ticks can't carry over to the next.
export type CockpitLayout = 'pane' | 'flow' | 'compact'

export function CockpitPane({ task, sourceLabel, planned, working = false, doneTarget, handlers, onReturnDragStart, onClose, layout = 'pane' }: {
  task: Task
  sourceLabel?: string
  planned: boolean
  working?: boolean
  // Where ✓ Done writes (ADO, Notion), or null when the source is read-only.
  doneTarget: string | null
  handlers: Partial<Record<PaneActionId, () => void>>
  // Makes the Return button draggable, so the item can be dropped back in the queue.
  onReturnDragStart?: (e: React.DragEvent) => void
  onClose?: () => void
  layout?: CockpitLayout
}) {
  const { actions, inPlan } = laneActions(task, { planned, canDone: doneTarget !== null && !!handlers.done })

  return (
    <div className={`@container flex flex-col ${layout === 'pane' ? 'min-h-0 flex-1' : ''}`}>
      <header className="shrink-0 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {working && (
            <span className="inline-flex items-center gap-1.5 text-note font-semibold text-ok">
              <span aria-hidden className="pulse size-2 rounded-full bg-ok" />Working
            </span>
          )}
          <TypeChip type={task.type} />
          <Ref>{task.ref ?? task.id}</Ref>
          {sourceLabel && <span className="text-meta text-muted">via {sourceLabel}</span>}
          {task.externalState && <Chip title="State in its source">{task.externalState}</Chip>}
          {task.url && <a href={task.url} target="_blank" rel="noreferrer" className="link text-note">Open in {linkTarget(task.url)} ↗</a>}
          {task.link && <a href={task.link} target="_blank" rel="noreferrer" className="link text-note">Ticket ↗</a>}
          <span className="ml-auto flex items-center gap-2.5">
            <PriorityBadge priority={task.priority} />
            {task.points != null && <Chip>{task.points} pt</Chip>}
            {task.sprint && <Ref>{task.sprint}</Ref>}
            <Avatar initials={task.assignee} />
            {onClose && <Button onClick={onClose} aria-label="Close" title="Close (Esc)">✕</Button>}
          </span>
        </div>
      </header>

      <div role="toolbar" aria-label="Item actions" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-sunken px-4 py-2">
        {actions.map(a => {
          const run = handlers[a.id]
          if (!run) return null
          const draggable = a.id === 'return' && onReturnDragStart
          return (
            <Button
              key={a.id}
              variant={a.variant}
              onClick={run}
              title={a.id === 'done' ? `Mark done in ${doneTarget}` : draggable ? "Click to put it back in today's plan, or drag it back to the queue" : undefined}
              draggable={draggable ? true : undefined}
              onDragStart={draggable ? onReturnDragStart : undefined}
              className={a.id === 'done' ? 'ml-auto' : undefined}
            >
              {a.label}
            </Button>
          )
        })}
        {inPlan && <Chip>In today's plan</Chip>}
      </div>

      <div className={layout === 'pane' ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
        <div className={`grid grid-cols-1 gap-x-6 gap-y-5 p-4 ${layout === 'compact' ? '' : '@2xl:grid-cols-[minmax(0,1fr)_280px]'}`}>
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <h2 className="mb-2 text-title font-bold text-ink">{task.title}</h2>
              {task.description && <RichText text={task.description} className="text-read text-fg" />}
            </div>
            <Checklist task={task} />
            <NotesPanel task={task} />
            {task.tags.length > 0 && <div className="flex flex-wrap gap-1">{task.tags.map(t => <Chip key={t}>#{t}</Chip>)}</div>}
          </div>
          <aside aria-label="Context" className="flex min-w-0 flex-col gap-5">
            <DevLinksPanel task={task} />
            <ProjectContext task={task} />
            <LinkedItemsPanel task={task} />
          </aside>
        </div>
      </div>
    </div>
  )
}
