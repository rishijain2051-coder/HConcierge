import { loadGuestState, loadRoom } from '@/lib/guest'
import { hasGuestAccess } from '@/lib/guest-session'
import { allow, clientKey, GUEST_LIMIT, tooMany } from '@/lib/limit'

export const dynamic = 'force-dynamic'

/**
 * The guest screen's fallback.
 *
 * Live updates come down /api/guest/[token]/live, which pushes. This is what
 * the phone falls back to when that stream cannot be held - hotel wifi, a
 * proxy that buffers, a listener that failed to start - and it is deliberately
 * slow: once a minute, and never while the screen is in a pocket.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/guest/[token]/state'>) {
  // Before `loadRoom`, for the reason given in lib/limit.ts: the cookie cannot
  // be checked until the room is known, so an unauthenticated request already
  // costs a query and a pooled connection.
  if (!allow(clientKey(req), GUEST_LIMIT.perMinute, GUEST_LIMIT.burst)) return tooMany()

  const { token } = await ctx.params
  const room = await loadRoom(token)
  if (!room) return Response.json({ error: 'unknown room' }, { status: 404 })
  // The token identifies the room; it does not authorise reading the stay.
  if (!(await hasGuestAccess(room.room))) return Response.json({ error: 'locked' }, { status: 401 })

  const state = await loadGuestState(room.room.id)
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
