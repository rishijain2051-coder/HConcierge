import { getStaff } from '@/lib/auth'
import { loadBoard, loadChatRooms } from '@/lib/board'
import { sweepEscalations } from '@/lib/notify'

export const dynamic = 'force-dynamic'

// ponytail: one throttle per server instance, not a distributed lock. Worst
// case a few instances each sweep once per window, and the sweep is idempotent
// (it only touches rows where escalated_at is null), so duplicates are free.
let lastSweep = 0
const SWEEP_EVERY_MS = 30_000

export async function GET(req: Request) {
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })

  const propertyId = new URL(req.url).searchParams.get('property')

  // Escalate as a side effect of somebody watching the board, so an overdue
  // request turns red within seconds rather than waiting for the nightly cron.
  if (Date.now() - lastSweep > SWEEP_EVERY_MS) {
    lastSweep = Date.now()
    sweepEscalations(staff.role === 'admin' ? undefined : staff.property_id ?? undefined).catch((err) =>
      console.error('[board] escalation sweep failed', err),
    )
  }

  const [requests, chats] = await Promise.all([
    loadBoard(staff, propertyId),
    loadChatRooms(staff, propertyId),
  ])

  return Response.json({ requests, chats }, { headers: { 'Cache-Control': 'no-store' } })
}
