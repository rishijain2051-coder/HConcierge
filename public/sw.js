/* HConcierge service worker.
 *
 * Its whole job is the doorbell. lib/push.ts sends a push with no payload, so
 * there is nothing in the message to show — this wakes up, asks the app what
 * is waiting using the staff member's own session cookie, and shows that.
 *
 * Which means a notification that was queued while the phone was in a tunnel
 * says what is true when it finally arrives, not what was true when it was
 * sent, and nothing about any guest ever passes through a push service.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const BOARD = '/staff/board'
const ICON = '/notify.png'

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let title = 'HConcierge'
      let body = 'A room is waiting. Open the board.'
      let url = BOARD
      let requestId = null
      let room = null

      try {
        const res = await fetch('/api/staff/push/pending', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (res.ok) {
          const d = await res.json()
          title = d.title || title
          body = d.body || body
          url = d.url || url
          requestId = d.requestId || null
          room = d.room || null
        }
        // A 401 means the shift's session has expired. The generic text above
        // is exactly right for that: there is something to look at, and
        // signing in is the way to see it. No Accept button either — there is
        // nobody to attribute the acceptance to.
      } catch {
        /* Offline. The generic text stands. */
      }

      await self.registration.showNotification(title, {
        body,
        // One tag, so ten requests do not become ten notifications on a lock
        // screen. `renotify` is what still makes the phone buzz for each one.
        tag: 'hc-board',
        renotify: true,
        requireInteraction: true,
        icon: ICON,
        badge: ICON,
        // Clear it without opening anything. The whole point of the ladder is
        // that somebody picks the job up quickly, and making them unlock a
        // phone and find a tab first is most of the delay.
        actions: requestId
          ? [{ action: 'accept', title: room ? `Accept room ${room}` : 'Accept' }]
          : [],
        data: { url, requestId, room },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  event.notification.close()

  if (event.action === 'accept' && data.requestId) {
    event.waitUntil(acceptFromNotification(data))
    return
  }

  event.waitUntil(openBoard(data.url || BOARD))
})

/**
 * Accept the request this notification named, from wherever it was tapped.
 *
 * /api/staff/push/accept re-reads the session and hands off to
 * setRequestStatus, so a tap here is authorised exactly as a tap on the board
 * is. Nothing about the transition is decided in this file.
 */
async function acceptFromNotification(data) {
  let ok = false
  let reason = 'Could not reach the front desk. Open the board.'

  try {
    const res = await fetch('/api/staff/push/accept', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: data.requestId }),
    })
    const answer = await res.json().catch(() => ({}))
    ok = res.ok && answer.ok === true
    if (!ok) {
      reason =
        answer.error ||
        (res.status === 401 ? 'Your shift has been signed out. Sign in and it is still there.' : reason)
    }
  } catch {
    /* Offline. `reason` already says so. */
  }

  // Either way this gets a notification, because a tap that produces nothing
  // visible is a tap somebody repeats. Its own tag, since the one it came from
  // has just been closed, and silent on success: a confirmation that makes the
  // same noise as the alarm teaches people to ignore the alarm.
  await self.registration.showNotification(ok ? 'Accepted' : 'Not accepted', {
    body: ok
      ? data.room
        ? `Room ${data.room} is yours. It is off the waiting list.`
        : 'It is off the waiting list.'
      : reason,
    tag: 'hc-accept',
    icon: ICON,
    badge: ICON,
    silent: ok,
    requireInteraction: !ok,
    data: { url: BOARD },
  })
}

async function openBoard(url) {
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  // Reuse a tab that is already on a staff screen. Opening a second copy of
  // the board is how a desk ends up with four of them by Friday.
  const mine = open.find((c) => c.url.includes('/staff/'))
  if (mine) {
    await mine.focus()
    if ('navigate' in mine) await mine.navigate(url)
    return
  }
  await self.clients.openWindow(url)
}
