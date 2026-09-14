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
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  })
}

// Next's dev server re-evaluates modules on every edit; without this the pool
// is recreated each time until Supabase refuses new connections.
const g = globalThis as unknown as { __hconciergeSql?: ReturnType<typeof connect> }
export const sql = g.__hconciergeSql ?? (g.__hconciergeSql = connect())
