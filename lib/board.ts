import { sql } from './db'
import { audit } from './audit'
import { postCharge, voidCharge } from './folio'
import { canTouchDepartment, canTouchProperty, visibleDepartments, type Staff } from './auth'
import { propRef, scopeTo } from './scope'
import { departmentLabel } from './types'
import type { BoardRequest, ChatMessage, RequestStatus } from './types'

/**
 * Everything the reception side reads and writes.
 *
 * Scoping lives here rather than in each page: a housekeeping account asking
 * for "the board" gets housekeeping's board, and a Pune account cannot reach a
 * Mumbai request even by guessing its id.
 */

/** Completed work stays on the board briefly so a shift can see what it did. */
const DONE_WINDOW_HOURS = 4

function propertyScope(staff: Staff, propertyId?: string | null) {
  return scopeTo(staff, sql`r.property_id`, propertyId)
}

function departmentScope(staff: Staff) {
  const visible = visibleDepartments(staff)
  return visible.length === 0 ? sql`true` : sql`r.department = any(${visible})`
}

export async function loadBoard(staff: Staff, propertyId?: string | null): Promise<BoardRequest[]> {
  const rows = await sql<BoardRequest[]>`
    select r.id, r.ref::text as ref, r.kind, r.department, r.status, r.note, r.scheduled_for,
           r.total_paise, r.sla_minutes, r.created_at, r.updated_at, r.acknowledged_at,
           r.completed_at, r.escalated_at, r.cancel_reason, r.assigned_to, r.property_id, r.room_id,
           rm.number as room_number, rm.floor as room_floor, r.guest_name,
           s.name as assigned_name, p.name as property_name, p.timezone as property_timezone,
           p.warn_at_percent,
           (select count(*)::int from messages m
             where m.room_id = r.room_id and m.sender = 'guest' and m.read_at is null) as unread_messages
      from requests r
      join rooms rm on rm.id = r.room_id
      join properties p on p.id = r.property_id
      left join staff s on s.id = r.assigned_to
     where ${propertyScope(staff, propertyId)}
       and ${departmentScope(staff)}
       and (r.status in ('new','ack','in_progress')
            or r.completed_at > now() - (${DONE_WINDOW_HOURS} || ' hours')::interval)
     order by
       case r.status when 'new' then 0 when 'ack' then 1 when 'in_progress' then 2 else 3 end,
       r.created_at`

  if (rows.length === 0) return []

  const lines = await sql<(BoardRequest['items'][number] & { request_id: string })[]>`
    select id, request_id, name, qty, unit_price_paise, modifiers, note
      from request_items where request_id = any(${rows.map((r) => r.id)})`

  const byRequest = new Map<string, BoardRequest['items']>()
  for (const line of lines) {
    const list = byRequest.get(line.request_id)
    if (list) list.push(line)
    else byRequest.set(line.request_id, [line])
  }
  return rows.map((r) => ({ ...r, items: byRequest.get(r.id) ?? [] }))
}

export type ChatRoom = {
  room_id: string
  room_number: string
  guest_name: string | null
  property_name: string
  last_body: string
  last_sender: 'guest' | 'staff'
  last_at: string
  unread: number
}

/** Rooms with a conversation, newest first. Drives the Messages panel. */
export async function loadChatRooms(staff: Staff, propertyId?: string | null): Promise<ChatRoom[]> {
  const scope = scopeTo(staff, sql`m.property_id`, propertyId)

  return sql<ChatRoom[]>`
    select distinct on (m.room_id)
           m.room_id, rm.number as room_number, rm.guest_name, p.name as property_name,
           m.body as last_body, m.sender as last_sender, m.created_at as last_at,
           (select count(*)::int from messages u
             where u.room_id = m.room_id and u.sender = 'guest' and u.read_at is null) as unread
      from messages m
      join rooms rm on rm.id = m.room_id
      join properties p on p.id = m.property_id
     where ${scope}
     order by m.room_id, m.created_at desc`
}

export async function loadRoomThread(staff: Staff, roomId: string): Promise<ChatMessage[]> {
  const [room] = await sql<{ property_id: string; organisation_id: string | null }[]>`
    select r.property_id, p.organisation_id
      from rooms r join properties p on p.id = r.property_id where r.id = ${roomId}`
  if (!room || !canTouchProperty(staff, propRef(room))) return []

  return sql<ChatMessage[]>`
    select m.id, m.sender, s.name as staff_name, m.body, m.created_at
      from messages m left join staff s on s.id = m.staff_id
     where m.room_id = ${roomId}
     order by m.created_at
     limit 200`
}

export type QuickReply = { id: string; label: string; body: string }

/**
 * The desk's canned replies for this room's property.
 *
 * quick_replies has been seeded per property since the beginning, and
 * lib/admin.ts copies it when a property starts from another's catalogue — but
 * nothing ever read it. Eight written-out sentences sat in the database while
 * staff typed "someone is on the way to your room now" by hand.
 *
 * Scoped through the room, not through the staff member's own property, and
 * guarded exactly as the thread above is: these are one customer's words.
 */
export async function loadQuickReplies(staff: Staff, roomId: string): Promise<QuickReply[]> {
  const [room] = await sql<{ property_id: string; organisation_id: string | null }[]>`
    select r.property_id, p.organisation_id
      from rooms r join properties p on p.id = r.property_id where r.id = ${roomId}`
  if (!room || !canTouchProperty(staff, propRef(room))) return []

  return sql<QuickReply[]>`
    select id, label, body from quick_replies
     where property_id = ${room.property_id}
     order by sort, label`
}

export async function markThreadRead(staff: Staff, roomId: string): Promise<void> {
  const [room] = await sql<{ property_id: string; organisation_id: string | null }[]>`
    select r.property_id, p.organisation_id
      from rooms r join properties p on p.id = r.property_id where r.id = ${roomId}`
  if (!room || !canTouchProperty(staff, propRef(room))) return
  await sql`update messages set read_at = now()
             where room_id = ${roomId} and sender = 'guest' and read_at is null`
}

export async function replyToRoom(staff: Staff, roomId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim().slice(0, 1000)
  if (!text) return { ok: false, error: 'Nothing to send.' }

  const [room] = await sql<{ property_id: string; organisation_id: string | null; number: string }[]>`
    select r.property_id, r.number, p.organisation_id
      from rooms r join properties p on p.id = r.property_id where r.id = ${roomId}`
  if (!room) return { ok: false, error: 'Unknown room.' }
  if (!canTouchProperty(staff, propRef(room))) return { ok: false, error: 'Not your property.' }

  await sql`
    insert into messages (property_id, room_id, sender, staff_id, body)
    values (${room.property_id}, ${roomId}, 'staff', ${staff.id}, ${text})`
  await audit({
    propertyId: room.property_id,
    staffId: staff.id,
    actor: `${staff.name} (${departmentLabel(staff.department)})`,
    action: 'message.replied',
    entity: 'room',
    entityId: roomId,
  })
  return { ok: true }
}

/* ------------------------------------------------------------ transitions */

const NEXT_STATUS: Record<RequestStatus, RequestStatus[]> = {
  new: ['ack', 'in_progress', 'done', 'cancelled'],
  ack: ['in_progress', 'done', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}

export async function setRequestStatus(
  staff: Staff,
  requestId: string,
  next: RequestStatus,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const [current] = await sql<
    { id: string; property_id: string; organisation_id: string | null; room_id: string; department: string; status: RequestStatus; total_paise: number; ref: string; guest_name: string | null; summary: string | null }[]
  >`select r.id, r.property_id, r.room_id, r.department, r.status, r.total_paise,
           r.ref::text as ref, r.guest_name, p.organisation_id,
           (select string_agg(case when ri.qty > 1 then ri.qty || '× ' || ri.name else ri.name end,
                              ', ' order by ri.name)
              from request_items ri where ri.request_id = r.id) as summary
      from requests r join properties p on p.id = r.property_id where r.id = ${requestId}`

  if (!current) return { ok: false, error: 'That request no longer exists.' }
  if (!canTouchProperty(staff, propRef(current))) return { ok: false, error: 'Not your property.' }
  if (!canTouchDepartment(staff, current.department)) return { ok: false, error: 'Not your department.' }
  if (current.status === next) return { ok: true }
  if (!NEXT_STATUS[current.status].includes(next)) {
    return { ok: false, error: `Cannot move a ${current.status} request to ${next}.` }
  }

  await sql`
    update requests
       set status = ${next},
           assigned_to = coalesce(assigned_to, ${next === 'ack' || next === 'in_progress' ? staff.id : null}),
           acknowledged_at = case when acknowledged_at is null and ${next} <> 'new'
                                  then now() else acknowledged_at end,
           completed_at = case when ${next} in ('done','cancelled') then now() else completed_at end,
           cancel_reason = ${next === 'cancelled' ? (reason?.slice(0, 300) ?? 'Cancelled by staff') : null}
     where id = ${requestId}`

  // Charge on delivery, not on order — a guest should never be billed for food
  // that never arrived. postCharge is idempotent, so a double-tap is harmless.
  if (next === 'done' && current.total_paise > 0) {
    await postCharge({
      propertyId: current.property_id,
      roomId: current.room_id,
      requestId: current.id,
      // What they ordered, not a reference number nobody recognises.
      description: current.summary ?? `Request #${current.ref}`,
      amountPaise: current.total_paise,
      guestName: current.guest_name,
    })
  }

  if (next === 'cancelled') {
    const [entry] = await sql<{ id: string }[]>`
      select id from folio_entries where request_id = ${requestId} and voided_at is null`
    if (entry) await voidCharge(entry.id, reason || 'Request cancelled')
  }

  await audit({
    propertyId: current.property_id,
    staffId: staff.id,
    actor: `${staff.name} (${departmentLabel(staff.department)})`,
    action: `request.${next}`,
    entity: 'request',
    entityId: requestId,
    meta: reason ? { reason } : {},
  })

  // A completion notice used to fire here, behind NOTIFY_ON_DONE. It is gone
  // on purpose rather than switched off: an env var set in one shell for one
  // test run is enough to start billing for it again, and the flag being
  // "off by default" did not stop three of these going out while somebody was
  // testing the gateway. Removing the call is the only version of off that
  // survives another session's terminal.
  //
  // It also bought the least of the three notifications: the guest already
  // watches the request move on their own screen, and the board shows the team
  // what they just finished. See notifyRequestDone in lib/notify.ts, kept for
  // the record and hard-disabled there too.

  return { ok: true }
}

export async function assignRequest(staff: Staff, requestId: string, toStaffId: string | null) {
  const [current] = await sql<{ property_id: string; organisation_id: string | null; department: string }[]>`
    select r.property_id, r.department, p.organisation_id
      from requests r join properties p on p.id = r.property_id where r.id = ${requestId}`
  if (!current) return { ok: false, error: 'That request no longer exists.' }
  if (!canTouchProperty(staff, propRef(current))) return { ok: false, error: 'Not your property.' }

  await sql`update requests set assigned_to = ${toStaffId} where id = ${requestId}`
  await audit({
    propertyId: current.property_id,
    staffId: staff.id,
    actor: staff.name,
    action: 'request.assigned',
    entity: 'request',
    entityId: requestId,
    meta: { to: toStaffId },
  })
  return { ok: true }
}

export async function loadAssignableStaff(staff: Staff, propertyId: string) {
  const [prop] = await sql<{ id: string; organisation_id: string | null }[]>`
    select id, organisation_id from properties where id = ${propertyId}`
  if (!prop || !canTouchProperty(staff, prop)) return []
  return sql<{ id: string; name: string; department: string }[]>`
    select id, name, department from staff
     where property_id = ${propertyId} and active
     order by name`
}
