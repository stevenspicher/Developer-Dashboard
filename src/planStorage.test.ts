// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { loadPlan, savePlan } from './plan'
import { makeEntry, makePlan } from './test/factories'

describe('plan storage', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty for a new developer', () => {
    expect(loadPlan('a@x.com', '2026-10-06')).toEqual({ day: '2026-10-06', entries: [], mergedBriefs: [] })
  })

  it('saves per developer and loads the same day unchanged', () => {
    const plan = makePlan([makeEntry({ id: 'a', text: 'Mine' })])
    savePlan('a@x.com', plan)
    expect(loadPlan('a@x.com', '2026-10-06')).toEqual(plan)
    expect(loadPlan('b@x.com', '2026-10-06').entries).toEqual([])
  })

  it('rolls over on a later day', () => {
    savePlan('a@x.com', makePlan([makeEntry({ id: 'open' }), makeEntry({ id: 'done', done: true })]))
    const next = loadPlan('a@x.com', '2026-10-07')
    expect(next.day).toBe('2026-10-07')
    expect(next.entries.map(e => e.id)).toEqual(['open'])
    expect(next.doneLog).toHaveLength(1)
  })

  it('keeps only the first entry of a repeated id', () => {
    savePlan('a@x.com', makePlan([makeEntry({ id: 'x', text: 'first' }), makeEntry({ id: 'x', text: 'second' })]))
    expect(loadPlan('a@x.com', '2026-10-06').entries.map(e => e.text)).toEqual(['first'])
  })

  it('treats corrupt or malformed storage as an empty plan', () => {
    localStorage.setItem('devDashboard.plan.a@x.com', '{nope')
    expect(loadPlan('a@x.com', '2026-10-06').entries).toEqual([])
    localStorage.setItem('devDashboard.plan.a@x.com', JSON.stringify({ day: '2026-10-06' }))
    expect(loadPlan('a@x.com', '2026-10-06').entries).toEqual([])
  })
})
