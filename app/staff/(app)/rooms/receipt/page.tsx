import Link from 'next/link'
import { requireManager } from '@/lib/auth'
import { sql } from '@/lib/db'
import { scopeTo } from '@/lib/scope'
import { buildReceipt, receiptText, RS_TEXT, WIDTH_58MM, WIDTH_80MM } from '@/lib/receipt'
import PrintButton from '../print/PrintButton'

export const dynamic = 'force-dynamic'

/**
 * The room's charges on an 80mm roll, through the browser's print dialog.
 *
 * This is the path a front desk actually has: the thermal printer is installed
 * as an ordinary Windows driver, and nothing has to be set up for this to work.
 * /api/staff/receipt serves the same receipt as raw ESC/POS for a printer in
 * raw mode or a local helper.
 *
 * It renders `receiptText()` in a monospace block rather than laying the
 * receipt out again in HTML, which means the paper is identical whichever route
 * printed it - including how the rupee sign is spelled. `?glyph=1` switches
 * both to a real ₹: the byte stream defines and draws one, and this page stops
 * writing "Rs". Without it both spell it out, because ESC/POS has the sign at
 * no fixed code point and a receipt that disagrees with itself between two
 * printers is worse than one that spells it out on both.
 */
export default async function ReceiptPage({ searchParams }: PageProps<'/staff/rooms/receipt'>) {
  const staff = await requireManager()
  const { room, mm, glyph } = await searchParams
  const roomId = typeof room === 'string' ? room : null
  const width = mm === '58' ? WIDTH_58MM : WIDTH_80MM
  // One decision per request, so the two printers cannot disagree: with the
  // drawn glyph switched on, the paper carries a real ₹ and so does this page.
  // Without it, both spell it "Rs".
  const symbol = glyph === '1' ? '₹' : RS_TEXT

  const [found] = roomId
    ? await sql<{ id: string }[]>`
        select r.id from rooms r
         where r.id = ${roomId} and ${scopeTo(staff, sql`r.property_id`, null)} limit 1`
    : []
  const receipt = found ? await buildReceipt(found.id) : null

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6">
      {/* A receipt is 80mm of paper, not a sheet of A4 - and globals.css sets
          `@page { size: A4 }` for every printed page in the app. This overrides
          it for this page only: inline so it lands after that rule in document
          order, and `!important` as well so it does not depend on landing
          there - a receipt that silently prints on A4 wastes a whole sheet per
          bill and nobody would notice until the roll ran out unused.
          `auto` height is what stops a short bill feeding a whole page out. */}
      <style>{`
        @page { size: ${width === WIDTH_58MM ? '58mm' : '80mm'} auto !important; margin: 4mm 3mm !important; }
        @media print { .no-print { display: none } .roll { font-size: 11pt } }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Receipt</h1>
          <p className="text-muted mt-1 max-w-[65ch] text-sm">
            {receipt
              ? 'In-room charges only, and it says so on the paper - the tax invoice is the hotel’s to issue.'
              : 'That room is not one you can see.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/staff/rooms" className="border-line rounded-xl border px-4 py-2.5 text-[13px] font-semibold">
            Back to rooms
          </Link>
          {receipt && (
            <Link
              href={`/api/staff/receipt?room=${found!.id}${width === WIDTH_58MM ? '&mm=58' : ''}${glyph === '1' ? '&glyph=1' : ''}`}
              className="border-line rounded-xl border px-4 py-2.5 text-[13px] font-semibold"
            >
              Raw ESC/POS
            </Link>
          )}
          {receipt && <PrintButton />}
        </div>
      </div>

      {receipt ? (
        <pre
          className="roll bg-surface border-line mx-auto border p-4 font-mono text-[13px] leading-[1.45] whitespace-pre print:mx-0 print:border-0 print:p-0"
          style={{ width: `${width}ch` }}
        >
          {receiptText(receipt, width, symbol).join('\n')}
        </pre>
      ) : (
        <p className="text-faint py-16 text-center text-sm">Nothing to print.</p>
      )}
    </div>
  )
}
