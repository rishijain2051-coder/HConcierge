import { cache } from 'react'
import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { audit } from './audit'
import { scopeTo } from './scope'
import { listTeams } from './departments'
import {
  canTouchProperty,
  generatePassword,
  hashPassword,
  passwordProblem,
  type Department,
  type Role,
  type Staff,
} from './auth'

/**
 * Everything the admin panel reads and writes.
 *
 * Two rules run through all of it:
 *   - An admin roams every property; a manager is pinned to their own and can
 *     only ever create or edit plain staff.
 *   - Nobody can lock the system out of itself. You cannot deactivate, demote
 *     or delete your own account, and the last active admin is untouchable.
 *     HConcierge has no sign-up screen, so an empty admin table is unrecoverable
 *     without database access.
 */

export type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export const fail = (error: string) => ({ ok: false as const, error })

/**
 * The property row, once per request.
 *
 * Half a dozen guards on a single page each need to know who owns a property,
 * and each used to pay its own round trip to Mumbai for the same three columns.
 * `cache` collapses them into one — including calls that overlap inside a
 * `Promise.all`, which share the in-flight promise rather than racing.
 */
export const propertyRow = cache(async (id: string) => {
  const [row] = await sql<
    { id: string; organisation_id: string | null; warn_at_percent: number; name: string }[]
  >`select id, organisation_id, warn_at_percent, name from properties where id = ${id}`
  return row ?? null
})

export async function canManageProperty(actor: Staff, propertyId: string | null): Promise<boolean> {
  if (actor.role === 'platform' && !actor.organisation_id) return true
  if (propertyId === null) return false
  const prop = await propertyRow(propertyId)
  return Boolean(prop) && canTouchProperty(actor, prop)
}

type StaffTarget = { role: Role; property_id: string | null; organisation_id: string | null }

/**
 * May this person administer that account?
 *
 * The old test read "can you manage their property, OR are they an admin" —
 * and because an admin has no property, the second half cancelled the first.
 * Any admin could reset the password of, deactivate, or edit any OTHER
 * customer's admin. The question was never about the property; it is about
 * the organisation.
 */
async function canManageStaff(actor: Staff, target: StaffTarget): Promise<boolean> {
  // HConcierge, not currently standing inside a customer.
  if (actor.role === 'platform' && !actor.organisation_id) return true
  // Never across customers, whatever the roles involved.
  if (!actor.organisation_id || target.organisation_id !== actor.organisation_id) return false
  if (actor.role === 'platform' || actor.role === 'admin') return true
  // A manager reaches their own property, and never an admin above them.
  if (actor.role === 'manager') {
    return target.role !== 'admin' && target.role !== 'platform' && target.property_id === actor.property_id
  }
  return false
}

/** Nobody may mint a role at or above their own. */
function canAssignRole(actor: Staff, role: Role): boolean {
  if (actor.role === 'platform') return true
  if (actor.role === 'admin') return role === 'manager' || role === 'staff'
  if (actor.role === 'manager') return role === 'staff'
  return false
}

/**
 * Counted per organisation. A global count would let one customer's last admin
 * be removed as long as some other customer still had one — which is exactly
 * the lockout this guard exists to prevent.
 */
async function activeAdminCount(organisationId: string | null, excluding?: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from staff
     where role = 'admin' and active
       and organisation_id is not distinct from ${organisationId}
       and id <> coalesce(${excluding ?? null}, '00000000-0000-0000-0000-000000000000'::uuid)`
  return row.n
}

/** Platform accounts are never scoped to an organisation. */
async function activePlatformCount(excluding?: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from staff
     where role = 'platform' and active
       and id <> coalesce(${excluding ?? null}, '00000000-0000-0000-0000-000000000000'::uuid)`
  return row.n
}

/* -------------------------------------------------------------------- staff */

export type StaffRow = {
  id: string
  username: string
  name: string
  role: Role
  department: Department
  extra_teams: string[]
  phone: string | null
  active: boolean
  failed_logins: number
  locked_until: string | null
  last_login_at: string | null
  property_id: string | null
  property_name: string | null
  organisation_id: string | null
  organisation_name: string | null
}

export async function listStaff(actor: Staff): Promise<StaffRow[]> {
  return sql<StaffRow[]>`
    select s.id, s.username, s.name, s.role, s.department, s.extra_teams, s.phone, s.active,
           s.failed_logins, s.locked_until, s.last_login_at,
           s.property_id, p.name as property_name,
           s.organisation_id, o.name as organisation_name
      from staff s
      left join properties p on p.id = s.property_id
      left join organisations o on o.id = s.organisation_id
     where ${
       actor.role === 'platform' && !actor.organisation_id
         ? sql`true`
         : actor.role === 'manager' || actor.role === 'staff'
           ? sql`s.property_id = ${actor.property_id}`
           : sql`s.organisation_id = ${actor.organisation_id}`
     }
     order by case s.role when 'platform' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end, s.name`
}

export type StaffInput = {
  name: string
  organisationId?: string | null
  username: string
  role: Role
  department: Department
  /** Teams this person also covers, beyond `department`. Staff accounts only. */
  extraTeams?: string[]
  propertyId: string | null
  phone: string | null
  password?: string
}

export async function createStaff(actor: Staff, input: StaffInput): Promise<Ok<{ password: string }>> {
  const name = input.name.trim().slice(0, 120)
  // Not truncated: a 61-character username silently became a different one
  // from the one that was typed, and the person was handed the wrong login.
  const username = input.username.trim().toLowerCase()

  if (!name) return fail('Enter a name.')
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) {
    return fail('Usernames use 3–60 lowercase letters, numbers, dot, dash or underscore.')
  }
  // The pattern above accepts "..." and "---". A username has to contain
  // something someone can say out loud.
  if (!/[a-z0-9]/.test(username)) return fail('A username needs at least one letter or number.')
  // A forged form field used to reach the CHECK constraint and come back as a
  // 500. The database is the backstop, not the validation.
  if (!canAssignRole(actor, input.role)) return fail('Only a group admin can create managers or admins.')

  // platform is org-less by definition; everyone else inherits the actor's
  // organisation unless HConcierge is explicitly placing them in another.
  const organisationId =
    input.role === 'platform'
      ? null
      : actor.role === 'platform'
        ? (input.organisationId ?? actor.organisation_id)
        : actor.organisation_id
  if (input.role !== 'platform' && !organisationId) return fail('Choose an organisation.')
  // Checked against the organisation the account is being created in, which is
  // resolved just above — a team belongs to one customer.
  if (input.role !== 'platform' && !(await isTeamOfOrg(organisationId, input.department, true))) {
    return fail('Choose a team.')
  }

  const propertyId = input.role === 'admin' || input.role === 'platform' ? null : (input.propertyId ?? actor.property_id)
  if (input.role === 'manager' || input.role === 'staff') {
    if (!propertyId) return fail('Choose a property.')
    if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  }

  const [clash] = await sql`select 1 from staff where lower(username) = ${username}`
  if (clash) return fail(`“${username}” is not available. Try another.`)

  const extraTeams = await resolveExtraTeams(organisationId, input.role, input.department, input.extraTeams)

  const password = input.password?.trim() || generatePassword()
  const problem = passwordProblem(password)
  if (problem) return fail(problem)

  const [row] = await sql<{ id: string }[]>`
    insert into staff (organisation_id, property_id, username, name, password_hash, department,
                       extra_teams, role, phone)
    values (${organisationId}, ${propertyId}, ${username}, ${name}, ${hashPassword(password)},
            ${input.department}, ${extraTeams}, ${input.role}, ${input.phone?.trim() || null})
    returning id`

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: 'staff.created',
    entity: 'staff',
    entityId: row.id,
    meta: { username, role: input.role, department: input.department, extraTeams },
  })

  // Returned once, shown once, never stored in the clear.
  return { ok: true, password }
}

/**
 * A trust boundary: a forged form field used to reach a CHECK constraint and
 * come back as a 500. The constraint is gone now that teams are rows, so this
 * is the only thing standing between a hand-crafted POST and a staff account
 * routed to a team that does not exist.
 *
 * 'all' is accepted for staff because it is the sentinel for every team.
 */
/**
 * The extra teams a staff account may also cover, filtered to what is real.
 *
 * Only a department account has them: a manager and an admin already see every
 * team, so carrying a list for them would be state that means nothing and can
 * go stale. The main team is removed rather than rejected — picking it twice is
 * a mis-click, not an error worth a message.
 */
async function resolveExtraTeams(
  organisationId: string | null,
  role: Role,
  main: string,
  wanted: string[] | undefined,
): Promise<string[]> {
  if (role !== 'staff' || !wanted?.length || !organisationId) return []
  const teams = await listTeams(organisationId)
  const open = new Set(teams.filter((t) => t.active).map((t) => t.slug))
  return [...new Set(wanted)].filter((slug) => slug !== main && slug !== 'all' && open.has(slug))
}

async function isTeamOfProperty(propertyId: string, slug: string): Promise<boolean> {
  const [row] = await sql<{ organisation_id: string | null }[]>`
    select organisation_id from properties where id = ${propertyId}`
  return isTeamOfOrg(row?.organisation_id ?? null, slug)
}

async function isTeamOfOrg(organisationId: string | null, slug: string, allowAll = false): Promise<boolean> {
  if (allowAll && slug === 'all') return true
  if (!organisationId || !slug) return false
  const teams = await listTeams(organisationId)
  return teams.some((t) => t.slug === slug && t.active)
}

export async function updateStaff(
  actor: Staff,
  id: string,
  input: Omit<StaffInput, 'password' | 'username'>,
): Promise<Ok> {
  const [target] = await sql<
    { role: Role; property_id: string | null; organisation_id: string | null; username: string }[]
  >`select role, property_id, organisation_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (!(await canManageStaff(actor, target))) return fail('Not your account to manage.')
  if (!(await isTeamOfOrg(target.organisation_id, input.department, true))) return fail('Choose a team.')
  if (target.role === 'platform' && actor.role !== 'platform') return fail('Only HConcierge can edit that account.')
  if (target.role === 'admin' && actor.role === 'manager') return fail('Only an admin can edit an admin.')
  // Only a role CHANGE needs the authority to grant it. Requiring it to leave
  // someone where they are meant an admin could not edit another admin's phone
  // number — or their own — without the form silently demoting them to staff.
  if (input.role !== target.role && !canAssignRole(actor, input.role)) {
    return fail('Only a group admin can grant manager or admin.')
  }

  if (id === actor.id && input.role !== actor.role) {
    return fail('You cannot change your own role. Ask another admin.')
  }
  if (target.role === 'admin' && input.role !== 'admin' && (await activeAdminCount(target.organisation_id, id)) === 0) {
    return fail('This is the last admin. Promote someone else first.')
  }

  const propertyId = input.role === 'admin' || input.role === 'platform' ? null : (input.propertyId ?? target.property_id)
  if (input.role === 'manager' || input.role === 'staff') {
    if (!propertyId) return fail('Choose a property.')
    // createStaff checked this and updateStaff did not, so an edit could move
    // somebody into another customer's property and hand them its board.
    if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  }

  const organisationId = input.role === 'platform' ? null : (target.organisation_id ?? actor.organisation_id)
  const extraTeams = await resolveExtraTeams(organisationId, input.role, input.department, input.extraTeams)

  await sql`
    update staff
       set name = ${input.name.trim().slice(0, 120)},
           role = ${input.role},
           department = ${input.department},
           extra_teams = ${extraTeams},
           organisation_id = ${organisationId},
           property_id = ${propertyId},
           phone = ${input.phone?.trim() || null}
     where id = ${id}`

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: 'staff.updated',
    entity: 'staff',
    entityId: id,
    meta: { username: target.username, role: input.role, department: input.department, extraTeams },
  })
  return { ok: true }
}

export async function setStaffActive(actor: Staff, id: string, active: boolean): Promise<Ok> {
  if (id === actor.id) return fail('You cannot deactivate your own account.')

  const [target] = await sql<
    { role: Role; property_id: string | null; organisation_id: string | null; username: string }[]
  >`select role, property_id, organisation_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (target.role === 'platform' && actor.role !== 'platform') return fail('Only HConcierge can do that.')
  if (target.role === 'platform' && !active && (await activePlatformCount(id)) === 0) {
    return fail('This is the last HConcierge account. There would be no way back in.')
  }
  if (target.role === 'admin' && actor.role === 'manager') return fail('Only an admin can do that.')
  if (!(await canManageStaff(actor, target))) return fail('Not your account to manage.')
  if (!active && target.role === 'admin' && (await activeAdminCount(target.organisation_id, id)) === 0) {
    return fail('This is the last active admin. There would be no way back in.')
  }

  await sql`update staff set active = ${active}, failed_logins = 0, locked_until = null where id = ${id}`
  await audit({
    propertyId: target.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: active ? 'staff.reactivated' : 'staff.deactivated',
    entity: 'staff',
    entityId: id,
    meta: { username: target.username },
  })
  return { ok: true }
}

/** Makes the login screen's "your duty manager can reset it" actually true. */
export async function resetStaffPassword(actor: Staff, id: string): Promise<Ok<{ password: string }>> {
  const [target] = await sql<
    { role: Role; property_id: string | null; organisation_id: string | null; username: string }[]
  >`select role, property_id, organisation_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (target.role === 'platform' && actor.role !== 'platform') return fail('Only HConcierge can reset that account.')
  if (target.role === 'admin' && actor.role === 'manager') return fail('Only an admin can reset an admin.')
  if (!(await canManageStaff(actor, target))) return fail('Not your account to manage.')

  const password = generatePassword()
  await sql`
    update staff
       set password_hash = ${hashPassword(password)},
           failed_logins = 0, locked_until = null
     where id = ${id}`

  await audit({
    propertyId: target.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'staff.password_reset',
    entity: 'staff',
    entityId: id,
    meta: { username: target.username },
  })
  return { ok: true, password }
}

export async function unlockStaff(actor: Staff, id: string): Promise<Ok> {
  const [target] = await sql<
    { role: Role; property_id: string | null; organisation_id: string | null; username: string }[]
  >`select role, property_id, organisation_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  // This used to ask only about the property. An admin has none, so a
  // locked-out admin could never be let back in by anyone.
  if (!(await canManageStaff(actor, target))) return fail('Not your account to manage.')

  await sql`update staff set failed_logins = 0, locked_until = null where id = ${id}`
  await audit({
    propertyId: target.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'staff.unlocked',
    entity: 'staff',
    entityId: id,
    meta: { username: target.username },
  })
  return { ok: true }
}

/* --------------------------------------------------------------- properties */

export type PropertyRow = {
  id: string
  slug: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
  brand_color: string
  rooms: number
  staff: number
  items: number
}

export async function listProperties(actor: Staff): Promise<PropertyRow[]> {
  return sql<PropertyRow[]>`
    select p.id, p.slug, p.name, p.address, p.phone, p.timezone, p.brand_color,
           (select count(*)::int from rooms  where property_id = p.id) as rooms,
           (select count(*)::int from staff  where property_id = p.id) as staff,
           (select count(*)::int from items  where property_id = p.id) as items
      from properties p
     where ${scopeTo(actor, sql`p.id`)}
     order by p.name`
}

export type PropertyInput = {
  name: string
  slug: string
  address: string | null
  phone: string | null
  brandColor: string
  timezone: string
}

/**
 * A new hotel with an empty directory is a hotel nobody can order from, so
 * onboarding offers to clone an existing one. Copying is the whole reason a
 * second property takes minutes instead of an afternoon of data entry.
 */
export async function createProperty(
  actor: Staff,
  input: PropertyInput,
  copyCatalogFrom?: string | null,
  organisationId?: string | null,
): Promise<Ok<{ id: string }>> {
  if (actor.role !== 'admin' && actor.role !== 'platform') return fail('Only an admin can add a property.')

  const orgId = actor.role === 'platform' ? (organisationId ?? actor.organisation_id) : actor.organisation_id
  if (!orgId) return fail('Choose an organisation for this property.')

  const name = input.name.trim().slice(0, 120)
  const slug = input.slug.trim().toLowerCase().slice(0, 60)
  if (!name) return fail('Enter a name.')
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return fail('Slugs use 3–60 lowercase letters, numbers and dashes.')
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) return fail('Brand colour must be a hex value like #0F766E.')

  const [clash] = await sql`select 1 from properties where slug = ${slug}`
  if (clash) return fail(`The slug “${slug}” is taken.`)

  // Checked before the insert, not after: a rejected copy source used to leave
  // the half-made property behind.
  if (copyCatalogFrom && !(await canManageProperty(actor, copyCatalogFrom))) {
    return fail('That property is not yours to copy from.')
  }

  const [property] = await sql<{ id: string }[]>`
    insert into properties (organisation_id, slug, name, address, phone, brand_color, timezone)
    values (${orgId}, ${slug}, ${name}, ${input.address?.trim() || null}, ${input.phone?.trim() || null},
            ${input.brandColor}, ${input.timezone || 'Asia/Kolkata'})
    returning id`

  if (copyCatalogFrom && !(await canManageProperty(actor, copyCatalogFrom))) {
    return fail('That is not a property you can copy from.')
  }

  if (copyCatalogFrom) {
    const categories = await sql<{ id: string; kind: string; name: string; icon: string | null; sort: number }[]>`
      select id, kind, name, icon, sort from categories where property_id = ${copyCatalogFrom}`

    for (const c of categories) {
      const [copy] = await sql<{ id: string }[]>`
        insert into categories (property_id, kind, name, icon, sort)
        values (${property.id}, ${c.kind}, ${c.name}, ${c.icon}, ${c.sort})
        returning id`
      await sql`
        insert into items (property_id, category_id, name, description, price_paise, unit,
                           department, sla_minutes, veg, needs_time, modifier_groups, available, sort)
        select ${property.id}, ${copy.id}, name, description, price_paise, unit,
               department, sla_minutes, veg, needs_time, modifier_groups, available, sort
          from items where category_id = ${c.id}`
    }

    await sql`
      insert into info_pages (property_id, slug, title, body, icon, sort)
      select ${property.id}, slug, title, body, icon, sort
        from info_pages where property_id = ${copyCatalogFrom}`
    await sql`
      insert into quick_replies (property_id, label, body, sort)
      select ${property.id}, label, body, sort
        from quick_replies where property_id = ${copyCatalogFrom}`
  }

  await audit({
    propertyId: property.id,
    staffId: actor.id,
    actor: actor.name,
    action: 'property.created',
    entity: 'property',
    entityId: property.id,
    meta: { slug, copiedFrom: copyCatalogFrom ?? null },
  })
  return { ok: true, id: property.id }
}

export async function updateProperty(actor: Staff, id: string, input: PropertyInput): Promise<Ok> {
  if (!(await canManageProperty(actor, id))) return fail('Not your property.')
  // The same rules as creating one. An edit could previously blank the name.
  if (!input.name.trim()) return fail('Enter a name.')
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) return fail('Brand colour must be a hex value like #0F766E.')

  await sql`
    update properties
       set name = ${input.name.trim().slice(0, 120)},
           address = ${input.address?.trim() || null},
           phone = ${input.phone?.trim() || null},
           brand_color = ${input.brandColor},
           timezone = ${input.timezone || 'Asia/Kolkata'}
     where id = ${id}`

  await audit({
    propertyId: id,
    staffId: actor.id,
    actor: actor.name,
    action: 'property.updated',
    entity: 'property',
    entityId: id,
  })
  return { ok: true }
}

/* ------------------------------------------------------------------ catalog */

export type AdminItem = {
  id: string
  category_id: string
  name: string
  description: string | null
  price_paise: number
  unit: string | null
  department: string
  sla_minutes: number
  veg: boolean | null
  needs_time: boolean
  available: boolean
  sort: number
}

export type AdminCategory = {
  id: string
  kind: string
  name: string
  icon: string | null
  sort: number
  active: boolean
  items: AdminItem[]
}

/**
 * One round trip, permission included.
 *
 * The scope is part of the WHERE clause rather than a guard query in front of
 * it: a property this person cannot manage simply matches no rows, and the
 * page loses a whole crossing to Mumbai it used to pay before it could start.
 */
export async function listCatalog(actor: Staff, propertyId: string): Promise<AdminCategory[]> {
  return sql<AdminCategory[]>`
    select c.id, c.kind, c.name, c.icon, c.sort, c.active,
           coalesce(i.items, '[]'::json) as items
      from categories c
      left join lateral (
        select json_agg(json_build_object(
                 'id', it.id, 'category_id', it.category_id, 'name', it.name,
                 'description', it.description, 'price_paise', it.price_paise, 'unit', it.unit,
                 'department', it.department, 'sla_minutes', it.sla_minutes, 'veg', it.veg,
                 'needs_time', it.needs_time, 'available', it.available, 'sort', it.sort)
                 order by it.sort, it.name) as items
          from items it where it.category_id = c.id
      ) i on true
     where c.property_id = ${propertyId}
       and ${scopeTo(actor, sql`c.property_id`, propertyId)}
     order by c.sort, c.name`
}

export type ItemInput = {
  name: string
  description: string | null
  priceRupees: number
  unit: string | null
  department: string
  slaMinutes: number
  veg: boolean | null
  needsTime: boolean
  available: boolean
}

const KINDS = ['amenity', 'fnb', 'service', 'front_desk']

function validateItem(input: ItemInput): string | null {
  if (!input.name.trim()) return 'Enter a name.'
  if (!Number.isFinite(input.priceRupees) || input.priceRupees < 0 || input.priceRupees > 1_000_000) {
    return 'Price must be between ₹0 and ₹10,00,000.'
  }
  if (!Number.isInteger(input.slaMinutes) || input.slaMinutes < 1 || input.slaMinutes > 1440) {
    return 'Target time must be between 1 and 1440 minutes.'
  }
  return null
}

export async function createItem(actor: Staff, categoryId: string, input: ItemInput): Promise<Ok> {
  const [category] = await sql<{ property_id: string }[]>`
    select property_id from categories where id = ${categoryId}`
  if (!category) return fail('That section no longer exists.')
  if (!(await canManageProperty(actor, category.property_id))) return fail('Not your property.')

  const problem = validateItem(input)
  if (problem) return fail(problem)
  if (!(await isTeamOfProperty(category.property_id, input.department))) return fail('Choose a team.')

  const [{ next }] = await sql<{ next: number }[]>`
    select coalesce(max(sort), -1) + 1 as next from items where category_id = ${categoryId}`

  await sql`
    insert into items (property_id, category_id, name, description, price_paise, unit, department,
                       sla_minutes, veg, needs_time, available, sort)
    values (${category.property_id}, ${categoryId}, ${input.name.trim().slice(0, 120)},
            ${input.description?.trim() || null}, ${Math.round(input.priceRupees * 100)},
            ${input.unit?.trim() || null}, ${input.department}, ${input.slaMinutes},
            ${input.veg}, ${input.needsTime}, ${input.available}, ${next})`

  await audit({
    propertyId: category.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'item.created',
    entity: 'item',
    meta: { name: input.name },
  })
  return { ok: true }
}

export async function updateItem(actor: Staff, id: string, input: ItemInput): Promise<Ok> {
  const [item] = await sql<{ property_id: string }[]>`select property_id from items where id = ${id}`
  if (!item) return fail('That item no longer exists.')
  if (!(await canManageProperty(actor, item.property_id))) return fail('Not your property.')

  const problem = validateItem(input)
  if (problem) return fail(problem)
  if (!(await isTeamOfProperty(item.property_id, input.department))) return fail('Choose a team.')

  await sql`
    update items
       set name = ${input.name.trim().slice(0, 120)},
           description = ${input.description?.trim() || null},
           price_paise = ${Math.round(input.priceRupees * 100)},
           unit = ${input.unit?.trim() || null},
           department = ${input.department},
           sla_minutes = ${input.slaMinutes},
           veg = ${input.veg},
           needs_time = ${input.needsTime},
           available = ${input.available}
     where id = ${id}`

  await audit({
    propertyId: item.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'item.updated',
    entity: 'item',
    entityId: id,
    meta: { name: input.name },
  })
  return { ok: true }
}

export async function deleteItem(actor: Staff, id: string): Promise<Ok> {
  const [item] = await sql<{ property_id: string; name: string }[]>`
    select property_id, name from items where id = ${id}`
  if (!item) return { ok: true }
  if (!(await canManageProperty(actor, item.property_id))) return fail('Not your property.')

  // request_items keeps a name and price snapshot, so past orders survive this.
  await sql`delete from items where id = ${id}`
  await audit({
    propertyId: item.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'item.deleted',
    entity: 'item',
    entityId: id,
    meta: { name: item.name },
  })
  return { ok: true }
}

export async function createCategory(
  actor: Staff,
  propertyId: string,
  input: { kind: string; name: string; icon: string | null },
): Promise<Ok> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  const name = input.name.trim().slice(0, 80)
  if (!name) return fail('Enter a name.')
  if (!KINDS.includes(input.kind)) return fail('Choose where this section appears.')

  // Two sections of the same name are two identical tabs on the guest's rail.
  const [twin] = await sql`
    select 1 from categories where property_id = ${propertyId} and lower(name) = ${name.toLowerCase()}`
  if (twin) return fail(`This directory already has a section called “${name}”.`)

  const [{ next }] = await sql<{ next: number }[]>`
    select coalesce(max(sort), -1) + 1 as next from categories where property_id = ${propertyId}`
  await sql`
    insert into categories (property_id, kind, name, icon, sort)
    values (${propertyId}, ${input.kind}, ${name}, ${input.icon?.trim() || null}, ${next})`

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: 'category.created',
    entity: 'category',
    meta: { name: input.name, kind: input.kind },
  })
  return { ok: true }
}

export async function updateCategory(
  actor: Staff,
  id: string,
  input: { kind: string; name: string; icon: string | null; active: boolean },
): Promise<Ok> {
  const [category] = await sql<{ property_id: string }[]>`select property_id from categories where id = ${id}`
  if (!category) return fail('That section no longer exists.')
  if (!(await canManageProperty(actor, category.property_id))) return fail('Not your property.')
  const name = input.name.trim().slice(0, 80)
  if (!name) return fail('Enter a name.')
  if (!KINDS.includes(input.kind)) return fail('Choose where this section appears.')

  const [twin] = await sql`
    select 1 from categories
     where property_id = ${category.property_id} and lower(name) = ${name.toLowerCase()} and id <> ${id}`
  if (twin) return fail(`This directory already has a section called “${name}”.`)

  await sql`
    update categories
       set kind = ${input.kind}, name = ${name},
           icon = ${input.icon?.trim() || null}, active = ${input.active}
     where id = ${id}`
  await audit({
    propertyId: category.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'category.updated',
    entity: 'category',
    entityId: id,
  })
  return { ok: true }
}

export async function deleteCategory(actor: Staff, id: string): Promise<Ok> {
  const [category] = await sql<{ property_id: string; name: string }[]>`
    select property_id, name from categories where id = ${id}`
  if (!category) return { ok: true }
  if (!(await canManageProperty(actor, category.property_id))) return fail('Not your property.')

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from items where category_id = ${id}`
  if (n > 0) return fail(`Empty “${category.name}” first — it still has ${n} item${n === 1 ? '' : 's'}.`)

  await sql`delete from categories where id = ${id}`
  await audit({
    propertyId: category.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'category.deleted',
    entity: 'category',
    entityId: id,
    meta: { name: category.name },
  })
  return { ok: true }
}

/* --------------------------------------------------------------- info pages */

export type AdminInfoPage = {
  id: string
  slug: string
  title: string
  body: string
  icon: string | null
  sort: number
  active: boolean
}

export async function listAdminInfoPages(actor: Staff, propertyId: string): Promise<AdminInfoPage[]> {
  return sql<AdminInfoPage[]>`
    select id, slug, title, body, icon, sort, active from info_pages
     where property_id = ${propertyId}
       and ${scopeTo(actor, sql`property_id`, propertyId)}
     order by sort, title`
}

export async function saveInfoPage(
  actor: Staff,
  propertyId: string,
  input: { id?: string | null; slug: string; title: string; body: string; icon: string | null; active: boolean },
): Promise<Ok> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')
  const title = input.title.trim().slice(0, 120)
  const slug = (input.slug.trim() || title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (!title) return fail('Enter a title.')
  if (!slug) return fail('That title needs at least one letter or number in it.')
  if (!input.body.trim()) return fail('Enter something for the guest to read.')

  if (input.id) {
    // Checked, not caught: the unique index used to surface as a 500.
    const [clash] = await sql`
      select 1 from info_pages
       where property_id = ${propertyId} and slug = ${slug} and id <> ${input.id}`
    if (clash) return fail(`Another page already uses the address “${slug}”.`)

    await sql`
      update info_pages
         set slug = ${slug}, title = ${title}, body = ${input.body.trim()},
             icon = ${input.icon?.trim() || null}, active = ${input.active}
       where id = ${input.id} and property_id = ${propertyId}`
  } else {
    const [clash] = await sql`select 1 from info_pages where property_id = ${propertyId} and slug = ${slug}`
    if (clash) return fail(`A page with the address “${slug}” already exists.`)
    const [{ next }] = await sql<{ next: number }[]>`
      select coalesce(max(sort), -1) + 1 as next from info_pages where property_id = ${propertyId}`
    await sql`
      insert into info_pages (property_id, slug, title, body, icon, sort, active)
      values (${propertyId}, ${slug}, ${title}, ${input.body.trim()},
              ${input.icon?.trim() || null}, ${next}, ${input.active})`
  }

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: input.id ? 'info_page.updated' : 'info_page.created',
    entity: 'info_page',
    entityId: input.id ?? undefined,
    meta: { title },
  })
  return { ok: true }
}

export async function deleteInfoPage(actor: Staff, id: string): Promise<Ok> {
  const [page] = await sql<{ property_id: string; title: string }[]>`
    select property_id, title from info_pages where id = ${id}`
  if (!page) return { ok: true }
  if (!(await canManageProperty(actor, page.property_id))) return fail('Not your property.')

  await sql`delete from info_pages where id = ${id}`
  await audit({
    propertyId: page.property_id,
    staffId: actor.id,
    actor: actor.name,
    action: 'info_page.deleted',
    entity: 'info_page',
    entityId: id,
    meta: { title: page.title },
  })
  return { ok: true }
}

/* -------------------------------------------------------------------- audit */

export type AuditRow = {
  id: string
  actor: string
  action: string
  entity: string | null
  entity_id: string | null
  meta: Record<string, unknown>
  created_at: string
  property_name: string | null
}

/**
 * The half of the log that belongs to an organisation rather than to one of its
 * properties: creating an admin, renaming the company. `scopeTo` filters on
 * property_id, which is null on all of them.
 */
function orgScope(actor: Staff, column: ReturnType<typeof sql>) {
  if (actor.role === 'platform' && !actor.organisation_id) return sql`${column} is not null`
  if (!actor.organisation_id) return sql`false`
  // A manager runs one property; an organisation-wide event is not theirs.
  if (actor.role === 'manager' || actor.role === 'staff') return sql`false`
  return sql`${column} = ${actor.organisation_id}`
}

export async function listAudit(actor: Staff, opts: { action?: string | null; days: number } = { days: 7 }) {
  return sql<AuditRow[]>`
    select a.id, a.actor, a.action, a.entity, a.entity_id, a.meta, a.created_at, p.name as property_name
      from audit_log a left join properties p on p.id = a.property_id
     where (${scopeTo(actor, sql`a.property_id`)} or ${orgScope(actor, sql`a.organisation_id`)})
       and a.created_at > now() - (${opts.days} || ' days')::interval
       and ${opts.action ? sql`a.action like ${opts.action + '%'}` : sql`true`}
     order by a.created_at desc
     limit 300`
}

export async function listAuditActions(actor: Staff): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    select distinct action from audit_log
     where (${scopeTo(actor, sql`property_id`)} or ${orgScope(actor, sql`organisation_id`)})
     order by action`
  return rows.map((r) => r.action)
}

/** Used by the panel's index to say what is actually there. */
export async function adminOverview(actor: Staff) {
  const props = scopeTo(actor, sql`p.id`)
  const [row] = await sql<
    { properties: number; rooms: number; occupied: number; staff: number; items: number; open_requests: number }[]
  >`
    with mine as (select p.id from properties p where ${props})
    select (select count(*)::int from mine)                                               as properties,
           (select count(*)::int from rooms  where property_id in (select id from mine))  as rooms,
           (select count(*)::int from rooms  where occupied
                                              and property_id in (select id from mine))   as occupied,
           (select count(*)::int from items  where property_id in (select id from mine))  as items,
           (select count(*)::int from requests where status in ('new','ack','in_progress')
                                              and property_id in (select id from mine))   as open_requests,
           (select count(*)::int from staff s where s.active and ${
             actor.role === 'platform' && !actor.organisation_id
               ? sql`true`
               : actor.role === 'manager' || actor.role === 'staff'
                 ? sql`s.property_id = ${actor.property_id}`
                 : sql`s.organisation_id = ${actor.organisation_id}`
           })                                                                             as staff`
  return row
}

export const newSlug = () => randomBytes(4).toString('hex')
