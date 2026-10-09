import { useState } from 'react'

import { parseStoryId, storyUrl } from '../bridge'
import type { StoryRequest } from '../bridge'
import { Button, Chip, Ref } from './atoms'
import { requestSource, requesterName } from './rows'

type Answer = { storyId: number } | { status: 'Declined' }

// A user story request, for the story owner to answer: the item it is for and
// who asked, a field for the id of the story made for it, and Decline. The
// item's own page is linked here, as the owner needs its details to write the story.
export function StoryRequestCard({ request, onAnswer, compact = false }: {
  request: StoryRequest
  onAnswer: (answer: Answer) => void
  compact?: boolean
}) {
  const [text, setText] = useState('')
  const storyId = parseStoryId(text)
  const source = requestSource(request)
  const open = request.status === 'Requested'

  return (
    <div className={compact ? 'border-b border-line-soft py-2.5' : 'flex flex-col gap-4 p-4'}>
      <div>
        {!compact && <h2 className="mb-1 text-title font-bold text-ink">{request.title}</h2>}
        {compact && <div className="text-body text-ink">{request.title}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted">
          {request.itemRef && <Ref source={source}>{request.itemRef}</Ref>}
          <span>{request.source}</span>
          <span>requested by {requesterName(request.requestedBy)}</span>
          {request.createdAt && <span>{new Date(request.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          {request.itemUrl && <a href={request.itemUrl} target="_blank" rel="noreferrer" className="link">Open item ↗</a>}
        </div>
      </div>
      {open ? (
        <form className={`flex flex-wrap items-center gap-1.5 ${compact ? 'mt-2' : ''}`} onSubmit={e => { e.preventDefault(); if (storyId) onAnswer({ storyId }) }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="US-12345"
            aria-label={`User Story made for ${request.itemRef || request.title}`}
            className="w-28 rounded-xs border border-line bg-surface px-2 py-0.5 font-mono text-note text-fg focus-visible:outline-1 focus-visible:outline-focus"
          />
          <Button type="submit" variant="primary" disabled={!storyId} title="Record the User Story made for this item">Link story</Button>
          <Button onClick={() => onAnswer({ status: 'Declined' })} title="No story will be made for this item">Decline</Button>
        </form>
      ) : (
        <div className={compact ? 'mt-2' : ''}>
          {request.storyId
            ? <a href={storyUrl(request.storyId)} target="_blank" rel="noreferrer" className="link text-note">User Story US-{request.storyId} ↗</a>
            : <Chip>{request.status}</Chip>}
        </div>
      )}
    </div>
  )
}
