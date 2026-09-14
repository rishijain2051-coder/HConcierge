import { loadGuestState, loadRoom } from '@/lib/guest'
import { hasGuestAccess } from '@/lib/guest-session'
import { onRoomChange, realtimeReady } from '@/lib/realtime'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
// Streams close themselves well before this; it is the ceiling, not the plan.
export const maxDuration = 300

/**
 * The guest screen's live channel. Their order moves here the moment the
 * kitchen touches it — no polling, no refresh.
 *
 * 503 rather than an empty stream when the listener is down, so the client
 * knows to fall back to its slow poll instead of waiting for events that will
 * never arrive.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/guest/[token]/live'>) {
  const { token } = await ctx.params
  const room = await loadRoom(token)
  if (!room) return Response.json({ error: 'unknown room' }, { status: 404 })
  // The token identifies the room; it does not authorise reading the stay.
  if (!(await hasGuestAccess(room.room))) return Response.json({ error: 'locked' }, { status: 401 })

  if (!(await realtimeReady())) {
    return Response.json({ error: 'no listener' }, { status: 503 })
  }

  const roomId = room.room.id
  return sseStream({
    signal: req.signal,
    subscribe: (fire) => onRoomChange(roomId, fire),
    load: () => loadGuestState(roomId),
  })
}
