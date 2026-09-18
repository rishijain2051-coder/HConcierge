import { describe, expect, it, vi, afterEach } from 'vitest'

import { allow, clientKeyFrom, CODE_LIMIT, GUEST_LIMIT } from '../lib/limit'

afterEach(() => vi.useRealTimers())

/** A fresh key per test: the buckets are module state and deliberately shared. */
let n = 0
const key = () => `test-${Date.now()}-${n++}`

describe('the token bucket', () => {
  it('allows a burst and then refuses', () => {
    const k = key()
    let allowed = 0
    for (let i = 0; i < CODE_LIMIT.burst + 5; i++) if (allow(k, CODE_LIMIT.perMinute, CODE_LIMIT.burst)) allowed++
    expect(allowed).toBe(CODE_LIMIT.burst)
    expect(allow(k, CODE_LIMIT.perMinute, CODE_LIMIT.burst)) .toBe(false)
  })

  it('refills over time rather than locking somebody out for good', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    const k = key()
    while (allow(k, CODE_LIMIT.perMinute, CODE_LIMIT.burst)) {
      /* drain it */
    }
    expect(allow(k, CODE_LIMIT.perMinute, CODE_LIMIT.burst)).toBe(false)

    // Half a minute later, half a minute's worth of tokens are back.
    vi.setSystemTime(new Date('2026-09-18T12:00:30Z'))
    expect(allow(k, CODE_LIMIT.perMinute, CODE_LIMIT.burst)).toBe(true)
  })

  it('meters each caller separately', () => {
    const a = key()
    const b = key()
    while (allow(a, CODE_LIMIT.perMinute, CODE_LIMIT.burst)) {
      /* drain a */
    }
    expect(allow(a, CODE_LIMIT.perMinute, CODE_LIMIT.burst)).toBe(false)
    expect(allow(b, CODE_LIMIT.perMinute, CODE_LIMIT.burst)).toBe(true)
  })

  it('is tighter on the code gate than on the guest screens', () => {
    // Not a tautology: the code gate is the only guessable endpoint in the app
    // and must never inherit the screens' allowance by someone reusing a
    // constant. See lib/limit.ts.
    expect(CODE_LIMIT.burst).toBeLessThan(GUEST_LIMIT.burst)
  })
})

describe('who is this', () => {
  it('takes the first hop of x-forwarded-for, not the last', () => {
    // The last entry is whatever the nearest proxy claims about itself.
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' })
    expect(clientKeyFrom(h)).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip', () => {
    expect(clientKeyFrom(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('does not throw when there is nothing to go on', () => {
    // Everyone anonymous shares one bucket, which is the safe direction: it
    // over-restricts rather than letting an unidentifiable flood through.
    expect(clientKeyFrom(new Headers())).toBe('unknown')
  })
})
