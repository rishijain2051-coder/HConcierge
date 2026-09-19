import { getStaff } from '@/lib/auth'
import { exportCsv } from '@/lib/folio'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** The hand-off to the PMS until a real integration exists. */
export async function GET(req: Request) {
  const staff = await getStaff()
  if (!staff) return new Response('unauthorised', { status: 401 })
  if (staff.role === 'staff' || staff.role === 'platform') {
    return new Response('forbidden', { status: 403 })
  }

  const url = new URL(req.url)
  // Scoped inside exportCsv - an id from the query string is a request, not a
  // permission.
  const propertyId = url.searchParams.get('property') || staff.property_id

  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7) || 7, 1), 365)
  const csv = await exportCsv(staff, propertyId, days)
  await audit({
    propertyId: propertyId ?? staff.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'folio.exported',
    meta: { days },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hconcierge-charges-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
