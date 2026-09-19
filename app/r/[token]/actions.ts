'use server'

import { headers } from 'next/headers'

import { sql } from '@/lib/db'
import { audit } from '@/lib/audit'
import { loadRoom } from '@/lib/guest'
import { allow, clientKeyFrom, CODE_LIMIT } from '@/lib/limit'
import { hasGuestAccess, submitRoomCode } from '@/lib/guest-session'
import { rupees } from '@/lib/money'
import { cancelOwnRequest, createFreeformRequest, createRequests, type CartLine } from '@/lib/requests'
import { claimPromotion } from '@/lib/promotions'

/**
 * Every action re-resolves the room from the QR token rather than trusting a
 * room id from the client, and re-checks the access grant. The token alone is
 * not enough to write anything: a photographed QR must still get past the
 * stay's 4-digit code. Checked on every write, not once at page load.
 */

const DENIED = { ok: false as const, error: 'Please enter your room code again.' }

async function authedRoom(token: string) {
  const ctx = await loadRoom(token)
  if (!ctx || !ctx.room.occupied) return null
  return (await hasGuestAccess(ctx.room)) ? ctx : null
}

const MAX_MESSAGE = 1000
const MESSAGE_WINDOW_MINUTES = 2
const MESSAGE_MAX = 15

/** The second factor: the 4-digit code the front desk issued for this stay. */
export async function enterRoomCode(token: string, code: string) {
  // Before the database, deliberately. The per-room lockout is what stops a
  // code being guessed; this is what stops the guessing being free. Every
  // attempt otherwise costs a room lookup and an `update rooms` on a pool that
  // is the first thing to run out under load.
  if (!allow(`code:${clientKeyFrom(await headers())}`, CODE_LIMIT.perMinute, CODE_LIMIT.burst)) {
    return { ok: false as const, error: 'Too many tries from this device. Wait a moment and try again.' }
  }

  const ctx = await loadRoom(token)
  if (!ctx) return { ok: false as const, error: 'This room link is not valid. Please ask at reception.' }
  if (!ctx.room.occupied) return { ok: false as const, error: 'This room is not checked in yet.' }
  return submitRoomCode(ctx.room, code)
}

export async function submitCart(
  token: string,
  cart: CartLine[],
  opts: { note?: string | null; scheduledFor?: string | null } = {},
) {
  const ctx = await authedRoom(token)
  if (!ctx) return DENIED
  return createRequests(ctx, cart, opts)
}

export async function submitFreeform(token: string, note: string) {
  const ctx = await authedRoom(token)
  if (!ctx) return DENIED
  return createFreeformRequest(ctx, note)
}

/**
 * "I would like to settle up."
 *
 * No card is taken here and none ever will be — this puts the guest on the
 * front desk's board with their balance attached, so somebody walks up with a
 * card machine instead of the guest queueing in the lobby.
 */
export async function askToSettle(token: string) {
  const ctx = await authedRoom(token)
  if (!ctx) return DENIED

  const [row] = await sql<{ total: string | null; asked: Date | null }[]>`
    select (select sum(amount_paise)::text from folio_entries
             where room_id = ${ctx.room.id} and voided_at is null and settled_at is null) as total,
           settle_requested_at as asked
      from rooms where id = ${ctx.room.id}`

  const total = Number(row?.total ?? 0)
  if (total <= 0) return { ok: false as const, error: 'There is nothing to settle yet.' }
  if (row?.asked) return { ok: true as const }

  const res = await createFreeformRequest(
    ctx,
    `Would like to settle the room bill — ${rupees(total)}`,
  )
  if (!res.ok) return res

  await sql`update rooms set settle_requested_at = now() where id = ${ctx.room.id}`
  return { ok: true as const }
}

/**
 * Taking up an offer. Nothing is issued and nothing is discounted here — it
 * records the claim against the stay and puts the guest on the desk's board
 * with the offer named. See lib/promotions.ts for why it stops there.
 */
export async function claimOffer(token: string, promotionId: string) {
  const ctx = await authedRoom(token)
  if (!ctx) return DENIED
  return claimPromotion(ctx, promotionId)
}

export async function cancelRequest(token: string, requestId: string) {
  const ctx = await authedRoom(token)
  if (!ctx) return { ok: false, error: DENIED.error }
  return cancelOwnRequest(ctx, requestId)
}

export async function sendGuestMessage(token: string, body: string) {
  const ctx = await authedRoom(token)
  if (!ctx) return DENIED

  const text = body.trim().slice(0, MAX_MESSAGE)
  if (!text) return { ok: false as const, error: 'Type a message first.' }

  // Count and insert in one statement. Checking first and inserting after let
  // a fast thumb — or a script — land 24 messages against a cap of 15, because
  // every one of them read the count before any of them had committed.
  const sent = await sql<{ id: string }[]>`
    insert into messages (property_id, room_id, sender, body)
    select ${ctx.property.id}, ${ctx.room.id}, 'guest', ${text}
     where (select count(*) from messages
             where room_id = ${ctx.room.id} and sender = 'guest'
               and created_at > now() - (${MESSAGE_WINDOW_MINUTES} || ' minutes')::interval)
           < ${MESSAGE_MAX}
    returning id`
  if (sent.length === 0) {
    return { ok: false as const, error: 'Please wait a moment before sending more.' }
  }

  await audit({
    propertyId: ctx.property.id,
    actor: `Room ${ctx.room.number}`,
    action: 'message.sent',
    entity: 'room',
    entityId: ctx.room.id,
  })

  return { ok: true as const }
}
