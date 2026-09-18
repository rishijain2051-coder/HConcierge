/**
 * Checks the push transport without sending a push.
 *
 *   npm run db:check-push
 *
 * Two halves. The first is pure crypto and needs nothing but this process: it
 * takes the Authorization header lib/push.ts would put on a real send, pulls
 * the JWT apart, and verifies the signature against the public key. That is the
 * one piece of this feature that cannot be eyeballed and fails in a way nobody
 * can read — a push service answers a malformed VAPID token with a bare 401,
 * and the single most likely cause is the signature being in node's default
 * ASN.1 form rather than the flat 64-byte one JOSE asks for. So it is measured
 * here rather than discovered against Firebase.
 *
 * The second half round-trips a subscription through the database using a
 * plainly fake endpoint, and takes it back in `finally`.
 *
 * Nothing is sent. No push service is contacted.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { createPublicKey, verify as verifyWith } from 'node:crypto'

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      const from = dirname(fileURLToPath(ctx.parentURL))
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        const guess = resolvePath(from, spec + ext)
        if (existsSync(guess)) return { url: pathToFileURL(guess).href, shortCircuit: true }
      }
    }
    if (/^next\/[a-z-]+$/.test(spec)) {
      try {
        return next(spec + '.js', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

const lib = new URL('../lib/', import.meta.url)
const { sql } = await import(new URL('db.ts', lib).href)
const { authorization, pushConfigured, pushPublicKey, saveSubscription, dropSubscription, subscriptionCount } =
  await import(new URL('push.ts', lib).href)

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  - ' + detail : ''}`)
  if (!ok) failures++
}

/** An endpoint shaped like Firebase's, pointed at nothing. Never contacted. */
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/hconcierge-check-not-a-real-subscription'

let lent = null

try {
  console.log(
    process.env.VAPID_PUBLIC_KEY
      ? 'using VAPID keys from the environment\n'
      : 'no VAPID keys in the environment - checking the throwaway pair this process generated\n',
  )

  check('push reports itself configured', pushConfigured() === true)

  const pub = pushPublicKey()
  const raw = Buffer.from(pub ?? '', 'base64url')
  check('the public key is an uncompressed P-256 point', raw.length === 65 && raw[0] === 0x04, `${raw.length} bytes`)

  /* ---- the VAPID header ------------------------------------------------ */
  const header = authorization(ENDPOINT)
  check('the header is a vapid scheme with t= and k=', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(header))

  const token = header.slice('vapid t='.length, header.indexOf(', k='))
  const k = header.slice(header.indexOf(', k=') + 4)
  check('k= is the public key the browser subscribed with', k === pub)

  const [h64, c64, s64] = token.split('.')
  const head = JSON.parse(Buffer.from(h64, 'base64url').toString())
  const claims = JSON.parse(Buffer.from(c64, 'base64url').toString())
  const sig = Buffer.from(s64, 'base64url')

  check('it declares ES256', head.alg === 'ES256' && head.typ === 'JWT', JSON.stringify(head))
  check(
    'the signature is a flat 64 bytes, not DER',
    sig.length === 64,
    sig.length === 64 ? 'r||s' : `${sig.length} bytes - dsaEncoding is wrong and every send will 401`,
  )
  check('aud is the push service, not us', claims.aud === 'https://fcm.googleapis.com', claims.aud)
  check('sub is a mailto or https contact', /^(mailto:|https:\/\/)/.test(claims.sub ?? ''), claims.sub)
  const life = claims.exp - Math.floor(Date.now() / 1000)
  check('exp is in the future and inside the 24h ceiling', life > 0 && life <= 86400, `${Math.round(life / 3600)}h`)

  /* The whole point of the exercise: does the signature actually verify. */
  const key = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
    format: 'jwk',
  })
  check(
    'the signature verifies against the public key',
    verifyWith('sha256', Buffer.from(`${h64}.${c64}`), { key, dsaEncoding: 'ieee-p1363' }, sig) === true,
  )
  check(
    'and a tampered token does not',
    verifyWith('sha256', Buffer.from(`${h64}.${c64}x`), { key, dsaEncoding: 'ieee-p1363' }, sig) === false,
  )

  /* ---- the subscription round trip ------------------------------------- */
  const [who] = await sql`
    select id, name from staff where active and role in ('manager', 'staff') order by name limit 1`
  if (!who) {
    console.log('\nno active staff - skipping the database half')
  } else {
    const before = await subscriptionCount(who.id)
    await saveSubscription(who.id, { endpoint: ENDPOINT, p256dh: 'check-p256dh', auth: 'check-auth' })
    lent = { staffId: who.id }
    check(`a subscription saves for ${who.name}`, (await subscriptionCount(who.id)) === before + 1)

    await saveSubscription(who.id, { endpoint: ENDPOINT, p256dh: 'check-p256dh-2', auth: 'check-auth-2' })
    check(
      'saving the same endpoint twice moves the row rather than doubling it',
      (await subscriptionCount(who.id)) === before + 1,
      'a shared handset changing hands must not notify yesterday',
    )

    await dropSubscription(who.id, ENDPOINT)
    lent = null
    check('and unsubscribing takes it away', (await subscriptionCount(who.id)) === before)
  }

  /* ---- who a new request would wake ------------------------------------ */
  const teams = await sql`
    select p.name as property, s.department, count(*)::int as staff,
           count(ps.id)::int as devices
      from staff s
      join properties p on p.id = s.property_id
      left join push_subscriptions ps on ps.staff_id = s.id
     where s.active
     group by p.name, s.department
     order by p.name, s.department`
  console.log('\nwho is subscribed, by team:')
  for (const t of teams) {
    console.log(`  ${t.property} / ${t.department}: ${t.devices} device(s) across ${t.staff} staff`)
  }
  if (teams.every((t) => t.devices === 0)) {
    console.log('  (nobody yet - press "Wake this device" on the board to subscribe one)')
  }
} catch (err) {
  console.log('threw: ' + (err?.stack ?? err))
  failures++
} finally {
  if (lent) {
    const gone = await sql`delete from push_subscriptions where endpoint = ${ENDPOINT} returning id`
    console.log(`\ntook back ${gone.length} subscription(s) this check had written`)
  }
  await sql.end()
}

console.log('')
console.log(failures === 0 ? 'all checks pass' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
