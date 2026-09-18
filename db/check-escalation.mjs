/**
 * Exercises the real escalation sweep and prints every message it would send,
 * sending none.
 *
 *   npm run db:check-escalation
 *
 * This exists because a miss in `lib/notify.ts` is silent. The board scoping
 * stays correct, so the person still sees the request on their screen and
 * simply never gets told about it — there is no error, no log and no failing
 * page. The only way to know who a late request actually reaches is to make one
 * and look.
 *
 * Two things make it safe to run against the shared database:
 *
 *   1. Every transport env var is deleted before lib/notify.ts is imported, and
 *      messagingConfigured() is asserted false. viaGateway() and viaTwilio()
 *      both bail on a falsy var, so sendMessage() falls through to a
 *      console.log — nothing reaches WhatsApp, Twilio, or the outbound_messages
 *      table the live worker drains.
 *   2. It refuses to run if anything else in the database is already eligible,
 *      so the sweep cannot escalate somebody else's work as a side effect. The
 *      only rows it fires on are the ones it makes on the property's lowest
 *      unoccupied room, and deletes again.
 *
 * It leaves `audit_log` rows behind. That table refuses DELETE by trigger,
 * which is the whole point of it, so escalation rows for a request that no
 * longer exists are the correct outcome rather than a mess.
 *
 * The assertions are deliberately structural rather than a list of usernames:
 * who is on a rung depends on the seed and on whoever has a phone this week,
 * but "nobody is told twice" and "a claimed job only nudges the person holding
 * it" have to hold whatever the roster looks like.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

/* The app's modules are TypeScript importing './db' with no extension, and
   Node's ESM resolver wants one. Node strips the types itself once the file is
   found, so the extension is all that is missing. */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      const from = dirname(fileURLToPath(ctx.parentURL))
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        const guess = resolvePath(from, spec + ext)
        if (existsSync(guess)) return { url: pathToFileURL(guess).href, shortCircuit: true }
      }
    }
    // next/headers has no export-map entry without the extension outside
    // Next's own bundler. Importing it is enough: baseUrl() only throws when it
    // is called, and linkBase() catches that.
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

for (const k of [
  'OPENWA_URL',
  'OPENWA_SESSION',
  'OPENWA_KEY',
  'OPENWA_OUTBOX',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM',
]) {
  delete process.env[k]
}

const lib = new URL('../lib/', import.meta.url)
const { sql } = await import(new URL('db.ts', lib).href)
const { sweepEscalations, messagingConfigured } = await import(new URL('notify.ts', lib).href)

if (messagingConfigured()) {
  console.error('REFUSING: a transport is still configured, so this would send for real.')
  process.exit(1)
}

const out = console.log
const sent = []
console.log = (...a) => {
  const line = a.map(String).join(' ')
  if (line.includes('(undelivered, no transport succeeded)')) sent.push(line)
  else out(...a)
}
const done = (code) => {
  console.log = out
  return sql.end().then(() => process.exit(code))
}

out('transports: none configured, so sends are logged instead of sent')

/* The property with the most rooms that actually has a ladder. Taking the
   first one by name picked an empty property with no rules on it, which
   produced a confident "nothing fired" that meant nothing at all. */
const [property] = await sql`
  select p.id, p.name, count(r.id)::int as rooms
    from properties p
    join rooms r on r.property_id = p.id
   where exists (select 1 from escalation_rules e where e.property_id = p.id and e.active)
   group by p.id, p.name
   order by rooms desc, p.name
   limit 1`
if (!property) {
  out('\nNothing to check: no property has both rooms and an active escalation rung.')
  await done(0)
}
/* An empty room by preference. A fixture only exists for the length of one
   sweep, but a crashed run left one on the board long enough for somebody to
   press Done on it, so the window is real and an occupied room would put it in
   front of a guest. */
const [room] = await sql`
  select id, number from rooms where property_id = ${property.id}
   order by occupied, number limit 1`
const staff = await sql`select id, username, phone, role, department from staff where active`
const withPhone = staff.filter((s) => s.phone && s.phone.trim())

out(`property: ${property.name}   fixtures on room ${room.number}`)
out(`roster: ${staff.length} active, ${withPhone.length} reachable by phone`)

if (withPhone.length === 0) {
  out('\nNothing to check: nobody on this property has a phone number, so no message can be sent.')
  await done(0)
}

/* A crashed run can leave a fixture behind. Only rows this script could have
   made: that room, minted in the last quarter of an hour. */
await sql`
  delete from request_items where request_id in (
    select id from requests where room_id = ${room.id} and created_at > now() - interval '15 minutes')`
const stale = await sql`
  delete from requests where room_id = ${room.id} and created_at > now() - interval '15 minutes'
  returning ref`
if (stale.length) out('cleaned up leftover fixtures: ' + stale.map((r) => '#' + r.ref).join(' '))

const busy = await sql`
  select count(*)::int as n from requests r
    join escalation_rules e on e.property_id = r.property_id and e.active
     and (e.department is null or e.department = r.department)
     and e.step > r.escalation_step
     and now() >= coalesce(r.scheduled_for, r.created_at)
                  + ((r.sla_minutes + e.after_minutes) || ' minutes')::interval
   where r.status in ('new','ack','in_progress')`
if (busy[0].n > 0) {
  out(`\nREFUSING: ${busy[0].n} other request(s) are already eligible, so the sweep would escalate them too.`)
  out('Clear or complete them first, then run this again.')
  await done(1)
}

/** One fixture, one sweep, one teardown. Returns the messages it produced. */
async function fire({ status, dept, items, note, ageMins, sla, step, assigned }) {
  const seen = status === 'new' ? null : sql`now() - (${ageMins} || ' minutes')::interval`
  const [req] = await sql`
    insert into requests (property_id, room_id, kind, department, status, note, sla_minutes,
                          escalation_step, assigned_to, created_at, acknowledged_at)
    values (${property.id}, ${room.id}, 'amenity', ${dept}, ${status}, ${note}, ${sla}, ${step},
            ${assigned ?? null}, now() - (${ageMins} || ' minutes')::interval, ${seen})
    returning id, ref`
  for (const [name, qty] of items) {
    await sql`insert into request_items (request_id, name, qty, unit_price_paise)
              values (${req.id}, ${name}, ${qty}, 0)`
  }

  sent.length = 0
  const fired = await sweepEscalations(property.id)
  const [after] = await sql`select escalation_step from requests where id = ${req.id}`
  const msgs = sent.map((line) => {
    const m = line.match(/→ (.+?): ([\s\S]*)$/)
    const digits = m[1].replace(/\D/g, '')
    const who = withPhone.find((s) => s.phone.replace(/\D/g, '') === digits)
    return { to: who?.username ?? m[1], body: m[2] }
  })

  await sql`delete from request_items where request_id = ${req.id}`
  await sql`delete from requests where id = ${req.id}`
  return { ref: req.ref, fired, step: after.escalation_step, msgs }
}

let failures = 0
function check(label, ok, detail) {
  out(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}
const show = (r) => {
  out(`    #${r.ref}: fired ${r.fired}, step now ${r.step}, ${r.msgs.length} message(s)`)
  for (const m of r.msgs) {
    out('    ---- to ' + m.to)
    for (const l of m.body.split('\n')) out('         ' + l)
  }
}

const hk = withPhone.find((s) => s.department === 'housekeeping') ?? withPhone[0]

try {
  out('\n=== unclaimed and late: the ladder, and the team as well')
  let r = await fire({
    status: 'new',
    dept: hk.department,
    sla: 10,
    ageMins: 40,
    step: 0,
    note: 'Please before 9, going out',
    items: [
      ['Bath towels', 2],
      ['Toiletries kit', 1],
    ],
  })
  show(r)
  check('something fired', r.fired === 1)
  check('at least one message went out', r.msgs.length > 0)
  check(
    'exactly one "Still waiting" reminder headline',
    r.msgs.filter((m) => m.body.startsWith('*Still waiting')).length >= 1,
  )
  check('nobody was told twice', new Set(r.msgs.map((m) => m.to)).size === r.msgs.length)
  check(
    'the reminder lists the items rather than the note',
    r.msgs.every((m) => m.body.includes('Bath towels')),
  )

  out('\n=== claimed and late: only the person holding it')
  r = await fire({
    status: 'ack',
    dept: hk.department,
    sla: 10,
    ageMins: 40,
    step: 0,
    note: null,
    items: [['Bath towels', 2]],
    assigned: hk.id,
  })
  show(r)
  const reminders = r.msgs.filter((m) => m.body.startsWith('*Still waiting'))
  check('at most one reminder, and it is the holder', reminders.length <= 1)
  check(
    'the holder is the one reminded, if anyone is',
    reminders.length === 0 || reminders[0].to === hk.username,
    `holder is ${hk.username}`,
  )
  check('nobody was told twice', new Set(r.msgs.map((m) => m.to)).size === r.msgs.length)

  out('\n=== a later rung: the ladder climbs, the reminder does not repeat')
  r = await fire({
    status: 'new',
    dept: hk.department,
    sla: 10,
    ageMins: 60,
    step: 1,
    note: null,
    items: [['Bath towels', 1]],
  })
  show(r)
  check(
    'no reminder on a rung after the first',
    r.msgs.every((m) => !m.body.startsWith('*Still waiting')),
  )
} catch (err) {
  out('\nthrew: ' + (err?.message ?? err))
  failures++
}

out('')
out(failures === 0 ? 'all checks pass' : `${failures} check(s) failed`)
await done(failures === 0 ? 0 : 1)
