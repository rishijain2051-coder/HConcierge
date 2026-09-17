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
  suspended_at: string | null
  created_at: string
}

export async function listOrganisations(actor: Staff): Promise<OrganisationRow[]> {
  if (actor.role !== 'platform') return []
  return sql<OrganisationRow[]>`
    select o.id, o.slug, o.name, o.created_at, o.suspended_at,
           (select count(*)::int from properties where organisation_id = o.id) as properties,
           (select count(*)::int from staff      where organisation_id = o.id) as staff,
           (select count(*)::int from rooms r join properties p on p.id = r.property_id
             where p.organisation_id = o.id)                                   as rooms
      from organisations o order by o.name`
}

/* ---------------------------------------------------------- off-boarding */

export type Offboarding = {
  name: string
  slug: string
  suspended_at: string | null
  properties: number
  rooms: number
  occupied: number
  staff: number
  items: number
  requests: number
  messages: number
  unsettled_paise: number
}

/**
 * What deleting this customer would destroy, counted rather than estimated.
 *
 * Shown on screen before the confirmation, because "delete this organisation"
 * is not a sentence anybody can consent to without knowing whether it means
 * one empty test tenant or a hotel with guests in it.
 */
export async function offboardingSummary(actor: Staff, id: string): Promise<Offboarding | null> {
  if (actor.role !== 'platform') return null
  const [row] = await sql<Offboarding[]>`
    select o.name, o.slug, o.suspended_at,
           (select count(*)::int from properties where organisation_id = o.id) as properties,
           (select count(*)::int from staff      where organisation_id = o.id) as staff,
           (select count(*)::int from rooms r join properties p on p.id = r.property_id
             where p.organisation_id = o.id) as rooms,
           (select count(*)::int from rooms r join properties p on p.id = r.property_id
             where p.organisation_id = o.id and r.occupied) as occupied,
           (select count(*)::int from items i join properties p on p.id = i.property_id
             where p.organisation_id = o.id) as items,
           (select count(*)::int from requests q join properties p on p.id = q.property_id
             where p.organisation_id = o.id) as requests,
           (select count(*)::int from messages m join properties p on p.id = m.property_id
             where p.organisation_id = o.id) as messages,
           (select coalesce(sum(f.amount_paise), 0)::int
              from folio_entries f
              join rooms r on r.id = f.room_id
              join properties p on p.id = r.property_id
             where p.organisation_id = o.id
               and f.voided_at is null and f.settled_at is null) as unsettled_paise
      from organisations o where o.id = ${id}`
  return row ?? null
}

/**
 * Stop a customer using the product, reversibly.
 *
 * Bites in two places and both are load-bearing: `staffFromToken` refuses a
 * suspended customer's staff on the next request, and `readRoom` refuses their
 * guests, so nothing new arrives that nobody is going to answer. A hotel that
 * has given notice wants exactly this — the data intact, the doors shut.
 *
 * A platform account is deliberately exempt, or HConcierge could suspend a
 * customer and then be unable to reach them to undo it.
 */
export async function setOrganisationSuspended(actor: Staff, id: string, suspended: boolean): Promise<Ok> {
  if (actor.role !== 'platform') return fail('Only HConcierge can suspend a customer.')

  const [org] = await sql<{ name: string }[]>`select name from organisations where id = ${id}`
  if (!org) return fail('That customer no longer exists.')

  await sql`
    update organisations set suspended_at = ${suspended ? sql`now()` : null} where id = ${id}`
  await audit({
    organisationId: id,
    staffId: actor.id,
    actor: actor.name,
    action: suspended ? 'organisation.suspended' : 'organisation.restored',
    entity: 'organisation',
    entityId: id,
    meta: { name: org.name },
  })
  return { ok: true }
}

/**
 * Delete a customer and everything of theirs, for good.
 *
 * Three gates, none of them decoration. It is platform-only; the customer has
 * to have been **suspended first**, so that ending a contract is always two
 * deliberate acts on two separate occasions rather than one click on a list;
 * and the exact name has to be typed, because a row in a list is easy to
 * mis-click and a name is not easy to mistype.
 *
 * An unsettled balance refuses outright. Deleting a customer who still owes a
 * room money loses the only record that they did, and no off-boarding is urgent
 * enough to justify that — settle or void it first.
 *
 * Everything cascades: properties, rooms, requests, items, folio, teams, staff.
 * The audit log does not. Its foreign keys are `on delete set null` and the
 * trigger in db/schema.sql lets that one update through, so the trail of what
 * HConcierge did for this customer survives the customer — including this row.
 */
export async function deleteOrganisation(actor: Staff, id: string, typedName: string): Promise<Ok> {
  if (actor.role !== 'platform') return fail('Only HConcierge can delete a customer.')

  const summary = await offboardingSummary(actor, id)
  if (!summary) return fail('That customer no longer exists.')

  if (!summary.suspended_at) {
    return fail('Suspend this customer first. Deleting is meant to be the second decision, not the first.')
  }
  if (typedName.trim() !== summary.name) {
    return fail(`That is not the name. Type “${summary.name}” exactly to confirm.`)
  }
  if (summary.unsettled_paise > 0) {
    return fail(
      `₹${(summary.unsettled_paise / 100).toFixed(2)} is still outstanding on their rooms. Settle or void it first — deleting now destroys the only record of it.`,
    )
  }

  // Audited before the delete, not after: the row records the organisation it
  // is about, and writing it afterwards would mean resolving a name that no
  // longer exists. The FK releases itself when the parent goes.
  await audit({
    organisationId: id,
    staffId: actor.id,
    actor: actor.name,
    action: 'organisation.deleted',
    entity: 'organisation',
    entityId: id,
    meta: {
      name: summary.name,
      slug: summary.slug,
      properties: summary.properties,
      rooms: summary.rooms,
      staff: summary.staff,
      requests: summary.requests,
    },
  })

  await sql`delete from organisations where id = ${id}`
  return { ok: true }
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

  // A customer with no teams has nowhere to route a request, no options on the
  // staff form and no "goes to" in the directory. Every organisation starts
  // with the four that used to be hardcoded; they can rename, close and add
  // from Manage → Teams.
  await sql`
    insert into departments (organisation_id, slug, name, sort)
    values (${org.id}, 'front_desk', 'Front desk', 0),
           (${org.id}, 'housekeeping', 'Housekeeping', 1),
           (${org.id}, 'fnb', 'Food & beverage', 2),
           (${org.id}, 'maintenance', 'Maintenance', 3)`

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
