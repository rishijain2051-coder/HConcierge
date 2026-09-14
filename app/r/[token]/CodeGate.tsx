'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Property, Room } from '@/lib/types'
import { enterRoomCode } from './actions'

/**
 * Four slots that behave as one object.
 *
 * The group beats — opening, closing, rejecting — rotate the WRAPPER about its
 * own centre rather than moving each slot. That is what makes every slot travel
 * an arc instead of a line: the outer two sweep further than the inner two,
 * because they sit further from the pivot. Translating each slot instead leaves
 * the ring behind, level, with the outer slots breaking out of it top and
 * bottom — which reads as broken, not hinged.
 *
 * Only the per-digit lift animates a single slot, because that is the one beat
 * that really is about an individual box.
 *
 * Behind the slots is one real input, not four. That keeps paste, the numeric
 * keypad and the phone's own code autofill working, and avoids the
 * focus-juggling that four separate boxes always turn into.
 */

const SLOTS = [0, 1, 2, 3]
const EASE = 'cubic-bezier(.22,1,.36,1)'

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
  const group = useRef<HTMLDivElement>(null)
  const slots = useRef<(HTMLSpanElement | null)[]>([])
  const reduced = useRef(false)
  const lastLen = useRef(0)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  /** A group beat: the whole object hinges on its centre. */
  const swing = useCallback((frames: Keyframe[], duration: number, fill: FillMode = 'none') => {
    if (reduced.current) return
    group.current?.animate(frames, { duration, easing: EASE, fill })
  }, [])

  /** Opening: the object drops in hinged, while the slots fade up beneath it. */
  useEffect(() => {
    if (reduced.current) return
    swing(
      [
        { transform: 'rotate(6deg) rotateX(-20deg) translateY(-14px)', opacity: 0 },
        { opacity: 1, offset: 0.45 },
        { transform: 'rotate(0deg) rotateX(0deg) translateY(0px)', opacity: 1 },
      ],
      640,
      'backwards',
    )
    SLOTS.forEach((i) => {
      slots.current[i]?.animate(
        [
          { transform: 'scale(.82)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 420, delay: 90 + i * 55, easing: EASE, fill: 'backwards' },
      )
    })
  }, [swing])

  /** A digit landing lifts that one slot toward the viewer and sets it back. */
  useEffect(() => {
    const len = code.length
    const grew = len > lastLen.current
    lastLen.current = len
    if (!grew) return

    if (!reduced.current) {
      slots.current[len - 1]?.animate(
        [
          { transform: 'translateZ(0px) scale(1)' },
          { transform: 'translateZ(34px) scale(1.09)', offset: 0.4 },
          { transform: 'translateZ(0px) scale(1)' },
        ],
        { duration: 300, easing: EASE },
      )
    }

    // Circuit closed. The whole object tips, overshoots and settles — the one
    // beat on this screen allowed to be big.
    if (len === SLOTS.length) {
      setWired(true)
      swing(
        [
          { transform: 'rotate(0deg) rotateX(0deg)' },
          { transform: 'rotate(-4.5deg) rotateX(12deg)', offset: 0.34 },
          { transform: 'rotate(1.8deg) rotateX(-5deg)', offset: 0.68 },
          { transform: 'rotate(0deg) rotateX(0deg)' },
        ],
        760,
      )
    } else {
      setWired(false)
    }
  }, [code, swing])

  /** Rejected: a short counter-swing, quicker and sharper than the close. */
  const reject = useCallback(() => {
    setWired(false)
    swing(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(5deg)', offset: 0.24 },
        { transform: 'rotate(-3.4deg)', offset: 0.5 },
        { transform: 'rotate(1.6deg)', offset: 0.76 },
        { transform: 'rotate(0deg)' },
      ],
      460,
    )
  }, [swing])

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

      <form onSubmit={submit} className="mt-9">
        <label htmlFor="code" className="sr-only">
          Four-digit room code
        </label>

        {/* Stage. Without perspective the hinge below is only a squash. */}
        <div onClick={() => input.current?.focus()} className="relative [perspective:1100px]">
          {/* The object. Ring and slots rotate together, so the ring stays part
              of it instead of being a level box the slots escape from. */}
          <div ref={group} data-wired={wired || undefined} className="relative [transform-style:preserve-3d]">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -inset-3 rounded-[28px] transition-opacity duration-300"
              style={{ boxShadow: 'inset 0 0 0 1.8px var(--color-ok)', opacity: wired ? 1 : 0 }}
            />

            <div className="flex items-center justify-center gap-3">
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
                    className="bg-surface border-line grid h-[76px] w-[64px] place-items-center rounded-2xl border text-[32px] font-semibold tabular-nums transition-colors duration-200"
                    style={{ borderColor: isActive ? 'var(--brand)' : undefined }}
                  >
                    {char ?? (isActive ? <span className="bg-ink h-8 w-[2px] animate-pulse rounded-full" /> : '')}
                  </span>
                )
              })}
            </div>
          </div>

          {/* The wire. It only completes once all four slots are filled. */}
          <span
            aria-hidden="true"
            className="bg-line pointer-events-none absolute inset-x-8 -bottom-5 h-0.5 overflow-hidden rounded-full"
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
            // Invisible but genuinely focused: the slots draw the value and the
            // caret, while the keyboard still belongs to a real input.
            //
            // caretColor is set inline, not with `caret-transparent`. The global
            // `input { caret-color: var(--brand) }` in globals.css is unlayered,
            // and unlayered rules outrank Tailwind's layered utilities — so the
            // class silently lost and the real caret showed through the slots.
            className="absolute inset-0 h-full w-full cursor-pointer bg-transparent text-transparent outline-none select-none"
            style={{ caretColor: 'transparent' }}
          />
        </div>

        {error && (
          <p id="code-error" role="alert" className="bg-late-soft text-late mt-9 rounded-xl px-3.5 py-2.5 text-[13px]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={code.length !== SLOTS.length || busy}
          className="mt-9 w-full rounded-2xl bg-[var(--brand)] px-4 py-4 text-[16px] font-semibold text-white transition disabled:opacity-30"
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
