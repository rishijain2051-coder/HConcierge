'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Live server state, pushed.
 *
 * The stream is the real channel — the screen updates the moment a row
 * changes. The poll behind it is a seatbelt on two counts: hotel wifi drops
 * streams, and the board's escalation sweep is time-based, so something has to
 * knock on the server even when nothing is happening.
 *
 * Every guest phone and reception monitor runs this, so it is deliberately
 * dull: one request in flight at a time, nothing at all while the tab is
 * hidden, and a stream that gives up rather than reconnecting forever.
 */
export function useLive<T>({
  initial,
  streamUrl,
  pollUrl,
  pollMs = 60_000,
}: {
  initial: T
  streamUrl: string
  pollUrl: string
  pollMs?: number
}): { state: T; refresh: () => void; live: boolean; gone: boolean } {
  const [state, setState] = useState(initial)
  const [live, setLive] = useState(false)
  // The server has stopped recognising us — checked out, or the grant expired.
  const [gone, setGone] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    // Overlapping polls are what exhausts the connection pool; skip a tick
    // rather than stack a second request on top of a slow one.
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(pollUrl, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      // Swallowing this was how a checked-out phone kept rendering a live
      // tracker forever, with nothing on screen to say the stay had ended.
      if (res.status === 401 || res.status === 404) setGone(true)
      else if (res.ok) {
        setGone(false)
        setState(await res.json())
      }
    } catch {
      // Hotel wifi drops. Keep the last known state on screen and try again.
    } finally {
      inFlight.current = false
    }
  }, [pollUrl])

  useEffect(() => {
    let source: EventSource | null = null
    let failures = 0
    let stopped = false

    const open = () => {
      if (stopped || source) return
      failures = 0
      source = new EventSource(streamUrl)

      source.onmessage = (e) => {
        failures = 0
        setLive(true)
        try {
          setState(JSON.parse(e.data))
        } catch {
          // A truncated frame is not worth blanking the screen for.
        }
      }

      source.onerror = () => {
        setLive(false)
        // EventSource retries by itself, forever, including against a server
        // that has no listener to give. Three strikes and we leave it to the
        // poll rather than hammering a box that is already unhappy.
        if (++failures >= 3) {
          source?.close()
          source = null
        }
      }
    }

    const close = () => {
      source?.close()
      source = null
    }

    // A phone in a pocket should cost nothing: drop the stream when the screen
    // goes away, and take one fresh reading when it comes back. Coming back is
    // also the moment to retry a stream that gave up — without that, one server
    // restart left the phone a minute behind for the rest of the stay.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        open()
        void refresh()
      } else {
        close()
      }
    }

    if (document.visibilityState === 'visible') open()
    document.addEventListener('visibilitychange', onVisibility)

    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refresh()
      // The poll is also the retry: if the stream gave up, try it again rather
      // than staying a minute behind for the rest of the stay.
      open()
    }, pollMs)

    return () => {
      stopped = true
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
      close()
    }
  }, [streamUrl, refresh, pollMs])

  return { state, refresh: () => void refresh(), live, gone }
}
