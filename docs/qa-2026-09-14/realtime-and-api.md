# QA-4 — realtime push channel, HTTP API surface, security boundaries

Target: production build on `http://localhost:3100`. Guest room 303 (`/r/n9IQgxwQimo`, code 7126).
Staff cookies minted for `qa.admin` / `qa.manager` / `qa.hk`; `hc.ops` (platform) and `rn.admin` were
read only, never written. Every finding below was reproduced against the running build unless it is
explicitly marked **code-read**.

Room 303 was left checked in (`Rohan Iyer`), code `7126`, `code_attempts=0`, `code_locked_until=null`,
token unchanged. All `QA4%` rows deleted; the throwaway organisation created for the tenancy test was
dropped (verified: 0 leftovers).

---

### [BLOCKER] Any admin can export another organisation's folio by putting its property id in the URL
- **Where**: `app/api/staff/folio.csv/route.ts:14`, endpoint `GET /api/staff/folio.csv?property=<uuid>`
  (query runs at `lib/folio.ts:91-101`)
- **Steps**: the route takes the property id straight from the query string for `admin` and never runs
  it through `scopeTo()` / `canTouchProperty()` — the two helpers that exist for exactly this. I created
  a throwaway second tenant (org `QA4 Rival Group` → property `QA4 Rival Hotel` → room `QA4-1` → one
  charge), then asked as `qa.admin`, whose `organisation_id` is RN Hospitality:
  ```
  curl -s -H "Cookie: hc_session=$S_qa_admin" \
    "http://localhost:3100/api/staff/folio.csv?property=34639364-4a58-41d8-b4d1-b290e4bed139"
  ```
- **Expected / Actual**: expected 403 (or an empty export) because that property is not in the caller's
  organisation. Actual: HTTP 200 and the other customer's billing data in full.
- **Evidence**:
  ```
  HTTP 200
  Room,Guest,Description,Amount (INR),Posted at
  QA4-1,QA4 Rival Guest,QA4 RIVAL SECRET CHARGE,999.00,2026-09-14T14:46:44.057Z
  ```
  Same result with `&days=365`. `days` itself is clamped correctly (`-5`→1, `1e99`→365, `abc`→7).
  `manager` is safe (the param is ignored, `staff.property_id` wins — verified), `staff` gets 403,
  `platform` gets 400. Only the `admin` branch is exposed — i.e. exactly the role that spans properties.
  Property ids are not secret: they are handed to every admin in the property picker on the board and
  rooms screens, so this needs no guessing. The export *is* audited, but under the **victim's**
  `property_id` (`lib/folio.ts` caller writes `audit({propertyId, ...})`), so it lands in the victim's
  activity log, not the attacker's.

### [BLOCKER] A guest SSE stream keeps streaming for 4 minutes after the grant is revoked — and leaks the next guest
- **Where**: `app/api/guest/[token]/live/route.ts:23` (access checked once, at open) with
  `lib/sse.ts:56-80` (`load()` re-runs for the life of the stream and is never re-authorised) and
  `lib/sse.ts:14` (`MAX_MS = 4 * 60_000`). Endpoint `GET /api/guest/[token]/live`.
- **Steps**: hold a stream open with a valid room-303 cookie, then run the exact SQL from
  `checkOut()` (`app/staff/(app)/rooms/actions.ts:105-107`), then re-check the room in as a new guest
  and write a message as that new guest:
  ```
  # 1. hold the stream
  curl -sN -H "Cookie: hc_guest=$G_303" http://localhost:3100/api/guest/n9IQgxwQimo/live
  # 2. in another shell, check out
  update rooms set occupied=false, guest_name=null, checked_in_at=null, access_code=null,
    code_attempts=0, code_locked_until=null, settle_requested_at=null where number='303';
  # 3. re-check-in as somebody else, then insert a message as that guest
  update rooms set occupied=true, guest_name='QA4 NEXT GUEST', checked_in_at=now(), access_code='7126' ...;
  insert into messages (property_id,room_id,sender,body) values (...,'guest','QA4 NEXT GUEST PRIVATE MESSAGE');
  ```
- **Expected / Actual**: `lib/guest-session.ts:17-19` promises "checking the guest out invalidates every
  device they used without anything having to be revoked". Every *other* surface honours that — I
  confirmed 401 on `/state`, 401 on a **newly opened** `/live`, and `{"ok":false,"error":"Please enter
  your room code again."}` from `sendGuestMessage` — but the already-open stream is never re-checked.
  Actual: the checked-out device received a frame containing the next guest's private chat message.
- **Evidence**:
  ```
  4172   GET /state  (old cookie, checked out): HTTP 401 {"error":"locked"}
  4240   NEW /live   (old cookie, checked out): HTTP 401
  4327   sendGuestMessage (old cookie, checked out): {"ok":false,"error":"Please enter your room code again."}
  4327 >>> RE-CHECK-IN as a NEW guest while the old stream is still held open
  4674 [held stream] <data> 4538b
  RESULT: frames to the OLD (checked-out) stream after checkout: 1 data, closed=false
    @4674ms leaks NEXT GUEST msg? YES — LEAK
  ```
  Exposure window is up to `MAX_MS` = 4 minutes (measured self-close at 240.1 s, see below), and it
  covers the room's live requests, folio and staff replies, not just chat. The staff board stream has
  the same shape: `requireOperational()` runs once at open, so a staff account deactivated or
  role-changed mid-stream keeps receiving the board until the stream expires (**code-read**, same
  `lib/sse.ts` path — not separately reproduced).

### [BLOCKER] `/api/staff/board` has no role gate: the platform account reads every organisation's live board
- **Where**: `app/api/staff/board/route.ts:14` calls `getStaff()` where its SSE twin
  (`app/api/staff/board/live/route.ts:19`) calls `requireOperational()`. Scope widens at
  `lib/scope.ts:24-26`, which returns `sql\`true\`` — i.e. every property row in the database — for a
  platform account that has not stepped into an organisation.
- **Steps**:
  ```
  curl -s -H "Cookie: hc_session=$S_hc_ops" http://localhost:3100/api/staff/board
  curl -sN -H "Cookie: hc_session=$S_hc_ops" http://localhost:3100/api/staff/board/live
  ```
- **Expected / Actual**: the product boundary is explicit — `lib/auth.ts:196-209`, "HConcierge runs the
  product, not anybody's front desk … a customer's live requests are their business" — and the stream
  enforces it. Expected the poll to refuse identically. Actual: the poll returns the full board, and
  with two organisations present it returns **both**.
- **Evidence** (during the tenancy test, with the throwaway org live):
  ```
  platform hc.ops          : n=5 props=["QA4 Rival Hotel","RN Grand, Pune"]   HTTP 200
  admin qa.admin           : n=4 props=["RN Grand, Pune"]                     HTTP 200
  /api/staff/board/live with the same hc.ops cookie: HTTP 307 -> /staff/login
  ```
  `hc_org` narrows but never widens as documented (`platform + hc_org=<rival>` → only the rival's rows),
  so the hole is the un-narrowed default, not the cookie. Non-platform scoping is otherwise correct:
  `manager ?property=<foreign uuid>` still returns only its own property, and `qa.hk` (department
  `housekeeping`) gets 1545 b vs the manager's 3319 b.

### [MAJOR] Both guest rate limits are check-then-insert and a concurrent burst goes straight through
- **Where**: messages `app/r/[token]/actions.ts:97-107`; requests `lib/requests.ts:75-81` and
  `lib/requests.ts:190-196`. Server actions `sendGuestMessage` / `submitFreeform` on `POST /r/[token]`.
- **Steps**: the limit is a `select count(*)` followed by a separate `insert`, with nothing in between.
  Sequentially it is exact; fired in parallel it is not.
  ```
  # 25 at once, cap is 15 per 2 min, window verified empty first
  for i in $(seq 1 25); do ( curl -s -X POST http://localhost:3100/r/n9IQgxwQimo \
    -H "Next-Action: 60e260ef6666a914c3ec64c0faf11e954ca42253e5" \
    -H "Content-Type: text/plain;charset=UTF-8" -H "Origin: http://localhost:3100" \
    -H "Cookie: hc_guest=$G_303" --data-raw '["n9IQgxwQimo","QA4 concurrent msg '$i'"]' ) & done
  ```
- **Expected / Actual**: expected 15 accepted, 10 refused. Actual 24 accepted, 1 refused — 24 rows in
  `messages`.
- **Evidence**:
  ```
  messages, 25 concurrent (cap 15):   24 x "ok":true, 1 x "ok":false   -> 24 rows inserted
  requests, 20 concurrent (cap 12, 2 already in window, so 10 should pass):
        16 x {"ok":true,...} refs 32..47, 4 x rate-limited  -> 16 rows inserted, 18 in window
  ```
  Sequentially both limits are exact and the copy is good — 14 accepted on top of 1 existing, then
  `{"ok":false,"error":"Please wait a moment before sending more."}` at #15, and
  `"You have sent a lot of requests just now. Please give the team a few minutes."` for requests. Each
  extra request also fans out as its own SSE frame to every open board (see the 14 back-to-back frames
  in the lifetime log at 104–109 s), so the burst amplifies onto every reception screen.

### [MAJOR] Order lines are missing from the pushed frame — `request_items` has no notify trigger
- **Where**: `db/schema.sql:345-358` defines `hc_notify` triggers on `requests`, `messages`,
  `folio_entries` and `rooms` — but not on `request_items`. `lib/sse.ts:18` waits only
  `SETTLE_MS = 120` ms; `lib/requests.ts:145-158` inserts the request and then each line in separate
  round trips. Affects both `/api/guest/[token]/live` and `/api/staff/board/live`.
- **Steps**: insert a request, wait longer than the 120 ms settle window, then insert its line item —
  which is what a multi-line order to ap-south-1 does naturally (measured 150–250 ms per round trip):
  ```
  insert into requests (...) values (...,'QA4 board item race',88800,...) returning id;
  -- 600 ms later
  insert into request_items (request_id,name,qty,unit_price_paise,modifiers,note) values (...);
  ```
- **Expected / Actual**: expected one pushed frame carrying the order and its dishes, or a second frame
  correcting it. Actual: one frame with `"items":[]` and no correction — the line insert publishes
  nothing, so the stream's dedup (`payload !== lastSent`) has nothing to react to. It self-heals only on
  the next unrelated change to that room/property, or on the 60 s safety poll.
- **Evidence**:
  ```
  guest stream: frame@728ms -> request found, items=EMPTY     /state (poll) items: ["QA4 Race Dosa"]
  board stream: frame@745ms -> items EMPTY  <- kitchen sees an order with no dishes
  ```
  (When the line lands inside the 120 ms window it is fine — a control run gave `items=PRESENT` at
  368 ms. It is a race, and the slow side of it is the normal side.)

### [MAJOR] After a code lockout expires the guest gets zero fresh attempts — one typo re-locks for another 15 minutes, forever
- **Where**: `lib/guest-session.ts:105-112` (increment + lock) and `lib/guest-session.ts:132`
  (`code_attempts` reset only on a *successful* code). Server action `enterRoomCode`.
- **Steps**: the lockout releases on `code_locked_until` alone; `code_attempts` stays at 5. Reproduce
  the exact state a guest is in 15 minutes after being locked out, then make one wrong guess:
  ```
  update rooms set code_attempts=5, code_locked_until=now() - interval '1 minute' where number='303';
  curl -s -X POST http://localhost:3100/r/n9IQgxwQimo \
    -H "Next-Action: 60506d5c45d2665649a8938b05b1d703083638259b" \
    -H "Content-Type: text/plain;charset=UTF-8" -H "Origin: http://localhost:3100" \
    --data-raw '["n9IQgxwQimo","1234"]'
  ```
- **Expected / Actual**: expected 5 fresh attempts after waiting out the lock. Actual: the first wrong
  digit satisfies `code_attempts + 1 >= 5` immediately, re-locks for a full 15 minutes, and reports
  `attemptsLeft` 0 via the "ask the front desk" branch. This repeats indefinitely — the guest can never
  get back in without the desk resetting the room.
- **Evidence**:
  ```
  code 1234   {"ok":false,"error":"Too many attempts. Please ask the front desk.","lockedMinutes":15}
  code_attempts: 6   code_locked_until: +00:14:59   (was 5, lock already expired)
  code 7126   {"ok":false,"error":"Too many attempts. The front desk can let you straight in."}
  ```
  `lib/auth.ts:294-300` resets `failed_logins` the same way — only on success — so staff logins have
  the identical ratchet (**code-read**, not separately reproduced).

### [MINOR] An invalid uuid in a client-supplied id throws and returns 500 on four surfaces
- **Where**: `lib/scope.ts:31-32` (`${column} = ${propertyId}` against a uuid column),
  `lib/requests.ts:88` (`i.id = any(${ids})`), `lib/requests.ts:221` (`id = ${requestId}`).
  Endpoints `/api/staff/board`, `/api/staff/board/live`, and the `submitCart` / `cancelRequest` actions.
- **Steps**:
  ```
  curl -s -H "Cookie: hc_session=$S_qa_admin" "http://localhost:3100/api/staff/board?property=zzz"
  curl -s -H "Cookie: hc_session=$S_qa_admin" "http://localhost:3100/api/staff/board/live?property=zzz"
  # and, with a guest cookie, an action arg of "not-a-uuid" / "; drop table rooms--"
  ```
- **Expected / Actual**: expected a 400 or an empty result. Actual: an unhandled `PostgresError`
  (`22P02 invalid input syntax for type uuid`) surfacing as a 500. No injection and no data leak — the
  values are parameterised, and the body is only `{"digest":"855897096"}` — but it is an uncaught
  throw on a request path any client can trigger, and it fills the log with stack traces.
- **Evidence**: `HTTP 500`, 0-byte body on the JSON routes; `1:E{"digest":"855897096"}` on the action.
  `manager` is unaffected (the param is ignored for pinned roles).

### [MINOR] The guest screen gives up on the stream permanently and never says so — **code-read**
- **Where**: `lib/use-live.ts:71-75` sets `stopped = true` after three errors and nothing ever clears
  it; `lib/use-live.ts:52-53` (`if (stopped || source) return`) means the `visibilitychange` handler at
  `:86-93` cannot revive it either. `app/r/[token]/GuestApp.tsx:82` destructures only
  `{ state, refresh }` and throws `live` away.
- **Expected / Actual**: three transient errors — a wifi drop in a lift, a deploy, a restart — should
  cost a reconnect, not the channel. Actual: the stream is dead for the life of the page and the guest
  silently drops to the 60 s `pollUrl`. Nothing tells them: `useLive` computes `live` and the caller
  discards it, so `setLive` only causes a wasted re-render of the whole guest app. The staff board does
  have an indicator (`app/staff/(app)/board/Board.tsx:256`, "Reconnecting…", driven by its own `stale`
  flag from the poll, not by the stream) — the guest screen has no equivalent.
  `app/staff/(app)/board/Board.tsx:112-133` has the same three-strike stop, but its effect re-runs when
  `property` or `apply` changes, so it recovers by accident rather than by design.
- **Evidence**: code only. I verified the server side of the contract (see "Verified working") but did
  not drive a browser through three consecutive failures.

### [MINOR] `board/live` answers an unauthenticated stream with a 307 to an HTML page
- **Where**: `app/api/staff/board/live/route.ts:19` → `requireOperational()` → `redirect('/staff/login')`
  at `lib/auth.ts:162`.
- **Steps**: `curl -sN -D - http://localhost:3100/api/staff/board/live`
- **Expected / Actual**: its guest twin returns `401 {"error":"locked"}` with a JSON content-type, which
  a client can act on. This returns `307` + `location: /staff/login`, so an `EventSource` follows the
  redirect into `text/html` and fails on content-type rather than on status. Same for a guest cookie on
  the board stream and for the platform account.
- **Evidence**:
  ```
  HTTP/1.1 307 Temporary Redirect
  location: /staff/login
  ```
  Not a security hole — the request is correctly refused — but the failure is unclassifiable to the
  caller, so the board can only fall back to its 60 s poll.

### [POLISH] The folio export window uses the app server's clock against database timestamps
- **Where**: `app/api/staff/folio.csv/route.ts:18-20` builds `to = new Date()` and `from` from it;
  `lib/folio.ts:100` compares them to `f.created_at`, which is written by Postgres `now()`.
- **Steps / Evidence**: measured skew on this box was 291 ms (`db_now 14:47:15.429Z` vs
  `node now 14:47:15.138Z`). A charge posted at `14:46:44.057` was omitted from an export taken
  immediately after it, and appeared on a retry a minute later:
  ```
  first call : Room,Guest,Description,Amount (INR),Posted at      <- header only
  retry      : QA4-1,QA4 Rival Guest,QA4 RIVAL SECRET CHARGE,999.00,2026-09-14T14:46:44.057Z
  ```
- **Expected / Actual**: a charge that exists should be exportable. Here the most recent charges are
  invisible for however far the app clock trails the database, which on a serverless fleet is not
  bounded by anything the app controls. `now()` on both sides of the comparison would remove the class.

### [POLISH] The schema promises the QR token rotates at checkout; it does not
- **Where**: `db/schema.sql:49-50` — "Rotated at checkout so a previous guest's photo of the QR stops
  working" — versus `app/staff/(app)/rooms/actions.ts:105-107`, where `checkOut` clears `occupied`,
  `guest_name`, `checked_in_at`, `access_code` and the lock counters, and leaves `token` untouched.
- **Evidence**: room 303's token was `n9IQgxwQimo` before my checkout test and `n9IQgxwQimo` after.
- **Expected / Actual**: no live exposure — the 4-digit code is the real gate and it is cleared on
  checkout — but the comment describes a defence that is not implemented, which is how a later change
  ends up relying on it.

---

## Verified working

- **Guest stream auth** — `/api/guest/[token]/live` returns 401 with no cookie, with room 302's cookie
  on room 303's token, with a tampered signature, and with only a staff cookie; 404 for an unknown
  token, a 5000-byte token and `' or 1=1--`. `/api/guest/[token]/state` behaves identically. No
  variation in the body between cases, so nothing is distinguishable.
- **Board stream auth** — `requireOperational()` correctly refuses no cookie, a tampered signature, a
  guest cookie and the platform account (307 → `/staff/login`); `qa.hk` sees only housekeeping rows.
- **Cron endpoint** — GET and POST both return 401 with no auth, a bogus bearer, and a staff cookie
  (`CRON_SECRET` unset on a build where `NODE_ENV=production`, so the "must not silently open" branch
  in `app/api/cron/escalate/route.ts:22-27` fires as intended).
- **Manager / staff scoping** — `?property=<foreign uuid>` is ignored for pinned roles on both the board
  poll and `folio.csv`; `staff` gets 403 on `folio.csv`; `days` is clamped (`-5`→1, `1e99`→365,
  `abc`→7).
- **Server actions re-check everything** — every write in `app/r/[token]/actions.ts` goes through
  `authedRoom()`, which re-resolves the room from the QR token and re-runs `hasGuestAccess`. I found no
  path that trusts a client-supplied id: `cancelRequest` against another room's `new` request returns
  "already being worked on" and the target row stayed `new`; `submitCart` with a non-existent item id
  is refused; **prices are re-resolved server-side** — a cart sending `price_paise:1`,
  `unit_price_paise:1` and a `-999999` modifier price still billed the catalogue price of 26000 paise;
  a forged modifier group and a missing required group are both refused; `qty` is bounded to 1–20 and
  floored; 41 lines and an empty cart are refused.
- **Code lockout** — exactly 5 wrong codes lock room 303 for 15 minutes, with a correct per-attempt
  countdown ("That code is not right" → "One more attempt before this locks" → "Too many attempts.
  Please ask the front desk."). The correct code is refused while locked. Malformed codes (`abc`,
  `71260000`, empty) are rejected without burning an attempt. An **already-granted** cookie keeps
  working during the lock, for reads and writes — correct, and deliberate: the lock defends against
  guessing, not against the guest whose sibling mistyped.
- **Checkout invalidation** — for every path except an already-open stream (see BLOCKER above): the
  `checked_in_at`-bound grant stops matching the moment the room is checked out; `/state`, a newly
  opened `/live` and `sendGuestMessage` all refuse the old cookie.
- **Stream mechanics** — `retry: 3000` is the first frame on both streams; `: ping` heartbeats land
  every 25.0 s with no drift (9 of them); the stream closes itself at 240.1 s, i.e. `MAX_MS` exactly.
- **Push deduplication** — touching a row the viewer cannot see produces no frame: an update to another
  room's request gave the room-303 guest 0 frames while correctly giving the board 1; a no-op
  `update rooms set floor = floor` on room 303 gave 0 frames. `payload !== lastSent` does its job.
- **Coalescing** — four `messages` inserts in one transaction produced exactly **1** frame on the guest
  stream and **1** on the board, not four.
- **Connection health** — 15 concurrent SSE streams (8 guest + 7 board) cost the database **one extra
  connection** total (17 → 18), confirming the single shared listener in `lib/realtime.ts` fans out
  rather than opening a connection per stream. With those 15 held open, 30 concurrent page/API requests
  all returned 200 (max 2327 ms) and the connection count did not move. A single write then fanned out
  to all 15 streams as exactly 1 frame each — no duplicates, no misses. Closing all 15 left the count
  unchanged. I could not reproduce the old overlapping-poll outage: both clients hold an `inFlight`
  guard (`lib/use-live.ts:33-35`, `Board.tsx:44-46`), the board's escalation sweep is awaited rather
  than detached (`app/api/staff/board/route.ts:23-30`), and `statement_timeout` is 15 s
  (`lib/db.ts:25`) against a `max: 10` pool.

## Measured push latency

Time from the database write to the frame arriving at a held `curl`/`fetch` client. Same box, Supabase
ap-south-1, warm pool.

| Scenario | Stream | Latency |
|---|---|---|
| One `messages` insert | guest | **762 ms** |
| One `messages` insert | board | **835 ms** |
| 4 `messages` inserts in one transaction (→ 1 frame) | guest | **536 ms** |
| 4 `messages` inserts in one transaction (→ 1 frame) | board | ~600 ms (1 frame) |
| `requests` insert + its `request_items` | guest | **368 ms** |
| `requests` insert + its `request_items` | board | **745 ms** |
| Unrelated row touched (dedup suppresses) | guest | no frame (correct) |
| Heartbeat interval | both | **25.0 s** (9 observed, no drift) |
| Self-close at max lifetime | both | **240.1 s** |

## Measured response times

| Request | Result |
|---|---|
| `GET /r/<token>` sequential, warm | 0.22–0.65 s |
| `GET /r/<token>` **20x concurrent** | 20/20 HTTP 200, p50 1.44 s, **slowest 1.475 s** |
| `GET /r/<token>` 20x concurrent while 15 SSE streams held | 20/20 HTTP 200, p50 1.996 s, **slowest 2.036 s** |
| `GET /staff/board` 20x concurrent | 20/20 HTTP 200, p50 0.899 s, **slowest 1.072 s** |
| `GET /api/guest/<token>/state` 20x concurrent | 20/20 HTTP 200, **slowest 0.966 s** |
| 30 mixed concurrent requests with 15 streams held | 30/30 HTTP 200, p50 2.184 s, **slowest 2.327 s** |

Nothing hung, nothing timed out, no 5xx from load, and the pool never ran dry. The ~6x spread between a
warm sequential guest page (0.25 s) and the same page 20-up (1.5 s) is queueing behind `max: 10` at
~150–250 ms per round trip to ap-south-1, not a defect.
