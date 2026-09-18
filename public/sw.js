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

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let title = 'HConcierge'
      let body = 'A room is waiting. Open the board.'
      let url = '/staff/board'

      try {
        const res = await fetch('/api/staff/push/pending', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (res.ok) {
          const d = await res.json()
          // Nothing waiting any more: somebody accepted it between the push
          // being sent and the phone waking up. Say so rather than sending
          // whoever this is to an empty board.
          title = d.title || title
          body = d.body || body
          url = d.url || url
        }
        // A 401 means the shift's session has expired. The generic text above
        // is exactly right for that: there is something to look at, and
        // signing in is the way to see it.
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
        icon: '/notify.png',
        badge: '/notify.png',
        data: { url },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const url = (event.notification.data && event.notification.data.url) || '/staff/board'
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
    })(),
  )
})
