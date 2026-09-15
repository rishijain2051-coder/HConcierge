/**
 * Self-check for the WhatsApp job-list token. Run it:
 *
 *   SESSION_SECRET=test node lib/staff-link.check.ts
 *
 * No framework on purpose — this is one file of asserts guarding a signing path,
 * and the thing that must never silently regress is a forged or expired token
 * being accepted. Node strips the types itself.
 */
import assert from 'node:assert/strict'
import { readStaffLink, signStaffLink, staffLinkUrl } from './staff-link.ts'

process.env.SESSION_SECRET ||= 'check-only-secret'

const ID = '550e8400-e29b-41d4-a716-446655440000'

// --- round trip -----------------------------------------------------------
const token = signStaffLink(ID)
assert.equal(token.length, 42, `token should be 42 chars, got ${token.length}`)
assert.equal(readStaffLink(token)?.staffId, ID, 'round trip must return the same staff id')

// --- forgery --------------------------------------------------------------
// Flip one bit of the MAC. Anything other than null here means the truncated
// MAC is not actually being checked.
const bad = Buffer.from(token, 'base64url')
bad[bad.length - 1] ^= 0x01
assert.equal(readStaffLink(bad.toString('base64url')), null, 'a tampered MAC must be rejected')

// Flip one bit of the staff id, leaving the MAC alone.
const swapped = Buffer.from(token, 'base64url')
swapped[3] ^= 0x01
assert.equal(readStaffLink(swapped.toString('base64url')), null, 'a tampered payload must be rejected')

// --- malformed input must return null, never throw ------------------------
// Anyone can edit the URL, and an uncaught throw here is a 500 on a public route.
for (const junk of ['', 'x', 'not-base64!!', 'a'.repeat(200), token.slice(0, 20), token + 'AA']) {
  assert.equal(readStaffLink(junk), null, `junk token must be rejected: ${junk.slice(0, 12)}`)
}

// --- expiry ---------------------------------------------------------------
assert.equal(readStaffLink(signStaffLink(ID, -1)), null, 'an expired token must be rejected')
const soon = readStaffLink(signStaffLink(ID, 1))
assert.ok(soon && soon.expiresAt > new Date(), 'a live token must report a future expiry')

// --- the wrong token family ----------------------------------------------
// A guest grant is signed with the same secret. Change the version byte and the
// MAC with it, so the token is genuinely well-signed but of another family: it
// must still be refused, because that is the check the version byte exists for.
const { createHmac } = await import('node:crypto')
const body = Buffer.from(signStaffLink(ID), 'base64url').subarray(0, 21)
body.writeUInt8(2, 0)
const reMac = createHmac('sha256', process.env.SESSION_SECRET).update(body).digest().subarray(0, 10)
assert.equal(
  readStaffLink(Buffer.concat([body, reMac]).toString('base64url')),
  null,
  'a validly-signed token of another version must be rejected',
)

// --- url shape ------------------------------------------------------------
assert.equal(staffLinkUrl('https://h.app', 'T'), 'https://h.app/w/T')
assert.equal(staffLinkUrl('https://h.app', 'T', '1341'), 'https://h.app/w/T?r=1341')

console.log('staff-link: all checks passed')
