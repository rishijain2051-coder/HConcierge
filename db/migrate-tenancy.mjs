// Backfills the tenant layer and the default escalation ladder.
// Idempotent — safe to re-run.
//
//   npm run db:migrate
//
// Existing properties and staff have no organisation, because there was no
// such thing when they were created. This puts them all under one, so that
// `admin` stops meaning "every property in the database" and starts meaning
// "every property belonging to my organisation".
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const ORG_SLUG = process.env.ORG_SLUG || 'rn-hospitality'
const ORG_NAME = process.env.ORG_NAME || 'RN Hospitality'

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 20 })

try {
  const [org] = await sql`
    insert into organisations (slug, name) values (${ORG_SLUG}, ${ORG_NAME})
    on conflict (slug) do update set name = excluded.name
    returning id, name`
  console.log(`organisation: ${org.name}`)

  const props = await sql`
    update properties set organisation_id = ${org.id}
     where organisation_id is null returning name`
  console.log(`  attached ${props.length} propert${props.length === 1 ? 'y' : 'ies'}`)

  // Platform accounts belong to no organisation — that is the whole point.
  const people = await sql`
    update staff set organisation_id = ${org.id}
     where organisation_id is null and role <> 'platform' returning username`
  console.log(`  attached ${people.length} staff account(s)`)

  // Default ladder, per property, only where none exists. These two rungs
  // reproduce what the hardcoded rule did before: tell the managers the moment
  // a request misses its target, and widen to the admins if it is still open a
  // quarter of an hour later.
  const targets = await sql`
    select p.id, p.name from properties p
     where not exists (select 1 from escalation_rules e where e.property_id = p.id)`

  for (const p of targets) {
    await sql`
      insert into escalation_rules
        (property_id, department, step, after_minutes, applies_to, notify_managers, notify_admins)
      values
        (${p.id}, null, 1,  0, 'unaccepted', true,  false),
        (${p.id}, null, 2, 15, 'any',        true,  true)`
    console.log(`  seeded default ladder for ${p.name}`)
  }
  if (targets.length === 0) console.log('  every property already has a ladder')

  console.log('\n✓ migrated')
  console.table(
    await sql`
      select o.name as organisation,
             (select count(*)::int from properties where organisation_id = o.id) as properties,
             (select count(*)::int from staff      where organisation_id = o.id) as staff
        from organisations o order by o.name`,
  )
  console.table(await sql`
    select username, role, coalesce(o.name,'—') as organisation
      from staff s left join organisations o on o.id = s.organisation_id
     order by case s.role when 'platform' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end`)
} catch (err) {
  console.error('✗ migration failed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
