import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import { useBoard } from './useBoard'
import type { Board } from './useBoard'

// One board for the whole app, created above whichever layout is showing, so
// switching layouts never reloads or resets anything.
const BoardContext = createContext<Board | null>(null)

export function BoardProvider({ children }: { children: ReactNode }) {
  return <BoardContext.Provider value={useBoard()}>{children}</BoardContext.Provider>
}

export function useBoardContext(): Board {
  const board = useContext(BoardContext)
  if (!board) throw new Error('useBoardContext must be used inside a BoardProvider')
  return board
}
