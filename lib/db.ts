import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set - copy .env.example to .env.local')

/**
 * `prepare: false` is not optional, however tempting it looks.
 *
 * Without prepared statements Postgres re-plans every join and correlated
 * subquery on each execution, which is roughly half the cost of a query here -
 * turning them on measured a clean 2x on a single statement repeated in a
 * loop, over hundreds of executions with no errors.
 *
 * It still does not work. Run a realistic mix instead - a dozen DIFFERENT
 * statements, concurrently, over a pool - and Supabase's transaction pooler
 * hands the connection a backend that has never seen the statement:
 *
 *     PostgresError: prepared statement "iszaizk1v24" does not exist
 *
 * Reproduced in seconds. The speed has to come from making fewer round trips,
 * not from cheaper ones.
 */
function connect() {
  return postgres(url!, {
    prepare: false,
    ssl: 'require',
    max: 10,
    // Every reconnect to Supabase costs a TLS handshake and an auth round trip
    // to ap-south-1 - a quarter of a second before a single row moves. At 20s
    // a reception screen paid that on almost every navigation. Five minutes
    // keeps the connection warm across a shift without holding it overnight.
    idle_timeout: 300,
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
