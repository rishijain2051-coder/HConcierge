'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Property, Room } from '@/lib/types'
import { enterRoomCode } from './actions'

/**
 * Four slots that behave as one object.
 *
 * The row sits on a perspective stage, so a slot can tip through depth instead
 * of sliding flat. Each slot swings about the CENTRE OF THE ROW rather than its
 * own middle, which means the outer two travel further than the inner two and
 * the whole set moves along an arc. A shared translate would read as a slide;
 * this reads as one hinged object opening and closing.
 *
 * Behind them is a single real input — not four. One input keeps paste, the
 * numeric keypad and the phone's own code autofill working, and avoids the
 * focus-juggling that four boxes always turn into.
 */

const SLOTS = [0, 1, 2, 3]
const GAP = 68 // px between slot centres, matched to the rendered size

/**
 * Rotate a slot about the row's centre by `deg` and return the offset from
 * where it sits at rest. The row is flat, so the slot's own y-offset is zero
 * and this collapses to (r·cosT − r, r·sinT).
 */
function arc(index: number, deg: number) {
  const r = (index - (SLOTS.length - 1) / 2) * GAP
  const t = (deg * Math.PI) / 180
  return { x: r * Math.cos(t) - r, y: r * Math.sin(t) }
}

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
  const [wired, setWired] = useState(false)

  const input = useRef<HTMLInputElement>(null)
  const slots = useRef<(HTMLSpanElement | null)[]>([])
  const reduced = useRef(false)
  const lastLen = useRef(0)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const animateSlot = useCallback(
    (i: number, frames: Keyframe[], duration: number, delay = 0) => {
      const el = slots.current[i]
      if (!el) return
      if (reduced.current) return
      el.animate(frames, { duration, delay, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'both' })
    },
    [],
  )

  /** Opening: the set swings in along the arc, outer slots travelling furthest. */
  useEffect(() => {
    if (reduced.current) return
    SLOTS.forEach((i) => {
      const from = arc(i, -34)
      animateSlot(
        i,
        [
          {
            transform: `translate(${from.x}px, ${from.y}px) rotateY(-38deg) rotateX(12deg) scale(.86)`,
            opacity: 0,
          },
          { transform: 'translate(0,0) rotateY(0) rotateX(0) scale(1)', opacity: 1 },
        ],
        620,
        i * 55,
      )
    })
  }, [animateSlot])

  /** A digit landing tips that one slot through depth and back. */
  useEffect(() => {
    const len = code.length
    const grew = len > lastLen.current
    lastLen.current = len
    if (!grew) return

    const i = len - 1
    animateSlot(
      i,
      [
        { transform: 'rotateY(0) scale(1)' },
        { transform: 'rotateY(34deg) translateZ(26px) scale(1.06)', offset: 0.45 },
        { transform: 'rotateY(0) translateZ(0) scale(1)' },
      ],
      340,
    )

    // Circuit closed: the four settle together and become one wired object.
    if (len === SLOTS.length) {
      setWired(true)
      SLOTS.forEach((j) => {
        const out = arc(j, 7)
        animateSlot(
          j,
          [
            { transform: 'translate(0,0) rotateX(0)' },
            { transform: `translate(${out.x}px, ${out.y}px) rotateX(-10deg)`, offset: 0.4 },
            { transform: 'translate(0,0) rotateX(0)' },
          ],
          520,
          j * 26,
        )
      })
    } else {
      setWired(false)
    }
  }, [code, animateSlot])

  /** A rejected code throws the set apart along the same arc, then back. */
  const reject = useCallback(() => {
    setWired(false)
    SLOTS.forEach((i) => {
      const a = arc(i, 16)
      const b = arc(i, -11)
      animateSlot(
        i,
        [
          { transform: 'translate(0,0)' },
          { transform: `translate(${a.x}px, ${a.y}px) rotateY(18deg)`, offset: 0.3 },
          { transform: `translate(${b.x}px, ${b.y}px) rotateY(-12deg)`, offset: 0.62 },
          { transform: 'translate(0,0) rotateY(0)' },
        ],
        560,
        i * 18,
      )
    })
  }, [animateSlot])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== SLOTS.length || busy) return
    setBusy(true)
    setError(null)
    const res = await enterRoomCode(token, code)
    if (res.ok) {
      // Full reload so the server renders the app with the new cookie set.
      window.location.reload()
      return
    }
    setBusy(false)
    setError(res.error)
    setCode('')
    lastLen.current = 0
    reject()
    input.current?.focus()
  }

  const active = Math.min(code.length, SLOTS.length - 1)

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12"
      style={{ ['--brand' as string]: property.brand_color }}
    >
      <p className="text-muted text-[14px] font-semibold tracking-tight">{property.name}</p>
      <h1 className="font-display mt-2 text-[clamp(2rem,8vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
        Room {room.number}
      </h1>
      <p className="text-muted mt-3 text-[15px] leading-relaxed">
        Enter the four-digit code on your welcome card and everything in the hotel is one tap away — room service,
        housekeeping, the front desk.
      </p>

      <form onSubmit={submit} className="mt-8">
        <label htmlFor="code" className="sr-only">
          Four-digit room code
        </label>

        {/* The stage. Without perspective the tip below is just a squash. */}
        <div
          onClick={() => input.current?.focus()}
          data-wired={wired || undefined}
          className="group relative [perspective:1000px]"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-2.5 rounded-[26px] transition-opacity duration-300"
            style={{ boxShadow: 'inset 0 0 0 1.8px var(--color-ok)', opacity: wired ? 1 : 0 }}
          />

          <div className="flex items-center justify-center gap-3 [transform-style:preserve-3d]">
            {SLOTS.map((i) => {
              const char = code[i]
              const isActive = !busy && i === active && code.length < SLOTS.length
              return (
                <span
                  key={i}
                  ref={(el) => {
                    slots.current[i] = el
                  }}
                  aria-hidden="true"
                  className="bg-surface border-line grid h-[68px] w-[56px] place-items-center rounded-2xl border text-[30px] font-semibold tabular-nums transition-colors duration-300"
                  style={{ borderColor: isActive ? 'var(--brand)' : undefined }}
                >
                  {char ?? (isActive ? <span className="bg-ink h-7 w-[2px] animate-pulse rounded-full" /> : '')}
                </span>
              )
            })}
          </div>

          {/* The wire. It only completes once all four slots are filled. */}
          <span
            aria-hidden="true"
            className="bg-line pointer-events-none absolute inset-x-6 -bottom-1 h-px overflow-hidden rounded-full"
          >
            <span
              className="bg-ok block h-full origin-left transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${code.length / SLOTS.length})` }}
            />
          </span>

          <input
            ref={input}
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, SLOTS.length))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={SLOTS.length}
            autoFocus
            aria-describedby={error ? 'code-error' : undefined}
            // Invisible but genuinely focused: the caret and the value are drawn
            // by the slots above, and the keyboard still belongs to a real input.
            className="absolute inset-0 h-full w-full cursor-pointer bg-transparent text-transparent caret-transparent outline-none select-none"
          />
        </div>

        {error && (
          <p id="code-error" role="alert" className="bg-late-soft text-late mt-5 rounded-xl px-3.5 py-2.5 text-[13px]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={code.length !== SLOTS.length || busy}
          className="mt-6 w-full rounded-2xl bg-[var(--brand)] px-4 py-4 text-[16px] font-semibold text-white transition disabled:opacity-30"
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
