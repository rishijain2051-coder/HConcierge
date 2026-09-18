'use client'

import { useState } from 'react'
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

  // Not supported, or not configured: say nothing at all rather than offering a
  // button that cannot work. An iPhone only has this once the board has been
  // added to the home screen, and that is Apple's rule, not ours.
  const usable =
    publicKey !== null &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  if (!usable) return null

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
