import { getStaff } from '@/lib/auth'
import { setRequestStatus } from '@/lib/board'
import { isUuid } from '@/lib/scope'

/**
 * Accept a request from the notification, without opening the board.
 *
 * An API route rather than a server action because the caller is
 * public/sw.js: a service worker cannot invoke a server action, and it is
 * running with no page at all.
 *
 * Thin on purpose. `setRequestStatus` owns every rule - the property, the
 * department, the legal transition, the audit row - exactly as it does for the
 * board and for the WhatsApp link. Nothing about authorisation is
 * re-implemented here, and nothing about it is weaker because the tap came
 * from a lock screen.
 */
export async function POST(req: Request) {
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { requestId?: unknown } | null
  const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
  // Checked here rather than handed to Postgres: a malformed uuid is an error
  // from the driver, which surfaces as a 500 for what is really a bad request.
  if (!isUuid(requestId)) return Response.json({ error: 'That is not a request.' }, { status: 400 })

  const result = await setRequestStatus(staff, requestId, 'ack')
  // 409 for a refusal: somebody else took it, or it is not this department's to
  // touch. The worker shows the reason rather than swallowing it.
  return Response.json(result, { status: result.ok ? 200 : 409 })
}
