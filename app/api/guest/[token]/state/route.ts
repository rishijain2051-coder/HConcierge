import { loadGuestState, loadRoom } from '@/lib/guest'
import { hasGuestAccess } from '@/lib/guest-session'

export const dynamic = 'force-dynamic'

/**
 * Polled by the guest screen every few seconds.
 *
 * ponytail: polling rather than SSE or websockets. A hotel produces a few
 * hundred requests a day, this query is two indexed reads, and polling is the
 * only option that survives serverless and pgbouncer without extra
 * infrastructure. Move to Supabase Realtime if a property ever gets busy
 * enough for this to show up in the database load.
 */
export async function GET(_req: Request, ctx: RouteContext<'/api/guest/[token]/state'>) {
  const { token } = await ctx.params
  const room = await loadRoom(token)
  if (!room) return Response.json({ error: 'unknown room' }, { status: 404 })
  // The token identifies the room; it does not authorise reading the stay.
  if (!(await hasGuestAccess(room.room))) return Response.json({ error: 'locked' }, { status: 401 })

  const state = await loadGuestState(room.room.id)
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
