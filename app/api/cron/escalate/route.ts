import { sweepEscalations } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Backstop for the escalation sweep that the staff board already runs on every
 * poll. This is the path that matters at 4am when nobody has a board open —
 * which is exactly when a forgotten request turns into a complaint.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when the variable is set.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorised', { status: 401 })
  }

  const escalated = await sweepEscalations()
  return Response.json({ escalated, at: new Date().toISOString() })
}
