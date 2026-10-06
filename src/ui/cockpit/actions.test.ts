import { describe, expect, it } from 'vitest'

import { laneActions } from './actions'

const ids = (task: Parameters<typeof laneActions>[0], opts = { planned: false, canDone: false }) =>
  laneActions(task, opts).actions.map(a => a.id)

describe('laneActions', () => {
  it('queue: Start and Plan', () => {
    expect(ids({ status: 'queue', source: 'tasks' })).toEqual(['start', 'add'])
  })

  it('queue, Pulse: Plan becomes Claim and plan', () => {
    const { actions } = laneActions({ status: 'queue', source: 'pulse' }, { planned: false, canDone: false })
    expect(actions.find(a => a.id === 'add')?.label).toBe('＋ Claim and plan')
    expect(laneActions({ status: 'queue', source: 'tasks' }, { planned: false, canDone: false }).actions.find(a => a.id === 'add')?.label).toBe('＋ Plan')
  })

  it('queue, already in the plan: no Plan button, and it says so instead', () => {
    const result = laneActions({ status: 'queue', source: 'tasks' }, { planned: true, canDone: false })
    expect(result.actions.map(a => a.id)).toEqual(['start'])
    expect(result.inPlan).toBe(true)
  })

  it('today: Start and Block', () => {
    expect(ids({ status: 'today', source: 'tasks' }, { planned: true, canDone: false })).toEqual(['start', 'block'])
  })

  it('working: Return to plan and Block (no Start, the item is already started)', () => {
    expect(ids({ status: 'working', source: 'stories' }, { planned: true, canDone: false })).toEqual(['return', 'block'])
  })

  it('blocked: only Unblock', () => {
    expect(ids({ status: 'blocked', source: 'stories' }, { planned: true, canDone: false })).toEqual(['unblock'])
  })

  it('adds Done last wherever the source can be written to, and never for a read-only source', () => {
    expect(ids({ status: 'today', source: 'stories' }, { planned: true, canDone: true })).toEqual(['start', 'block', 'done'])
    expect(ids({ status: 'blocked', source: 'stories' }, { planned: true, canDone: true })).toEqual(['unblock', 'done'])
    expect(ids({ status: 'today', source: 'solarwinds' }, { planned: true, canDone: false })).not.toContain('done')
  })

  it('shows inPlan only for queue items', () => {
    expect(laneActions({ status: 'today', source: 'tasks' }, { planned: true, canDone: false }).inPlan).toBe(false)
  })
})
