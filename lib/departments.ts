import { cache } from 'react'

import { sql } from './db'
import { audit } from './audit'
import type { Staff } from './auth'

export type Team = {
  id: string
  slug: string
  name: string
  sort: number
  active: boolean
  /** Rows across the product currently routed here. Blocks a delete. */
  in_use?: number
}

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const fail = (error: string) => ({ ok: false as const, error })

/**
 * The teams a request can be routed to.
 *
 * These were four values in a CHECK constraint on five tables, so a hotel with
 * a spa or a valet desk could not have one. They belong to the organisation:
 * one customer's teams are not another's, and the slug is what every routed
 * column already holds.
 *
 * Cached per request — the board, the staff list and the directory editor all
 * ask for the same list on the same page load.
 */
export const listTeams = cache(async (organisationId: string | null): Promise<Team[]> => {
  if (!organisationId) return []
  return sql<Team[]>`
    select id, slug, name, sort, active
      from departments
     where organisation_id = ${organisationId}
     order by sort, name`
})

/** Only the ones a guest's request can still be routed to. */
export async function activeTeams(organisationId: string | null): Promise<Team[]> {
  return (await listTeams(organisationId)).filter((t) => t.active)
}

/**
 * Slug → name, for one organisation. Server-side rendering resolves labels
 * through this; `departmentLabel` in types.ts is the synchronous fallback for
 * the places that have no organisation to hand, such as the escalation
 * messages built in lib/notify.ts.
 */
export async function teamLabels(organisationId: string | null): Promise<Map<string, string>> {
  const teams = await listTeams(organisationId)
  return new Map(teams.map((t) => [t.slug, t.name]))
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

/** Teams are organisation-wide, so a manager running one property cannot add one. */
function canManageTeams(actor: Staff): boolean {
  if (actor.role === 'platform') return true
  return actor.role === 'admin' && Boolean(actor.organisation_id)
}

export async function createTeam(actor: Staff, name: string): Promise<Ok> {
  if (!canManageTeams(actor)) return fail('Only an admin can add a team.')
  const organisationId = actor.organisation_id
  if (!organisationId) return fail('Open a customer first.')

  const clean = name.trim().slice(0, 60)
  if (!clean) return fail('Give the team a name.')
  const slug = slugify(clean)
  // 'all' is the sentinel on staff.department meaning every team. A real team
  // called that would make a department account look like a manager.
  if (!slug || slug === 'all') return fail('That name cannot be used. Try another.')

  const [clash] = await sql`
    select 1 from departments where organisation_id = ${organisationId} and slug = ${slug}`
  if (clash) return fail(`There is already a team called “${clean}”.`)

  const [{ next }] = await sql<{ next: number }[]>`
    select coalesce(max(sort), -1) + 1 as next from departments where organisation_id = ${organisationId}`

  await sql`
    insert into departments (organisation_id, slug, name, sort)
    values (${organisationId}, ${slug}, ${clean}, ${next})`

  await audit({
    organisationId,
    staffId: actor.id,
    actor: actor.name,
    action: 'team.created',
    entity: 'department',
    meta: { name: clean, slug },
  })
  return { ok: true }
}

export async function renameTeam(actor: Staff, id: string, name: string): Promise<Ok> {
  if (!canManageTeams(actor)) return fail('Only an admin can rename a team.')
  const clean = name.trim().slice(0, 60)
  if (!clean) return fail('Give the team a name.')

  // The slug is deliberately not rewritten: every staff row, item, request and
  // escalation rule already holds it, and renaming is a label change.
  const [row] = await sql<{ slug: string }[]>`
    update departments set name = ${clean}
     where id = ${id} and organisation_id = ${actor.organisation_id}
    returning slug`
  if (!row) return fail('That team no longer exists.')

  await audit({
    organisationId: actor.organisation_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'team.renamed',
    entity: 'department',
    entityId: id,
    meta: { name: clean, slug: row.slug },
  })
  return { ok: true }
}

/**
 * Turning a team off hides it from everything that routes *new* work to it —
 * the directory's "goes to", the staff form, the escalation ladder — without
 * orphaning the requests, items and people already pointing at it. That is why
 * there is no delete: a team is referenced by four tables, and a hotel that
 * closes its spa still needs last month's spa requests to read correctly.
 */
export async function setTeamActive(actor: Staff, id: string, active: boolean): Promise<Ok> {
  if (!canManageTeams(actor)) return fail('Only an admin can change a team.')

  const [row] = await sql<{ slug: string; name: string }[]>`
    select slug, name from departments where id = ${id} and organisation_id = ${actor.organisation_id}`
  if (!row) return fail('That team no longer exists.')

  if (!active) {
    const [{ remaining }] = await sql<{ remaining: number }[]>`
      select count(*)::int as remaining from departments
       where organisation_id = ${actor.organisation_id} and active and id <> ${id}`
    if (remaining === 0) return fail('A hotel needs at least one team.')
  }

  await sql`update departments set active = ${active} where id = ${id}`
  await audit({
    organisationId: actor.organisation_id,
    staffId: actor.id,
    actor: actor.name,
    action: active ? 'team.reopened' : 'team.closed',
    entity: 'department',
    entityId: id,
    meta: { name: row.name, slug: row.slug },
  })
  return { ok: true }
}

/** What would be left behind if a team were turned off, so the screen can say so. */
export async function teamUsage(organisationId: string | null): Promise<Map<string, number>> {
  if (!organisationId) return new Map()
  const rows = await sql<{ slug: string; n: number }[]>`
    with mine as (select id from properties where organisation_id = ${organisationId})
    select d.slug,
           (select count(*)::int from staff s
             where s.organisation_id = ${organisationId} and s.department = d.slug)
         + (select count(*)::int from items i
             where i.property_id in (select id from mine) and i.department = d.slug)
         + (select count(*)::int from escalation_rules e
             where e.property_id in (select id from mine) and e.department = d.slug) as n
      from departments d
     where d.organisation_id = ${organisationId}`
  return new Map(rows.map((r) => [r.slug, r.n]))
}
