'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { audit } from '@/lib/audit'
import { canTouchProperty, requireManager, type Staff } from '@/lib/auth'

const newToken = () => randomBytes(8).toString('base64url')

async function roomFor(staff: Staff, roomId: string) {
  const [room] = await sql<{ id: string; property_id: string; number: string }[]>`
    select id, property_id, number from rooms where id = ${roomId}`
  if (!room || !canTouchProperty(staff, room.property_id)) return null
  return room
}

export async function checkIn(roomId: string, guestName: string, checkoutAt: string | null) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false, error: 'Not your room.' }

  const name = guestName.trim().slice(0, 120)
  if (!name) return { ok: false, error: 'Enter the guest name.' }

  // A fresh token on check-in means the previous guest's photo of the QR is
  // already dead, even if nobody remembered to check them out.
  await sql`
    update rooms
       set occupied = true, guest_name = ${name}, checked_in_at = now(),
           checkout_at = ${checkoutAt || null}, token = ${newToken()}
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
  return { ok: true }
}

export async function checkOut(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false, error: 'Not your room.' }

  await sql`
    update rooms
       set occupied = false, guest_name = null, checked_in_at = null,
           checkout_at = null, token = ${newToken()}
     where id = ${roomId}`
  // Open requests belong to a guest who has left.
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
    meta: { room: room.number },
  })
  revalidatePath('/staff/rooms')
  return { ok: true }
}

/** For a card that went missing, or a QR somebody photographed and shared. */
export async function rotateToken(roomId: string) {
  const staff = await requireManager()
  const room = await roomFor(staff, roomId)
  if (!room) return { ok: false, error: 'Not your room.' }

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
  return { ok: true }
}

export async function addRoom(propertyId: string, number: string, floor: string, roomType: string) {
  const staff = await requireManager()
  if (!canTouchProperty(staff, propertyId)) return { ok: false, error: 'Not your property.' }

  const num = number.trim().slice(0, 16)
  if (!num) return { ok: false, error: 'Enter a room number.' }

  const existing = await sql`select 1 from rooms where property_id = ${propertyId} and number = ${num}`
  if (existing.length > 0) return { ok: false, error: `Room ${num} already exists.` }

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
  return { ok: true }
}
