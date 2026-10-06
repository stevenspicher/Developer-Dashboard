import { BoardProvider } from './board/BoardContext'
import ClassicApp from './classic/ClassicApp'

export default function App() {
  return (
    <BoardProvider>
      <ClassicApp />
    </BoardProvider>
  )
}
