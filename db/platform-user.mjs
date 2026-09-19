// Creates or resets the HConcierge platform account.
//
//   npm run db:platform -- --username hc.ops --name "HConcierge Ops"
//
// This is the only way a `platform` user can exist. No in-app path promotes
// anyone to it, on purpose: the role sees across every customer, so it must
// not be reachable by anyone who has merely compromised a customer's admin.
//
// Prints a one-time password. Nothing stores it in readable form.
import postgres from 'postgres'
import { randomBytes, scryptSync } from 'node:crypto'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const username = arg('--username', 'hc.ops').toLowerCase()
const name = arg('--name', 'HConcierge')

// Same format as hashPassword() in lib/auth.ts. Duplicated rather than
// imported because that module pulls in next/headers.
const hash = (pw) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`
}

// Readable, and always satisfies passwordProblem(): an uppercase, letters and
// digits, well over ten characters.
const generate = () => {
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const pick = (set, n) => Array.from(randomBytes(n)).map((b) => set[b % set.length]).join('')
  return `${pick(upper, 1)}${pick(lower, 5)}${pick(digits, 2)}${pick(lower, 3)}${pick(digits, 1)}`
}

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })

try {
  const password = generate()
  const [row] = await sql`
    insert into staff (organisation_id, property_id, username, name, password_hash,
                       department, role)
    values (null, null, ${username}, ${name}, ${hash(password)}, 'all', 'platform')
    on conflict (lower(username)) do update
      set password_hash = excluded.password_hash,
          name = excluded.name,
          role = 'platform',
          organisation_id = null,
          property_id = null,
          active = true,
          failed_logins = 0,
          locked_until = null
    returning id, username`

  console.log(`\n  platform account: ${row.username}`)
  console.log(`  password:         ${password}`)
  console.log('\n  Shown once. Change it under Password once you are in.')
  console.log('  This account sees every organisation - keep it off shared machines.\n')
} catch (err) {
  console.error('✗ failed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
