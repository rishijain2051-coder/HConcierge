import type { PendingQuery, Row } from 'postgres'
import { sql } from './db'
import type { Staff } from './auth'

/**
 * One definition of "which properties may this person see".
 *
 * Before the tenant layer, an admin's scope was `true` - every property row in
 * the database. That was only ever correct while every property belonged to
 * one customer. These fragments are the single place that rule lives now, so
 * there is no second copy to forget when a query is added.
 *
 * Callers pass the column as a fragment because the column is named differently
 * in each query (`r.property_id`, `m.property_id`, `p.id`), and interpolating a
 * qualified name as an identifier would quote it wrong.
 *
 *   where ${scopeTo(staff, sql`r.property_id`)}
 */
type Fragment = PendingQuery<Row[]>

/**
 * Query strings are typed by people and forged by scripts. Postgres answers a
 * malformed uuid with an error, which surfaces as a 500; this turns it back
 * into "no such property", which is what it actually means.
 */
export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)

export function scopeTo(staff: Staff, column: Fragment, propertyId?: string | null): Fragment {
  // A property filter that cannot be a property id is not a filter.
  if (propertyId != null && !isUuid(propertyId)) return sql`false`

  // HConcierge sees every organisation - until it steps into one, after which
  // it is scoped to that customer exactly like their own admin.
  if (staff.role === 'platform' && !staff.organisation_id) {
    return propertyId ? sql`${column} = ${propertyId}` : sql`true`
  }

  // An admin sees their own organisation's properties, and nothing else -
  // including when they hand us a property id directly.
  if (staff.role === 'admin' || staff.role === 'platform') {
    const mine = sql`${column} in (select id from properties where organisation_id = ${staff.organisation_id})`
    return propertyId ? sql`${column} = ${propertyId} and ${mine}` : mine
  }

  // Managers and staff are pinned to one property.
  return sql`${column} = ${staff.property_id}`
}

/**
 * Shorthand for the row shape `canTouchProperty` wants. Every call site that
 * checks a room, request or item already selects its row - widen that select
 * with a join on properties and hand the result straight to this.
 */
export const propRef = (row: { property_id: string; organisation_id: string | null }) => ({
  id: row.property_id,
  organisation_id: row.organisation_id,
})
