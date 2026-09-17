/**
 * CSV, both directions, in about sixty lines and no dependency.
 *
 * A `split(',')` would have done until the first menu item called "Chicken
 * Tikka, Half Plate" or a description with a line break in it, at which point
 * every column after it shifts by one and the import silently writes nonsense.
 * So this is a real character scanner: quoted fields, doubled quotes as an
 * escape, commas and newlines inside quotes, and CRLF — which matters because
 * Excel on Windows is what will be saving these files.
 *
 * Not a general CSV library. No streaming, no type coercion, no header
 * inference beyond the first row. A property's whole directory is a few hundred
 * rows and arrives as one upload.
 */

/** Rows of cells, exactly as they appear. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  // A byte-order mark is the single most common reason a header row does not
  // match: Excel writes one, and "﻿number" is not "number".
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        // A doubled quote is a literal one; a single quote ends the field.
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }

    if (c === '"' && cell === '') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/**
 * Header row plus objects keyed by it. Headers are lowercased and trimmed so a
 * hand-edited "Room Number " still lands on `room number`.
 */
export function parseCsvRows(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const raw = parseCsv(text)
  if (raw.length === 0) return { headers: [], rows: [] }

  const headers = raw[0].map((h) => h.trim().toLowerCase())
  const rows = raw.slice(1).map((cells) => {
    const o: Record<string, string> = {}
    headers.forEach((h, i) => (o[h] = (cells[i] ?? '').trim()))
    return o
  })
  return { headers, rows }
}

/** One cell, quoted only when it has to be. */
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CRLF and a BOM, both on purpose: it is Excel that opens these, and without
 * the mark Excel reads UTF-8 as the local code page and mangles ₹ and every
 * accented name in the file.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
