'use client'

import { useState, useSyncExternalStore } from 'react'
import { IconAlarm } from '@/components/icons'

/**
 * "Wake this phone" — the other half of the alerts button beside it.
 *
 * *Alerts on* makes this tab ring while somebody is looking at it. This makes
 * the device ring when nobody is: it registers the service worker, subscribes
 * to the browser's push service, and hands the endpoint to
 * /api/staff/push/subscribe. After that a request landing at 4am reaches the
 * duty manager's lock screen whether or not the board is open, and whether or
 * not their phone number was ever verified.
 *
 * Deliberately per device, not per person. A housekeeper signs in on the
 * handset they carry and subscribes that; the same account on the office PC is
 * a separate subscription, and unsubscribing here only affects the thing in
 * your hand.
 */
export default function PushButton({
  publicKey,
  subscribed: initial,
}: {
  /** null when VAPID keys are unset — push is off for the whole install. */
  publicKey: string | null
  subscribed: boolean
}) {
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  /**
   * Whether this browser can do push at all, asked in the one way that does not
   * lie during hydration.
   *
   * This started as a plain `typeof window !== 'undefined' && 'PushManager' in
   * window`, which is false on the server and true in the browser - a rendered
   * output that disagrees with the HTML it is hydrating, which is a mismatch
   * React has to repair and is entitled to repair by throwing the subtree away.
   * The button appeared anyway on the machine it was written on. That is the
   * worst kind of working.
   *
   * `useSyncExternalStore` exists for exactly this: a server snapshot of false,
   * a client snapshot of the real answer, and no state set inside an effect.
   */
  const supported = useSyncExternalStore(
    () => () => {},
    () => 'serviceWorker' in navigator && 'PushManager' in window,
    () => false,
  )

  // No key means the install has no VAPID pair - push is off for everybody
  // here, not just this browser. Nothing to show, but say why in the console:
  // a control that is simply absent is indistinguishable from one that is
  // broken, and this is the difference between "your browser cannot" and
  // "whoever deployed this has not finished".
  if (publicKey === null) {
    if (typeof window !== 'undefined') {
      console.warn('[push] no VAPID public key from the server, so "Wake this device" is hidden')
    }
    return null
  }
  // An iPhone only has PushManager once the board is on the home screen, and
  // that is Apple's rule, not ours.
  if (!supported) return null

  async function toggle() {
    setBusy(true)
    setNote(null)
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const existing = await reg.pushManager.getSubscription()

      if (on && existing) {
        await fetch('/api/staff/push', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        })
        await existing.unsubscribe()
        setOn(false)
        return
      }

      // The permission prompt, and it has to be inside this click.
      if (Notification.permission !== 'granted') {
        const asked = await Notification.requestPermission()
        if (asked !== 'granted') {
          // Nothing more we can do from here: once it is blocked, only the
          // browser's own site settings can unblock it.
          setNote(
            asked === 'denied'
              ? 'This browser is blocking notifications for the site. Turn them back on in its site settings.'
              : 'Not now, then.',
          )
          return
        }
      }

      // `await reg.ready` matters: subscribing against a worker that is still
      // installing fails on a first visit and works on the second, which is
      // the kind of bug that gets called intermittent.
      await navigator.serviceWorker.ready
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          // Every push we send shows a notification, which is what this
          // promises the browser. The service worker holds up that end.
          userVisibleOnly: true,
          applicationServerKey: publicKey!,
        }))

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      const res = await fetch('/api/staff/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      if (!res.ok) {
        setNote('The server would not take the subscription.')
        return
      }
      setOn(true)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        aria-label={on ? 'This device is being woken' : 'Wake this device'}
        className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition disabled:opacity-55 sm:min-h-0 ${
          on ? 'border-ok text-ok' : 'border-line hover:border-ink'
        }`}
      >
        <IconAlarm size={15} on={on} />
        <span className="hidden sm:inline">
          {busy ? 'One moment…' : on ? 'Waking this device' : 'Wake this device'}
        </span>
      </button>
      {note && (
        <p className="border-line bg-surface text-muted absolute top-full right-0 z-40 mt-1.5 w-[260px] rounded-xl border p-2.5 text-[12px] leading-snug shadow-[var(--shadow-float)]">
          {note}
        </p>
      )}
    </div>
  )
}
