import { BoardProvider } from './board/BoardContext'
import ClassicApp from './classic/ClassicApp'
import FlowMode from './modes/flow/FlowMode'
import ScanMode from './modes/scan/ScanMode'

// Which layout shows: the current one by default, or /?ui=scan or /?ui=flow while the new
// layouts are built. The board is created above both, so switching never reloads.
export default function App() {
  const ui = new URLSearchParams(window.location.search).get('ui')
  return (
    <BoardProvider>
      {ui === 'scan' ? <ScanMode /> : ui === 'flow' ? <FlowMode /> : <ClassicApp />}
    </BoardProvider>
  )
}
