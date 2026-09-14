import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { audit } from './audit'
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

const fail = (error: string) => ({ ok: false as const, error })

function canManageProperty(actor: Staff, propertyId: string | null): boolean {
  if (actor.role === 'admin') return true
  return propertyId !== null && canTouchProperty(actor, propertyId)
}

/** Managers may only ever mint plain staff. */
function canAssignRole(actor: Staff, role: Role): boolean {
  return actor.role === 'admin' || role === 'staff'
}

async function activeAdminCount(excluding?: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from staff
     where role = 'admin' and active and id <> coalesce(${excluding ?? null}, '00000000-0000-0000-0000-000000000000'::uuid)`
  return row.n
}

/* -------------------------------------------------------------------- staff */

export type StaffRow = {
  id: string
  username: string
  name: string
  role: Role
  department: Department
  phone: string | null
  active: boolean
  must_change_password: boolean
  failed_logins: number
  locked_until: string | null
  last_login_at: string | null
  property_id: string | null
  property_name: string | null
}

export async function listStaff(actor: Staff): Promise<StaffRow[]> {
  return sql<StaffRow[]>`
    select s.id, s.username, s.name, s.role, s.department, s.phone, s.active,
           s.must_change_password, s.failed_logins, s.locked_until, s.last_login_at,
           s.property_id, p.name as property_name
      from staff s left join properties p on p.id = s.property_id
     where ${actor.role === 'admin' ? sql`true` : sql`s.property_id = ${actor.property_id}`}
     order by case s.role when 'admin' then 0 when 'manager' then 1 else 2 end, s.name`
}

export type StaffInput = {
  name: string
  username: string
  role: Role
  department: Department
  propertyId: string | null
  phone: string | null
  password?: string
}

export async function createStaff(actor: Staff, input: StaffInput): Promise<Ok<{ password: string }>> {
  const name = input.name.trim().slice(0, 120)
  const username = input.username.trim().toLowerCase().slice(0, 60)

  if (!name) return fail('Enter a name.')
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) {
    return fail('Usernames use 3–60 lowercase letters, numbers, dot, dash or underscore.')
  }
  if (!canAssignRole(actor, input.role)) return fail('Only a group admin can create managers or admins.')

  const propertyId = input.role === 'admin' ? null : (input.propertyId ?? actor.property_id)
  if (input.role !== 'admin') {
    if (!propertyId) return fail('Choose a property.')
    if (!canManageProperty(actor, propertyId)) return fail('Not your property.')
  }

  const [clash] = await sql`select 1 from staff where lower(username) = ${username}`
  if (clash) return fail(`The username “${username}” is taken.`)

  const password = input.password?.trim() || generatePassword()
  const problem = passwordProblem(password)
  if (problem) return fail(problem)

  const [row] = await sql<{ id: string }[]>`
    insert into staff (property_id, username, name, password_hash, department, role, phone,
                       must_change_password)
    values (${propertyId}, ${username}, ${name}, ${hashPassword(password)},
            ${input.department}, ${input.role}, ${input.phone?.trim() || null}, true)
    returning id`

  await audit({
    propertyId,
    staffId: actor.id,
    actor: actor.name,
    action: 'staff.created',
    entity: 'staff',
    entityId: row.id,
    meta: { username, role: input.role, department: input.department },
  })

  // Returned once, shown once, never stored in the clear.
  return { ok: true, password }
}

export async function updateStaff(
  actor: Staff,
  id: string,
  input: Omit<StaffInput, 'password' | 'username'>,
): Promise<Ok> {
  const [target] = await sql<{ role: Role; property_id: string | null; username: string }[]>`
    select role, property_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (!canManageProperty(actor, target.property_id) && target.role !== 'admin') return fail('Not your property.')
  if (target.role === 'admin' && actor.role !== 'admin') return fail('Only a group admin can edit an admin.')
  if (!canAssignRole(actor, input.role)) return fail('Only a group admin can grant manager or admin.')

  if (id === actor.id && input.role !== actor.role) {
    return fail('You cannot change your own role. Ask another admin.')
  }
  if (target.role === 'admin' && input.role !== 'admin' && (await activeAdminCount(id)) === 0) {
    return fail('This is the last admin. Promote someone else first.')
  }

  const propertyId = input.role === 'admin' ? null : (input.propertyId ?? target.property_id)
  if (input.role !== 'admin' && !propertyId) return fail('Choose a property.')

  await sql`
    update staff
       set name = ${input.name.trim().slice(0, 120)},
           role = ${input.role},
           department = ${input.department},
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
    meta: { username: target.username, role: input.role },
  })
  return { ok: true }
}

export async function setStaffActive(actor: Staff, id: string, active: boolean): Promise<Ok> {
  if (id === actor.id) return fail('You cannot deactivate your own account.')

  const [target] = await sql<{ role: Role; property_id: string | null; username: string }[]>`
    select role, property_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (target.role === 'admin' && actor.role !== 'admin') return fail('Only a group admin can do that.')
  if (!canManageProperty(actor, target.property_id) && target.role !== 'admin') return fail('Not your property.')
  if (!active && target.role === 'admin' && (await activeAdminCount(id)) === 0) {
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
  const [target] = await sql<{ role: Role; property_id: string | null; username: string }[]>`
    select role, property_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (target.role === 'admin' && actor.role !== 'admin') return fail('Only a group admin can reset an admin.')
  if (!canManageProperty(actor, target.property_id) && target.role !== 'admin') return fail('Not your property.')

  const password = generatePassword()
  await sql`
    update staff
       set password_hash = ${hashPassword(password)}, must_change_password = true,
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
  const [target] = await sql<{ property_id: string | null; username: string }[]>`
    select property_id, username from staff where id = ${id}`
  if (!target) return fail('That account no longer exists.')
  if (!canManageProperty(actor, target.property_id)) return fail('Not your property.')

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
     where ${actor.role === 'admin' ? sql`true` : sql`p.id = ${actor.property_id}`}
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
): Promise<Ok<{ id: string }>> {
  if (actor.role !== 'admin') return fail('Only a group admin can add a property.')

  const name = input.name.trim().slice(0, 120)
  const slug = input.slug.trim().toLowerCase().slice(0, 60)
  if (!name) return fail('Enter a name.')
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return fail('Slugs use 3–60 lowercase letters, numbers and dashes.')
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) return fail('Brand colour must be a hex value like #0F766E.')

  const [clash] = await sql`select 1 from properties where slug = ${slug}`
  if (clash) return fail(`The slug “${slug}” is taken.`)

  const [property] = await sql<{ id: string }[]>`
    insert into properties (slug, name, address, phone, brand_color, timezone)
    values (${slug}, ${name}, ${input.address?.trim() || null}, ${input.phone?.trim() || null},
            ${input.brandColor}, ${input.timezone || 'Asia/Kolkata'})
    returning id`

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
  if (!canManageProperty(actor, id)) return fail('Not your property.')
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

export async function listCatalog(actor: Staff, propertyId: string): Promise<AdminCategory[]> {
  if (!canManageProperty(actor, propertyId)) return []

  const [categories, items] = await Promise.all([
    sql<Omit<AdminCategory, 'items'>[]>`
      select id, kind, name, icon, sort, active from categories
       where property_id = ${propertyId} order by sort, name`,
    sql<AdminItem[]>`
      select i.id, i.category_id, i.name, i.description, i.price_paise, i.unit, i.department,
             i.sla_minutes, i.veg, i.needs_time, i.available, i.sort
        from items i where i.property_id = ${propertyId} order by i.sort, i.name`,
  ])

  const byCategory = new Map<string, AdminItem[]>()
  for (const i of items) {
    const list = byCategory.get(i.category_id)
    if (list) list.push(i)
    else byCategory.set(i.category_id, [i])
  }
  return categories.map((c) => ({ ...c, items: byCategory.get(c.id) ?? [] }))
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

const DEPARTMENTS = ['front_desk', 'housekeeping', 'fnb', 'maintenance']
const KINDS = ['amenity', 'fnb', 'service', 'front_desk']

function validateItem(input: ItemInput): string | null {
  if (!input.name.trim()) return 'Enter a name.'
  if (!DEPARTMENTS.includes(input.department)) return 'Choose a team.'
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
  if (!canManageProperty(actor, category.property_id)) return fail('Not your property.')

  const problem = validateItem(input)
  if (problem) return fail(problem)

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
  if (!canManageProperty(actor, item.property_id)) return fail('Not your property.')

  const problem = validateItem(input)
  if (problem) return fail(problem)

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
  if (!canManageProperty(actor, item.property_id)) return fail('Not your property.')

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
  if (!canManageProperty(actor, propertyId)) return fail('Not your property.')
  if (!input.name.trim()) return fail('Enter a name.')
  if (!KINDS.includes(input.kind)) return fail('Choose where this section appears.')

  const [{ next }] = await sql<{ next: number }[]>`
    select coalesce(max(sort), -1) + 1 as next from categories where property_id = ${propertyId}`
  await sql`
    insert into categories (property_id, kind, name, icon, sort)
    values (${propertyId}, ${input.kind}, ${input.name.trim().slice(0, 80)},
            ${input.icon?.trim() || null}, ${next})`

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
  if (!canManageProperty(actor, category.property_id)) return fail('Not your property.')
  if (!KINDS.includes(input.kind)) return fail('Choose where this section appears.')

  await sql`
    update categories
       set kind = ${input.kind}, name = ${input.name.trim().slice(0, 80)},
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
  if (!canManageProperty(actor, category.property_id)) return fail('Not your property.')

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
  if (!canManageProperty(actor, propertyId)) return []
  return sql<AdminInfoPage[]>`
    select id, slug, title, body, icon, sort, active from info_pages
     where property_id = ${propertyId} order by sort, title`
}

export async function saveInfoPage(
  actor: Staff,
  propertyId: string,
  input: { id?: string | null; slug: string; title: string; body: string; icon: string | null; active: boolean },
): Promise<Ok> {
  if (!canManageProperty(actor, propertyId)) return fail('Not your property.')
  const title = input.title.trim().slice(0, 120)
  const slug = (input.slug.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 60)
  if (!title) return fail('Enter a title.')
  if (!input.body.trim()) return fail('Enter something for the guest to read.')

  if (input.id) {
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
  if (!canManageProperty(actor, page.property_id)) return fail('Not your property.')

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

export async function listAudit(actor: Staff, opts: { action?: string | null; days: number } = { days: 7 }) {
  return sql<AuditRow[]>`
    select a.id, a.actor, a.action, a.entity, a.entity_id, a.meta, a.created_at, p.name as property_name
      from audit_log a left join properties p on p.id = a.property_id
     where ${actor.role === 'admin' ? sql`true` : sql`a.property_id = ${actor.property_id}`}
       and a.created_at > now() - (${opts.days} || ' days')::interval
       and ${opts.action ? sql`a.action like ${opts.action + '%'}` : sql`true`}
     order by a.created_at desc
     limit 300`
}

export async function listAuditActions(actor: Staff): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`
    select distinct action from audit_log
     where ${actor.role === 'admin' ? sql`true` : sql`property_id = ${actor.property_id}`}
     order by action`
  return rows.map((r) => r.action)
}

/** Used by the panel's index to say what is actually there. */
export async function adminOverview(actor: Staff) {
  const [row] = await sql<
    { properties: number; rooms: number; occupied: number; staff: number; items: number; open_requests: number }[]
  >`
    select (select count(*)::int from properties
             where ${actor.role === 'admin' ? sql`true` : sql`id = ${actor.property_id}`}) as properties,
           (select count(*)::int from rooms r
             where ${actor.role === 'admin' ? sql`true` : sql`r.property_id = ${actor.property_id}`}) as rooms,
           (select count(*)::int from rooms r where r.occupied
             and ${actor.role === 'admin' ? sql`true` : sql`r.property_id = ${actor.property_id}`}) as occupied,
           (select count(*)::int from staff s where s.active
             and ${actor.role === 'admin' ? sql`true` : sql`s.property_id = ${actor.property_id}`}) as staff,
           (select count(*)::int from items i
             where ${actor.role === 'admin' ? sql`true` : sql`i.property_id = ${actor.property_id}`}) as items,
           (select count(*)::int from requests q where q.status in ('new','ack','in_progress')
             and ${actor.role === 'admin' ? sql`true` : sql`q.property_id = ${actor.property_id}`}) as open_requests`
  return row
}

export const newSlug = () => randomBytes(4).toString('hex')
