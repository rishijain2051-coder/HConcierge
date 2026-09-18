/**
 * Two small ceilings on the guest endpoints, in process, no dependency.
 *
 * **Known limitation, and it is the important part of this file.** These maps
 * live in one server instance's memory, and the hosting scales instances
 * horizontally — so this blunts one source hammering one instance and nothing
 * more. A distributed flood needs Vercel's firewall rules or something upstream
 * of the application, and no amount of code in this repo substitutes for that.
 * The same caveat, for the same reason, is on the escalation sweep throttle in
 * app/api/staff/board/route.ts.
 *
 * What it does buy, which is not nothing: `/live` and `/state` both resolve the
 * room from the database *before* they can check the guest's cookie, because
 * the cookie is scoped to a room they do not know yet. That makes an
 * unauthenticated request cost a query and a pooled connection, and the pool is
 * the scarce resource here — far scarcer than CPU. A cheap reject in front of
 * it keeps a flood of invented tokens away from Postgres entirely.
 */

type Bucket = { tokens: number; at: number }

const buckets = new Map<string, Bucket>()
const streams = new Map<string, number>()

/** Neither map may grow without bound; a flood would otherwise be the leak. */
const MAX_KEYS = 20_000

/**
 * A token bucket. `perMinute` refills steadily, `burst` is the ceiling, so a
 * guest reloading their screen a few times in a row is never refused while a
 * script is.
 */
export function allow(key: string, perMinute: number, burst = perMinute): boolean {
  const now = Date.now()
  const b = buckets.get(key)

  if (!b) {
    // Cheapest possible eviction: when it is full, drop it. A guest who loses
    // their bucket gets a fresh one, which is the generous direction to fail.
    if (buckets.size >= MAX_KEYS) buckets.clear()
    buckets.set(key, { tokens: burst - 1, at: now })
    return true
  }

  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60_000) * perMinute)
  b.at = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

/**
 * Claim a slot for one open stream, or refuse. Returns the release function —
 * so the only way to take a slot is to be handed the way to give it back.
 */
export function openStream(roomId: string, max: number): (() => void) | null {
  const open = streams.get(roomId) ?? 0
  if (open >= max) return null
  if (open === 0 && streams.size >= MAX_KEYS) streams.clear()
  streams.set(roomId, open + 1)

  let released = false
  return () => {
    // Idempotent: `shutdown` is reachable from four paths (client hang-up, the
    // stream's own lifetime, a revoked grant, the abort signal) and more than
    // one of them can fire for a single stream.
    if (released) return
    released = true
    const n = (streams.get(roomId) ?? 1) - 1
    if (n <= 0) streams.delete(roomId)
    else streams.set(roomId, n)
  }
}

/**
 * Who to count against. `x-forwarded-for` is a list when proxies chain, and the
 * left-most entry is the client — the rest are the proxies, which is why the
 * whole header cannot be the key.
 *
 * A spoofed header is not a concern behind Vercel, which overwrites it. Behind
 * an untrusted proxy it would be, and the answer there is the proxy's own rate
 * limiting rather than trusting a header we cannot verify.
 */
export function clientKey(req: Request): string {
  return clientKeyFrom(req.headers)
}

/**
 * The same key from a bare header bag, for server actions.
 *
 * A server action has no Request to read - it has `headers()` from
 * next/headers - and the guest's code gate is an action. Sharing this is what
 * stops a second, subtly different idea of "who is this" appearing there.
 */
export function clientKeyFrom(h: Headers): string {
  const fwd = h.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'unknown'
}

/** Shared so the two guest routes cannot drift apart. */
export const GUEST_LIMIT = { perMinute: 40, burst: 60 }

/**
 * The 4-digit code, which is the one endpoint in the app worth guessing at.
 *
 * The per-room lockout in lib/guest-session.ts is the real defence - five
 * wrong codes and that room is shut for fifteen minutes - and it caps one room
 * at about 480 guesses a day against 10,000 combinations. What it does not cap
 * is the cost: every guess is a round trip and an `update rooms`, so a script
 * walking a list of tokens spends the connection pool rather than breaking in.
 * Ten a minute is more than a guest mistyping twice ever needs.
 */
export const CODE_LIMIT = { perMinute: 10, burst: 15 }
export const MAX_STREAMS_PER_ROOM = 3

export function tooMany(retryAfterSeconds = 30): Response {
  return Response.json(
    { error: 'too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' } },
  )
}
