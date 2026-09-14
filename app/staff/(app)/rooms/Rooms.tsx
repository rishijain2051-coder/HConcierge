'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addRoom, checkIn, checkOut, rotateToken } from './actions'

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
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not work.')
      else router.refresh()
    })
  }

  async function copyLink(room: RoomRow) {
    const url = `${base}/r/${room.token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(room.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard is blocked outside https. Show the link so it can be copied by hand.
      setError(url)
    }
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

      {error && (
        <p className="bg-late-soft text-late mb-3 rounded-xl px-3.5 py-2.5 text-[13px] break-all">{error}</p>
      )}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        <div className="text-muted bg-paper grid grid-cols-[5rem_1fr_auto] gap-3 px-4 py-2 text-[11px] font-semibold tracking-wide uppercase sm:grid-cols-[5rem_8rem_1fr_auto]">
          <span>Room</span>
          <span className="hidden sm:block">Type</span>
          <span>Guest</span>
          <span className="text-right">Actions</span>
        </div>

        {rooms.map((r) => (
          <div key={r.id} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[5rem_8rem_1fr_auto]">
            <div>
              <p className="text-[15px] font-semibold tabular-nums">{r.number}</p>
              {properties.length > 0 && <p className="text-faint text-[11px]">{r.property_name}</p>}
            </div>

            <p className="text-muted hidden text-[13px] sm:block">
              {r.room_type ?? '—'}
              {r.floor ? ` · Fl ${r.floor}` : ''}
            </p>

            <div className="min-w-0">
              {r.occupied ? (
                <>
                  <p className="truncate text-[14px] font-medium">{r.guest_name}</p>
                  <p className="text-faint text-[11px]">
                    In since {r.checked_in_at ? new Date(r.checked_in_at).toLocaleDateString() : '—'}
                    {r.open_requests > 0 && ` · ${r.open_requests} open`}
                  </p>
                </>
              ) : (
                <p className="text-faint text-[13px]">Vacant</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Mini onClick={() => copyLink(r)}>{copied === r.id ? 'Copied' : 'Link'}</Mini>
              {canEdit &&
                (r.occupied ? (
                  <>
                    <Mini onClick={() => run(() => rotateToken(r.id))} disabled={pending}>
                      New QR
                    </Mini>
                    <Mini onClick={() => run(() => checkOut(r.id))} disabled={pending} tone="late">
                      Check out
                    </Mini>
                  </>
                ) : (
                  <Mini onClick={() => setCheckingIn(r)} tone="ink">
                    Check in
                  </Mini>
                ))}
            </div>
          </div>
        ))}

        {rooms.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">No rooms yet.</p>}
      </div>

      {checkingIn && (
        <Modal title={`Check in — Room ${checkingIn.number}`} onClose={() => setCheckingIn(null)}>
          <form
            action={(form) => {
              const name = String(form.get('guest') ?? '')
              const until = String(form.get('until') ?? '')
              run(async () => {
                const res = await checkIn(checkingIn.id, name, until || null)
                if (res.ok) setCheckingIn(null)
                return res
              })
            }}
            className="space-y-3"
          >
            <Field name="guest" label="Guest name" placeholder="Mr. Kabir Anand" autoFocus required />
            <Field name="until" label="Expected checkout" type="datetime-local" />
            <p className="text-faint text-xs">
              Checking in issues a fresh QR code for this room, so any code from the last stay stops working.
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
