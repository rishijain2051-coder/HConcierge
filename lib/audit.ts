import { sql } from './db'

/** JSON-safe values only — this ends up in a jsonb column. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type AuditEntry = {
  propertyId?: string | null
  staffId?: string | null
  actor: string // 'Room 204' or 'Anita (Housekeeping)' — readable without a join
  action: string
  entity?: string
  entityId?: string
  meta?: Record<string, Json>
}

/**
 * Audit must never break the thing it is recording — a failed log line should
 * not roll back a guest's order. Swallow and report to the server log instead.
 */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await sql`
      insert into audit_log (property_id, staff_id, actor, action, entity, entity_id, meta)
      values (${e.propertyId ?? null}, ${e.staffId ?? null}, ${e.actor}, ${e.action},
              ${e.entity ?? null}, ${e.entityId ?? null}, ${sql.json(e.meta ?? {})})`
  } catch (err) {
    console.error('[audit] failed to record', e.action, err)
  }
}
