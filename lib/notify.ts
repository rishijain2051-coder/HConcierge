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

type FiredRow = {
  id: string
  ref: string
  property_id: string
  organisation_id: string | null
  department: string
  status: string
  sla_minutes: number
  room_number: string
  summary: string | null
  rule_id: string
  step: number
  notify_managers: boolean
  notify_admins: boolean
  minutes_waiting: number
}

/**
 * Walks the escalation ladder and tells whoever that rung names.
 *
 * A request carries `escalation_step`, so each rung fires once. The join picks
 * every rung a request has now passed and `distinct on` keeps the highest —
 * so a request that sat through two rungs while nobody was looking escalates
 * straight to the second, rather than trickling up one sweep at a time.
 *
 * Rungs are configured per property in Manage → Escalation. `after_minutes`
 * counts from the moment the request missed its own target.
 *
 * Called from the staff board poll (so it lands within seconds while anyone is
 * working) and from Supabase pg_cron every ten minutes (so it still fires at
 * 4am when no board is open). See db/cron.sql.
 */
export async function sweepEscalations(propertyId?: string): Promise<number> {
  const fired = await sql<FiredRow[]>`
    with due as (
      select distinct on (r.id)
             r.id, r.ref::text as ref, r.property_id, p.organisation_id, r.department, r.status,
             r.sla_minutes, rm.number as room_number, r.note as summary,
             e.id as rule_id, e.step, e.notify_managers, e.notify_admins,
             extract(epoch from (now() - r.created_at)) / 60 as minutes_waiting
        from requests r
        join rooms rm on rm.id = r.room_id
        join properties p on p.id = r.property_id
        join escalation_rules e
          on e.property_id = r.property_id
         and e.active
         and (e.department is null or e.department = r.department)
         and e.step > r.escalation_step
         and (
              (e.applies_to = 'unaccepted' and r.status = 'new')
           or (e.applies_to = 'unfinished' and r.status in ('ack','in_progress'))
           or (e.applies_to = 'any'        and r.status in ('new','ack','in_progress'))
         )
         and now() >= r.created_at + ((r.sla_minutes + e.after_minutes) || ' minutes')::interval
       where r.status in ('new','ack','in_progress')
         and ${propertyId ? sql`r.property_id = ${propertyId}` : sql`true`}
       order by r.id, e.step desc
    )
    update requests r
       set escalation_step = due.step,
           escalated_at = coalesce(r.escalated_at, now())
      from due
     where r.id = due.id
    returning due.*`

  if (fired.length === 0) return 0

  for (const r of fired) {
    await audit({
      propertyId: r.property_id,
      actor: 'system',
      action: 'request.escalated',
      entity: 'request',
      entityId: r.id,
      meta: { room: r.room_number, department: r.department, step: r.step, minutes: Math.round(r.minutes_waiting) },
    })
  }

  for (const r of fired) {
    // Recipients are resolved per rung: the groups it switched on, plus anyone
    // named on it. Admins are scoped to the property's OWN organisation — the
    // previous `or role = 'admin'` sent every escalation to every admin in the
    // database, which across customers is a leak.
    const people = await sql<{ name: string; phone: string }[]>`
      select distinct s.name, s.phone
        from staff s
       where s.active and s.phone is not null and s.phone <> ''
         and (
              (${r.notify_managers} and s.role = 'manager' and s.property_id = ${r.property_id})
           or (${r.notify_admins}   and s.role = 'admin'
                                    and s.organisation_id is not distinct from ${r.organisation_id})
           or s.id in (select staff_id from escalation_rule_staff where rule_id = ${r.rule_id})
         )`

    if (people.length === 0) {
      console.warn(`[notify] rung ${r.step} for request #${r.ref} names nobody with a phone number`)
      continue
    }

    const waited = Math.round(r.minutes_waiting)
    const text =
      `HConcierge: Room ${r.room_number} — ${r.summary || departmentLabel(r.department)} ` +
      `(#${r.ref}) is ${waited} min old, past its ${r.sla_minutes} min target and still ${r.status}.`
    await Promise.all(people.map((p) => sendMessage(p.phone, text)))
  }

  return fired.length
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
