import { randomInt, timingSafeEqual } from 'node:crypto'
import { sql } from './db'
import { audit } from './audit'
import { sendMessage } from './notify'
import type { Staff } from './auth'

/**
 * Proving that a staff phone number really belongs to that staff member.
 *
 * A number used to be write-only: the app sent to it, and a wrong one meant a
 * missed message. WhatsApp job links change that — the link is the credential,
 * so one mistyped digit in Manage → Staff hands a stranger a working job list.
 *
 * The code is sent TO the phone and typed IN by someone already signed in. A
 * tap-to-confirm link would only prove that *somebody* received the message,
 * which is exactly the typo case it needs to catch. Requiring both proves
 * control of the account and of the handset in one step.
 *
 * Shape copied from submitRoomCode in lib/guest-session.ts, which has had these
 * edge cases beaten out of it already. See WHATSAPP-TESTING-PLAN.md §5.
 */

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15
const CODE_MINUTES = 10
/** A resend any sooner is a button for spraying someone else's WhatsApp. */
const RESEND_SECONDS = 60

export type CodeResult = { ok: true } | { ok: false; error: string; attemptsLeft?: number }

/** Six digits, zero-padded, from a CSPRNG rather than Math.random. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Issue a code and WhatsApp it to the number on file.
 *
 * Deliberately says nothing that is useful to someone who received it by
 * mistake: no room, no guest, no link — just the property name so the person it
 * *was* meant for recognises it.
 */
export async function sendPhoneCode(staffId: string): Promise<CodeResult> {
  const [target] = await sql<
    { name: string; phone: string | null; phone_code_sent_at: Date | null; property_id: string | null; property: string | null }[]
  >`select s.name, s.phone, s.phone_code_sent_at, s.property_id, p.name as property
      from staff s left join properties p on p.id = s.property_id
     where s.id = ${staffId} and s.active`

  if (!target) return { ok: false, error: 'That account no longer exists.' }
  if (!target.phone?.trim()) return { ok: false, error: 'Add a phone number first.' }

  if (target.phone_code_sent_at) {
    const waited = (Date.now() - target.phone_code_sent_at.getTime()) / 1000
    if (waited < RESEND_SECONDS) {
      return { ok: false, error: `A code was just sent. Try again in ${Math.ceil(RESEND_SECONDS - waited)}s.` }
    }
  }

  const code = generateCode()
  await sql`
    update staff
       set phone_code = ${code},
           phone_code_expires = now() + (${CODE_MINUTES} || ' minutes')::interval,
           phone_code_sent_at = now(),
           phone_code_attempts = 0,
           phone_code_locked_until = null
     where id = ${staffId}`

  const sent = await sendMessage(
    target.phone,
    `HConcierge: ${code} is your code to receive job alerts on this number` +
      `${target.property ? ` for ${target.property}` : ''}. It expires in ${CODE_MINUTES} minutes. ` +
      `If you were not expecting this, ignore it.`,
  )
  if (!sent) return { ok: false, error: 'Could not send the code. Check the number and the gateway.' }

  await audit({
    propertyId: target.property_id,
    staffId,
    actor: 'system',
    action: 'staff.phone_code_sent',
    entity: 'staff',
    entityId: staffId,
  })
  return { ok: true }
}

/**
 * The signed-in staff member types the code they received.
 *
 * Reads and clears an expired lock in the same statement. Without that the
 * count stays at the maximum, the next typo re-locks for another fifteen
 * minutes, and the person can never get verified at all.
 */
export async function submitPhoneCode(staff: Staff, code: string): Promise<CodeResult> {
  const entered = code.replace(/\D/g, '')
  if (entered.length !== 6) return { ok: false, error: 'Enter the six digits from the message.' }

  const [row] = await sql<
    { phone_code: string | null; phone_code_expires: Date | null; phone_code_attempts: number; phone_code_locked_until: Date | null }[]
  >`update staff
       set phone_code_attempts     = case when phone_code_locked_until <= now() then 0 else phone_code_attempts end,
           phone_code_locked_until = case when phone_code_locked_until <= now() then null else phone_code_locked_until end
     where id = ${staff.id}
    returning phone_code, phone_code_expires, phone_code_attempts, phone_code_locked_until`

  if (!row?.phone_code) return { ok: false, error: 'No code is waiting. Ask for a new one.' }

  if (row.phone_code_locked_until && row.phone_code_locked_until > new Date()) {
    const mins = Math.ceil((row.phone_code_locked_until.getTime() - Date.now()) / 60000)
    return { ok: false, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }
  }
  if (row.phone_code_expires && row.phone_code_expires <= new Date()) {
    return { ok: false, error: 'That code has expired. Ask for a new one.' }
  }

  // Constant-time, so the response cannot be used to narrow the code digit by digit.
  const a = Buffer.from(entered)
  const b = Buffer.from(row.phone_code)
  if (!(a.length === b.length && timingSafeEqual(a, b))) {
    const [updated] = await sql<{ phone_code_attempts: number }[]>`
      update staff
         set phone_code_attempts = phone_code_attempts + 1,
             phone_code_locked_until = case when phone_code_attempts + 1 >= ${MAX_ATTEMPTS}
                                            then now() + (${LOCK_MINUTES} || ' minutes')::interval
                                            else phone_code_locked_until end
       where id = ${staff.id}
      returning phone_code_attempts`

    const left = Math.max(0, MAX_ATTEMPTS - updated.phone_code_attempts)
    if (left === 0) {
      await audit({
        propertyId: staff.property_id,
        staffId: staff.id,
        actor: staff.name,
        action: 'staff.phone_code_locked',
        entity: 'staff',
        entityId: staff.id,
      })
      return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' }
    }
    return {
      ok: false,
      error: left === 1 ? 'That is not right. One more attempt before this locks.' : 'That code is not right.',
      attemptsLeft: left,
    }
  }

  await sql`
    update staff
       set phone_verified_at = now(),
           phone_code = null,
           phone_code_expires = null,
           phone_code_attempts = 0,
           phone_code_locked_until = null
     where id = ${staff.id}`

  await audit({
    propertyId: staff.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'staff.phone_verified',
    entity: 'staff',
    entityId: staff.id,
  })
  return { ok: true }
}
