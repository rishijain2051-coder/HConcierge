'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { rupees } from '@/lib/money'
import { IconChevron } from '@/components/icons'
import { Confirm, Field, Modal } from '../ui'
import {
  addRoom,
  checkIn,
  checkOut,
  newAccessCode,
  rotateToken,
  sendWelcomeCard,
  settleBill,
  unlockRoomCode,
} from './actions'

export type RoomRow = {
  id: string
  number: string
  floor: string | null
  room_type: string | null
  token: string
  occupied: boolean
  guest_name: string | null
  checked_in_at: string | null
  checkout_at: string | null
  property_id: string
  property_name: string
  open_requests: number
  access_code: string | null
  code_attempts: number
  code_locked_until: string | null
  settle_requested_at: string | null
  balance_paise: number
  guest_phone: string | null
}

export default function Rooms({
  rooms,
  canEdit,
  properties,
  selectedProperty,
  defaultPropertyId,
}: {
  rooms: RoomRow[]
  canEdit: boolean
  properties: { id: string; name: string }[]
  selectedProperty: string
  defaultPropertyId: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [checkingIn, setCheckingIn] = useState<RoomRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ room: RoomRow; code: string } | null>(null)
  // Checkout refuses over an unpaid balance rather than writing it off quietly.
  const [owing, setOwing] = useState<{ room: RoomRow; amount: number } | null>(null)
  const [sending, setSending] = useState<RoomRow | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  // The only action here that cannot be undone and cannot be seen until
  // somebody walks to the room. It was a single tap on a grid of room numbers.
  const [rotating, setRotating] = useState<RoomRow | null>(null)
  // Checking out ends the stay: it clears the code, so every device that stay
  // used is signed out. Reissuing the QR asked before doing its damage and
  // this did not, which was backwards — this is the one a mis-tap on a phone
  // actually reaches, because it sits in the same row.
  const [checkingOut, setCheckingOut] = useState<RoomRow | null>(null)
  // Settling moves money in the hotel's books and cannot be undone from here.
  // It was one tap next to four other one-tap buttons, on a row that is 44px
  // tall on a phone.
  const [settling, setSettling] = useState<RoomRow | null>(null)
  // One room at a time: opening a second closes the first, so the list never
  // grows back into the thing it replaced.
  const [openId, setOpenId] = useState<string | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not work.')
      else router.refresh()
    })
  }

  const occupied = rooms.filter((r) => r.occupied).length

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {properties.length > 1 && (
          <select
            value={selectedProperty}
            onChange={(e) => router.push(e.target.value ? `/staff/rooms?property=${e.target.value}` : '/staff/rooms')}
            className="border-line bg-surface w-full rounded-xl border px-3 py-2 text-[13px] font-medium sm:w-auto"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <p className="text-muted text-[13px]">
          {occupied} of {rooms.length} occupied
        </p>
        {canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="border-line hover:border-ink ml-auto min-h-11 rounded-xl border px-3 py-2 text-[13px] font-semibold sm:min-h-0"
          >
            + Add a room
          </button>
        )}
      </div>

      {error && <p className="bg-late-soft text-late mb-3 rounded-xl px-3.5 py-2.5 text-[13px] break-all">{error}</p>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {rooms.map((r) => {
          const locked = !!r.code_locked_until && new Date(r.code_locked_until) > new Date()
          const open = openId === r.id
          return (
            <div key={r.id}>
              {/* Closed, a room is its number and whether anyone is in it.
                  Twenty-two of those fit on a screen; twenty-two rows carrying
                  a guest, a code, a balance and five buttons did not, on any
                  screen. The exceptions still speak up — an unanswered request,
                  a guest waiting to settle, a locked code — because those are
                  the rooms the desk is actually looking for. */}
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                aria-expanded={open}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                  open ? 'bg-paper' : 'hover:bg-paper/60'
                }`}
              >
                <span className="text-[15px] font-semibold tabular-nums">Room {r.number}</span>
                <span className={`text-[13px] ${r.occupied ? 'text-muted' : 'text-faint'}`}>
                  {r.occupied ? 'Occupied' : 'Vacant'}
                </span>

                <span className="ml-auto flex items-center gap-1.5">
                  {r.open_requests > 0 && <Flag>{r.open_requests} open</Flag>}
                  {r.settle_requested_at && <Flag tone="warn">Wants to settle</Flag>}
                  {locked && <Flag tone="late">Code locked</Flag>}
                  <IconChevron
                    size={16}
                    className={`text-faint ease-glide shrink-0 transition-transform duration-300 ${
                      open ? 'rotate-180' : ''
                    }`}
                  />
                </span>
              </button>

              {open && (
                <div className="border-line space-y-4 border-t px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      {r.occupied ? (
                        <>
                          <p className="text-[15px] font-medium">{r.guest_name}</p>
                          <p className="text-faint mt-0.5 text-[12px] leading-relaxed">
                            In since {r.checked_in_at ? new Date(r.checked_in_at).toLocaleDateString() : '—'}
                            {r.checkout_at && ` · out ${new Date(r.checkout_at).toLocaleDateString()}`}
                            {r.balance_paise > 0 && (
                              <span className="text-ink font-semibold"> · {rupees(r.balance_paise)} on the bill</span>
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="text-faint text-[13px]">Nobody is checked in.</p>
                      )}
                      <p className="text-faint mt-1 text-[12px]">
                        {r.room_type ?? 'No room type'}
                        {r.floor ? ` · Floor ${r.floor}` : ''}
                        {properties.length > 1 ? ` · ${r.property_name}` : ''}
                      </p>
                    </div>

                    {/* The code plus the QR token IS the guest's login — it
                        opens their bill, their thread with the desk, and the
                        ability to charge the room. Only the people who issue it
                        ever receive it; for everyone else it is not in the page
                        at all. */}
                    {canEdit && r.occupied && r.access_code && (
                      <div className="shrink-0">
                        <p className="text-faint text-[11px]">Access code</p>
                        <p className="bg-paper mt-1 rounded-lg px-2.5 py-1.5 text-[18px] font-semibold tracking-[0.16em] tabular-nums">
                          {r.access_code}
                        </p>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.occupied ? (
                        <>
                          <PrintLink href={`/staff/rooms/print?room=${r.id}&slip=1`}>Print welcome card</PrintLink>
                          {/* Only offered when there is a number to send to.
                              A disabled button here would just be a question
                              the desk cannot answer from this screen. */}
                          {r.guest_phone && (
                            <Mini onClick={() => setSending(r)} disabled={pending}>
                              Send by WhatsApp
                            </Mini>
                          )}
                          {locked && (
                            <Mini onClick={() => run(() => unlockRoomCode(r.id))} disabled={pending}>
                              Unlock the code
                            </Mini>
                          )}
                          <Mini
                            onClick={() =>
                              run(async () => {
                                const res = await newAccessCode(r.id)
                                if (res.ok) setIssued({ room: r, code: res.code })
                                return res
                              })
                            }
                            disabled={pending}
                          >
                            New code
                          </Mini>
                          {r.balance_paise > 0 && (
                            <>
                              <PrintLink href={`/staff/rooms/receipt?room=${r.id}`}>Print receipt</PrintLink>
                              <Mini
                                onClick={() => setSettling(r)}
                                disabled={pending}
                                tone={r.settle_requested_at ? 'ink' : undefined}
                              >
                                Settle {rupees(r.balance_paise)}
                              </Mini>
                            </>
                          )}
                          <Mini onClick={() => setCheckingOut(r)} disabled={pending} tone="late">
                            Check out
                          </Mini>
                        </>
                      ) : (
                        <>
                          <PrintLink href={`/staff/rooms/print?room=${r.id}`}>Print the QR card</PrintLink>
                          <Mini onClick={() => setCheckingIn(r)} tone="ink">
                            Check in
                          </Mini>
                        </>
                      )}
                      <Mini onClick={() => setRotating(r)} disabled={pending} tone="late">
                        Reissue the QR
                      </Mini>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {rooms.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">No rooms yet.</p>}
      </div>

      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        The QR card on the desk is permanent — print it once. The four-digit code is what changes with each guest, so
        a photo of the QR from a previous stay is useless without it. Five wrong codes locks the room for fifteen
        minutes.
      </p>

      {owing && (
        <Modal title={`Room ${owing.room.number} has not settled`} onClose={() => setOwing(null)}>
          <p className="text-muted text-[14px] leading-relaxed">
            There is <span className="text-ink font-semibold">{rupees(owing.amount)}</span> outstanding on this room.
            Take the payment first — checking out now records it as settled and the guest&rsquo;s screen goes with them.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setOwing(null)}
              className="border-line hover:border-ink flex-1 rounded-xl border px-4 py-3 text-[13px] font-semibold"
            >
              Not yet
            </button>
            <button
              onClick={() => {
                const room = owing.room
                setOwing(null)
                run(() => checkOut(room.id, true))
              }}
              className="bg-ink flex-1 rounded-xl px-4 py-3 text-[13px] font-semibold text-white"
            >
              Settled — check out
            </button>
          </div>
        </Modal>
      )}

      {/* Settling is a claim that cash has changed hands, and nothing on this
          screen can take it back — the charges leave the folio and the guest's
          own screen clears. So it asks, it names the figure it is about to
          close, and it offers the paper first, because handing the guest a
          receipt is the step this button usually comes after. */}
      {settling && (
        <Modal title={`Settle room ${settling.number}?`} onClose={() => setSettling(null)}>
          <p className="text-muted text-[14px] leading-relaxed">
            This records that the desk has taken{' '}
            <span className="text-ink font-semibold">{rupees(settling.balance_paise)}</span>. HConcierge does not take
            the money and cannot check that it arrived — settling clears the charges from the room and from the
            guest&rsquo;s screen, and it cannot be undone from here.
          </p>
          <div className="mt-4">
            <PrintLink href={`/staff/rooms/receipt?room=${settling.id}`}>Print the receipt first</PrintLink>
          </div>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setSettling(null)}
              className="border-line hover:border-ink flex-1 rounded-xl border px-4 py-3 text-[13px] font-semibold"
            >
              Not yet
            </button>
            <button
              onClick={() => {
                const room = settling
                setSettling(null)
                run(() => settleBill(room.id))
              }}
              className="bg-ink flex-1 rounded-xl px-4 py-3 text-[13px] font-semibold text-white"
            >
              Money taken — settle
            </button>
          </div>
        </Modal>
      )}

      {/* The number is shown in full, and that is the entire point of this
          dialog. The message carries the room's access code, so one mistyped
          digit hands a stranger working access to an occupied room — the person
          who typed it is the only one who can catch it, and they can only catch
          it if they are shown it. */}
      {sending && (
        <Confirm
          title={`Send Room ${sending.number}'s card?`}
          body={`It goes by WhatsApp to ${sending.guest_phone}, and carries the access code ${
            sending.access_code ?? '—'
          } as well as the link. Check the number is right: anyone who receives it can get into the room until the code is reissued.`}
          confirmLabel="Send it"
          onConfirm={() =>
            run(async () => {
              const res = await sendWelcomeCard(sending.id)
              if (res.ok) setSent(res.to)
              return res
            })
          }
          onClose={() => setSending(null)}
        />
      )}

      {sent && (
        <Modal title="Sent" onClose={() => setSent(null)}>
          <p className="text-muted text-[14px] leading-relaxed">
            The welcome card is on its way to <span className="text-ink font-semibold">{sent}</span>. If that is not
            the guest&rsquo;s number, issue a new code now — the one in that message will stop working.
          </p>
          <button
            onClick={() => setSent(null)}
            className="bg-ink mt-5 w-full rounded-xl px-4 py-3 text-[14px] font-semibold text-white"
          >
            Done
          </button>
        </Modal>
      )}

      {checkingIn && (
        <Modal title={`Check in — Room ${checkingIn.number}`} onClose={() => setCheckingIn(null)}>
          <form
            action={(form) => {
              const name = String(form.get('guest') ?? '')
              const until = String(form.get('until') ?? '')
              const phone = String(form.get('phone') ?? '')
              run(async () => {
                const res = await checkIn(checkingIn.id, name, until || null, phone || null)
                if (res.ok) {
                  setIssued({ room: { ...checkingIn, guest_name: name, occupied: true }, code: res.code })
                  setCheckingIn(null)
                }
                return res
              })
            }}
            className="space-y-3"
          >
            <Field name="guest" label="Guest name" placeholder="Mr. Kabir Anand" autoFocus required />
            <Field name="until" label="Expected checkout" type="datetime-local" />
            <Field
              name="phone"
              label="Guest phone (optional)"
              type="tel"
              placeholder="+91 98765 43210"
              hint="Only used to send the welcome card by WhatsApp. Cleared at checkout."
            />
            <p className="text-faint text-xs leading-relaxed">
              A fresh four-digit code is issued on check-in. The room&rsquo;s QR card stays as it is.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="bg-ink w-full rounded-xl px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Check in'}
            </button>
          </form>
        </Modal>
      )}

      {issued && (
        <Modal title={`Room ${issued.room.number}`} onClose={() => setIssued(null)}>
          <p className="text-muted text-[14px] leading-relaxed">
            Give this code to {issued.room.guest_name ?? 'the guest'}. They enter it once after scanning the card in
            the room.
          </p>
          <p className="border-line bg-paper mt-4 rounded-xl border py-5 text-center text-[38px] font-semibold tracking-[0.3em] indent-[0.3em] tabular-nums">
            {issued.code}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setIssued(null)}
              className="border-line hover:border-ink flex-1 rounded-xl border px-4 py-3 text-[14px] font-semibold"
            >
              Done
            </button>
            <Link
              href={`/staff/rooms/print?room=${issued.room.id}&slip=1`}
              target="_blank"
              className="bg-ink flex-1 rounded-xl px-4 py-3 text-center text-[14px] font-semibold text-white"
            >
              Print welcome card
            </Link>
          </div>
        </Modal>
      )}

      {adding && (
        <Modal title="Add a room" onClose={() => setAdding(false)}>
          <form
            action={(form) => {
              run(async () => {
                const res = await addRoom(
                  String(form.get('property') ?? defaultPropertyId),
                  String(form.get('number') ?? ''),
                  String(form.get('floor') ?? ''),
                  String(form.get('type') ?? ''),
                )
                if (res.ok) setAdding(false)
                return res
              })
            }}
            className="space-y-3"
          >
            {properties.length > 0 && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium">Property</label>
                <select
                  name="property"
                  defaultValue={selectedProperty || defaultPropertyId}
                  className="border-line bg-surface w-full rounded-xl border px-3.5 py-2.5 text-[14px]"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Field name="number" label="Room number" placeholder="405" autoFocus required />
            <Field name="floor" label="Floor" placeholder="4" />
            <Field name="type" label="Room type" placeholder="Deluxe" />
            <button
              type="submit"
              disabled={pending}
              className="bg-ink w-full rounded-xl px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Add room'}
            </button>
          </form>
        </Modal>
      )}

      {checkingOut && (
        <Confirm
          title={`Check out Room ${checkingOut.number}?`}
          body={
            checkingOut.guest_name
              ? `${checkingOut.guest_name} is signed in on this room's code. Checking out clears it, so any phone they are using loses access straight away. The printed QR card stays valid for the next guest.`
              : "Checking out clears this room's code, so any phone using it loses access straight away. The printed QR card stays valid for the next guest."
          }
          confirmLabel="Check out"
          onConfirm={() => {
            const room = checkingOut
            run(async () => {
              const res = await checkOut(room.id)
              // A balance is a refusal, not a failure: surface it as the owing
              // dialog rather than an error banner, exactly as before.
              if (!res.ok && typeof res.outstanding === 'number') {
                setOwing({ room, amount: res.outstanding })
                return { ok: true }
              }
              return res
            })
          }}
          onClose={() => setCheckingOut(null)}
        />
      )}

      {rotating && (
        <Confirm
          title={`Reissue the QR for Room ${rotating.number}?`}
          body="The printed card in that room stops working the moment you do this, and a guest already using it is signed out. You will have to print the new card and walk it up. If they have only lost their welcome slip, issue a new code instead."
          confirmLabel="Reissue the QR"
          onConfirm={() => run(() => rotateToken(rotating.id))}
          onClose={() => setRotating(null)}
        />
      )}
    </div>
  )
}

/** A room's non-default state, said out loud on the closed row. */
function Flag({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'late' }) {
  const cls =
    tone === 'late' ? 'bg-late-soft text-late' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-paper text-muted'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

/** Printing opens a new tab, so it is a link — sized to match the buttons. */
function PrintLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      className="border-line text-muted hover:text-ink inline-flex min-h-11 items-center rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition sm:min-h-0"
    >
      {children}
    </Link>
  )
}

function Mini({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'late' | 'ink'
}) {
  const cls =
    tone === 'late'
      ? 'border-line text-late hover:bg-late-soft'
      : tone === 'ink'
        ? 'bg-ink border-ink text-white hover:opacity-90'
        : 'border-line text-muted hover:text-ink'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 sm:min-h-0 ${cls}`}
    >
      {children}
    </button>
  )
}

