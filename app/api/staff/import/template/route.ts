import { requireManager } from '@/lib/auth'
import { SPECS, templateCsv, type ImportKind } from '@/lib/bulk'

export const dynamic = 'force-dynamic'

/**
 * The example spreadsheet. A download rather than a server action because a
 * file has to arrive as a response with its own filename, and this is the same
 * shape as the folio export next door.
 *
 * Behind `requireManager`: the templates carry the property's own team slugs in
 * their example rows, which is a small thing to leak but not one to leak for
 * free.
 */
export async function GET(req: Request) {
  await requireManager()

  const kind = new URL(req.url).searchParams.get('kind') as ImportKind | null
  if (!kind || !(kind in SPECS)) {
    return Response.json({ error: 'unknown template' }, { status: 404 })
  }

  return new Response(templateCsv(kind), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hconcierge-${kind}-template.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
