import { describe, expect, it } from 'vitest'

import { rankUpNext, reasonsFor } from './ranking'
import type { RankContext } from './ranking'
import { makeSprint, makeTask } from './test/factories'

const ctx = (overrides: Partial<RankContext> = {}): RankContext => ({
  sprint: makeSprint(), staleDays: 6, aging: new Map(), workingDaysLeft: 5, ...overrides,
})
const texts = (reasons: { text: string }[]) => reasons.map(r => r.text)

describe('reasonsFor', () => {
  it('flags an aging item, with the date when the brief gave one', () => {
    const task = makeTask({ id: 'a' })
    expect(reasonsFor(task, ctx({ aging: new Map([['a', 'Aug 31']]) }))[0]).toEqual({ text: 'Aging since Aug 31', urgent: true })
    expect(reasonsFor(task, ctx({ aging: new Map([['a', '']]) }))[0]).toEqual({ text: 'Aging', urgent: true })
  })

  it('flags a task that has sat in standup past the stale threshold', () => {
    expect(texts(reasonsFor(makeTask({ source: 'tasks', standupAgeDays: 7 }), ctx()))).toEqual(['In standup 7 days'])
    expect(reasonsFor(makeTask({ source: 'tasks', standupAgeDays: 6 }), ctx())).toEqual([])
    expect(reasonsFor(makeTask({ source: 'tasks' }), ctx())).toEqual([])
  })

  it('describes Pulse items by how many sprints old they are', () => {
    const pulse = (sprint: string) => makeTask({ source: 'pulse', sprint })
    expect(reasonsFor(pulse('SPR-18'), ctx())[0]).toEqual({ text: '2 sprints old', urgent: true })
    expect(reasonsFor(pulse('SPR-19'), ctx())[0]).toEqual({ text: 'From last sprint', urgent: false })
    expect(reasonsFor(pulse('SPR-20'), ctx())[0].text).toBe('Member request')
    expect(reasonsFor(makeTask({ source: 'pulse' }), ctx())[0].text).toBe('Member request')
  })

  it('uses ADO priority and points for stories, and the sprint ending', () => {
    const story = makeTask({ source: 'stories', priorityLabel: 'P1', points: 3 })
    expect(texts(reasonsFor(story, ctx({ workingDaysLeft: 1 })))).toEqual(['P1', 'Sprint ends Tue', '3 pt'])
    expect(texts(reasonsFor(story, ctx({ workingDaysLeft: 4 })))).toEqual(['P1', '3 pt'])
    expect(texts(reasonsFor(makeTask({ source: 'stories', priorityLabel: 'P2' }), ctx()))).toEqual(['P2'])
    expect(texts(reasonsFor(makeTask({ source: 'stories', priorityLabel: 'P4' }), ctx()))).toEqual(['P4'])
  })

  it('does not mention the sprint ending when the sprint is unknown', () => {
    const story = makeTask({ source: 'stories', priorityLabel: 'P3' })
    expect(texts(reasonsFor(story, ctx({ sprint: null })))).toEqual(['P3'])
    expect(texts(reasonsFor(story, ctx({ workingDaysLeft: null })))).toEqual(['P3'])
  })

  it('describes Solarwinds tickets by their priority and state', () => {
    const ticket = makeTask({ source: 'solarwinds', priority: 'critical', priorityLabel: 'Critical', externalState: 'Assigned' })
    expect(reasonsFor(ticket, ctx())).toEqual([
      { text: 'Critical priority', urgent: true },
      { text: 'Assigned', urgent: false },
    ])
  })

  it('lists the strongest reason first', () => {
    const task = makeTask({ id: 'a', source: 'tasks', standupAgeDays: 9 })
    expect(texts(reasonsFor(task, ctx({ aging: new Map([['a', 'Aug 31']]) })))).toEqual(['Aging since Aug 31', 'In standup 9 days'])
  })
})

describe('rankUpNext', () => {
  const tasks = [
    makeTask({ id: 'plain', source: 'tasks' }),
    makeTask({ id: 'stale', source: 'tasks', standupAgeDays: 20 }),
    makeTask({ id: 'aging', source: 'tasks' }),
    makeTask({ id: 'planned', source: 'tasks', standupAgeDays: 30 }),
    makeTask({ id: 'working', source: 'tasks', standupAgeDays: 30, status: 'working' }),
    makeTask({ id: 'plain2', source: 'tasks' }),
  ]

  it('ranks by score and leaves out planned items and items off the queue', () => {
    const ranked = rankUpNext(tasks, new Set(['planned']), ctx({ aging: new Map([['aging', 'Aug 31']]) }))
    expect(ranked.map(s => s.task.id)).toEqual(['aging', 'stale', 'plain', 'plain2'])
  })

  it('keeps the board order for ties', () => {
    const ranked = rankUpNext(tasks, new Set(), ctx())
    const ties = ranked.filter(s => s.score === 0).map(s => s.task.id)
    expect(ties).toEqual(['plain', 'aging', 'plain2'])
  })

  it('gives every suggestion its score and reasons', () => {
    const [first] = rankUpNext(tasks, new Set(), ctx())
    expect(first.score).toBeGreaterThan(0)
    expect(first.reasons.length).toBeGreaterThan(0)
  })
})
