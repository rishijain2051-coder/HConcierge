// Money is integer paise everywhere. It only becomes a string at the edge.

export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  // Indian digit grouping: 1,23,456 not 123,456
  const grouped = whole.toLocaleString('en-IN')
  return frac === 0 ? `${sign}₹${grouped}` : `${sign}₹${grouped}.${String(frac).padStart(2, '0')}`
}

export type CartModifier = { group: string; name: string; price_paise: number }

export function lineTotal(unitPaise: number, qty: number, modifiers: CartModifier[] = []): number {
  const mods = modifiers.reduce((sum, m) => sum + (m.price_paise || 0), 0)
  return (unitPaise + mods) * qty
}
