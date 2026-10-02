import { useEffect, useMemo, useRef, useState } from 'react'

export type BootStepState = 'pending' | 'ok' | 'fail'

export interface BootStep {
  label: string
  state: BootStepState
}

const GREETINGS = [
  'Good {tod}, {name}. All systems nominal.',
  'Welcome back, {name}. The queue missed you.',
  'Access granted. Hello, {name}.',
  '{name} has entered the chat.',
  'Hey {name} — may your builds be green and your merges conflict-free.',
  'Initialization complete. Let’s ship something, {name}.',
  'Good {tod}, {name}. Coffee first, then commits.',
  'Uplink stable. Welcome to Sprint {sprint}, {name}.',
  'Hello, {name}. It works on your machine — and now on ours.',
  '{name}, your terminal awaits. No pressure.',
  'Handshake complete. Good {tod}, {name}.',
  'Authenticated as {name}. Today’s standup is loaded.',
  'sudo make-it-a-great-day --user={name}',
  'Boot sequence finished in record time. Nice to see you, {name}.',
]

const SPINNER = ['|', '/', '—', '\\']
const LABEL_WIDTH = 52
const TICK_MS = 16
const HEADER_CHARS_PER_TICK = 3
const STEP_GAP_MS = 220
const GREETING_CHARS_PER_TICK = 1
const HOLD_MS = 1600
const FADE_MS = 450

const lastLoginKey = (login: string) => `devDashboard.lastLogin.${login}`

function timeOfDay(d: Date) {
  const h = d.getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

function fillGreeting(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

// Terminal-style login shown while the dashboard's first bridge requests are
// in flight. Each step reflects a real request; the greeting types out once
// every step has resolved. Any key or click skips it.
export default function BootScreen({ login, firstName, sprintNumber, steps, summary, onDone }: {
  login: string
  firstName: string
  sprintNumber: number | null
  steps: BootStep[]
  summary: string | null
  onDone: () => void
}) {
  const header = useMemo(() => {
    let lastLogin = 'first login on this terminal'
    try {
      const saved = localStorage.getItem(lastLoginKey(login))
      if (saved) lastLogin = `Last login: ${new Date(saved).toString().slice(0, 24)} from notion-bridge:3100`
      localStorage.setItem(lastLoginKey(login), new Date().toISOString())
    } catch { /* storage unavailable */ }
    return [
      'BLUE FCU · DEV COMMAND CENTER  [tty/dev0]',
      '',
      `login: ${login}`,
      `password: ${'•'.repeat(10)}`,
      lastLogin,
      '',
    ].join('\n')
  }, [login])

  const greetingTemplate = useMemo(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)], [login])
  const greeting = fillGreeting(greetingTemplate, {
    name: firstName,
    tod: timeOfDay(new Date()),
    sprint: sprintNumber !== null ? String(sprintNumber) : '—',
  })

  const [tick, setTick] = useState(0)
  const [headerChars, setHeaderChars] = useState(0)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [greetingChars, setGreetingChars] = useState(0)
  const [fading, setFading] = useState(false)
  const lastStepAt = useRef(0)
  const finished = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onDone()
  }

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const skip = () => finish()
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  })

  // Advance the sequence one tick at a time: header → steps → greeting → fade.
  useEffect(() => {
    if (headerChars < header.length) {
      setHeaderChars(c => Math.min(header.length, c + HEADER_CHARS_PER_TICK))
      return
    }
    const now = Date.now()
    const current = steps[visibleSteps - 1]
    if (visibleSteps < steps.length) {
      if ((!current || current.state !== 'pending') && now - lastStepAt.current >= STEP_GAP_MS) {
        lastStepAt.current = now
        setVisibleSteps(v => v + 1)
      }
      return
    }
    if (current?.state === 'pending') return
    if (greetingChars < greeting.length) {
      if (now - lastStepAt.current >= STEP_GAP_MS) setGreetingChars(c => c + GREETING_CHARS_PER_TICK)
      return
    }
    if (!fading) {
      setFading(true)
      setTimeout(finish, HOLD_MS + FADE_MS)
    }
  }, [tick])

  const statusCell = (s: BootStepState) =>
    s === 'ok' ? <span className="text-ok">[  OK  ]</span>
      : s === 'fail' ? <span className="text-danger">[ FAIL ]</span>
        : <span className="text-warn">[  {SPINNER[Math.floor(tick / 6) % SPINNER.length]}   ]</span>

  const greetingDone = greetingChars >= greeting.length

  return (
    <div
      onClick={finish}
      className="boot-screen fixed inset-0 z-200 flex cursor-pointer items-center justify-center"
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease ${HOLD_MS}ms` }}
    >
      <div className="crt-scanlines pointer-events-none absolute inset-0" />
      <div className="crt-vignette pointer-events-none absolute inset-0" />

      <pre className="crt-glow relative m-0 w-[680px] max-w-full whitespace-pre-wrap p-6 font-mono text-body leading-[1.7] text-phosphor">
        <span>{header.slice(0, headerChars)}</span>
        {steps.slice(0, visibleSteps).map(step => (
          <div key={step.label}>
            <span className="text-muted">{'> '}</span>
            <span className="text-fg">{`${step.label} `.padEnd(LABEL_WIDTH, '.')}</span>
            {' '}{statusCell(step.state)}
          </div>
        ))}
        {greetingChars > 0 && (
          <div className="mt-3.5">
            <span className="crt-glow-ok font-semibold text-ok">{greeting.slice(0, greetingChars)}</span>
          </div>
        )}
        {greetingDone && summary && <div className="text-meta text-muted">{summary}</div>}
        <span className="blink mt-1 inline-block h-[15px] w-2 bg-phosphor align-text-bottom" />
        <div className="fixed inset-x-0 bottom-[18px] text-center text-meta tracking-[0.2em] text-muted">PRESS ANY KEY TO SKIP</div>
      </pre>
    </div>
  )
}
