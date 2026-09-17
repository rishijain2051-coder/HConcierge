# Roadmap

Two items, agreed 17 September 2026. Both were checked against the source
before being planned.

The other eight proposals assessed that day were dropped by decision, not by
oversight. The full write-up — including why four of them rested on something
the code does not actually do — is in commit `6259306` if any of them is ever
wanted back. Nothing here depends on them.

`WHATS-LEFT.md` remains the retrospective list.

---

## 1 · Make the audit log tamper-proof

**Status: not started.**

### What is already there

The logging itself is complete and does not need work. 48 call sites and 42
distinct actions covering staff, rooms, requests, catalogue, escalation, folio,
organisations and teams. Board status transitions are included — they are
written as `` action: `request.${next}` ``, which is why a grep for string
literals appears to show them missing.

[lib/audit.ts](lib/audit.ts) already resolves the organisation in the same
statement as the insert, and already swallows its own failures so that a
failed log line can never roll back a guest's order.

### What is missing

`audit_log` is an ordinary table. The application's database role can `UPDATE`
and `DELETE` rows in it. Nothing makes it append-only, so "audit log" is
currently a description of intent rather than a guarantee.

### The change

A `BEFORE UPDATE OR DELETE` trigger on `audit_log` that raises, added to
`db/schema.sql` in the same idempotent style as everything else in that file
(`drop trigger if exists` then `create trigger`).

A trigger rather than `REVOKE UPDATE, DELETE`, for two reasons: Supabase's
pooled role is frequently the table owner, so a grant-based approach can be a
no-op without saying so; and a revoke is silently lost whenever a role is
recreated, while a trigger travels with the schema.

### Deliberately not doing

A hash chain (`prev_hash` per row) defends against an attacker who already has
direct database access and can therefore also drop the trigger. That is a
different threat model from this one. Worth revisiting only if an auditor asks
for it by name.

### How it gets verified

Against the live database, not by reading the SQL:

- an `insert` still succeeds;
- an `update` on an existing row raises;
- a `delete` on an existing row raises;
- `lib/audit.ts` still records normally afterwards, through a real call path;
- `db:push` is idempotent — running it twice is clean.

The test rows get cleaned up, except that they cannot be deleted once the
trigger exists. **Write the verification to use a throwaway action name and
accept that its rows are permanent** — that is the feature working.

---

## 2 · Rate-limit the guest endpoints

**Status: not started.**

### The threat, corrected

`/api/guest/[token]/live` is already behind a guest cookie — `accessFor(grant,
room.room)` at [route.ts:33](app/api/guest/[token]/live/route.ts) — so
connection exhaustion by an anonymous caller is not open to them. Two things
are:

1. **An unauthenticated database round trip per request.** Both `/live` and
   `/state` call `readRoom(token)` *before* the cookie is checked. A flood of
   random tokens costs one indexed query and one pooled connection each. The
   connection pool is the scarce resource here, not the socket.
2. **Unbounded concurrent streams per authorised guest.** Nothing counts them.
   Each holds a function for up to four minutes (`MAX_MS` in
   [lib/sse.ts](lib/sse.ts)) against a `maxDuration` of 300. One phone may open
   as many as it likes, and on Vercel that is concurrency and money.

### The change

Two module-level maps, no new dependency, following the throttle already in
[app/api/staff/board/route.ts:10](app/api/staff/board/route.ts) — which
documents its own limitation honestly and is the template to copy.

- **A token bucket keyed by IP**, checked *before* `readRoom`, on both guest
  routes. A cheap reject must not touch the database.
- **A per-room open-stream counter**, incremented in `sseStream`'s `start` and
  decremented in `shutdown`. Refuse past a small ceiling — 3 is generous for a
  guest with one phone and perhaps a tablet.

`shutdown` is already the single exit path for every way a stream can end
(client hang-up, `MAX_ROOM` lifetime, revoked authorisation, abort signal), so
the decrement has exactly one place to live and cannot leak.

### Known ceiling — say it in the comment

In-process limiting is per instance, and Vercel scales instances horizontally.
This blunts one source hammering one instance. A distributed flood needs
Vercel's firewall rules or something upstream of the application, and no amount
of code in this repo substitutes for that. The board route's existing comment
sets the tone for how to admit this.

### How it gets verified

- A burst of requests with random tokens returns 429 without a query reaching
  Postgres — confirmed by counting, not assumed.
- A legitimate guest opening, closing and reopening a stream repeatedly is
  never refused.
- Opening streams past the ceiling refuses the excess and leaves the first ones
  working.
- The counter returns to zero after every stream closes, through each of the
  four exit paths.
- `next build` and `npm run lint` stay clean.
