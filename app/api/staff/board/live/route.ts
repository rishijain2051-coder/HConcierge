import { requireOperational } from '@/lib/auth'
import { loadBoard, loadChatRooms } from '@/lib/board'
import { sql } from '@/lib/db'
import { onPropertyChange, realtimeReady } from '@/lib/realtime'
import { scopeTo } from '@/lib/scope'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The board's live channel. A guest's order lands on the screen as it is
 * written, rather than up to four seconds later.
 *
 * The board still keeps a slow poll alongside this — that is what runs the
 * escalation sweep, which is time-based and so has nothing to notify it.
 */
export async function GET(req: Request) {
  const staff = await requireOperational()
  const selected = new URL(req.url).searchParams.get('property')

  if (!(await realtimeReady())) {
    return Response.json({ error: 'no listener' }, { status: 503 })
  }

  // An admin watching "all properties" needs every one of them on the channel.
  const properties = await sql<{ id: string }[]>`
    select id from properties where ${scopeTo(staff, sql`id`, selected)}`

  return sseStream({
    signal: req.signal,
    subscribe: (fire) => {
      const offs = properties.map((p) => onPropertyChange(p.id, fire))
      return () => offs.forEach((off) => off())
    },
    load: async () => {
      const [requests, chats] = await Promise.all([
        loadBoard(staff, selected),
        loadChatRooms(staff, selected),
      ])
      return { requests, chats }
    },
  })
}
