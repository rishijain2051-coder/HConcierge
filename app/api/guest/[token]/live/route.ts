import { cookies } from 'next/headers'
import { loadGuestState, readRoom } from '@/lib/guest'
import { accessFor, GUEST_COOKIE } from '@/lib/guest-session'
import { onRoomChange, realtimeReady } from '@/lib/realtime'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
// Streams close themselves well before this; it is the ceiling, not the plan.
export const maxDuration = 300

/**
 * The guest screen's live channel. Their order moves here the moment the
 * kitchen touches it — no polling, no refresh.
 *
 * The grant is re-checked on every push against a freshly read room, not once
 * at open. A stream can outlive a checkout, and the next guest in that room
 * must not be watched by the last one's phone.
 *
 * 503 rather than an empty stream when the listener is down, so the client
 * knows to fall back to its slow poll instead of waiting for events that will
 * never arrive.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/guest/[token]/live'>) {
  const { token } = await ctx.params
  const room = await readRoom(token)
  if (!room) return Response.json({ error: 'unknown room' }, { status: 404 })

  // The token identifies the room; it does not authorise reading the stay.
  const grant = (await cookies()).get(GUEST_COOKIE)?.value
  if (!accessFor(grant, room.room)) return Response.json({ error: 'locked' }, { status: 401 })

  if (!(await realtimeReady())) {
    return Response.json({ error: 'no listener' }, { status: 503 })
  }

  const roomId = room.room.id
  return sseStream({
    signal: req.signal,
    subscribe: (fire) => onRoomChange(roomId, fire),
    load: async () => {
      const now = await readRoom(token)
      if (!now || !accessFor(grant, now.room)) return null
      return loadGuestState(now.room.id)
    },
  })
}
