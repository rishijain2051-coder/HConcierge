import { sql } from './db'
import { audit } from './audit'
import { departmentLabel } from './types'

/**
 * Outbound WhatsApp/SMS via Twilio's REST API.
 *
 * This is a plain fetch rather than the `twilio` SDK: sending one message is a
 * form POST with basic auth, and the SDK is 4MB of surface area for that.
 *
 * Everything here no-ops (and logs) when Twilio env vars are unset, so the app
 * runs fine in dev and in a demo without an account.
 */

const SID = () => process.env.TWILIO_ACCOUNT_SID
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN
const FROM = () => process.env.TWILIO_FROM

export function messagingConfigured(): boolean {
  return Boolean(SID() && TOKEN() && FROM())
}

export async function sendMessage(to: string, body: string): Promise<boolean> {
  const [sid, token, from] = [SID(), TOKEN(), FROM()]
  if (!sid || !token || !from) {
    console.log(`[notify] (not configured, would send) → ${to}: ${body}`)
    return false
  }
  // A whatsapp: sender can only message a whatsapp: recipient, and vice versa.
  const recipient = from.startsWith('whatsapp:') && !to.startsWith('whatsapp:') ? `whatsapp:${to}` : to

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: recipient, From: from, Body: body }),
    })
    if (!res.ok) {
      console.error('[notify] twilio rejected:', res.status, await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('[notify] twilio request failed', err)
    return false
  }
}

type EscalationRow = {
  id: string
  ref: string
  property_id: string
  department: string
  status: string
  sla_minutes: number
  created_at: Date
  room_number: string
  summary: string | null
  minutes_waiting: number
}

/**
 * Marks overdue requests as escalated and messages whoever should care.
 *
 * Two ways to be overdue:
 *   - nobody accepted it within its target time, or
 *   - somebody accepted it and then sat on it for twice that.
 * The second case is the one that actually generates complaints.
 *
 * Called opportunistically from the staff board poll (so escalation lands
 * within seconds while anyone is working) and from a Vercel cron (so it still
 * fires at 4am when no board is open).
 */
export async function sweepEscalations(propertyId?: string): Promise<number> {
  const rows = await sql<EscalationRow[]>`
    update requests r
       set escalated_at = now()
      from rooms rm
     where rm.id = r.room_id
       and r.escalated_at is null
       and r.status in ('new', 'ack', 'in_progress')
       and ${propertyId ? sql`r.property_id = ${propertyId}` : sql`true`}
       and (
         (r.status = 'new' and now() >= r.created_at + (r.sla_minutes || ' minutes')::interval)
         or (r.status in ('ack','in_progress')
             and now() >= r.created_at + (r.sla_minutes * 2 || ' minutes')::interval)
       )
    returning r.id, r.ref::text as ref, r.property_id, r.department, r.status,
              r.sla_minutes, r.created_at, rm.number as room_number, r.note as summary,
              extract(epoch from (now() - r.created_at)) / 60 as minutes_waiting`

  if (rows.length === 0) return 0

  for (const r of rows) {
    await audit({
      propertyId: r.property_id,
      actor: 'system',
      action: 'request.escalated',
      entity: 'request',
      entityId: r.id,
      meta: { room: r.room_number, department: r.department, minutes: Math.round(r.minutes_waiting) },
    })
  }

  // One lookup of who to tell, not one per request.
  const propertyIds = [...new Set(rows.map((r) => r.property_id))]
  const recipients = await sql<{ property_id: string; department: string; name: string; phone: string }[]>`
    select property_id, department, name, phone
      from staff
     where active and phone is not null and phone <> ''
       and role in ('manager', 'admin')
       and (property_id = any(${propertyIds}) or role = 'admin')`

  for (const r of rows) {
    const waited = Math.round(r.minutes_waiting)
    const text =
      `HConcierge: Room ${r.room_number} — ${r.summary || departmentLabel(r.department)} ` +
      `(#${r.ref}) is ${waited} min old, past its ${r.sla_minutes} min target and still ${r.status}.`
    const targets = recipients.filter((p) => p.property_id === r.property_id || p.property_id === null)
    await Promise.all(targets.map((p) => sendMessage(p.phone, text)))
  }

  return rows.length
}

/** Optional ping when a request first arrives. Off unless NOTIFY_ON_NEW=1. */
export async function notifyNewRequest(requestId: string): Promise<void> {
  if (process.env.NOTIFY_ON_NEW !== '1') return
  const [r] = await sql<{ property_id: string; department: string; ref: string; room_number: string; note: string | null }[]>`
    select r.property_id, r.department, r.ref::text as ref, rm.number as room_number, r.note
      from requests r join rooms rm on rm.id = r.room_id
     where r.id = ${requestId} limit 1`
  if (!r) return

  const targets = await sql<{ phone: string }[]>`
    select phone from staff
     where active and phone is not null and phone <> ''
       and property_id = ${r.property_id}
       and (department = ${r.department} or department = 'all' or role in ('manager','admin'))`

  const text = `HConcierge: new ${departmentLabel(r.department)} request from Room ${r.room_number} (#${r.ref}). ${r.note ?? ''}`.trim()
  await Promise.all(targets.map((t) => sendMessage(t.phone, text)))
}
