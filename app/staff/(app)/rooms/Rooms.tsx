'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { rupees } from '@/lib/money'
import { addRoom, checkIn, checkOut, newAccessCode, rotateToken, settleBill, unlockRoomCode } from './actions'

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
}

export default function Rooms({
  rooms,
  base,
  canEdit,
  properties,
  selectedProperty,
  defaultPropertyId,
}: {
  rooms: RoomRow[]
  base: string
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
        {properties.length > 0 && (
          <select
            value={selectedProperty}
            onChange={(e) => router.push(e.target.value ? `/staff/rooms?property=${e.target.value}` : '/staff/rooms')}
            className="border-line bg-surface rounded-xl border px-3 py-2 text-[13px] font-medium"
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
            className="border-line hover:border-ink ml-auto rounded-xl border px-3 py-2 text-[13px] font-semibold"
          >
            + Add a room
          </button>
        )}
      </div>

      {error && <p className="bg-late-soft text-late mb-3 rounded-xl px-3.5 py-2.5 text-[13px] break-all">{error}</p>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        <div className="text-muted bg-paper hidden grid-cols-[4.5rem_1fr_auto] gap-3 px-4 py-2 text-[11px] font-semibold tracking-wide uppercase sm:grid sm:grid-cols-[4.5rem_7rem_1fr_5.5rem_auto]">
          <span>Room</span>
          <span className="hidden sm:block">Type</span>
          <span>Guest</span>
          <span className="hidden text-center sm:block">Code</span>
          <span className="text-right">Actions</span>
        </div>

        {rooms.map((r) => {
          const locked = r.code_locked_until && new Date(r.code_locked_until) > new Date()
          return (
            <div
              key={r.id}
              // On a phone the actions column is several buttons wide, which
              // squeezed the guest name, the balance and "wants to settle" down
              // to nothing. Below sm this stacks instead of competing for width.
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid sm:grid-cols-[4.5rem_7rem_1fr_5.5rem_auto] sm:gap-3 sm:py-2.5"
            >
              <div>
                <p className="text-[15px] font-semibold tabular-nums">{r.number}</p>
                {properties.length > 0 && <p className="text-faint text-[11px]">{r.property_name}</p>}
              </div>

              <p className="text-muted hidden text-[13px] sm:block">
                {r.room_type ?? '—'}
                {r.floor ? ` · Fl ${r.floor}` : ''}
              </p>

              <div className="min-w-0 flex-1 basis-[55%] sm:basis-auto">
                {r.occupied ? (
                  <>
                    <p className="truncate text-[14px] font-medium">{r.guest_name}</p>
                    <p className="text-faint text-[11px]">
                      In since {r.checked_in_at ? new Date(r.checked_in_at).toLocaleDateString() : '—'}
                      {r.open_requests > 0 && ` · ${r.open_requests} open`}
                      {r.balance_paise > 0 && (
                        <span className="text-ink font-semibold"> · {rupees(r.balance_paise)}</span>
                      )}
                      {r.settle_requested_at && (
                        <span className="text-warn font-semibold"> · wants to settle</span>
                      )}
                      {locked && <span className="text-late font-semibold"> · code locked</span>}
                    </p>
                  </>
                ) : (
                  <p className="text-faint text-[13px]">Vacant</p>
                )}
              </div>

              {/* The code plus the QR token IS the guest's login — it opens
                  their bill, their private thread with the desk, and the
                  ability to charge the room. Only the people who issue it see
                  it; everyone else gets the same dash as an empty room. */}
              <div className="hidden text-center sm:block">
                {canEdit && r.occupied && r.access_code ? (
                  <span className="bg-paper rounded-lg px-2 py-1 text-[15px] font-semibold tracking-[0.14em] tabular-nums">
                    {r.access_code}
                  </span>
                ) : (
                  <span className="text-faint text-[13px]">—</span>
                )}
              </div>

              <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                {canEdit &&
                  (r.occupied ? (
                    <>
                      <Link
                        href={`/staff/rooms/print?room=${r.id}&slip=1`}
                        target="_blank"
                        className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
                      >
                        Welcome card
                      </Link>
                      {locked && (
                        <Mini onClick={() => run(() => unlockRoomCode(r.id))} disabled={pending}>
                          Unlock
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
                        <Mini
                          onClick={() => run(() => settleBill(r.id))}
                          disabled={pending}
                          tone={r.settle_requested_at ? 'ink' : undefined}
                        >
                          Settle {rupees(r.balance_paise)}
                        </Mini>
                      )}
                      <Mini
                        onClick={() =>
                          run(async () => {
                            const res = await checkOut(r.id)
                            if (!res.ok && typeof res.outstanding === 'number') {
                              setOwing({ room: r, amount: res.outstanding })
                              return { ok: true }
                            }
                            return res
                          })
                        }
                        disabled={pending}
                        tone="late"
                      >
                        Check out
                      </Mini>
                    </>
                  ) : (
                    <>
                      <Link
                        href={`/staff/rooms/print?room=${r.id}`}
                        target="_blank"
                        className="border-line text-muted hover:text-ink rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
                      >
                        QR
                      </Link>
                      <Mini onClick={() => setCheckingIn(r)} tone="ink">
                        Check in
                      </Mini>
                    </>
                  ))}
              </div>
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
              className="border-line hover:border-ink flex-1 rounded-xl border px-4 py-2.5 text-[13px] font-semibold"
            >
              Not yet
            </button>
            <button
              onClick={() => {
                const room = owing.room
                setOwing(null)
                run(() => checkOut(room.id, true))
              }}
              className="bg-ink flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white"
            >
              Settled — check out
            </button>
          </div>
        </Modal>
      )}

      {checkingIn && (
        <Modal title={`Check in — Room ${checkingIn.number}`} onClose={() => setCheckingIn(null)}>
          <form
            action={(form) => {
              const name = String(form.get('guest') ?? '')
              const until = String(form.get('until') ?? '')
              run(async () => {
                const res = await checkIn(checkingIn.id, name, until || null)
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
            <p className="text-faint text-xs leading-relaxed">
              A fresh four-digit code is issued on check-in. The room&rsquo;s QR card stays as it is.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="bg-ink w-full rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
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
              className="border-line hover:border-ink flex-1 rounded-xl border px-4 py-2.5 text-[14px] font-semibold"
            >
              Done
            </button>
            <Link
              href={`/staff/rooms/print?room=${issued.room.id}&slip=1`}
              target="_blank"
              className="bg-ink flex-1 rounded-xl px-4 py-2.5 text-center text-[14px] font-semibold text-white"
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
              className="bg-ink w-full rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Add room'}
            </button>
          </form>
        </Modal>
      )}

      {canEdit && (
        <details className="text-faint mt-6 text-[12px]">
          <summary className="cursor-pointer">A QR card has been damaged or copied</summary>
          <div className="border-line mt-2 rounded-xl border p-3 leading-relaxed">
            <p>
              Reissuing a room&rsquo;s QR invalidates the printed card immediately — you have to print and replace it.
              Only do this for a card that has been damaged, or photographed by someone who should not have it. For a
              guest who simply lost their welcome card, use <span className="text-ink font-semibold">New code</span>{' '}
              instead.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => run(() => rotateToken(r.id))}
                  disabled={pending}
                  className="border-line hover:text-late rounded-lg border px-2 py-1 text-[11px] font-semibold tabular-nums disabled:opacity-40"
                >
                  {r.number}
                </button>
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
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
      className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  )
}

function Field({
  name,
  label,
  type = 'text',
  placeholder,
  autoFocus,
  required,
}: {
  name: string
  label: string
  type?: string
  placeholder?: string
  autoFocus?: boolean
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        className="border-line bg-surface focus:border-ink placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-[14px] outline-none"
      />
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Every other dialog in the app closes on Escape; these did not.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="bg-surface relative w-full max-w-sm rounded-2xl p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-ink -mt-1 p-1 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
