'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'

/**
 * The cookie notice.
 *
 * Worth saying plainly, because the copy below has to stay true: **this
 * product sets no non-essential cookies today.** There is no analytics, no
 * advertising pixel and no third-party script anywhere in it. The only cookies
 * that exist are the staff session and the guest's per-stay grant, and neither
 * is optional - a signed-out session is not a degraded experience, it is no
 * experience.
 *
 * So this banner gates nothing, and it says so rather than pretending to offer
 * a choice it does not have. What it does buy is the disclosure itself, in the
 * place people look for it, and a switch that already exists on the day
 * something measurable is added: `cookiesAccepted()` is the gate to read
 * before loading any script that is not essential.
 *
 * localStorage, not a cookie. Storing the cookie preference in a cookie is a
 * joke the regulation does not make, and this way the notice itself adds
 * nothing to the request headers.
 */
const KEY = 'hc.cookies'

/**
 * localStorage as an external store, which is what it is.
 *
 * The obvious shape - `useState(false)` plus an effect that reads storage and
 * sets it - is a cascading render on every mount and the lint rule is right to
 * refuse it. `useSyncExternalStore` is the primitive for exactly this: a value
 * that only exists on the client, read once, with a server snapshot that
 * renders nothing so there is no flash of a bar at somebody who dismissed it
 * months ago.
 *
 * Storage denied (private browsing, an embedded webview) reads as accepted:
 * a notice that cannot remember being dismissed is a notice on every page
 * load, which is worse than the disclosure is worth.
 */
let listeners: (() => void)[] = []
const subscribe = (fn: () => void) => {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}
const read = (): string | null => {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return 'accepted'
  }
}

/** The gate for any future non-essential script. Nothing calls it yet. */
export function cookiesAccepted(): boolean {
  if (typeof window === 'undefined') return false
  return read() === 'accepted'
}

export default function CookieBanner() {
  const choice = useSyncExternalStore(subscribe, read, () => 'accepted')
  if (choice) return null

  const close = (next: 'accepted' | 'essential') => {
    try {
      window.localStorage.setItem(KEY, next)
    } catch {}
    for (const l of listeners) l()
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-5 sm:pb-5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-surface border-line mx-auto flex max-w-[52rem] flex-col gap-3 rounded-2xl border p-4 shadow-[var(--shadow-float)] sm:flex-row sm:items-center sm:gap-5">
        <p className="text-muted flex-1 text-[13px] leading-relaxed">
          HConcierge uses cookies only to keep you signed in and to keep a guest&rsquo;s stay open on their own
          phone. There is no analytics and no advertising here.{' '}
          <Link href="/privacy" className="text-ink font-medium underline decoration-from-font underline-offset-2">
            Read the privacy policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => close('essential')}
            className="border-line text-muted hover:text-ink rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition"
          >
            Essential only
          </button>
          <button
            onClick={() => close('accepted')}
            className="bg-ink rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
