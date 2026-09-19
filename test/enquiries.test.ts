import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The website enquiry form, against the real database, with the wire cut.
 *
 * **lib/notify is mocked, and that is not a detail.** Twilio credentials live
 * in .env.local, this file writes real enquiries, and the number an enquiry
 * goes to is somebody's actual phone. An earlier version of this file deleted
 * the transport environment variables in `beforeAll` and trusted that; it sent
 * eight messages. `vi.mock` is hoisted above the imports and replaces the
 * module itself, so there is no ordering to get wrong and no code path left
 * that could reach the network.
 *
 * Cutting it also buys the assertion that matters most: `sendMessage` is what
 * a hotel enquiry looks like on a phone, so the mock records the body and the
 * test reads it. And a mock that returns false is exactly a laptop with the
 * gateway shut - the case lib/enquiries.ts is built around, where the lead has
 * to survive the transport.
 *
 * Everything written here is deleted in `afterAll`, by id.
 */
const sent: { to: string; body: string }[] = []
let delivers = false

vi.mock('../lib/notify', () => ({
  sendMessage: async (to: string, body: string) => {
    sent.push({ to, body })
    return delivers
  },
}))

const HAVE_DB = Boolean(process.env.DATABASE_URL)

type Lib = {
  sql: typeof import('../lib/db')['sql']
  createEnquiry: typeof import('../lib/enquiries')['createEnquiry']
}

describe.skipIf(!HAVE_DB)('an enquiry from the website', { timeout: 20_000 }, () => {
  let lib: Lib
  const written: string[] = []

  beforeAll(async () => {
    const [db, enquiries] = await Promise.all([import('../lib/db'), import('../lib/enquiries')])
    lib = { sql: db.sql, createEnquiry: enquiries.createEnquiry }
  })

  beforeEach(() => {
    sent.length = 0
    delivers = false
  })

  afterAll(async () => {
    if (!lib) return
    for (const id of written) await lib.sql`delete from enquiries where id = ${id}`

    // Sweep, then assert - in that order and not the other way round. This is
    // the live database: a row a test forgot to register is a fake lead in a
    // real inbox, so it gets removed whether or not anybody is watching, and
    // the assertion then reports that it had to. The prefix is safe to match
    // on because no person types "ZZ-TEST" into a hotel field.
    const stray = await lib.sql<{ id: string }[]>`
      delete from enquiries where hotel like 'ZZ-TEST%' returning id`
    expect(stray.length, 'a test wrote a row it never registered for cleanup').toBe(0)
  })

  /** Reads back the row this test just wrote, and remembers it for cleanup. */
  async function lastFor(hotel: string) {
    const [row] = await lib.sql<
      { id: string; name: string; hotel: string; rooms: number | null; email: string | null; phone: string | null; message: string | null; notified_at: Date | null }[]
    >`select id, name, hotel, rooms, email, phone, message, notified_at
        from enquiries where hotel = ${hotel} order by created_at desc limit 1`
    if (row) written.push(row.id)
    return row
  }

  it('keeps the lead even when no transport is up', async () => {
    const hotel = `ZZ-TEST transport down ${Date.now()}`
    const res = await lib.createEnquiry({
      name: 'Test Person',
      hotel,
      rooms: '40',
      contact: 'test@example.com',
      message: 'Reception takes about forty calls a day.',
    })
    expect(res.ok).toBe(true)

    const row = await lastFor(hotel)
    expect(row).toBeTruthy()
    expect(row.name).toBe('Test Person')
    expect(row.rooms).toBe(40)
    // The row is the record; the message is a courtesy on top of it. Nothing
    // was delivered, so nothing claims it was.
    expect(row.notified_at).toBeNull()
  })

  it('stamps the row only when the message actually went', async () => {
    delivers = true
    const hotel = `ZZ-TEST delivered ${Date.now()}`
    await lib.createEnquiry({ name: 'T', hotel, rooms: '12', contact: 'x@y.com', message: '' })
    expect((await lastFor(hotel)).notified_at).not.toBeNull()
  })

  it('sends the desk something it can act on without opening a screen', async () => {
    const hotel = `ZZ-TEST body ${Date.now()}`
    await lib.createEnquiry({
      name: 'Kabir Anand',
      hotel,
      rooms: '64',
      contact: '+91 98765 43210',
      message: 'Two restaurants and a spa.',
    })

    await lastFor(hotel) // registers the row for cleanup
    expect(sent).toHaveLength(1)
    // The number is the one on the public site. A typo here is an enquiry
    // nobody ever sees, and nothing else in the product would notice.
    expect(sent[0].to).toBe('+91 93521 87266')
    for (const fragment of ['Kabir Anand', hotel, '64 rooms', '+91 98765 43210', 'Two restaurants and a spa.']) {
      expect(sent[0].body, `missing "${fragment}"`).toContain(fragment)
    }
  })

  it('never messages anybody when the enquiry was refused', async () => {
    await lib.createEnquiry({ name: '', hotel: 'ZZ-TEST silent', rooms: '', contact: 'x@y.com', message: '' })
    await lib.createEnquiry({ name: 'T', hotel: 'ZZ-TEST silent', rooms: '', contact: 'nope', message: '' })
    expect(sent).toHaveLength(0)
  })

  it('files an email as an email and a phone as a phone', async () => {
    const a = `ZZ-TEST email ${Date.now()}`
    await lib.createEnquiry({ name: 'A', hotel: a, rooms: '', contact: 'a@hotel.com', message: '' })
    const byEmail = await lastFor(a)
    expect(byEmail.email).toBe('a@hotel.com')
    expect(byEmail.phone).toBeNull()

    const b = `ZZ-TEST phone ${Date.now()}`
    await lib.createEnquiry({ name: 'B', hotel: b, rooms: '', contact: '+91 98765 43210', message: '' })
    const byPhone = await lastFor(b)
    expect(byPhone.phone).toBe('+91 98765 43210')
    expect(byPhone.email).toBeNull()
  })

  it('refuses what it cannot reply to, before it writes anything', async () => {
    const base = { name: 'Test', hotel: 'ZZ-TEST refused', rooms: '', message: '' }
    for (const contact of ['', '   ', 'call me', 'a@b', '0123']) {
      const res = await lib.createEnquiry({ ...base, contact })
      expect(res.ok, `"${contact}" should not be accepted`).toBe(false)
    }
    expect(await lastFor('ZZ-TEST refused')).toBeUndefined()
  })

  it('refuses a missing name or hotel', async () => {
    const ok = { name: 'Test', hotel: 'ZZ-TEST blank', rooms: '', contact: 'x@y.com', message: '' }
    expect((await lib.createEnquiry({ ...ok, name: '  ' })).ok).toBe(false)
    expect((await lib.createEnquiry({ ...ok, hotel: '' })).ok).toBe(false)
    expect(await lastFor('ZZ-TEST blank')).toBeUndefined()
  })

  it('takes a nonsense room count as no answer rather than refusing', async () => {
    // "about 40" is a person answering honestly, not an attack. The column
    // takes null and the enquiry still arrives; a negative or absurd one is
    // dropped the same way rather than reaching an int column.
    for (const rooms of ['about 40', '', '-3', '1e9']) {
      const hotel = `ZZ-TEST rooms ${rooms || 'blank'} ${Date.now()}`
      const res = await lib.createEnquiry({ name: 'T', hotel, rooms, contact: 'x@y.com', message: '' })
      expect(res.ok, `rooms="${rooms}"`).toBe(true)
      expect((await lastFor(hotel)).rooms, `rooms="${rooms}"`).toBeNull()
    }
  })

  it('bounds a long message rather than letting it reach the column', async () => {
    const hotel = `ZZ-TEST long ${Date.now()}`
    await lib.createEnquiry({
      name: 'T'.repeat(400),
      hotel,
      rooms: '',
      contact: 'x@y.com',
      message: 'x'.repeat(5000),
    })
    const row = await lastFor(hotel)
    expect(row.name.length).toBe(120)
    expect(row.message!.length).toBe(1200)
  })
})
