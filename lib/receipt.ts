import { sql } from './db'
import { rupees } from './money'
import { roomFolio } from './folio'

/**
 * The room's in-room charges, as a thermal receipt.
 *
 * Two outputs from one source of truth: a structured receipt the 80mm print
 * page renders, and a raw ESC/POS byte stream for a printer in raw mode. They
 * cannot drift, because the second is built from the first.
 *
 * **This is not a tax invoice and says so on its face.** A hotel bill in India
 * needs the property's GST registration on it, HConcierge does not hold one,
 * and the PMS issues the real document. What this prints is a summary of what
 * was ordered from the room - the thing a guest asks for at the desk when they
 * want to see what the total is made of.
 *
 * `roomFolio` returns only unvoided, unsettled lines, so a receipt printed
 * after the bill is closed is empty on purpose: the charges have gone into the
 * hotel's own books and reprinting them here would invite a second payment.
 */

export type Receipt = {
  property: string
  propertyPhone: string | null
  room: string
  guest: string | null
  printedAt: Date
  lines: { description: string; amount: number }[]
  total: number
  /** Nothing outstanding - printed after settling, or before anything was ordered. */
  empty: boolean
}

export async function buildReceipt(roomId: string): Promise<Receipt | null> {
  const [row] = await sql<{ number: string; guest_name: string | null; property: string; phone: string | null }[]>`
    select r.number, r.guest_name, p.name as property, p.phone
      from rooms r join properties p on p.id = r.property_id
     where r.id = ${roomId} limit 1`
  if (!row) return null

  // Oldest first. roomFolio() reads newest first, because that is the order the
  // guest's own screen wants; a receipt is read down the page.
  const entries = (await roomFolio(roomId)).slice().reverse()
  const lines = entries.map((e) => ({ description: e.description, amount: e.amount_paise }))
  const total = lines.reduce((sum, l) => sum + l.amount, 0)

  return {
    property: row.property,
    propertyPhone: row.phone,
    room: row.number,
    guest: row.guest_name,
    printedAt: new Date(),
    lines,
    total,
    empty: lines.length === 0,
  }
}

/* ---- ESC/POS ------------------------------------------------------------ */

const ESC = 0x1b
const GS = 0x1d

/**
 * Characters per line. 48 is an 80mm printer in Font A (12 dots wide on a
 * 576-dot head); a 58mm printer is 32. Anything else and the two-column rows
 * come out ragged, so it is a parameter rather than a constant.
 */
export const WIDTH_80MM = 48
export const WIDTH_58MM = 32

/**
 * ESC/POS has no rupee sign at any fixed code point.
 *
 * `₹` prints as whatever byte 0x20-0xFF happens to sit at that position in the
 * selected code page - a box, an accented vowel, or nothing - and the printers
 * that do carry it disagree about where. So there are two ways to get one on
 * paper, and this is the safe one: spell it "Rs", which is what an Indian till
 * roll prints anyway. RUPEE_GLYPH below is the other.
 */
export const RS_TEXT = 'Rs '

/**
 * The other way: draw it.
 *
 * ESC/POS lets a host define its own characters and print them in place of an
 * ASCII code, which every clone implements because it is in the original Epson
 * set. `~` is the code borrowed - nothing on a receipt prints a tilde - so one
 * definition, one mode switch, and the paper carries a real rupee sign.
 *
 * The art is the source of truth rather than a table of hex, because a table of
 * hex is unreviewable: nobody can tell a correct rupee sign from a wrong one.
 * It was rasterised from the actual U+20B9 glyph at 12x24, which is Font A's
 * cell on a 203dpi head, with the first and last columns left clear so adjacent
 * characters do not touch.
 */
const RUPEE_GLYPH = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '.##########.',
  '.##########.',
  '.#########..',
  '.....###....',
  '.##########.',
  '.##########.',
  '.#########..',
  '.....###....',
  '.#######....',
  '.######.....',
  '.#####......',
  '..###.......',
  '...###......',
  '....####....',
  '.....####...',
  '............',
  '............',
  '............',
  '............',
]

/** The ASCII code the drawn glyph is printed as. */
const GLYPH_CODE = 0x7e // '~'

/**
 * The art as ESC/POS wants it: column-major, three bytes per column for a
 * 24-dot-high cell, most significant bit at the top of each byte.
 */
export function packGlyph(art: string[] = RUPEE_GLYPH): number[] {
  const height = art.length
  const width = art[0].length
  const bytesPerColumn = height / 8
  const out: number[] = []
  for (let col = 0; col < width; col++) {
    for (let band = 0; band < bytesPerColumn; band++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        if (art[band * 8 + bit][col] === '#') byte |= 0x80 >> bit
      }
      out.push(byte)
    }
  }
  return out
}

/** The inverse, so a test can prove the packing without a printer. */
export function unpackGlyph(bytes: number[], width = 12, height = 24): string[] {
  const bytesPerColumn = height / 8
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      const byte = bytes[col * bytesPerColumn + Math.floor(row / 8)]
      return byte & (0x80 >> row % 8) ? '#' : '.'
    }).join(''),
  )
}

function money(paise: number, symbol = RS_TEXT): string {
  return rupees(paise).replace('₹', symbol)
}

/** A left label and a right amount on one line, or two lines if it will not fit. */
function columns(left: string, right: string, width: number): string[] {
  if (left.length + right.length + 1 <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right]
  }
  // A long dish name wraps and the amount sits under it, right-aligned. Better
  // than truncating the one thing the guest is checking.
  const wrapped: string[] = []
  let rest = left
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width)
    if (cut <= 0) cut = width
    wrapped.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  wrapped.push(rest)
  wrapped.push(' '.repeat(Math.max(0, width - right.length)) + right)
  return wrapped
}

const centre = (s: string, width: number) =>
  s.length >= width ? s : ' '.repeat(Math.floor((width - s.length) / 2)) + s

/**
 * The receipt as plain text, which is also what the ESC/POS body carries.
 *
 * `symbol` is what stands in for `₹`, and it has to be threaded through rather
 * than substituted afterwards: every amount is right-aligned by string length,
 * so "Rs 420.00" and a one-character glyph do not produce the same columns.
 */
export function receiptText(r: Receipt, width = WIDTH_80MM, symbol = RS_TEXT): string[] {
  const rule = '-'.repeat(width)
  const when = r.printedAt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const out: string[] = [centre(r.property, width)]
  if (r.propertyPhone) out.push(centre(r.propertyPhone, width))
  out.push('', rule)
  out.push(...columns(`Room ${r.room}`, when, width))
  if (r.guest) out.push(r.guest)
  out.push(rule)

  if (r.empty) {
    out.push('', centre('Nothing outstanding.', width), '')
  } else {
    for (const l of r.lines) out.push(...columns(l.description, money(l.amount, symbol), width))
    out.push(rule)
    out.push(...columns('TOTAL', money(r.total, symbol), width))
  }

  out.push(rule)
  out.push(centre('In-room charges only.', width))
  out.push(centre('Not a tax invoice.', width))
  out.push(centre('Payable at the front desk.', width))
  return out
}

/**
 * The same receipt as bytes a thermal printer understands.
 *
 * Deliberately Font A and nothing clever: no logo raster, no barcode, no code
 * page switching. Every command here is in the original Epson set that every
 * clone implements, so it prints the same on a ₹4,000 no-name 80mm printer as
 * on a TM-T88. The cut is `GS V 66 0` - feed, then partial cut - which is the
 * one every clone gets right; `GS V 1` full-cut is the one they do not.
 */
export function escpos(r: Receipt, width = WIDTH_80MM, opts: { rupeeGlyph?: boolean } = {}): Uint8Array {
  const bytes: number[] = []
  const put = (...b: number[]) => bytes.push(...b)
  // latin1: the body is ASCII after money() has replaced the rupee sign, and
  // anything outside it would be a code-page gamble rather than a character.
  const write = (s: string) => {
    for (const ch of s) bytes.push(ch.codePointAt(0)! <= 0xff ? ch.codePointAt(0)! : 0x3f)
  }

  put(ESC, 0x40) // initialise: clears whatever the last job left set
  put(ESC, 0x74, 0x00) // code page 437, the default every clone has

  if (opts.rupeeGlyph) {
    // ESC & y c1 c2 : define characters c1..c2, y bytes tall. Then, per
    // character, its width in dots followed by width*y bytes of column data.
    const glyph = packGlyph()
    put(ESC, 0x26, 0x03, GLYPH_CODE, GLYPH_CODE, RUPEE_GLYPH[0].length, ...glyph)
    put(ESC, 0x25, 0x01) // print the user-defined set from here on
  }

  const text = receiptText(r, width, opts.rupeeGlyph ? String.fromCharCode(GLYPH_CODE) : RS_TEXT)
  text.forEach((line, i) => {
    // The property name is the only thing that gets emphasis. A receipt in
    // four weights is a receipt nobody reads.
    const bold = i === 0 || line.trimStart().startsWith('TOTAL')
    if (bold) put(ESC, 0x45, 0x01)
    write(line)
    if (bold) put(ESC, 0x45, 0x00)
    put(0x0a)
  })

  // Back to the built-in set before anything else prints on this roll.
  if (opts.rupeeGlyph) put(ESC, 0x25, 0x00)
  put(ESC, 0x64, 0x04) // feed four lines clear of the cutter
  put(GS, 0x56, 0x42, 0x00) // feed and partial cut
  return new Uint8Array(bytes)
}
