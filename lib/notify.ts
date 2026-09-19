import { sql } from './db'
import { breakerAllows, breakerRecord } from './breaker'
import { pushToStaff } from './push'
import { audit } from './audit'
import { baseUrl } from './qr'
import { signStaffLink, staffLinkUrl } from './staff-link'
import { rupees } from './money'
import { departmentLabel } from './types'

/**
 * Outbound WhatsApp/SMS.
 *
 * Two transports, and this is the only place in the app that either of them is
 * reached from - sweepEscalations, notifyNewRequest, the board poll and the
 * pg_cron backstop all come through sendMessage.
 *
 *   OPENWA_URL set  →  a self-hosted WhatsApp gateway (see
 *                      WHATSAPP-TESTING-PLAN.md). Unofficial, for testing only.
 *   otherwise       →  Twilio's REST API, which is the production path.
 *
 * Twilio is a plain fetch rather than the `twilio` SDK: sending one message is a
 * form POST with basic auth, and the SDK is 4MB of surface area for that.
 *
 * Everything here no-ops (and logs) when neither is configured, so the app runs
 * fine in dev and in a demo without an account.
 */

const SID = () => process.env.TWILIO_ACCOUNT_SID
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN
const FROM = () => process.env.TWILIO_FROM

const WA_URL = () => process.env.OPENWA_URL?.replace(/\/$/, '')
const WA_SESSION = () => process.env.OPENWA_SESSION
const WA_KEY = () => process.env.OPENWA_KEY

export function messagingConfigured(): boolean {
  return Boolean((SID() && TOKEN() && FROM()) || (WA_URL() && WA_SESSION() && WA_KEY()))
}

/**
 * Staff phones are typed by hand into Manage → Staff, so they arrive as
 * "+91 98765 43210" as often as not. The gateway wants bare digits.
 *
 * A number stored without its country code cannot be repaired here - prefixing
 * a default would send someone else's phone a guest's room number. It is
 * refused instead, and the caller logs it.
 */
function chatId(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? `${digits}@c.us` : null
}

/** The self-hosted gateway. False means "did not send", including "not configured". */
async function viaGateway(to: string, body: string): Promise<boolean> {
  const [waUrl, waSession, waKey] = [WA_URL(), WA_SESSION(), WA_KEY()]
  if (!waUrl || !waSession || !waKey) return false

  const chat = chatId(to)
  if (!chat) {
    console.error(`[notify] unusable phone number, not sending: ${to}`)
    // Deliberately before the breaker and not recorded as a failure: a number
    // stored without its country code is wrong about that number for ever,
    // and counting it would take a working transport out of the rotation.
    return false
  }

  // Skipped while the breaker is open, so the caller falls through to Twilio
  // at once rather than waiting out a connect to a laptop that is shut.
  if (!breakerAllows('gateway')) return false

  try {
    const res = await fetch(`${waUrl}/api/sessions/${waSession}/messages/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': waKey },
      // linkPreview off on both engines: whatsapp-web.js builds one by default
      // and this suppresses it, while on Baileys a preview is an opt-in
      // blocking fetch per URL. Either way there is no reason to hand a
      // previewer a staff member's job-list URL.
      body: JSON.stringify({ chatId: chat, text: body, linkPreview: false }),
    })
    if (!res.ok) {
      console.error('[notify] gateway rejected:', res.status, await res.text())
      // A 4xx from a reachable gateway is still a failure of this transport -
      // an expired session answers 401 and will answer 401 to the next fifty
      // messages just as fast.
      breakerRecord('gateway', false)
      return false
    }
    breakerRecord('gateway', true)
    return true
  } catch (err) {
    console.error('[notify] gateway request failed', err)
    breakerRecord('gateway', false)
    return false
  }
}

/** Twilio's REST API. The durable path, and the one that survives a closed laptop. */
async function viaTwilio(to: string, body: string): Promise<boolean> {
  const [sid, token, from] = [SID(), TOKEN(), FROM()]
  if (!sid || !token || !from) return false

  // A whatsapp: sender can only message a whatsapp: recipient, and vice versa.
  const recipient = from.startsWith('whatsapp:') && !to.startsWith('whatsapp:') ? `whatsapp:${to}` : to

  // The last transport there is, so an open breaker here means nothing goes
  // out at all - which is still the right answer. Six hanging requests inside
  // one `maxDuration` is how a sweep dies half-finished, and a sweep that dies
  // half-finished leaves rungs unfired with `escalated_at` already stamped.
  if (!breakerAllows('twilio')) return false

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
      breakerRecord('twilio', false)
      return false
    }
    breakerRecord('twilio', true)
    return true
  } catch (err) {
    console.error('[notify] twilio request failed', err)
    breakerRecord('twilio', false)
    return false
  }
}

/**
 * Try the gateway, then Twilio.
 *
 * The fall-through is the point, not a nicety. The gateway is a process on
 * somebody's laptop; Twilio is a service. If the gateway were the only path
 * whenever it happens to be configured, a closed lid would silence escalation
 * while a working transport sat there unused - an invisible failure of the one
 * thing this file exists to do. So a gateway that is unreachable, unauthorised
 * or simply slow hands off rather than giving up.
 *
 * The cost is that a message can arrive by SMS instead of WhatsApp without
 * anyone being told, and it will carry a link that still works. That is the
 * right trade while the gateway is an experiment.
 */
export async function sendMessage(to: string, body: string): Promise<boolean> {
  // OPENWA_OUTBOX reverses the direction: write the message down and let a
  // drainer beside the gateway pick it up. This exists because Tailscale Funnel
  // does not serve this tailnet, so Vercel cannot reach the gateway at all -
  // see WHATSAPP-TESTING-PLAN.md §2. Queueing also means a laptop that is asleep
  // delays a message rather than losing it.
  //
  // ponytail: nothing else fires in this mode, so an unattended queue is a
  // silent backlog. Run `node db/outbox.mjs` beside the gateway; if this ever
  // outlives the experiment, have the drainer fall back to Twilio on rows older
  // than a few minutes.
  if (process.env.OPENWA_OUTBOX === '1') {
    try {
      await sql`insert into outbound_messages (phone, body) values (${to}, ${body})`
      return true
    } catch (err) {
      console.error('[notify] could not queue a message', err)
      // Fall through - a broken queue must not be quieter than no queue.
    }
  }

  if (await viaGateway(to, body)) return true
  if (await viaTwilio(to, body)) return true
  console.log(`[notify] (undelivered, no transport succeeded) → ${to}: ${body}`)
  return false
}

type Recipient = { id: string; name: string; phone: string; phone_verified_at: Date | null }

/**
 * Never let a missing origin stop an escalation. baseUrl() reads the live
 * request, and every caller of the sweep is inside one - but a message that
 * arrives without its link still gets somebody to the room, and one that never
 * arrives does not.
 */
export async function linkBase(): Promise<string | null> {
  try {
    return await baseUrl()
  } catch {
    return null
  }
}

/**
 * The line that turns a notification into something actionable.
 *
 * One link, and it is the same link every time: that person's own job list.
 * The token names a person and never a request, so it cannot go stale, it is
 * identical across every message they get, and `?r=` only says which row to
 * highlight.
 *
 * An unverified number gets the words and no link - see
 * WHATSAPP-TESTING-PLAN.md §5. It is never simply skipped: a late request
 * reaching nobody because of a settings flag is precisely the failure this path
 * exists to prevent, and it would be invisible.
 */
function actionLine(base: string | null, who: Recipient, ref: string): string {
  const board = 'Open the board to accept.'
  if (!base) return board
  // Shorter than it was. The old version spent a parenthetical explaining
  // verification to somebody holding a phone in a corridor.
  if (!who.phone_verified_at) return `${board} (Number not verified for one-tap.)`
  try {
    return staffLinkUrl(base, signStaffLink(who.id), ref)
  } catch (err) {
    console.error('[notify] could not sign an action link', err)
    return board
  }
}

/**
 * Every message the product sends, in one shape.
 *
 *   *Late · Room 401*
 *   Bath towels · Housekeeping · RN Grand
 *   13 min old, target 10. Nobody has picked it up.
 *   <link>
 *
 * The first line is the whole point: WhatsApp's notification preview truncates
 * at around forty characters, and the old format spent twenty-two of them on
 * "HConcierge · RN Grand:" before reaching the room number. A duty manager
 * glancing at a lock screen now reads the status and the room without opening
 * anything.
 *
 * "HConcierge" is gone from the body entirely. It was there to make an unknown
 * sender trustworthy, but the recipient has had the same number messaging them
 * all week - repeating the brand on every line is the clutter, not the trust.
 * The property stays, because one person covering two hotels cannot read a room
 * number alone, but it moves to the facts line where it belongs.
 *
 * Bold with single asterisks: WhatsApp renders it, and Twilio SMS degrades to
 * literal asterisks, which still reads as emphasis.
 */
function headline(status: string, room: string, ref: string): string {
  return `*${status} · Room ${room} · #${ref}*`
}

/**
 * The which-and-where line. Deduplicated, because a request with no note falls
 * back to its team name for a summary, and "Housekeeping · Housekeeping · RN
 * Grand" is exactly the kind of line this rewrite exists to remove.
 */
function facts(...parts: (string | null | undefined)[]): string {
  return [...new Set(parts.filter((p): p is string => Boolean(p && p.trim())))].join(' · ')
}

/**
 * The items, as a line or as a list.
 *
 * One thing reads better inline. Three joined with commas is a run-on sentence
 * somebody has to parse in a corridor - "2× Bath towels, Clean my room,
 * Toiletries kit" is three jobs pretending to be one. The board learned this
 * first; the message and the job-list page were still joining with commas,
 * which is what a list on one screen and prose on another looks like.
 *
 * Bulleted with a middot rather than a hyphen: WhatsApp turns a leading "- "
 * into its own list formatting on some clients and leaves it literal on
 * others, and the inconsistency is worse than either.
 */
export function itemLines(items: string[] | null, fallback: string): string {
  if (!items || items.length === 0) return fallback
  if (items.length === 1) return items[0]
  return items.map((i) => `• ${i}`).join('\n')
}

/** Plain English for a status, rather than the column value. */
function waiting(status: string): string {
  if (status === 'new') return 'Nobody has picked it up.'
  if (status === 'ack') return 'Accepted, not started.'
  return 'In progress.'
}

/**
 * The hotel's own name for a team, when it has one.
 *
 * Teams became rows on main, so an organisation can rename "Spa & wellness" or
 * add one the four hardcoded slugs never covered. `departmentLabel` humanises an
 * unknown slug to "Spa wellness", which is not wrong but is not what anybody
 * typed either - so every query here joins `departments` on its unique
 * (organisation_id, slug) index. A join rather than a separate lookup because
 * this file is on the escalation path, and round trips are the cost this project
 * is explicitly trying not to spend.
 */
function teamName(team: string | null, department: string): string {
  return team ?? departmentLabel(department)
}

/**
 * Who hears about a request on this team, at this property.
 *
 * One definition because this predicate has now drifted twice behind a schema
 * change - teams became rows, then one person could cover several - and it is
 * read by both the new-request ping and the completion notice. A miss here is
 * silent: the board scoping stays correct, so the person still sees the request
 * and simply never gets told about it.
 *
 * `extra_teams` is the second team a department account covers. `department`
 * still holds their main one, so a housekeeper also covering the spa is reached
 * by either.
 *
 * `includeSupervisors` is whether managers and admins are reached by *role* -
 * every manager at the property, whatever team the request belongs to. The
 * new-request ping turns it off, because a manager whose phone buzzes for every
 * towel stops reading any of them, and lateness is what they are for. They keep
 * escalation and the completion notice.
 *
 * It drops the clause rather than excluding the role, and that distinction is
 * load-bearing: at a small hotel the manager may be the only person in a team
 * with a phone, and `role not in ('manager','admin')` would route that team's
 * requests to nobody. A manager whose `department` really is housekeeping still
 * gets housekeeping's requests.
 */
function teamRecipients(propertyId: string, department: string, includeSupervisors = true) {
  return sql<Recipient[]>`
    select id, name, phone, phone_verified_at from staff
     where active and phone is not null and phone <> ''
       and property_id = ${propertyId}
       and (department = ${department}
            or ${department} = any(extra_teams)
            or department = 'all'
            or (${includeSupervisors} and role in ('manager','admin')))`
}

/**
 * The same team, but by id and without the phone clause.
 *
 * `teamRecipients` above insists on a number, because a message needs one.
 * Push does not, and that difference is most of what it is worth: the
 * housekeeper whose number was never verified, or was never collected, is
 * unreachable by WhatsApp and perfectly reachable on the handset in their hand.
 */
function teamStaffIds(propertyId: string, department: string, includeSupervisors = false) {
  return sql<{ id: string }[]>`
    select id from staff
     where active and property_id = ${propertyId}
       and (department = ${department}
            or ${department} = any(extra_teams)
            or department = 'all'
            or (${includeSupervisors} and role in ('manager','admin')))`
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
  items: string[] | null
  team: string | null
  property: string
  rule_id: string
  step: number
  notify_managers: boolean
  notify_admins: boolean
  minutes_waiting: number
  /**
   * `escalation_step` as it was *before* this sweep raised it, so 0 means this
   * is the first rung this request has passed. The `due` CTE reads the
   * pre-update row, which is also how `e.step > r.escalation_step` works.
   */
  was: number
  /** The person who accepted it, joined in rather than fetched per request. */
  assignee_id: string | null
  assignee_name: string | null
  assignee_phone: string | null
  assignee_verified: Date | null
  assignee_active: boolean | null
}

/**
 * The nudge sideways, to whoever can actually clear it.
 *
 * The ladder tells managers, and that is the point of it - but the person who
 * could finish the job in ninety seconds is not on the ladder, so a late
 * request used to travel upwards and never sideways. The manager's first move
 * was always to go and tell them anyway.
 *
 * Who gets it depends on the state, because the alternative is noise:
 *
 *   new             → the team, since any of them can pick it up
 *   ack, in_progress → only the person holding it; the rest cannot help, and a
 *                      message about somebody else's job is the kind nobody
 *                      reads twice
 *
 * **Once per request, on the first rung only.** After that the manager owns it
 * and the team has already been told, so a reminder per rung would multiply the
 * one cost this file is careful about. `was` is the pre-sweep step, so 0 is the
 * first rung whatever the ladder is numbered.
 *
 * Anyone already on the rung's own list is dropped - at a small hotel the duty
 * manager's department really is housekeeping, and two messages about one towel
 * is how somebody learns to ignore both.
 */
async function remindOwners(r: FiredRow, already: Recipient[], base: string | null): Promise<void> {
  if (r.was > 0) return

  const usable = (p: Recipient | null): p is Recipient => Boolean(p && p.phone && p.phone.trim())
  const holder: Recipient | null =
    r.assignee_id && r.assignee_active
      ? {
          id: r.assignee_id,
          name: r.assignee_name ?? '',
          phone: r.assignee_phone ?? '',
          phone_verified_at: r.assignee_verified,
        }
      : null

  const targets =
    r.status === 'new'
      ? await teamRecipients(r.property_id, r.department, false)
      : [holder].filter(usable)

  const told = new Set(already.map((p) => p.id))
  const people = targets.filter((p) => !told.has(p.id))
  if (people.length === 0) return

  const text = [
    // Not "Late": that word is the manager's, and this message is going to the
    // person who is about to fix it rather than to the person who wants to know
    // why it was not fixed.
    headline('Still waiting', r.room_number, r.ref),
    facts(teamName(r.team, r.department), r.property),
    itemLines(r.items, r.summary || teamName(r.team, r.department)),
    r.items && r.items.length > 0 && r.summary ? `“${r.summary}”` : null,
    `${Math.round(r.minutes_waiting)} min old, target ${r.sla_minutes}. ${waiting(r.status)}`,
  ]
    .filter(Boolean)
    .join('\n')

  await Promise.all(people.map((p) => sendMessage(p.phone, `${text}\n${actionLine(base, p, r.ref)}`)))
}

/**
 * Walks the escalation ladder and tells whoever that rung names.
 *
 * A request carries `escalation_step`, so each rung fires once. The join picks
 * every rung a request has now passed and `distinct on` keeps the highest -
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
  /**
   * When a request's clock starts: the hour it was booked for, or the moment it
   * arrived. The same rule as startsAt() in lib/sla.ts, which names this sweep
   * as one of the three places that decide lateness and have to agree.
   *
   * Measuring from created_at woke a duty manager for work that was not due
   * yet. Observed on the running app: a spa treatment booked at 17:02 for
   * 19:06 with a 20-minute target escalated at 17:22 - one hour forty-four
   * minutes before anybody could have started it. A 7am wake-up call ordered
   * at midnight escalates at ten past twelve.
   */
  const dueFrom = sql`coalesce(r.scheduled_for, r.created_at)`

  const fired = await sql<FiredRow[]>`
    with due as (
      select distinct on (r.id)
             r.id, r.ref::text as ref, r.property_id, p.organisation_id, r.department, r.status,
             r.sla_minutes, rm.number as room_number, r.note as summary, d.name as team,
             -- The items, as an array rather than a joined string, so the
             -- message can decide between a line and a list. This query used to
             -- select only the note, so a late three-item request named the
             -- guest's comment and never what had actually been asked for.
             -- (No backticks in here: this is inside a tagged template, and a
             -- backtick in a SQL comment ends the template literal.)
             (select array_agg(case when ri.qty > 1 then ri.qty || '× ' || ri.name else ri.name end
                               order by ri.name)
                from request_items ri where ri.request_id = r.id) as items,
             p.name as property,
             e.id as rule_id, e.step, e.notify_managers, e.notify_admins,
             extract(epoch from (now() - ${dueFrom})) / 60 as minutes_waiting,
             r.escalation_step as was,
             asg.id as assignee_id, asg.name as assignee_name, asg.phone as assignee_phone,
             asg.phone_verified_at as assignee_verified, asg.active as assignee_active
        from requests r
        join rooms rm on rm.id = r.room_id
        join properties p on p.id = r.property_id
        left join departments d
          on d.organisation_id = p.organisation_id and d.slug = r.department
        -- Joined, not fetched per request: this is the escalation path and the
        -- cost here is round trips. At most one row, so it cannot multiply the
        -- distinct on.
        left join staff asg on asg.id = r.assigned_to
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
         and now() >= ${dueFrom} + ((r.sla_minutes + e.after_minutes) || ' minutes')::interval
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
    // named on it. Admins are scoped to the property's OWN organisation - the
    // previous `or role = 'admin'` sent every escalation to every admin in the
    // database, which across customers is a leak.
    const people = await sql<Recipient[]>`
      select distinct s.id, s.name, s.phone, s.phone_verified_at
        from staff s
       where s.active and s.phone is not null and s.phone <> ''
         and (
              (${r.notify_managers} and s.role = 'manager' and s.property_id = ${r.property_id})
           or (${r.notify_admins}   and s.role = 'admin'
                                    and s.organisation_id is not distinct from ${r.organisation_id})
           or s.id in (select staff_id from escalation_rule_staff where rule_id = ${r.rule_id})
         )`

    const base = await linkBase()

    // A rung that reaches nobody is worth a warning, but it must not swallow
    // the reminder as well: a ladder with no manager on a phone is exactly the
    // hotel where telling the team matters most. This used to `continue`.
    if (people.length === 0) {
      console.warn(`[notify] rung ${r.step} for request #${r.ref} names nobody with a phone number`)
    } else {
      const waited = Math.round(r.minutes_waiting)
      const text = [
        headline('Late', r.room_number, r.ref),
        facts(teamName(r.team, r.department), r.property),
        itemLines(r.items, r.summary || teamName(r.team, r.department)),
        // The guest's own words, kept but subordinate. They used to be the
        // summary line, which meant a late request named the comment and never
        // the work.
        r.items && r.items.length > 0 && r.summary ? `“${r.summary}”` : null,
        `${waited} min old, target ${r.sla_minutes}. ${waiting(r.status)}`,
      ]
        .filter(Boolean)
        .join('\n')
      await Promise.all(people.map((p) => sendMessage(p.phone, `${text}\n${actionLine(base, p, r.ref)}`)))
    }

    // And the same news to whatever devices are subscribed. Deliberately wider
    // than the rung: everyone the rung reached, plus the team who can actually
    // clear it, because a push is free and silent until somebody looks at it.
    // The service worker fetches the current state when it wakes, so a phone
    // that comes back online at 4.20am is told what is true at 4.20am.
    const woken = new Set(people.map((p) => p.id))
    for (const row of await teamStaffIds(r.property_id, r.department, true)) woken.add(row.id)
    await pushToStaff([...woken])

    await remindOwners(r, people, base)
  }

  return fired.length
}

/**
 * A request has just arrived.
 *
 * Two channels with two different rules. Push goes out every time: it costs
 * nothing, it needs no phone number, and it is the only thing that reaches
 * anybody when there is no board open - which at 4am is the whole point.
 * WhatsApp stays behind NOTIFY_ON_NEW, because new requests are by far the
 * largest source of message volume and every one of them is billed.
 */
export async function notifyNewRequest(requestId: string): Promise<void> {
  const [r] = await sql<
    { property_id: string; department: string; ref: string; room_number: string; note: string | null; team: string | null; property: string }[]
  >`select r.property_id, r.department, r.ref::text as ref, rm.number as room_number, r.note, d.name as team,
           p.name as property
      from requests r
      join rooms rm on rm.id = r.room_id
      join properties p on p.id = r.property_id
      left join departments d
        on d.organisation_id = p.organisation_id and d.slug = r.department
     where r.id = ${requestId} limit 1`
  if (!r) return

  // Supervisors off here too, for the same reason as below: a manager whose
  // phone buzzes for every towel stops looking at any of them.
  await pushToStaff((await teamStaffIds(r.property_id, r.department)).map((row) => row.id))

  if (process.env.NOTIFY_ON_NEW !== '1') return

  // Supervisors off: the team that does the work, not everyone who runs the
  // property. Escalation is how a manager hears about a request.
  const targets = await teamRecipients(r.property_id, r.department, false)

  // sweepEscalations has warned about a rung that reaches nobody since it was
  // written; this path never needed to, because the role clause meant a
  // property with any manager on it always had a recipient. Narrowing the
  // audience is what makes an empty result reachable, so it gets the same
  // warning - a team whose only phone was deactivated is otherwise silent.
  if (targets.length === 0) {
    console.warn(`[notify] new ${r.department} request #${r.ref} names nobody with a phone number`)
  }

  const text = [
    headline('New', r.room_number, r.ref),
    facts(teamName(r.team, r.department), r.property),
    r.note ? `“${r.note}”` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const base = await linkBase()
  await Promise.all(targets.map((t) => sendMessage(t.phone, `${text}\n${actionLine(base, t, r.ref)}`)))
}

/**
 * Confirmation that a request was finished. Off unless NOTIFY_ON_DONE=1.
 *
 * Same opt-in shape as notifyNewRequest, for the same reason: a hotel that has
 * not asked for a message on every completion should not start getting one
 * because the code shipped.
 *
 * Carries no link. There is nothing left to act on, and a link here would
 * invite a tap that lands on a list this request has already left - which is
 * the stale-picture problem the single live link exists to avoid. It names who
 * closed it and what it cost, which is what makes it verifiable.
 */
/**
 * Off, in code, and not behind an environment variable.
 *
 * NOTIFY_ON_DONE was already off by default and three completion notices still
 * went out, because one `NOTIFY_ON_DONE=1 npm run dev` in one terminal is all
 * it takes - a flag in an environment nobody owns is not a decision anybody can
 * rely on. lib/board.ts no longer calls this at all; this constant is the
 * second lock, so restoring it is two deliberate edits.
 *
 * It bought the least of the three notifications anyway: the guest already
 * watches the request move on their own screen, and the board shows the team
 * what they just finished. The body below is kept as the shape a completion
 * notice should have if a customer ever asks for one and agrees to pay for it.
 */
const COMPLETION_NOTICE = false

export async function notifyRequestDone(requestId: string): Promise<void> {
  if (!COMPLETION_NOTICE) return
  const [r] = await sql<
    {
      property_id: string
      department: string
      ref: string
      room_number: string
      total_paise: number
      finished_by: string | null
      items: string[] | null
      team: string | null
      property: string
    }[]
  >`
    select r.property_id, r.department, r.ref::text as ref, rm.number as room_number, r.total_paise,
           s.name as finished_by, d.name as team, p.name as property,
           (select array_agg(case when ri.qty > 1 then ri.qty || '× ' || ri.name else ri.name end
                             order by ri.name)
              from request_items ri where ri.request_id = r.id) as items
      from requests r
      join rooms rm on rm.id = r.room_id
      join properties p on p.id = r.property_id
      left join departments d
        on d.organisation_id = p.organisation_id and d.slug = r.department
      left join staff s on s.id = r.assigned_to
     where r.id = ${requestId} limit 1`
  if (!r) return

  const targets = await teamRecipients(r.property_id, r.department)

  const text = [
    headline('Done', r.room_number, r.ref),
    facts(teamName(r.team, r.department), r.property),
    itemLines(r.items, teamName(r.team, r.department)),
    [r.finished_by ? `By ${r.finished_by}.` : null, r.total_paise > 0 ? `${rupees(r.total_paise)} to the room folio.` : null]
      .filter(Boolean)
      .join(' ') || null,
  ]
    .filter(Boolean)
    .join('\n')
  await Promise.all(targets.map((t) => sendMessage(t.phone, text)))
}
