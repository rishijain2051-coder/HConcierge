'use server'

import { sql } from '@/lib/db'
import { audit } from '@/lib/audit'
import { loadRoom } from '@/lib/guest'
import { cancelOwnRequest, createFreeformRequest, createRequests, type CartLine } from '@/lib/requests'

/**
 * Every action re-resolves the room from the QR token rather than trusting a
 * room id from the client. The token is the guest's whole credential, so it is
 * checked on every write, not once at page load.
 */

const MAX_MESSAGE = 1000
const MESSAGE_WINDOW_MINUTES = 2
const MESSAGE_MAX = 15

export async function submitCart(
  token: string,
  cart: CartLine[],
  opts: { note?: string | null; scheduledFor?: string | null } = {},
) {
  const ctx = await loadRoom(token)
  if (!ctx) return { ok: false as const, error: 'This room link is no longer valid. Please ask at reception.' }
  return createRequests(ctx, cart, opts)
}

export async function submitFreeform(token: string, note: string) {
  const ctx = await loadRoom(token)
  if (!ctx) return { ok: false as const, error: 'This room link is no longer valid. Please ask at reception.' }
  return createFreeformRequest(ctx, note)
}

export async function cancelRequest(token: string, requestId: string) {
  const ctx = await loadRoom(token)
  if (!ctx) return { ok: false, error: 'This room link is no longer valid.' }
  return cancelOwnRequest(ctx, requestId)
}

export async function sendGuestMessage(token: string, body: string) {
  const ctx = await loadRoom(token)
  if (!ctx) return { ok: false as const, error: 'This room link is no longer valid.' }

  const text = body.trim().slice(0, MAX_MESSAGE)
  if (!text) return { ok: false as const, error: 'Type a message first.' }

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from messages
     where room_id = ${ctx.room.id} and sender = 'guest'
       and created_at > now() - (${MESSAGE_WINDOW_MINUTES} || ' minutes')::interval`
  if (count >= MESSAGE_MAX) {
    return { ok: false as const, error: 'Please wait a moment before sending more.' }
  }

  await sql`
    insert into messages (property_id, room_id, sender, body)
    values (${ctx.property.id}, ${ctx.room.id}, 'guest', ${text})`

  await audit({
    propertyId: ctx.property.id,
    actor: `Room ${ctx.room.number}`,
    action: 'message.sent',
    entity: 'room',
    entityId: ctx.room.id,
  })

  return { ok: true as const }
}
