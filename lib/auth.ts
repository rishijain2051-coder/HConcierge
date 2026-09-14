import { cookies } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { sql } from './db'
import type { Department, Role } from './types'
export { DEPARTMENTS, departmentLabel } from './types'
export type { Department, Role } from './types'

export type Staff = {
  id: string
  property_id: string | null
  username: string
  name: string
  department: Department
  role: Role
  phone: string | null
  must_change_password: boolean
  property_name?: string | null
  property_slug?: string | null
}

export const SESSION_COOKIE = 'hc_session'
const SESSION_HOURS = 12 // a shift, not a month
const LOCK_AFTER = 5
const LOCK_MINUTES = 15

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set — see .env.example')
  return s
}

// ------------------------------------------------------------------ passwords

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const expected = Buffer.from(key, 'hex')
  const actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const WEAK = new Set([
  'password12', 'password123', 'welcome123', 'hotel12345', 'qwerty1234',
  'admin12345', '1234567890', 'letmein123', 'iloveyou12', 'concierge1',
])

/** Returns a human-readable problem, or null if the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.'
  if (password.length > 200) return 'That is too long.'
  if (!/[a-zA-Z]/.test(password)) return 'Include at least one letter.'
  if (!/[0-9]/.test(password)) return 'Include at least one number.'
  if (WEAK.has(password.toLowerCase())) return 'That password is too common.'
  return null
}

// ------------------------------------------------------------------- sessions

type Payload = { sid: string; exp: number }

function signToken(p: Payload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  const mac = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function readToken(token: string): Payload | null {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload
    return p.exp > Date.now() ? p : null
  } catch {
    return null
  }
}

export async function startSession(staffId: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, signToken({ sid: staffId, exp: Date.now() + SESSION_HOURS * 3600_000 }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Reads the session and re-loads the staff row on every request, so
 * deactivating someone logs them out immediately instead of at cookie expiry.
 * `cache` keeps that to one query per request, not one per component.
 */
export const getStaff = cache(async (): Promise<Staff | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const payload = readToken(token)
  if (!payload) return null

  const rows = await sql<Staff[]>`
    select s.id, s.property_id, s.username, s.name, s.department, s.role, s.phone,
           s.must_change_password, p.name as property_name, p.slug as property_slug
      from staff s
      left join properties p on p.id = s.property_id
     where s.id = ${payload.sid} and s.active
     limit 1`
  return rows[0] ?? null
})

export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff()
  if (!staff) redirect('/staff/login')
  return staff
}

export async function requireManager(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role === 'staff') redirect('/staff/board')
  return staff
}

// ------------------------------------------------------------------ authorise

/** Which departments this person's board should show. Empty array = all. */
export function visibleDepartments(staff: Staff): string[] {
  if (staff.role === 'admin' || staff.role === 'manager' || staff.department === 'all') return []
  return [staff.department]
}

export function canTouchDepartment(staff: Staff, department: string): boolean {
  const visible = visibleDepartments(staff)
  return visible.length === 0 || visible.includes(department)
}

/** Admins roam; everyone else is pinned to their own property. */
export function canTouchProperty(staff: Staff, propertyId: string): boolean {
  return staff.role === 'admin' || staff.property_id === propertyId
}

// --------------------------------------------------------------- login limits

export type LoginResult =
  | { ok: true; staff: { id: string; must_change_password: boolean } }
  | { ok: false; error: string }

/**
 * Counting failures on the staff row rather than in memory means the lockout
 * survives a serverless cold start — an in-memory counter on Vercel resets
 * every few minutes and protects nobody.
 */
export async function attemptLogin(username: string, password: string): Promise<LoginResult> {
  const rows = await sql<
    { id: string; password_hash: string; active: boolean; locked_until: Date | null; must_change_password: boolean }[]
  >`select id, password_hash, active, locked_until, must_change_password
      from staff where lower(username) = lower(${username}) limit 1`

  const generic = { ok: false as const, error: 'Incorrect username or password.' }
  const row = rows[0]
  if (!row) {
    // Spend the same time as a real check so a missing username is not
    // distinguishable by response time.
    scryptSync(password, 'decoy', 64)
    return generic
  }
  if (!row.active) return generic
  if (row.locked_until && row.locked_until > new Date()) {
    const mins = Math.ceil((row.locked_until.getTime() - Date.now()) / 60000)
    return { ok: false, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }
  }

  if (!verifyPassword(password, row.password_hash)) {
    await sql`
      update staff
         set failed_logins = failed_logins + 1,
             locked_until = case when failed_logins + 1 >= ${LOCK_AFTER}
                                 then now() + (${LOCK_MINUTES} || ' minutes')::interval
                                 else locked_until end
       where id = ${row.id}`
    return generic
  }

  await sql`update staff set failed_logins = 0, locked_until = null, last_login_at = now() where id = ${row.id}`
  return { ok: true, staff: { id: row.id, must_change_password: row.must_change_password } }
}
