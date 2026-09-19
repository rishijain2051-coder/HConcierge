'use client'

import { useState } from 'react'
import type { Property, Room } from '@/lib/types'
import { enterRoomCode } from './actions'

/**
 * One input rather than four boxes: it accepts a paste, works with the phone's
 * own autofill, and never leaves the caret stranded in a box the guest did not
 * expect to be in.
 */
export default function CodeGate({
  token,
  room,
  property,
}: {
  token: string
  room: Room
  property: Property
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 4 || busy) return
    setBusy(true)
    setError(null)
    const res = await enterRoomCode(token, code)
    if (res.ok) {
      // A full reload so the server renders the app with the new cookie set.
      window.location.reload()
      return
    }
    setBusy(false)
    setError(res.error)
    setCode('')
  }

  return (
    <div
      className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12"
      style={{ ['--brand' as string]: property.brand_color }}
    >
      <p className="text-muted text-[14px] font-semibold tracking-tight">{property.name}</p>
      <h1 className="font-display mt-2 text-[clamp(2rem,8vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
        Room {room.number}
      </h1>
      <p className="text-muted mt-3 text-[15px] leading-relaxed">
        Enter the four-digit code on your welcome card and everything in the hotel is one tap away - room service,
        housekeeping, the front desk.
      </p>

      <form onSubmit={submit} className="mt-7">
        <label htmlFor="code" className="sr-only">
          Four-digit room code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          autoFocus
          aria-describedby={error ? 'code-error' : undefined}
          placeholder="0000"
          className="border-line bg-surface placeholder:text-faint/50 w-full rounded-2xl border px-4 py-5 text-center text-[34px] font-semibold tracking-[0.5em] indent-[0.5em] tabular-nums outline-none transition-colors focus:border-[var(--brand)]"
        />

        {error && (
          <p id="code-error" role="alert" className="bg-late-soft text-late mt-3 rounded-xl px-3.5 py-2.5 text-[13px]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={code.length !== 4 || busy}
          className="mt-4 w-full rounded-2xl bg-[var(--brand)] px-4 py-4 text-[16px] font-semibold text-white transition disabled:opacity-30"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <p className="text-faint mt-7 text-[13px] leading-relaxed">
        Lost your card? The front desk can read the code out or issue a new one.
        {property.phone ? ` Call ${property.phone}.` : ''}
      </p>
      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        You only do this once. This phone will stay signed in to Room {room.number} until you check out.
      </p>
    </div>
  )
}
