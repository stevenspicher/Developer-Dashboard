import { describe, expect, it } from 'vitest'

import { makeEntry, makePlan } from '../../test/factories'
import { dayStrip } from './dayStrip'

const counts = (items: ReturnType<typeof dayStrip>) => Object.fromEntries(items.map(i => [i.part, i.count]))

describe('dayStrip', () => {
  it('counts open entries, the working item, blocked items and done entries', () => {
    const plan = makePlan([
      makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c', done: true }), makeEntry({ id: 'd', done: true }), makeEntry({ id: 'e', done: true }),
    ])
    expect(counts(dayStrip({ plan, workingId: null, blockedCount: 2 }))).toEqual({ plan: 2, working: 0, blocked: 2, done: 3 })
  })

  it('counts the item being worked on once, as working', () => {
    const plan = makePlan([makeEntry({ id: 'a', itemId: 't1' }), makeEntry({ id: 'b' })])
    expect(counts(dayStrip({ plan, workingId: 't1', blockedCount: 0 }))).toEqual({ plan: 1, working: 1, blocked: 0, done: 0 })
  })

  it('is all zeros for an empty day', () => {
    expect(Object.values(counts(dayStrip({ plan: makePlan(), workingId: null, blockedCount: 0 })))).toEqual([0, 0, 0, 0])
  })
})
