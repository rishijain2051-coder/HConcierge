import { sql } from './db'
import { audit } from './audit'
import { canManageProperty, fail, type Ok } from './admin'
import type { AppliesTo, EscalationInput, EscalationRule, RuleStaff, Department, Role } from './types'
export { APPLIES_TO_LABEL } from './types'
export type { AppliesTo, EscalationInput, EscalationRule, RuleStaff } from './types'
import type { Staff } from './auth'

/**
 * The escalation ladder, per property.
 *
 * Replaces the rule that used to be hardcoded in lib/notify.ts — "past its
 * target, tell every manager and admin, then again at twice the target".
 *
 * `after_minutes` counts from the moment a request misses its OWN target, so a
 * single rung reads the same for a ten-minute towel and a forty-minute biryani:
 * "fifteen minutes late, tell the duty manager". That is easier to reason about
 * than a multiplier, and it is what someone configuring this actually means.
 */

export async function listEscalationRules(actor: Staff, propertyId: string): Promise<EscalationRule[]> {
  if (!(await canManageProperty(actor, propertyId))) return []

  const rules = await sql<Omit<EscalationRule, 'staff'>[]>`
    select id, property_id, department, step, after_minutes, applies_to,
           notify_managers, notify_admins, active
      from escalation_rules where property_id = ${propertyId}
     order by step, after_minutes`
  if (rules.length === 0) return []

  const named = await sql<(RuleStaff & { rule_id: string })[]>`
    select rs.rule_id, s.id, s.name, s.phone
      from escalation_rule_staff rs join staff s on s.id = rs.staff_id
     where rs.rule_id = any(${rules.map((r) => r.id)})
     order by s.name`

  const byRule = new Map<string, RuleStaff[]>()
  for (const n of named) {
    const list = byRule.get(n.rule_id)
    if (list) list.push(n)
    else byRule.set(n.rule_id, [n])
  }
  return rules.map((r) => ({ ...r, staff: byRule.get(r.id) ?? [] }))
}

/** Everyone who could be named on a rung: this property's staff, plus the org's admins. */
export async function listEscalationCandidates(actor: Staff, propertyId: string) {
  if (!(await canManageProperty(actor, propertyId))) return []
  return sql<{ id: string; name: string; role: Role; department: Department; phone: string | null }[]>`
    select s.id, s.name, s.role, s.department, s.phone
      from staff s, properties p
     where p.id = ${propertyId}
       and s.active
       and (s.property_id = ${propertyId}
            or (s.role = 'admin' and s.organisation_id = p.organisation_id))
     order by case s.role when 'admin' then 0 when 'manager' then 1 else 2 end, s.name`
}

export async function saveEscalationRule(actor: Staff, propertyId: string, input: EscalationInput): Promise<Ok> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  if (!Number.isInteger(input.step) || input.step < 1 || input.step > 9) return fail('Step must be between 1 and 9.')
  if (!Number.isInteger(input.afterMinutes) || input.afterMinutes < 0 || input.afterMinutes > 1440) {
    return fail('Delay must be between 0 and 1440 minutes past the target.')
  }
  if (!input.notifyManagers && !input.notifyAdmins && input.staffIds.length === 0) {
    return fail('Choose at least one person or group to tell — a rung that notifies nobody does nothing.')
  }

  let ruleId = input.id ?? null
  if (ruleId) {
    const [owned] = await sql`select 1 from escalation_rules where id = ${ruleId} and property_id = ${propertyId}`
    if (!owned) return fail('That rule no longer exists.')
    await sql`
      update escalation_rules
         set department = ${input.department}, step = ${input.step},
             after_minutes = ${input.afterMinutes}, applies_to = ${input.appliesTo},
             notify_managers = ${input.notifyManagers}, notify_admins = ${input.notifyAdmins},
             active = ${input.active}
       where id = ${ruleId}`
  } else {
    const [row] = await sql<{ id: string }[]>`
      insert into escalation_rules
        (property_id, department, step, after_minutes, applies_to, notify_managers, notify_admins, active)
      values (${propertyId}, ${input.department}, ${input.step}, ${input.afterMinutes},
              ${input.appliesTo}, ${input.notifyManagers}, ${input.notifyAdmins}, ${input.active})
      returning id`
    ruleId = row.id
  }

  // Replace the named list wholesale. Diffing a list that is never more than a
  // handful of people is effort spent for nothing.
  await sql`delete from escalation_rule_staff where rule_id = ${ruleId}`
  for (const staffId of [...new Set(input.staffIds)].slice(0, 20)) {
    await sql`
      insert into escalation_rule_staff (rule_id, staff_id) values (${ruleId}, ${staffId})
      on conflict do nothing`
  }

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: input.id ? 'escalation.updated' : 'escalation.created',
    entity: 'escalation_rule',
    entityId: ruleId ?? undefined,
    meta: { step: input.step, after_minutes: input.afterMinutes, department: input.department },
  })
  return { ok: true }
}

export async function deleteEscalationRule(actor: Staff, id: string): Promise<Ok> {
  const [rule] = await sql<{ property_id: string; step: number }[]>`
    select property_id, step from escalation_rules where id = ${id}`
  if (!rule) return { ok: true }
  if (!(await canManageProperty(actor, rule.property_id))) return fail('Not your property.')

  await sql`delete from escalation_rules where id = ${id}`
  await audit({
    propertyId: rule.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'escalation.deleted',
    entity: 'escalation_rule',
    entityId: id,
    meta: { step: rule.step },
  })
  return { ok: true }
}

/** The amber threshold, as a percentage of a request's own target. */
export async function setWarnThreshold(actor: Staff, propertyId: string, percent: number): Promise<Ok> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  if (!Number.isInteger(percent) || percent < 10 || percent > 100) {
    return fail('The amber threshold must be between 10% and 100% of the target.')
  }
  await sql`update properties set warn_at_percent = ${percent} where id = ${propertyId}`
  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: 'escalation.threshold_changed',
    entity: 'property',
    entityId: propertyId,
    meta: { warn_at_percent: percent },
  })
  return { ok: true }
}

export async function getWarnThreshold(propertyId: string): Promise<number> {
  const [row] = await sql<{ warn_at_percent: number }[]>`
    select warn_at_percent from properties where id = ${propertyId}`
  return row?.warn_at_percent ?? 60
}
