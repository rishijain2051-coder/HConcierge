import { after } from 'next/server'
import { sql } from './db'
import { audit } from './audit'
import { isWallClock } from './clock'
import { isUuid } from './scope'
import { notifyNewRequest } from './notify'
import type { Item, ModifierGroup, RequestKind } from './types'
import type { RoomContext } from './guest'

/**
 * Creating a request is the one place a guest writes to the database, so this
 * is a trust boundary. The client sends item ids, quantities and modifier
 * *names* — never prices. Every price is re-resolved here from the DB, because
 * a price sent from a phone is a price the guest chose.
 */

export type CartLine = {
  itemId: string
  qty: number
  modifiers?: { group: string; name: string }[]
  note?: string | null
}

export type CreateResult = { ok: true; refs: string[] } | { ok: false; error: string }

const MAX_QTY = 20
const MAX_LINES = 40
const MAX_NOTE = 500
const RATE_WINDOW_MINUTES = 5
const RATE_MAX_REQUESTS = 12

const KIND_BY_CATEGORY: Record<string, RequestKind> = {
  amenity: 'amenity',
  fnb: 'order',
  service: 'service',
  front_desk: 'front_desk',
}

type ItemRow = Item & { category_kind: string }

function resolveModifiers(item: ItemRow, chosen: { group: string; name: string }[]) {
  const groups: ModifierGroup[] = Array.isArray(item.modifier_groups) ? item.modifier_groups : []
  const resolved: { group: string; name: string; price_paise: number }[] = []

  for (const group of groups) {
    const picks = chosen.filter((c) => c.group === group.name)
    const seen = new Set<string>()
    for (const pick of picks) {
      const option = group.options.find((o) => o.name === pick.name)
      if (!option) return { error: `"${pick.name}" is not an option for ${item.name}.` }
      if (seen.has(option.name)) continue // a double-tap is not two portions
      seen.add(option.name)
      resolved.push({ group: group.name, name: option.name, price_paise: option.price_paise || 0 })
    }
    if (seen.size < (group.min ?? 0)) return { error: `Choose a ${group.name.toLowerCase()} for ${item.name}.` }
    if (group.max && seen.size > group.max) {
      return { error: `Pick at most ${group.max} from ${group.name.toLowerCase()} for ${item.name}.` }
    }
  }

  // Anything referencing a group the item does not have is a stale or forged cart.
  const known = new Set(groups.map((g) => g.name))
  if (chosen.some((c) => !known.has(c.group))) return { error: `That choice is no longer available for ${item.name}.` }

  return { resolved }
}

export async function createRequests(
  ctx: RoomContext,
  cart: CartLine[],
  opts: { note?: string | null; scheduledFor?: string | null } = {},
): Promise<CreateResult> {
  const { room, property } = ctx

  if (!Array.isArray(cart) || cart.length === 0) return { ok: false, error: 'Your basket is empty.' }
  if (cart.length > MAX_LINES) return { ok: false, error: 'That is too many items for one order.' }

  const [{ count: recent }] = await sql<{ count: number }[]>`
    select count(*)::int as count from requests
     where room_id = ${room.id}
       and created_at > now() - (${RATE_WINDOW_MINUTES} || ' minutes')::interval`
  if (recent >= RATE_MAX_REQUESTS) {
    return { ok: false, error: 'You have sent a lot of requests just now. Please give the team a few minutes.' }
  }

  // Postgres rejects a malformed uuid with 22P02, which surfaces as a 500 and
  // a stack trace in the log. A phone sending a bad id is a bad request, and
  // there is nothing to look up for one.
  const ids = [...new Set(cart.map((l) => l.itemId))].filter(isUuid)
  if (ids.length === 0) return { ok: false, error: 'We could not read that order. Please try again.' }
  const items = await sql<ItemRow[]>`
    select i.id, i.category_id, i.name, i.description, i.price_paise, i.unit, i.department,
           i.sla_minutes, i.veg, i.needs_time, i.modifier_groups, i.available, c.kind as category_kind
      from items i join categories c on c.id = i.category_id
     where i.id = any(${ids}) and i.property_id = ${property.id}`
  const byId = new Map(items.map((i) => [i.id, i]))

  // A `datetime-local` value carries no offset, and only one reading of it is
  // ever what the guest meant: the clock in the building they are standing in.
  // Their phone is often still on home time and this function can run in any
  // region, so neither of those clocks gets a vote — the property's zone is
  // what turns the string into an instant, in Postgres, which owns the tz
  // database and its DST history.
  let when: Date | null = null
  if (opts.scheduledFor) {
    if (!isWallClock(opts.scheduledFor)) return { ok: false, error: 'That time is not valid.' }
    // Both `::text` casts are load-bearing, however redundant they look.
    // With `prepare: false` postgres.js asks the server what type each
    // parameter is and then serialises to it — given a bare `::timestamp` it
    // decides the string is a date and rewrites it through *this process's*
    // timezone before sending, which lands the result 5½ hours out and is the
    // same class of bug this function exists to fix. Sent as text it arrives
    // verbatim, and Postgres performs the only conversion.
    const [row] = await sql<{ at: Date }[]>`
      select (${opts.scheduledFor}::text)::timestamp at time zone (${property.timezone}::text) as at`
    when = row.at
  }

  type Prepared = {
    item: ItemRow
    qty: number
    note: string | null
    modifiers: { group: string; name: string; price_paise: number }[]
    linePaise: number
  }
  const prepared: Prepared[] = []

  for (const line of cart) {
    const item = byId.get(line.itemId)
    if (!item) return { ok: false, error: 'Something in your basket is no longer on the menu.' }
    if (!item.available) return { ok: false, error: `${item.name} is not available right now.` }

    const qty = Math.floor(Number(line.qty))
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, error: `Choose between 1 and ${MAX_QTY} of ${item.name}.` }
    }
    if (item.needs_time) {
      if (!when) return { ok: false, error: `Please pick a time for ${item.name}.` }
      // A minute of slack for a slow thumb; beyond that, a wake-up call
      // scheduled for yesterday is a typo nobody will act on.
      if (when.getTime() < Date.now() - 60_000) {
        return { ok: false, error: `Pick a time in the future for ${item.name}.` }
      }
    }

    const mods = resolveModifiers(item, line.modifiers ?? [])
    if ('error' in mods) return { ok: false, error: mods.error! }

    const unit = item.price_paise + mods.resolved!.reduce((s, m) => s + m.price_paise, 0)
    prepared.push({
      item,
      qty,
      note: (line.note ?? '').slice(0, MAX_NOTE) || null,
      modifiers: mods.resolved!,
      linePaise: unit * qty,
    })
  }

  // One request per department: the kitchen should never see a towel request,
  // and housekeeping should not be waiting on a biryani.
  const groups = new Map<string, Prepared[]>()
  for (const p of prepared) {
    const list = groups.get(p.item.department)
    if (list) list.push(p)
    else groups.set(p.item.department, [p])
  }

  const refs: string[] = []
  const created: string[] = []

  for (const [department, lines] of groups) {
    const total = lines.reduce((s, l) => s + l.linePaise, 0)
    // Promise the slowest item's time, not the fastest — the request is only
    // done when the whole tray arrives.
    const slaMinutes = Math.max(...lines.map((l) => l.item.sla_minutes))
    const kind = KIND_BY_CATEGORY[lines[0].item.category_kind] ?? 'other'
    // The time belongs to the item that asked for one. One wake-up call in the
    // basket used to schedule the towels and the biryani for seven tomorrow.
    const scheduledFor = lines.some((l) => l.item.needs_time) ? when : null

    const [request] = await sql<{ id: string; ref: string }[]>`
      insert into requests (property_id, room_id, kind, department, note, scheduled_for,
                            total_paise, sla_minutes, guest_name)
      values (${property.id}, ${room.id}, ${kind}, ${department},
              ${(opts.note ?? '').slice(0, MAX_NOTE) || null},
              ${scheduledFor}, ${total}, ${slaMinutes}, ${room.guest_name})
      returning id, ref::text as ref`

    for (const l of lines) {
      await sql`
        insert into request_items (request_id, item_id, name, qty, unit_price_paise, modifiers, note)
        values (${request.id}, ${l.item.id}, ${l.item.name}, ${l.qty},
                ${l.item.price_paise}, ${sql.json(l.modifiers)}, ${l.note})`
    }

    refs.push(request.ref)
    created.push(request.id)

    await audit({
      propertyId: property.id,
      actor: `Room ${room.number}`,
      action: 'request.created',
      entity: 'request',
      entityId: request.id,
      meta: { department, kind, total_paise: total, items: lines.map((l) => `${l.qty}× ${l.item.name}`) },
    })
  }

  // after(), not a bare promise: a messaging hiccup must not fail the guest's
  // order, but on serverless an un-awaited fetch is abandoned when the function
  // freezes at response time — so the order would be placed and nobody told.
  for (const id of created) {
    after(() => notifyNewRequest(id).catch((err) => console.error('[notify] new request failed', err)))
  }

  return { ok: true, refs }
}

/** Free-text "something else" — becomes a front desk ticket. */
export async function createFreeformRequest(
  ctx: RoomContext,
  note: string,
  department = 'front_desk',
): Promise<CreateResult> {
  const text = note.trim().slice(0, MAX_NOTE)
  if (text.length < 2) return { ok: false, error: 'Tell us a little more.' }

  const [{ count: recent }] = await sql<{ count: number }[]>`
    select count(*)::int as count from requests
     where room_id = ${ctx.room.id}
       and created_at > now() - (${RATE_WINDOW_MINUTES} || ' minutes')::interval`
  if (recent >= RATE_MAX_REQUESTS) {
    return { ok: false, error: 'You have sent a lot of requests just now. Please give the team a few minutes.' }
  }

  const [request] = await sql<{ id: string; ref: string }[]>`
    insert into requests (property_id, room_id, kind, department, note, sla_minutes, guest_name)
    values (${ctx.property.id}, ${ctx.room.id}, 'other', ${department}, ${text}, 15, ${ctx.room.guest_name})
    returning id, ref::text as ref`

  await audit({
    propertyId: ctx.property.id,
    actor: `Room ${ctx.room.number}`,
    action: 'request.created',
    entity: 'request',
    entityId: request.id,
    meta: { kind: 'other', note: text },
  })
  after(() => notifyNewRequest(request.id).catch((err) => console.error('[notify] new request failed', err)))

  return { ok: true, refs: [request.ref] }
}

/** Guests may withdraw their own request while nobody has started on it. */
export async function cancelOwnRequest(ctx: RoomContext, requestId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(requestId)) return { ok: false, error: 'We could not find that request.' }

  const rows = await sql<{ id: string }[]>`
    update requests
       set status = 'cancelled', cancel_reason = 'Cancelled by guest', completed_at = now()
     where id = ${requestId} and room_id = ${ctx.room.id} and status in ('new', 'ack')
    returning id`
  if (rows.length === 0) return { ok: false, error: 'That request is already being worked on — send us a message instead.' }

  await audit({
    propertyId: ctx.property.id,
    actor: `Room ${ctx.room.number}`,
    action: 'request.cancelled',
    entity: 'request',
    entityId: requestId,
  })
  return { ok: true }
}
