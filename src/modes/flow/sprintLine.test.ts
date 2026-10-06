import { describe, expect, it } from 'vitest'

import { makeSprint } from '../../test/factories'
import { sprintLine } from './sprintLine'

describe('sprintLine', () => {
  it('says so when there is no sprint', () => {
    expect(sprintLine(null, '2026-10-06')).toBe('Sprint not loaded')
  })

  it('gives the day, the end and the working days left', () => {
    const line = sprintLine(makeSprint({ start: '2026-09-23', end: '2026-10-08' }), '2026-10-06')
    expect(line).toBe('Sprint 20 · day 14 of 16 · ends Thu · 2 working days after today')
  })

  it('leaves out what a finished sprint can no longer say', () => {
    const line = sprintLine(makeSprint({ start: '2026-09-23', end: '2026-10-02' }), '2026-10-06')
    expect(line).toBe('Sprint 20 · day 10 of 10 · ends Fri')
  })
})
