import { useState } from 'react'

import { queueFor, stripLinks } from '../../bridge'
import type { RelatedEntity } from '../../bridge'
import { RichText } from '../../RichText'
import type { Task } from '../../types'
import { Button, Chip, SectionLabel } from '../atoms'
import { linkTarget, notionPageUrl } from './links'
import { useLoaded } from './load'
import { Overlay } from '../Overlay'

// The initiative, issue and analyst issue a Notion item belongs to, or the
// parent work item of an ADO story, as cards that open in full.

const RELATION_LABELS: Record<string, string> = { initiative: 'INITIATIVE', issue: 'ISSUE', analystIssue: 'ANALYST ISSUE', parent: 'PARENT' }
const RELATION_FIELDS: Record<string, string[]> = {
  initiative: ['Status', 'Impact', 'Deadline', 'Countdown'],
  issue: ['Status', 'Priority'],
  analystIssue: ['Status', 'Priority'],
  parent: ['State', 'Assigned To', 'Iteration'],
}
const RELATION_TEXT_FIELDS = ['Description', 'Notes']

// ADO parents are labelled by their work item type (FEATURE, EPIC, …).
const relationLabel = (entity: RelatedEntity) => {
  const type = entity.relation === 'parent' ? entity.properties?.find(p => p.name === 'Type')?.value : undefined
  return (type || RELATION_LABELS[entity.relation] || entity.relation).toUpperCase()
}

function RelatedCard({ entity, onOpen }: { entity: RelatedEntity; onOpen: () => void }) {
  const prop = (name: string) => entity.properties?.find(p => p.name === name)?.value ?? ''
  const fields = (RELATION_FIELDS[entity.relation] ?? []).map(name => [name, prop(name)] as const).filter(([, v]) => v)
  const text = RELATION_TEXT_FIELDS.map(prop).find(Boolean) || entity.content || ''
  if (entity.error) {
    return (
      <div className="rounded-xs border border-line-soft bg-sunken px-2.5 py-2">
        <div className="label mb-1">{relationLabel(entity)}</div>
        <div role="alert" className="text-meta text-danger-fg">Unavailable — {entity.error}</div>
      </div>
    )
  }
  return (
    <div className="rounded-xs border border-line-soft bg-sunken px-2.5 py-2 hover:border-line-strong">
      <button type="button" onClick={onOpen} title="Open in full" className="block w-full text-left">
        <div className="label mb-1">{relationLabel(entity)}</div>
        <div className="mb-1.5 text-body font-semibold leading-snug text-ink">{entity.title}</div>
        {fields.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {fields.map(([name, value]) => <Chip key={name}><span className="mr-1 text-muted">{name}</span>{value}</Chip>)}
          </div>
        )}
        {text && <div className="line-clamp-5 whitespace-pre-line text-note text-dim">{stripLinks(text)}</div>}
      </button>
      {entity.url && (
        <a href={entity.url} target="_blank" rel="noreferrer" className="link mt-1.5 inline-block text-meta">Open in {linkTarget(entity.url)} ↗</a>
      )}
    </div>
  )
}

function RelatedModal({ entity, onClose }: { entity: RelatedEntity; onClose: () => void }) {
  const props = (entity.properties ?? []).filter(p => p.value && p.type !== 'relation')
  const longText = props.filter(p => RELATION_TEXT_FIELDS.includes(p.name))
  const fields = props.filter(p => !RELATION_TEXT_FIELDS.includes(p.name))
  const content = (entity.content ?? '').split('\n').filter(l => !l.startsWith('[Sub-page:')).join('\n').trim()
  return (
    <Overlay label={`${relationLabel(entity)}: ${entity.title ?? ''}`} onClose={onClose} className="h-[80vh] w-[760px]">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="label">{relationLabel(entity)}</span>
        {entity.url && <a href={entity.url} target="_blank" rel="noreferrer" className="link text-note">Open in {linkTarget(entity.url)} ↗</a>}
        <span className="ml-auto" />
        <Button onClick={onClose} aria-label="Close" title="Close (Esc)">✕</Button>
      </div>
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
        <div className="text-display font-bold text-ink">{entity.title}</div>
        {fields.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fields.map(p => (
              <div key={p.name} className="rounded-xs border border-line-soft bg-tint/[0.04] px-2 py-1">
                <div className="label text-badge">{p.name.toUpperCase()}</div>
                <div className="text-note text-fg">{p.value}</div>
              </div>
            ))}
          </div>
        )}
        {longText.map(p => (
          <div key={p.name}>
            <SectionLabel>{p.name.toUpperCase()}</SectionLabel>
            <RichText text={p.value} className="text-read text-fg" />
          </div>
        ))}
        {content && (
          <div>
            <SectionLabel>PAGE CONTENT</SectionLabel>
            <RichText text={content} className="text-read text-fg" />
          </div>
        )}
        {entity.sub_pages && entity.sub_pages.length > 0 && (
          <div>
            <SectionLabel count={entity.sub_pages.length}>SUB-PAGES</SectionLabel>
            {entity.sub_pages.map(sp => (
              <a key={sp.id} href={notionPageUrl(sp.id)} target="_blank" rel="noreferrer" className="link block py-1 text-read">{sp.title || 'Untitled'} ↗</a>
            ))}
          </div>
        )}
        {!content && longText.length === 0 && <span className="text-body text-muted">No description or page content.</span>}
      </div>
    </Overlay>
  )
}

// Loads the context itself, for any item with a queue (not only the one being
// worked on).
export function ProjectContext({ task }: { task: Task }) {
  const adapter = queueFor(task)
  const related = useLoaded<RelatedEntity[]>(adapter?.related ? `related:${task.queue}:${task.id}` : null, () => adapter!.related!(task))
  const [open, setOpen] = useState<RelatedEntity | null>(null)
  const linked = related.status === 'ready' ? related.value.filter(r => !r.empty) : []

  return (
    <div>
      <SectionLabel>PROJECT CONTEXT</SectionLabel>
      {!adapter?.related && <span className="text-note text-muted">No linked initiative, issue, or parent</span>}
      {adapter?.related && related.status === 'loading' && <span className="text-meta text-muted">Loading context…</span>}
      {related.status === 'error' && <span role="alert" className="text-meta text-danger-fg">{related.message}</span>}
      {related.status === 'ready' && linked.length === 0 && <span className="text-note text-muted">No linked initiative, issue, or parent</span>}
      {linked.length > 0 && (
        <div className="flex flex-col gap-2">
          {linked.map(r => <RelatedCard key={`${r.relation}:${r.id}`} entity={r} onOpen={() => setOpen(r)} />)}
        </div>
      )}
      {open && <RelatedModal entity={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
