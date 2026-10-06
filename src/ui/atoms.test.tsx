// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { click, key, mount, run } from '../test/render'
import {
  Avatar, BuildStatus, Button, Checkbox, Chip, EmptyState, ErrorNote, PrStatus, PriorityBadge, SectionLabel, Tabs, TypeChip,
} from './atoms'
import { Overlay } from './Overlay'
import { Toast } from './Toast'

afterEach(() => { document.body.innerHTML = '' })

describe('display atoms', () => {
  it('Chip is neutral unless it reports a status', () => {
    const ui = mount(<div><Chip>Active</Chip><Chip tone="ok">Working</Chip><Chip tone="danger">Blocked</Chip></div>)
    const [plain, ok, danger] = [...ui.container.querySelectorAll('.chip')]
    expect(plain.className).not.toMatch(/text-ok|text-danger|bg-ok|bg-danger/)
    expect(ok.className).toMatch(/text-ok/)
    expect(danger.className).toMatch(/text-danger-fg/)
    ui.unmount()
  })

  it('TypeChip shows the type word, never coloured', () => {
    const ui = mount(<TypeChip type="incident" />)
    expect(ui.container.textContent).toBe('INCIDENT')
    expect(ui.container.innerHTML).not.toMatch(/text-(ok|warn|danger)/)
    ui.unmount()
  })

  it('PriorityBadge shows a label, and nothing without a priority', () => {
    const ui = mount(<div><PriorityBadge priority="critical" /><PriorityBadge priority="none" /></div>)
    expect(ui.container.textContent).toBe('CRIT')
    ui.unmount()
  })

  it('Avatar shows initials and renders nothing when empty', () => {
    const ui = mount(<div><Avatar initials="AL" /><Avatar initials="" /></div>)
    expect(ui.container.textContent).toBe('AL')
    ui.unmount()
  })

  it('SectionLabel shows the count, including 0, and the right slot', () => {
    const ui = mount(<SectionLabel count={0} right={<a href="#x">all</a>}>PLAN</SectionLabel>)
    expect(ui.container.textContent).toBe('PLAN0all')
    ui.unmount()
  })

  it('PrStatus and BuildStatus show words, and nothing for the unknown', () => {
    const ui = mount(<div><PrStatus pr={{ status: 'completed' }} /><BuildStatus build={{ result: 'failed' }} /><PrStatus pr={{}} /></div>)
    expect(ui.container.textContent).toBe('MERGEDFAILED')
    ui.unmount()
  })

  it('EmptyState shows its hint only when given one', () => {
    const ui = mount(<div><EmptyState title="Nothing here" /><EmptyState title="Empty" hint="Add something" /></div>)
    expect(ui.container.textContent).toBe('Nothing hereEmptyAdd something')
    ui.unmount()
  })
})

describe('Button and Checkbox', () => {
  it('Button defaults to type=button, so it never submits a form, and passes clicks through', () => {
    const onClick = vi.fn()
    const ui = mount(<Button onClick={onClick}>Go</Button>)
    const button = ui.container.querySelector('button')!
    expect(button.type).toBe('button')
    click(button)
    expect(onClick).toHaveBeenCalledOnce()
    ui.unmount()
  })

  it('a disabled Button does not click', () => {
    const onClick = vi.fn()
    const ui = mount(<Button disabled onClick={onClick}>Go</Button>)
    click(ui.container.querySelector('button')!)
    expect(onClick).not.toHaveBeenCalled()
    ui.unmount()
  })

  it('Checkbox is a real checkbox for the keyboard and screen readers', () => {
    const onChange = vi.fn()
    const ui = mount(<Checkbox checked={false} onChange={onChange} label="Tick it" />)
    const box = ui.container.querySelector('[role=checkbox]')!
    expect(box.getAttribute('aria-checked')).toBe('false')
    expect(box.getAttribute('aria-label')).toBe('Tick it')
    click(box)
    expect(onChange).toHaveBeenCalledWith(true)
    ui.render(<Checkbox checked onChange={onChange} label="Tick it" />)
    expect(ui.container.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('true')
    expect(ui.container.textContent).toBe('✓')
    ui.unmount()
  })
})

describe('Tabs', () => {
  const tabs = [{ id: 'a', label: 'Plan', count: 3 }, { id: 'b', label: 'Queue', count: 0 }, { id: 'c', label: 'Next' }]

  function Harness({ onChange }: { onChange?: (id: string) => void }) {
    const [value, setValue] = useState('a')
    return <Tabs label="Filters" tabs={tabs} value={value} onChange={id => { setValue(id); onChange?.(id) }} />
  }

  it('marks the selected tab, shows counts above zero, and only the selected tab is in the tab order', () => {
    const ui = mount(<Harness />)
    const tabEls = [...ui.container.querySelectorAll('[role=tab]')] as HTMLElement[]
    expect(ui.container.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Filters')
    expect(tabEls.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabEls.map(t => t.tabIndex)).toEqual([0, -1, -1])
    expect(tabEls.map(t => t.textContent)).toEqual(['Plan3', 'Queue', 'Next'])
    ui.unmount()
  })

  it('arrow keys, Home and End move the selection and the focus, wrapping at the ends', () => {
    const onChange = vi.fn()
    const ui = mount(<Harness onChange={onChange} />)
    const list = ui.container.querySelector('[role=tablist]')!
    const selected = () => ui.container.querySelector('[aria-selected=true]')!.textContent
    key(list, 'ArrowRight')
    expect(selected()).toBe('Queue')
    expect(document.activeElement?.textContent).toBe('Queue')
    key(list, 'End')
    expect(selected()).toBe('Next')
    key(list, 'ArrowRight')
    expect(selected()).toBe('Plan3')
    key(list, 'ArrowLeft')
    expect(selected()).toBe('Next')
    key(list, 'Home')
    expect(selected()).toBe('Plan3')
    expect(onChange).toHaveBeenCalledTimes(5)
    ui.unmount()
  })

  it('ignores other keys and lets a click choose a tab', () => {
    const ui = mount(<Harness />)
    key(ui.container.querySelector('[role=tablist]')!, 'x')
    expect(ui.container.querySelector('[aria-selected=true]')!.textContent).toBe('Plan3')
    click(ui.container.querySelectorAll('[role=tab]')[2])
    expect(ui.container.querySelector('[aria-selected=true]')!.textContent).toBe('Next')
    ui.unmount()
  })
})

describe('ErrorNote and Toast', () => {
  it('ErrorNote is announced, and dismissible only when given onDismiss', () => {
    const onDismiss = vi.fn()
    const ui = mount(<div><ErrorNote>Plain</ErrorNote><ErrorNote onDismiss={onDismiss}>Closable</ErrorNote></div>)
    const [plain, closable] = [...ui.container.querySelectorAll('[role=alert]')]
    expect(plain.querySelector('button')).toBeNull()
    click(closable.querySelector('button')!)
    expect(onDismiss).toHaveBeenCalledOnce()
    ui.unmount()
  })

  it('Toast is a status message with Undo and dismiss when given them', () => {
    const [onUndo, onDismiss] = [vi.fn(), vi.fn()]
    const ui = mount(<Toast text="Marked done" onUndo={onUndo} onDismiss={onDismiss} />)
    expect(ui.container.querySelector('[role=status]')!.textContent).toContain('Marked done')
    const [undo, dismiss] = [...ui.container.querySelectorAll('button')]
    click(undo); click(dismiss)
    expect([onUndo.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1])
    ui.render(<Toast text="Just a note" />)
    expect(ui.container.querySelectorAll('button')).toHaveLength(0)
    ui.unmount()
  })
})

describe('Overlay', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    return (
      <>
        <button id="opener">Open</button>
        <Overlay label="Example" onClose={onClose}>
          <button id="first">First</button>
          <button id="last">Last</button>
        </Overlay>
      </>
    )
  }

  it('is a labelled modal dialog that the global shortcuts can detect', () => {
    const ui = mount(<Harness onClose={() => {}} />)
    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Example')
    expect(document.querySelector('[data-overlay]')).not.toBeNull()
    ui.unmount()
  })

  it('moves focus in when it opens', () => {
    const ui = mount(<Harness onClose={() => {}} />)
    expect(document.activeElement?.id).toBe('first')
    ui.unmount()
  })

  it('closes on Esc and on a click outside, but not on a click inside', () => {
    const onClose = vi.fn()
    const ui = mount(<Harness onClose={onClose} />)
    click(document.getElementById('first')!)
    expect(onClose).not.toHaveBeenCalled()
    key(window, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    click(document.querySelector('[data-overlay]')!)
    expect(onClose).toHaveBeenCalledTimes(2)
    ui.unmount()
  })

  it('keeps Tab and Shift+Tab inside the panel', () => {
    const ui = mount(<Harness onClose={() => {}} />)
    const dialog = document.querySelector('[role=dialog]')!
    document.getElementById('last')!.focus()
    key(dialog, 'Tab')
    expect(document.activeElement?.id).toBe('first')
    key(dialog, 'Tab', { shiftKey: true })
    expect(document.activeElement?.id).toBe('last')
    ui.unmount()
  })

  it('gives focus back to what opened it', () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button id="opener" onClick={() => setOpen(true)}>Open</button>
          {open && <Overlay label="Example" onClose={() => setOpen(false)}><button id="inside">Inside</button></Overlay>}
        </>
      )
    }
    const ui = mount(<Opener />)
    const opener = document.getElementById('opener')!
    opener.focus()
    click(opener)
    expect(document.activeElement?.id).toBe('inside')
    key(window, 'Escape')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.activeElement?.id).toBe('opener')
    run(() => {})
    ui.unmount()
  })
})
