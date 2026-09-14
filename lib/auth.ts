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
  organisation_id: string | null
  property_id: string | null
  username: string
  name: string
  department: Department
  role: Role
  phone: string | null
  property_name?: string | null
  property_slug?: string | null
  organisation_name?: string | null
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
  store.delete(ORG_COOKIE)
}

/**
 * Which customer HConcierge is working inside right now.
 *
 * Unsigned on purpose: this can only ever narrow what a platform account
 * already sees, never widen it, and a value that is not a real organisation
 * simply matches nothing. It is ignored entirely for everyone else, whose
 * organisation comes from their own staff row.
 */
export const ORG_COOKIE = 'hc_org'

export async function enterOrganisation(id: string | null): Promise<void> {
  const store = await cookies()
  if (id) {
    store.set(ORG_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    })
  } else {
    store.delete(ORG_COOKIE)
  }
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

  const entered = (await cookies()).get(ORG_COOKIE)?.value
  const orgId = entered && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entered) ? entered : null

  const rows = await sql<Staff[]>`
    select s.id, coalesce(s.organisation_id, o.id) as organisation_id, s.property_id,
           s.username, s.name, s.department, s.role, s.phone,
           p.name as property_name, p.slug as property_slug, o.name as organisation_name
      from staff s
      left join properties p on p.id = s.property_id
      left join organisations o
        on o.id = coalesce(s.organisation_id,
                           case when s.role = 'platform' then ${orgId}::uuid end)
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

/** Organisation-level: properties, and creating other admins. */
export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role !== 'admin' && staff.role !== 'platform') redirect('/staff/board')
  if (staff.role === 'platform' && !staff.organisation_id) redirect('/staff/admin/organisations')
  return staff
}

/**
 * The panel screens that belong to one customer — staff, directory, escalation,
 * info, activity. HConcierge has to step into an organisation first, or these
 * would be a list of every customer's people and data at once.
 */
export async function requireInOrganisation(): Promise<Staff> {
  const staff = await requireManager()
  if (staff.role === 'platform' && !staff.organisation_id) redirect('/staff/admin/organisations')
  return staff
}

/**
 * Where a role lands after signing in.
 *
 * HConcierge runs the product, not anybody's front desk — it has no shift, no
 * board and no reason to be reading a hotel's live guest traffic.
 */
export function homeFor(staff: Pick<Staff, 'role'>): string {
  return staff.role === 'platform' ? '/staff/admin/organisations' : '/staff/board'
}

/**
 * The day-to-day screens: board, rooms, history. Platform accounts are sent to
 * the panel instead — a customer's live requests are their business.
 */
export async function requireOperational(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role === 'platform') redirect('/staff/admin/organisations')
  return staff
}

/** HConcierge itself. Above every organisation, and held by nobody else. */
export async function requirePlatform(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role !== 'platform') redirect('/staff/board')
  return staff
}

/** A readable one-time password that satisfies passwordProblem(). */
export function generatePassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz' // no l/o, they read as 1/0
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const pick = (set: string, n: number) =>
    Array.from(randomBytes(n)).map((b) => set[b % set.length]).join('')
  // Always one uppercase and two digits, so it can never fail the policy.
  return `${pick(upper, 1)}${pick(letters, 5)}${pick(digits, 2)}${pick(letters, 3)}${pick(digits, 1)}`
}

// ------------------------------------------------------------------ authorise

/** Which departments this person's board should show. Empty array = all. */
export function visibleDepartments(staff: Staff): string[] {
  if (staff.role === 'staff' && staff.department !== 'all') return [staff.department]
  return []
}

export function canTouchDepartment(staff: Staff, department: string): boolean {
  const visible = visibleDepartments(staff)
  return visible.length === 0 || visible.includes(department)
}

/**
 * Platform roams everything; an admin roams their own organisation; everyone
 * below is pinned to one property.
 *
 * This takes the property rather than just its id because an admin's reach is
 * decided by the PROPERTY's organisation, which the Staff object cannot know.
 * Call sites already select the row they are checking — widen that select with
 * a join on properties rather than making this do a second query per check.
 */
export function canTouchProperty(
  staff: Staff,
  property: { id: string; organisation_id: string | null },
): boolean {
  if (staff.role === 'platform' && !staff.organisation_id) return true
  if (staff.role === 'platform' || staff.role === 'admin') {
    return Boolean(staff.organisation_id) && property.organisation_id === staff.organisation_id
  }
  return staff.property_id === property.id
}

// --------------------------------------------------------------- login limits

export type LoginResult =
  | { ok: true; staff: { id: string; role: Role } }
  | { ok: false; error: string }

/**
 * Counting failures on the staff row rather than in memory means the lockout
 * survives a serverless cold start — an in-memory counter on Vercel resets
 * every few minutes and protects nobody.
 */
export async function attemptLogin(username: string, password: string): Promise<LoginResult> {
  const rows = await sql<
    { id: string; role: Role; password_hash: string; active: boolean; locked_until: Date | null }[]
  >`select id, role, password_hash, active, locked_until
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
  return { ok: true, staff: { id: row.id, role: row.role } }
}
