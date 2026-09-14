import { sql } from './db'
import { audit } from './audit'
import { createStaff, fail, type Ok } from './admin'
import type { Staff } from './auth'

/**
 * Customers. RN Hospitality is one organisation and owns its properties.
 *
 * Only a `platform` account reaches any of this — an organisation admin must
 * never be able to see, create or rename another customer.
 */

export type OrganisationRow = {
  id: string
  slug: string
  name: string
  properties: number
  staff: number
  rooms: number
  created_at: string
}

export async function listOrganisations(actor: Staff): Promise<OrganisationRow[]> {
  if (actor.role !== 'platform') return []
  return sql<OrganisationRow[]>`
    select o.id, o.slug, o.name, o.created_at,
           (select count(*)::int from properties where organisation_id = o.id) as properties,
           (select count(*)::int from staff      where organisation_id = o.id) as staff,
           (select count(*)::int from rooms r join properties p on p.id = r.property_id
             where p.organisation_id = o.id)                                   as rooms
      from organisations o order by o.name`
}

/**
 * Onboarding a customer: the organisation and its first admin in one step.
 *
 * That admin is the only account HConcierge ever creates for them; everyone
 * else is theirs to add. Creating the organisation without an admin would
 * leave a tenant nobody can sign in to, so if the admin fails the organisation
 * is rolled back with it.
 */
export async function createOrganisation(
  actor: Staff,
  input: { name: string; slug: string; adminName: string; adminUsername: string },
): Promise<Ok<{ password: string }>> {
  if (actor.role !== 'platform') return fail('Only HConcierge can add an organisation.')

  const name = input.name.trim().slice(0, 120)
  const slug = input.slug.trim().toLowerCase().slice(0, 60)
  if (!name) return fail('Enter a name.')
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return fail('Slugs use 3–60 lowercase letters, numbers and dashes.')

  const [clash] = await sql`select 1 from organisations where slug = ${slug}`
  if (clash) return fail(`The slug “${slug}” is taken.`)

  const [org] = await sql<{ id: string }[]>`
    insert into organisations (slug, name) values (${slug}, ${name}) returning id`

  const created = await createStaff(actor, {
    name: input.adminName,
    username: input.adminUsername,
    role: 'admin',
    department: 'all',
    organisationId: org.id,
    propertyId: null,
    phone: null,
  })
  if (!created.ok) {
    await sql`delete from organisations where id = ${org.id}`
    return created
  }

  await audit({
    staffId: actor.id,
    actor: actor.name,
    action: 'organisation.created',
    entity: 'organisation',
    entityId: org.id,
    meta: { slug, admin: input.adminUsername.toLowerCase() },
  })
  return { ok: true, password: created.password }
}

export async function updateOrganisation(actor: Staff, id: string, name: string): Promise<Ok> {
  if (actor.role !== 'platform') return fail('Only HConcierge can edit an organisation.')
  if (!name.trim()) return fail('Enter a name.')

  await sql`update organisations set name = ${name.trim().slice(0, 120)} where id = ${id}`
  await audit({
    staffId: actor.id,
    actor: actor.name,
    action: 'organisation.updated',
    entity: 'organisation',
    entityId: id,
    meta: { name: name.trim() },
  })
  return { ok: true }
}
