import { sql } from './db'
import { sendMessage } from './notify'
import { ENQUIRY_WHATSAPP } from './site'

/**
 * Somebody on the public site asking about the product.
 *
 * This is the only unauthenticated write in the application that is not behind
 * a room token, so it is treated as a trust boundary in the same way
 * lib/requests.ts is: every field is bounded here, the row is written before
 * anything is sent, and the caller supplies a rate-limit key it cannot forge.
 *
 * The order matters. WhatsApp reaches a gateway running on a laptop (see
 * lib/notify.ts), so it can simply be down - and an enquiry that is lost
 * because a lid was closed is the most expensive bug this file could have.
 * The database is the record; the message is a courtesy on top of it, sent
 * after the commit and stamped only if it worked.
 */

export type EnquiryInput = {
  name: string
  hotel: string
  rooms: string
  contact: string
  message: string
}

export type EnquiryResult = { ok: true } | { ok: false; error: string }

const MAX = { name: 120, hotel: 160, contact: 160, message: 1200 }

/** An email or a phone number, loosely - enough to reject a blank or a word. */
function usableContact(value: string): boolean {
  if (value.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
  return value.replace(/\D/g, '').length >= 10
}

export async function createEnquiry(input: EnquiryInput): Promise<EnquiryResult> {
  const name = input.name.trim().slice(0, MAX.name)
  const hotel = input.hotel.trim().slice(0, MAX.hotel)
  const contact = input.contact.trim().slice(0, MAX.contact)
  const message = input.message.trim().slice(0, MAX.message)

  if (!name) return { ok: false, error: 'Please tell us your name.' }
  if (!hotel) return { ok: false, error: 'Please tell us which hotel this is for.' }
  if (!contact) return { ok: false, error: 'Please leave an email or a phone number.' }
  if (!usableContact(contact)) {
    return { ok: false, error: 'That does not look like an email address or a phone number we could reach.' }
  }

  // A blank or a word is not a room count. Anything outside this is a typo or
  // a probe, and either way it should not reach the column.
  const parsed = Number(input.rooms)
  const rooms = Number.isFinite(parsed) && parsed >= 1 && parsed <= 10_000 ? Math.floor(parsed) : null

  // An email in the contact field goes to `email`, a number to `phone`. One
  // box on the form, because asking for both is a field most people skip.
  const isEmail = contact.includes('@')

  const [row] = await sql<{ id: string }[]>`
    insert into enquiries (name, hotel, rooms, email, phone, message)
    values (${name}, ${hotel}, ${rooms}, ${isEmail ? contact : null},
            ${isEmail ? null : contact}, ${message || null})
    returning id`

  const body = [
    `New HConcierge enquiry`,
    ``,
    `${name} - ${hotel}`,
    rooms ? `${rooms} rooms` : null,
    contact,
    message ? `\n"${message}"` : null,
  ]
    .filter((l) => l !== null)
    .join('\n')

  if (await sendMessage(ENQUIRY_WHATSAPP, body)) {
    await sql`update enquiries set notified_at = now() where id = ${row.id}`
  }

  return { ok: true }
}
