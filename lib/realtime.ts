import postgres from 'postgres'

/**
 * Push, instead of asking every few seconds.
 *
 * Every table a guest screen or a board watches has an `after` trigger that
 * calls `pg_notify` (see the bottom of db/schema.sql). This module holds ONE
 * listening connection per server process and fans the notifications out to
 * however many streams are open on it - a hundred guests watching their orders
 * cost one database connection between them, not a hundred.
 *
 * The listener needs a session, and the app's pooled URL is pgbouncer in
 * transaction mode, which silently drops LISTEN. Supabase serves the same
 * database in session mode on 5432, so that is the connection we open here.
 * NOTIFY is an ordinary statement and still travels fine over the pool.
 */

export const ROOM_CHANNEL = 'hc_room'
export const PROPERTY_CHANNEL = 'hc_property'

type Fanout = Map<string, Set<() => void>>

type Hub = {
  sql: postgres.Sql | null
  ready: Promise<void> | null
  rooms: Fanout
  properties: Fanout
}

// Survives HMR in dev; one per lambda instance in production.
const globalHub = globalThis as unknown as { __hcHub?: Hub }
const hub: Hub = (globalHub.__hcHub ??= { sql: null, ready: null, rooms: new Map(), properties: new Map() })

function sessionUrl(): string | null {
  const explicit = process.env.DATABASE_URL_SESSION
  if (explicit) return explicit
  const pooled = process.env.DATABASE_URL
  // 6543 is the transaction pooler, 5432 the session pooler on the same host.
  return pooled ? pooled.replace(':6543/', ':5432/') : null
}

function deliver(map: Fanout, key: string): void {
  const subs = map.get(key)
  if (!subs) return
  for (const fn of subs) {
    try {
      fn()
    } catch {
      // One broken stream must not stop the others being told.
    }
  }
}

/**
 * Opened on the first subscriber and then left open for the life of the
 * process. If it cannot be established the callers fall back to their slow
 * safety poll, so this rejects quietly rather than taking a request down.
 */
function connect(): Promise<void> {
  if (hub.ready) return hub.ready

  hub.ready = (async () => {
    const url = sessionUrl()
    if (!url) throw new Error('no DATABASE_URL')

    const sql = postgres(url, {
      prepare: false,
      ssl: 'require',
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      onnotice: () => {},
    })
    hub.sql = sql

    await sql.listen(ROOM_CHANNEL, (payload) => deliver(hub.rooms, payload))
    await sql.listen(PROPERTY_CHANNEL, (payload) => deliver(hub.properties, payload))
  })().catch((err) => {
    console.error('[realtime] listener unavailable, clients will fall back to polling:', err)
    hub.ready = null
    hub.sql = null
    throw err
  })

  return hub.ready
}

function subscribe(map: Fanout, key: string, onChange: () => void): () => void {
  const subs = map.get(key) ?? new Set()
  subs.add(onChange)
  map.set(key, subs)

  void connect().catch(() => {})

  return () => {
    subs.delete(onChange)
    if (subs.size === 0) map.delete(key)
  }
}

/** Fires whenever anything in this room changes: requests, messages, charges. */
export const onRoomChange = (roomId: string, fn: () => void) => subscribe(hub.rooms, roomId, fn)

/** Fires whenever anything in this property changes. */
export const onPropertyChange = (propertyId: string, fn: () => void) => subscribe(hub.properties, propertyId, fn)

/** True once the listening connection is up - the streams report this to the client. */
export async function realtimeReady(): Promise<boolean> {
  try {
    await connect()
    return true
  } catch {
    return false
  }
}
