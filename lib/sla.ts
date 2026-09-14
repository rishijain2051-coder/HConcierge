// One definition of "is this request late", shared by the escalation sweep,
// the staff board colours and the guest's status line. If these ever disagree,
// staff stop trusting the board.

export type SlaState = 'done' | 'ok' | 'warn' | 'late'

export type SlaInput = {
  created_at: string | Date
  sla_minutes: number
  status: string
  completed_at?: string | Date | null
}

export const WARN_AT = 0.6 // amber once 60% of the promised time is gone

export function minutesElapsed(from: string | Date, to: Date = new Date()): number {
  return (to.getTime() - new Date(from).getTime()) / 60000
}

export function slaState(r: SlaInput, now: Date = new Date()): SlaState {
  if (r.status === 'done' || r.status === 'cancelled') return 'done'
  const elapsed = minutesElapsed(r.created_at, now)
  const budget = r.sla_minutes || 15
  if (elapsed >= budget) return 'late'
  if (elapsed >= budget * WARN_AT) return 'warn'
  return 'ok'
}

/** Minutes left before the promise is broken. Negative once it already is. */
export function minutesRemaining(r: SlaInput, now: Date = new Date()): number {
  return Math.round((r.sla_minutes || 15) - minutesElapsed(r.created_at, now))
}

export function formatAge(from: string | Date, now: Date = new Date()): string {
  const m = Math.floor(minutesElapsed(from, now))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`
}
