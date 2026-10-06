// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DevLinks, QueueAdapter, RelatedEntity } from '../../bridge'
import { click, flush, key, mount, type as typeInto } from '../../test/render'
import { makeTask } from '../../test/factories'
import { Checklist } from './Checklist'
import { CockpitContext } from './context'
import type { CockpitValue } from './context'
import { CockpitPane } from './CockpitPane'
import { DevLinksPanel } from './DevLinks'
import { LinkedItemsPanel } from './LinkedItems'
import { resetLoadCache } from './load'
import { NotesPanel, resetNoteDrafts } from './Notes'
import { ProjectContext } from './ProjectContext'

// Each test chooses the queue adapter the panels see.
let adapter: Partial<QueueAdapter> | undefined
vi.mock('../../bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../../bridge')>()),
  queueFor: () => adapter,
}))

const noLinks: DevLinks = { pullRequests: [], branches: [], commits: [], builds: [], hyperlinks: [], workItems: [] }

function board(overrides: Partial<CockpitValue> = {}): CockpitValue {
  return { tasks: [], ticks: {}, developer: 'a@x.com', toggleTick: vi.fn(), openTask: vi.fn(), ...overrides }
}
const inBoard = (node: ReactNode, value = board()) => <CockpitContext.Provider value={value}>{node}</CockpitContext.Provider>
const story = makeTask({ id: '12236', ref: 'US-12236', source: 'stories', type: 'story', queue: 'ado-stories', title: 'Update the diary', acceptanceCriteria: ['One', 'Two'], status: 'today' })

beforeEach(() => { adapter = undefined; resetLoadCache(); resetNoteDrafts() })
afterEach(() => { document.body.innerHTML = '' })

describe('Checklist', () => {
  it('shows a tickable box per criterion with the count, and reports ticks', () => {
    const toggleTick = vi.fn()
    const ui = mount(inBoard(<Checklist task={story} />, board({ ticks: { '12236': ['One'] }, toggleTick })))
    expect(ui.container.textContent).toContain('1/2')
    const boxes = [...ui.container.querySelectorAll('[role=checkbox]')]
    expect(boxes.map(b => b.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    click(boxes[1])
    expect(toggleTick).toHaveBeenCalledWith(story, 'Two')
    ui.unmount()
  })

  it('renders nothing for an item without criteria', () => {
    const ui = mount(inBoard(<Checklist task={makeTask()} />))
    expect(ui.container.textContent).toBe('')
    ui.unmount()
  })
})

describe('DevLinksPanel', () => {
  it('renders nothing for a source without dev links', () => {
    adapter = {}
    const ui = mount(inBoard(<DevLinksPanel task={story} />))
    expect(ui.container.textContent).toBe('')
    ui.unmount()
  })

  it('goes from loading to the links, with status words for PRs and builds', async () => {
    adapter = {
      devLinks: async () => ({
        ...noLinks,
        pullRequests: [{ id: 1, title: 'Fix it', status: 'active', repo: 'api', url: 'https://x/pr/1' }],
        branches: [{ name: 'feature/x', url: 'https://x/b' }],
        builds: [{ id: 9, definition: 'ci', result: 'failed', url: 'https://x/ci' }],
      }),
    }
    const ui = mount(inBoard(<DevLinksPanel task={story} />))
    expect(ui.container.textContent).toContain('Loading…')
    await flush()
    const text = ui.container.textContent!
    expect(text).toContain('Fix it')
    expect(text).toContain('OPEN')
    expect(text).toContain('feature/x')
    expect(text).toContain('FAILED')
    ui.unmount()
  })

  it('says when nothing is linked, and explains the two kinds of failure', async () => {
    adapter = { devLinks: async () => noLinks }
    let ui = mount(inBoard(<DevLinksPanel task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('No branch, PR or build linked yet')
    ui.unmount()

    resetLoadCache()
    adapter = { devLinks: async () => { throw new Error('Not Found') } }
    ui = mount(inBoard(<DevLinksPanel task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('Dev links need an updated ado-bridge')
    ui.unmount()

    resetLoadCache()
    adapter = { devLinks: async () => { throw new Error('HTTP 502') } }
    ui = mount(inBoard(<DevLinksPanel task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('Dev links unavailable · HTTP 502')
    ui.unmount()
  })
})

describe('LinkedItemsPanel', () => {
  it('lists ADO child and related items, skips the parent, and opens one that is on the board', async () => {
    const child = makeTask({ id: '2', ref: 'US-2', title: 'Child' })
    adapter = {
      devLinks: async () => ({
        ...noLinks,
        workItems: [
          { adoId: 1, relation: 'parent', title: 'Epic' },
          { adoId: 2, relation: 'child', title: 'Child', workItemType: 'User Story', state: 'New' },
          { adoId: 3, relation: 'related', title: 'Elsewhere', url: 'https://x/3' },
        ],
      }),
    }
    const openTask = vi.fn()
    const ui = mount(inBoard(<LinkedItemsPanel task={story} />, board({ tasks: [story, child], openTask })))
    await flush()
    const text = ui.container.textContent!
    expect(text).toContain('US-2 Child')
    expect(text).toContain('#3 Elsewhere')
    expect(text).not.toContain('Epic')
    click([...ui.container.querySelectorAll('button')].find(b => b.textContent?.includes('US-2'))!)
    expect(openTask).toHaveBeenCalledWith(child)
    expect(ui.container.querySelector('a[href="https://x/3"]')).not.toBeNull()
    ui.unmount()
  })

  it('shows items that mention this one, and an empty message when there are none', async () => {
    adapter = {}
    const mentioner = makeTask({ id: 'm', ref: 'DEV-M', title: 'Follow up', description: 'Blocked by US-12236' })
    let ui = mount(inBoard(<LinkedItemsPanel task={story} />, board({ tasks: [story, mentioner] })))
    expect(ui.container.textContent).toContain('MENTIONED BY')
    expect(ui.container.textContent).toContain('DEV-M Follow up')
    ui.unmount()
    ui = mount(inBoard(<LinkedItemsPanel task={story} />, board({ tasks: [story] })))
    expect(ui.container.textContent).toContain('Nothing linked or mentioned')
    ui.unmount()
  })
})

describe('NotesPanel', () => {
  const withNotes = (load: () => Promise<string>, save = vi.fn(async () => {})) => {
    adapter = { notes: { load, save } }
    return save
  }

  it('renders nothing when the source has no notes', () => {
    adapter = {}
    const ui = mount(inBoard(<NotesPanel task={story} />))
    expect(ui.container.textContent).toBe('')
    ui.unmount()
  })

  it('loads the note, tracks unsaved changes, and saves with the button', async () => {
    const save = withNotes(async () => 'first')
    const ui = mount(inBoard(<NotesPanel task={story} />))
    expect(ui.container.textContent).toContain('Loading…')
    await flush()
    const box = ui.container.querySelector('textarea')!
    expect(box.value).toBe('first')
    const button = () => [...ui.container.querySelectorAll('button')].find(b => b.textContent?.includes('Save note'))!
    expect(button().disabled).toBe(true)
    expect(ui.container.textContent).toContain('Saved in a comment on the ADO story')
    typeInto(box, 'first and more  ')
    expect(ui.container.textContent).toContain('Unsaved changes')
    expect(button().disabled).toBe(false)
    click(button())
    await flush()
    expect(save).toHaveBeenCalledWith(story, 'first and more', 'a@x.com')
    expect(ui.container.textContent).toContain('Saved to a comment on the ADO story')
    ui.unmount()
  })

  it('saves with Ctrl+Enter and names the Notion page for Notion items', async () => {
    const notion = makeTask({ id: 'n', source: 'tasks', queue: 'q' })
    const save = withNotes(async () => '')
    const ui = mount(inBoard(<NotesPanel task={notion} />))
    await flush()
    typeInto(ui.container.querySelector('textarea')!, 'hello')
    key(ui.container.querySelector('textarea')!, 'Enter', { ctrlKey: true })
    await flush()
    expect(save).toHaveBeenCalledWith(notion, 'hello', 'a@x.com')
    expect(ui.container.textContent).toContain("Saved to the item's Notion page")
    ui.unmount()
  })

  it('shows a failed save and keeps the text', async () => {
    withNotes(async () => '', vi.fn(async () => { throw new Error('bridge down') }))
    const ui = mount(inBoard(<NotesPanel task={story} />))
    await flush()
    typeInto(ui.container.querySelector('textarea')!, 'keep me')
    click([...ui.container.querySelectorAll('button')].find(b => b.textContent?.includes('Save note'))!)
    await flush()
    expect(ui.container.querySelector('[role=alert]')!.textContent).toBe("Couldn't save: bridge down")
    expect(ui.container.querySelector('textarea')!.value).toBe('keep me')
    ui.unmount()
  })

  it('keeps unsaved text when the panel is closed and opened again', async () => {
    withNotes(async () => 'saved')
    let ui = mount(inBoard(<NotesPanel task={story} />))
    await flush()
    typeInto(ui.container.querySelector('textarea')!, 'unsaved')
    ui.unmount()
    ui = mount(inBoard(<NotesPanel task={story} />))
    await flush()
    expect(ui.container.querySelector('textarea')!.value).toBe('unsaved')
    ui.unmount()
  })

  it('shows a load failure and does not let you type', async () => {
    withNotes(async () => { throw new Error('nope') })
    const ui = mount(inBoard(<NotesPanel task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('nope')
    expect(ui.container.querySelector('textarea')!.disabled).toBe(true)
    ui.unmount()
  })
})

describe('ProjectContext', () => {
  const initiative: RelatedEntity = {
    relation: 'initiative', id: 'i1', title: 'Core banking', url: 'https://app.notion.com/p/i1',
    properties: [{ name: 'Status', type: 'status', value: 'At risk' }], content: 'Long text here',
  }

  it('shows a card per linked entity, skipping empty relations, and opens one in full', async () => {
    adapter = { related: async () => [initiative, { relation: 'issue', id: null, empty: true }] }
    const ui = mount(inBoard(<ProjectContext task={story} />))
    expect(ui.container.textContent).toContain('Loading context…')
    await flush()
    expect(ui.container.textContent).toContain('Core banking')
    expect(ui.container.textContent).toContain('At risk')
    expect(ui.container.textContent).not.toContain('ISSUE')
    click(ui.container.querySelector('button[title="Open in full"]')!)
    expect(document.querySelector('[role=dialog]')).not.toBeNull()
    expect(document.querySelector('[role=dialog]')!.textContent).toContain('Long text here')
    key(window, 'Escape')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    ui.unmount()
  })

  it('says when there is nothing linked, there is no source, or loading failed', async () => {
    adapter = { related: async () => [{ relation: 'parent', id: null, empty: true }] }
    let ui = mount(inBoard(<ProjectContext task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('No linked initiative, issue, or parent')
    ui.unmount()

    adapter = {}
    ui = mount(inBoard(<ProjectContext task={makeTask({ id: 'z', queue: undefined })} />))
    expect(ui.container.textContent).toContain('No linked initiative, issue, or parent')
    ui.unmount()

    resetLoadCache()
    adapter = { related: async () => { throw new Error('page not shared') } }
    ui = mount(inBoard(<ProjectContext task={makeTask({ id: 'y', queue: 'q' })} />))
    await flush()
    expect(ui.container.querySelector('[role=alert]')!.textContent).toBe('page not shared')
    ui.unmount()
  })

  it('shows a failing card as unavailable instead of dropping it', async () => {
    adapter = { related: async () => [{ relation: 'issue', id: 'x', error: 'no access' }] }
    const ui = mount(inBoard(<ProjectContext task={story} />))
    await flush()
    expect(ui.container.textContent).toContain('Unavailable — no access')
    ui.unmount()
  })
})

describe('CockpitPane', () => {
  const handlers = () => ({ start: vi.fn(), add: vi.fn(), block: vi.fn(), unblock: vi.fn(), return: vi.fn(), done: vi.fn() })
  const labels = (el: HTMLElement) => [...el.querySelectorAll('[role=toolbar] button')].map(b => b.textContent)

  it('shows the header, the description, and the lane\'s buttons', () => {
    adapter = {}
    const h = handlers()
    const task = makeTask({ id: 't', ref: 'DEV-T', type: 'task', title: 'Merge the hotfix', description: 'A **description**', externalState: 'Active', priority: 'high', points: 3, sprint: 'SPR-20', assignee: 'AL', tags: ['api'], url: 'https://dev.azure.com/x', status: 'today' })
    const ui = mount(inBoard(<CockpitPane task={task} sourceLabel="Tasks" planned doneTarget="Notion" handlers={h} />))
    const text = ui.container.textContent!
    for (const piece of ['TASK', 'DEV-T', 'via Tasks', 'Active', 'Open in ADO ↗', 'HIGH', '3 pt', 'SPR-20', 'AL', 'Merge the hotfix', '#api']) expect(text).toContain(piece)
    expect(labels(ui.container)).toEqual(['▶ Start', 'Block', '✓ Done'])
    ui.unmount()
  })

  it('wires each button to its handler', () => {
    adapter = {}
    const h = handlers()
    const ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'today' })} planned doneTarget="Notion" handlers={h} />))
    for (const button of ui.container.querySelectorAll('[role=toolbar] button')) click(button)
    expect([h.start, h.block, h.done].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
    ui.unmount()
  })

  it('follows the lane: working, blocked, and a queue item that is already planned', () => {
    adapter = {}
    const h = handlers()
    let ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'working' })} planned working doneTarget={null} handlers={h} />))
    expect(labels(ui.container)).toEqual(['Return to plan', 'Block'])
    expect(ui.container.textContent).toContain('Working')
    ui.unmount()
    ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'blocked' })} planned doneTarget={null} handlers={h} />))
    expect(labels(ui.container)).toEqual(['Unblock'])
    ui.unmount()
    ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'queue' })} planned doneTarget={null} handlers={h} />))
    expect(labels(ui.container)).toEqual(['▶ Start'])
    expect(ui.container.textContent).toContain("In today's plan")
    ui.unmount()
  })

  it('leaves out Done when the source is read-only, and a button with no handler', () => {
    adapter = {}
    const ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'today' })} planned doneTarget={null} handlers={{ start: vi.fn() }} />))
    expect(labels(ui.container)).toEqual(['▶ Start'])
    ui.unmount()
  })

  it('has a Close button only when given onClose', () => {
    adapter = {}
    const onClose = vi.fn()
    const ui = mount(inBoard(<CockpitPane task={makeTask()} planned doneTarget={null} handlers={{}} onClose={onClose} />))
    click(ui.container.querySelector('button[aria-label=Close]')!)
    expect(onClose).toHaveBeenCalledOnce()
    ui.render(inBoard(<CockpitPane task={makeTask()} planned doneTarget={null} handlers={{}} />))
    expect(ui.container.querySelector('button[aria-label=Close]')).toBeNull()
    ui.unmount()
  })

  it('does not carry a note over from one item to the next when keyed by the item', async () => {
    adapter = { notes: { load: async task => `note for ${task.id}`, save: async () => {} } }
    const a = makeTask({ id: 'a', queue: 'q' })
    const b = makeTask({ id: 'b', queue: 'q' })
    const ui = mount(inBoard(<CockpitPane key="a" task={a} planned doneTarget={null} handlers={{}} />))
    await flush()
    expect(ui.container.querySelector('textarea')!.value).toBe('note for a')
    ui.render(inBoard(<CockpitPane key="b" task={b} planned doneTarget={null} handlers={{}} />))
    await flush()
    expect(ui.container.querySelector('textarea')!.value).toBe('note for b')
    ui.unmount()
  })

  it('makes the Return button draggable when asked', () => {
    adapter = {}
    const onDrag = vi.fn()
    const ui = mount(inBoard(<CockpitPane task={makeTask({ status: 'working' })} planned working doneTarget={null} handlers={{ return: vi.fn() }} onReturnDragStart={onDrag} />))
    expect(ui.container.querySelector<HTMLButtonElement>('[role=toolbar] button')!.draggable).toBe(true)
    ui.unmount()
  })
})
