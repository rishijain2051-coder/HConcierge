import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The token behind a staff member's WhatsApp job-list link.
 *
 * Same construction as the guest grant in lib/guest-session.ts — an HMAC over a
 * payload carrying its own expiry — but packed as bytes rather than JSON,
 * because this one has to survive being read off a phone screen inside a
 * WhatsApp message. The JSON form of the same three facts is ~170 characters and
 * wraps over three lines; this is 42.
 *
 *   byte  0       version, which doubles as the type tag
 *   bytes 1..16   staff id, the uuid's 16 raw bytes
 *   bytes 17..20  expiry, unix seconds, big-endian
 *   bytes 21..30  HMAC-SHA256 over the above, truncated to 80 bits
 *
 * The version byte is load-bearing. A guest grant is signed with the same key,
 * and without an explicit type the two families verify against each other and
 * safety rests on which fields happen to be undefined.
 *
 * Truncating the MAC is deliberate: 80 bits can only be attacked online against
 * /w/, and the alternative is 29 more characters in every message to guard a
 * capability that expires within a shift.
 *
 * The token is only a pointer — it names a person, never a request. Authority is
 * re-read from the staff row on every render (app/w/[token]/page.tsx), so
 * deactivating someone or changing their number kills the link on the next tap
 * without any token state to revoke.
 */

/**
 * Every signed link in the product lives in this file, and that is deliberate
 * rather than tidy: the version byte is the type tag, all of them are signed
 * with the same key, and two families defined in two files would eventually
 * pick the same number and start verifying against each other. Adding a link
 * type means adding a constant here.
 *
 *   1  a staff member's job list  (/w/…)
 *   2  a guest's welcome card     (/c/…)
 */
const V_STAFF = 1
const V_CARD = 2
const MAC_BYTES = 10
const BODY_BYTES = 21
const TOKEN_BYTES = BODY_BYTES + MAC_BYTES

/** A shift, not a day. Long enough to be useful, short enough that a forwarded chat goes cold. */
const DEFAULT_HOURS = 12

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set')
  return s
}

function mac(body: Buffer): Buffer {
  return createHmac('sha256', secret()).update(body).digest().subarray(0, MAC_BYTES)
}

function sign(version: number, id: string, hours: number): string {
  if (!UUID.test(id)) throw new Error('a signed link needs a uuid')

  const body = Buffer.alloc(BODY_BYTES)
  body.writeUInt8(version, 0)
  Buffer.from(id.replace(/-/g, ''), 'hex').copy(body, 1)
  // Unix seconds, so the expiry costs 4 bytes rather than the 8 a millisecond
  // timestamp would. Good until 2106.
  body.writeUInt32BE(Math.floor(Date.now() / 1000) + hours * 3600, 17)

  return Buffer.concat([body, mac(body)]).toString('base64url')
}

function read(version: number, token: string): { id: string; expiresAt: Date } | null {
  let raw: Buffer
  try {
    raw = Buffer.from(token, 'base64url')
  } catch {
    return null
  }
  // Length first: timingSafeEqual throws on a mismatch, and a short token must
  // not become a 500 that anyone can trigger by editing the URL.
  if (raw.length !== TOKEN_BYTES) return null

  const body = raw.subarray(0, BODY_BYTES)
  const expected = mac(body)
  const given = raw.subarray(BODY_BYTES)
  if (!timingSafeEqual(given, expected)) return null

  // The type check, and the reason every family is defined in this one file.
  if (body.readUInt8(0) !== version) return null

  const exp = body.readUInt32BE(17) * 1000
  if (exp <= Date.now()) return null

  const hex = body.subarray(1, 17).toString('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return { id, expiresAt: new Date(exp) }
}

export function signStaffLink(staffId: string, hours = DEFAULT_HOURS): string {
  return sign(V_STAFF, staffId, hours)
}

/** The staff id this token names, or null — expired, forged, or the wrong token family. */
export function readStaffLink(token: string): { staffId: string; expiresAt: Date } | null {
  const r = read(V_STAFF, token)
  return r && { staffId: r.id, expiresAt: r.expiresAt }
}

/**
 * The link behind "send the welcome card by WhatsApp".
 *
 * Three days, not twelve hours: a guest may check in on Friday and want their
 * code again on Sunday, and the message stays in their chat history the whole
 * stay. The expiry is the backstop, not the control — `app/c/[token]` re-reads
 * the room on every open and refuses once the room is no longer occupied, so
 * checking out kills the link the moment it happens rather than three days
 * later. Same property the guest cookie has, for the same reason.
 */
export function signCardLink(roomId: string, hours = 72): string {
  return sign(V_CARD, roomId, hours)
}

export function readCardLink(token: string): { roomId: string; expiresAt: Date } | null {
  const r = read(V_CARD, token)
  return r && { roomId: r.id, expiresAt: r.expiresAt }
}

export function cardLinkUrl(base: string, token: string): string {
  return `${base}/c/${token}`
}

/**
 * `?r=` is a plain query param on purpose. It only chooses which row the page
 * highlights; the token is what grants authority, so this needs no signature and
 * a tampered value can at worst highlight nothing.
 */
export function staffLinkUrl(base: string, token: string, ref?: string): string {
  return `${base}/w/${token}${ref ? `?r=${ref}` : ''}`
}
