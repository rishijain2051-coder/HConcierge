import { describe, expect, it } from 'vitest'

import { lineTotal, rupees } from '../lib/money'

/**
 * Money is integer paise everywhere and only becomes a string at the edge.
 * Both decisions below are deliberate and easy to "fix" into something wrong.
 */
describe('rupees', () => {
  it('groups the Indian way, not the western one', () => {
    expect(rupees(12345600)).toBe('₹1,23,456')
    expect(rupees(100000)).toBe('₹1,000')
  })

  it('drops a zero fraction rather than printing .00', () => {
    expect(rupees(98000)).toBe('₹980')
    expect(rupees(26050)).toBe('₹260.50')
    expect(rupees(26005)).toBe('₹260.05')
  })

  it('puts the sign before the symbol', () => {
    expect(rupees(-5000)).toBe('-₹50')
  })

  it('is exact at the awkward values floats get wrong', () => {
    expect(rupees(1)).toBe('₹0.01')
    expect(rupees(0)).toBe('₹0')
    expect(rupees(10)).toBe('₹0.10')
  })
})

describe('lineTotal', () => {
  it('adds modifiers before multiplying by the quantity', () => {
    // Two coffees with a 20-rupee shot each is 2 x (100 + 20), not 100 x 2 + 20.
    expect(lineTotal(10000, 2, [{ group: 'Extras', name: 'Shot', price_paise: 2000 }])).toBe(24000)
  })

  it('treats a missing modifier price as free rather than NaN', () => {
    expect(
      lineTotal(10000, 1, [{ group: 'g', name: 'n', price_paise: undefined as unknown as number }]),
    ).toBe(10000)
  })
})
