import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env.local')

// Supabase's pooler on :6543 is pgbouncer in transaction mode. It cannot carry
// prepared statements across pooled connections, so `prepare: false` is not
// optional here — with it on you get "prepared statement already exists".
function connect() {
  return postgres(url!, {
    prepare: false,
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    connection: {
      // Supabase defaults to 2 minutes. A single slow query holding a pooled
      // connection for that long is how a polling board takes the whole app
      // down: the polls overlap, every connection ends up waiting, and nothing
      // drains. 15s is far longer than any query here legitimately needs.
      statement_timeout: 15_000,
    },
  })
}

// Next's dev server re-evaluates modules on every edit; without this the pool
// is recreated each time until Supabase refuses new connections.
const g = globalThis as unknown as { __hconciergeSql?: ReturnType<typeof connect> }
export const sql = g.__hconciergeSql ?? (g.__hconciergeSql = connect())
