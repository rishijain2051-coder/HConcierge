import { afterEach, describe, expect, it } from 'vitest'

import { BREAKER, breakerAllows, breakerRecord, breakerStatus, resetBreakers } from '../lib/breaker'

/**
 * The breaker takes `now` as an argument precisely so this file does not have
 * to move the clock. Every test here is arithmetic.
 */
afterEach(() => resetBreakers())

const T0 = 1_000_000

describe('a healthy transport', () => {
  it('is allowed through', () => {
    expect(breakerAllows('t', T0)).toBe(true)
  })

  it('stays allowed while failures are below the threshold', () => {
    for (let i = 0; i < BREAKER.FAILS_TO_OPEN - 1; i++) breakerRecord('t', false, T0)
    expect(breakerAllows('t', T0)).toBe(true)
    expect(breakerStatus('t', T0).open).toBe(false)
  })

  it('forgets a run of failures the moment one call succeeds', () => {
    for (let i = 0; i < BREAKER.FAILS_TO_OPEN - 1; i++) breakerRecord('t', false, T0)
    breakerRecord('t', true, T0)
    expect(breakerStatus('t', T0).fails).toBe(0)
    // And is therefore a full run away from opening again.
    for (let i = 0; i < BREAKER.FAILS_TO_OPEN - 1; i++) breakerRecord('t', false, T0)
    expect(breakerAllows('t', T0)).toBe(true)
  })
})

describe('once it has failed enough times in a row', () => {
  const open = () => {
    for (let i = 0; i < BREAKER.FAILS_TO_OPEN; i++) breakerRecord('t', false, T0)
  }

  it('is skipped', () => {
    open()
    expect(breakerAllows('t', T0)).toBe(false)
    expect(breakerStatus('t', T0).open).toBe(true)
  })

  it('is still skipped one millisecond before the window ends', () => {
    open()
    expect(breakerAllows('t', T0 + BREAKER.OPEN_MS - 1)).toBe(false)
  })

  it('lets exactly one probe through when the window ends', () => {
    open()
    const after = T0 + BREAKER.OPEN_MS
    expect(breakerAllows('t', after)).toBe(true)
    // The second caller must not also get through: a recovering service being
    // hit by everything that was waiting is the failure this avoids.
    expect(breakerAllows('t', after)).toBe(false)
  })

  it('re-opens when the probe fails, rather than probing on every send', () => {
    open()
    const after = T0 + BREAKER.OPEN_MS
    expect(breakerAllows('t', after)).toBe(true)
    breakerRecord('t', false, after)
    expect(breakerAllows('t', after + 1)).toBe(false)
    expect(breakerStatus('t', after + 1).msUntilRetry).toBeGreaterThan(0)
  })

  it('closes for good when the probe succeeds', () => {
    open()
    const after = T0 + BREAKER.OPEN_MS
    breakerAllows('t', after)
    breakerRecord('t', true, after)
    expect(breakerStatus('t', after).open).toBe(false)
    expect(breakerAllows('t', after)).toBe(true)
    expect(breakerAllows('t', after)).toBe(true)
  })
})

describe('two transports', () => {
  it('fail independently, which is the entire point of the fall-through', () => {
    for (let i = 0; i < BREAKER.FAILS_TO_OPEN; i++) breakerRecord('gateway', false, T0)
    expect(breakerAllows('gateway', T0)).toBe(false)
    expect(breakerAllows('twilio', T0)).toBe(true)
  })
})
