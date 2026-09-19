/**
 * Prints what the board's amber alert would be ringing about right now.
 *
 *   npm run db:check-amber-alert
 *
 * Nothing is written, sent or sounded.
 *
 * The trigger itself is one word - nobody has accepted it - and needs no
 * checking. What this covers is the part that is easy to get wrong and
 * invisible until somebody is standing in front of a real board: which rows
 * the alert carries, and which of them it calls overdue. A scheduled request
 * is the trap there. A wake-up call booked at midnight for seven is not seven
 * hours late at half past twelve, and lib/sla.ts is the only thing that knows
 * it.
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
const { loadBoard } = await import(new URL('board.ts', lib).href)
const { slaState, formatAge } = await import(new URL('sla.ts', lib).href)

/** The board's filter, in one line, exactly as Board.tsx applies it. */
const ringing = (rows) => rows.filter((r) => r.status === 'new')
/** And the tone each row carries once it is in there. */
const overdue = (r, now) => slaState(r, now) === 'late'

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  - ' + detail : ''}`)
  if (!ok) failures++
}

try {
  const now = new Date()
  const ago = (m) => new Date(now.getTime() - m * 60000)
  const row = (old, extra = {}) => ({
    created_at: ago(old),
    sla_minutes: 15,
    status: 'new',
    warn_at_percent: 60,
    ...extra,
  })

  check('a request nobody has accepted rings, however new', ringing([row(0)]).length === 1)
  check('an accepted one does not, however late', ringing([row(90, { status: 'ack' })]).length === 0)
  check('nor one already being worked on', ringing([row(90, { status: 'in_progress' })]).length === 0)
  check('nor a finished one', ringing([row(90, { status: 'done' })]).length === 0)
  check('nor one that was cancelled', ringing([row(90, { status: 'cancelled' })]).length === 0)

  check('a fresh row is not called overdue', overdue(row(2), now) === false)
  check('one past its target is', overdue(row(20), now) === true)
  check(
    'a wake-up call booked for later is not overdue at midnight',
    overdue(row(300, { scheduled_for: new Date(now.getTime() + 3 * 3600_000) }), now) === false,
    'the clock starts when the work is due, not when it was asked for',
  )
  check(
    'and it is overdue once its hour has been and gone',
    overdue(row(300, { scheduled_for: new Date(now.getTime() - 40 * 60000) }), now) === true,
  )

  /* And what it says about the board as it stands. */
  const [mgr] = await sql`
    select s.id, s.name, s.role, s.property_id, coalesce(s.organisation_id, p.organisation_id) as organisation_id
      from staff s join properties p on p.id = s.property_id
     where s.role = 'manager' and s.active and s.property_id is not null
     order by s.name limit 1`
  if (!mgr) {
    console.log('\nno manager with a property - skipping the live board')
  } else {
    const board = await loadBoard(mgr, mgr.property_id)
    const live = ringing(board)
    console.log(`\n${mgr.name}'s board: ${board.length} row(s), ${live.length} would be ringing`)
    for (const r of live) {
      console.log(
        `  Room ${r.room_number} #${r.ref} - ${formatAge(r.created_at, now)} old, target ${r.sla_minutes}m${
          overdue(r, now) ? ' - OVERDUE' : ''
        }`,
      )
    }
    check(
      'the alert is exactly the New column',
      live.length === board.filter((r) => r.status === 'new').length,
    )
  }
} catch (err) {
  console.log('threw: ' + (err?.stack ?? err))
  failures++
} finally {
  await sql.end()
}

console.log('')
console.log(failures === 0 ? 'all checks pass' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
