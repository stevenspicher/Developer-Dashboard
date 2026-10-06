import { describe, expect, it } from 'vitest'

import { comingUp, dayLabel, longDate, monthDay, teamDates, weekdayShort, workingDaysAfter } from './schedule'
import { makeDeadline, makeSprint } from './test/factories'

const line = (text: string) => ({ text, mentions: [] })
const TODAY = '2026-10-06' // a Tuesday

describe('teamDates', () => {
  it('reads a date out of a team item and labels it with the rest of the clause', () => {
    expect(teamDates([line('Code Jam at HQ on Oct. 8')], TODAY)).toMatchObject([
      { date: '2026-10-08', label: 'Code Jam at HQ', kind: 'team', detail: 'Code Jam at HQ on Oct. 8' },
    ])
  })

  // Known flaw: a dash note after the date stays in the label ("Code Jam at HQ on — bring your
  // side project"), because em and en dashes aren't clause breaks.
  it.todo('drops a dash note after the date: "Code Jam at HQ on Oct. 8 — bring your side project"')

  it('reads ranges, ordinals and full month names', () => {
    const [range] = teamDates([line('Dev Day on October 9-10')], TODAY)
    expect(range).toMatchObject({ date: '2026-10-09', end: '2026-10-10', label: 'Dev Day' })
    expect(teamDates([line('Freeze begins Nov 2nd')], TODAY)[0].date).toBe('2026-11-02')
  })

  it('reads several dates in one line as separate events', () => {
    const events = teamDates([line('Retro Oct. 9, planning Oct. 13')], TODAY)
    expect(events.map(e => [e.date, e.label])).toEqual([['2026-10-09', 'Retro'], ['2026-10-13', 'Planning']])
  })

  it('puts a date in the year that keeps it within about six months', () => {
    expect(teamDates([line('Audit on Jan 5')], '2026-12-30')[0].date).toBe('2027-01-05')
    expect(teamDates([line('Audit on Dec 20')], '2027-01-03')[0].date).toBe('2026-12-20')
  })

  it('returns nothing for lines without a date', () => {
    expect(teamDates([line('Bring snacks')], TODAY)).toEqual([])
  })
})

describe('comingUp', () => {
  const base = { sprint: makeSprint({ end: '2026-10-06' }), teamItems: [], today: TODAY }

  it('merges deadlines, the sprint end and team dates in date order', () => {
    const events = comingUp({
      ...base,
      deadlines: [makeDeadline({ title: 'UAT session', start: '2026-10-09' })],
      teamItems: [line('Code Jam at HQ on Oct. 8')],
    })
    expect(events.map(e => [e.date, e.kind, e.label])).toEqual([
      ['2026-10-06', 'sprint', 'Sprint 20 ends'],
      ['2026-10-08', 'team', 'Code Jam at HQ'],
      ['2026-10-09', 'deadline', 'UAT session'],
    ])
  })

  it('lists something already under way on the day it ends, and drops what has finished', () => {
    const events = comingUp({
      ...base,
      sprint: null,
      deadlines: [
        makeDeadline({ id: '1', title: 'Freeze', start: '2026-10-01', end: '2026-10-12' }),
        makeDeadline({ id: '2', title: 'Old thing', start: '2026-09-01', end: '2026-09-02' }),
        makeDeadline({ id: '3', title: 'Workshop', start: '2026-10-14', end: '2026-10-15' }),
      ],
    })
    expect(events.map(e => [e.date, e.end, e.label])).toEqual([
      ['2026-10-12', undefined, 'Freeze ends'],
      ['2026-10-14', '2026-10-15', 'Workshop'],
    ])
  })

  it('leaves out anything beyond the look-ahead window', () => {
    const far = makeDeadline({ start: '2026-12-01' })
    expect(comingUp({ ...base, deadlines: [far] })).toEqual([base.sprint && expect.objectContaining({ kind: 'sprint' })])
    expect(comingUp({ ...base, deadlines: [far], days: 90 })).toHaveLength(2)
  })

  it('does not repeat a team date that says the same as a calendar entry', () => {
    const events = comingUp({
      ...base,
      sprint: null,
      deadlines: [makeDeadline({ title: 'BlueSky UAT session', start: '2026-10-09' })],
      teamItems: [line('BlueSky UAT session on Oct. 9')],
    })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('deadline')
  })
})

describe('day arithmetic and labels', () => {
  it('workingDaysAfter counts weekdays after today up to and including the end', () => {
    expect(workingDaysAfter('2026-10-06', '2026-10-13')).toBe(5) // Wed, Thu, Fri, Mon, Tue
    expect(workingDaysAfter('2026-10-09', '2026-10-11')).toBe(0) // Friday to Sunday
    expect(workingDaysAfter('2026-10-06', '2026-10-06')).toBe(0)
  })

  it('dayLabel names today and tomorrow, then the weekday and day', () => {
    expect(dayLabel('2026-10-06', TODAY)).toBe('Today')
    expect(dayLabel('2026-10-07', TODAY)).toBe('Tomorrow')
    expect(dayLabel('2026-10-08', TODAY)).toBe('Thu 8')
    expect(dayLabel('2026-11-02', TODAY)).toBe('Mon Nov 2')
  })

  it('formats dates for display', () => {
    expect(longDate(TODAY)).toBe('Tuesday, Oct 6')
    expect(monthDay(TODAY)).toBe('Oct 6')
    expect(weekdayShort(TODAY)).toBe('Tue')
  })
})
