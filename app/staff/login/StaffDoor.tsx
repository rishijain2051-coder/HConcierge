'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef, useState } from 'react'
import { IconArrowRight } from '@/components/icons'
import { login } from './actions'

const LAST_USER = 'hc.lastUser'

function shiftGreeting(h: number) {
  if (h < 5) return 'Night shift'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Night shift'
}

export default function StaffDoor() {
  const [state, formAction, pending] = useActionState(login, {})
  const [now, setNow] = useState<Date | null>(null)
  const user = useRef<HTMLInputElement>(null)
  const pass = useRef<HTMLInputElement>(null)

  // Rendered only after mount: a server-rendered clock is a hydration mismatch
  // waiting to happen, and this one ticks anyway.
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Reception signs in every single shift. Remember who, never the password.
  useEffect(() => {
    const last = localStorage.getItem(LAST_USER)
    if (last && user.current) {
      user.current.value = last
      pass.current?.focus()
    } else {
      user.current?.focus()
    }
  }, [])

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,30rem)]">
      {/* Back of house is a darker room than the guest's. The door says so. */}
      <aside className="bg-ink relative flex items-end overflow-hidden px-6 py-10 text-white sm:px-10 lg:order-2 lg:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1/4 -right-1/4 h-[130%] w-[130%] rounded-full opacity-45"
          style={{
            background: 'radial-gradient(closest-side, var(--brand), transparent 72%)',
            animation: 'hc-breathe 9s ease-in-out infinite',
          }}
        />
        <div className="relative">
          <p className="font-display text-[clamp(2.1rem,5vw,3.1rem)] leading-[1.03] tracking-[-0.02em]">
            {now ? shiftGreeting(now.getHours()) : ' '}
          </p>
          <p className="mt-2.5 text-[14px] text-white/70 tabular-nums">
            {now
              ? `${now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · ${now
                  .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  .toLowerCase()}`
              : ' '}
          </p>
          <p className="mt-8 max-w-[34ch] text-[14px] leading-relaxed text-white/65">
            Whatever the rooms need, it is already on the board. Nobody has to pick up a phone to tell you.
          </p>
        </div>
      </aside>

      <main className="flex items-center px-6 py-14 sm:px-10 lg:order-1 lg:px-14">
        <div className="w-full max-w-[23rem]">
          <Link href="/" className="text-muted hover:text-ink text-[14px] font-semibold tracking-tight transition">
            HConcierge
          </Link>

          <h1 className="font-display mt-8 text-[clamp(1.9rem,4vw,2.5rem)] leading-[1.05] tracking-[-0.02em]">
            Sign in
          </h1>
          <p className="text-muted mt-2 text-[14px]">RN Hospitality staff only.</p>

          <form
            action={(form) => {
              const u = String(form.get('username') ?? '').trim()
              if (u) localStorage.setItem(LAST_USER, u)
              formAction(form)
            }}
            className="mt-8 space-y-4"
          >
            <div>
              <label htmlFor="username" className="mb-1.5 block text-[13px] font-medium">
                Username
              </label>
              <input
                ref={user}
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="border-line bg-surface focus:border-ink w-full rounded-xl border px-3.5 py-3 text-[15px] outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">
                Password
              </label>
              <input
                ref={pass}
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="border-line bg-surface focus:border-ink w-full rounded-xl border px-3.5 py-3 text-[15px] outline-none transition-colors"
              />
            </div>

            {state.error && (
              <p role="alert" className="bg-late-soft text-late rounded-xl px-3.5 py-2.5 text-[13px]">
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="bg-ink inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? 'Just a moment…' : 'Sign in'}
              {!pending && <IconArrowRight size={16} />}
            </button>
          </form>

          <p className="text-faint mt-7 text-[12px] leading-relaxed">
            Forgotten your password? Your duty manager can reset it. Five wrong attempts locks the account for
            fifteen minutes.
          </p>
        </div>
      </main>
    </div>
  )
}
