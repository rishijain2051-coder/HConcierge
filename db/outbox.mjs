// Drains outbound_messages through the local WhatsApp gateway.
//
//   node --env-file=.env.local db/outbox.mjs           poll forever, every 5s
//   node --env-file=.env.local db/outbox.mjs --once    one pass, then exit
//
// Run this on the machine that can reach the gateway. The app writes rows when
// OPENWA_OUTBOX=1, which is how production sends WhatsApp without anything
// inbound: Tailscale Funnel does not serve this tailnet, so Vercel cannot call
// the gateway directly. See WHATSAPP-TESTING-PLAN.md §2.
import postgres from 'postgres'

const url = process.env.DATABASE_URL
const gateway = process.env.OPENWA_URL?.replace(/\/$/, '')
const session = process.env.OPENWA_SESSION
const key = process.env.OPENWA_KEY

for (const [name, value] of [
  ['DATABASE_URL', url],
  ['OPENWA_URL', gateway],
  ['OPENWA_SESSION', session],
  ['OPENWA_KEY', key],
]) {
  if (!value) {
    console.error(`${name} is not set. Copy .env.example to .env.local first.`)
    process.exit(1)
  }
}

const once = process.argv.includes('--once')
const INTERVAL_MS = 5000
const BATCH = 10
/** A claim older than this is assumed to be from a drainer that died mid-send. */
const STALE_CLAIM = '2 minutes'

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })

/** Bare digits plus @c.us. Same rule as chatId() in lib/notify.ts. */
function chatId(phone) {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? `${digits}@c.us` : null
}

async function send(phone, body) {
  const chat = chatId(phone)
  if (!chat) return { ok: false, error: `unusable phone number: ${phone}` }

  const res = await fetch(`${gateway}/api/sessions/${session}/messages/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ chatId: chat, text: body, linkPreview: false }),
  })
  if (!res.ok) return { ok: false, error: `gateway ${res.status}: ${(await res.text()).slice(0, 200)}` }
  return { ok: true }
}

async function drain() {
  // Claim and read in one statement, so two drainers cannot send the same
  // message twice — a duplicate here is a duplicate on somebody's phone.
  const batch = await sql`
    update outbound_messages
       set claimed_at = now(), attempts = attempts + 1
     where id in (
       select id from outbound_messages
        where sent_at is null
          and (claimed_at is null or claimed_at < now() - ${STALE_CLAIM}::interval)
        order by created_at
        limit ${BATCH}
     )
    returning id, phone, body, attempts`

  for (const row of batch) {
    const result = await send(row.phone, row.body)
    if (result.ok) {
      await sql`update outbound_messages set sent_at = now(), last_error = null where id = ${row.id}`
      console.log(`sent    ${row.phone}  ${row.body.split('\n')[0].slice(0, 60)}`)
    } else {
      // claimed_at is cleared so the next pass retries it rather than waiting
      // out the stale window.
      await sql`update outbound_messages set claimed_at = null, last_error = ${result.error} where id = ${row.id}`
      console.error(`failed  ${row.phone}  attempt ${row.attempts}: ${result.error}`)
    }
  }
  return batch.length
}

const [{ pending }] = await sql`select count(*)::int as pending from outbound_messages where sent_at is null`
console.log(`outbox → ${gateway} (session ${session.slice(0, 8)}…), ${pending} pending`)

if (once) {
  const n = await drain()
  console.log(`one pass: ${n} claimed`)
  await sql.end()
} else {
  console.log(`polling every ${INTERVAL_MS / 1000}s — Ctrl+C to stop`)
  for (;;) {
    try {
      await drain()
    } catch (err) {
      // A dropped connection must not end the loop; the next tick reconnects.
      console.error('drain failed:', err.message)
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}
