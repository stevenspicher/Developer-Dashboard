import { useState, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskType = 'story' | 'task' | 'bug' | 'spike' | 'alert' | 'ticket' | 'incident'
type Priority = 'critical' | 'high' | 'medium' | 'low'
type Status = 'queue' | 'today' | 'working' | 'blocked'
type QueueSource = 'stories' | 'tasks' | 'pulse' | 'solarwinds' | 'zendesk' | 'ads'

interface Initiative {
  id: string
  name: string
  goal: string
  owner: string
  progress: number
  dueDate: string
  status: 'on-track' | 'at-risk' | 'blocked'
}

interface Task {
  id: string
  type: TaskType
  source: QueueSource
  title: string
  description: string
  priority: Priority
  points?: number
  progress: number
  assignee: string
  sprint?: string
  tags: string[]
  status: Status
  blockedReason?: string
  subtasks?: { title: string; done: boolean }[]
  comments: number
  branch?: string
  initiative?: Initiative
  acceptanceCriteria?: string[]
  severity?: string
  affectedSystem?: string
  reportedBy?: string
  environment?: string
  activity?: { user: string; time: string; text: string }[]
}

// ─── Mock Initiatives ─────────────────────────────────────────────────────────

const INITIATIVES: Record<string, Initiative> = {
  'INIT-07': { id: 'INIT-07', name: 'Platform Security Hardening', goal: 'Achieve SOC2 Type II compliance and eliminate all critical CVEs before Q4 audit.', owner: 'JR', progress: 44, dueDate: 'Oct 31', status: 'at-risk' },
  'INIT-05': { id: 'INIT-05', name: 'Developer Experience 2.0', goal: 'Reduce local dev setup time to <5 min and cut CI build time by 50%.', owner: 'AR', progress: 62, dueDate: 'Nov 15', status: 'on-track' },
  'INIT-09': { id: 'INIT-09', name: 'Customer Portal Rebuild', goal: 'Migrate 100% of portal features to new React stack with improved accessibility.', owner: 'MK', progress: 28, dueDate: 'Dec 1', status: 'on-track' },
  'INIT-03': { id: 'INIT-03', name: 'Observability & SRE Foundations', goal: 'Full distributed tracing, structured logging, and 99.9% uptime SLA by year end.', owner: 'AR', progress: 15, dueDate: 'Dec 31', status: 'at-risk' },
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_TASKS: Task[] = [
  // Stories
  {
    id: 'US-1042', type: 'story', source: 'stories', title: 'Auth token refresh flow',
    description: 'Implement silent token refresh with exponential backoff. Store refresh token in httpOnly cookie. Must not interrupt active sessions.',
    priority: 'critical', points: 8, progress: 30, assignee: 'JR', sprint: 'SPR-42',
    tags: ['auth', 'security'], status: 'queue', comments: 4, branch: 'feat/auth-refresh',
    initiative: INITIATIVES['INIT-07'],
    acceptanceCriteria: ['Token refreshes silently 60s before expiry', 'Failed refresh redirects to login after 3 retries', 'Refresh token stored in httpOnly cookie only', 'Concurrent requests queued during refresh'],
    subtasks: [{ title: 'Write refresh interceptor', done: true }, { title: 'Handle 401 retry queue', done: false }, { title: 'Unit tests', done: false }],
    activity: [{ user: 'JR', time: '09:12', text: 'Started interceptor implementation' }, { user: 'MK', time: '08:55', text: 'Added to security hardening epic' }],
  },
  {
    id: 'US-1038', type: 'story', source: 'stories', title: 'Dashboard data export',
    description: 'Allow users to export filtered dashboard data to CSV and JSON. Column selection dialog. Max 50k rows with async job for larger sets.',
    priority: 'high', points: 5, progress: 0, assignee: 'MK', sprint: 'SPR-42',
    tags: ['export', 'data'], status: 'queue', comments: 2,
    initiative: INITIATIVES['INIT-09'],
    acceptanceCriteria: ['CSV and JSON format support', 'Column selection persists per user', 'Async export for >10k rows with email notification', 'Progress indicator during export'],
    activity: [{ user: 'MK', time: '07:30', text: 'ZD-8841 linked — customer-reported blocker' }],
  },
  {
    id: 'US-1035', type: 'story', source: 'stories', title: 'Notification preferences panel',
    description: 'User-configurable notification channels and frequency settings per event type. Support email, Slack, webhook.',
    priority: 'medium', points: 3, progress: 0, assignee: 'JR', sprint: 'SPR-42',
    tags: ['notifications', 'settings'], status: 'queue', comments: 1,
    initiative: INITIATIVES['INIT-09'],
    acceptanceCriteria: ['Per-event-type channel selection', 'Digest/instant/mute frequency options', 'Webhook URL validation', 'Settings exportable via API'],
  },
  {
    id: 'US-1030', type: 'story', source: 'stories', title: 'Team activity feed',
    description: 'Real-time feed of team actions. Filterable by type and actor. Infinite scroll with 90-day retention.',
    priority: 'low', points: 5, progress: 0, assignee: 'MK', sprint: 'SPR-43',
    tags: ['feed', 'realtime'], status: 'queue', comments: 2,
    initiative: INITIATIVES['INIT-09'],
    acceptanceCriteria: ['WebSocket-pushed updates', 'Filter by user, event type, date range', 'Infinite scroll', 'Exportable as CSV'],
  },

  // Tasks
  {
    id: 'DT-0892', type: 'task', source: 'tasks', title: 'Migrate API client to v3 SDK',
    description: 'Replace deprecated v2 endpoints. Update all 47 call sites. Update error handling to new error schema. Remove v2 compatibility shim.',
    priority: 'high', points: 5, progress: 65, assignee: 'AR', sprint: 'SPR-42',
    tags: ['refactor', 'api'], status: 'queue', comments: 7, branch: 'chore/api-v3',
    initiative: INITIATIVES['INIT-05'],
    subtasks: [{ title: 'Audit all v2 call sites', done: true }, { title: 'Update auth client', done: true }, { title: 'Update orders client', done: false }, { title: 'Update reporting client', done: false }, { title: 'Remove shim + integration tests', done: false }],
    activity: [{ user: 'AR', time: '09:45', text: 'Auth and user clients done. Orders next.' }, { user: 'JR', time: '08:20', text: 'PR #1204 opened for review' }],
  },
  {
    id: 'DT-0889', type: 'task', source: 'tasks', title: 'Add Redis caching layer',
    description: 'Cache frequently queried endpoints with configurable TTL per route. Implement cache invalidation on write operations.',
    priority: 'high', points: 8, progress: 0, assignee: 'JR', sprint: 'SPR-42',
    tags: ['performance', 'infra'], status: 'queue', comments: 3,
    initiative: INITIATIVES['INIT-03'],
    acceptanceCriteria: ['Cache hit rate >80% on /products and /users', 'TTL configurable per route via env', 'Invalidation on write within 50ms', 'Cache bypass header for admin'],
  },
  {
    id: 'DT-0884', type: 'bug', source: 'tasks', title: 'Race condition in cart reducer',
    description: 'Concurrent add-to-cart actions corrupt Redux state. Repro: rapid-click multiple items. Root cause: thunks dispatched before prior action resolves.',
    priority: 'critical', points: 3, progress: 0, assignee: 'MK', sprint: 'SPR-42',
    tags: ['bug', 'redux'], status: 'queue', comments: 12,
    initiative: INITIATIVES['INIT-09'],
    activity: [{ user: 'MK', time: '09:00', text: 'Confirmed race on thunk dispatch. Queuing fix.' }, { user: 'AR', time: '08:10', text: 'Repro rate 100% with 3+ concurrent clicks' }],
  },
  {
    id: 'DT-0880', type: 'spike', source: 'tasks', title: 'Evaluate OpenTelemetry tracing',
    description: 'POC for distributed tracing across 12 services. Compare Jaeger vs Grafana Tempo backends. Document sampling strategy and storage cost estimates.',
    priority: 'medium', points: 3, progress: 0, assignee: 'AR', sprint: 'SPR-42',
    tags: ['observability', 'research'], status: 'queue', comments: 0,
    initiative: INITIATIVES['INIT-03'],
    acceptanceCriteria: ['Working OTEL collector config', 'Trace 3 critical user flows end-to-end', 'Cost model for 30-day retention', 'Decision doc in Confluence'],
  },
  {
    id: 'DT-0876', type: 'bug', source: 'tasks', title: 'WebSocket reconnect drops messages',
    description: 'Messages sent during the reconnect window are silently discarded. Need an offline queue with replay on reconnect.',
    priority: 'high', points: 5, progress: 0, assignee: 'JR', sprint: 'SPR-42',
    tags: ['websocket', 'reliability'], status: 'queue', comments: 6,
    initiative: INITIATIVES['INIT-03'],
  },
  {
    id: 'DT-0871', type: 'task', source: 'tasks', title: 'Schema migration for audit logs',
    description: 'Add indexed columns for actor_id and resource_type. Backfill existing 4.2M rows in batches to avoid table lock.',
    priority: 'high', points: 5, progress: 0, assignee: 'AR', sprint: 'SPR-43',
    tags: ['db', 'migration'], status: 'queue', comments: 4,
    initiative: INITIATIVES['INIT-07'],
  },

  // Pulse
  {
    id: 'PULSE-0041', type: 'alert', source: 'pulse', title: 'Memory leak · auth-service pod',
    description: 'Heap usage climbing 2% per hour. Currently at 87%. OOMKill projected in ~6h without intervention. Likely connection pool not releasing on JWT validation path.',
    priority: 'critical', progress: 0, assignee: 'JR',
    tags: ['memory', 'auth-service', 'k8s'], status: 'queue', comments: 2,
    severity: 'P1', affectedSystem: 'auth-service · prod-east-1',
    initiative: INITIATIVES['INIT-03'],
    activity: [{ user: 'PULSE', time: '09:47', text: 'Heap crossed 85% threshold. Alert fired.' }, { user: 'JR', time: '09:50', text: 'Acknowledged. Investigating connection pool.' }],
  },
  {
    id: 'PULSE-0039', type: 'alert', source: 'pulse', title: 'CI pipeline build time +340%',
    description: 'Average build time increased from 4min to 18min over the last 48h. Correlation with test parallelism change on Sep 20.',
    priority: 'high', progress: 0, assignee: 'AR',
    tags: ['ci', 'performance', 'github-actions'], status: 'queue', comments: 1,
    severity: 'P2', affectedSystem: 'GitHub Actions · main branch',
    initiative: INITIATIVES['INIT-05'],
  },
  {
    id: 'PULSE-0037', type: 'alert', source: 'pulse', title: 'DB connection pool exhausted',
    description: 'prod-orders RDS instance hitting max_connections (500) during business hours. Pool exhaustion causing 503s on order submission.',
    priority: 'critical', progress: 0, assignee: 'AR',
    tags: ['database', 'rds', 'prod'], status: 'queue', comments: 5,
    severity: 'P1', affectedSystem: 'RDS prod-orders · us-east-1',
    initiative: INITIATIVES['INIT-03'],
  },

  // Solarwinds
  {
    id: 'SW-2291', type: 'incident', source: 'solarwinds', title: 'Cross-AZ latency spike · 340ms avg',
    description: 'Network latency between AZ-East and AZ-West elevated since 07:12 UTC. Average 340ms vs baseline 18ms. BGP route change suspected.',
    priority: 'high', progress: 0, assignee: 'AR',
    tags: ['network', 'latency', 'az'], status: 'queue', comments: 3,
    severity: 'SEV-2', affectedSystem: 'AZ-East ↔ AZ-West fabric',
    environment: 'Production',
  },
  {
    id: 'SW-2288', type: 'incident', source: 'solarwinds', title: 'Disk at 94% · media-storage-02',
    description: 'media-storage-02 volume reaching capacity. At current ingest rate (12GB/h), full in approximately 5.5 hours. Log rotation not running since Sep 19.',
    priority: 'critical', progress: 0, assignee: 'JR',
    tags: ['disk', 'storage', 'infra'], status: 'queue', comments: 1,
    severity: 'SEV-1', affectedSystem: 'media-storage-02 · /data',
    environment: 'Production',
  },
  {
    id: 'SW-2285', type: 'task', source: 'solarwinds', title: 'TLS cert expiry in 8 days',
    description: 'api.example.com TLS certificate expires Oct 1. Auto-renewal via Let\'s Encrypt failed — ACME challenge DNS record missing.',
    priority: 'high', progress: 0, assignee: 'AR',
    tags: ['tls', 'cert', 'dns'], status: 'queue', comments: 0,
    severity: 'SEV-2', affectedSystem: 'api.example.com',
    environment: 'Production',
  },

  // Zendesk
  {
    id: 'ZD-8841', type: 'ticket', source: 'zendesk', title: 'Export fails > 10k rows · Acme Corp',
    description: 'Enterprise customer Acme Corp (ARR $240k) unable to export dashboard data beyond 10k rows. Request times out at 30s. Linked to US-1038.',
    priority: 'high', progress: 0, assignee: 'MK',
    tags: ['export', 'enterprise', 'timeout'], status: 'queue', comments: 8,
    reportedBy: 'Acme Corp · Sarah Chen',
    affectedSystem: 'Dashboard Export · /api/export',
    activity: [{ user: 'MK', time: '08:45', text: 'Confirmed server-side timeout. Linked US-1038.' }, { user: 'ZD', time: '07:00', text: 'Ticket escalated to P1 by customer' }],
  },
  {
    id: 'ZD-8836', type: 'bug', source: 'zendesk', title: 'OAuth login broken on Safari 17.x',
    description: 'Safari 17.x (iOS 17.1+) users cannot complete OAuth login flow. Redirect loop after consent. 23 confirmed affected users, likely hundreds more.',
    priority: 'critical', progress: 0, assignee: 'MK',
    tags: ['oauth', 'safari', 'ios'], status: 'queue', comments: 14,
    reportedBy: '23 users · Safari 17.x',
    affectedSystem: 'OAuth callback · /auth/callback',
  },
  {
    id: 'ZD-8830', type: 'ticket', source: 'zendesk', title: 'Webhook delivery failing 12h window',
    description: 'NovaStar Inc webhooks not delivered for a 12-hour window Sep 21 08:00–20:00 UTC. Retry queue silently dropped events. Root cause unknown.',
    priority: 'high', progress: 0, assignee: 'AR',
    tags: ['webhook', 'reliability', 'data-loss'], status: 'queue', comments: 6,
    reportedBy: 'NovaStar Inc · Dev Team',
    affectedSystem: 'Webhook delivery service',
  },

  // ADS (Azure DevOps)
  {
    id: 'ADS-1104', type: 'alert', source: 'ads', title: 'Infra drift · prod cluster',
    description: 'Terraform plan shows 3 unexpected resource changes in prod cluster. Likely manual console changes. Drift must be reconciled before next deployment.',
    priority: 'high', progress: 0, assignee: 'AR',
    tags: ['terraform', 'infra', 'drift'], status: 'queue', comments: 2,
    affectedSystem: 'prod-cluster · terraform state',
    environment: 'Production',
    initiative: INITIATIVES['INIT-03'],
  },
  {
    id: 'ADS-1101', type: 'bug', source: 'ads', title: 'E2E suite failing on main · 4 tests',
    description: 'Checkout flow E2E tests failing since PR #1198 merged. Tests: checkout_guest, checkout_coupon, order_confirm_email, order_cancel. Blocking deploys.',
    priority: 'critical', progress: 0, assignee: 'MK',
    tags: ['e2e', 'ci', 'checkout'], status: 'queue', comments: 9,
    affectedSystem: 'main branch · Playwright suite',
    initiative: INITIATIVES['INIT-05'],
    activity: [{ user: 'ADS', time: '06:30', text: 'Pipeline blocked on 4 failing E2E tests' }, { user: 'MK', time: '09:00', text: 'Investigating — suspect env variable change' }],
  },
  {
    id: 'ADS-1098', type: 'task', source: 'ads', title: 'Dependabot: lodash security patch',
    description: 'lodash 4.17.20 → 4.17.21 (CVE-2021-23337 fix). Auto-merge blocked due to custom lodash plugin. Manual review and merge required.',
    priority: 'medium', progress: 0, assignee: 'JR',
    tags: ['security', 'dependency', 'cve'], status: 'queue', comments: 1,
    affectedSystem: 'package.json · 3 packages',
    initiative: INITIATIVES['INIT-07'],
  },
]

const TICKER_ITEMS = [
  { icon: '🚀', text: 'v2.14.3 deployed to staging · 3 failing E2E tests', src: 'ADS' },
  { icon: '⚠️', text: 'API latency spike /orders · p99 820ms · investigating', src: 'PULSE' },
  { icon: '👁', text: 'PR #1204 awaiting 2 reviewers · DT-0892', src: 'GIT' },
  { icon: '🎟', text: 'ZD-8836 Safari OAuth · 23 users affected · P1', src: 'ZD' },
  { icon: '💾', text: 'media-storage-02 · 94% disk · 5.5h to full', src: 'SW' },
  { icon: '🔒', text: 'TLS cert api.example.com · expires in 8 days', src: 'SW' },
  { icon: '📋', text: 'Sprint review Friday 3PM · demo scope confirmed', src: 'TEAM' },
  { icon: '🔥', text: 'PULSE-0037 · DB connection pool exhausted · P1', src: 'PULSE' },
]

const SPRINT_DAYS = [
  { d: 15, label: 'M', event: 'Sprint Start', type: 'start' },
  { d: 16, label: 'T', event: null, type: null },
  { d: 17, label: 'W', event: 'Backlog Grooming 2PM', type: 'meeting' },
  { d: 18, label: 'T', event: null, type: null },
  { d: 19, label: 'F', event: null, type: null },
  { d: 22, label: 'M', event: 'TODAY', type: 'today' },
  { d: 23, label: 'T', event: null, type: null },
  { d: 24, label: 'W', event: 'Mid-Sprint Review', type: 'meeting' },
  { d: 25, label: 'T', event: null, type: null },
  { d: 26, label: 'F', event: null, type: null },
  { d: 29, label: 'M', event: null, type: null },
  { d: 30, label: 'T', event: null, type: null },
  { d: 1,  label: 'W', event: null, type: null },
  { d: 2,  label: 'T', event: null, type: null },
  { d: 3,  label: 'F', event: 'Sprint Review 3PM', type: 'end' },
]

// ─── Config ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  critical: { label: 'CRIT', color: '#ff3355' },
  high:     { label: 'HIGH', color: '#ffaa00' },
  medium:   { label: 'MED',  color: '#00d4ff' },
  low:      { label: 'LOW',  color: '#4a6a84' },
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

const SOURCE_TABS: { id: QueueSource; label: string; color: string }[] = [
  { id: 'stories',    label: 'Stories',    color: '#a855f7' },
  { id: 'tasks',      label: 'Tasks',      color: '#00d4ff' },
  { id: 'pulse',      label: 'Pulse',      color: '#00ff88' },
  { id: 'solarwinds', label: 'Solarwinds', color: '#ffaa00' },
  { id: 'zendesk',    label: 'Zendesk',    color: '#f97316' },
  { id: 'ads',        label: 'ADS',        color: '#60a5fa' },
]

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

function TaskCard({ task, onDragStart, compact = false, onClick }: {
  task: Task
  onDragStart: (e: React.DragEvent, id: string) => void
  compact?: boolean
  onClick?: () => void
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
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#4a6a84' }}>{task.id}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: pc.color, fontWeight: 700 }}>
            <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: pc.color, marginRight: 4, boxShadow: `0 0 4px ${pc.color}` }} />
            {pc.label}
          </span>
          {task.points && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 2, color: '#7aa0c0' }}>{task.points}pt</span>}
          {task.severity && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, background: 'rgba(255,51,85,0.1)', padding: '1px 5px', borderRadius: 2, color: '#ff6680', border: '1px solid rgba(255,51,85,0.2)' }}>{task.severity}</span>}
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: '#e0f0ff', lineHeight: 1.4, marginBottom: compact ? 0 : 5 }}>{task.title}</div>

      {!compact && (
        <>
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
            <Avatar initials={task.assignee} color={ASSIGNEE_COLORS[task.assignee] || '#00d4ff'} />
            {task.affectedSystem && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.affectedSystem}</span>}
            {task.branch && !task.affectedSystem && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>⎇ {task.branch}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
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
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: '#4a6a84' }}>{task.id}</span>
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

function WorkingSpace({ task, onClear, onDragStart }: { task: Task | null; onClear: () => void; onDragStart: (e: React.DragEvent, id: string) => void }) {
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
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#4a6a84' }}>{task.id}</span>
        <button
          draggable
          onDragStart={e => onDragStart(e, task.id)}
          onClick={onClear}
          style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 2, cursor: 'pointer', letterSpacing: '0.1em' }}
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
                <Avatar initials={task.assignee} color={ASSIGNEE_COLORS[task.assignee] || '#00d4ff'} />
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

          {task.acceptanceCriteria && (
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
        <div style={{ width: 200, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.15em', color: '#4a6a84', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>PROJECT CONTEXT</div>

          {task.initiative ? (
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
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<'today' | 'working' | 'blocked' | 'queue' | null>(null)
  const [centerTab, setCenterTab] = useState<'brief' | 'calendar'>('brief')
  const [queueTab, setQueueTab] = useState<QueueSource>('stories')
  const [modalTask, setModalTask] = useState<Task | null>(null)
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, zone: 'today' | 'working' | 'blocked' | 'queue') => {
    e.preventDefault()
    setDropTarget(null)
    if (!dragId) return
    if (zone === 'queue') {
      setTasks(prev => prev.map(t => t.id === dragId ? { ...t, status: 'queue' } : t))
      if (workingId === dragId) setWorkingId(null)
    } else {
      setTasks(prev => prev.map(t => t.id === dragId ? { ...t, status: zone } : t))
      if (zone === 'working') setWorkingId(dragId)
      else if (workingId === dragId) setWorkingId(null)
    }
    setDragId(null)
  }, [dragId, workingId])

  const handleDragOver = useCallback((e: React.DragEvent, zone: 'today' | 'working' | 'blocked' | 'queue') => {
    e.preventDefault()
    setDropTarget(zone)
  }, [])

  const handleDragLeave = useCallback(() => setDropTarget(null), [])

  const queueTasks = tasks.filter(t => t.status === 'queue' && t.source === queueTab)
  const todayTasks = tasks.filter(t => t.status === 'today')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const workingTask = workingId ? tasks.find(t => t.id === workingId) ?? null : null

  const allQueueTasks = tasks.filter(t => t.status === 'queue')
  const sprintProgress = 28

  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const activeSrc = SOURCE_TABS.find(s => s.id === queueTab)!

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#060b14', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Header ── */}
      <header style={{ height: 46, borderBottom: '1px solid rgba(0,212,255,0.15)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, background: 'rgba(0,0,0,0.4)', flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.4)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontSize: 13, color: '#00d4ff', fontWeight: 700 }}>◈</div>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#e0f0ff' }}>DEV COMMAND CENTER</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', letterSpacing: '0.08em' }}>SPRINT 42 · SEP 15 – OCT 3</div>
          </div>
        </div>

        {/* Ticker */}
        <div style={{ flex: 1, overflow: 'hidden', margin: '0 12px', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 20, background: 'linear-gradient(90deg, rgba(6,11,20,1), transparent)', zIndex: 1, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 20, background: 'linear-gradient(270deg, rgba(6,11,20,1), transparent)', zIndex: 1, pointerEvents: 'none' }} />
          <div className="ticker-track" style={{ display: 'inline-flex', gap: 28, alignItems: 'center' }}>
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((b, i) => (
              <span key={i} style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: '#9bbdd4', whiteSpace: 'nowrap', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#00d4ff', fontSize: 9 }}>◆</span>
                <span style={{ color: '#4a8ca8', fontSize: 8, background: 'rgba(0,212,255,0.08)', padding: '0 4px', borderRadius: 2 }}>{b.src}</span>
                {b.text}
              </span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <Stat label="SPRINT" value={`${sprintProgress}%`} color="#00d4ff" />
          <Stat label="TODAY" value={String(todayTasks.length)} color="#ffaa00" />
          <Stat label="BLOCKED" value={String(blockedTasks.length)} color={blockedTasks.length > 0 ? '#ff3355' : '#4a6a84'} />
          <div style={{ width: 1, height: 20, background: 'rgba(0,212,255,0.12)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: '#00d4ff', fontWeight: 700 }}>{timeStr}</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>SEP 22 · 2026</div>
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
            {queueTasks.length === 0 ? (
              <div style={{ padding: '20px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84', opacity: 0.5 }}>NO ITEMS IN QUEUE</div>
            ) : (
              queueTasks.map(t => (
                <TaskCard key={t.id} task={t} onDragStart={handleDragStart} onClick={() => setModalTask(t)} />
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
              </div>

              {centerTab === 'brief' ? (
                <div style={{ flex: 1, overflowY: 'auto', padding: '5px 10px' }}>
                  {TICKER_ITEMS.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '4px 0', borderBottom: i < TICKER_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a8ca8', background: 'rgba(0,212,255,0.06)', padding: '0 4px', borderRadius: 2, flexShrink: 0, marginTop: 2 }}>{item.src}</span>
                      <span style={{ fontSize: 10 }}>{item.icon}</span>
                      <span style={{ fontSize: 11, color: '#c8dff0', lineHeight: 1.4 }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
                  <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#4a6a84' }}>SPRINT 42 · SEP 15 – OCT 3</span>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: '#00d4ff' }}>14 DAYS LEFT</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {SPRINT_DAYS.map((day, i) => (
                      <div key={i} style={{ width: 28, textAlign: 'center' }}>
                        <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: '#4a6a84', marginBottom: 2 }}>{day.label}</div>
                        <div style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2, border: `1px solid ${day.type === 'today' ? '#00d4ff' : day.type === 'meeting' ? 'rgba(168,85,247,0.4)' : day.type === 'start' || day.type === 'end' ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.06)'}`, background: day.type === 'today' ? 'rgba(0,212,255,0.14)' : day.type === 'meeting' ? 'rgba(168,85,247,0.07)' : 'transparent' }}>
                          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: day.type === 'today' ? 700 : 400, color: day.type === 'today' ? '#00d4ff' : day.type === 'meeting' ? '#a855f7' : day.type === 'start' || day.type === 'end' ? '#00ff88' : '#7aa0c0' }}>{day.d}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sprint metrics */}
            <div style={{ width: 174, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9, flexShrink: 0 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.15em', color: '#00d4ff', fontWeight: 700 }}>SPRINT VELOCITY</div>
              <SprintMetric label="BURNDOWN" value={`${sprintProgress}%`} progress={sprintProgress} color="#00d4ff" />
              <SprintMetric label="STORIES" value={`0/${tasks.filter(t => t.source === 'stories').length}`} progress={0} color="#a855f7" />
              <SprintMetric label="TASKS" value={`0/${tasks.filter(t => t.source === 'tasks').length}`} progress={0} color="#00ff88" />
              <SprintMetric label="OPEN ALERTS" value={`${tasks.filter(t => ['pulse', 'solarwinds', 'ads'].includes(t.source) && t.status === 'queue').length}`} progress={0} color="#ff3355" />
              <SprintMetric label="TICKETS" value={`${tasks.filter(t => t.source === 'zendesk' && t.status === 'queue').length}`} progress={0} color="#f97316" />
            </div>
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
              {workingTask && <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: '#4a6a84' }}>— {workingTask.id}</span>}
              <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 8, color: dropTarget === 'working' ? '#00d4ff' : '#4a6a84' }}>DROP ITEM TO ACTIVATE</span>
            </div>
            <WorkingSpace
              task={workingTask ?? null}
              onDragStart={handleDragStart}
              onClear={() => {
                if (workingId) {
                  setTasks(prev => prev.map(t => t.id === workingId ? { ...t, status: 'queue' } : t))
                  setWorkingId(null)
                }
              }}
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
                : todayTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} />)
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
                : blockedTasks.map(t => <TaskCard key={t.id} task={t} onDragStart={handleDragStart} compact onClick={() => setModalTask(t)} />)
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {modalTask && <DetailModal task={modalTask} onClose={() => setModalTask(null)} />}
    </div>
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
