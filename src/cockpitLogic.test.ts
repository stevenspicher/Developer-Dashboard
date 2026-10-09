// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearTicks, crossRefs, isTicked, loadTicks, refsIn, saveTicks, tickedCount, toggleTick,
} from './cockpitLogic'
import { makeTask } from './test/factories'

describe('ticks', () => {
  it('toggleTick adds a criterion, removes it, and drops an empty item', () => {
    const one = toggleTick({}, 't', 'Works')
    expect(one).toEqual({ t: ['Works'] })
    expect(isTicked(one, 't', 'Works')).toBe(true)
    expect(toggleTick(one, 't', 'Works')).toEqual({})
    expect(toggleTick(one, 't', 'Also')).toEqual({ t: ['Works', 'Also'] })
  })

  it('does not change the object it is given', () => {
    const before = { t: ['Works'] }
    toggleTick(before, 't', 'Also')
    expect(before).toEqual({ t: ['Works'] })
  })

  it('clearTicks forgets closed items and returns the same object when there is nothing to forget', () => {
    const ticks = { a: ['x'], b: ['y'] }
    expect(clearTicks(ticks, ['a', 'zzz'])).toEqual({ b: ['y'] })
    expect(clearTicks(ticks, ['zzz'])).toBe(ticks)
    expect(clearTicks(ticks, new Set(['a', 'b']))).toEqual({})
  })

  it('tickedCount counts only criteria that are still listed on the task', () => {
    const task = makeTask({ id: 't', acceptanceCriteria: ['One', 'Two', 'Three'] })
    expect(tickedCount({ t: ['One', 'Three', 'Removed in ADO'] }, task)).toBe(2)
    expect(tickedCount({}, makeTask({ id: 'u' }))).toBe(0)
  })
})

describe('ticks storage', () => {
  beforeEach(() => localStorage.clear())

  it('saves per developer and loads them back', () => {
    saveTicks('a@x.com', { t: ['One'] })
    expect(loadTicks('a@x.com')).toEqual({ t: ['One'] })
    expect(loadTicks('b@x.com')).toEqual({})
  })

  it('treats corrupt or unexpected stored values as empty', () => {
    localStorage.setItem('devDashboard.criteria.a@x.com', '{not json')
    expect(loadTicks('a@x.com')).toEqual({})
    localStorage.setItem('devDashboard.criteria.a@x.com', '[1,2]')
    expect(loadTicks('a@x.com')).toEqual({})
  })
})

describe('refsIn', () => {
  it('finds refs in the dashboard formats and ADO mentions, unique and in order', () => {
    expect(refsIn('See US-123 and BLUEADS-222, DEV-A1B2C3 and SW-4021. Also #12345 and US-123 again')).toEqual([
      'US-123', 'BLUEADS-222', 'DEV-A1B2C3', 'SW-4021', '#12345',
    ])
  })

  it('gives every ADO ref its #number too, so any work item type matches a # mention', () => {
    expect(refsIn('US-12345, BUG-12346 and TASK-12347')).toEqual(['US-12345', '#12345', 'BUG-12346', '#12346', 'TASK-12347', '#12347'])
  })

  it('ignores things that only look like refs', () => {
    expect(refsIn('Use a-1 or x-ray or blueads-222 or x#12345 or &#12345; and #123')).toEqual([])
  })
})

describe('crossRefs', () => {
  const story = makeTask({ id: '100', ref: 'US-100', title: 'Late fees', description: 'Tracked in BLUEADS-222 as well' })
  const ads = makeTask({ id: 'ads1', ref: 'BLUEADS-222', source: 'ads', title: 'Fees ticket' })
  const other = makeTask({ id: 'o1', ref: 'DEV-O1', title: 'Follow up', description: 'Blocked by US-100' })
  const tasks = [story, ads, other]

  it('finds items this one names and items that name this one', () => {
    const found = crossRefs(story, tasks)
    expect(found.mentions.map(t => t.id)).toEqual(['ads1'])
    expect(found.mentionedBy.map(t => t.id)).toEqual(['o1'])
  })

  it('works the other way round, and never lists the item itself', () => {
    expect(crossRefs(ads, tasks).mentionedBy.map(t => t.id)).toEqual(['100'])
    expect(crossRefs(story, [story]).mentions).toEqual([])
  })

  it('matches an ADO #number to a story, and caps each list at five', () => {
    const many = Array.from({ length: 8 }, (_, i) => makeTask({ id: `m${i}`, ref: `DEV-M${i}`, description: 'See US-100' }))
    expect(crossRefs(story, [story, ...many]).mentionedBy).toHaveLength(5)
    const hash = makeTask({ id: 'h', ref: 'DEV-H', description: 'Fixes #100' })
    expect(crossRefs(story, [story, hash]).mentionedBy.map(t => t.id)).toEqual([])
    const long = makeTask({ id: '12345', ref: 'US-12345' })
    const mention = makeTask({ id: 'q', ref: 'DEV-Q', description: 'Related to #12345' })
    expect(crossRefs(long, [long, mention]).mentionedBy.map(t => t.id)).toEqual(['q'])
  })

  it('matches a bug by its BUG- ref or its #number, either way round', () => {
    const bug = makeTask({ id: '12346', ref: 'BUG-12346', source: 'stories', type: 'bug' })
    const byHash = makeTask({ id: 'a', ref: 'DEV-A', description: 'Caused by #12346' })
    const byRef = makeTask({ id: 'b', ref: 'DEV-B', description: 'See BUG-12346' })
    expect(crossRefs(bug, [bug, byHash, byRef]).mentionedBy.map(t => t.id)).toEqual(['a', 'b'])
    const names = makeTask({ id: 'c', ref: 'DEV-C', description: 'Blocked by #12346' })
    expect(crossRefs(names, [names, bug]).mentions.map(t => t.id)).toEqual(['12346'])
  })
})
