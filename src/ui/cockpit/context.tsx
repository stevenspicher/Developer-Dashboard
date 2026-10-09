import { createContext, useContext } from 'react'

import type { StoryRequest } from '../../bridge'
import type { Ticks } from '../../cockpitLogic'
import type { Task } from '../../types'

// What the cockpit parts read from the board: the items on it (for ref
// matching and links), the ticked criteria, the item's user story request,
// and the actions they take.
export interface CockpitValue {
  tasks: Task[]
  ticks: Ticks
  developer: string
  toggleTick: (task: Task, criterion: string) => void
  openTask: (task: Task) => void
  storyRequest: (task: Task) => StoryRequest | undefined
  // Every request, to find the items linked to a story.
  requests: StoryRequest[]
  // False until the requests have loaded, so a Request button can't race them.
  requestsReady: boolean
  // Requests a story for the item, or links it to `storyId`.
  askForStory: (task: Task, storyId?: number) => void
}

export const CockpitContext = createContext<CockpitValue | null>(null)

export function useCockpit(): CockpitValue {
  const value = useContext(CockpitContext)
  if (!value) throw new Error('Cockpit parts must render inside a CockpitContext')
  return value
}
