import { sql } from './db'

/** JSON-safe values only - this ends up in a jsonb column. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type AuditEntry = {
  propertyId?: string | null
  organisationId?: string | null
  staffId?: string | null
  actor: string // 'Room 204' or 'Anita (Housekeeping)' - readable without a join
  action: string
  entity?: string
  entityId?: string
  meta?: Record<string, Json>
}

/**
 * Audit must never break the thing it is recording - a failed log line should
 * not roll back a guest's order. Swallow and report to the server log instead.
 */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    // An admin belongs to no single property, so the event that grants someone
    // the run of an organisation carries a null property_id - and every
    // organisation-scoped view of this log filters on property_id, so it fell
    // out of the one place it needed to appear. The organisation is resolved
    // here, in the same statement, rather than at forty call sites: from the
    // property when there is one, otherwise from whoever performed it.
    await sql`
      insert into audit_log (property_id, organisation_id, staff_id, actor, action,
                             entity, entity_id, meta)
      values (
        ${e.propertyId ?? null},
        coalesce(
          ${e.organisationId ?? null}::uuid,
          (select organisation_id from properties where id = ${e.propertyId ?? null}),
          (select organisation_id from staff      where id = ${e.staffId ?? null})
        ),
        ${e.staffId ?? null}, ${e.actor}, ${e.action},
        ${e.entity ?? null}, ${e.entityId ?? null}, ${sql.json(e.meta ?? {})}
      )`
  } catch (err) {
    console.error('[audit] failed to record', e.action, err)
  }
}
