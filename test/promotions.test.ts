import { describe, expect, it } from 'vitest'

import { offerState, KIND_LABEL, type Promotion } from '../lib/types'
import { rupees } from '../lib/money'

/**
 * The threshold rule, which is the only arithmetic in the feature and the only
 * part of it a guest can be told a wrong answer about.
 *
 * `offerState` lives in lib/types.ts precisely so the phone and the server run
 * the same function - these assertions are what makes that worth anything.
 */
const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p1',
  title: 'Pool & gym day passes',
  description: 'Two day passes.',
  kind: 'pass',
  min_spend_paise: 200000, // ₹2,000
  percent_off: null,
  department: 'front_desk',
  fine_print: null,
  sort: 0,
  active: true,
  ...over,
})

describe('taking up an offer', () => {
  it('is open to anyone when there is no threshold', () => {
    const s = offerState(promo({ min_spend_paise: 0 }), 0, false)
    expect(s.available).toBe(true)
    expect(s.shortBy).toBe(0)
  })

  it('is held back until the bill clears the threshold', () => {
    const s = offerState(promo(), 126000, false)
    expect(s.available).toBe(false)
    expect(s.shortBy).toBe(74000)
    // The guest is told the gap, not the target: "spend ₹2,000" makes them do
    // the subtraction, and they are the one person who cannot see the folio.
    expect(s.note).toContain(rupees(74000))
  })

  it('opens exactly on the threshold, not a rupee past it', () => {
    expect(offerState(promo(), 199999, false).available).toBe(false)
    expect(offerState(promo(), 200000, false).available).toBe(true)
    expect(offerState(promo(), 200001, false).available).toBe(true)
  })

  it('reports nothing outstanding once it is available', () => {
    expect(offerState(promo(), 500000, false).shortBy).toBe(0)
  })

  it('is closed once claimed, however large the bill', () => {
    const s = offerState(promo(), 900000, true)
    expect(s.available).toBe(false)
    expect(s.note).toMatch(/claimed/i)
  })

  it('is closed once claimed even with no threshold at all', () => {
    expect(offerState(promo({ min_spend_paise: 0 }), 0, true).available).toBe(false)
  })

  it('treats a credit on the room as nothing spent, not as progress', () => {
    // A voided charge can leave the balance negative. Counting that as spend
    // would make the shortfall larger than the threshold and read as nonsense.
    const s = offerState(promo(), -50000, false)
    expect(s.shortBy).toBe(200000)
    expect(s.available).toBe(false)
  })

  it('names every kind it can be, so a new one cannot ship unlabelled', () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual(['coupon', 'discount', 'pass'])
    for (const label of Object.values(KIND_LABEL)) expect(label.length).toBeGreaterThan(0)
  })
})
