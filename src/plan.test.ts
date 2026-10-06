import { describe, expect, it } from 'vitest'

import type { StandupBrief } from './bridge'
import {
  addItem, agingLabel, findDuplicates, linkEntries, matchLine, mergeBrief, plannedIds, rankByTitle,
  removeAddedEntry, removeEntry, reorder, rollover, shift, suggestLinks, updateEntry, updateItemEntries, words,
} from './plan'
import { makeEntry, makePlan, makeTask } from './test/factories'

const brief = (overrides: Partial<StandupBrief> = {}): StandupBrief => ({
  date: '2026-10-06', isToday: true, mode: 'brief', teamItems: [], responsibilities: [], aging: [], summaries: [], ...overrides,
})
const line = (text: string, mentions: string[] = []) => ({ text, mentions })

describe('rollover', () => {
  it('returns the same plan on the same day', () => {
    const plan = makePlan([makeEntry()])
    expect(rollover(plan, '2026-10-06')).toBe(plan)
  })

  it('carries unfinished entries over and logs the finished ones', () => {
    const plan = makePlan([
      makeEntry({ id: 'open', text: 'Still open' }),
      makeEntry({ id: 'done', text: 'Finished', done: true, itemRef: 'US-1' }),
    ])
    const next = rollover(plan, '2026-10-07')
    expect(next.day).toBe('2026-10-07')
    expect(next.entries.map(e => e.id)).toEqual(['open'])
    expect(next.doneLog).toEqual([{ day: '2026-10-06', text: 'Finished', ref: 'US-1' }])
  })

  it('drops done-log records older than a week and keeps recent ones', () => {
    const plan = makePlan([], {
      doneLog: [
        { day: '2026-09-25', text: 'Too old' },
        { day: '2026-10-01', text: 'Recent' },
      ],
    })
    expect(rollover(plan, '2026-10-07').doneLog?.map(r => r.text)).toEqual(['Recent'])
  })

  it('keeps only the last 14 merged briefs', () => {
    const merged = Array.from({ length: 20 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    expect(rollover(makePlan([], { mergedBriefs: merged }), '2026-10-07').mergedBriefs).toEqual(merged.slice(-14))
  })
})

describe('mergeBrief', () => {
  it('adds the responsibilities at the top, in the brief order', () => {
    const plan = makePlan([makeEntry({ id: 'mine', text: 'Added by hand' })])
    const merged = mergeBrief(plan, brief({ responsibilities: [line('First thing'), line('Second thing')] }))
    expect(merged.entries.map(e => e.text)).toEqual(['First thing', 'Second thing', 'Added by hand'])
    expect(merged.entries[0]).toMatchObject({ id: 'standup:2026-10-06:0', origin: 'standup', briefDate: '2026-10-06' })
    expect(merged.mergedBriefs).toEqual(['2026-10-06'])
  })

  it('merges a standup only once', () => {
    const once = mergeBrief(makePlan(), brief({ responsibilities: [line('First thing')] }))
    expect(mergeBrief(once, brief({ responsibilities: [line('First thing'), line('New')] }))).toBe(once)
  })

  it('ignores leadership summaries, missing briefs and empty lines', () => {
    const plan = makePlan()
    expect(mergeBrief(plan, null)).toBe(plan)
    expect(mergeBrief(plan, brief({ mode: 'leadership' }))).toBe(plan)
    expect(mergeBrief(plan, brief({ responsibilities: [line('')] })).entries).toEqual([])
  })

  it('refreshes a responsibility repeated from an earlier standup instead of duplicating it', () => {
    const first = mergeBrief(makePlan(), brief({
      date: '2026-10-05', responsibilities: [line('Investigate the transfer error on the HELOC pull')],
    }))
    const next = mergeBrief({ ...first, day: '2026-10-06' }, brief({
      date: '2026-10-06', responsibilities: [line('Investigate the HELOC pull transfer error again')],
    }))
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]).toMatchObject({ briefDate: '2026-10-06', text: 'Investigate the HELOC pull transfer error again' })
  })

  it('keeps a finished repeat as its own entry', () => {
    const plan = makePlan([makeEntry({
      id: 'old', origin: 'standup', briefDate: '2026-10-05', done: true, text: 'Investigate the transfer error on the HELOC pull',
    })])
    const next = mergeBrief(plan, brief({ responsibilities: [line('Investigate the transfer error on the HELOC pull')] }))
    expect(next.entries).toHaveLength(2)
  })
})

describe('addItem', () => {
  const task = makeTask({ id: 'a1', title: 'Fix the late fee', ref: 'US-100', source: 'stories' })

  it('adds an entry linked to the item', () => {
    const plan = addItem(makePlan(), task)
    expect(plan.entries[0]).toMatchObject({
      id: 'item:a1:2026-10-06', text: 'Fix the late fee', origin: 'added', itemId: 'a1', itemRef: 'US-100', itemSource: 'stories', linkedBy: 'you',
    })
  })

  it('does not add an item that already has an open entry', () => {
    const once = addItem(makePlan(), task)
    expect(addItem(once, task)).toBe(once)
  })

  it('gives a reopened item a second entry with a new id', () => {
    const once = addItem(makePlan(), task)
    const done = updateItemEntries(once, 'a1', { done: true })
    const twice = addItem(done, task)
    expect(twice.entries.map(e => e.id)).toEqual(['item:a1:2026-10-06', 'item:a1:2026-10-06:2'])
  })
})

describe('plan edits', () => {
  const plan = makePlan([
    makeEntry({ id: 'a', itemId: 'x' }),
    makeEntry({ id: 'b', origin: 'standup' }),
    makeEntry({ id: 'c', itemId: 'y' }),
  ])

  it('plannedIds lists linked items, done or not', () => {
    expect([...plannedIds(makePlan([makeEntry({ itemId: 'x', done: true }), makeEntry({ id: 'e2' })]))]).toEqual(['x'])
  })

  it('updateItemEntries changes every entry for an item, or returns the same plan', () => {
    expect(updateItemEntries(plan, 'x', { done: true }).entries[0].done).toBe(true)
    expect(updateItemEntries(plan, 'nobody', { done: true })).toBe(plan)
  })

  it('updateEntry accepts a change or a function of the entry', () => {
    expect(updateEntry(plan, 'b', { text: 'New' }).entries[1].text).toBe('New')
    expect(updateEntry(plan, 'b', e => ({ text: `${e.id}!` })).entries[1].text).toBe('b!')
  })

  it('removeEntry removes by id', () => {
    expect(removeEntry(plan, 'b').entries.map(e => e.id)).toEqual(['a', 'c'])
  })

  it('removeAddedEntry only removes an open entry the developer added', () => {
    const mixed = makePlan([
      makeEntry({ id: 'added', origin: 'added', itemId: 'x' }),
      makeEntry({ id: 'standup', origin: 'standup', itemId: 'x' }),
      makeEntry({ id: 'finished', origin: 'added', itemId: 'x', done: true }),
    ])
    expect(removeAddedEntry(mixed, 'x').entries.map(e => e.id)).toEqual(['standup', 'finished'])
  })

  it('reorder moves an entry before another, or to the end', () => {
    expect(reorder(plan, 'c', 'a').entries.map(e => e.id)).toEqual(['c', 'a', 'b'])
    expect(reorder(plan, 'a', null).entries.map(e => e.id)).toEqual(['b', 'c', 'a'])
    expect(reorder(plan, 'a', 'a')).toBe(plan)
    expect(reorder(plan, 'zzz', 'a')).toBe(plan)
  })

  it('shift swaps with a neighbour and stops at the ends', () => {
    expect(shift(plan, 'b', -1).entries.map(e => e.id)).toEqual(['b', 'a', 'c'])
    expect(shift(plan, 'b', 1).entries.map(e => e.id)).toEqual(['a', 'c', 'b'])
    expect(shift(plan, 'a', -1)).toBe(plan)
    expect(shift(plan, 'c', 1)).toBe(plan)
    expect(shift(plan, 'nope', 1)).toBe(plan)
  })
})

describe('title similarity', () => {
  it('words lowercases, drops stop words and stems', () => {
    expect([...words('Investigating the Transfers on HELOC')]).toEqual(['investigat', 'transfer', 'heloc'])
  })

  it('rankByTitle puts the closest title first and drops unrelated ones', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Update the developer diary' }),
      makeTask({ id: 'b', title: 'Investigate transfer error on HELOC pull' }),
      makeTask({ id: 'c', title: 'Unrelated work entirely' }),
    ]
    const ranked = rankByTitle('Investigate the HELOC transfer error', tasks)
    expect(ranked.map(r => r.task.id)).toEqual(['b'])
    expect(ranked[0].score).toBe(1)
  })
})

describe('linkEntries', () => {
  const heloc = makeTask({ id: 'heloc', title: 'Investigate transfer error on HELOC pull', source: 'tasks' })
  const diary = makeTask({ id: 'diary', title: 'Update the developer diary template', source: 'tasks' })
  const story = makeTask({ id: '12345', ref: 'US-12345', title: 'Something else entirely', source: 'stories' })

  it('links an @mention exactly', () => {
    const plan = makePlan([makeEntry({ id: 'e', text: 'Totally different words', mentions: ['diary'] })])
    const next = linkEntries(plan, [heloc, diary])
    expect(next.entries[0]).toMatchObject({ itemId: 'diary', linkedBy: 'mention', itemRef: diary.ref })
  })

  it('links an ADO number in the text', () => {
    const plan = makePlan([makeEntry({ id: 'e', text: 'Finish US-12345 before the sprint ends' })])
    expect(linkEntries(plan, [story]).entries[0]).toMatchObject({ itemId: '12345', linkedBy: 'ref' })
    // ADO's own #12345 style works after a space, at the start of the text and in brackets.
    for (const text of ['Finish #12345 soon', '#12345 first', 'See (#12345)']) {
      const hash = makePlan([makeEntry({ id: 'e', text })])
      expect(linkEntries(hash, [story]).entries[0]).toMatchObject({ itemId: '12345', linkedBy: 'ref' })
    }
    // A number glued to other text isn't a reference.
    const glued = makePlan([makeEntry({ id: 'e', text: 'abc#12345 and US-123456789' })])
    expect(linkEntries(glued, [story])).toBe(glued)
  })

  it('links a clear title match', () => {
    const plan = makePlan([makeEntry({ id: 'e', text: 'Investigate the transfer error on the HELOC pull' })])
    expect(linkEntries(plan, [heloc, diary]).entries[0]).toMatchObject({ itemId: 'heloc', linkedBy: 'match' })
  })

  it('does not link a weak match, and returns the same plan when nothing links', () => {
    const plan = makePlan([makeEntry({ id: 'e', text: 'Investigate the lunch menu' })])
    expect(linkEntries(plan, [heloc, diary])).toBe(plan)
  })

  it('never links one item to two entries, giving it to the better fit', () => {
    const plan = makePlan([
      makeEntry({ id: 'weaker', text: 'Investigate transfer error and other things' }),
      makeEntry({ id: 'better', text: 'Investigate transfer error on HELOC pull' }),
    ])
    const next = linkEntries(plan, [heloc])
    expect(next.entries.find(e => e.id === 'better')?.itemId).toBe('heloc')
    expect(next.entries.find(e => e.id === 'weaker')?.itemId).toBeUndefined()
  })

  it('skips items the developer rejected, done entries and entries that are already linked', () => {
    const rejected = makePlan([makeEntry({ id: 'e', text: 'Investigate transfer error on HELOC pull', rejected: ['heloc'] })])
    expect(linkEntries(rejected, [heloc])).toBe(rejected)
    const done = makePlan([makeEntry({ id: 'e', text: 'Investigate transfer error on HELOC pull', done: true })])
    expect(linkEntries(done, [heloc])).toBe(done)
    const linked = makePlan([makeEntry({ id: 'e', text: 'Investigate transfer error on HELOC pull', itemId: 'other' })])
    expect(linkEntries(linked, [heloc])).toBe(linked)
  })
})

describe('suggestLinks', () => {
  const heloc = makeTask({ id: 'heloc', title: 'Investigate transfer error on HELOC pull' })

  it('suggests a likely item for an unlinked entry', () => {
    const plan = makePlan([makeEntry({ id: 'e', text: 'Look into the HELOC transfer problem' })])
    expect(suggestLinks(plan, [heloc]).get('e')).toBe(heloc)
  })

  it('suggests nothing for linked, done or rejected entries, or items already taken', () => {
    const plan = makePlan([
      makeEntry({ id: 'linked', text: 'HELOC transfer error', itemId: 'x' }),
      makeEntry({ id: 'done', text: 'HELOC transfer error', done: true }),
      makeEntry({ id: 'rejected', text: 'HELOC transfer error', rejected: ['heloc'] }),
    ])
    expect(suggestLinks(plan, [heloc]).size).toBe(0)
    const taken = makePlan([
      makeEntry({ id: 'a', text: 'HELOC transfer error', itemId: 'heloc' }),
      makeEntry({ id: 'b', text: 'HELOC transfer error' }),
    ])
    expect(suggestLinks(taken, [heloc]).size).toBe(0)
  })
})

describe('findDuplicates', () => {
  it('flags items whose titles say the same thing, in both directions', () => {
    const a = makeTask({ id: 'a', title: 'Send duplicate late fees email to stakeholders' })
    const b = makeTask({ id: 'b', title: 'Send duplicate late fees email to the stakeholders' })
    const c = makeTask({ id: 'c', title: 'Rotate the signing certificate' })
    const found = findDuplicates([a, b, c])
    expect(found.get('a')).toBe(b)
    expect(found.get('b')).toBe(a)
    expect(found.has('c')).toBe(false)
  })
})

describe('agingLabel and matchLine', () => {
  it('splits an aging line at the last em or en dash and reads the date', () => {
    expect(agingLabel('Late-fees email — active since Aug. 31.')).toEqual({ title: 'Late-fees email', since: 'Aug 31' })
    expect(agingLabel('Late-fees email – sitting since Aug 31, longest-aging')).toEqual({ title: 'Late-fees email', since: 'Aug 31' })
  })

  it('returns the whole line when there is no dash or date', () => {
    expect(agingLabel('Late-fees email')).toEqual({ title: 'Late-fees email', since: '' })
    expect(agingLabel('Late-fees email — no date here')).toEqual({ title: 'Late-fees email', since: '' })
  })

  it('matchLine finds the item a line refers to, only when it is clear', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Send duplicate late fees email to stakeholders' }),
      makeTask({ id: 'b', title: 'Rotate the signing certificate' }),
    ]
    expect(matchLine('Send the duplicate late fees email to stakeholders', tasks)?.id).toBe('a')
    expect(matchLine('Buy lunch', tasks)).toBeUndefined()
  })
})
