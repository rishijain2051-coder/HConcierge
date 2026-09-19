import { staffFromLinkToken } from '@/lib/auth'
import { loadBoard } from '@/lib/board'
import { allow, clientKey, GUEST_LIMIT, openStream, tooMany } from '@/lib/limit'
import { onPropertyChange, realtimeReady } from '@/lib/realtime'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The live channel for the job list behind every WhatsApp message.
 *
 * Somebody opens that link, walks to the room, and comes back to a page that
 * was true when they tapped it - so a job a colleague finished in the meantime
 * still sat there offering an Accept button, and `done` is irreversible. This
 * is the same channel the board has, authorised by the signed link instead of
 * a session.
 *
 * The staff row is re-read on every push, exactly as the board's stream
 * re-reads its session: a stream lives for minutes, and deactivating someone
 * has to close the page they are already holding, not just the next one.
 *
 * What it sends is a signature rather than the jobs themselves. The page is a
 * server component and the client's only job is to ask for a fresh render, so
 * the payload only has to change when something worth re-rendering has -
 * `sseStream` drops a push identical to the last one, which is what keeps a
 * quiet shift quiet.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/w/[token]/live'>) {
  // Same shape of caller as the guest stream - a token holder with no session -
  // so the same ceiling. See lib/limit.ts for what this does and does not stop.
  if (!allow(clientKey(req), GUEST_LIMIT.perMinute, GUEST_LIMIT.burst)) return tooMany()

  const { token } = await ctx.params
  const staff = await staffFromLinkToken(token)
  // A status, not a redirect: EventSource cannot follow one, it just reports a
  // broken stream. The page itself renders the expired screen.
  if (!staff || !staff.property_id) return Response.json({ error: 'expired' }, { status: 401 })

  if (!(await realtimeReady())) {
    return Response.json({ error: 'no listener' }, { status: 503 })
  }

  // A handset in a corridor, maybe two. Each stream holds a function for up to
  // four minutes, so this is the ceiling on one person's share of them.
  const release = openStream(`w:${staff.id}`, 3)
  if (!release) return tooMany(10)

  const propertyId = staff.property_id

  return sseStream({
    signal: req.signal,
    onClose: release,
    subscribe: (fire) => onPropertyChange(propertyId, fire),
    load: async () => {
      // Re-read, not reused: the token is still valid for the shift but the
      // person may have been deactivated or moved since it was minted.
      const now = await staffFromLinkToken(token)
      if (!now) return null
      const open = (await loadBoard(now, now.property_id)).filter(
        (r) => r.status !== 'done' && r.status !== 'cancelled',
      )
      // Deliberately not the ages: those move every second and the page has
      // its own slow refresh for them. This changes when the work does.
      return open.map((r) => `${r.id}:${r.status}:${r.assigned_to ?? ''}`).join(',')
    },
  })
}
