import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Type-only, so nothing from lib/auth (and therefore next/headers) is loaded.
import type { Staff } from '../lib/auth'

/**
 * The half of the db/check-* scripts that needs a database, as assertions.
 *
 * Skipped without DATABASE_URL, so `npm test` is still meaningful in CI or on a
 * fresh clone — and the skip is loud rather than a silent pass. Everything it
 * writes it takes back in `afterAll`, keyed by id rather than by description:
 * "Masala Dosa" is a real menu item and deleting by name once removed a real
 * row from the shared development database.
 *
 * lib/* is imported dynamically. A top-level import would construct the
 * Postgres client even on the skip path.
 */
const HAVE_DB = Boolean(process.env.DATABASE_URL)

type Lib = {
  sql: typeof import('../lib/db')['sql']
  admin: typeof import('../lib/admin')
  receipt: typeof import('../lib/receipt')
}

describe.skipIf(!HAVE_DB)('against the real database', () => {
  let lib: Lib
  let manager: Staff
  let otherProperty: { id: string; name: string } | undefined
  const mine: string[] = []

  beforeAll(async () => {
    lib = {
      sql: (await import('../lib/db')).sql,
      admin: await import('../lib/admin'),
      receipt: await import('../lib/receipt'),
    }
    // The whole Staff shape, not a convenient subset: scopeTo and
    // canManageProperty read role, property_id and organisation_id, and a
    // partial object typed as Staff would hide it if that ever changed.
    const [row] = await lib.sql<Staff[]>`
      select s.id, s.username, s.name, s.department, s.role, s.phone, s.property_id,
             coalesce(s.organisation_id, p.organisation_id) as organisation_id,
             coalesce(s.extra_teams, '{}') as extra_teams
        from staff s join properties p on p.id = s.property_id
       where s.role = 'manager' and s.active and s.property_id is not null
       order by s.name limit 1`
    manager = row
    ;[otherProperty] = await lib.sql<{ id: string; name: string }[]>`
      select id, name from properties where id <> ${row.property_id} order by name limit 1`
  })

  afterAll(async () => {
    if (!lib) return
    if (mine.length > 0) await lib.sql`delete from quick_replies where id = any(${mine})`
    await lib.sql.end()
  })

  describe('quick replies', () => {
    it('are scoped to the manager’s own property', async () => {
      const ours = await lib.admin.listQuickReplies(manager, manager.property_id!)
      expect(Array.isArray(ours)).toBe(true)
      expect(ours.every((q) => q.label && q.body)).toBe(true)
    })

    it('cannot be read across properties', async () => {
      if (!otherProperty) return
      expect(await lib.admin.listQuickReplies(manager, otherProperty.id)).toHaveLength(0)
    })

    it('cannot be written across properties', async () => {
      if (!otherProperty) return
      const res = await lib.admin.saveQuickReply(manager, otherProperty.id, { label: 'Nope', body: 'x' })
      expect(res.ok).toBe(false)
      // Narrowed rather than asserted through: `Ok` is a discriminated union
      // and carries no `error` on the success side.
      expect(res.ok ? '' : res.error).toMatch(/not your property/i)
    })

    it('refuse a blank name or a blank body', async () => {
      const noName = await lib.admin.saveQuickReply(manager, manager.property_id!, { label: '  ', body: 'x' })
      const noBody = await lib.admin.saveQuickReply(manager, manager.property_id!, { label: 'x', body: ' \n ' })
      expect(noName.ok).toBe(false)
      expect(noBody.ok).toBe(false)
    })

    it('save, edit and delete, without duplicating on a repeated name', async () => {
      const label = `vitest ${Date.now()}`
      const before = await lib.admin.listQuickReplies(manager, manager.property_id!)

      expect((await lib.admin.saveQuickReply(manager, manager.property_id!, { label, body: 'A'.repeat(1200) })).ok).toBe(true)
      const created = (await lib.admin.listQuickReplies(manager, manager.property_id!)).find((q) => q.label === label)!
      mine.push(created.id)

      // The body is capped at the reply box's own maxLength, so a canned line
      // cannot arrive silently cut by the browser it is pasted into.
      expect(created.body).toHaveLength(1000)
      expect(created.sort).toBeGreaterThanOrEqual(before.length === 0 ? 0 : Math.max(...before.map((q) => q.sort)))

      const clash = await lib.admin.saveQuickReply(manager, manager.property_id!, { label: label.toUpperCase(), body: 'again' })
      expect(clash.ok).toBe(false)

      expect((await lib.admin.saveQuickReply(manager, manager.property_id!, { id: created.id, label, body: 'On the way up.' })).ok).toBe(true)
      const after = await lib.admin.listQuickReplies(manager, manager.property_id!)
      expect(after.find((q) => q.id === created.id)!.body).toBe('On the way up.')
      expect(after).toHaveLength(before.length + 1)

      expect((await lib.admin.deleteQuickReply(manager, created.id)).ok).toBe(true)
      mine.length = 0
      expect(await lib.admin.listQuickReplies(manager, manager.property_id!)).toHaveLength(before.length)
      // Deleting twice is not an error: the notification and the board can
      // both arrive at it.
      expect((await lib.admin.deleteQuickReply(manager, created.id)).ok).toBe(true)
    })
  })

  describe('buildReceipt', () => {
    it('totals what it lists, for a real room', async () => {
      const [room] = await lib.sql<{ id: string }[]>`select id from rooms order by number limit 1`
      const built = await lib.receipt.buildReceipt(room.id)
      expect(built).not.toBeNull()
      expect(built!.total).toBe(built!.lines.reduce((n, l) => n + l.amount, 0))
      expect(built!.empty).toBe(built!.lines.length === 0)
      // Whatever it holds, it has to fit the paper and carry no rupee sign.
      for (const line of lib.receipt.receiptText(built!, lib.receipt.WIDTH_58MM)) {
        expect(line.length).toBeLessThanOrEqual(lib.receipt.WIDTH_58MM)
        expect(line).not.toContain('₹')
      }
    })

    it('is null for a room that does not exist', async () => {
      expect(await lib.receipt.buildReceipt('00000000-0000-4000-8000-000000000000')).toBeNull()
    })
  })
})
