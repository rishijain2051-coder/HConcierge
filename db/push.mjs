// Applies db/schema.sql. Idempotent - every statement is create-if-not-exists.
//   npm run db:push
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.')
  process.exit(1)
}

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

try {
  // .simple() runs the whole file as one multi-statement script.
  await sql.unsafe(schema).simple()
  const [{ count }] = await sql`
    select count(*)::int as count from information_schema.tables
     where table_schema = 'public'`
  console.log(`✓ schema applied - ${count} tables in public`)
} catch (err) {
  console.error('✗ schema failed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
