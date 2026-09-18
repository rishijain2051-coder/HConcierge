import { getStaff } from '@/lib/auth'
import { sql } from '@/lib/db'
import { scopeTo } from '@/lib/scope'
import { audit } from '@/lib/audit'
import { buildReceipt, escpos, WIDTH_58MM, WIDTH_80MM } from '@/lib/receipt'

export const dynamic = 'force-dynamic'

/**
 * The room's charges as raw ESC/POS, for a thermal printer in raw mode.
 *
 *   GET /api/staff/receipt?room=<id>        80mm, 48 columns
 *   GET /api/staff/receipt?room=<id>&mm=58  58mm, 32 columns
 *   GET /api/staff/receipt?room=<id>&glyph=1  draw a real ₹ instead of "Rs"
 *
 * This is the path for a printer reached over the network on port 9100, or one
 * driven by a local helper. A front desk whose printer is installed as an
 * ordinary Windows driver wants /staff/rooms/receipt instead, which is the same
 * receipt as an 80mm page and goes through the print dialog — the button on the
 * Rooms screen points there, because that is the path that needs nothing set up.
 *
 * `staff` is excluded for the same reason it is excluded from the folio export:
 * a housekeeper does not need the money, and the rule should read the same in
 * both places.
 */
export async function GET(req: Request) {
  const staff = await getStaff()
  if (!staff) return new Response('unauthorised', { status: 401 })
  if (staff.role === 'staff' || staff.role === 'platform') {
    return new Response('forbidden', { status: 403 })
  }

  const roomId = new URL(req.url).searchParams.get('room')
  if (!roomId) return new Response('room is required', { status: 400 })

  // Scoped through scopeTo rather than by hand: one definition of "which
  // properties may this person see", and an id in a query string is a request
  // rather than a permission.
  const [room] = await sql<{ id: string; number: string; property_id: string }[]>`
    select r.id, r.number, r.property_id from rooms r
     where r.id = ${roomId} and ${scopeTo(staff, sql`r.property_id`, null)} limit 1`
  if (!room) return new Response('not found', { status: 404 })

  const receipt = await buildReceipt(room.id)
  if (!receipt) return new Response('not found', { status: 404 })

  const params = new URL(req.url).searchParams
  const width = params.get('mm') === '58' ? WIDTH_58MM : WIDTH_80MM
  // Opt-in, because a printer that ignores ESC & prints a literal tilde where
  // the rupee sign should be, and there is no way to ask it in advance. Try it
  // once on the printer that is actually installed; if the sign comes out,
  // leave it on.
  const bytes = escpos(receipt, width, { rupeeGlyph: params.get('glyph') === '1' })

  // Printing a bill is a thing somebody should be able to account for later,
  // the same as exporting the charges is.
  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'folio.receipt_printed',
    entity: 'room',
    entityId: room.id,
    meta: { room: room.number, amount_paise: receipt.total, columns: width },
  })

  // slice() before .buffer: a Uint8Array can be a window onto a larger buffer,
  // and handing Response the whole buffer would send whatever else was in it.
  // This one never is, by construction, but the next person to touch escpos()
  // should not have to know that.
  return new Response(bytes.slice().buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="receipt-${room.number}.bin"`,
      'Cache-Control': 'no-store',
    },
  })
}
