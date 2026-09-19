import { sql } from './db'
import { audit } from './audit'
import { canManageProperty, fail } from './admin'
import { listTeams } from './departments'
import { parseCsvRows, toCsv } from './csv'
import type { Staff } from './auth'

/**
 * Bulk import from a spreadsheet, for the afternoon a property is set up.
 *
 * Two rules run through all four kinds.
 *
 * **Nothing is written unless every row is valid.** A partial import is worse
 * than a failed one: the person now has to work out which of two hundred rows
 * landed before fixing the file, and re-uploading would duplicate the ones that
 * did. So each kind validates the whole file, and either reports every problem
 * with its line number or writes the lot in one transaction.
 *
 * **A template is the documentation.** There is no separate page explaining the
 * columns; the file you download has the headers, one filled example row, and
 * the legal values for anything constrained. Nobody reads the docs and
 * everybody opens the file.
 */

export type ImportKind = 'rooms' | 'items' | 'staff' | 'info'

export type ImportReport =
  | { ok: true; created: number; kind: ImportKind }
  | { ok: false; error: string; problems?: { line: number; says: string }[] }

type Spec = {
  label: string
  /** What the download contains: headers, then example rows. */
  headers: string[]
  example: (string | number)[][]
  /** A sentence under the upload box, and the only explanation there is. */
  hint: string
}

export const SPECS: Record<ImportKind, Spec> = {
  rooms: {
    label: 'Rooms',
    headers: ['number', 'floor', 'room_type'],
    example: [
      ['101', '1', 'Deluxe'],
      ['102', '1', 'Deluxe'],
      ['201', '2', 'Suite'],
    ],
    hint: 'Only “number” is required, and it has to be unique in the property. Each room gets its own permanent QR the moment it is created.',
  },
  items: {
    label: 'Directory items',
    headers: ['section', 'name', 'description', 'price_rupees', 'target_minutes', 'team', 'veg', 'available'],
    example: [
      ['All day dining', 'Masala Dosa', 'Served with sambar and chutney', '260', '30', 'fnb', 'yes', 'yes'],
      ['All day dining', 'Chicken Biryani', '', '420', '40', 'fnb', 'no', 'yes'],
      ['Housekeeping', 'Bath towels', 'A fresh pair', '0', '10', 'housekeeping', '', 'yes'],
    ],
    hint: 'A section that does not exist yet is created. Price is in rupees and may have paise - 260.50 is fine. Leave “veg” blank for anything that is not food.',
  },
  staff: {
    label: 'Staff',
    headers: ['name', 'username', 'role', 'team', 'phone'],
    example: [
      ['Sunita Rao', 'pune.housekeeping', 'staff', 'housekeeping', ''],
      ['Anil Kumar', 'pune.duty', 'manager', 'all', '+91 98765 43210'],
    ],
    hint: 'Every account gets a one-time password, listed once when the import finishes. Copy them then - they are not stored and cannot be shown again.',
  },
  info: {
    label: 'Hotel info pages',
    headers: ['title', 'slug', 'body'],
    example: [
      ['Wifi', 'wifi', 'Network: RNGrand-Guest\nPassword: welcome2026'],
      ['Checkout', 'checkout', 'Checkout is at 11am. Ask the desk for a later time.'],
    ],
    hint: 'Slug is what appears in the link and has to be unique. Line breaks inside a cell survive - quote the cell in Excel and they come through.',
  },
}

/** The downloadable file. Headers, examples, nothing else. */
export function templateCsv(kind: ImportKind): string {
  const spec = SPECS[kind]
  return toCsv(spec.headers, spec.example)
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim())
const no = (v: string) => /^(n|no|false|0)$/i.test(v.trim())

/** Rupees with optional paise to integer paise, or null if it is not a number. */
function paise(v: string): number | null {
  const t = v.trim()
  if (t === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

export async function importCsv(
  actor: Staff,
  kind: ImportKind,
  propertyId: string,
  text: string,
): Promise<ImportReport> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')

  const spec = SPECS[kind]
  const { headers, rows } = parseCsvRows(text)
  if (rows.length === 0) return fail('That file has a header row and nothing under it.')
  if (rows.length > 1000) return fail(`That is ${rows.length} rows. Split it into files of a thousand or fewer.`)

  const missing = spec.headers.filter((h) => !headers.includes(h))
  if (missing.length) {
    return fail(
      `The header row is missing ${missing.map((m) => `“${m}”`).join(', ')}. Download the template and paste into that.`,
    )
  }

  const problems: { line: number; says: string }[] = []
  // Row 1 is the header, so a spreadsheet's line number is the index plus two.
  const at = (i: number) => i + 2
  const complain = (i: number, says: string) => problems.push({ line: at(i), says })

  const teams = await listTeams(actor.organisation_id)
  const teamSlugs = new Set(teams.map((t) => t.slug))

  if (kind === 'rooms') {
    const seen = new Set<string>()
    const existing = new Set(
      (await sql<{ number: string }[]>`select number from rooms where property_id = ${propertyId}`).map(
        (r) => r.number,
      ),
    )
    rows.forEach((r, i) => {
      const n = r.number
      if (!n) return complain(i, 'no room number')
      if (n.length > 16) return complain(i, `room number “${n}” is too long`)
      if (seen.has(n)) return complain(i, `room ${n} appears twice in this file`)
      if (existing.has(n)) return complain(i, `room ${n} already exists`)
      seen.add(n)
    })
    if (problems.length) return { ok: false, error: `${problems.length} row${problems.length === 1 ? '' : 's'} need fixing.`, problems }

    await sql.begin(async (tx) => {
      for (const r of rows) {
        await tx`
          insert into rooms (property_id, number, floor, room_type, token)
          values (${propertyId}, ${r.number}, ${r.floor || null}, ${r.room_type || null},
                  encode(gen_random_bytes(8), 'base64'))`
      }
      // base64 can contain / and +, which are legal in a path segment but ugly
      // in a printed URL. Normalise to the same alphabet newToken() uses.
      await tx`
        update rooms set token = replace(replace(replace(token, '/', '_'), '+', '-'), '=', '')
         where property_id = ${propertyId} and token ~ '[/+=]'`
    })
    await audit({
      propertyId,
      staffId: actor.id,
      actor: actor.name,
      action: 'import.rooms',
      meta: { rows: rows.length },
    })
    return { ok: true, created: rows.length, kind }
  }

  if (kind === 'items') {
    rows.forEach((r, i) => {
      if (!r.name) return complain(i, 'no name')
      if (!r.section) return complain(i, `“${r.name}” has no section`)
      if (paise(r.price_rupees) === null) return complain(i, `“${r.price_rupees}” is not a price`)
      const mins = Number(r.target_minutes)
      if (!Number.isInteger(mins) || mins < 1 || mins > 1440) {
        return complain(i, `“${r.target_minutes}” is not a target in minutes`)
      }
      if (!teamSlugs.has(r.team)) {
        return complain(i, `no team called “${r.team}” - this hotel has ${[...teamSlugs].join(', ')}`)
      }
      if (r.veg && !yes(r.veg) && !no(r.veg)) return complain(i, `“${r.veg}” is not yes or no`)
      if (r.available && !yes(r.available) && !no(r.available)) return complain(i, `“${r.available}” is not yes or no`)
    })
    if (problems.length) return { ok: false, error: `${problems.length} row${problems.length === 1 ? '' : 's'} need fixing.`, problems }

    // A section named in the file but not in the database is created rather
    // than rejected: the alternative is making somebody add eight categories by
    // hand before they may use the importer at all.
    const kindOf = (team: string) => (team === 'fnb' ? 'fnb' : team === 'housekeeping' ? 'amenity' : 'service')
    await sql.begin(async (tx) => {
      const cats = new Map<string, string>()
      for (const [, r] of rows.entries()) {
        if (cats.has(r.section)) continue
        const [found] = await tx<{ id: string }[]>`
          select id from categories where property_id = ${propertyId} and lower(name) = ${r.section.toLowerCase()}`
        if (found) {
          cats.set(r.section, found.id)
          continue
        }
        const [made] = await tx<{ id: string }[]>`
          insert into categories (property_id, kind, name)
          values (${propertyId}, ${kindOf(r.team)}, ${r.section}) returning id`
        cats.set(r.section, made.id)
      }
      for (const r of rows) {
        await tx`
          insert into items (property_id, category_id, name, description, price_paise, department,
                             sla_minutes, veg, available)
          values (${propertyId}, ${cats.get(r.section)!}, ${r.name}, ${r.description || null},
                  ${paise(r.price_rupees)!}, ${r.team}, ${Number(r.target_minutes)},
                  ${r.veg ? yes(r.veg) : null}, ${r.available ? yes(r.available) : true})`
      }
    })
    await audit({ propertyId, staffId: actor.id, actor: actor.name, action: 'import.items', meta: { rows: rows.length } })
    return { ok: true, created: rows.length, kind }
  }

  if (kind === 'info') {
    const seen = new Set<string>()
    const existing = new Set(
      (await sql<{ slug: string }[]>`select slug from info_pages where property_id = ${propertyId}`).map((r) => r.slug),
    )
    rows.forEach((r, i) => {
      if (!r.title) return complain(i, 'no title')
      const slug = r.slug || r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (!/^[a-z0-9-]{1,60}$/.test(slug)) return complain(i, `“${slug}” is not a usable slug`)
      if (seen.has(slug)) return complain(i, `slug “${slug}” appears twice in this file`)
      if (existing.has(slug)) return complain(i, `slug “${slug}” already exists`)
      seen.add(slug)
      r.slug = slug
    })
    if (problems.length) return { ok: false, error: `${problems.length} row${problems.length === 1 ? '' : 's'} need fixing.`, problems }

    await sql.begin(async (tx) => {
      for (const r of rows) {
        await tx`
          insert into info_pages (property_id, slug, title, body)
          values (${propertyId}, ${r.slug}, ${r.title}, ${r.body || ''})`
      }
    })
    await audit({ propertyId, staffId: actor.id, actor: actor.name, action: 'import.info', meta: { rows: rows.length } })
    return { ok: true, created: rows.length, kind }
  }

  // Staff is deliberately separate: it mints credentials, so it routes through
  // lib/admin.createStaff rather than inserting rows here. That keeps one
  // authority check, one password policy and one audit shape for every account
  // this product has ever created.
  return fail('Use importStaffCsv for staff.')
}

/**
 * Staff, which is the one kind that cannot be all-or-nothing.
 *
 * `createStaff` hashes a generated password, checks the actor may grant the
 * role, and audits - none of which belongs inlined into a transaction here. So
 * this validates everything checkable first (username shape, duplicates inside
 * the file, usernames already taken, role assignability, team exists) and only
 * then creates. What is left that can still fail mid-run is a genuine race with
 * somebody creating the same username in another tab, and the report says which
 * rows landed rather than pretending none did.
 */
export async function importStaffCsv(
  actor: Staff,
  propertyId: string,
  text: string,
): Promise<ImportReport | { ok: true; created: number; kind: 'staff'; passwords: { username: string; password: string }[] }> {
  if (!(await canManageProperty(actor, propertyId))) return fail('Not your property.')

  const { headers, rows } = parseCsvRows(text)
  if (rows.length === 0) return fail('That file has a header row and nothing under it.')
  if (rows.length > 200) return fail(`That is ${rows.length} accounts. Two hundred is the limit for one file.`)

  const missing = SPECS.staff.headers.filter((h) => !headers.includes(h))
  if (missing.length) {
    return fail(`The header row is missing ${missing.map((m) => `“${m}”`).join(', ')}. Use the template.`)
  }

  const problems: { line: number; says: string }[] = []
  const at = (i: number) => i + 2

  const teams = await listTeams(actor.organisation_id)
  const teamSlugs = new Set(teams.map((t) => t.slug))
  const taken = new Set(
    (await sql<{ username: string }[]>`select lower(username) as username from staff`).map((r) => r.username),
  )
  const seen = new Set<string>()
  const ALLOWED: Record<string, string[]> = {
    platform: ['staff', 'manager', 'admin'],
    admin: ['staff', 'manager'],
    manager: ['staff'],
  }
  const grantable = ALLOWED[actor.role] ?? []

  rows.forEach((r, i) => {
    const u = r.username.toLowerCase()
    if (!r.name) problems.push({ line: at(i), says: 'no name' })
    if (!/^[a-z0-9._-]{3,60}$/.test(u)) {
      problems.push({ line: at(i), says: `“${r.username}” is not a usable username` })
    } else if (seen.has(u)) problems.push({ line: at(i), says: `“${u}” appears twice in this file` })
    else if (taken.has(u)) problems.push({ line: at(i), says: `“${u}” is already in use` })
    seen.add(u)

    if (!grantable.includes(r.role)) {
      // "a admin" - the one role in the set that takes "an".
      const article = /^[aeiou]/i.test(r.role) ? 'an' : 'a'
      problems.push({
        line: at(i),
        says: `you cannot create ${article} “${r.role}” - only ${grantable.join(', ')}`,
      })
    }
    if (r.team !== 'all' && !teamSlugs.has(r.team)) {
      problems.push({ line: at(i), says: `no team called “${r.team}”` })
    }
  })
  if (problems.length) {
    return { ok: false, error: `${problems.length} row${problems.length === 1 ? '' : 's'} need fixing.`, problems }
  }

  const { createStaff } = await import('./admin')
  const passwords: { username: string; password: string }[] = []
  for (const [i, r] of rows.entries()) {
    const res = await createStaff(actor, {
      name: r.name,
      username: r.username,
      role: r.role as never,
      department: r.team as never,
      propertyId,
      phone: r.phone || null,
    })
    if (!res.ok) {
      return {
        ok: false,
        error: `Created ${passwords.length} before line ${at(i)} failed: ${res.error}`,
        problems: [{ line: at(i), says: res.error }],
      }
    }
    passwords.push({ username: r.username.toLowerCase(), password: res.password })
  }

  return { ok: true, created: passwords.length, kind: 'staff', passwords }
}
