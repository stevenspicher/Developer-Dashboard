import { describe, expect, it } from 'vitest'

import { makeEntry, makePlan, makeTask } from '../../test/factories'
import type { PullRequest } from '../../bridge'
import { groupTeam, resolvePane, rowId, sameSelection } from './selection'

const pr = (id: number): PullRequest => ({ pullRequestId: id, title: `PR ${id}`, isRequired: false, url: `https://x/${id}` })
const task = makeTask({ id: 't1', title: 'Linked item' })
const working = makeTask({ id: 'w', status: 'working' })

const data = (overrides = {}) => ({
  plan: makePlan([makeEntry({ id: 'linked', itemId: 't1' }), makeEntry({ id: 'free', text: 'No item' })]),
  tasksById: new Map([[task.id, task], [working.id, working]]),
  reviews: [pr(482)],
  team: [{ developer: 'Ben', text: 'Working on QSO', blockers: [] }],
  workingTask: null as ReturnType<typeof makeTask> | null,
  ...overrides,
})

describe('resolvePane', () => {
  it('shows the item for a linked plan entry, not nothing (a plan entry id is not an item id)', () => {
    expect(resolvePane({ kind: 'entry', id: 'linked' }, data())).toMatchObject({ type: 'task', task, entry: { id: 'linked' } })
  })

  it('shows the entry itself when it is not linked to an item', () => {
    expect(resolvePane({ kind: 'entry', id: 'free' }, data())).toMatchObject({ type: 'entry', entry: { text: 'No item' } })
  })

  it('shows the entry when its linked item has left the board', () => {
    const d = data({ plan: makePlan([makeEntry({ id: 'gone', itemId: 'missing' })]) })
    expect(resolvePane({ kind: 'entry', id: 'gone' }, d).type).toBe('entry')
  })

  it('shows an item, a pull request and a team member for their own kinds', () => {
    expect(resolvePane({ kind: 'task', id: 't1' }, data())).toMatchObject({ type: 'task', task })
    expect(resolvePane({ kind: 'review', id: 482 }, data())).toMatchObject({ type: 'review', pr: { pullRequestId: 482 } })
    expect(resolvePane({ kind: 'team', name: 'Ben' }, data())).toMatchObject({ type: 'team', member: { developer: 'Ben' } })
  })

  it('does not mix up kinds that share an id', () => {
    const d = data({ plan: makePlan([makeEntry({ id: 't1' })]) })
    expect(resolvePane({ kind: 'task', id: 't1' }, d)).toMatchObject({ type: 'task', task })
    expect(resolvePane({ kind: 'entry', id: 't1' }, d).type).toBe('entry')
  })

  it('falls back to the item being worked on, then to empty', () => {
    expect(resolvePane(null, data({ workingTask: working }))).toEqual({ type: 'working', task: working })
    expect(resolvePane({ kind: 'task', id: 'gone' }, data({ workingTask: working })).type).toBe('working')
    expect(resolvePane({ kind: 'review', id: 1 }, data())).toEqual({ type: 'empty' })
    expect(resolvePane(null, data())).toEqual({ type: 'empty' })
  })
})

describe('selection helpers', () => {
  it('compares selections by kind and id or name', () => {
    expect(sameSelection({ kind: 'task', id: 'a' }, { kind: 'task', id: 'a' })).toBe(true)
    expect(sameSelection({ kind: 'task', id: 'a' }, { kind: 'entry', id: 'a' })).toBe(false)
    expect(sameSelection({ kind: 'team', name: 'Ben' }, { kind: 'team', name: 'Ben' })).toBe(true)
    expect(sameSelection(null, { kind: 'task', id: 'a' })).toBe(false)
  })

  it('gives each kind its own row id', () => {
    expect(new Set([rowId({ kind: 'task', id: 'a' }), rowId({ kind: 'entry', id: 'a' }), rowId({ kind: 'review', id: 1 }), rowId({ kind: 'team', name: 'Ben' })]).size).toBe(4)
  })
})

describe('groupTeam', () => {
  it('puts blocked stories under the developer with that first name, and the rest under others', () => {
    const blockers = [
      { assignee: 'Ben Okafor', ref: 'US-1', title: 'A' },
      { assignee: 'Caro Müller', ref: 'US-2', title: 'B' },
    ]
    const { members, others } = groupTeam([{ developer: 'Ben', text: 'Update' }], blockers)
    expect(members[0].blockers.map(b => b.ref)).toEqual(['US-1'])
    expect(others.map(b => b.ref)).toEqual(['US-2'])
  })

  it('matches first names ignoring case, and handles no summaries', () => {
    expect(groupTeam([{ developer: 'ben', text: 'x' }], [{ assignee: 'BEN OKAFOR', ref: 'US-1', title: 'A' }]).members[0].blockers).toHaveLength(1)
    expect(groupTeam([], [{ assignee: 'Ben', ref: 'US-1', title: 'A' }])).toEqual({ members: [], others: [{ assignee: 'Ben', ref: 'US-1', title: 'A' }] })
  })
})
