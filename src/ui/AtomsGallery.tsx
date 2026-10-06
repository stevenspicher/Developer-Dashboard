import { useState } from 'react'

import {
  Avatar, BuildStatus, Button, Checkbox, Chip, EmptyState, ErrorNote, Kbd, PrStatus, PriorityBadge, Ref, SectionLabel, Tabs, TypeChip,
} from './atoms'
import { Overlay } from './Overlay'
import { ThemeControls, useLook } from './ThemeControls'
import { Toast } from './Toast'
import type { Priority, TaskType } from '../types'

// The shared components on one page, at /?ui=atoms, in either theme and density.

const TYPES: TaskType[] = ['story', 'task', 'bug', 'spike', 'alert', 'ticket', 'incident']
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low', 'none']
type Tab = 'plan' | 'queue' | 'next' | 'reviews'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <SectionLabel>{title}</SectionLabel>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

export default function AtomsGallery() {
  const look = useLook()
  const [tab, setTab] = useState<Tab>('plan')
  const [checked, setChecked] = useState(false)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(false)
  const [error, setError] = useState(true)

  return (
    <div className="h-screen overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-display font-bold text-ink">Shared components</h1>
        <ThemeControls look={look} />
      </div>

      <Group title="CHIPS AND LABELS">
        {TYPES.map(t => <TypeChip key={t} type={t} />)}
        <Chip>Active</Chip><Chip>3 pt</Chip>
        <Chip tone="ok">Working</Chip><Chip tone="warn">Aging</Chip><Chip tone="danger">Blocked</Chip>
        <Ref>US-12236</Ref><Ref>BLUEADS-222</Ref>
        <Kbd>j</Kbd><Kbd>⌘ ↵</Kbd>
      </Group>

      <Group title="PRIORITY AND PEOPLE">
        {PRIORITIES.map(p => <span key={p} className="flex items-center gap-2"><PriorityBadge priority={p} /><span className="text-meta text-muted">{p}</span></span>)}
        <Avatar initials="AL" title="Ada Lee" /><Avatar initials="BO" /><Avatar initials="" />
      </Group>

      <Group title="STATUSES">
        <PrStatus pr={{ status: 'active' }} /><PrStatus pr={{ status: 'active', isDraft: true }} />
        <PrStatus pr={{ status: 'completed' }} /><PrStatus pr={{ status: 'abandoned' }} />
        <BuildStatus build={{ result: 'succeeded' }} /><BuildStatus build={{ result: 'failed' }} />
        <BuildStatus build={{ result: 'partiallySucceeded' }} /><BuildStatus build={{ status: 'inProgress' }} />
      </Group>

      <Group title="BUTTONS">
        <Button>Start</Button><Button variant="primary">Save note</Button><Button variant="done">✓ Done</Button>
        <Button variant="danger">Block</Button><Button disabled>Disabled</Button>
        <label className="flex items-center gap-2 text-body">
          <Checkbox checked={checked} onChange={setChecked} label="Example" />Checkbox
        </label>
        <Checkbox checked onChange={() => {}} label="Ticked" /><Checkbox checked={false} onChange={() => {}} label="Disabled" disabled />
      </Group>

      <section className="mb-7">
        <SectionLabel count={4} right={<Button onClick={() => setTab('plan')}>Reset</Button>}>TABS</SectionLabel>
        <Tabs
          label="Filters"
          value={tab}
          onChange={setTab}
          tabs={[{ id: 'plan', label: 'Plan', count: 8 }, { id: 'queue', label: 'Queue', count: 19 }, { id: 'next', label: 'Next', count: 5 }, { id: 'reviews', label: 'Reviews', count: 0 }]}
        />
        <p className="mt-2 text-note text-muted">Selected: {tab}. Use the left and right arrow keys, Home and End.</p>
      </section>

      <section className="mb-7 grid grid-cols-2 gap-4">
        <div className="panel p-3"><SectionLabel>EMPTY STATE</SectionLabel><EmptyState title="Nothing in queue" hint="Everything here is in your plan." /></div>
        <div className="flex flex-col gap-2">
          <SectionLabel>ERRORS</SectionLabel>
          {error && <ErrorNote onDismiss={() => setError(false)}>Couldn't mark US-12236 done: bridge unreachable</ErrorNote>}
          <ErrorNote>Reviews need an updated ado-bridge</ErrorNote>
          {!error && <Button onClick={() => setError(true)}>Show the dismissible one again</Button>}
        </div>
      </section>

      <Group title="OVERLAY AND TOAST">
        <Button onClick={() => setOpen(true)}>Open an overlay</Button>
        <Button onClick={() => setToast(true)}>Show a toast</Button>
      </Group>

      {open && (
        <Overlay label="Example overlay" onClose={() => setOpen(false)} className="w-[420px]">
          <div className="p-4">
            <h2 className="mb-2 text-title font-bold text-ink">An overlay</h2>
            <p className="mb-3 text-body text-fg">Esc or a click outside closes it. Tab stays inside, and focus returns to the button that opened it.</p>
            <div className="flex gap-2"><Button variant="primary" onClick={() => setOpen(false)}>Close</Button><Button>Another button</Button></div>
          </div>
        </Overlay>
      )}
      {toast && <Toast text="Marked US-12236 done in ADO" onUndo={() => setToast(false)} onDismiss={() => setToast(false)} />}
    </div>
  )
}
