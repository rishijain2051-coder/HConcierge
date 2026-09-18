import { getStaff } from '@/lib/auth'
import { loadBoard } from '@/lib/board'
import { howOld } from '@/lib/sla'
import { teamLabels } from '@/lib/departments'

export const dynamic = 'force-dynamic'

/**
 * What the service worker should say.
 *
 * The push itself carries nothing, so this is the message — read at the moment
 * the phone wakes up rather than at the moment the push was queued. A request
 * that has been accepted in between says so, which is the whole reason the
 * payload is not in the push.
 *
 * Behind `requireStaff` and scoped through `loadBoard`, so it shows one
 * person's own board and nothing else. A push endpoint is not a secret worth
 * defending; this session cookie is.
 */
export async function GET() {
  // A 401 rather than the redirect `requireStaff` would issue: the caller is a
  // service worker, and it reads the status to decide what to say.
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })
  // A platform account has no board, and `scopeTo` answers "every property
  // everywhere" for one - which in a notification would be one customer's
  // rooms on another customer's lock screen. Same guard as /api/staff/board.
  if (staff.role === 'platform') return Response.json({ error: 'no board' }, { status: 403 })

  const board = await loadBoard(staff, staff.property_id)
  const waiting = board.filter((r) => r.status === 'new')

  if (waiting.length === 0) {
    return Response.json({
      title: 'Nothing waiting',
      body: 'Somebody has already picked it up.',
      url: '/staff/board',
    })
  }

  const labels = await teamLabels(staff.organisation_id)
  const first = waiting[0]
  const team = labels.get(first.department) ?? first.department
  const what = first.items.length
    ? first.items.map((i) => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name)).join(', ')
    : first.note || team

  return Response.json({
    title:
      waiting.length === 1
        ? `Room ${first.room_number} is waiting`
        : `${waiting.length} rooms are waiting`,
    // The oldest one, named. A count alone tells somebody to go and look; a
    // room number and an item tells them whether to walk or to run.
    body: `${what} - ${team}, ${howOld(first.created_at)}`,
    url: '/staff/board',
  })
}
