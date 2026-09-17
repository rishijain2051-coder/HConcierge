# HConcierge

In-room guest requests for **RN Hospitality**, built to take the phone out of the loop
between a hotel room and reception.

A guest scans the QR card on their desk and lands straight in their room's page — no app,
no login, no typing. They order room service, ask for towels, book a massage, request a
wake-up call, read the wifi password, or just message the front desk. Every request is
routed to the team that actually does it, timed against a target, and escalated if it is
forgotten.

---

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL and SESSION_SECRET
npm run db:push              # create the schema
npm run db:seed              # two RN properties, staff, rooms, full directory
npm run dev
```

`db:seed` prints the staff logins and two guest room links to open on a phone.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres. Use Supabase's **pooler on port 6543**. |
| `SESSION_SECRET` | yes | Signs the staff session cookie. Rotating it logs everyone out. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | no | WhatsApp or SMS escalation. Unset = escalations log to the console instead. |
| `NOTIFY_ON_NEW` | no | `1` also messages the team on every new request, not just escalations. **Off by default, and leave it off unless somebody is paying attention to the bill** — it is by far the largest source of message volume, since escalations are rare and new requests are not. |
| `NOTIFY_ON_DONE` | — | **No longer read.** The completion notice is disabled in code — `lib/board.ts` does not call it and `COMPLETION_NOTICE` in `lib/notify.ts` is `false`. Setting this does nothing, on purpose: it was off by default and three still went out from one terminal that had it set. |
| `CRON_SECRET` | in production | Shared with the pg_cron job. The route refuses to run unauthenticated once deployed. |
| `NEXT_PUBLIC_BASE_URL` | no | Only needed if the QR origin cannot be read from the request. |

---

## How it works

### The guest

`/r/<token>` — two factors, neither of them a password.

1. **The room's QR token.** Permanent, printed once, laminated, left on the desk. It
   identifies the room. It is not a secret worth defending on its own.
2. **A 4-digit code**, issued by the front desk for one stay and printed on the guest's
   welcome card.

Four digits is only 10,000 combinations, which is defensible *because* it sits behind the
token and behind a lockout: five wrong codes locks that room for fifteen minutes, and the
front desk can see and clear it. A guest who photographs the QR and returns next month
has a valid token and a dead code.

The granted cookie is signed against the room **and** that stay's check-in timestamp, so
checking a guest out invalidates every device they used without anything being revoked.
The token and the code are both checked on every read and every write, not once at page
load.

This replaced an earlier model where the token rotated at check-in — which silently
invalidated the printed card and would have meant reprinting one per room per stay.

Five screens: **Home** (quick asks, live status, free-text box, running bill), **Dining**
(the room service menu with a cart and modifiers), **Services** (housekeeping, laundry,
spa, travel, front desk), **Hotel** (wifi, timings, pool, house rules), **Chat**.

### The routing

One basket can become several requests. A towel and a biryani ordered together split into
a Housekeeping request and an F&B request, each with its own target time. Housekeeping
never sees the biryani. This is the part that stops reception being a switchboard.

Departments: `front_desk`, `housekeeping`, `fnb`, `maintenance`.

### Who sees what

Four levels, each scoped by the one above:

| Role | Sees |
| --- | --- |
| `platform` | every organisation — HConcierge itself |
| `admin` | one organisation's properties |
| `manager` | one property |
| `staff` | one department at one property |

An **organisation** is a customer. RN Hospitality is one and owns its properties. Every
scoped query goes through `scopeTo()` in `lib/scope.ts`, so there is one definition of
"which properties may this person see" rather than a copy per query.

A `platform` account can only be created by `npm run db:platform` — no in-app path
promotes anyone to it, because that role sees across every customer.

### The SLA

Every catalogue item carries a target time; a request inherits the slowest item in it.
Cards turn amber at 60% of the budget and red past it. A request nobody accepted within
its target, or accepted and then sat on for twice it, is escalated — flagged on the board
and messaged to duty managers.

Escalation itself is configured per property in **Manage → Escalation**: a ladder of
rungs, each firing once. `after_minutes` counts from the moment a request misses its
*own* target, so one rung reads the same for a ten-minute towel and a forty-minute
biryani — "fifteen minutes late, tell the duty manager". A request that passes two rungs
unnoticed jumps straight to the higher one rather than trickling up a sweep at a time.

A rung names groups (the property's managers, the organisation's admins) and/or specific
people. Only staff with a phone number can actually be reached, and the screen says so
when nobody has one.

The sweep runs opportunistically on the board's safety poll (once a minute while anyone
is working) and from **Supabase pg_cron** every 10 minutes (so it still fires at 4am when
no board is open). Escalation is the one thing that cannot be pushed: nothing changes in
the database when a request simply gets older, so something has to keep asking.

Not Vercel Cron: the Hobby plan only permits one cron run per day. `db/cron.sql` schedules
it in Postgres instead and calls `/api/cron/escalate` over `pg_net` — which also means the
schedule survives moving the app off Vercel entirely. Run that file once in the Supabase
SQL editor after deploying, replacing the domain and `CRON_SECRET` placeholders.

**Cron budget: 200 runs/day, hard cap.** `*/10 * * * *` is 6/hour × 24 = **144/day**.
If you ever tighten it, `*/8` (180/day) is the floor.

Two traps, both documented in `db/cron.sql`: `net.http_post` only *queues* the request, so
`cron.job_run_details` reports success even when the app returned a 404 — the real answer
is in `net._http_response`. And `pg_net` must be created `with schema extensions`, or it
lands in `public` and cannot be relocated afterwards.

### The money

Prices are **never** trusted from the client. The phone sends item ids, quantities and
modifier *names*; `lib/requests.ts` re-resolves every price from the database.

Charges post on **completion**, not on order — a guest is not billed for food that never
arrived. Everything goes through `lib/folio.ts`, which is the only module that writes
money. `folio_entries` has a unique index on `request_id`, so a double-tapped "Done"
cannot bill twice.

Today the front office exports a CSV and keys it into the PMS. When RN's PMS is wired up,
the adapter goes behind those four functions and nothing else in the app changes.

---

## Layout

```
app/
  r/[token]/          guest app — server shell, client UI, server actions
  staff/login/        sign-in and the forced first-login password change
  staff/(app)/        authenticated chrome
    board/            live request board + per-room chat
    rooms/            registry, check-in/out, QR rotation, printable cards
    history/          SLA stats, per-team breakdown, searchable log
  api/
    guest/[token]/live    guest push channel (SSE)
    guest/[token]/state   guest fallback poll
    staff/board/live      board push channel (SSE)
    staff/board           board fallback poll (+ opportunistic escalation sweep)
    staff/folio.csv       charge export
    cron/escalate         escalation backstop
lib/
  db.ts        one pooled postgres client
  realtime.ts  one LISTEN connection per process, fanned out to every stream
  sse.ts       the push channel both live routes are built from
  use-live.ts  the client half: stream first, slow poll as a seatbelt
  auth.ts      scrypt hashes, signed cookie, lockout, role scoping
  requests.ts  the guest→database trust boundary
  board.ts     everything reception reads and writes
  folio.ts     the only module that writes money
  notify.ts    Twilio + the escalation sweep
  sla.ts       one definition of "late", shared by server and client
db/
  schema.sql   idempotent, run with npm run db:push
  seed.mjs     RN Hospitality demo data
  cron.sql     pg_cron schedule for the escalation sweep, run once in Supabase
```

---

## Decisions worth knowing

**Push over SSE, with polling as a seatbelt.** Triggers on `requests`, `messages`,
`folio_entries` and `rooms` call `pg_notify`; one listening connection per server process
fans that out to every open stream. A guest's order moves on their screen the instant the
kitchen touches it, and a hundred guests watching cost one database connection between
them.

Server-sent events rather than websockets because the hosting is serverless — there is no
long-lived server to hold a socket, and `EventSource` reconnects by itself. Streams close
after four minutes so a function billed by the second is not held open all night.

The listener needs a Postgres *session*; the app's pooled URL is pgbouncer in transaction
mode, which silently drops `LISTEN`. Supabase serves the same database in session mode on
5432, so `lib/realtime.ts` connects there (override with `DATABASE_URL_SESSION`). If that
connection cannot be made, the routes return 503, the client gives up after three tries
and falls back to its once-a-minute poll. Nothing breaks; it just stops being instant.

**Money is never taken in the app.** Charges accrue to `folio_entries`; the guest can read
the itemised bill from their phone and tap "ask to settle", which puts the room and its
balance on the front desk's board. The desk takes payment the way it always has and marks
it settled. HConcierge asks for a card number nowhere, and checkout refuses to complete
over an unpaid balance rather than writing it off quietly.

**`prepare: false` is mandatory.** Supabase's pooler on 6543 is pgbouncer in transaction
mode and cannot carry prepared statements across pooled connections.

**Multi-property from the schema up.** Every table carries `property_id`. Admins roam,
managers and staff are pinned to their property, and a housekeeping account asking for
"the board" gets housekeeping's board.

**Modifier groups are JSONB**, not two more tables — read-mostly config that is never
queried by modifier, and it saves an entire CRUD screen.

**Money is integer paise.** It only becomes a string at the edge, in `lib/money.ts`, with
Indian digit grouping.

## Not built yet

- A real PMS integration — the seam is there, the adapter is not
- In-app payment. A guest can read their bill and ask to settle it; the desk
  takes the money the way it always has and marks it settled. HConcierge asks
  for a card number nowhere.
- Languages other than English, though all guest strings sit in the components ready to lift

---

## Where things stand

[`WHATS-LEFT.md`](WHATS-LEFT.md) is the running list of open items, decisions
that look like bugs but are not, and what has never been tested. Read it before
picking the project back up.

[`ROADMAP.md`](ROADMAP.md) is the forward one, and it is deliberately two items
long: an append-only audit log and rate limiting on the guest endpoints. Eight
other proposals were assessed and dropped; that write-up is in commit
`6259306` if one is ever wanted back.

[`docs/qa-2026-09-14/`](docs/qa-2026-09-14/) holds the reports from a four-agent
testing pass — reproductions for everything it found, and a *Verified working*
list at the end of each, which is what you want when something resurfaces.
