import { NextResponse, type NextRequest } from 'next/server'

/**
 * The cron secret, checked before the route exists.
 *
 * app/api/cron/escalate/route.ts already refuses an unauthenticated call, and
 * that check stays — this is the outer gate, not a replacement. The difference
 * is what an unauthorised request costs: reaching the route means Next has
 * loaded its module graph, which pulls in lib/notify.ts, lib/db.ts and a
 * pooled Postgres client. Rejected here, it costs a header comparison.
 *
 * It is also the one place to add a second cron path without remembering to
 * repeat the check inside it.
 *
 * `proxy.ts`, not `middleware.ts`: this version of Next deprecates that name
 * and the build says so. Nothing is shared with the app on purpose - the docs
 * warn that a proxy may be deployed to a CDN, so it reads two environment
 * variables and a header and nothing else.
 *
 * Deliberately the same three cases as the route, in the same order, because
 * two guards that disagree are worse than one:
 *
 *   - no secret, deployed      → 401. An unset secret must never leave this
 *                                open to the internet.
 *   - no secret, local dev     → allowed, so `curl localhost` still works.
 *   - secret set, wrong header → 401.
 */
export function proxy(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const isDeployed = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (!secret) {
    if (isDeployed) {
      return NextResponse.json({ message: 'CRON_SECRET is not configured' }, { status: 401 })
    }
    return NextResponse.next()
  }

  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ message: 'Invalid or missing cron secret' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  // Only the cron endpoints. Everything else authenticates itself, and a
  // matcher wide enough to catch the guest and staff routes would put a
  // header comparison in front of every request in the app for nothing.
  matcher: ['/api/cron/:path*'],
}
