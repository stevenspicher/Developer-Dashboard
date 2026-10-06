import { ThemeControls, useLook } from './ThemeControls'

// A style sheet for the design tokens, at /?ui=tokens. It shows every colour
// token on every surface and the shared classes, in either theme and density,
// so a theme change can be checked by eye without running the whole app.

const SURFACES = ['bg', 'surface', 'sunken', 'raised'] as const
const TEXT = [
  ['ink', 'text-ink'], ['fg', 'text-fg'], ['dim', 'text-dim'], ['muted', 'text-muted'],
  ['accent', 'text-accent'], ['ok', 'text-ok'], ['warn', 'text-warn'], ['danger', 'text-danger'], ['danger-fg', 'text-danger-fg'],
] as const
const SURFACE_CLASS: Record<(typeof SURFACES)[number], string> = {
  bg: 'bg-bg', surface: 'bg-surface', sunken: 'bg-sunken', raised: 'bg-raised',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="label mb-3 border-b border-line pb-1.5">{title}</h2>
      {children}
    </section>
  )
}

export default function TokenSheet() {
  const look = useLook()

  return (
    <div className="h-screen overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-display font-bold text-ink">Design tokens</h1>
        <ThemeControls look={look} />
      </div>

      <Section title="TEXT ON SURFACES">
        <div className="grid grid-cols-4 gap-3">
          {SURFACES.map(surface => (
            <div key={surface} className={`rounded-sm border border-line p-3 ${SURFACE_CLASS[surface]}`}>
              <div className="label mb-2">{surface}</div>
              {TEXT.map(([name, cls]) => <div key={name} className={`text-body ${cls}`}>{name} · The quick brown fox</div>)}
              <div className="text-body text-faint">faint · decoration only</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="TYPE SCALE">
        <div className="flex flex-col gap-1">
          <div className="text-display font-bold text-ink">display 21 · Standup, Tuesday</div>
          <div className="text-title font-bold text-ink">title 18 · Late-fees calculation</div>
          <div className="text-stat text-ink">stat 16 · 14/14</div>
          <div className="text-read text-fg">read 14 · Description text for reading</div>
          <div className="text-body text-fg">body 13 · Row titles and form text</div>
          <div className="text-note text-dim">note 12 · Secondary lines and previews</div>
          <div className="text-meta text-muted">meta 11 · Metadata and hints</div>
          <div className="text-badge text-muted">badge 10 · Counters and badges only</div>
          <div className="label">label · section heading</div>
        </div>
      </Section>

      <Section title="COMPONENTS">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="chip">STORY</span><span className="chip">Active</span><span className="chip">3 pt</span>
          <span className="ref">US-12236</span>
          <button className="btn-quiet">▶ START</button><button className="btn-quiet" disabled>DISABLED</button>
          <a href="#tokens" className="link text-body">a link</a>
          <span className="inline-flex items-center gap-1.5 text-note text-danger"><span className="size-2 rounded-full bg-danger" />CRIT</span>
          <span className="inline-flex items-center gap-1.5 text-note text-warn"><span className="size-2 rounded-full bg-warn" />HIGH</span>
          <span className="inline-flex items-center gap-1.5 text-note text-ok"><span className="size-2 rounded-full bg-ok" />Working</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="panel">
            <div className="p-3 text-body">A panel, on --surface.</div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="row border-b border-line-soft px-2 py-2 text-body" tabIndex={0}>A keyboard row (hover or focus)</div>
            <div className="row-flash rounded-xs px-2 py-2 text-body">A row that has just been highlighted</div>
            <input className="rounded-xs border border-line-soft bg-sunken px-2 py-1.5 text-body text-fg placeholder:text-muted focus:border-focus focus:outline-none" placeholder="An input" />
          </div>
          <div className="drop-zone rounded-xs border border-line p-3 text-note" data-drop="on">Drop target, active</div>
          <div className="drop-zone drop-zone-blocked rounded-xs border border-line p-3 text-note" data-drop="on">Blocked drop target, active</div>
          <div className="rounded-xs border border-line-soft bg-tint/5 p-3 text-note">A tint wash (bg-tint/5)</div>
        </div>
      </Section>

      <Section title="BOOT SCREEN">
        <div className="boot-screen relative h-40 overflow-hidden rounded-sm border border-line">
          <div className="crt-scanlines pointer-events-none absolute inset-0" />
          <div className="crt-vignette pointer-events-none absolute inset-0" />
          <pre className="crt-glow relative m-0 p-4 font-mono text-body leading-[1.7] text-phosphor">
            <span className="text-muted">{'> '}</span><span className="text-fg">syncing current sprint </span><span className="text-ok">[  OK  ]</span>{'\n'}
            <span className="text-muted">{'> '}</span><span className="text-fg">loading queues </span><span className="text-warn">[ ⠋ ]</span>{'\n'}
            <span className="crt-glow-ok font-semibold text-ok">Welcome back, Ada.</span>
          </pre>
        </div>
      </Section>
    </div>
  )
}
