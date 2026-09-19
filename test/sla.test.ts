import { describe, expect, it } from 'vitest'

import { formatAge, howOld, minutesRemaining, notDueYet, since, slaState, WARN_AT } from '../lib/sla'

/**
 * The rules db/check-amber-alert.mjs asserts against a live board, without
 * needing one. lib/sla.ts is the single definition of "late" shared by the
 * staff board, the guest's status line and the job list behind every WhatsApp
 * message - if these drift, staff stop trusting the board.
 */
const NOW = new Date('2026-09-18T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const row = (over: number, extra: Record<string, unknown> = {}) => ({
  created_at: minutesAgo(over),
  sla_minutes: 15,
  status: 'new',
  ...extra,
})

describe('slaState', () => {
  it('is ok while there is plenty of time left', () => {
    expect(slaState(row(2), NOW)).toBe('ok')
  })

  it('turns amber at the property threshold, not before', () => {
    const budget = 15 * WARN_AT // 9 minutes
    expect(slaState(row(budget - 0.1), NOW)).toBe('ok')
    expect(slaState(row(budget), NOW)).toBe('warn')
  })

  it('turns red the moment the promise is broken', () => {
    expect(slaState(row(14.9), NOW)).toBe('warn')
    expect(slaState(row(15), NOW)).toBe('late')
  })

  it('honours a property that moved its own threshold', () => {
    // An admin setting 90% used to be ignored: every board turned amber at 60.
    expect(slaState(row(10, { warn_at_percent: 90 }), NOW)).toBe('ok')
    expect(slaState(row(13.5), NOW)).toBe('warn')
    expect(slaState(row(13.5, { warn_at_percent: 90 }), NOW)).toBe('warn')
  })

  it('ignores a nonsense threshold rather than dividing by it', () => {
    for (const pct of [0, -10, 101, null, undefined, Number.NaN]) {
      expect(slaState(row(10, { warn_at_percent: pct }), NOW)).toBe('warn')
    }
  })

  it('reports a finished request as done however late it was', () => {
    expect(slaState(row(500, { status: 'done' }), NOW)).toBe('done')
    expect(slaState(row(500, { status: 'cancelled' }), NOW)).toBe('done')
  })

  it('falls back to fifteen minutes when a target is missing', () => {
    expect(slaState({ created_at: minutesAgo(20), sla_minutes: 0, status: 'new' }, NOW)).toBe('late')
  })
})

describe('a request booked for later', () => {
  const sevenAm = new Date('2026-09-18T15:00:00Z') // three hours from NOW

  it('is not late before its hour, however long ago it was asked for', () => {
    const wakeUp = row(600, { scheduled_for: sevenAm })
    expect(slaState(wakeUp, NOW)).toBe('ok')
    expect(notDueYet(wakeUp, NOW)).toBe(true)
  })

  it('starts its clock at the hour it was booked for', () => {
    const due = row(600, { scheduled_for: minutesAgo(40) })
    expect(slaState(due, NOW)).toBe('late')
    expect(notDueYet(due, NOW)).toBe(false)
    expect(minutesRemaining(due, NOW)).toBe(15 - 40)
  })
})

describe('the words', () => {
  it('says "just now" without an "ago" after it', () => {
    expect(since(minutesAgo(0.5), NOW)).toBe('just now')
    expect(since(minutesAgo(3), NOW)).toBe('3m ago')
  })

  it('says "just now" without an "old" after it', () => {
    // Both callers walked into this: the board's alert rows and the push
    // notification body each read "just now old" for a request's first minute.
    expect(howOld(minutesAgo(0.5), NOW)).toBe('just now')
    expect(howOld(minutesAgo(12), NOW)).toBe('12m old')
  })

  it('counts up through minutes, hours and days', () => {
    expect(formatAge(minutesAgo(0), NOW)).toBe('just now')
    expect(formatAge(minutesAgo(59), NOW)).toBe('59m')
    expect(formatAge(minutesAgo(60), NOW)).toBe('1h 0m')
    expect(formatAge(minutesAgo(125), NOW)).toBe('2h 5m')
    expect(formatAge(minutesAgo(60 * 25), NOW)).toBe('1d')
  })
})
