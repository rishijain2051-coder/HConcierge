import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { readStaffLink, signStaffLink, staffLinkUrl } from './staff-link.ts'

/**
 * The WhatsApp job-link token. Run it:
 *
 *   node lib/staff-link.check.mjs
 *
 * Standalone on purpose — no runner, no framework, nothing to install, and
 * nothing in tsconfig has to know it exists. What must never silently regress
 * is a forged or expired token being accepted: the token is the only thing
 * standing between a chat log and somebody's job list. Every case below is a
 * negative one except the first.
 */

/** Minimal stand-in for a test runner: name it, run it, say so if it throws. */
function check(name, fn) {
  fn()
  console.log(`  ok  ${name}`)
}

process.env.SESSION_SECRET ||= 'test-only-secret'

const ID = '550e8400-e29b-41d4-a716-446655440000'

check('a token round-trips, and stays short enough to read in a message', () => {
  const token = signStaffLink(ID)
  assert.equal(token.length, 42, 'a longer token wraps over several lines in WhatsApp')
  assert.equal(readStaffLink(token)?.staffId, ID)
})

check('a tampered MAC is refused', () => {
  const raw = Buffer.from(signStaffLink(ID), 'base64url')
  raw[raw.length - 1] ^= 0x01
  assert.equal(readStaffLink(raw.toString('base64url')), null)
})

check('a tampered payload is refused', () => {
  const raw = Buffer.from(signStaffLink(ID), 'base64url')
  raw[3] ^= 0x01
  assert.equal(readStaffLink(raw.toString('base64url')), null)
})

check('junk in the URL returns null rather than throwing', () => {
  // Anyone can edit the address bar, and an uncaught throw here is a 500 on a
  // public route — timingSafeEqual throws outright on a length mismatch.
  const token = signStaffLink(ID)
  for (const junk of ['', 'x', 'not-base64!!', 'a'.repeat(200), token.slice(0, 20), token + 'AA']) {
    assert.equal(readStaffLink(junk), null, `junk: ${junk.slice(0, 12)}`)
  }
})

check('an expired token is refused, a live one reports its expiry', () => {
  assert.equal(readStaffLink(signStaffLink(ID, -1)), null)
  const live = readStaffLink(signStaffLink(ID, 1))
  assert.ok(live && live.expiresAt > new Date())
})

check('a validly-signed token of another family is refused', () => {
  // A guest grant is signed with the same secret. Re-sign a payload with a
  // different version byte so it is genuinely well-signed but not ours: this is
  // the whole reason the version byte exists.
  const body = Buffer.from(signStaffLink(ID), 'base64url').subarray(0, 21)
  body.writeUInt8(2, 0)
  const mac = createHmac('sha256', process.env.SESSION_SECRET).update(body).digest().subarray(0, 10)
  assert.equal(readStaffLink(Buffer.concat([body, mac]).toString('base64url')), null)
})

check('the highlight param is appended only when there is one', () => {
  assert.equal(staffLinkUrl('https://h.app', 'T'), 'https://h.app/w/T')
  assert.equal(staffLinkUrl('https://h.app', 'T', '1341'), 'https://h.app/w/T?r=1341')
})

console.log('staff-link: all checks passed')
