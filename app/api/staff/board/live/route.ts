import { cookies } from 'next/headers'
import { getStaff, ORG_COOKIE, SESSION_COOKIE, staffFromToken } from '@/lib/auth'
import { loadBoard, loadChatRooms } from '@/lib/board'
import { sql } from '@/lib/db'
import { onPropertyChange, realtimeReady } from '@/lib/realtime'
import { scopeTo } from '@/lib/scope'
import { sseStream } from '@/lib/sse'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The board's live channel. A guest's order lands on the screen as it is
 * written, rather than up to a minute later.
 *
 * Like the guest stream, this re-reads the staff row on every push: a stream
 * lives for minutes, and deactivating someone has to log them out of a board
 * they are already watching, not just the next one they open.
 *
 * The board keeps a slow poll alongside this - that is what runs the escalation
 * sweep, which is time-based and so has nothing to notify it.
 */
export async function GET(req: Request) {
  // A status, not a redirect: EventSource cannot follow one to a login page,
  // it just reports a broken stream.
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })
  if (staff.role === 'platform') return Response.json({ error: 'no board' }, { status: 403 })

  const selected = new URL(req.url).searchParams.get('property')

  if (!(await realtimeReady())) {
    return Response.json({ error: 'no listener' }, { status: 503 })
  }

  const jar = await cookies()
  const session = jar.get(SESSION_COOKIE)?.value
  const org = jar.get(ORG_COOKIE)?.value

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
      const me = await staffFromToken(session, org)
      // Platform accounts have no board; neither do people who were just
      // deactivated, moved to another property, or signed out elsewhere.
      if (!me || me.role === 'platform') return null
      const [requests, chats] = await Promise.all([
        loadBoard(me, selected),
        loadChatRooms(me, selected),
      ])
      return { requests, chats }
    },
  })
}
