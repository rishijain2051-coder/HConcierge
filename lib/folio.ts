import { sql } from './db'
import { scopeTo } from './scope'
import type { Staff } from './auth'

/**
 * The single place money is written.
 *
 * Today every charge lands in `folio_entries` and the front office exports a
 * CSV to key into their PMS. When RN Hospitality's PMS is wired up, the adapter
 * goes behind these four functions and nothing else in the app changes - that
 * is the whole point of routing every charge through here rather than letting
 * routes insert rows directly.
 */

export type FolioEntry = {
  id: string
  room_id: string
  request_id: string | null
  description: string
  amount_paise: number
  created_at: Date
  exported_at: Date | null
  voided_at: Date | null
}

export type PostChargeInput = {
  propertyId: string
  roomId: string
  requestId: string
  description: string
  amountPaise: number
  guestName?: string | null
}

/**
 * Idempotent: `folio_request_key` is a unique index on request_id, so a retried
 * request or a double-tapped "complete" cannot bill the guest twice.
 */
export async function postCharge(input: PostChargeInput): Promise<FolioEntry | null> {
  if (input.amountPaise <= 0) return null
  const rows = await sql<FolioEntry[]>`
    insert into folio_entries (property_id, room_id, request_id, description, amount_paise, guest_name)
    values (${input.propertyId}, ${input.roomId}, ${input.requestId},
            ${input.description}, ${input.amountPaise}, ${input.guestName ?? null})
    on conflict (request_id) where request_id is not null do nothing
    returning *`
  return rows[0] ?? null
}

export async function voidCharge(entryId: string, reason: string): Promise<void> {
  await sql`
    update folio_entries
       set voided_at = now(), void_reason = ${reason}
     where id = ${entryId} and voided_at is null`
}

/** Live charges for a room - what the guest sees and what checkout settles. */
export async function roomFolio(roomId: string): Promise<FolioEntry[]> {
  return sql<FolioEntry[]>`
    select * from folio_entries
     where room_id = ${roomId} and voided_at is null and settled_at is null
     order by created_at desc`
}

export async function roomFolioTotal(roomId: string): Promise<number> {
  const [row] = await sql<{ total: string | null }[]>`
    select sum(amount_paise)::text as total from folio_entries
     where room_id = ${roomId} and voided_at is null and settled_at is null`
  return Number(row?.total ?? 0)
}

/**
 * Close out a room's bill.
 *
 * HConcierge never takes the money - the desk does, however it always has.
 * This records that it happened, which is what stops the charges following the
 * guest into the next stay and what clears their screen.
 *
 * Returns the amount closed so the caller can tell the guest and the audit log
 * what was actually settled, rather than what the screen said a moment ago.
 */
export async function settleRoom(roomId: string, by: string): Promise<number> {
  const rows = await sql<{ amount_paise: number }[]>`
    update folio_entries
       set settled_at = now(), settled_by = ${by}
     where room_id = ${roomId} and voided_at is null and settled_at is null
    returning amount_paise`
  await sql`update rooms set settle_requested_at = null where id = ${roomId}`
  return rows.reduce((sum, r) => sum + r.amount_paise, 0)
}

/**
 * CSV the front office keys into the PMS until a real integration exists.
 *
 * Takes the staff member, not just a property id. The route used to read the
 * property straight from the query string for admins, which let one customer's
 * admin export another customer's billing - every admin can see property ids
 * in their own picker, so nothing had to be guessed. The scope is enforced
 * here, where it cannot be skipped.
 */
export async function exportCsv(actor: Staff, propertyId: string | null, days: number): Promise<string> {
  const rows = await sql<
    { number: string; guest_name: string | null; description: string; amount_paise: number; created_at: Date }[]
  >`
    select r.number, f.guest_name, f.description, f.amount_paise, f.created_at
      from folio_entries f
      join rooms r on r.id = f.room_id
     where ${scopeTo(actor, sql`f.property_id`, propertyId)}
       and f.voided_at is null
       -- The window is built here, not from the app server's clock. created_at
       -- is written by Postgres now(); the two machines measured 291ms apart,
       -- and a charge posted immediately before an export fell outside it.
       and f.created_at >= now() - (${days} || ' days')::interval
     order by r.number, f.created_at`

  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = 'Room,Guest,Description,Amount (INR),Posted at'
  const body = rows.map((r) =>
    [r.number, r.guest_name, r.description, (r.amount_paise / 100).toFixed(2), r.created_at.toISOString()]
      .map(esc)
      .join(','),
  )
  return [header, ...body].join('\n')
}
