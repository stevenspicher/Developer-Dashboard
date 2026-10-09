import { useEffect, useState } from 'react'

import { ADO_STORIES_ENABLED, fetchDeveloperStories, parseStoryId, storyUrl } from '../../bridge'
import type { Task } from '../../types'
import { Button, Chip } from '../atoms'
import { useCockpit } from './context'

type Story = Awaited<ReturnType<typeof fetchDeveloperStories>>[number]

// The developer's open User Stories, loaded while `active`: undefined while
// loading, null when they can't be loaded (the id field still works).
function useDeveloperStories(developer: string, active: boolean) {
  const [stories, setStories] = useState<Story[] | null | undefined>(undefined)
  useEffect(() => {
    if (!active) return
    if (!ADO_STORIES_ENABLED) { setStories(null); return }
    let cancelled = false
    setStories(undefined)
    fetchDeveloperStories(developer).then(s => { if (!cancelled) setStories(s) }, () => { if (!cancelled) setStories(null) })
    return () => { cancelled = true }
  }, [developer, active])
  return stories
}

// Stories in their sprints, keeping the order they came in.
function groupBySprint(stories: Story[]): [string, Story[]][] {
  const groups = new Map<string, Story[]>()
  for (const s of stories) groups.set(s.sprint, [...(groups.get(s.sprint) ?? []), s])
  return [...groups]
}

// For a task, Pulse item or ticket: the User Story it is linked to, or that one
// is requested, or buttons to request one or link an existing one (picked from
// the developer's stories, or by id). Stories themselves show nothing.
export function StoryRequestControl({ task }: { task: Task }) {
  const { developer, storyRequest, requestsReady, askForStory } = useCockpit()
  const [linking, setLinking] = useState(false)
  const [text, setText] = useState('')
  const stories = useDeveloperStories(developer, linking)
  if (task.source === 'stories' || !requestsReady) return null

  const request = storyRequest(task)
  if (request?.storyId) {
    return <a href={storyUrl(request.storyId)} target="_blank" rel="noreferrer" className="link text-note">User Story US-{request.storyId} ↗</a>
  }
  if (request?.status === 'Requested') return <Chip tone="warn" title={`Requested by ${request.requestedBy}`}>User Story requested</Chip>

  const storyId = parseStoryId(text)
  const link = () => {
    if (!storyId) return
    askForStory(task, storyId)
    setLinking(false)
    setText('')
  }

  if (linking) {
    return (
      <form className="flex flex-wrap items-center gap-1.5" onSubmit={e => { e.preventDefault(); link() }}>
        <select
          value={storyId && stories?.some(s => s.adoId === storyId) ? String(storyId) : ''}
          onChange={e => setText(e.target.value)}
          disabled={!stories?.length}
          aria-label="Your User Stories"
          className="max-w-72 rounded-xs border border-line bg-surface px-1.5 py-0.5 text-note text-fg focus-visible:outline-1 focus-visible:outline-focus"
        >
          <option value="">{stories === undefined ? 'Loading your stories…' : stories === null ? 'Stories unavailable' : stories.length ? 'Pick one of your stories…' : 'No open stories'}</option>
          {groupBySprint(stories ?? []).map(([sprint, list]) => (
            <optgroup key={sprint} label={sprint}>
              {list.map(s => <option key={s.adoId} value={s.adoId}>US-{s.adoId} · {s.title}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-meta text-muted">or</span>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setLinking(false) } }}
          placeholder="US-12345"
          aria-label="User Story id"
          className="w-28 rounded-xs border border-line bg-surface px-2 py-0.5 font-mono text-note text-fg focus-visible:outline-1 focus-visible:outline-focus"
        />
        <Button type="submit" disabled={!storyId}>Link</Button>
        <Button onClick={() => setLinking(false)}>Cancel</Button>
      </form>
    )
  }

  return (
    <span className="flex items-center gap-1.5">
      {request?.status === 'Declined' && <Chip title="The request was declined; you can ask again">Request declined</Chip>}
      <Button onClick={() => askForStory(task)} title="Ask for a User Story to be made for this item">Request User Story</Button>
      <Button onClick={() => setLinking(true)} title="Link this item to a User Story that already exists">Link story</Button>
    </span>
  )
}
