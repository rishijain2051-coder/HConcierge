import { cache } from 'react'
import { sql } from './db'
import type { Category, ChatMessage, FolioLine, GuestRequest, GuestState, InfoPage, Property, Room } from './types'

export type RoomContext = { room: Room; property: Property }

/**
 * The QR token is the guest's only credential, so this is the front door.
 *
 * Memoised per request: `generateMetadata` and the page itself both need the
 * room, and without this the guest paid two identical round trips before a
 * single pixel rendered.
 */
export async function readRoom(token: string): Promise<RoomContext | null> {
  if (!token || token.length > 64) return null
  const rows = await sql<(Room & { p_id: string; p_slug: string; p_name: string; p_address: string | null; p_phone: string | null; p_brand: string; p_timezone: string })[]>`
    select r.id, r.property_id, r.number, r.floor, r.room_type, r.token, r.occupied,
           r.guest_name, r.checked_in_at,
           p.id as p_id, p.slug as p_slug, p.name as p_name,
           p.address as p_address, p.phone as p_phone, p.brand_color as p_brand,
           p.timezone as p_timezone
      from rooms r
      join properties p on p.id = r.property_id
      -- A suspended customer's guests get the not-found screen rather than a
      -- working order form, because requests arriving for a hotel whose staff
      -- can no longer sign in is worse than the door being shut. Left join: a
      -- property with no organisation predates multi-tenancy and still works.
      left join organisations o on o.id = p.organisation_id
     where r.token = ${token} and o.suspended_at is null limit 1`

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
      address: r.p_address, phone: r.p_phone, brand_color: r.p_brand, timezone: r.p_timezone,
    },
  }
}

/**
 * Memoised per request: `generateMetadata` and the page itself both need the
 * room, and without this the guest paid two identical round trips before a
 * single pixel rendered. Streams use `readRoom` - they exist to notice change.
 */
export const loadRoom = cache(readRoom)

/** The whole menu in one round trip, already nested. */
export async function loadDirectory(propertyId: string): Promise<Category[]> {
  const rows = await sql<Category[]>`
    select c.id, c.kind, c.name, c.icon, coalesce(i.items, '[]'::json) as items
      from categories c
      left join lateral (
        select json_agg(json_build_object(
                 'id', it.id, 'category_id', it.category_id, 'name', it.name,
                 'description', it.description, 'price_paise', it.price_paise, 'unit', it.unit,
                 'department', it.department, 'sla_minutes', it.sla_minutes, 'veg', it.veg,
                 'needs_time', it.needs_time, 'modifier_groups', it.modifier_groups,
                 'available', it.available)
                 order by it.sort, it.name) as items
          from items it where it.category_id = c.id
      ) i on true
     where c.property_id = ${propertyId} and c.active
     order by c.sort, c.name`
  return rows.filter((c) => c.items.length > 0)
}

export async function loadInfoPages(propertyId: string): Promise<InfoPage[]> {
  return sql<InfoPage[]>`
    select id, slug, title, body, icon from info_pages
     where property_id = ${propertyId} and active
     order by sort, title`
}

const RECENT_REQUESTS = 30
const RECENT_MESSAGES = 60

/** Everything the guest screen shows and re-polls. */
/**
 * Everything the guest screen shows, in a single round trip.
 *
 * This used to be four parallel queries and then a fifth for the order lines -
 * two crossings to Mumbai, paid on every load and every push. Assembling it in
 * the database costs nothing there and removes a whole wave here.
 */
export async function loadGuestState(roomId: string): Promise<GuestState> {
  const [row] = await sql<
    {
      requests: GuestRequest[] | null
      messages: ChatMessage[] | null
      folio: FolioLine[] | null
      folio_total_paise: number
      settle_requested_at: string | null
    }[]
  >`
    select
      (select json_agg(r order by r.created_at desc) from (
         select rq.id, rq.ref::text as ref, rq.kind, rq.department, rq.status, rq.note,
                rq.scheduled_for, rq.total_paise, rq.sla_minutes, rq.created_at, rq.updated_at,
                rq.acknowledged_at, rq.completed_at, rq.escalated_at, rq.cancel_reason,
                coalesce(li.items, '[]'::json) as items
           from requests rq
           left join lateral (
             select json_agg(json_build_object(
                      'id', ri.id, 'name', ri.name, 'qty', ri.qty,
                      'unit_price_paise', ri.unit_price_paise, 'modifiers', ri.modifiers,
                      'note', ri.note, 'done_at', ri.done_at)) as items
               from request_items ri where ri.request_id = rq.id
           ) li on true
          where rq.room_id = ${roomId}
          order by rq.created_at desc
          limit ${RECENT_REQUESTS}
       ) r)                                                        as requests,

      -- Oldest-first for the UI, but the LIMIT has to take the newest.
      (select json_agg(m order by m.created_at) from (
         select ms.id, ms.sender, s.name as staff_name, ms.body, ms.created_at
           from messages ms left join staff s on s.id = ms.staff_id
          where ms.room_id = ${roomId}
          order by ms.created_at desc
          limit ${RECENT_MESSAGES}
       ) m)                                                        as messages,

      (select json_agg(f order by f.created_at desc) from (
         select fe.id, fe.description, fe.amount_paise, fe.created_at, rq.ref::text as ref
           from folio_entries fe
           left join requests rq on rq.id = fe.request_id
          where fe.room_id = ${roomId} and fe.voided_at is null and fe.settled_at is null
       ) f)                                                        as folio,

      coalesce((select sum(amount_paise)::int from folio_entries
                 where room_id = ${roomId} and voided_at is null and settled_at is null), 0)
                                                                   as folio_total_paise,
      (select settle_requested_at from rooms where id = ${roomId}) as settle_requested_at`

  return {
    requests: row?.requests ?? [],
    messages: row?.messages ?? [],
    folio: row?.folio ?? [],
    folio_total_paise: row?.folio_total_paise ?? 0,
    settle_requested_at: row?.settle_requested_at ?? null,
  }
}
