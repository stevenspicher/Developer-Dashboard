import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { Initiative, Priority, QueueSource, Status, Task, TaskType } from './types'
import {
  BRIDGE_REFRESH_MS, CALENDAR_LOOKAHEAD_DAYS, CONTEXT_REFRESH_MS, DEADLINE_TICKER_DAYS,
  ADO_STORIES_ENABLED, DEVELOPER_STORAGE_KEY, STALE_STANDUP_DAYS, TEST_DEVELOPERS,
  QUEUES, addDays, daysBetween, deadlineTickerText, fetchCurrentSprint, fetchDeadlines,
  fetchStandup, formatSprintRange, loadDeveloper, loadLanes, localIsoDate, queueFor, shortDate, updateLanes,
} from './bridge'
import type { BriefLine, Deadline, RelatedEntity, Sprint, StandupBrief } from './bridge'
import BootScreen from './BootScreen'
import type { BootStep, BootStepState } from './BootScreen'

// ─── Config ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  critical: { label: 'CRIT', color: '#ff3355' },
  high:     { label: 'HIGH', color: '#ffaa00' },
  medium:   { label: 'MED',  color: '#00d4ff' },
  low:      { label: 'LOW',  color: '#4a6a84' },
  none:     { label: '—',    color: '#4a6a84' },
}

const TYPE_CONFIG: Record<TaskType, { label: string; cls: string }> = {
  story:    { label: 'STORY',    cls: 'tag-story' },
  task:     { label: 'TASK',     cls: 'tag-task'  },
  bug:      { label: 'BUG',      cls: 'tag-bug'   },
  spike:    { label: 'SPIKE',    cls: 'tag-spike' },
  alert:    { label: 'ALERT',    cls: 'tag-bug'   },
  ticket:   { label: 'TICKET',   cls: 'tag-spike' },
  incident: { label: 'INCIDENT', cls: 'tag-bug'   },
}

const SOURCE_TABS = ([
  { id: 'stories',    label: 'Stories',    color: '#a855f7' },
  { id: 'tasks',      label: 'Tasks',      color: '#00d4ff' },
  { id: 'pulse',      label: 'Pulse',      color: '#00ff88' },
  { id: 'solarwinds', label: 'Solarwinds', color: '#ffaa00' },
  { id: 'zendesk',    label: 'Zendesk',    color: '#f97316' },
  { id: 'ads',        label: 'ADS',        color: '#60a5fa' },
] satisfies { id: QueueSource; label: string; color: string }[])
  // Only sources with a live queue: Zendesk and ADS have none yet, and Stories
  // is off while ado-bridge serves mock data.
  .filter(tab => QUEUES.some(q => q.source === tab.id))

const ASSIGNEE_COLORS: Record<string, string> = {
  JR: '#00d4ff', MK: '#a855f7', AR: '#00ff88',
}

const STATUS_COLORS = {
  'on-track': '#00ff88',
  'at-risk':  '#ffaa00',
  'blocked':  '#ff3355',
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function ProgressBar({ value, color = '#00d4ff' }: { value: number; color?: string }) {
  return (
    <div className="progress-bar">
      <div className="progress-fill" style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
    </div>
  )
}

function Avatar({ initials, color = '#00d4ff' }: { initials: string; color?: string }) {
  return (
    <div style={{ width: 22, height: 22, borderRadius: 2, background: `${color}22`, border: `1px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700, color, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`tag ${cls}`}>{children}</span>
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function DoneButton({ onDone, size = 8 }: { onDone: () => void; size?: number }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onDone() }}
      title="Mark done in Notion"
      style={{ fontFamily: 'JetBrains Mono', fontSize: size, color: '#00ff88', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.3)', padding: '1px 5px', borderRadius: 2, cursor: 'pointer', letterSpacing: '0.08em' }}
    >✓ DONE</button>
  )
}

function TaskCard({ task, onDragStart, compact = false, onClick, onDone }: {
  task: Task
  onDragStart: (e: React.DragEvent, id: string) => void
  compact?: boolean
  onClick?: () => void
  onDone?: () => void
}) {
  const pc = PRIORITY_CONFIG[task.priority]
  const tc = TYPE_CONFIG[task.type]
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, task.id)}
      onClick={onClick}
      className="task-card panel"
      style={{ padding: compact ? '7px 9px' : '10px 12px', marginBottom: 5, borderColor: 'rgba(0,180,220,0.12)', cursor: 'grab' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <Tag cls={tc.cls}>{tc.label}</Tag>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#4a6a84' }}>{task.ref ?? task.id}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: pc.color, fontWeight: 700 }}>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: pc.color, marginRight: 4, boxShadow: `0 0 4px ${pc.color}` }} />
            {pc.label}
          </span>
          {task.points && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 2, color: '#7aa0c0' }}>{task.points}pt</span>}
          {task.severity && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'rgba(255,51,85,0.1)', padding: '1px 5px', borderRadius: 2, color: '#ff6680', border: '1px solid rgba(255,51,85,0.2)' }}>{task.severity}</span>}
          {onDone && <DoneButton onDone={onDone} />}
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: '#e0f0ff', lineHeight: 1.4, marginBottom: compact ? 0 : 5 }}>{task.title}</div>

      {!compact && (
        <>
          {task.notes && (
            <div style={{ fontSize: 10, color: '#7aa0c0', lineHeight: 1.45, marginBottom: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.notes}</div>
          )}
          {task.progress > 0 && (
            <div style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>PROGRESS</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff' }}>{task.progress}%</span>
              </div>
              <ProgressBar value={task.progress} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            {task.assignee && <Avatar initials={task.assignee} color={ASSIGNEE_COLORS[task.assignee] || '#00d4ff'} />}
            {task.affectedSystem && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.affectedSystem}</span>}
            {task.branch && !task.affectedSystem && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>⎇ {task.branch}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {task.standupAgeDays !== undefined && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: task.standupAgeDays > STALE_STANDUP_DAYS ? '#ffaa00' : '#4a6a84' }}>STANDUP {task.standupAgeDays}d</span>}
              {task.comments > 0 && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>💬 {task.comments}</span>}
              {task.sprint && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>{task.sprint}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const pc = PRIORITY_CONFIG[task.priority]
  const tc = TYPE_CONFIG[task.type]
  const srcTab = SOURCE_TABS.find(s => s.id === task.source)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="panel hud-corner" style={{ width: 680, maxHeight: '82vh', display: 'flex', flexDirection: 'column', borderColor: 'rgba(0,212,255,0.35)', boxShadow: '0 0 60px rgba(0,212,255,0.12), 0 0 120px rgba(0,0,0,0.8)' }}>
        {/* Modal header */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,212,255,0.15)', background: 'rgba(0,212,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Tag cls={tc.cls}>{tc.label}</Tag>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#4a6a84' }}>{task.ref ?? task.id}</span>
          {srcTab && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, padding: '1px 6px', borderRadius: 2, background: `${srcTab.color}18`, border: `1px solid ${srcTab.color}44`, color: srcTab.color }}>via {srcTab.label}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: pc.color, fontWeight: 700 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: pc.color, marginRight: 5, boxShadow: `0 0 6px ${pc.color}` }} />
              {pc.label}
            </span>
            {task.points && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, background: 'rgba(255,255,255,0.07)', padding: '2px 8px', borderRadius: 2, color: '#7aa0c0' }}>{task.points} pts</span>}
            <button onClick={onClose} style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#4a6a84', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', width: 24, height: 24, borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Title + assignee */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#e0f0ff', lineHeight: 1.3, marginBottom: 6 }}>{task.title}</div>
              <div style={{ fontSize: 12, color: '#8ab0cc', lineHeight: 1.6 }}>{task.description}</div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <Avatar initials={task.assignee} color={ASSIGNEE_COLORS[task.assignee] || '#00d4ff'} />
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>{task.assignee}</span>
              {task.sprint && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>{task.sprint}</span>}
            </div>
          </div>

          {/* Metadata row */}
          {(task.affectedSystem || task.environment || task.reportedBy || task.branch) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {task.affectedSystem && <MetaBadge label="SYSTEM" value={task.affectedSystem} />}
              {task.environment && <MetaBadge label="ENV" value={task.environment} color="#ffaa00" />}
              {task.reportedBy && <MetaBadge label="REPORTED BY" value={task.reportedBy} />}
              {task.branch && <MetaBadge label="BRANCH" value={`⎇ ${task.branch}`} color="#00d4ff" />}
              {task.severity && <MetaBadge label="SEVERITY" value={task.severity} color="#ff3355" />}
            </div>
          )}

          {/* Progress if any */}
          {task.progress > 0 && (
            <div style={{ padding: '10px 12px', background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)', borderRadius: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', letterSpacing: '0.1em' }}>COMPLETION</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: '#00d4ff', fontWeight: 700 }}>{task.progress}%</span>
              </div>
              <ProgressBar value={task.progress} />
            </div>
          )}

          {/* Acceptance criteria */}
          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
            <Section label="ACCEPTANCE CRITERIA">
              {task.acceptanceCriteria.map((ac, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: i < task.acceptanceCriteria!.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span style={{ color: '#00ff88', fontSize: 11, flexShrink: 0, marginTop: 1 }}>◇</span>
                  <span style={{ fontSize: 12, color: '#c8dff0', lineHeight: 1.4 }}>{ac}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Subtasks */}
          {task.subtasks && task.subtasks.length > 0 && (
            <Section label={`SUBTASKS — ${task.subtasks.filter(s => s.done).length}/${task.subtasks.length}`}>
              {task.subtasks.map((sub, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.04)', marginBottom: 3 }}>
                  <div style={{ width: 13, height: 13, borderRadius: 2, border: `1px solid ${sub.done ? '#00ff88' : '#4a6a84'}`, background: sub.done ? 'rgba(0,255,136,0.12)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {sub.done && <span style={{ color: '#00ff88', fontSize: 9 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 12, color: sub.done ? '#4a6a84' : '#c8dff0', textDecoration: sub.done ? 'line-through' : 'none' }}>{sub.title}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Initiative */}
          {task.initiative && <InitiativePanel initiative={task.initiative} />}

          {/* Tags */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {task.tags.map(t => (
              <span key={t} style={{ fontFamily: 'JetBrains Mono', fontSize: 9, padding: '2px 7px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, color: '#7aa0c0' }}>#{t}</span>
            ))}
          </div>

          {/* Activity */}
          {task.activity && task.activity.length > 0 && (
            <Section label="ACTIVITY">
              {task.activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: i < task.activity!.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <Avatar initials={a.user} color={ASSIGNEE_COLORS[a.user] || '#4a6a84'} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: '#c8dff0' }}>{a.text}</span>
                  </div>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', flexShrink: 0 }}>{a.time}</span>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function MetaBadge({ label, value, color = '#7aa0c0' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color }}>{value}</div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.12em', color: '#4a6a84', marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{label}</div>
      {children}
    </div>
  )
}

function InitiativePanel({ initiative }: { initiative: Initiative }) {
  const sc = STATUS_COLORS[initiative.status]
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${sc}33`, borderRadius: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.12em', color: '#4a6a84' }}>INITIATIVE</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: sc, background: `${sc}18`, padding: '1px 6px', borderRadius: 2 }}>{initiative.status.toUpperCase().replace('-', ' ')}</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', marginLeft: 'auto' }}>Due {initiative.dueDate}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e0f0ff', marginBottom: 4 }}>{initiative.id} · {initiative.name}</div>
      <div style={{ fontSize: 11, color: '#7aa0c0', lineHeight: 1.5, marginBottom: 8 }}>{initiative.goal}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>PROGRESS</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: sc }}>{initiative.progress}%</span>
      </div>
      <ProgressBar value={initiative.progress} color={sc} />
    </div>
  )
}

// ─── Working Space ────────────────────────────────────────────────────────────

const RELATION_LABELS: Record<string, string> = { initiative: 'INITIATIVE', issue: 'ISSUE', analystIssue: 'ANALYST ISSUE', parent: 'PARENT' }
const RELATION_FIELDS: Record<string, string[]> = {
  initiative: ['Status', 'Impact', 'Deadline', 'Countdown'],
  issue: ['Status', 'Priority'],
  analystIssue: ['Status', 'Priority'],
  parent: ['State', 'Assigned To', 'Iteration'],
}
const RELATION_TEXT_FIELDS = ['Description', 'Notes']

const linkTarget = (url: string) => (url.includes('dev.azure.com') ? 'ADO' : 'NOTION')

// ADO parents are labelled by their work item type (FEATURE, EPIC, …).
const relationLabel = (entity: RelatedEntity) => {
  const type = entity.relation === 'parent' ? entity.properties?.find(p => p.name === 'Type')?.value : undefined
  return (type || RELATION_LABELS[entity.relation] || entity.relation).toUpperCase()
}

function RelatedCard({ entity, onOpen }: { entity: RelatedEntity; onOpen: () => void }) {
  const prop = (name: string) => entity.properties?.find(p => p.name === name)?.value ?? ''
  const fields = (RELATION_FIELDS[entity.relation] ?? []).map(name => [name, prop(name)] as const).filter(([, v]) => v)
  const text = RELATION_TEXT_FIELDS.map(prop).find(Boolean) || entity.content || ''
  return (
    <div onClick={entity.error ? undefined : onOpen} title={entity.error ? undefined : 'Click to expand'} style={{ padding: '8px 9px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.14)', borderRadius: 3, cursor: entity.error ? 'default' : 'zoom-in' }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.12em', color: '#4a6a84', marginBottom: 4 }}>{relationLabel(entity)}</div>
      {entity.error ? (
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#ff6680' }}>Unavailable — {entity.error}</div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#e0f0ff', lineHeight: 1.3, marginBottom: 5 }}>{entity.title}</div>
          {fields.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>
              {fields.map(([name, value]) => (
                <span key={name} style={{ fontFamily: 'JetBrains Mono', fontSize: 8, padding: '1px 5px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, color: '#9bbdd4' }}>
                  <span style={{ color: '#4a6a84' }}>{name.toUpperCase()} </span>{value}
                </span>
              ))}
            </div>
          )}
          {text && <div style={{ fontSize: 10, color: '#7aa0c0', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-line' }}>{text}</div>}
          {entity.url && <a href={entity.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'inline-block', marginTop: 5, fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff', textDecoration: 'none' }}>OPEN IN {linkTarget(entity.url)} ↗</a>}
        </>
      )}
    </div>
  )
}

function RelatedPanel({ related }: { related: RelatedEntity[] | 'loading' | { error: string } | undefined }) {
  if (related === undefined || related === 'loading') {
    return <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>LOADING CONTEXT…</span>
  }
  if (!Array.isArray(related)) {
    return <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#ff6680' }}>{related.error}</span>
  }
  const linked = related.filter(r => !r.empty)
  if (linked.length === 0) {
    return <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', opacity: 0.6 }}>No linked initiative, issue, or parent</span>
  }
  return <RelatedCards linked={linked} />
}

function RelatedCards({ linked }: { linked: RelatedEntity[] }) {
  const [open, setOpen] = useState<RelatedEntity | null>(null)
  return (
    <>
      {linked.map(r => <RelatedCard key={`${r.relation}:${r.id}`} entity={r} onOpen={() => setOpen(r)} />)}
      {open && <RelatedModal entity={open} onClose={() => setOpen(null)} />}
    </>
  )
}

const notionPageUrl = (id: string) => `https://app.notion.com/p/${id.replace(/-/g, '')}`

function RelatedModal({ entity, onClose }: { entity: RelatedEntity; onClose: () => void }) {
  const props = (entity.properties ?? []).filter(p => p.value && p.type !== 'relation')
  const longText = props.filter(p => RELATION_TEXT_FIELDS.includes(p.name))
  const fields = props.filter(p => !RELATION_TEXT_FIELDS.includes(p.name))
  const content = (entity.content ?? '').split('\n').filter(l => !l.startsWith('[Sub-page:')).join('\n').trim()
  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,212,255,0.15)', background: 'rgba(0,212,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.12em', color: '#00d4ff' }}>{relationLabel(entity)}</span>
        {entity.url && <a href={entity.url} target="_blank" rel="noreferrer" style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#00d4ff', textDecoration: 'none' }}>OPEN IN {linkTarget(entity.url)} ↗</a>}
        <button onClick={onClose} title="Close (Esc)" style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 11, color: '#4a6a84', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', width: 24, height: 24, borderRadius: 3, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, zoom: 1.2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#e0f0ff', lineHeight: 1.3 }}>{entity.title}</div>
        {fields.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {fields.map(p => <MetaBadge key={p.name} label={p.name.toUpperCase()} value={p.value} />)}
          </div>
        )}
        {longText.map(p => (
          <Section key={p.name} label={p.name.toUpperCase()}>
            <div style={{ fontSize: 12, color: '#c8dff0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.value}</div>
          </Section>
        ))}
        {content && (
          <Section label="PAGE CONTENT">
            <div style={{ fontSize: 12, color: '#c8dff0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{content}</div>
          </Section>
        )}
        {entity.sub_pages && entity.sub_pages.length > 0 && (
          <Section label={`SUB-PAGES — ${entity.sub_pages.length}`}>
            {entity.sub_pages.map(sp => (
              <a key={sp.id} href={notionPageUrl(sp.id)} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '4px 0', fontSize: 12, color: '#00d4ff', textDecoration: 'none' }}>{sp.title || 'Untitled'} ↗</a>
            ))}
          </Section>
        )}
        {!content && longText.length === 0 && (
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#4a6a84' }}>No description or page content.</span>
        )}
      </div>
    </Overlay>
  )
}

function WorkingSpace({ task, related, onClear, onDone, onDragStart }: {
  task: Task | null
  related?: RelatedEntity[] | 'loading' | { error: string }
  onClear: () => void
  onDone?: () => void
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  if (!task) {
    return (
      <div className="panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: 'rgba(0,212,255,0.18)', minHeight: 200 }}>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#4a6a84', textAlign: 'center', letterSpacing: '0.1em' }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.25 }}>◈</div>
          DRAG ANY ITEM HERE<br />
          <span style={{ fontSize: 9, opacity: 0.5 }}>TO BEGIN WORKING</span>
        </div>
      </div>
    )
  }

  const pc = PRIORITY_CONFIG[task.priority]
  const tc = TYPE_CONFIG[task.type]
  const doneSubs = task.subtasks?.filter(s => s.done).length ?? 0
  const totalSubs = task.subtasks?.length ?? 0

  return (
    <div className="panel hud-corner" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderColor: 'rgba(0,212,255,0.28)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(90deg, rgba(0,212,255,0.1), transparent)', padding: '7px 12px', borderBottom: '1px solid rgba(0,212,255,0.15)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00ff88', boxShadow: '0 0 8px #00ff88', flexShrink: 0 }} className="pulse" />
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: '#00d4ff' }}>ACTIVE</span>
        <Tag cls={tc.cls}>{tc.label}</Tag>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#4a6a84' }}>{task.ref ?? task.id}</span>
        {task.url && <a href={task.url} target="_blank" rel="noreferrer" style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff', textDecoration: 'none' }}>{linkTarget(task.url)} ↗</a>}
        {task.link && <a href={task.link} target="_blank" rel="noreferrer" style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff', textDecoration: 'none' }}>TICKET ↗</a>}
        <span style={{ marginLeft: 'auto' }} />
        {onDone && <DoneButton onDone={onDone} size={9} />}
        <button
          draggable
          onDragStart={e => onDragStart(e, task.id)}
          onClick={onClear}
          style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 2, cursor: 'pointer', letterSpacing: '0.1em' }}
          title="Drag back to queue or click to clear"
        >RETURN ×</button>
      </div>

      {/* Two-col body: task detail | initiative context */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: task details */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderRight: '1px solid rgba(0,212,255,0.08)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e0f0ff', lineHeight: 1.3, marginBottom: 4 }}>{task.title}</div>
                <div style={{ fontSize: 11, color: '#7aa0c0', lineHeight: 1.5 }}>{task.description}</div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: pc.color, fontWeight: 700 }}>{pc.label}</span>
                {task.points && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>{task.points}pt</span>}
                {task.assignee && <Avatar initials={task.assignee} color={ASSIGNEE_COLORS[task.assignee] || '#00d4ff'} />}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {task.tags.map(t => (
                <span key={t} style={{ fontFamily: 'JetBrains Mono', fontSize: 8, padding: '1px 5px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2, color: '#7aa0c0' }}>#{t}</span>
              ))}
            </div>
          </div>

          {task.progress > 0 && (
            <div style={{ padding: '8px 10px', background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.1)', borderRadius: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', letterSpacing: '0.1em' }}>COMPLETION</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#00d4ff', fontWeight: 700 }}>{task.progress}%</span>
              </div>
              <ProgressBar value={task.progress} />
            </div>
          )}

          {task.subtasks && task.subtasks.length > 0 && (
            <div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.1em', color: '#4a6a84', marginBottom: 5 }}>SUBTASKS — {doneSubs}/{totalSubs}</div>
              {task.subtasks.map((sub, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 7px', background: 'rgba(255,255,255,0.02)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.04)', marginBottom: 3 }}>
                  <div style={{ width: 11, height: 11, borderRadius: 2, border: `1px solid ${sub.done ? '#00ff88' : '#4a6a84'}`, background: sub.done ? 'rgba(0,255,136,0.12)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {sub.done && <span style={{ color: '#00ff88', fontSize: 8 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 11, color: sub.done ? '#4a6a84' : '#c8dff0', textDecoration: sub.done ? 'line-through' : 'none' }}>{sub.title}</span>
                </div>
              ))}
            </div>
          )}

          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
            <div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.1em', color: '#4a6a84', marginBottom: 5 }}>ACCEPTANCE CRITERIA</div>
              {task.acceptanceCriteria.map((ac, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, padding: '3px 0', fontSize: 11, color: '#c8dff0', lineHeight: 1.4 }}>
                  <span style={{ color: '#00ff88', flexShrink: 0 }}>◇</span>{ac}
                </div>
              ))}
            </div>
          )}

          {task.branch && (
            <div style={{ padding: '5px 9px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3, fontFamily: 'JetBrains Mono', fontSize: 9, color: '#7aa0c0' }}>
              <span style={{ color: '#4a6a84' }}>git checkout </span>{task.branch}
            </div>
          )}
        </div>

        {/* Right: initiative/project context */}
        <div style={{ width: task.queue ? 250 : 200, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.15em', color: '#4a6a84', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>PROJECT CONTEXT</div>

          {task.queue ? (
            <RelatedPanel related={related} />
          ) : task.initiative ? (
            <>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', marginBottom: 4 }}>INITIATIVE</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e0f0ff', lineHeight: 1.3, marginBottom: 3 }}>{task.initiative.name}</div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: STATUS_COLORS[task.initiative.status] }}>{task.initiative.id} · {task.initiative.status.toUpperCase().replace('-', ' ')}</div>
              </div>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', marginBottom: 3 }}>GOAL</div>
                <div style={{ fontSize: 10, color: '#7aa0c0', lineHeight: 1.5 }}>{task.initiative.goal}</div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>INITIATIVE PROGRESS</span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: STATUS_COLORS[task.initiative.status] }}>{task.initiative.progress}%</span>
                </div>
                <ProgressBar value={task.initiative.progress} color={STATUS_COLORS[task.initiative.status]} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: '#4a6a84', marginBottom: 2 }}>DUE</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#c8dff0' }}>{task.initiative.dueDate}</div>
                </div>
                <div style={{ flex: 1, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: '#4a6a84', marginBottom: 2 }}>OWNER</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: ASSIGNEE_COLORS[task.initiative.owner] || '#c8dff0' }}>{task.initiative.owner}</div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {task.affectedSystem && (
                <ContextField label="AFFECTED SYSTEM" value={task.affectedSystem} color="#ffaa00" />
              )}
              {task.environment && (
                <ContextField label="ENVIRONMENT" value={task.environment} color="#ffaa00" />
              )}
              {task.reportedBy && (
                <ContextField label="REPORTED BY" value={task.reportedBy} />
              )}
              {task.severity && (
                <ContextField label="SEVERITY" value={task.severity} color="#ff3355" />
              )}
              {!task.affectedSystem && !task.reportedBy && (
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', opacity: 0.5 }}>No initiative linked</span>
              )}
            </div>
          )}

          {task.activity && task.activity.length > 0 && (
            <div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', marginBottom: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>RECENT ACTIVITY</div>
              {task.activity.map((a, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 2 }}>
                    <Avatar initials={a.user} color={ASSIGNEE_COLORS[a.user] || '#4a6a84'} />
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>{a.time}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#7aa0c0', lineHeight: 1.4, paddingLeft: 27 }}>{a.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ContextField({ label, value, color = '#c8dff0' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: '#4a6a84', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color }}>{value}</div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<'today' | 'working' | 'blocked' | 'queue' | null>(null)
  const [centerTab, setCenterTab] = useState<'brief' | 'calendar'>('brief')
  const [queueTab, setQueueTab] = useState<QueueSource>(SOURCE_TABS[0].id)
  const [modalTask, setModalTask] = useState<Task | null>(null)
  const [time, setTime] = useState(new Date())
  const [bridgeLoading, setBridgeLoading] = useState(true)
  const [bridgeErrors, setBridgeErrors] = useState<Partial<Record<QueueSource, string>>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [sprint, setSprint] = useState<Sprint | null>(null)
  const [developer, setDeveloper] = useState(loadDeveloper)
  const [brief, setBrief] = useState<StandupBrief | { error: string } | null>(null)
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [related, setRelated] = useState<Record<string, RelatedEntity[] | 'loading' | { error: string }>>({})
  const [reader, setReader] = useState<ReaderTab | null>(null)
  const [booting, setBooting] = useState(true)
  const [sprintStatus, setSprintStatus] = useState<BootStepState>('pending')
  const [deadlinesStatus, setDeadlinesStatus] = useState<BootStepState>('pending')

  const changeDeveloper = (email: string) => {
    try { localStorage.setItem(DEVELOPER_STORAGE_KEY, email) } catch { /* storage unavailable */ }
    const bridgeSources = new Set(QUEUES.map(q => q.source))
    setTasks(prev => prev.filter(t => !bridgeSources.has(t.source)))
    setBridgeLoading(true)
    setBrief(null)
    setActionError(null)
    setSprintStatus('pending')
    setDeadlinesStatus('pending')
    setBooting(true)
    setDeveloper(email)
  }

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Queues: rebuilt from the bridge on every refresh, with each item placed in
  // its saved lane (claimed Pulse items default to Todo).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const currentSprint = await fetchCurrentSprint().catch(() => null)
      if (cancelled) return
      setSprint(currentSprint)
      setSprintStatus(currentSprint ? 'ok' : 'fail')

      const results = await Promise.allSettled(QUEUES.map(q => q.load(developer, currentSprint)))
      if (cancelled) return

      const errors: Partial<Record<QueueSource, string>> = {}
      QUEUES.forEach((q, i) => {
        const r = results[i]
        if (r.status === 'rejected') errors[q.source] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      })
      const lanes = loadLanes(developer)
      setTasks(prev => {
        let next = prev
        QUEUES.forEach((q, i) => {
          const r = results[i]
          if (r.status === 'rejected') return
          const claimedIds = new Set(r.value.claimedIds)
          // A source-reported Blocked always wins; otherwise the saved lane, then
          // the source's hint, then claimed → Todo.
          const laneFor = (id: string): Status => {
            const hinted = r.value.lanes?.[id]
            if (hinted === 'blocked') return 'blocked'
            return lanes[id] ?? hinted ?? (claimedIds.has(id) ? 'today' : 'queue')
          }
          const fresh = r.value.items.map(task => ({ ...task, status: laneFor(task.id) }))
          next = [...next.filter(t => t.source !== q.source), ...fresh]
        })
        return next
      })
      setBridgeErrors(errors)
      setBridgeLoading(false)
    }
    load()
    const t = setInterval(load, BRIDGE_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  // Standup brief + deadlines change at most daily; poll every 5 minutes so a
  // newly generated brief shows up without a reload.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [b, d] = await Promise.allSettled([fetchStandup(developer), fetchDeadlines()])
      if (cancelled) return
      setBrief(b.status === 'fulfilled' ? b.value : { error: b.reason instanceof Error ? b.reason.message : String(b.reason) })
      if (d.status === 'fulfilled') setDeadlines(d.value)
      setDeadlinesStatus(d.status === 'fulfilled' ? 'ok' : 'fail')
    }
    load()
    const t = setInterval(load, CONTEXT_REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [developer])

  const workingTask = tasks.find(t => t.status === 'working') ?? null

  // Related Initiative / Issue / Analyst Issue for the active item.
  useEffect(() => {
    if (!workingTask?.queue || related[workingTask.id]) return
    const { id } = workingTask
    setRelated(prev => ({ ...prev, [id]: 'loading' }))
    const adapter = queueFor(workingTask)
    if (!adapter?.related) return
    adapter.related(workingTask)
      .then(r => setRelated(prev => ({ ...prev, [id]: r })))
      .catch(e => setRelated(prev => ({ ...prev, [id]: { error: e instanceof Error ? e.message : String(e) } })))
  }, [workingTask, related])

  // Move a card between lanes. Only one item can be in Working; the previous
  // one drops back to Todo. Claimable queues claim on leaving the queue and
  // release on returning to it; a failed write puts the card back.
  const moveTask = async (id: string, to: Status) => {
    const task = tasks.find(t => t.id === id)
    if (!task || task.status === to) return
    const from = task.status
    const displaced = to === 'working' ? tasks.find(t => t.status === 'working' && t.id !== id) : undefined

    const setLane = (lane: Status, displacedLane?: Status) => {
      setTasks(prev => prev.map(t =>
        t.id === id ? { ...t, status: lane } : displaced && t.id === displaced.id && displacedLane ? { ...t, status: displacedLane } : t))
      updateLanes(developer, { [id]: lane, ...(displaced && displacedLane ? { [displaced.id]: displacedLane } : {}) })
    }
    setLane(to, 'today')
    setActionError(null)

    const move = queueFor(task)?.move
    if (!move) return
    try {
      const patch = await move(task, from, to, developer)
      if (patch) setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    } catch (e) {
      setLane(from, 'working')
      setActionError(`Couldn't move ${task.ref ?? task.title}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const markDone = async (task: Task) => {
    const done = queueFor(task)?.done
    if (!done) return
    setActionError(null)
    try {
      await done(task, developer)
      setTasks(prev => prev.filter(t => t.id !== task.id))
      updateLanes(developer, { [task.id]: null })
      setModalTask(m => (m?.id === task.id ? null : m))
    } catch (e) {
      setActionError(`Couldn't mark ${task.ref ?? task.title} done: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const doneHandler = (task: Task) => (queueFor(task)?.done ? () => markDone(task) : undefined)

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [])

  const handleDrop = (e: React.DragEvent, zone: Status) => {
    e.preventDefault()
    setDropTarget(null)
    if (dragId) moveTask(dragId, zone)
    setDragId(null)
  }

  const handleDragOver = useCallback((e: React.DragEvent, zone: 'today' | 'working' | 'blocked' | 'queue') => {
    e.preventDefault()
    setDropTarget(zone)
  }, [])

  const handleDragLeave = useCallback(() => setDropTarget(null), [])

  const queueTasks = tasks.filter(t => t.status === 'queue' && t.source === queueTab)
  const todayTasks = tasks.filter(t => t.status === 'today')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')

  const allQueueTasks = tasks.filter(t => t.status === 'queue')
  const sprintProgress = 28

  const today = localIsoDate(time)
  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dateStr = `${shortDate(today)} · ${time.getFullYear()}`
  const activeSrc = SOURCE_TABS.find(s => s.id === queueTab)!
  const sprintHeader = sprint ? [sprint.name.toUpperCase(), formatSprintRange(sprint)].filter(Boolean).join(' · ') : 'SPRINT —'
  const sprintDaysLeft = sprint?.end ? Math.max(0, daysBetween(today, sprint.end)) : null

  const briefData = brief && !('error' in brief) ? brief : null
  const tickerItems = [
    ...(briefData?.teamItems ?? []).map(l => ({ src: 'TEAM', text: l.text })),
    ...deadlines
      .map(d => deadlineTickerText(d, today, DEADLINE_TICKER_DAYS))
      .filter((t): t is string => t !== null)
      .map(text => ({ src: 'DATE', text })),
  ]
  const calendarEnd = sprint?.end ? addDays(sprint.end, CALENDAR_LOOKAHEAD_DAYS) : addDays(today, CALENDAR_LOOKAHEAD_DAYS)
  const calendarItems = deadlines
    .filter(d => (d.end ?? d.start) >= today && d.start <= calendarEnd)
    .sort((a, b) => a.start.localeCompare(b.start))
  const queuesFailed = QUEUES.every(q => bridgeErrors[q.source])
  const queuesStatus: BootStepState = bridgeLoading ? 'pending' : queuesFailed ? 'fail' : 'ok'
  const briefStatus: BootStepState = !brief ? 'pending' : 'error' in brief ? 'fail' : 'ok'
  const bootSteps: BootStep[] = [
    { label: 'establishing uplink to notion-bridge', state: sprintStatus === 'pending' ? 'pending' : sprintStatus === 'ok' || queuesStatus === 'ok' ? 'ok' : 'fail' },
    { label: 'syncing current sprint', state: sprintStatus },
    { label: `loading queues · ${ADO_STORIES_ENABLED ? 'stories / ' : ''}tasks / pulse / tickets`, state: queuesStatus },
    { label: 'compiling daily brief', state: briefStatus },
    { label: 'plotting deadlines & milestones', state: deadlinesStatus },
  ]
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const countOf = (source: QueueSource) => tasks.filter(t => t.source === source).length
  const bootSummary = [
    briefData?.mode === 'brief' && plural(briefData.responsibilities.length, 'responsibility', 'responsibilities') + ' today',
    briefData?.mode === 'brief' && briefData.aging.length > 0 && `${briefData.aging.length} aging`,
    briefData?.mode === 'leadership' && plural(briefData.summaries.length, 'developer update', 'developer updates'),
    plural(countOf('tasks'), 'task', 'tasks'),
    `${countOf('pulse')} pulse`,
    plural(countOf('solarwinds'), 'ticket', 'tickets'),
  ].filter(Boolean).join(' · ')
  const currentDeveloper = TEST_DEVELOPERS.find(d => d.email === developer)
  const openMention = (line: BriefLine) => {
    const task = tasks.find(t => line.mentions.includes(t.id))
    if (task) {
      setReader(null)
      setModalTask(task)
    }
  }

  // Scroll the ticker at a constant, readable speed regardless of how much
  // content it holds (the track is two copies, so one loop is half its width).
  const tickerRef = useRef<HTMLDivElement>(null)
  const [tickerDuration, setTickerDuration] = useState(60)
  const tickerKey = tickerItems.map(t => t.text).join('|')
  useLayoutEffect(() => {
    const width = tickerRef.current?.scrollWidth ?? 0
    if (width) setTickerDuration(Math.max(20, width / 2 / TICKER_PX_PER_SEC))
  }, [tickerKey])

  const briefView = <BriefPanel brief={brief} tasks={tasks} onOpen={openMention} today={today} />
  const calendarView = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>{sprintHeader}</span>
        {sprintDaysLeft !== null && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff' }}>{sprintDaysLeft} DAYS LEFT</span>}
      </div>
      <CalendarList items={calendarItems} sprint={sprint} today={today} />
    </div>
  )
  const tickerView = <TickerList items={tickerItems} />

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#060b14', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Header ── */}
      <header style={{ height: 46, borderBottom: '1px solid rgba(0,212,255,0.15)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, background: 'rgba(0,0,0,0.4)', flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.4)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontSize: 13, color: '#00d4ff', fontWeight: 700 }}>◈</div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#e0f0ff' }}>DEV COMMAND CENTER</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', letterSpacing: '0.08em' }}>{sprintHeader}</div>
          </div>
        </div>

        {/* Ticker */}
        <div className="ticker-wrap" onClick={() => setReader('ticker')} title="Click to read all team items and dates" style={{ flex: 1, overflow: 'hidden', margin: '0 12px', position: 'relative', cursor: 'zoom-in' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 20, background: 'linear-gradient(90deg, rgba(6,11,20,1), transparent)', zIndex: 1, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, background: 'linear-gradient(270deg, rgba(6,11,20,1), transparent)', zIndex: 1, pointerEvents: 'none' }} />
          <div ref={tickerRef} className="ticker-track" style={{ display: 'inline-flex', gap: 28, alignItems: 'center', animationDuration: `${tickerDuration}s` }}>
            {(tickerItems.length ? [...tickerItems, ...tickerItems] : [{ src: 'TEAM', text: 'No team items' }]).map((b, i) => (
              <span key={i} style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#9bbdd4', whiteSpace: 'nowrap', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#00d4ff', fontSize: 9 }}>◆</span>
                <span style={{ color: '#4a8ca8', fontSize: 8, background: 'rgba(0,212,255,0.08)', padding: '0 4px', borderRadius: 2 }}>{b.src}</span>
                {b.text}
              </span>
            ))}
          </div>
        </div>

        {/* TEMP: developer switcher for testing */}
        <select
          value={developer}
          onChange={e => changeDeveloper(e.target.value)}
          title="Viewing as developer (testing only)"
          style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#ffaa00', background: 'rgba(255,170,0,0.08)', border: '1px dashed rgba(255,170,0,0.4)', borderRadius: 3, padding: '3px 6px', flexShrink: 0, cursor: 'pointer' }}
        >
          {TEST_DEVELOPERS.map(d => <option key={d.email} value={d.email} style={{ background: '#060b14' }}>{d.name}</option>)}
        </select>

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <Stat label="SPRINT" value={`${sprintProgress}%`} color="#00d4ff" />
          <Stat label="TODAY" value={String(todayTasks.length)} color="#ffaa00" />
          <Stat label="BLOCKED" value={String(blockedTasks.length)} color={blockedTasks.length > 0 ? '#ff3355' : '#4a6a84'} />
          <div style={{ width: 1, height: 20, background: 'rgba(0,212,255,0.12)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: '#00d4ff', fontWeight: 700 }}>{timeStr}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>{dateStr}</div>
          </div>
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '272px 1fr 216px', overflow: 'hidden' }}>

        {/* ── LEFT: Queue Panel ── */}
        <div
          style={{ borderRight: '1px solid rgba(0,212,255,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'all 0.15s' }}
          className={dropTarget === 'queue' ? 'drop-active' : ''}
          onDrop={e => handleDrop(e, 'queue')}
          onDragOver={e => handleDragOver(e, 'queue')}
          onDragLeave={handleDragLeave}
        >
          {/* Header */}
          <div style={{ padding: '8px 10px 0', background: 'rgba(0,0,0,0.25)', flexShrink: 0, borderBottom: '1px solid rgba(0,212,255,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: '#00d4ff' }}>QUEUES</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', marginLeft: 'auto' }}>{allQueueTasks.length} items</span>
            </div>
            {/* Source tabs */}
            <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
              {SOURCE_TABS.map(tab => (
                <button key={tab.id} onClick={() => setQueueTab(tab.id)} style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.07em', padding: '5px 8px', border: 'none', borderBottom: `2px solid ${queueTab === tab.id ? tab.color : 'transparent'}`, background: queueTab === tab.id ? `${tab.color}10` : 'transparent', color: queueTab === tab.id ? tab.color : '#4a6a84', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.12s' }}>
                  {tab.label}
                  {(() => { const n = tasks.filter(t => t.status === 'queue' && t.source === tab.id).length; return n > 0 ? <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.7 }}>{n}</span> : null })()}
                </button>
              ))}
            </div>
          </div>

          {/* Queue list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {actionError && (
              <div onClick={() => setActionError(null)} title="Dismiss" style={{ marginBottom: 6, padding: '6px 8px', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#ff6680', background: 'rgba(255,51,85,0.08)', border: '1px solid rgba(255,51,85,0.25)', borderRadius: 2, cursor: 'pointer' }}>
                {actionError} ✕
              </div>
            )}
            {bridgeErrors[queueTab] && (
              <div style={{ marginBottom: 6, padding: '6px 8px', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#ff6680', background: 'rgba(255,51,85,0.08)', border: '1px solid rgba(255,51,85,0.25)', borderRadius: 2 }}>
                BRIDGE ERROR · {bridgeErrors[queueTab]}
              </div>
            )}
            {bridgeLoading && QUEUES.some(q => q.source === queueTab) && queueTasks.length === 0 ? (
              <div style={{ padding: '20px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>LOADING…</div>
            ) : queueTasks.length === 0 ? (
              <div style={{ padding: '20px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', opacity: 0.5 }}>NO ITEMS IN QUEUE</div>
            ) : (
              queueTasks.map(t => (
                <TaskCard key={t.id} task={t} onDragStart={handleDragStart} onClick={() => setModalTask(t)} onDone={doneHandler(t)} />
              ))
            )}
          </div>

          {/* Drop-back indicator */}
          {dropTarget === 'queue' && (
            <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.06)', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#00d4ff', textAlign: 'center', letterSpacing: '0.1em' }}>↓ RETURN TO QUEUE</div>
          )}
        </div>

        {/* ── CENTER ── */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top row: Brief + Calendar + Metrics */}
          <div style={{ height: 174, display: 'flex', borderBottom: '1px solid rgba(0,212,255,0.1)', flexShrink: 0 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(0,212,255,0.08)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,212,255,0.1)', flexShrink: 0 }}>
                {(['brief', 'calendar'] as const).map(tab => (
                  <button key={tab} onClick={() => setCenterTab(tab)} style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '7px', border: 'none', background: centerTab === tab ? 'rgba(0,212,255,0.07)' : 'transparent', color: centerTab === tab ? '#00d4ff' : '#4a6a84', cursor: 'pointer', borderBottom: centerTab === tab ? '2px solid #00d4ff' : '2px solid transparent' }}>
                    {tab === 'brief' ? '◉ DAILY BRIEF' : '◈ SPRINT CALENDAR'}
                  </button>
                ))}
                <button onClick={() => setReader(centerTab)} title="Expand" style={{ fontFamily: 'JetBrains Mono', fontSize: 11, padding: '0 10px', border: 'none', borderLeft: '1px solid rgba(0,212,255,0.1)', background: 'transparent', color: '#4a6a84', cursor: 'pointer' }}>⤢</button>
              </div>

              <div onClick={() => setReader(centerTab)} title="Click to expand" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: 'zoom-in' }}>
                {centerTab === 'brief' ? briefView : calendarView}
              </div>
            </div>

            {/* Sprint metrics */}
            <div style={{ width: 174, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9, flexShrink: 0 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.15em', color: '#00d4ff', fontWeight: 700 }}>SPRINT VELOCITY</div>
              <SprintMetric label="BURNDOWN" value={`${sprintProgress}%`} progress={sprintProgress} color="#00d4ff" />
              {ADO_STORIES_ENABLED && <SprintMetric label="STORIES" value={`0/${tasks.filter(t => t.source === 'stories').length}`} progress={0} color="#a855f7" />}
              <SprintMetric label="TASKS" value={`0/${tasks.filter(t => t.source === 'tasks').length}`} progress={0} color="#00ff88" />
              <SprintMetric label="OPEN ALERTS" value={`${tasks.filter(t => ['pulse', 'solarwinds'].includes(t.source) && t.status === 'queue').length}`} progress={0} color="#ff3355" />            </div>
          </div>

          {/* Working Space */}
          <div
            style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', transition: 'all 0.15s' }}
            className={dropTarget === 'working' ? 'drop-active' : ''}
            onDrop={e => handleDrop(e, 'working')}
            onDragOver={e => handleDragOver(e, 'working')}
            onDragLeave={handleDragLeave}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.15em', color: '#00d4ff', fontWeight: 700 }}>◈ WORKING SPACE</span>
              {workingTask && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>— {workingTask.ref ?? workingTask.id}</span>}
              <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 8, color: dropTarget === 'working' ? '#00d4ff' : '#4a6a84' }}>DROP ITEM TO ACTIVATE</span>
            </div>
            <WorkingSpace
              task={workingTask}
              related={workingTask ? related[workingTask.id] : undefined}
              onDragStart={handleDragStart}
              onDone={workingTask ? doneHandler(workingTask) : undefined}
              onClear={() => { if (workingTask) moveTask(workingTask.id, 'queue') }}
            />
          </div>
        </div>

        {/* ── RIGHT: Today + Blocked ── */}
        <div style={{ borderLeft: '1px solid rgba(0,212,255,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* TODAY */}
          <div
            style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid rgba(0,212,255,0.1)', transition: 'all 0.15s' }}
            className={dropTarget === 'today' ? 'drop-active' : ''}
            onDrop={e => handleDrop(e, 'today')}
            onDragOver={e => handleDragOver(e, 'today')}
            onDragLeave={handleDragLeave}
          >
            <div className="panel-header" style={{ flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffaa00', boxShadow: '0 0 6px #ffaa00', flexShrink: 0 }} />
              TODO TODAY
              <span style={{ marginLeft: 'auto', background: 'rgba(255,170,0,0.12)', color: '#ffaa00', padding: '1px 6px', borderRadius: 2, fontSize: 9 }}>{todayTasks.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 5 }}>
              {todayTasks.length === 0
                ? <EmptyDrop label="DROP TASKS HERE" />
                : todayTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} onDone={doneHandler(t)} />)
              }
            </div>
          </div>

          {/* BLOCKED */}
          <div
            style={{ flex: 1, display: 'flex', flexDirection: 'column', transition: 'all 0.15s' }}
            className={dropTarget === 'blocked' ? 'drop-blocked-active' : ''}
            onDrop={e => handleDrop(e, 'blocked')}
            onDragOver={e => handleDragOver(e, 'blocked')}
            onDragLeave={handleDragLeave}
          >
            <div className="panel-header" style={{ flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff3355', boxShadow: '0 0 6px #ff3355', flexShrink: 0 }} className={blockedTasks.length > 0 ? 'pulse' : ''} />
              BLOCKED
              <span style={{ marginLeft: 'auto', background: 'rgba(255,51,85,0.12)', color: '#ff3355', padding: '1px 6px', borderRadius: 2, fontSize: 9 }}>{blockedTasks.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 5 }}>
              {blockedTasks.length === 0
                ? <EmptyDrop label="NO BLOCKERS" color="#ff3355" />
                : blockedTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} onDone={doneHandler(t)} />)
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {modalTask && <DetailModal task={modalTask} onClose={() => setModalTask(null)} />}

      {reader && (
        <ReaderModal
          tab={reader}
          onTab={setReader}
          onClose={() => setReader(null)}
          views={{ brief: briefView, ticker: tickerView, calendar: calendarView }}
        />
      )}

      {booting && (
        <BootScreen
          key={developer}
          login={developer.split('@')[0]}
          firstName={(currentDeveloper?.name ?? developer).split(/\s+/)[0]}
          sprintNumber={sprint?.number ?? null}
          steps={bootSteps}
          summary={bootSummary}
          onDone={() => setBooting(false)}
        />
      )}
    </div>
  )
}

// ─── Daily Brief ──────────────────────────────────────────────────────────────

const monoLabel: React.CSSProperties = { fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.12em', color: '#4a6a84' }

function BriefPanel({ brief, tasks, onOpen, today }: {
  brief: StandupBrief | { error: string } | null
  tasks: Task[]
  onOpen: (line: BriefLine) => void
  today: string
}) {
  const shell = (children: React.ReactNode) => <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>{children}</div>
  if (!brief) return shell(<span style={monoLabel}>LOADING BRIEF…</span>)
  if ('error' in brief) return shell(<span style={{ ...monoLabel, color: '#ff6680' }}>BRIDGE ERROR · {brief.error}</span>)
  if (brief.mode === 'none' || !brief.date) return shell(<span style={monoLabel}>NO STANDUP BRIEF YET THIS SPRINT</span>)

  const heading = `${shortDate(brief.date)} STANDUP · ${brief.mode === 'brief' ? 'MORNING BRIEF' : 'LEADERSHIP SUMMARY'}`
  const Line = ({ line, index, color }: { line: BriefLine; index?: number; color: string }) => {
    const task = tasks.find(t => line.mentions.includes(t.id))
    return (
      <div
        onClick={task ? e => { e.stopPropagation(); onOpen(line) } : undefined}
        style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: task ? 'pointer' : 'default' }}
      >
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color, flexShrink: 0, marginTop: 2, minWidth: 10 }}>{index !== undefined ? `${index + 1}.` : '•'}</span>
        <span style={{ fontSize: 10.5, color: '#c8dff0', lineHeight: 1.4 }}>
          {line.text}
          {task && <span style={{ marginLeft: 5, fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff' }}>{task.ref ?? ''} ↗</span>}
        </span>
      </div>
    )
  }

  return shell(
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ ...monoLabel, color: '#00d4ff' }}>{heading}</span>
        {!brief.isToday && brief.date < today && <span style={{ ...monoLabel, color: '#ffaa00', marginLeft: 'auto' }}>TODAY'S NOT POSTED YET</span>}
      </div>
      {brief.mode === 'brief' ? (
        <>
          <div style={{ ...monoLabel, marginTop: 4 }}>YOUR RESPONSIBILITIES TODAY</div>
          {brief.responsibilities.length === 0
            ? <div style={{ fontSize: 10, color: '#4a6a84', padding: '3px 0' }}>None listed</div>
            : brief.responsibilities.map((l, i) => <Line key={i} line={l} index={i} color="#00d4ff" />)}
          {brief.aging.length > 0 && (
            <>
              <div style={{ ...monoLabel, marginTop: 6, color: '#ffaa00' }}>AGING ITEMS</div>
              {brief.aging.map((l, i) => <Line key={i} line={l} color="#ffaa00" />)}
            </>
          )}
        </>
      ) : (
        brief.summaries.map(s => (
          <div key={s.developer} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff', background: 'rgba(0,212,255,0.08)', padding: '1px 5px', borderRadius: 2, flexShrink: 0, marginTop: 1 }}>{s.developer.toUpperCase()}</span>
            <span style={{ fontSize: 10.5, color: '#c8dff0', lineHeight: 1.4 }}>{s.text}</span>
          </div>
        ))
      )}
    </>,
  )
}

// ─── Reader (expanded brief / ticker / calendar) ──────────────────────────────

type ReaderTab = 'brief' | 'ticker' | 'calendar'
const TICKER_PX_PER_SEC = 35
const READER_TABS: { id: ReaderTab; label: string }[] = [
  { id: 'brief', label: '◉ DAILY BRIEF' },
  { id: 'ticker', label: '◆ TEAM ITEMS & DATES' },
  { id: 'calendar', label: '◈ SPRINT CALENDAR' },
]

function TickerList({ items }: { items: { src: string; text: string }[] }) {
  const groups = [
    { src: 'TEAM', label: 'TEAM ITEMS' },
    { src: 'DATE', label: `DEADLINES IN THE NEXT ${DEADLINE_TICKER_DAYS} DAYS` },
  ]
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
      {groups.map(g => {
        const rows = items.filter(i => i.src === g.src)
        return (
          <div key={g.src} style={{ marginBottom: 10 }}>
            <div style={{ ...monoLabel, marginBottom: 3 }}>{g.label}</div>
            {rows.length === 0
              ? <div style={{ fontSize: 10.5, color: '#4a6a84', padding: '3px 0' }}>None</div>
              : rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff', flexShrink: 0, marginTop: 2 }}>•</span>
                  <span style={{ fontSize: 10.5, color: '#c8dff0', lineHeight: 1.4 }}>{r.text}</span>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}

// Full-screen dimmed overlay with a centered HUD panel; Esc or a click
// outside closes it.
function Overlay({ onClose, className, children }: { onClose: () => void; className?: string; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className={`panel hud-corner ${className ?? ''}`} style={{ width: 760, maxWidth: 'calc(100vw - 32px)', height: '80vh', display: 'flex', flexDirection: 'column', borderColor: 'rgba(0,212,255,0.35)', boxShadow: '0 0 60px rgba(0,212,255,0.12), 0 0 120px rgba(0,0,0,0.8)' }}>
        {children}
      </div>
    </div>
  )
}

function ReaderModal({ tab, onTab, onClose, views }: {
  tab: ReaderTab
  onTab: (tab: ReaderTab) => void
  onClose: () => void
  views: Record<ReaderTab, React.ReactNode>
}) {
  return (
    <Overlay onClose={onClose} className="reader">
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,212,255,0.15)', background: 'rgba(0,212,255,0.04)', flexShrink: 0 }}>
          {READER_TABS.map(t => (
            <button key={t.id} onClick={() => onTab(t.id)} style={{ flex: 1, fontFamily: 'JetBrains Mono', fontSize: 10, letterSpacing: '0.12em', padding: '10px', border: 'none', background: tab === t.id ? 'rgba(0,212,255,0.08)' : 'transparent', color: tab === t.id ? '#00d4ff' : '#4a6a84', cursor: 'pointer', borderBottom: tab === t.id ? '2px solid #00d4ff' : '2px solid transparent' }}>
              {t.label}
            </button>
          ))}
          <button onClick={onClose} title="Close (Esc)" style={{ fontFamily: 'JetBrains Mono', fontSize: 12, padding: '0 14px', border: 'none', borderLeft: '1px solid rgba(0,212,255,0.1)', background: 'transparent', color: '#4a6a84', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '6px 10px', zoom: 1.35 }}>
          {views[tab]}
        </div>
    </Overlay>
  )
}

// ─── Sprint Calendar ──────────────────────────────────────────────────────────

function CalendarList({ items, sprint, today }: { items: Deadline[]; sprint: Sprint | null; today: string }) {
  if (items.length === 0) return <span style={monoLabel}>NO UPCOMING DEADLINES</span>

  const inSprint = (d: Deadline) => !!sprint?.end && d.start <= sprint.end
  const range = (d: Deadline) => (d.end && d.end !== d.start ? `${shortDate(d.start)} – ${shortDate(d.end)}` : shortDate(d.start))
  const sprintLen = sprint?.start && sprint.end ? daysBetween(sprint.start, sprint.end) + 1 : 0
  const pct = (iso: string) => sprint?.start && sprintLen ? Math.min(100, Math.max(0, (daysBetween(sprint.start, iso) / sprintLen) * 100)) : 0

  const Row = ({ d }: { d: Deadline }) => {
    const active = d.start <= today
    return (
      <div style={{ padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 10.5, color: active ? '#e0f0ff' : '#c8dff0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: active ? '#00ff88' : '#7aa0c0', flexShrink: 0 }}>
            {range(d)}{!active && ` · ${daysBetween(today, d.start)}d`}
          </span>
        </div>
        {inSprint(d) && sprintLen > 0 && (
          <div style={{ position: 'relative', height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 2 }}>
            <div style={{ position: 'absolute', left: `${pct(today)}%`, top: -2, width: 1, height: 7, background: '#00d4ff' }} />
            <div style={{ position: 'absolute', left: `${pct(d.start)}%`, width: `${Math.max(2, pct(addDays(d.end ?? d.start, 1)) - pct(d.start))}%`, height: 3, borderRadius: 2, background: active ? '#00ff88' : '#a855f7' }} />
          </div>
        )}
      </div>
    )
  }

  const current = items.filter(inSprint)
  const upcoming = items.filter(d => !inSprint(d))
  return (
    <>
      {current.length > 0 && <div style={{ ...monoLabel, marginBottom: 2 }}>THIS SPRINT</div>}
      {current.map(d => <Row key={d.id} d={d} />)}
      {upcoming.length > 0 && <div style={{ ...monoLabel, marginTop: 6, marginBottom: 2 }}>UPCOMING</div>}
      {upcoming.map(d => <Row key={d.id} d={d} />)}
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', letterSpacing: '0.1em', marginTop: 1 }}>{label}</div>
    </div>
  )
}

function SprintMetric({ label, value, progress, color }: { label: string; value: string; progress: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.08em', color: '#4a6a84' }}>{label}</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color, fontWeight: 600 }}>{value}</span>
      </div>
      <ProgressBar value={progress} color={color} />
    </div>
  )
}

function EmptyDrop({ label, color = '#4a6a84' }: { label: string; color?: string }) {
  return (
    <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 3, margin: 4 }}>
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: color + '55', letterSpacing: '0.1em' }}>{label}</span>
    </div>
  )
}
