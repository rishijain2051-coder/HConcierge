import { sql } from './db'
import type { Category, ChatMessage, GuestRequest, GuestState, InfoPage, Item, Property, Room } from './types'

export type RoomContext = { room: Room; property: Property }

/** The QR token is the guest's only credential, so this is the front door. */
export async function loadRoom(token: string): Promise<RoomContext | null> {
  if (!token || token.length > 64) return null
  const rows = await sql<(Room & { p_id: string; p_slug: string; p_name: string; p_address: string | null; p_phone: string | null; p_brand: string })[]>`
    select r.id, r.property_id, r.number, r.floor, r.room_type, r.token, r.occupied,
           r.guest_name, r.checked_in_at,
           p.id as p_id, p.slug as p_slug, p.name as p_name,
           p.address as p_address, p.phone as p_phone, p.brand_color as p_brand
      from rooms r join properties p on p.id = r.property_id
     where r.token = ${token} limit 1`

  const r = rows[0]
  if (!r) return null
  return {
    room: {
      id: r.id, property_id: r.property_id, number: r.number, floor: r.floor,
      room_type: r.room_type, token: r.token, occupied: r.occupied,
      guest_name: r.guest_name, checked_in_at: r.checked_in_at,
    },
    property: {
      id: r.p_id, slug: r.p_slug, name: r.p_name,
      address: r.p_address, phone: r.p_phone, brand_color: r.p_brand,
    },
  }
}

/** Two queries and a stitch, rather than one per category. */
export async function loadDirectory(propertyId: string): Promise<Category[]> {
  const [categories, items] = await Promise.all([
    sql<Omit<Category, 'items'>[]>`
      select id, kind, name, icon from categories
       where property_id = ${propertyId} and active
       order by sort, name`,
    sql<Item[]>`
      select i.id, i.category_id, i.name, i.description, i.price_paise, i.unit, i.department,
             i.sla_minutes, i.veg, i.needs_time, i.modifier_groups, i.available
        from items i join categories c on c.id = i.category_id
       where i.property_id = ${propertyId} and c.active
       order by i.sort, i.name`,
  ])

  const byCategory = new Map<string, Item[]>()
  for (const item of items) {
    const list = byCategory.get(item.category_id)
    if (list) list.push(item)
    else byCategory.set(item.category_id, [item])
  }
  return categories
    .map((c) => ({ ...c, items: byCategory.get(c.id) ?? [] }))
    .filter((c) => c.items.length > 0)
}

export async function loadInfoPages(propertyId: string): Promise<InfoPage[]> {
  return sql<InfoPage[]>`
    select id, slug, title, body, icon from info_pages
     where property_id = ${propertyId} and active
     order by sort, title`
}

const RECENT_REQUESTS = 30
const RECENT_MESSAGES = 80

/** Everything the guest screen shows and re-polls. */
export async function loadGuestState(roomId: string): Promise<GuestState> {
  const [requests, messages, folio] = await Promise.all([
    sql<GuestRequest[]>`
      select id, ref::text as ref, kind, department, status, note, scheduled_for, total_paise,
             sla_minutes, created_at, updated_at, acknowledged_at, completed_at, escalated_at,
             cancel_reason
        from requests
       where room_id = ${roomId}
       order by created_at desc
       limit ${RECENT_REQUESTS}`,
    sql<ChatMessage[]>`
      select m.id, m.sender, s.name as staff_name, m.body, m.created_at
        from messages m left join staff s on s.id = m.staff_id
       where m.room_id = ${roomId}
       order by m.created_at desc
       limit ${RECENT_MESSAGES}`,
    sql<{ total: string | null }[]>`
      select sum(amount_paise)::text as total from folio_entries
       where room_id = ${roomId} and voided_at is null`,
  ])

  const lines = requests.length
    ? await sql<(GuestRequest['items'][number] & { request_id: string })[]>`
        select id, request_id, name, qty, unit_price_paise, modifiers, note
          from request_items
         where request_id = any(${requests.map((r) => r.id)})`
    : []

  const byRequest = new Map<string, GuestRequest['items']>()
  for (const line of lines) {
    const list = byRequest.get(line.request_id)
    if (list) list.push(line)
    else byRequest.set(line.request_id, [line])
  }

  return {
    requests: requests.map((r) => ({ ...r, items: byRequest.get(r.id) ?? [] })),
    messages: messages.reverse(), // query is newest-first for the LIMIT; UI reads oldest-first
    folio_total_paise: Number(folio[0]?.total ?? 0),
  }
}
