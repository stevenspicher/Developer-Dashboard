import { TEST_DEVELOPERS } from '../bridge'
import { Clock } from './Clock'

// The top bar of the list-and-pane layouts: the app and sprint, a temporary
// developer switcher, the day's counts, and the clock. `extra` is for controls
// a layout adds (the theme toggles, until the real picker exists).
export function Header({ sprintLine, developer, onDeveloper, sprintDay, planned, blocked, extra }: {
  sprintLine: string
  developer: string
  onDeveloper: (email: string) => void
  sprintDay: string | null
  planned: number
  blocked: number
  extra?: React.ReactNode
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="min-w-0">
        <div className="whitespace-nowrap text-body font-semibold text-ink">Developer Dashboard</div>
        <div className="truncate font-mono text-meta text-muted">{sprintLine}</div>
      </div>
      <div className="flex-1" />
      {extra && <div className="hidden min-[1100px]:block">{extra}</div>}
      {/* TEMP: developer switcher for testing, until there is a real login. */}
      <select
        value={developer}
        onChange={e => onDeveloper(e.target.value)}
        aria-label="Viewing as developer (testing only)"
        title="Viewing as developer (testing only)"
        className="shrink-0 rounded-xs border border-dashed border-warn/40 bg-warn/10 px-1.5 py-1 font-mono text-meta text-warn"
      >
        {TEST_DEVELOPERS.map(d => <option key={d.email} value={d.email} className="bg-bg text-fg">{d.name}</option>)}
      </select>
      <dl className="flex shrink-0 items-center gap-4">
        {sprintDay && <Stat label="Sprint day" value={sprintDay} />}
        <Stat label="Planned" value={String(planned)} />
        <Stat label="Blocked" value={String(blocked)} tone={blocked > 0 ? 'danger' : 'muted'} />
      </dl>
      <Clock />
    </header>
  )
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'muted' | 'danger' }) {
  return (
    <div className="text-center">
      <dd className={`font-mono text-stat leading-none ${tone === 'danger' ? 'text-danger-fg' : tone === 'muted' ? 'text-muted' : 'text-ink'}`}>{value}</dd>
      <dt className="mt-0.5 text-badge text-muted">{label}</dt>
    </div>
  )
}
