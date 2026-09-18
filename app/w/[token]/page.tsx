import type { Metadata } from 'next'
import { staffFromLinkToken } from '@/lib/auth'
import { loadBoard } from '@/lib/board'
import { hotelTime } from '@/lib/clock'
import { since, slaState } from '@/lib/sla'
import { departmentLabel } from '@/lib/types'
import { actOnJob } from './actions'
import ActButton from './ActButton'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'My jobs · HConcierge',
    // A link that opens somebody's workload must never reach an index or a
    // referrer log. Same treatment as a guest room link.
    robots: { index: false, follow: false },
  }
}

/**
 * The one page behind every WhatsApp message.
 *
 * The link names a person, never a request, so this is always current: a
 * message tapped forty minutes late still lands on live work. `?r=` only says
 * which row the message was about, so it gets a marker and nothing else.
 *
 * No session, because on a shared housekeeping handset nobody is signed in —
 * that is the entire reason this exists rather than a deep link into the board.
 * Authority is the signed token plus a re-read of the staff row; see
 * lib/auth.ts staffFromLinkToken.
 *
 * Deliberately a server component with plain forms: this page's whole job is to
 * open fast on bad hotel wifi, and app/staff/(app)/ui.tsx's nicer Button is a
 * client component in another route group. The classes below match it. The one
 * piece of client JavaScript here is ./ActButton, which does nothing but say
 * that a tap landed — see the note in that file for why it is worth the bytes.
 */
export default async function JobsPage({ params, searchParams }: PageProps<'/w/[token]'>) {
  const { token } = await params
  const { r, e } = await searchParams

  const staff = await staffFromLinkToken(token)
  if (!staff) return <Expired />

  const board = await loadBoard(staff, staff.property_id)
  const open = board.filter((req) => req.status !== 'done' && req.status !== 'cancelled')
  const highlight = typeof r === 'string' ? r : undefined
  const refused = typeof e === 'string' ? e : undefined

  return (
    <main className="mx-auto min-h-svh max-w-md px-4 py-6">
      <p className="text-muted text-[13px] font-semibold tracking-tight">
        {staff.property_name ?? 'HConcierge'}
      </p>
      <h1 className="font-display mt-1 text-[clamp(1.5rem,6vw,1.9rem)] leading-[1.1] tracking-[-0.02em]">
        {open.length === 0
          ? 'Nothing waiting'
          : `${open.length} job${open.length === 1 ? '' : 's'} waiting`}
      </h1>
      <p className="text-faint mt-1 text-[13px]">
        {staff.name} · {departmentLabel(staff.department)}
      </p>

      {/* A refusal from setRequestStatus — someone else finished it, or it is not
          this department's to touch. Shown rather than swallowed, because the
          alternative is a button that looks like it did nothing. */}
      {refused && (
        <p className="border-late/30 bg-late-soft text-late mt-4 rounded-lg border px-3 py-2 text-[13px] font-semibold">
          {refused}
        </p>
      )}

      {open.length === 0 ? (
        <p className="text-muted mt-8 text-[15px] leading-relaxed">
          Everything on your board is done. This page stays live — open it again from any
          HConcierge message.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {open.map((req) => {
            const state = slaState(req)
            // More than one thing is a list, the same as on the board and in
            // the message that sent somebody here. Three jobs joined with
            // commas read as one, and this page is opened one-handed in a
            // corridor by whoever the escalation reached.
            const lines = req.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name))
            const summary = lines.join(', ') || req.note || departmentLabel(req.department)

            return (
              <li
                key={req.id}
                className={`bg-surface rounded-card border p-4 ${
                  req.ref === highlight ? 'border-ink ring-ink/10 ring-2' : 'border-line'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[17px] tracking-[-0.01em]">
                    Room {req.room_number}
                  </p>
                  <span
                    className={`text-[12px] font-semibold ${
                      state === 'late' ? 'text-late' : state === 'warn' ? 'text-warn' : 'text-faint'
                    }`}
                  >
                    {since(req.created_at)}
                  </span>
                </div>

                {lines.length > 1 ? (
                  <ul className="text-muted mt-1 space-y-0.5 text-[14px] leading-snug">
                    {lines.map((l) => (
                      <li key={l} className="flex gap-1.5">
                        <span className="text-faint select-none">·</span>
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted mt-1 text-[14px] leading-snug">{summary}</p>
                )}
                {/* The guest's note, kept but below the work rather than
                    standing in for it. */}
                {req.note && lines.length > 0 && (
                  <p className="text-muted mt-1 text-[13px] italic">&ldquo;{req.note}&rdquo;</p>
                )}
                {/* The hour, on the hotel's clock. It is the one thing on this
                    card that cannot be read off `since()`, and this page opens
                    on shared handsets set to whatever they were set to. */}
                {req.scheduled_for && (
                  <p className="text-warn mt-1 text-[13px] font-semibold">
                    For {hotelTime(req.scheduled_for, req.property_timezone)}
                  </p>
                )}
                <p className="text-faint mt-1 text-[12px]">
                  #{req.ref} · {STATUS_LABEL[req.status]}
                  {req.assigned_name ? ` · ${req.assigned_name}` : ''}
                </p>

                {/* Emphasis follows the expected next step, because `done` is
                    irreversible — NEXT_STATUS has no exit from it — and posts the
                    folio charge. While a job is still new the big button is
                    Accept; Mark done only becomes primary once it has been
                    accepted, which is when it is actually the obvious action.
                    Two adjacent primary buttons on a 375px screen is a mis-tap
                    that cannot be undone. */}
                <div className="mt-3 flex gap-2">
                  {req.status === 'new' ? (
                    <>
                      <Act token={token} id={req.id} next="ack" label="Accept" busy="Accepting…" primary />
                      <Act token={token} id={req.id} next="done" label="Done" busy="Finishing…" />
                    </>
                  ) : (
                    <Act token={token} id={req.id} next="done" label="Mark done" busy="Finishing…" primary />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

const STATUS_LABEL: Record<string, string> = {
  new: 'not accepted',
  ack: 'accepted',
  in_progress: 'in progress',
}

/**
 * One form per button. The request id is a form field and therefore whatever the
 * client says it is — which is fine, because setRequestStatus authorises it
 * against this staff member's property and department regardless of how it
 * arrived.
 */
function Act({
  token,
  id,
  next,
  label,
  busy,
  primary,
}: {
  token: string
  id: string
  next: 'ack' | 'done'
  label: string
  busy: string
  primary?: boolean
}) {
  return (
    <form action={actOnJob} className={primary ? 'flex-1' : ''}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="request" value={id} />
      <input type="hidden" name="next" value={next} />
      <ActButton label={label} busy={busy} primary={primary} />
    </form>
  )
}

function Expired() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 text-center">
      <h1 className="font-display text-[clamp(1.6rem,6vw,2rem)] leading-[1.1] tracking-[-0.02em]">
        This link has expired
      </h1>
      <p className="text-muted mt-3 text-[15px] leading-relaxed">
        Job links last one shift. The next HConcierge message carries a fresh one — or sign in to
        the board directly.
      </p>
      <a
        href="/staff/login"
        className="bg-ink border-ink mt-6 min-h-11 rounded-lg border px-4 py-2.5 text-[14px] font-semibold text-white"
      >
        Open the board
      </a>
    </main>
  )
}
