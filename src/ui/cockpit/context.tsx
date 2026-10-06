import { createContext, useContext } from 'react'

import type { Ticks } from '../../cockpitLogic'
import type { Task } from '../../types'

// What the cockpit parts read from the board: the items on it (for ref
// matching and links), the ticked criteria, and two actions.
export interface CockpitValue {
  tasks: Task[]
  ticks: Ticks
  developer: string
  toggleTick: (task: Task, criterion: string) => void
  openTask: (task: Task) => void
}

export const CockpitContext = createContext<CockpitValue | null>(null)

export function useCockpit(): CockpitValue {
  const value = useContext(CockpitContext)
  if (!value) throw new Error('Cockpit parts must render inside a CockpitContext')
  return value
}
