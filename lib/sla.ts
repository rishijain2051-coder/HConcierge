// One definition of "is this request late", shared by the staff board colours,
// the guest's status line and the job list behind every WhatsApp message. If
// these ever disagree, staff stop trusting the board.
//
// Two other places decide lateness in SQL and do not come through here: the
// escalation sweep in lib/notify.ts, and the on-time counts in lib/history.ts.
// Anything that changes what "late" means has to change all three.

export type SlaState = 'done' | 'ok' | 'warn' | 'late'

export type SlaInput = {
  created_at: string | Date
  /**
   * The hour the guest asked for, when they asked for one.
   *
   * A wake-up call booked at midnight for seven is not nine minutes late at
   * ten past twelve. The promise starts when the work is due, which for
   * anything unscheduled is the moment it arrived.
   */
  scheduled_for?: string | Date | null
  sla_minutes: number
  status: string
  completed_at?: string | Date | null
}

export const WARN_AT = 0.6 // amber once 60% of the promised time is gone

export function minutesElapsed(from: string | Date, to: Date = new Date()): number {
  return (to.getTime() - new Date(from).getTime()) / 60000
}

/** When the clock starts: the hour it was booked for, or the moment it arrived. */
function startsAt(r: SlaInput): string | Date {
  return r.scheduled_for ?? r.created_at
}

/** A scheduled request whose hour has not come round yet. Nobody is late. */
export function notDueYet(r: SlaInput, now: Date = new Date()): boolean {
  return r.scheduled_for != null && new Date(r.scheduled_for) > now
}

export function slaState(r: SlaInput, now: Date = new Date()): SlaState {
  if (r.status === 'done' || r.status === 'cancelled') return 'done'
  const elapsed = minutesElapsed(startsAt(r), now)
  const budget = r.sla_minutes || 15
  if (elapsed >= budget) return 'late'
  if (elapsed >= budget * WARN_AT) return 'warn'
  return 'ok'
}

/** Minutes left before the promise is broken. Negative once it already is. */
export function minutesRemaining(r: SlaInput, now: Date = new Date()): number {
  return Math.round((r.sla_minutes || 15) - minutesElapsed(startsAt(r), now))
}

/**
 * "12m ago", or just "just now" — which does not take an "ago" after it.
 *
 * Three screens appended one themselves and all three read wrong for the first
 * sixty seconds of a request's life, which is exactly when people look.
 */
export function since(from: string | Date, now: Date = new Date()): string {
  const age = formatAge(from, now)
  return age === 'just now' ? age : `${age} ago`
}

export function formatAge(from: string | Date, now: Date = new Date()): string {
  const m = Math.floor(minutesElapsed(from, now))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`
}
