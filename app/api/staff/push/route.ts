import { getStaff } from '@/lib/auth'
import { dropSubscription, pushConfigured, saveSubscription } from '@/lib/push'

/**
 * A browser telling us it is willing to be woken, or that it no longer is.
 *
 * POST to subscribe, DELETE to stop. Both authorise against the session and
 * ignore whatever staff id the client might think it is: a subscription is
 * bound to whoever is signed in on that device, which is the only claim that
 * can be checked.
 */
export async function POST(req: Request) {
  // `getStaff` and an explicit 401, not `requireStaff`: that one redirects to
  // the sign-in page, and a redirect answering a fetch means the button gets a
  // 200 with an HTML body and reports success while storing nothing.
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })
  if (!pushConfigured()) return Response.json({ error: 'Push is not configured.' }, { status: 503 })

  const body = (await req.json().catch(() => null)) as {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
  } | null

  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''
  // Only https, and only somewhere that can actually be posted to. An endpoint
  // is a URL we will later fetch server-side, so it is a trust boundary.
  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return Response.json({ error: 'That is not a subscription.' }, { status: 400 })
  }

  await saveSubscription(staff.id, { endpoint, p256dh, auth })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const staff = await getStaff()
  if (!staff) return Response.json({ error: 'unauthorised' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
  if (endpoint) await dropSubscription(staff.id, endpoint)
  return Response.json({ ok: true })
}
