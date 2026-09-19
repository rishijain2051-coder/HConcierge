import { describe, expect, it } from 'vitest'

import {
  escpos,
  packGlyph,
  receiptText,
  RS_TEXT,
  unpackGlyph,
  WIDTH_58MM,
  WIDTH_80MM,
  type Receipt,
} from '../lib/receipt'
import { rupees } from '../lib/money'

/**
 * What db/check-receipt.mjs asserts, without needing a room that owes money.
 * `buildReceipt` is the only part of that file that needs a database; the
 * layout and the byte stream are pure, and they are the parts that break.
 */
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  property: 'Lakeview, Pune',
  propertyPhone: '+91 20 4000 1000',
  room: '204',
  guest: 'A Guest',
  printedAt: new Date('2026-09-18T19:30:00Z'),
  lines: [
    { description: 'Masala Dosa', amount: 26000 },
    // Long enough to force the wrap, which a real dosa never does.
    { description: 'Hyderabadi Chicken Biryani with raita and salan', amount: 56000 },
    { description: 'Filter Coffee', amount: 16000 },
  ],
  total: 98000,
  empty: false,
  ...over,
})

describe('the layout', () => {
  for (const width of [WIDTH_80MM, WIDTH_58MM]) {
    it(`fits the paper at ${width} columns`, () => {
      for (const line of receiptText(receipt(), width)) expect(line.length).toBeLessThanOrEqual(width)
    })

    it(`wraps a long description at ${width} rather than truncating it`, () => {
      const out = receiptText(receipt(), width).join('\n')
      // Every word of the long line survives somewhere.
      for (const word of 'Hyderabadi Chicken Biryani with raita and salan'.split(' ')) {
        expect(out).toContain(word)
      }
    })

    it(`right-aligns the amount at ${width}`, () => {
      const out = receiptText(receipt({ lines: [{ description: 'Tea', amount: 12000 }], total: 12000 }), width)
      const line = out.find((l) => l.startsWith('Tea'))!
      expect(line).toHaveLength(width)
      // Derived from rupees(), not spelled out: how money is formatted is that
      // module's decision - and it drops a zero fraction - while what this
      // asserts is the alignment and the stand-in symbol.
      expect(line.endsWith(rupees(12000).replace('₹', RS_TEXT))).toBe(true)
    })
  }

  it('never lets a rupee sign reach a printer that cannot draw one', () => {
    expect(receiptText(receipt()).some((l) => l.includes('₹'))).toBe(false)
  })

  it('says on its face that it is not a tax invoice', () => {
    const out = receiptText(receipt()).join('\n')
    expect(out).toContain('Not a tax invoice')
    expect(out).toContain('In-room charges only')
  })

  it('says so when nothing is outstanding rather than printing an empty box', () => {
    const out = receiptText(receipt({ lines: [], total: 0, empty: true })).join('\n')
    expect(out).toContain('Nothing outstanding')
    expect(out).not.toContain('TOTAL')
  })

  it('totals what it lists', () => {
    const r = receipt()
    expect(r.total).toBe(r.lines.reduce((n, l) => n + l.amount, 0))
    expect(receiptText(r).join('\n')).toContain(rupees(r.total).replace('₹', RS_TEXT))
  })
})

describe('the byte stream', () => {
  const bytes = () => [...escpos(receipt(), WIDTH_80MM)]

  it('initialises, so it is not at the mercy of the last job', () => {
    expect(bytes().slice(0, 2)).toEqual([0x1b, 0x40])
  })

  it('selects a code page', () => {
    expect(bytes().slice(2, 5)).toEqual([0x1b, 0x74, 0x00])
  })

  it('feeds clear of the cutter and then cuts', () => {
    const b = bytes()
    expect(b.slice(-7)).toEqual([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00])
  })

  it('stays inside printable ASCII', () => {
    // A byte above 0x7F is a code-page gamble, which prints as a box.
    expect(bytes().every((b) => b <= 0x7f)).toBe(true)
  })

  it('turns bold off again every time it turns it on', () => {
    const b = bytes()
    let depth = 0
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 0x1b && b[i + 1] === 0x45) depth += b[i + 2] === 1 ? 1 : -1
    }
    expect(depth).toBe(0)
  })
})

describe('the drawn rupee sign', () => {
  it('packs to three bytes per column, column-major', () => {
    const packed = packGlyph()
    expect(packed).toHaveLength(12 * 3)
    expect(packed.every((b) => b >= 0 && b <= 0xff)).toBe(true)
  })

  it('survives the trip to bytes and back', () => {
    // The art in lib/receipt.ts is the reviewable form; this proves the bytes
    // a printer receives are that shape and not a transposed version of it.
    const art = unpackGlyph(packGlyph())
    expect(art).toHaveLength(24)
    expect(art[5]).toBe('.##########.')
    expect(art[8]).toBe('.....###....')
    expect(art[0]).toBe('............')
  })

  it('is defined and selected before anything prints, and deselected after', () => {
    const b = [...escpos(receipt(), WIDTH_80MM, { rupeeGlyph: true })]
    const at = (seq: number[]) =>
      b.findIndex((_, i) => seq.every((v, k) => b[i + k] === v))

    const define = at([0x1b, 0x26, 0x03, 0x7e, 0x7e, 12])
    const select = at([0x1b, 0x25, 0x01])
    const deselect = at([0x1b, 0x25, 0x00])
    expect(define).toBeGreaterThan(-1)
    expect(select).toBeGreaterThan(define)
    expect(deselect).toBeGreaterThan(select)
    // And it goes back to the built-in set before the cut, or the next job on
    // the roll inherits a redefined tilde.
    expect(deselect).toBeLessThan(b.length - 7)
  })

  it('bills the same amount either way, in narrower columns', () => {
    const plain = receiptText(receipt(), WIDTH_80MM)
    const drawn = receiptText(receipt(), WIDTH_80MM, '\x7e')
    expect(drawn.every((l) => l.length <= WIDTH_80MM)).toBe(true)
    // "Rs 980" against "~980": the layout has to be computed with the
    // characters that will actually print, not substituted afterwards.
    const amount = rupees(98000).replace('₹', '')
    const plainTotal = plain.find((l) => l.startsWith('TOTAL'))!
    const drawnTotal = drawn.find((l) => l.startsWith('TOTAL'))!
    expect(plainTotal).toContain(`${RS_TEXT}${amount}`)
    expect(drawnTotal).toContain(`\x7e${amount}`)
    // Both fill the paper exactly, because the amount is right-aligned to the
    // width either way. The drawn sign is two characters narrower, so it is the
    // padding that absorbs the difference - which only works if the symbol is
    // known before the columns are worked out.
    expect(plainTotal).toHaveLength(WIDTH_80MM)
    expect(drawnTotal).toHaveLength(WIDTH_80MM)
    expect(drawnTotal.replace(/ +/g, ' ').length).toBeLessThan(plainTotal.replace(/ +/g, ' ').length)
  })

  it('leaves the default alone', () => {
    expect([...escpos(receipt(), WIDTH_80MM)].some((_, i, b) => b[i] === 0x1b && b[i + 1] === 0x26)).toBe(false)
  })
})
