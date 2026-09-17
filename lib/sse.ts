/**
 * A one-way push channel over plain HTTP.
 *
 * Server-sent events rather than a websocket, because the hosting is
 * serverless: there is no long-lived server to hold a socket, and `EventSource`
 * reconnects by itself when a stream ends. The effect a guest sees is the same
 * — their order moves the instant the kitchen touches it, with no polling.
 *
 * Every stream closes itself after MAX_MS. That is deliberate: a serverless
 * function billed by the second should not be held open all night, and the
 * browser reopens the channel before the guest notices.
 */

const MAX_MS = 4 * 60_000
const HEARTBEAT_MS = 25_000
// Several rows change together and not all at once: an order is a request row,
// then its lines a couple of hundred milliseconds later, then a charge. Wait
// long enough for the whole thing to land so the guest gets one push carrying a
// complete order, rather than four — the first of which has no dishes on it.
const SETTLE_MS = 350

export function sseStream<T>({
  signal,
  subscribe,
  load,
  onClose,
}: {
  signal: AbortSignal
  subscribe: (fire: () => void) => () => void
  /** Returning null means "this viewer is no longer allowed" — the stream closes. */
  load: () => Promise<T | null>
  /**
   * Run once when the stream ends, however it ends. `shutdown` below is the
   * single funnel for all four exits — the client hanging up, MAX_MS, a
   * revoked grant, and the abort signal — which is why a caller holding a
   * resource for the life of the stream can release it here and not leak.
   */
  onClose?: () => void
}): Response {
  const encoder = new TextEncoder()
  // Held outside the stream so `cancel` can reach it. Without a cancel handler
  // the runtime reports a normal client hang-up as "destination stream closed
  // early", and a log full of stack traces for people closing a browser tab is
  // a log nobody reads.
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cleanup()
    },
    start(controller) {
      let closed = false
      let queued: NodeJS.Timeout | null = null
      let sending = false
      let again = false
      let lastSent = ''

      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          shutdown()
        }
      }

      const push = async () => {
        if (closed) return
        if (sending) {
          again = true
          return
        }
        sending = true
        try {
          const next = await load()
          // Authorisation is re-checked on every push, not once at open. A
          // stream that lives for minutes outlives checkouts, deactivations
          // and expiries, and must not keep feeding a revoked viewer.
          if (next === null) {
            shutdown()
            return
          }
          const payload = JSON.stringify(next)
          // The trigger fires on rows the guest cannot see, too. Only spend
          // bytes and a React render when the visible state actually moved.
          if (payload !== lastSent) {
            lastSent = payload
            write(`data: ${payload}\n\n`)
          }
        } catch {
          // A dropped query is not worth closing a healthy stream over.
        } finally {
          sending = false
          if (again) {
            again = false
            void push()
          }
        }
      }

      const fire = () => {
        if (closed || queued) return
        queued = setTimeout(() => {
          queued = null
          void push()
        }, SETTLE_MS)
      }

      const unsubscribe = subscribe(fire)
      const beat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
      const lifetime = setTimeout(() => shutdown(), MAX_MS)

      function shutdown() {
        if (closed) return
        closed = true
        if (queued) clearTimeout(queued)
        clearInterval(beat)
        clearTimeout(lifetime)
        unsubscribe()
        signal.removeEventListener('abort', shutdown)
        onClose?.()
        try {
          controller.close()
        } catch {
          // Already closed by the client hanging up.
        }
      }

      cleanup = shutdown
      signal.addEventListener('abort', shutdown)
      // An AbortSignal that has *already* aborted never fires a listener added
      // afterwards, so a request the client gave up on before this ran would
      // hold whatever `onClose` releases for good. Cheap to check, and the
      // alternative is a slow leak that only shows under load.
      if (signal.aborted) {
        shutdown()
        return
      }
      // `retry` is how long the browser waits before reopening after we close.
      write('retry: 3000\n\n')
      void push()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Nginx and friends buffer by default, which would hold every event back.
      'X-Accel-Buffering': 'no',
    },
  })
}
