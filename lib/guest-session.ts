import { cookies } from 'next/headers'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { sql } from './db'
import { audit } from './audit'
import type { Room } from './types'

/**
 * Guest access is two factors, neither of which is a password:
 *
 *   1. The room's QR token. Permanent, printed once, physically in the room.
 *      It identifies the room; it is not a secret worth defending on its own.
 *   2. A 4-digit code, issued by the front desk for one stay.
 *
 * Four digits is 10,000 combinations, which is only defensible because it sits
 * behind the token and behind a lockout. On its own it would be trivial.
 *
 * The granted cookie is bound to the room AND to that stay's check-in
 * timestamp, so checking the guest out invalidates every device they used
 * without anything having to be revoked.
 */

const COOKIE = 'hc_guest'
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15
const SESSION_DAYS = 30

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set')
  return s
}

type Grant = { rid: string; cin: string; exp: number }

function sign(g: Grant): string {
  const body = Buffer.from(JSON.stringify(g)).toString('base64url')
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`
}

function read(token: string): Grant | null {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const g = JSON.parse(Buffer.from(body, 'base64url').toString()) as Grant
    return g.exp > Date.now() ? g : null
  } catch {
    return null
  }
}

/** A stay's fingerprint. Changes on check-in and on check-out. */
const stayOf = (room: Pick<Room, 'checked_in_at'>) =>
  room.checked_in_at ? new Date(room.checked_in_at).toISOString() : ''

export async function hasGuestAccess(room: Room): Promise<boolean> {
  // An unoccupied room has no stay to be part of.
  if (!room.occupied || !room.checked_in_at) return false
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return false
  const grant = read(raw)
  return Boolean(grant && grant.rid === room.id && grant.cin === stayOf(room))
}

async function grant(room: Room): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, sign({ rid: room.id, cin: stayOf(room), exp: Date.now() + SESSION_DAYS * 86400_000 }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  })
}

export type CodeResult =
  | { ok: true }
  | { ok: false; error: string; attemptsLeft?: number; lockedMinutes?: number }

export async function submitRoomCode(room: Room, code: string): Promise<CodeResult> {
  const entered = code.replace(/\D/g, '')
  if (entered.length !== 4) return { ok: false, error: 'Enter the four digits from your welcome card.' }

  const [row] = await sql<
    { access_code: string | null; code_attempts: number; code_locked_until: Date | null }[]
  >`select access_code, code_attempts, code_locked_until from rooms where id = ${room.id}`

  if (!row?.access_code) {
    return { ok: false, error: 'This room has no code yet. Please ask the front desk.' }
  }
  if (row.code_locked_until && row.code_locked_until > new Date()) {
    const mins = Math.ceil((row.code_locked_until.getTime() - Date.now()) / 60000)
    return { ok: false, error: 'Too many attempts. The front desk can let you straight in.', lockedMinutes: mins }
  }

  // Constant-time, so the response cannot be used to narrow the code digit by digit.
  const a = Buffer.from(entered)
  const b = Buffer.from(row.access_code)
  const match = a.length === b.length && timingSafeEqual(a, b)

  if (!match) {
    const [updated] = await sql<{ code_attempts: number }[]>`
      update rooms
         set code_attempts = code_attempts + 1,
             code_locked_until = case when code_attempts + 1 >= ${MAX_ATTEMPTS}
                                      then now() + (${LOCK_MINUTES} || ' minutes')::interval
                                      else code_locked_until end
       where id = ${room.id}
      returning code_attempts`

    const left = Math.max(0, MAX_ATTEMPTS - updated.code_attempts)
    if (left === 0) {
      await audit({
        propertyId: room.property_id,
        actor: `Room ${room.number}`,
        action: 'room.code_locked',
        entity: 'room',
        entityId: room.id,
      })
      return { ok: false, error: 'Too many attempts. Please ask the front desk.', lockedMinutes: LOCK_MINUTES }
    }
    return {
      ok: false,
      error: left === 1 ? 'That is not right. One more attempt before this locks.' : 'That code is not right.',
      attemptsLeft: left,
    }
  }

  await sql`update rooms set code_attempts = 0, code_locked_until = null where id = ${room.id}`
  await grant(room)
  await audit({
    propertyId: room.property_id,
    actor: `Room ${room.number}`,
    action: 'room.code_accepted',
    entity: 'room',
    entityId: room.id,
  })
  return { ok: true }
}

/** Front-desk side: issue a fresh code for a stay. */
export function generateAccessCode(): string {
  // Excludes the handful of codes a guest would assume were a placeholder.
  const banned = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321'])
  let code: string
  do {
    code = String(randomInt(0, 10_000)).padStart(4, '0')
  } while (banned.has(code))
  return code
}
