import { useRef } from 'react'
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react'

import type { Priority, TaskType } from '../types'
import { PRIORITY, TYPE_LABELS, buildStatus, prStatus } from './labels'
import type { Status, Tone } from './labels'

// Small shared components, built from the design tokens. Colour carries status
// only (see labels.ts), text is Inter except for refs, counts, chips and
// section labels, and the compact density tightens padding through `compact:`.

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

const TEXT: Record<Tone, string> = {
  neutral: 'text-dim', muted: 'text-muted', accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger-fg',
}

// ─── Chips and labels ─────────────────────────────────────────────────────────

const CHIP_TONE: Record<'neutral' | 'ok' | 'warn' | 'danger', string> = {
  neutral: '',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  danger: 'border-danger/30 bg-danger/10 text-danger-fg',
}

// A small tag. Neutral unless it reports a status.
export function Chip({ tone = 'neutral', title, children }: {
  tone?: keyof typeof CHIP_TONE
  title?: string
  children: ReactNode
}) {
  return <span title={title} className={cx('chip', CHIP_TONE[tone])}>{children}</span>
}

export const TypeChip = ({ type }: { type: TaskType }) => <Chip>{TYPE_LABELS[type]}</Chip>

// An item reference: US-12236, DEV-CBB875.
export const Ref = ({ children }: { children: ReactNode }) => <span className="ref">{children}</span>

// A priority dot and word. Nothing for an item without a priority.
export function PriorityBadge({ priority }: { priority: Priority }) {
  const p = PRIORITY[priority]
  if (!p) return null
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono text-meta font-semibold', TEXT[p.tone])}>
      <span aria-hidden className={cx('size-1.5 rounded-full', p.dot)} />
      {p.label}
    </span>
  )
}

// A developer's initials. Nothing when there are none.
export function Avatar({ initials, title }: { initials: string; title?: string }) {
  if (!initials) return null
  return (
    <span
      title={title}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs border border-line bg-raised font-mono text-badge font-semibold text-dim"
    >
      {initials}
    </span>
  )
}

// A section heading with an optional count and a slot on the right.
export function SectionLabel({ children, count, right }: { children: ReactNode; count?: string | number; right?: ReactNode }) {
  return (
    <div className="label mb-2 flex items-baseline gap-2 border-b border-line-soft pb-1.5">
      <span>{children}</span>
      {count !== undefined && <span className="font-mono text-meta text-muted">{count}</span>}
      {right && <span className="ml-auto normal-case tracking-normal">{right}</span>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-xs border border-line bg-raised px-1 font-mono text-badge text-muted">{children}</kbd>
}

// ─── Controls ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'quiet' | 'primary' | 'done' | 'danger'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  quiet: 'border-line-soft bg-tint/5 text-dim hover:border-line hover:text-fg',
  primary: 'border-accent bg-accent text-bg hover:brightness-110',
  done: 'border-ok/30 bg-ok/10 text-ok hover:bg-ok/20',
  danger: 'border-danger/30 bg-danger/10 text-danger-fg hover:bg-danger/20',
}

export function Button({ variant = 'quiet', className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-xs border px-2.5 py-1 text-note font-medium compact:py-0.5',
        'focus-visible:outline-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-50',
        BUTTON_VARIANT[variant],
        className,
      )}
    />
  )
}

// A tick box that screen readers and the keyboard can use.
export function Checkbox({ checked, onChange, label, disabled, title }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex size-4 shrink-0 items-center justify-center rounded-xs border text-badge focus-visible:outline-1 focus-visible:outline-focus',
        checked ? 'border-ok/60 bg-ok/15 text-ok' : 'border-muted hover:border-accent',
        disabled && 'opacity-50',
      )}
    >
      {checked ? '✓' : ''}
    </button>
  )
}

// A row of tabs. Left and right arrows (and Home and End) move between them.
export function Tabs<T extends string>({ tabs, value, onChange, label, className, tabProps, dense }: {
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (id: T) => void
  label: string
  className?: string
  // Tighter tabs, for a narrow list.
  dense?: boolean
  // Extra props for one tab, e.g. drop handlers.
  tabProps?: (id: T) => React.HTMLAttributes<HTMLButtonElement>
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length]
    onChange(next.id)
    refs.current.get(next.id)?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex(t => t.id === value)
    const key = e.key
    if (key === 'ArrowRight') move(at + 1)
    else if (key === 'ArrowLeft') move(at - 1)
    else if (key === 'Home') move(0)
    else if (key === 'End') move(tabs.length - 1)
    else return
    e.preventDefault()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx('flex border-b border-line', dense ? 'gap-0' : 'gap-1', className)}>
      {tabs.map(t => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            ref={el => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id) }}
            {...tabProps?.(t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px border-b-2 py-1.5 text-note font-medium compact:py-1 focus-visible:outline-1 focus-visible:outline-focus',
              dense ? 'px-1.5' : 'px-2.5',
              selected ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg',
              t.count !== undefined && 'whitespace-nowrap',
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="ml-1.5 font-mono text-badge">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Notes, empty and error states ────────────────────────────────────────────

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-3 py-6 text-center">
      <div className="text-note text-muted">{title}</div>
      {hint && <div className="mt-1 text-meta text-muted">{hint}</div>}
    </div>
  )
}

// An error, announced to screen readers. Dismissible when given onDismiss.
export function ErrorNote({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xs border border-danger/25 bg-danger/10 px-2 py-1.5 text-meta text-danger-fg">
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="shrink-0 hover:text-fg">✕</button>
      )}
    </div>
  )
}

// ─── Statuses ─────────────────────────────────────────────────────────────────

function StatusLabel({ status }: { status: Status | null }) {
  if (!status) return null
  return <span className={cx('font-mono text-meta font-semibold', TEXT[status.tone])}>{status.label}</span>
}

export const PrStatus = ({ pr }: { pr: { status?: string | null; isDraft?: boolean } }) => <StatusLabel status={prStatus(pr)} />
export const BuildStatus = ({ build }: { build: { result?: string | null; status?: string | null } }) => <StatusLabel status={buildStatus(build)} />
