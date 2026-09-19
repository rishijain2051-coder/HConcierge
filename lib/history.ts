import { sql } from './db'
import { visibleDepartments, type Staff } from './auth'
import { scopeTo } from './scope'
import type { RequestStatus } from './types'

/**
 * When a request's clock starts, the same way lib/sla.ts starts it: the hour it
 * was booked for, or the moment it arrived. Counting a 7am wake-up call from
 * when the guest ordered it at midnight scored every one of them as hours late,
 * and a team that never missed a spa slot read as a team that missed all of them.
 */
const DUE_FROM = sql`coalesce(r.scheduled_for, r.created_at)`

export type HistoryFilters = {
  propertyId?: string | null
  department?: string | null
  status?: string | null
  room?: string | null
  days: number
}

export type HistoryRow = {
  id: string
  ref: string
  created_at: string
  completed_at: string | null
  acknowledged_at: string | null
  escalated_at: string | null
  status: RequestStatus
  department: string
  kind: string
  note: string | null
  total_paise: number
  sla_minutes: number
  /** Finished inside its target, counted from when it was due. */
  on_time: boolean
  room_number: string
  guest_name: string | null
  property_name: string
  assigned_name: string | null
  summary: string | null
  response_minutes: number | null
  resolve_minutes: number | null
}

export type HistoryStats = {
  total: number
  done: number
  cancelled: number
  escalated: number
  within_sla: number
  avg_response: number | null
  avg_resolve: number | null
  revenue_paise: number
}

function scopes(staff: Staff, f: HistoryFilters) {
  const property = scopeTo(staff, sql`r.property_id`, f.propertyId)

  const visible = visibleDepartments(staff)
  const allowed = visible.length === 0 ? sql`true` : sql`r.department = any(${visible})`
  const department = f.department ? sql`r.department = ${f.department}` : sql`true`
  const status = f.status ? sql`r.status = ${f.status}` : sql`true`
  const room = f.room ? sql`rm.number = ${f.room}` : sql`true`
  const since = sql`r.created_at > now() - (${f.days} || ' days')::interval`

  return sql`${property} and ${allowed} and ${department} and ${status} and ${room} and ${since}`
}

export async function loadHistory(staff: Staff, f: HistoryFilters, limit = 300): Promise<HistoryRow[]> {
  return sql<HistoryRow[]>`
    select r.id, r.ref::text as ref, r.created_at, r.completed_at, r.acknowledged_at, r.escalated_at,
           r.status, r.department, r.kind, r.note, r.total_paise, r.sla_minutes,
           rm.number as room_number, r.guest_name, p.name as property_name, s.name as assigned_name,
           (select string_agg(ri.qty || '× ' || ri.name, ', ' order by ri.name)
              from request_items ri where ri.request_id = r.id) as summary,
           round(extract(epoch from (r.acknowledged_at - r.created_at)) / 60)::int as response_minutes,
           round(extract(epoch from (r.completed_at - r.created_at)) / 60)::int as resolve_minutes,
           -- Decided here rather than by comparing resolve_minutes to the
           -- target in the page, which called every booked-ahead request late
           -- while the on-time figure above the table said otherwise.
           (r.status = 'done'
            and r.completed_at <= ${DUE_FROM} + (r.sla_minutes || ' minutes')::interval) as on_time
      from requests r
      join rooms rm on rm.id = r.room_id
      join properties p on p.id = r.property_id
      left join staff s on s.id = r.assigned_to
     where ${scopes(staff, f)}
     order by r.created_at desc
     limit ${limit}`
}

export async function loadStats(staff: Staff, f: HistoryFilters): Promise<HistoryStats> {
  const [row] = await sql<HistoryStats[]>`
    select count(*)::int as total,
           count(*) filter (where r.status = 'done')::int as done,
           count(*) filter (where r.status = 'cancelled')::int as cancelled,
           count(*) filter (where r.escalated_at is not null)::int as escalated,
           count(*) filter (
             where r.completed_at is not null and r.status = 'done'
               and r.completed_at <= ${DUE_FROM} + (r.sla_minutes || ' minutes')::interval
           )::int as within_sla,
           -- Response stays measured from arrival: "how quickly did somebody
           -- pick this up" is a question about the moment it landed, not about
           -- an hour the guest chose.
           round(avg(extract(epoch from (r.acknowledged_at - r.created_at)) / 60)::numeric, 1)::float8 as avg_response,
           -- Only what actually finished. A cancelled request keeps its
           -- completed_at, so without this filter a cancellation counts as a
           -- fast completion and drags the headline average down.
           round(avg(extract(epoch from (r.completed_at - r.created_at)) / 60) filter (where r.status = 'done')::numeric, 1)::float8 as avg_resolve,
           coalesce(sum(r.total_paise) filter (where r.status = 'done'), 0)::int as revenue_paise
      from requests r
      join rooms rm on rm.id = r.room_id
     where ${scopes(staff, f)}`
  return row
}

/** Which teams are carrying the load - the slide that sells this to a GM. */
export async function loadByDepartment(staff: Staff, f: HistoryFilters) {
  return sql<
    { department: string; total: number; done: number; within_sla: number; avg_resolve: number | null }[]
  >`
    -- "On time" has to be counted out of what actually finished. Dividing the
    -- completed-and-on-time count by every request including the open and
    -- cancelled ones put 39% under a headline that said 78%.
    select r.department,
           count(*)::int as total,
           count(*) filter (where r.status = 'done')::int as done,
           count(*) filter (
             where r.status = 'done'
               and r.completed_at <= ${DUE_FROM} + (r.sla_minutes || ' minutes')::interval
           )::int as within_sla,
           -- Same filter as within_sla above, for the same reason: a team
           -- with one cancelled request read "1 request · 1.7 min average"
           -- directly beside "none finished yet".
           round(avg(extract(epoch from (r.completed_at - r.created_at)) / 60) filter (where r.status = 'done')::numeric, 1)::float8 as avg_resolve
      from requests r
      join rooms rm on rm.id = r.room_id
     where ${scopes(staff, f)}
     group by r.department
     order by count(*) desc`
}
