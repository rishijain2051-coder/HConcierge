import { cookies } from 'next/headers'
import { loadGuestState, readRoom } from '@/lib/guest'
import { accessFor, GUEST_COOKIE } from '@/lib/guest-session'
import { allow, clientKey, GUEST_LIMIT, MAX_STREAMS_PER_ROOM, openStream, tooMany } from '@/lib/limit'
import { onRoomChange, realtimeReady } from '@/lib/realtime'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
// Streams close themselves well before this; it is the ceiling, not the plan.
export const maxDuration = 300

/**
 * The guest screen's live channel. Their order moves here the moment the
 * kitchen touches it - no polling, no refresh.
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
  // Before `readRoom`, deliberately. The cookie cannot be checked until the
  // room is known, so an unauthenticated request already costs a query and a
  // pooled connection - and the pool is what runs out first. See lib/limit.ts
  // for what this does and does not defend against.
  if (!allow(clientKey(req), GUEST_LIMIT.perMinute, GUEST_LIMIT.burst)) return tooMany()

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

  // One phone, maybe a tablet. Nothing counted these before, and each one holds
  // a function for up to four minutes against a maxDuration of 300 - so a
  // single guest could pin an instance's concurrency on their own.
  const release = openStream(roomId, MAX_STREAMS_PER_ROOM)
  if (!release) return tooMany(10)

  return sseStream({
    signal: req.signal,
    onClose: release,
    subscribe: (fire) => onRoomChange(roomId, fire),
    load: async () => {
      const now = await readRoom(token)
      if (!now || !accessFor(grant, now.room)) return null
      return loadGuestState(now.room.id)
    },
  })
}
