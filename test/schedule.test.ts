import { describe, expect, it } from 'vitest'

import { isWallClock, timeSuggestions, wallClockNow } from '../lib/clock'

/**
 * The offered times, which are the only arithmetic between a guest tapping
 * "Wake-up call" and a request row carrying an hour.
 *
 * Every assertion here is about one thing: the hotel's clock decides, never
 * the phone's. The machine running this file is on IST; the property under
 * test is not, which is the whole point of pinning the zone.
 */
const IST = 'Asia/Kolkata'
const LONDON = 'Europe/London'

describe('the times a guest is offered', () => {
  it('offers only values the picker and the server both accept', () => {
    for (const s of timeSuggestions(IST, new Date('2026-09-19T11:42:00Z'))) {
      expect(isWallClock(s.value), `${s.label} -> ${s.value}`).toBe(true)
    }
  })

  it('is read on the hotel clock, not on this process’s', () => {
    // 23:10 UTC is the 20th in Pune and still the 19th in London. A suggestion
    // list built from the server's own Date would put a guest in one of those
    // hotels a day out.
    const at = new Date('2026-09-19T18:10:00Z')
    // 23:40 in Pune: seven o'clock has gone, so it is the 20th.
    expect(timeSuggestions(IST, at)[1]).toEqual({ label: 'Tomorrow 7:00 am', value: '2026-09-20T07:00' })
    // Same instant, 19:10 in London: still the 19th, and seven is tomorrow too.
    expect(timeSuggestions(LONDON, at)[1]).toEqual({ label: 'Tomorrow 7:00 am', value: '2026-09-20T07:00' })
    // The dates agree here only by coincidence, so prove the zones differ at
    // all: an hour from now is the 20th in Pune and still the 19th in London.
    expect(timeSuggestions(IST, at)[0].value).toBe('2026-09-20T00:40')
    expect(timeSuggestions(LONDON, at)[0].value).toBe('2026-09-19T20:10')
  })

  it('never offers an hour the hotel has already lived through', () => {
    const at = new Date('2026-09-19T11:42:00Z') // 17:12 in Pune
    const now = wallClockNow(IST, at)
    for (const s of timeSuggestions(IST, at)) expect(s.value > now).toBe(true)
  })

  it('rolls a fixed hour to tomorrow only once it has passed', () => {
    // 05:30 in Pune: seven o'clock is still ahead, so it is today.
    const early = timeSuggestions(IST, new Date('2026-09-19T00:00:00Z'))
    expect(early[1]).toEqual({ label: 'Today 7:00 am', value: '2026-09-19T07:00' })

    // 08:30 in Pune: seven has gone, nine has not.
    const later = timeSuggestions(IST, new Date('2026-09-19T03:00:00Z'))
    expect(later[1]).toEqual({ label: 'Tomorrow 7:00 am', value: '2026-09-20T07:00' })
    expect(later[3]).toEqual({ label: 'Today 9:00 am', value: '2026-09-19T09:00' })
  })

  it('crosses the month end by the calendar, not by adding 24 hours', () => {
    // 23:30 IST on the 30th. Tomorrow is October, and a naive +1 on the day
    // number would offer the 31st of September.
    const at = new Date('2026-09-30T18:00:00Z')
    expect(timeSuggestions(IST, at)[1].value).toBe('2026-10-01T07:00')
  })

  it('puts an hour from now first, on the hotel clock', () => {
    const at = new Date('2026-09-19T11:42:00Z')
    const first = timeSuggestions(IST, at)[0]
    expect(first.label).toBe('In an hour')
    expect(first.value).toBe(wallClockNow(IST, new Date(at.getTime() + 3_600_000)))
  })
})
