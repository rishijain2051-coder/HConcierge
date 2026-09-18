/**
 * Exercises the quick-reply editor's rules against the real database, without
 * a browser and without a session.
 *
 *   npm run db:check-quick-replies
 *
 * Worth having because the screen behind Manage → Quick replies is a
 * manager-only screen, so the only way to reach it by hand is to sign in as
 * somebody — and the two things most likely to be wrong here are the two that
 * are invisible from the screen anyway: whether a manager at one property can
 * write into another's words, and whether a line longer than the reply box can
 * be saved and then arrive silently cut.
 *
 * Everything it writes it takes back by id in `finally`, including on a throw.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) {
      const from = dirname(fileURLToPath(ctx.parentURL))
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        const guess = resolvePath(from, spec + ext)
        if (existsSync(guess)) return { url: pathToFileURL(guess).href, shortCircuit: true }
      }
    }
    if (/^next\/[a-z-]+$/.test(spec)) {
      try {
        return next(spec + '.js', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

const lib = new URL('../lib/', import.meta.url)
const { sql } = await import(new URL('db.ts', lib).href)
const { listQuickReplies, saveQuickReply, deleteQuickReply } = await import(new URL('admin.ts', lib).href)

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

// Hoisted: `finally` cannot see a binding declared inside `try`, so cleanup
// would never run on the path that most needs it.
const mine = []

try {
  /* A manager pinned to a property, and a different property in the same
     organisation for the cross-property refusal. A manager is the tightest
     scope that can reach this screen at all, so it is the one worth testing. */
  const [mgr] = await sql`
    select s.id, s.name, s.role, s.property_id, coalesce(s.organisation_id, p.organisation_id) as organisation_id
      from staff s join properties p on p.id = s.property_id
     where s.role = 'manager' and s.active and s.property_id is not null
     order by s.name limit 1`
  if (!mgr) {
    console.log('no manager with a property in this database — nothing to check')
    await sql.end()
    process.exit(0)
  }
  const [other] = await sql`
    select id, name from properties where id <> ${mgr.property_id} order by name limit 1`

  const [home] = await sql`select name from properties where id = ${mgr.property_id}`
  console.log(`${mgr.name}, manager of ${home.name}${other ? `; other property: ${other.name}` : ''}\n`)

  const before = await listQuickReplies(mgr, mgr.property_id)
  check('the list reads this property', Array.isArray(before), `${before.length} reply(ies)`)
  check(
    'every row carries a label and a body',
    before.every((q) => q.label && q.body),
  )

  if (other) {
    const read = await listQuickReplies(mgr, other.id)
    check("a manager reads none of another property's replies", read.length === 0, `got ${read.length}`)
    const wrote = await saveQuickReply(mgr, other.id, { label: 'Check — should refuse', body: 'x' })
    check("a manager cannot write into another property's replies", wrote.ok === false, wrote.error)
  }

  const blank = await saveQuickReply(mgr, mgr.property_id, { label: '   ', body: 'Something' })
  check('a nameless reply is refused', blank.ok === false, blank.error)
  const empty = await saveQuickReply(mgr, mgr.property_id, { label: 'Check — empty', body: '  \n ' })
  check('a reply with nothing to send is refused', empty.ok === false, empty.error)

  /* The board's reply box is maxLength 1000. A canned line longer than that
     would be cut by the browser after it was pasted in, so it is cut here
     instead, where the manager is the one looking at it. */
  const label = 'Check — delete me'
  const made = await saveQuickReply(mgr, mgr.property_id, { label, body: 'A'.repeat(1200) })
  check('a valid reply saves', made.ok === true, made.error)
  const after = await listQuickReplies(mgr, mgr.property_id)
  const row = after.find((q) => q.label === label)
  if (row) mine.push(row.id)
  check('it is in the list', Boolean(row))
  check('a body longer than the reply box is cut to 1000', row?.body.length === 1000, `${row?.body.length} chars`)
  check(
    'it sorts after everything already there',
    row != null && before.every((q) => q.sort <= row.sort),
    `sort ${row?.sort}`,
  )

  const dupe = await saveQuickReply(mgr, mgr.property_id, { label: label.toUpperCase(), body: 'Again' })
  check('a second reply with the same name is refused, whatever the case', dupe.ok === false, dupe.error)

  const edited = await saveQuickReply(mgr, mgr.property_id, { id: row.id, label, body: 'On the way up now.' })
  const reread = (await listQuickReplies(mgr, mgr.property_id)).find((q) => q.id === row.id)
  check('an edit saves', edited.ok === true, edited.error)
  check('the edit replaced the body rather than adding a row', reread?.body === 'On the way up now.')
  check(
    'editing did not create a second row',
    (await listQuickReplies(mgr, mgr.property_id)).length === after.length,
  )

  const [logged] = await sql`
    select action, meta from audit_log
     where entity = 'quick_reply' and action = 'quick_reply.created'
       and created_at > now() - interval '2 minutes'
     order by created_at desc limit 1`
  check('the create is in the activity log', logged?.meta?.label === label, logged?.action)

  const removed = await deleteQuickReply(mgr, row.id)
  check('a delete succeeds', removed.ok === true, removed.error)
  check(
    'and it is gone from the list',
    (await listQuickReplies(mgr, mgr.property_id)).every((q) => q.id !== row.id),
  )
  if ((await sql`select 1 from quick_replies where id = ${row.id}`).length === 0) mine.length = 0

  const again = await deleteQuickReply(mgr, row.id)
  check('deleting it twice is not an error', again.ok === true, again.error)

  check(
    'the property is back exactly as it was found',
    (await listQuickReplies(mgr, mgr.property_id)).length === before.length,
  )
} catch (err) {
  console.log('threw: ' + (err?.stack ?? err))
  failures++
} finally {
  if (mine.length > 0) {
    const gone = await sql`delete from quick_replies where id = any(${mine}) returning label`
    console.log(`\ntook back ${gone.length} reply(ies) this check had written`)
  }
  await sql.end()
}

console.log('')
console.log(failures === 0 ? 'all checks pass' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
