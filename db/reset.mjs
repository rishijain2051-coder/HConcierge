// Clears operational data and keeps configuration.
//
//   npm run db:reset                every room checked out, all traffic cleared
//   npm run db:reset -- --rotate-qr also reissue every room's QR token
//
// Kept:    properties, rooms, the directory, info pages, quick replies, staff
// Cleared: guests, requests, messages, folio entries, audit log
//
// QR tokens are NOT rotated by default. The printed desk card is permanent now
// — the per-stay 4-digit code is what changes between guests — so rotating
// tokens here would silently invalidate every card already sitting in a room.
// Pass --rotate-qr only when you intend to reprint them all.
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const rotateQr = process.argv.includes('--rotate-qr')
const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })

try {
  const [before] = await sql`
    select (select count(*)::int from rooms where occupied) as occupied,
           (select count(*)::int from requests)             as requests,
           (select count(*)::int from messages)             as messages,
           (select count(*)::int from folio_entries)        as folio,
           (select count(*)::int from audit_log)            as audit`
  console.log(
    `clearing — ${before.occupied} occupied rooms, ${before.requests} requests, ` +
      `${before.messages} messages, ${before.folio} folio entries, ${before.audit} audit rows`,
  )

  // Order matters only for readability; request_items cascades from requests.
  await sql`delete from folio_entries`
  await sql`delete from messages`
  await sql`delete from requests`
  await sql`delete from audit_log`
  await sql`
    update rooms
       set occupied = false, guest_name = null, checked_in_at = null, checkout_at = null,
           access_code = null, code_set_at = null, code_attempts = 0, code_locked_until = null`

  if (rotateQr) {
    // One token per row: a single generated value across an UPDATE would hand
    // every room the same token and trip rooms_token_key.
    const rooms = await sql`select id from rooms`
    for (const r of rooms) {
      await sql`update rooms set token = ${randomBytes(8).toString('base64url')} where id = ${r.id}`
    }
    console.log(`rotated ${rooms.length} QR tokens — every printed card must be reprinted`)
  }

  console.log('\n✓ clean slate')
  console.table(
    await sql`
      select p.name as property,
             (select count(*)::int from rooms      where property_id = p.id) as rooms,
             (select count(*)::int from rooms      where property_id = p.id and occupied) as occupied,
             (select count(*)::int from categories where property_id = p.id) as sections,
             (select count(*)::int from items      where property_id = p.id) as items,
             (select count(*)::int from info_pages where property_id = p.id) as info,
             (select count(*)::int from requests   where property_id = p.id) as requests
        from properties p order by p.name`,
  )
  console.table(await sql`select username, name, role, active from staff order by role desc, username`)
} catch (err) {
  console.error('✗ reset failed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
