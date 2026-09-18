/**
 * Prints which requests the board's amber alert would be ringing about right
 * now, and checks the rule that decides.
 *
 *   npm run db:check-amber-alert
 *
 * Nothing is written, sent or sounded. It exists because the board is the one
 * screen that cannot be opened without signing in as somebody, so the rule
 * behind the alarm — `needsAttention` in lib/sla.ts — is read here instead,
 * the same function the screen calls, against this property's real rows and
 * its own amber threshold.
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
const { needsAttention, slaState, formatAge } = await import(new URL('sla.ts', lib).href)

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

try {
  /* The rule, on rows made up here: these are the four cases that matter and
     three of them almost never exist on a real board at the moment you look. */
  const now = new Date()
  const ago = (m) => new Date(now.getTime() - m * 60000)
  const row = (over, extra = {}) => ({
    created_at: ago(over),
    sla_minutes: 15,
    status: 'new',
    warn_at_percent: 60,
    ...extra,
  })

  check('a fresh request does not ring', needsAttention(row(2), now) === false)
  check('one past 60% of its target rings', needsAttention(row(10), now) === true, slaState(row(10), now))
  check('one past its target rings', needsAttention(row(20), now) === true, slaState(row(20), now))
  check('an accepted one never rings, however late', needsAttention(row(90, { status: 'ack' }), now) === false)
  check('a finished one never rings', needsAttention(row(90, { status: 'done' }), now) === false)
  check(
    'a wake-up call booked for later is not late at midnight',
    needsAttention(row(300, { scheduled_for: new Date(now.getTime() + 3 * 3600_000) }), now) === false,
  )
  check(
    "the property's own amber threshold is what decides",
    needsAttention(row(10, { warn_at_percent: 90 }), now) === false &&
      needsAttention(row(14, { warn_at_percent: 90 }), now) === true,
    'at 90% a 15m target goes amber at 13.5m, not 9m',
  )

  /* And what it says about the board as it stands. */
  const [mgr] = await sql`
    select s.id, s.name, s.role, s.property_id, coalesce(s.organisation_id, p.organisation_id) as organisation_id
      from staff s join properties p on p.id = s.property_id
     where s.role = 'manager' and s.active and s.property_id is not null
     order by s.name limit 1`
  if (!mgr) {
    console.log('\nno manager with a property — skipping the live board')
  } else {
    const board = await loadBoard(mgr, mgr.property_id)
    const ringing = board.filter((r) => needsAttention(r, now))
    console.log(`\n${mgr.name}'s board: ${board.length} row(s), ${ringing.length} would be ringing`)
    for (const r of ringing) {
      console.log(
        `  Room ${r.room_number} · #${r.ref} · ${formatAge(r.created_at, now)} old, target ${r.sla_minutes}m · ${slaState(r, now)}`,
      )
    }
    check(
      'nothing that is already accepted is in the list',
      ringing.every((r) => r.status === 'new'),
    )
    check(
      'the alert is a subset of the New column',
      ringing.length <= board.filter((r) => r.status === 'new').length,
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
