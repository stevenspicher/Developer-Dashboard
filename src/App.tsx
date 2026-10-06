import { BoardProvider, useBoardContext } from './board/BoardContext'
import FlowMode from './modes/flow/FlowMode'
import ScanMode from './modes/scan/ScanMode'
import { PrefsProvider, usePrefs } from './ui/prefs'
import type { ActiveLayout } from './ui/prefs'

// Which layout shows: the developer's choice (Scan or Flow, or by window width),
// unless the address names one (/?ui=scan or /?ui=flow) until they pick in the header.
// The board is created above both, so switching never reloads or loses anything.
function layoutFromAddress(): ActiveLayout | null {
  const ui = new URLSearchParams(window.location.search).get('ui')
  return ui === 'scan' || ui === 'flow' ? ui : null
}

function Layout() {
  return usePrefs().layout === 'scan' ? <ScanMode /> : <FlowMode />
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
