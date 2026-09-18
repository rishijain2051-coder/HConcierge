/**
 * A circuit breaker for the message transports.
 *
 * The problem it solves is specific. `sendMessage` tries the self-hosted
 * WhatsApp gateway and falls through to Twilio, and the escalation sweep sends
 * to every recipient at once with `Promise.all`. So a gateway on a closed
 * laptop does not fail once — it fails once per recipient, per sweep, every
 * ten minutes, each one waiting out a TCP connect to a machine that is not
 * answering. A rung that names six managers becomes six hanging requests
 * inside a function with a `maxDuration`, and the sweep that was supposed to
 * take a second takes the whole budget and gets killed partway through.
 *
 * After a few consecutive failures the transport is skipped outright and the
 * caller falls through to the other one immediately. That is the cascade this
 * prevents: one dead dependency taking the escalation path down with it.
 *
 * **In-process, per instance**, the same caveat as lib/limit.ts and for the
 * same reason — the hosting scales horizontally, so each instance learns
 * independently. That is acceptable here in a way it would not be for a
 * quota: the thing being protected is *this* instance's time budget.
 */

type Breaker = {
  /** Consecutive failures. Reset by any success. */
  fails: number
  /** Epoch ms until which the transport is skipped. 0 when closed. */
  openUntil: number
  /** True while one trial call is out, so only one probe gets through. */
  probing: boolean
}

const breakers = new Map<string, Breaker>()

/** Failures in a row before the transport is taken out of the rotation. */
const FAILS_TO_OPEN = 4
/**
 * How long it stays out. Longer than a sweep interval would mean an outage is
 * never retried in time to matter; shorter than a connect timeout would mean
 * it never actually rests. A minute sits between the two.
 */
const OPEN_MS = 60_000

function get(name: string): Breaker {
  let b = breakers.get(name)
  if (!b) {
    b = { fails: 0, openUntil: 0, probing: false }
    breakers.set(name, b)
  }
  return b
}

/**
 * May we try this transport right now?
 *
 * Half-open by design: once the window has passed, exactly one call is let
 * through as a probe. Letting all of them through is how a recovering service
 * gets knocked over by the traffic that was waiting for it.
 */
export function breakerAllows(name: string, now = Date.now()): boolean {
  const b = get(name)
  if (b.openUntil === 0) return true
  if (now < b.openUntil) return false
  if (b.probing) return false
  b.probing = true
  return true
}

/** Report how the call went. A success closes the breaker outright. */
export function breakerRecord(name: string, ok: boolean, now = Date.now()): void {
  const b = get(name)
  b.probing = false

  if (ok) {
    if (b.openUntil !== 0) console.warn(`[breaker] ${name} is answering again`)
    b.fails = 0
    b.openUntil = 0
    return
  }

  b.fails += 1
  if (b.fails >= FAILS_TO_OPEN) {
    // Re-opened on a failed probe as well, which is what stops a dead
    // transport from being retried on every single send forever.
    if (b.openUntil === 0) {
      console.warn(`[breaker] ${name} failed ${b.fails} times in a row - skipping it for ${OPEN_MS / 1000}s`)
    }
    b.openUntil = now + OPEN_MS
  }
}

/** For the check scripts and tests. Never read this to make a decision. */
export function breakerStatus(name: string, now = Date.now()) {
  const b = get(name)
  return {
    fails: b.fails,
    open: b.openUntil > now,
    msUntilRetry: Math.max(0, b.openUntil - now),
  }
}

/** Tests only: forget everything learned. */
export function resetBreakers(): void {
  breakers.clear()
}

export const BREAKER = { FAILS_TO_OPEN, OPEN_MS }
