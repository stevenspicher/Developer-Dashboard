import { describe, expect, it } from 'vitest'

import { PRIORITY, TYPE_LABELS, buildStatus, prStatus } from './labels'

describe('priority', () => {
  it('shows a label for every priority but none, and colours only CRIT and HIGH', () => {
    expect(PRIORITY.none).toBeNull()
    expect(PRIORITY.critical).toMatchObject({ label: 'CRIT', tone: 'danger' })
    expect(PRIORITY.high).toMatchObject({ label: 'HIGH', tone: 'warn' })
    expect(PRIORITY.medium?.tone).toBe('neutral')
    expect(PRIORITY.low?.tone).toBe('muted')
  })
})

describe('type labels', () => {
  it('has a word for every item type', () => {
    expect(Object.values(TYPE_LABELS)).toEqual(['STORY', 'TASK', 'BUG', 'SPIKE', 'ALERT', 'TICKET', 'INCIDENT'])
  })
})

describe('prStatus', () => {
  it('names draft, open, merged and abandoned pull requests', () => {
    expect(prStatus({ status: 'active', isDraft: true })).toEqual({ label: 'DRAFT', tone: 'muted' })
    expect(prStatus({ status: 'active' })).toEqual({ label: 'OPEN', tone: 'accent' })
    expect(prStatus({ status: 'completed' })).toEqual({ label: 'MERGED', tone: 'ok' })
    expect(prStatus({ status: 'abandoned' })).toEqual({ label: 'ABANDONED', tone: 'muted' })
  })

  it('says nothing for an unknown status, and a draft flag only matters while active', () => {
    expect(prStatus({})).toBeNull()
    expect(prStatus({ status: 'weird' })).toBeNull()
    expect(prStatus({ status: 'completed', isDraft: true })?.label).toBe('MERGED')
  })
})

describe('buildStatus', () => {
  it('turns a build result into a word, with failure the only danger', () => {
    expect(buildStatus({ result: 'succeeded' })).toEqual({ label: 'PASSED', tone: 'ok' })
    expect(buildStatus({ result: 'failed' })).toEqual({ label: 'FAILED', tone: 'danger' })
    expect(buildStatus({ result: 'partiallySucceeded' })).toEqual({ label: 'PARTIAL', tone: 'warn' })
    expect(buildStatus({ result: 'canceled' })).toEqual({ label: 'CANCELED', tone: 'muted' })
  })

  it('shows RUNNING while a build has not finished, and nothing when there is no information', () => {
    expect(buildStatus({ status: 'inProgress' })).toEqual({ label: 'RUNNING', tone: 'muted' })
    expect(buildStatus({ status: 'notStarted' })?.label).toBe('RUNNING')
    expect(buildStatus({ status: 'completed' })).toBeNull()
    expect(buildStatus({})).toBeNull()
  })
})
