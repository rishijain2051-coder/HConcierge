import { sweepEscalations } from '@/lib/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Backstop for the escalation sweep that the staff board already runs on every
 * poll. This is the path that matters at 4am when nobody has a board open —
 * which is exactly when a forgotten request turns into a complaint.
 *
 * Called every ten minutes by Supabase pg_cron, which sends
 * `Authorization: Bearer <CRON_SECRET>`. The SQL is in db/cron.sql.
 *
 * Both verbs are accepted: net.http_post is the documented setup, GET keeps the
 * endpoint easy to poke by hand.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  const isDeployed = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (!secret) {
    // An unset secret must not silently leave this open to the internet. Only a
    // local dev box gets to run it unauthenticated.
    if (isDeployed) {
      return Response.json({ message: 'CRON_SECRET is not configured' }, { status: 401 })
    }
  } else if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ message: 'Invalid or missing cron secret' }, { status: 401 })
  }

  const escalated = await sweepEscalations()
  return Response.json({ escalated, at: new Date().toISOString() })
}

export const GET = handle
export const POST = handle
