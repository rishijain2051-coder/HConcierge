import { createPrivateKey, generateKeyPairSync, sign as signWith } from 'node:crypto'
import { sql } from './db'

/**
 * Web Push, deliberately without a payload.
 *
 * A push message can carry its own encrypted body, and every library that does
 * this implements RFC 8291: an ECDH key agreement with the browser's keys, HKDF
 * to derive a content key, then AES128GCM. That is a lot of cryptography to
 * hand-roll and a whole dependency to avoid hand-rolling, and it buys something
 * this app does not want — a copy of what a guest asked for, sitting in a queue
 * on Google's or Mozilla's push service until the phone next comes online.
 *
 * So the push here is empty. It is a doorbell: the service worker wakes up,
 * fetches `/api/staff/push/pending` with the staff member's own session cookie,
 * and reads the current state of their board. Three things fall out of that.
 * Nothing about a guest leaves our servers. A notification that arrives late
 * shows what is true now rather than what was true when it was queued. And the
 * only cryptography left is the VAPID signature below, which is a plain ES256
 * JWT that `node:crypto` signs natively.
 *
 * What still has to be right is that signature, so `npm run db:check-push`
 * verifies one against the public key rather than trusting it.
 */

/**
 * A keypair for development, when the environment has none.
 *
 * Push then works with no setup step at all, which matters because the
 * alternative is a feature that is switched off on every machine until someone
 * reads a README. Subscriptions made against an ephemeral key die with the
 * process; that is the trade, and it is why production never does this. There,
 * an ephemeral key would invalidate every subscription on every deploy and the
 * only symptom would be notifications quietly stopping.
 *
 * Cached on globalThis rather than in a module constant: `next dev` reloads
 * modules, and a new keypair per reload would unsubscribe the browser tab that
 * is open in front of you.
 */
const store = globalThis as unknown as { __hcVapid?: { publicKey: string; privateKey: string } }

function devKeys(): { publicKey: string; privateKey: string } | null {
  if (process.env.NODE_ENV === 'production') return null
  if (!store.__hcVapid) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    store.__hcVapid = {
      // The uncompressed point (0x04 || X || Y), which is the form the browser
      // wants as applicationServerKey, not SPKI.
      publicKey: rawPoint(publicKey),
      privateKey: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url'),
    }
    console.warn('[push] no VAPID_PUBLIC_KEY set - using a throwaway keypair for this process')
  }
  return store.__hcVapid
}

/** A public EC key as the uncompressed point browsers expect. */
function rawPoint(key: import('node:crypto').KeyObject): string {
  const jwk = key.export({ format: 'jwk' }) as { x: string; y: string }
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('base64url')
}

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? devKeys()?.publicKey ?? ''
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? devKeys()?.privateKey ?? ''
/**
 * Who the push service should shout at if we start misbehaving. RFC 8292 wants
 * a mailto: or an https: URL; it is never shown to anybody being notified.
 */
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:ops@hconcierge.app'

/** Unset keys mean push is simply off, the same shape as the Twilio variables. */
export function pushConfigured(): boolean {
  return PUBLIC_KEY.length > 0 && PRIVATE_KEY.length > 0
}

/** The key a browser needs in order to subscribe at all. Public, by design. */
export function pushPublicKey(): string | null {
  return pushConfigured() ? PUBLIC_KEY : null
}

const b64url = (b: Buffer) => b.toString('base64url')

/**
 * The VAPID Authorization header for one push service.
 *
 * Exported so db/check-push.mjs can verify the signature against the public key
 * rather than take it on trust. Nothing else should call it.
 *
 * `aud` is the push service's origin and not our own — the token proves to
 * Firebase that the sender of this message is the same party that the browser
 * subscribed to, so it is scoped to whoever is being asked to deliver it.
 */
export function authorization(endpoint: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // Twelve hours. The spec's ceiling is twenty-four and a short life is
        // free here, because a token is minted per send.
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: SUBJECT,
      }),
    ),
  )
  const key = createPrivateKey({
    key: Buffer.from(PRIVATE_KEY, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  })
  // `dsaEncoding: 'ieee-p1363'` is the whole trick: JOSE wants the signature as
  // a bare 64-byte r||s and node defaults to the ASN.1 DER wrapper, which every
  // push service answers with a 401 that says nothing about why.
  const signature = signWith('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${PUBLIC_KEY}`
}

type Outcome = 'sent' | 'gone' | 'failed'

async function ring(endpoint: string): Promise<Outcome> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization(endpoint),
      // How long the push service should hold this if the device is offline.
      //
      // This was two minutes, on the reasoning that an hour-old request is not
      // news - which was wrong twice over. The push carries no payload, so a
      // late delivery fetches the board as it is at that moment and cannot be
      // stale; and the notification is tagged, so a backlog collapses into one
      // rather than arriving as a pile. Two minutes only meant that a desk PC
      // with its browser closed for five minutes was never told at all, which
      // is the exact case this feature exists for. Half an hour: long enough to
      // outlast a closed lid or a tunnel, short enough not to raise last
      // night's towel at breakfast.
      TTL: '1800',
      Urgency: 'high',
    },
    signal: AbortSignal.timeout(8_000),
  })
  // The browser has been uninstalled, cleared, or unsubscribed behind our back.
  // The spec says to stop sending, so the row goes.
  if (res.status === 404 || res.status === 410) return 'gone'
  if (!res.ok) {
    console.warn(`[push] ${new URL(endpoint).host} answered ${res.status}`)
    return 'failed'
  }
  return 'sent'
}

/**
 * Wake every device these people have subscribed, and forget the dead ones.
 *
 * Takes ids rather than the `Recipient` rows the WhatsApp side passes around,
 * because push has no use for a phone number — which is the point. A
 * housekeeper with no number on file, or one whose number was never verified,
 * is unreachable by message and perfectly reachable here.
 */
export async function pushToStaff(staffIds: string[]): Promise<number> {
  if (!pushConfigured() || staffIds.length === 0) return 0

  const subs = await sql<{ id: string; endpoint: string }[]>`
    select id, endpoint from push_subscriptions where staff_id = any(${staffIds})`
  if (subs.length === 0) return 0

  const sent: string[] = []
  const dead: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      let outcome: Outcome = 'failed'
      try {
        outcome = await ring(s.endpoint)
      } catch (err) {
        // A push service being unreachable must never take a request down with
        // it. This is called from `after()` and from the escalation sweep.
        console.warn('[push] send failed', err)
      }
      if (outcome === 'sent') sent.push(s.id)
      if (outcome === 'gone') dead.push(s.id)
    }),
  )

  if (dead.length > 0) await sql`delete from push_subscriptions where id = any(${dead})`
  if (sent.length > 0) {
    await sql`update push_subscriptions set last_push_at = now() where id = any(${sent})`
  }
  return sent.length
}

/**
 * Remember a browser.
 *
 * Keyed on the endpoint, not on the person: a shared housekeeping handset that
 * changes hands at the end of a shift subscribes again as its new holder, and
 * the row moves rather than doubling. Otherwise the morning shift keeps getting
 * woken by the evening's work.
 */
export async function saveSubscription(
  staffId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await sql`
    insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
    values (${staffId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
    on conflict (endpoint) do update
       set staff_id = ${staffId}, p256dh = ${sub.p256dh}, auth = ${sub.auth}`
}

export async function dropSubscription(staffId: string, endpoint: string): Promise<void> {
  await sql`delete from push_subscriptions where endpoint = ${endpoint} and staff_id = ${staffId}`
}

/** Whether this person has any device subscribed, for the toggle to read. */
export async function subscriptionCount(staffId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from push_subscriptions where staff_id = ${staffId}`
  return row?.n ?? 0
}
