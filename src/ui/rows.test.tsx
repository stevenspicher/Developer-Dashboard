// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PullRequest } from '../bridge'
import { click, key, mount, run } from '../test/render'
import { makeEntry, makeTask } from '../test/factories'
import { CockpitContext } from './cockpit/context'
import { PlanListRow, ReviewListRow, TaskListRow, TeamListRow } from './rows'

afterEach(() => { document.body.innerHTML = '' })

const board = { tasks: [], ticks: {}, developer: 'a@x.com', toggleTick: () => {}, openTask: () => {} }
const inList = (node: React.ReactNode) => <CockpitContext.Provider value={board}><div data-rows="scan">{node}</div></CockpitContext.Provider>
const rowOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-row]')!
const focus = (el: HTMLElement) => run(() => el.focus())

const planProps = (over = {}) => ({
  entry: makeEntry({ id: 'e1', text: 'Merge the hotfix' }), id: 'entry:e1', selected: false, working: false, today: '2026-10-06', highlight: false,
  doneTarget: 'Notion' as string | null, handlers: {}, onSelect: vi.fn(), onReorder: vi.fn(), onToggle: vi.fn(), ...over,
})

describe('every row', () => {
  it('selects when focused, and on a click when it has no separate activation', () => {
    const onSelect = vi.fn()
    const ui = mount(inList(<TeamListRow developer="Ben" text="Update" blockedCount={0} id="team:Ben" selected={false} handlers={{}} onSelect={onSelect} />))
    focus(rowOf(ui.container))
    expect(onSelect).toHaveBeenCalledTimes(1)
    click(rowOf(ui.container))
    expect(onSelect).toHaveBeenCalledTimes(2)
    ui.unmount()
  })

  it('uses onActivate for a click, so a narrow window can open the pane without focus doing it', () => {
    const [onSelect, onActivate] = [vi.fn(), vi.fn()]
    const ui = mount(inList(<TeamListRow developer="Ben" text="Update" blockedCount={0} id="team:Ben" selected={false} handlers={{}} onSelect={onSelect} onActivate={onActivate} />))
    focus(rowOf(ui.container))
    click(rowOf(ui.container))
    expect([onSelect.mock.calls.length, onActivate.mock.calls.length]).toEqual([1, 1])
    ui.unmount()
  })

  it('marks the selected row, is focusable, and has a stable id', () => {
    const ui = mount(inList(<TeamListRow developer="Ben" text="Update" blockedCount={2} id="team:Ben" selected handlers={{}} onSelect={() => {}} />))
    const row = rowOf(ui.container)
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.tabIndex).toBe(0)
    expect(row.getAttribute('data-row-id')).toBe('team:Ben')
    expect(row.textContent).toContain('2 blocked')
    ui.unmount()
  })

  it('runs only the handlers it was given when keys are pressed', () => {
    const [open, start] = [vi.fn(), vi.fn()]
    const ui = mount(inList(<TeamListRow developer="Ben" text="Update" blockedCount={0} id="team:Ben" selected={false} handlers={{ open, start }} onSelect={() => {}} />))
    key(rowOf(ui.container), 'Enter')
    key(rowOf(ui.container), 's')
    key(rowOf(ui.container), 'd')
    expect([open.mock.calls.length, start.mock.calls.length]).toEqual([1, 1])
    ui.unmount()
  })
})

describe('PlanListRow', () => {
  it('shows the title, a ref and what is notable about the entry', () => {
    const task = makeTask({ id: 't1', ref: 'DEV-T1', status: 'blocked' })
    const ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ id: 'e1', text: 'Merge the hotfix', origin: 'standup', itemId: 't1', itemRef: 'DEV-T1' }), task })} />))
    const text = ui.container.textContent!
    expect(text).toContain('Merge the hotfix')
    expect(text).toContain('DEV-T1')
    expect(text).toContain('Blocked')
    expect(text).not.toContain('Not linked')
    ui.unmount()
  })

  it("shows an added entry under its item's title, and a standup line in the standup's words", () => {
    const task = makeTask({ id: 't1', title: 'The item title' })
    let ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ text: 'Entry text', origin: 'added', itemId: 't1' }), task })} />))
    expect(ui.container.textContent).toContain('The item title')
    ui.unmount()
    ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ text: 'Entry text', origin: 'standup', itemId: 't1' }), task })} />))
    expect(ui.container.textContent).toContain('Entry text')
    ui.unmount()
  })

  it('says an entry is not linked, was added earlier, or has left the board', () => {
    let ui = mount(inList(<PlanListRow {...planProps()} />))
    expect(ui.container.textContent).toContain('Not linked')
    ui.unmount()
    ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ origin: 'added', addedOn: '2026-10-02' }) })} />))
    expect(ui.container.textContent).toContain('Since Oct 2')
    ui.unmount()
    ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ itemId: 'gone', missing: true }) })} />))
    expect(ui.container.textContent).toContain('Not on your board')
    ui.unmount()
  })

  it('ticks through the checkbox without selecting the row, and locks once the done reached its source', () => {
    const [onToggle, onSelect] = [vi.fn(), vi.fn()]
    let ui = mount(inList(<PlanListRow {...planProps({ onToggle, onSelect })} />))
    click(ui.container.querySelector('[role=checkbox]')!)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
    ui.unmount()
    ui = mount(inList(<PlanListRow {...planProps({ entry: makeEntry({ done: true, doneAt: '2026-10-06T10:00:00Z' }) })} />))
    expect((ui.container.querySelector('[role=checkbox]') as HTMLButtonElement).disabled).toBe(true)
    ui.unmount()
  })

  it('offers Start only when there is something to start', () => {
    const onStart = vi.fn()
    let ui = mount(inList(<PlanListRow {...planProps({ onStart })} />))
    click(ui.container.querySelector('button[aria-label=Start]')!)
    expect(onStart).toHaveBeenCalledOnce()
    ui.unmount()
    ui = mount(inList(<PlanListRow {...planProps({ onStart, working: true })} />))
    expect(ui.container.querySelector('button[aria-label=Start]')).toBeNull()
    expect(ui.container.textContent).toContain('Working')
    ui.unmount()
  })

  it('reorders when another entry is dropped on it', () => {
    const onReorder = vi.fn()
    const ui = mount(inList(<PlanListRow {...planProps({ onReorder })} />))
    const data = new Map([['application/x-plan-entry', 'other']])
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown }
    drop.dataTransfer = { getData: (type: string) => data.get(type) ?? '', types: [...data.keys()] }
    run(() => { rowOf(ui.container).dispatchEvent(drop) })
    expect(onReorder).toHaveBeenCalledWith('other', 'e1')
    ui.unmount()
  })
})

describe('TaskListRow', () => {
  it('shows the title, ref, priority, state and the strongest two reasons', () => {
    const task = makeTask({ id: 't', ref: 'US-9', title: 'Late fees', priority: 'high', externalState: 'Active' })
    const reasons = [{ text: 'Aging since Aug 31', urgent: true }, { text: 'P1' }, { text: 'Third reason' }]
    const ui = mount(inList(<TaskListRow task={task} id="task:t" selected={false} reasons={reasons} handlers={{}} onSelect={() => {}} onDragStart={() => {}} />))
    const text = ui.container.textContent!
    for (const piece of ['Late fees', 'US-9', 'HIGH', 'Active', 'Aging since Aug 31', 'P1']) expect(text).toContain(piece)
    expect(text).not.toContain('Third reason')
    ui.unmount()
  })

  it('is draggable and shows its quick actions only when given them', () => {
    const task = makeTask({ id: 't' })
    const ui = mount(inList(<TaskListRow task={task} id="task:t" selected={false} handlers={{}} onSelect={() => {}} onDragStart={() => {}} quick={<button>Plan</button>} />))
    expect(rowOf(ui.container).draggable).toBe(true)
    expect(ui.container.textContent).toContain('Plan')
    ui.unmount()
  })
})

describe('ReviewListRow', () => {
  const pr = (over: Partial<PullRequest> = {}): PullRequest => ({ pullRequestId: 482, title: 'Fix the merge', repo: 'api', author: 'Luiz', createdDate: '2026-10-03T00:00:00Z', isRequired: true, url: 'https://x', ...over })

  it('shows the id, repo, author, how long it has waited, and Required', () => {
    const ui = mount(inList(<ReviewListRow pr={pr()} id="review:482" selected={false} today="2026-10-06" handlers={{}} onSelect={() => {}} />))
    const text = ui.container.textContent!
    for (const piece of ['#482', 'Fix the merge', 'api', 'by Luiz', '3d waiting', 'Required']) expect(text).toContain(piece)
    ui.unmount()
  })

  it('flags a review that has waited two days or more, and says "opened today" for a new one', () => {
    let ui = mount(inList(<ReviewListRow pr={pr()} id="r" selected={false} today="2026-10-06" handlers={{}} onSelect={() => {}} />))
    expect(ui.container.querySelector('.text-warn')?.textContent).toBe('3d waiting')
    ui.unmount()
    ui = mount(inList(<ReviewListRow pr={pr({ createdDate: '2026-10-06T08:00:00Z', isRequired: false })} id="r" selected={false} today="2026-10-06" handlers={{}} onSelect={() => {}} />))
    expect(ui.container.textContent).toContain('opened today')
    expect(ui.container.querySelector('.text-warn')).toBeNull()
    ui.unmount()
  })
})
