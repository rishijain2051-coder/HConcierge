import type { PendingQuery, Row } from 'postgres'
import { sql } from './db'
import type { Staff } from './auth'

/**
 * One definition of "which properties may this person see".
 *
 * Before the tenant layer, an admin's scope was `true` — every property row in
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

export function scopeTo(staff: Staff, column: Fragment, propertyId?: string | null): Fragment {
  // HConcierge sees every organisation.
  if (staff.role === 'platform') {
    return propertyId ? sql`${column} = ${propertyId}` : sql`true`
  }

  // An admin sees their own organisation's properties, and nothing else —
  // including when they hand us a property id directly.
  if (staff.role === 'admin') {
    const mine = sql`${column} in (select id from properties where organisation_id = ${staff.organisation_id})`
    return propertyId ? sql`${column} = ${propertyId} and ${mine}` : mine
  }

  // Managers and staff are pinned to one property.
  return sql`${column} = ${staff.property_id}`
}

/**
 * Shorthand for the row shape `canTouchProperty` wants. Every call site that
 * checks a room, request or item already selects its row — widen that select
 * with a join on properties and hand the result straight to this.
 */
export const propRef = (row: { property_id: string; organisation_id: string | null }) => ({
  id: row.property_id,
  organisation_id: row.organisation_id,
})
