'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { audit } from '@/lib/audit'
import { canTouchProperty, requireManager, type Staff } from '@/lib/auth'
import { propRef } from '@/lib/scope'
import { generateAccessCode } from '@/lib/guest-session'
import { roomFolioTotal, settleRoom } from '@/lib/folio'

const newToken = () => randomBytes(8).toString('base64url')

async function roomFor(staff: Staff, roomId: string) {
  const [room] = await sql<
    { id: string; property_id: string; organisation_id: string | null; number: string }[]
  >`select r.id, r.property_id, r.number, p.organisation_id
      from rooms r join properties p on p.id = r.property_id where r.id = ${roomId}`
  if (!room || !canTouchProperty(staff, propRef(room))) return null
  return room
}

/**
 * Check-in issues a fresh 4-digit code and leaves the QR token alone.
 *
 * The token used to rotate here, which quietly invalidated the printed card in
 * the room and meant reprinting one per check-in. The card is now permanent and
 * the code is the part that changes with the guest.
 */
export async function checkIn(roomId: string, guestName: string, checkoutAt: string | null) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  const name = guestName.trim().slice(0, 120)
  if (!name) return { ok: false as const, error: 'Enter the guest name.' }

  const code = generateAccessCode()
  await sql`
    update rooms
       set occupied = true, guest_name = ${name}, checked_in_at = now(),
           checkout_at = ${checkoutAt || null},
           access_code = ${code}, code_set_at = now(),
           code_attempts = 0, code_locked_until = null
     where id = ${roomId}`

  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.checked_in',
    entity: 'room',
    entityId: roomId,
    meta: { room: room.number, guest: name },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const, code }
}

/**
 * The desk has taken the money. Close the bill.
 *
 * Separate from checkout because guests settle mid-stay too, and because a
 * checkout that silently wrote off an unpaid balance would be a bug the hotel
 * only noticed at month end.
 */
export async function settleBill(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  const settled = await settleRoom(roomId, staff.name)
  if (settled === 0) return { ok: false as const, error: 'There is nothing outstanding on this room.' }

  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'folio.settled',
    entity: 'room',
    entityId: roomId,
    meta: { room: room.number, amount_paise: settled },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const, settled }
}

export async function checkOut(roomId: string, settleOutstanding = false) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  // Checking out over an unpaid balance is how a hotel loses money quietly.
  // Refuse, say the number, and let the desk decide.
  const outstanding = await roomFolioTotal(roomId)
  if (outstanding > 0 && !settleOutstanding) {
    return { ok: false as const, error: 'outstanding', outstanding }
  }
  if (outstanding > 0) await settleRoom(roomId, staff.name)

  // Clearing checked_in_at is what invalidates the guest's device: their cookie
  // is signed against that timestamp, so it stops matching the moment they go.
  await sql`
    update rooms
       set occupied = false, guest_name = null, checked_in_at = null, checkout_at = null,
           access_code = null, code_set_at = null, code_attempts = 0, code_locked_until = null,
           settle_requested_at = null
     where id = ${roomId}`
  await sql`
    update requests set status = 'cancelled', cancel_reason = 'Guest checked out', completed_at = now()
     where room_id = ${roomId} and status in ('new','ack','in_progress')`

  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.checked_out',
    entity: 'room',
    entityId: roomId,
    meta: outstanding > 0 ? { room: room.number, settled_paise: outstanding } : { room: room.number },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const }
}

/** A new code for the same stay — for a guest who lost the welcome card. */
export async function newAccessCode(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  const [occupied] = await sql<{ occupied: boolean }[]>`select occupied from rooms where id = ${roomId}`
  if (!occupied?.occupied) return { ok: false as const, error: 'Check the guest in first.' }

  const code = generateAccessCode()
  await sql`
    update rooms
       set access_code = ${code}, code_set_at = now(), code_attempts = 0, code_locked_until = null
     where id = ${roomId}`

  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.code_reissued',
    entity: 'room',
    entityId: roomId,
    meta: { room: room.number },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const, code }
}

/** Clears a lockout after too many wrong codes, without changing the code. */
export async function unlockRoomCode(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  await sql`update rooms set code_attempts = 0, code_locked_until = null where id = ${roomId}`
  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.code_unlocked',
    entity: 'room',
    entityId: roomId,
    meta: { room: room.number },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const }
}

/**
 * Reissues the QR itself. Rarely needed now that the card is permanent — only
 * for one that has been damaged, or photographed by someone who should not have
 * it. The printed card MUST be replaced afterwards; the old one stops working.
 */
export async function rotateToken(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false as const, error: 'Not your room.' }

  await sql`update rooms set token = ${newToken()} where id = ${roomId}`
  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.token_rotated',
    entity: 'room',
    entityId: roomId,
    meta: { room: room.number },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const }
}

export async function addRoom(propertyId: string, number: string, floor: string, roomType: string) {
  const staff = await requireManager()
  const [prop] = await sql<{ id: string; organisation_id: string | null }[]>`
    select id, organisation_id from properties where id = ${propertyId}`
  if (!prop || !canTouchProperty(staff, prop)) return { ok: false as const, error: 'Not your property.' }

  const num = number.trim().slice(0, 16)
  if (!num) return { ok: false as const, error: 'Enter a room number.' }

  const existing = await sql`select 1 from rooms where property_id = ${propertyId} and number = ${num}`
  if (existing.length > 0) return { ok: false as const, error: `Room ${num} already exists.` }

  await sql`
    insert into rooms (property_id, number, floor, room_type, token)
    values (${propertyId}, ${num}, ${floor.trim().slice(0, 16) || null},
            ${roomType.trim().slice(0, 40) || null}, ${newToken()})`

  await audit({
    propertyId,
    staffId: staff.id,
    actor: staff.name,
    action: 'room.created',
    entity: 'room',
    meta: { room: num },
  })
  revalidatePath('/staff/rooms')
  return { ok: true as const }
}
