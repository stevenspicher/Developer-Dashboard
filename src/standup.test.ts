import { describe, expect, it } from 'vitest'

import type { PullRequest } from './bridge'
import { buildStandupDraft } from './standup'
import type { StandupInput } from './standup'
import { makeEntry, makePlan, makeTask } from './test/factories'

const review = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  pullRequestId: 482, title: 'Holiday loans merge fix', repo: 'loans-api', author: 'Luiz', createdDate: '2026-10-03T10:00:00Z',
  isRequired: false, url: 'https://ado.example/pr/482', ...overrides,
})

const input = (overrides: Partial<StandupInput> = {}): StandupInput => ({
  today: '2026-10-06',
  plan: makePlan(),
  tasksById: new Map(),
  blocked: [],
  reviews: [],
  ticks: {},
  longDate: 'Tuesday, Oct 6',
  ...overrides,
})

describe('buildStandupDraft', () => {
  it('says nothing is planned when there is nothing to show', () => {
    expect(buildStandupDraft(input())).toBe('Standup · Tuesday, Oct 6\n\nToday\n• Nothing planned yet\n')
  })

  it('lists what was done, what is planned and what is blocked', () => {
    const plan = makePlan([
      makeEntry({ id: 'done', text: 'Merged the hotfix', done: true, itemRef: 'DEV-1' }),
      makeEntry({ id: 'open', text: 'Investigate the transfer error' }),
    ], { doneLog: [{ day: '2026-10-05', text: 'Wrote the retro notes' }] })
    const draft = buildStandupDraft(input({ plan, blocked: [makeTask({ ref: 'US-12277', title: 'Remove voided transactions' })] }))
    expect(draft).toBe([
      'Standup · Tuesday, Oct 6',
      '',
      'Done',
      '• Wrote the retro notes',
      '• Merged the hotfix (DEV-1)',
      '',
      'Today',
      '• Investigate the transfer error',
      '',
      'Blocked',
      '• US-12277 Remove voided transactions',
      '',
    ].join('\n'))
  })

  it('adds a ref only when the text does not already contain it', () => {
    const plan = makePlan([
      makeEntry({ id: 'a', text: 'Finish US-100 today', itemRef: 'US-100' }),
      makeEntry({ id: 'b', text: 'Finish the diary', itemRef: 'US-200' }),
    ])
    const draft = buildStandupDraft(input({ plan }))
    expect(draft).toContain('• Finish US-100 today\n')
    expect(draft).toContain('• Finish the diary (US-200)\n')
  })

  it('shows acceptance-criteria progress only when some criteria are ticked', () => {
    const task = makeTask({ id: 'a', acceptanceCriteria: ['One', 'Two', 'Three'] })
    const plan = makePlan([makeEntry({ id: 'e', text: 'Close out the diary', itemId: 'a' })])
    const base = { plan, tasksById: new Map([['a', task]]) }
    expect(buildStandupDraft(input({ ...base, ticks: {} }))).toContain('• Close out the diary\n')
    expect(buildStandupDraft(input({ ...base, ticks: { a: ['One', 'Two'] } }))).toContain('• Close out the diary — 2/3 criteria done')
  })

  it('adds each review after the plan, with its repo and how long it has waited', () => {
    const plan = makePlan([makeEntry({ text: 'Plan item' })])
    const draft = buildStandupDraft(input({
      plan,
      reviews: [review(), review({ pullRequestId: 490, title: 'Fresh PR', repo: null, createdDate: '2026-10-06T08:00:00Z' })],
    }))
    expect(draft).toContain('• Plan item\n• Review PR 482: Holiday loans merge fix (loans-api, 3 days old)\n• Review PR 490: Fresh PR (today)\n')
  })

  it('lists reviews under Today even when nothing is planned, and plain-texts link markup', () => {
    const draft = buildStandupDraft(input({ reviews: [review({ title: 'Fix [the bug](https://x.test/1)' })] }))
    expect(draft).toContain('Today\n• Review PR 482: Fix the bug (loans-api, 3 days old)')
    expect(draft).not.toContain('Nothing planned yet')
  })

  it('leaves out empty sections and ends with a single newline', () => {
    const draft = buildStandupDraft(input({ plan: makePlan([makeEntry({ text: 'Only item' })]) }))
    expect(draft).not.toContain('Done')
    expect(draft).not.toContain('Blocked')
    expect(draft.endsWith('Only item\n')).toBe(true)
  })
})
