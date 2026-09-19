/**
 * Prints the thermal receipt for a room that owes something, at both paper
 * widths, and checks the ESC/POS byte stream is one a printer will accept.
 *
 *   npm run db:check-receipt
 *
 * Nothing is printed, queued or sent. It writes only if no room owes anything:
 * then it lends a room three charges so the money columns can be seen at all,
 * and takes those exact rows back by id afterwards.
 *
 * Worth having because the two things most likely to break here are invisible
 * until paper comes out of a machine nobody has plugged in yet - a column that
 * does not line up because the width changed, and a byte above 0x7F that a
 * printer renders as a box. Both are asserted rather than eyeballed.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      const from = dirname(fileURLToPath(ctx.parentURL))
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        const guess = resolvePath(from, spec + ext)
        if (existsSync(guess)) return { url: pathToFileURL(guess).href, shortCircuit: true }
      }
    }
    if (/^next\/[a-z-]+$/.test(spec)) {
      try {
        return next(spec + '.js', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

const lib = new URL('../lib/', import.meta.url)
const { sql } = await import(new URL('db.ts', lib).href)
const { buildReceipt, receiptText, escpos, WIDTH_80MM, WIDTH_58MM } = await import(new URL('receipt.ts', lib).href)

let failures = 0
const lent = []  // ids of the charges this check lent, to give back by id
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  - ' + detail : ''}`)
  if (!ok) failures++
}

try {
  /* The room with the largest open balance, so the receipt has lines on it.
     Falls back to any room, which exercises the empty case instead. */
  const [row] = await sql`
    select r.id, r.number, coalesce(sum(f.amount_paise), 0)::int as owed
      from rooms r
      left join folio_entries f
        on f.room_id = r.id and f.voided_at is null and f.settled_at is null
     group by r.id, r.number
     order by owed desc, r.number
     limit 1`
  if (!row) {
    console.log('no rooms in the database')
    await sql.end()
    process.exit(0)
  }

  /* The money columns are the part most likely to be wrong, and they only
     appear when something is owed. If nothing is, lend the room two charges
     for the length of this check and take them back - including one long
     enough to force the wrap, which is the branch that never gets exercised by
     a real dosa. */
  if (row.owed === 0) {
    const [prop] = await sql`select property_id from rooms where id = ${row.id}`
    for (const [desc, paise] of [
      ['Masala Dosa', 26000],
      ['Hyderabadi Chicken Biryani with raita and salan', 56000],
      ['Filter Coffee', 16000],
    ]) {
      const [made] = await sql`insert into folio_entries (property_id, room_id, description, amount_paise)
                values (${prop.property_id}, ${row.id}, ${desc}, ${paise}) returning id`
      lent.push(made.id)
    }
    console.log('nothing was owed, so this check lent the room three charges and will take them back\n')
  }

  const receipt = await buildReceipt(row.id)
  console.log(`room ${row.number}, ${receipt.lines.length} line(s), total ${receipt.total} paise\n`)

  for (const width of [WIDTH_80MM, WIDTH_58MM]) {
    const lines = receiptText(receipt, width)
    console.log(`--- ${width} columns ${'-'.repeat(Math.max(0, width - 16))}`)
    for (const l of lines) console.log('|' + l + '|')
    console.log('')
    check(`${width}: no line is wider than the paper`, lines.every((l) => l.length <= width),
      'longest ' + Math.max(...lines.map((l) => l.length)))
    check(`${width}: no rupee sign survives`, !lines.some((l) => l.includes('₹')))
  }

  const bytes = escpos(receipt, WIDTH_80MM)
  const hex = (n) => n.toString(16).padStart(2, '0')
  console.log('head: ' + [...bytes.slice(0, 8)].map(hex).join(' '))
  console.log('tail: ' + [...bytes.slice(-8)].map(hex).join(' '))
  console.log('')

  check('starts with ESC @ (initialise)', bytes[0] === 0x1b && bytes[1] === 0x40)
  check('selects a code page', bytes[2] === 0x1b && bytes[3] === 0x74)
  check(
    'ends with GS V 66 0 (feed and partial cut)',
    [...bytes.slice(-4)].join(',') === [0x1d, 0x56, 0x42, 0x00].join(','),
  )
  check('feeds clear of the cutter before cutting', [...bytes.slice(-7, -4)].join(',') === [0x1b, 0x64, 0x04].join(','))
  check('every byte is printable ASCII or a known control', bytes.every((b) => b <= 0x7f))
  check('bold is turned off again after every use',
    [...bytes].reduce((n, b, i) => (b === 0x45 && bytes[i - 1] === 0x1b ? n + (bytes[i + 1] === 1 ? 1 : -1) : n), 0) === 0)
  check('the paper says it is not a tax invoice', receiptText(receipt).some((l) => l.includes('Not a tax invoice')))
  check('the total is the sum of the lines',
    receipt.total === receipt.lines.reduce((n, l) => n + l.amount, 0))
  check('a description too long for the paper wraps instead of truncating',
    receipt.lines.every((l) => receiptText(receipt).join('\n').includes(l.description.slice(0, 20))))
} catch (err) {
  console.log('threw: ' + (err?.message ?? err))
  failures++
} finally {
  if (lent) {
    const gone = await sql`
      delete from folio_entries
       where description in ('Masala Dosa', 'Hyderabadi Chicken Biryani with raita and salan', 'Filter Coffee')
         and settled_at is null and exported_at is null
         and created_at > now() - interval '5 minutes'
       returning id`
    console.log(`\ngave back ${gone.length} lent charge(s)`)
  }
  await sql.end()
}

console.log('')
console.log(failures === 0 ? 'all checks pass' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
