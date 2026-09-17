# Roadmap

Ten proposals, each checked against the source on 17 September 2026 before it
was planned. Where a proposal assumes something the code does not do, that is
said first and the plan follows from what is actually there.

`WHATS-LEFT.md` is the retrospective list — what the QA passes found and what
is still stale. This is the prospective one.

| # | Proposal | Verdict | Size |
|---|----------|---------|------|
| 4 | Rate-limit the guest SSE endpoint | **Build** — real gap, different threat than stated | half a day |
| 3 | Tamper-proof audit | **Build the last 5%** — logging is already complete | an hour |
| 6 | Cap runaway messaging spend | **Build** — loops are impossible, bursts are not | half a day |
| 8 | E2E test for CodeGate | **Build** — but not with Playwright, yet | a day |
| 9 | SLA-miss trend monitoring | **Build the cheap version** — the data is already in Postgres | half a day |
| 1 | PMS adapter | **Decide first** — needs a named PMS before any code | weeks, gated |
| 7 | Move marketing out of the app | **One line, or nothing** — premise does not hold | ten minutes |
| 2 | i18n for guest strings | **Not yet** — `PRODUCT.md` forbids guessing at this | — |
| 5 | TOTP instead of the 4-digit code | **No** — breaks principle one | — |
| 10 | Query builder instead of raw SQL | **No** — its own stated condition is not met | — |

---

## Build

### 4 · Rate-limit the guest live endpoint

**The stated threat is not the live one.** `/api/guest/[token]/live` already
requires a guest cookie — `accessFor(grant, room.room)` at
[route.ts:33](app/api/guest/[token]/live/route.ts) — so connection exhaustion
by an anonymous attacker is not open to them. Two things *are*:

1. **An unauthenticated database round trip per request.** Both
   `/live` and `/state` call `readRoom(token)` *before* the auth check. A flood
   of random tokens costs one indexed query and one pooled connection each. The
   pool is the scarce resource, not the socket.
2. **Unbounded concurrent streams per authorised guest.** Nothing counts them.
   Each holds a function for up to four minutes (`MAX_MS` in
   [lib/sse.ts](lib/sse.ts)) against a `maxDuration` of 300. On Vercel that is
   concurrency and money, and one phone can open as many as it likes.

**Plan.** Two module-level maps, no dependency, following the throttle already
in [app/api/staff/board/route.ts:10](app/api/staff/board/route.ts) — which
documents its own limitation honestly and should be the template:

- A token bucket keyed by IP, checked *before* `readRoom`, on both guest
  routes. Cheap rejects cost nothing.
- A per-room counter of open streams, incremented in `sseStream`'s `start` and
  decremented in `shutdown`. Refuse past a small ceiling (3 is generous — a
  guest has one phone and maybe a tablet).

**Known ceiling, state it in the comment:** in-process limiting is per instance
and Vercel scales instances horizontally. This blunts one source hammering one
instance. A distributed flood needs Vercel's firewall rules or something
upstream, and no amount of application code substitutes for that.

### 3 · Tamper-proof audit

**The logging is already done.** 48 call sites, 42 distinct actions, covering
staff, rooms, requests, catalogue, escalation, folio, organisations and teams —
including every board status transition, which come through as
`request.${next}` and are easy to miss when grepping for string literals.
`lib/audit.ts` already resolves the organisation in the same statement and
swallows its own failures so a log line can never roll back a guest's order.

**What is missing is the word "tamper-proof".** `audit_log` is an ordinary
table; the application's role can `UPDATE` and `DELETE` it.

**Plan.** A `BEFORE UPDATE OR DELETE` trigger on `audit_log` that raises. Five
lines of SQL in `db/schema.sql`, works regardless of how Supabase has granted
the pooled role, and cannot be forgotten the way a `REVOKE` can when a role is
recreated.

A hash chain (`prev_hash` per row) defends against someone with direct database
access who can also drop the trigger. That is a different threat model and
almost certainly not this one — note it and do not build it.

### 6 · Cap runaway messaging spend

**An escalation loop cannot happen.** The sweep matches `e.step >
r.escalation_step` and sets `escalation_step` to the highest matching rung in
the same statement, with `distinct on (r.id)`. `escalation_step` starts at 0
and only rises, so a request escalates at most once per rung and at most as
many times as there are rungs — two, today. The ladder is monotonic and bounded
by construction.

**Two real ways to spend money anyway:**

1. **The outbox drainer never gives up.** `db/outbox.mjs` increments `attempts`
   and clears `claimed_at` on failure, but nothing reads `attempts` as a
   ceiling. A permanently bad number is retried every pass, forever.
2. **Fan-out, not repetition.** One sweep that finds 50 late requests, times
   five managers with phones, is 250 messages — each one legitimate, all of
   them at once.

**Plan.**

- An attempts ceiling in the drainer: past 5, stop claiming the row and leave
  `last_error` set. One `and attempts < 5` in the claim query.
- A ceiling on a single sweep: if `fired.length × recipients` exceeds a
  configured maximum, send nothing, log loudly, and audit a
  `escalation.suppressed` row. A hotel with fifty simultaneous late requests
  has a problem that a WhatsApp storm will not fix.

### 8 · An end-to-end test for CodeGate

**There are no tests at all** — no framework, no `test` script, five runtime
dependencies. CodeGate is the right place to start: it is the guest's only door
and its lockout logic is the only brute-force defence in the product.

**Not Playwright or Cypress, first.** This repo already has a working Chrome
DevTools Protocol driver in [marketing/\_build/cdp.mjs](marketing/_build/cdp.mjs)
— launch, attach, navigate, evaluate — built with zero dependencies, and Node 24
ships `node:test` and a TypeScript loader. CodeGate needs typing into four
inputs and reading the result; it needs none of what Playwright is actually for
(multiple browser contexts, file uploads, network interception, trace viewers).

**Plan.** A `test/` directory and `node --test`. A fixture that creates a
throwaway room with a known code directly in the database, then over CDP:

- the correct code opens the gate;
- a wrong code decrements the attempts counter and says so;
- five wrong codes lock it, and the lock message names the wait;
- the front desk unlocking it lets the correct code straight through;
- a checkout invalidates the cookie mid-session.

Tear the room down in a `finally`, the way the `deleteStaff` check already
does. Reach for Playwright when a test genuinely needs two browser contexts at
once — the board and the guest phone in the same assertion is the likely first
case, and that is a good reason, not a default.

### 9 · SLA-miss trends

**Right need, wrong instrument.** Prometheus scrapes a long-lived process.
Vercel functions are ephemeral, so a `/metrics` endpoint returns one instance's
counters since its cold start — which is noise. OpenTelemetry works, but it
needs a collector to push to, which is a service to run and pay for.

**The data is already in Postgres and already aggregated.** `loadStats` in
[lib/history.ts:93](lib/history.ts) computes `within_sla`, `escalated`,
`avg_resolve` and `avg_response` today. A trend is a `group by date_trunc('day',
…)` on the same query.

**Plan.** A `loadSlaTrend(staff, days)` beside it, and a small chart on the
History page. Nothing new to run, nothing new to pay for, and it answers the
question for the person who actually asks it — the GM, not an SRE.

Revisit OpenTelemetry when there is more than one service to correlate across.
There is one app and one database.

---

## Decide first

### 1 · PMS adapter

Real, and `PRODUCT.md` already names the CSV as a stopgap. But "a PMS adapter"
is not one piece of work: Opera Cloud, Cloudbeds, eZee, Hotelogix and Stayflexi
have nothing in common at the wire, and most gate their API behind a partner
agreement. **Nothing should be built until a target is named**, because the
first integration's shape decides the interface.

**The seam is already in the right place.** `lib/folio.ts` is the only module
that knows what a charge is — `postCharge`, `voidCharge`, `settleRoom`,
`exportCsv` — and `folio_request_key` already makes posting idempotent, which
is the property every PMS integration needs and most retrofits lack.

**Useful before a vendor is chosen, and only this:**

- An `external_ref` column on `folio_entries` for the PMS's own charge id.
- A check that nothing outside `folio.ts` writes that table.

That is an hour, it is not wasted whichever vendor wins, and it stops short of
designing against an imagined API.

---

## Not now, and why

### 7 · Move marketing out of the app

**The premise does not hold.** `marketing/` is at the repo root, not inside
`app/`. Nothing imports it — the one match for "marketing" in `app/` and
`lib/` is a comment. It contains no `.ts` files, so `tsc` never opens it and
Turbopack never bundles it. **Build-time impact is zero, measurably:** the
build that ran today took 60s with it present.

Tracked size is **115KB**. The 21MB on disk is `marketing/out/`, which is
gitignored and never reaches a deployment.

If 115KB of upload matters, the entire fix is a `.vercelignore` containing
`marketing/`. Moving it to another repo costs you the thing that makes it
correct: the scenes carry design tokens hand-copied from `app/globals.css`, and
the two drifting apart is a real cost against no measured benefit.

### 2 · i18n for guest strings

`PRODUCT.md` is explicit, and it is right: *"no translation machinery should be
built on a guess."* It lists a second language as **Undecided**, and the README
line this proposal cites is the same thought — guest strings "sit in the
components ready to lift", which is the preparation, deliberately stopping
short of the machinery.

The trigger is a buyer asking, with a named language. Then it is a day with
`next-intl` and a lift of strings that were already written to be lifted. Built
speculatively it is a permanent tax on every copy change, for a language nobody
has asked for.

### 5 · TOTP or a rotating token

**This one I would push back on properly.** TOTP requires the guest to hold an
authenticator app. Principle one is *"the phone is the thing being replaced"*
and the product's first promise is no app to install. A guest at 2am with a
towel problem will dial reception rather than set up an authenticator, which is
the exact regression `PRODUCT.md` defines as failure.

The 4-digit code is not a password and was never designed as one. It is a
second factor behind a random 64-character token that lives physically inside
the room. Brute force is bounded at five attempts per fifteen minutes — 20
guesses an hour against 10,000 combinations — *and* the attacker must already
have the room's printed card.

**If the lockout does prove insufficient, the cause decides the fix:**

- **Legitimate guests locking themselves out** → a longer lockout is the wrong
  direction; raise the attempt count and shorten the wait.
- **Brute force from one source** → per-IP throttling on the gate, which is
  item 4's work and defends the whole surface rather than one door.
- **Genuinely needing more entropy** → six digits is a million combinations and
  costs the guest two keystrokes. A magic link to the phone number taken at
  check-in is the step beyond that. Both keep "no app to install".

### 10 · A query builder

The proposal states its own condition — *"if the schema complexity grows beyond
current levels"* — and it has not. Seventeen tables, roughly forty queries.

Two things make it actively risky here rather than merely unnecessary.
`prepare: false` is load-bearing and documented with its reproduction in
`lib/db.ts`; most builders assume prepared statements and some will not run
against a transaction pooler at all. And page cost in this project is the
**number of round trips**, not the work inside them — the queries are hand-shaped
to return nested data in one trip, and a builder's natural idiom is the N+1 that
was deliberately designed out.

The composition problem a builder solves is already solved the lighter way:
`scopeTo` and `orgScope` return `sql` fragments that compose into a `WHERE`
clause. Extend that when it is needed.

**Revisit when** a query is assembled from more than about three optional
conditions in more than about three places. Today exactly one query is near
that, and it is already handled.

---

## Suggested order

1. **3 · audit trigger** — an hour, and it is the one with a compliance story.
2. **4 · rate limiting** — half a day, closes a real unauthenticated path.
3. **6 · spend caps** — half a day, and the attempts ceiling is three words of SQL.
4. **8 · CodeGate test** — a day, and everything after it is safer.
5. **9 · SLA trend** — half a day, answers a question somebody is already asking.
6. **1 · `external_ref` + the folio-writer check** — an hour, whenever.
7. **7 · a `.vercelignore` line** — only if the 115KB is genuinely bothering you.

Items 2, 5 and 10 need a trigger from outside the codebase before they are
worth revisiting. Each one's trigger is named in its section above.
