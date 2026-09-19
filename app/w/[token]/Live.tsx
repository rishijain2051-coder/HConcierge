'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Keeps the job list true while somebody is holding it.
 *
 * This page is opened from a message, carried down a corridor, and looked at
 * again a few minutes later - by which time a colleague may have finished the
 * job it is offering. It renders nothing: the page stays a server component and
 * this only asks for a fresh render when the property changes, so there is one
 * definition of what a job list looks like rather than a second copy in the
 * client.
 *
 * Stream first, slow poll as a seatbelt - the same bargain as lib/use-live.ts.
 * The poll is also what keeps "12m old" honest, since the stream deliberately
 * says nothing when only the clock has moved.
 */
export default function Live({ token }: { token: string }) {
  const router = useRouter()

  useEffect(() => {
    let source: EventSource | null = new EventSource(`/api/w/${token}/live`)
    let failures = 0

    source.onmessage = () => router.refresh()
    // EventSource retries forever by itself, including against a server with no
    // listener to give. Three strikes and the interval below carries it.
    source.onerror = () => {
      if (++failures >= 3) {
        source?.close()
        source = null
      }
    }

    const seatbelt = setInterval(() => router.refresh(), 60_000)
    return () => {
      source?.close()
      clearInterval(seatbelt)
    }
  }, [token, router])

  return null
}
