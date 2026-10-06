import { TEST_DEVELOPERS } from '../bridge'
import { Clock } from './Clock'
import { LookMenu, ModeSwitcher } from './LookControls'

// The top bar of Scan and Flow: the app and sprint, the layout switcher and look
// menu, a temporary developer switcher, the day's counts, and the clock. Under
// 1100px the counts shrink to one chip and the clock to the time.
export function Header({ sprintLine, developer, onDeveloper, sprintDay, planned, blocked }: {
  sprintLine: string
  developer: string
  onDeveloper: (email: string) => void
  sprintDay: string | null
  planned: number
  blocked: number
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="min-w-0">
        <div className="whitespace-nowrap text-body font-semibold text-ink">Developer Dashboard</div>
        <div className="truncate font-mono text-meta text-muted">{sprintLine}</div>
      </div>
      <div className="flex-1" />
      <ModeSwitcher />
      <LookMenu />
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
      <div className="shrink-0 font-mono text-meta text-muted min-[1100px]:hidden" title="Planned and blocked">
        {planned} planned{blocked > 0 && <> · <span className="text-danger-fg">{blocked} blocked</span></>}
      </div>
      <dl className="hidden shrink-0 items-center gap-4 min-[1100px]:flex">
        {sprintDay && <Stat label="Sprint day" value={sprintDay} />}
        <Stat label="Planned" value={String(planned)} />
        <Stat label="Blocked" value={String(blocked)} tone={blocked > 0 ? 'danger' : 'muted'} />
      </dl>
      <div className="hidden min-[1100px]:block"><Clock /></div>
      <div className="min-[1100px]:hidden"><Clock showDate={false} /></div>
    </header>
  )
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'muted' | 'danger' }) {
  return (
    // The label comes first for screen readers (a <dt> before its <dd>), and shows below the value.
    <div className="flex flex-col-reverse text-center">
      <dt className="mt-0.5 text-badge text-muted">{label}</dt>
      <dd className={`font-mono text-stat leading-none ${tone === 'danger' ? 'text-danger-fg' : tone === 'muted' ? 'text-muted' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}
