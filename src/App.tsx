import { BoardProvider } from './board/BoardContext'
import { useBoardContext } from './board/BoardContext'
import ClassicApp from './classic/ClassicApp'
import FlowMode from './modes/flow/FlowMode'
import ScanMode from './modes/scan/ScanMode'
import { PrefsProvider, usePrefs } from './ui/prefs'
import type { ActiveLayout } from './ui/prefs'

// Which layout shows: the developer's choice (Scan or Flow, or by window width),
// unless the address names one: /?ui=scan, /?ui=flow or /?ui=classic, the old layout.
// The board is created above all of them, so switching never reloads or loses anything.
function layoutFromAddress(): ActiveLayout | null {
  const ui = new URLSearchParams(window.location.search).get('ui')
  return ui === 'scan' || ui === 'flow' || ui === 'classic' ? ui : null
}

function Layout() {
  const { layout } = usePrefs()
  return layout === 'scan' ? <ScanMode /> : layout === 'flow' ? <FlowMode /> : <ClassicApp />
}

function Prefs({ children }: { children: React.ReactNode }) {
  const { developer } = useBoardContext()
  return <PrefsProvider developer={developer} override={layoutFromAddress()}>{children}</PrefsProvider>
}

export default function App() {
  return (
    <BoardProvider>
      <Prefs><Layout /></Prefs>
    </BoardProvider>
  )
}
