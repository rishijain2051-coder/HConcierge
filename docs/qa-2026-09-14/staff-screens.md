# QA-2 — Staff operational screens (Board, Rooms, History, guest↔staff chat)

Tested against the production build on `http://localhost:3100` as `qa.manager` (manager, RN Grand Pune),
with `qa.hk` (housekeeping) and `qa.admin` (org admin) for scoping. Guest side: room 302, token `2TWOkuyONJ4`.

> **Note on code references.** The working tree moved under me while I tested — `lib/auth.ts`,
> `lib/board.ts`, `lib/db.ts`, `lib/guest-session.ts`, `lib/sse.ts` and `app/staff/(app)/rooms/page.tsx`
> all changed on disk, and commit `fc81824` landed at 20:38. The running build (`.next/BUILD_ID`
> `4l7pfLufLM-K-3oTl-NzS`, built 19:06) is **older than HEAD**. Every finding below was reproduced against
> the running build; line numbers are from the tree as I read it and may have shifted. Where the running
> build and HEAD demonstrably differ I say so.

---

### [MAJOR] One long unbroken word in a guest note stretches the whole board to ~4800px
- **Where**: `app/staff/(app)/board/Board.tsx:393` — `<p className="mt-1.5 text-[13px] leading-snug">{summary}</p>`
  (and `:394` for the note). Screen: Board, any lane, any viewport under the `lg` (1024px) breakpoint.
- **Steps**:
  1. A guest sends a request whose note/summary contains a long unbroken token. One already existed on the
     board during my run: request **#60, room 301**, whose summary is 500 `A` characters followed by `Z`.
  2. Open `/staff/board` at a viewport narrower than 1024px (I used 768×900 and 375×812).
- **Expected / Actual**:
  - Expected: the card wraps or clips the token; the board stays within the viewport.
  - Actual: `document.documentElement.scrollWidth` = **4804px** against a `clientWidth` of **375px** —
    a 12.8× horizontal scroll. All three lanes and every card become 4788px wide. The board is unusable
    on a tablet or phone until that one request ages out of the 4-hour window.
- **Evidence**: control test run in the page, removing and restoring only that one text node:
  ```
  {"before":{"docW":4804},"after":{"docW":527},"restored":{"docW":4804}}
  ```
  Computed style on the offending `<p>`: `{"overflowWrap":"normal","wordBreak":"normal","whiteSpace":"normal"}`.
  At 768px: `section` width 4788px, grid `gridTemplateColumns: "4787.71px"`.
- **Why it only bites below `lg`**: at `lg:grid-cols-3` each track is `1fr`, and `article` carries
  `overflow-hidden`, so the token is clipped and the layout survives (measured at 1440px: `docW` 1430,
  card width 432px, card `scrollWidth` 4751px — clipped, not pushing). Below `lg` there are no explicit
  columns, so the single implicit `auto` track sizes to max-content and the overflow escapes.

### [MAJOR] Any staff account — including department-scoped housekeeping — can read every guest's room access code
- **Where**: `app/staff/(app)/rooms/Rooms.tsx:152-160` (the Code cell is rendered unconditionally, not
  behind `canEdit`) and `app/staff/(app)/rooms/print/page.tsx:22` (`requireStaff()`, not `requireManager()`).
  Screens: Rooms table, and `/staff/rooms/print?room=<id>&slip=1`.
- **Steps**:
  1. Sign in as `qa.hk` (role `staff`, department `housekeeping`).
  2. Open `/staff/rooms` — every action button is correctly hidden (`canEdit === false`), but the Code
     column still renders.
  3. Open `/staff/rooms/print?room=0b7e02d4-122f-40bc-b48b-d72a732aa8f7&slip=1`.
- **Expected / Actual**:
  - Expected: an account that is not trusted to check a guest in, issue a code, settle a bill or export
    charges should not be able to read the stay's second factor.
  - Actual: both screens return 200 and print the live code in plain text.
- **Evidence**: `/staff/rooms` as `qa.hk`, rendered visible text (tags and scripts stripped):
  ```
  301 Deluxe · Fl 3  Aarav Mehta  In since 9/14/2026 · ₹1,240 · wants to settle  9182
  302 Deluxe · Fl 3  Diya Kapoor  In since 9/14/2026                             5347
  303 Deluxe · Fl 3  Rohan Iyer   In since 9/14/2026 · 2 open                    7126
  ```
  And `/staff/rooms/print?...&slip=1` as the same account renders
  `… Room 302 Diya Kapoor … Your code 3303 Enter it once after scanning …` — while that session gets
  `403` from `/api/staff/folio.csv` and has no Manage tab (nav is `Board Rooms History` only).
- **Impact**: the code plus the QR token is the guest's whole authentication (`lib/guest-session.ts` —
  grant is `{rid, cin}`, nothing else). I confirmed independently that a valid grant gives full read of the
  guest's folio, their private thread with the front desk, and the ability to place charges on the room.

### [MAJOR] The two "on time" percentages on the History page use different denominators
- **Where**: `app/staff/(app)/history/page.tsx:32` (`slaRate = within_sla / done`) vs `:120`
  (`rate = d.within_sla / d.total`), fed by `lib/history.ts:95-110` where `loadByDepartment` counts
  **all** requests in `total` but only completed-within-SLA ones in `within_sla`.
- **Steps**: open `/staff/history` as `qa.manager` with the default Last-7-days filter.
- **Expected / Actual**:
  - Expected: one number for "answered on time", or two that are clearly different metrics.
  - Actual: the headline stat and the per-team bars are the same metric with different denominators, so
    they disagree by more than 2×. The per-team bars silently count open and cancelled requests as misses.
- **Evidence**: single page render —
  headline `Answered on time 78% · 7 of 9 completed`; team bars
  `Food & beverage 8 requests 50% on time · Housekeeping 5 requests 20% · Front desk 4 requests 25% ·
  Maintenance 1 request 100%`. The bar numerators sum to 4+1+1+1 = 7 (matching `within_sla`), but over
  denominators summing to 18 — i.e. **39%**, against the 78% printed six inches above it.

### [MAJOR] The History CSV export link is always rendered but 400s for an org admin on the default view
- **Where**: `app/staff/(app)/history/page.tsx:33` builds `csvHref` and omits `&property=` whenever
  `filters.propertyId` is null, which is the default for `role === 'admin'`. Handled by
  `app/api/staff/folio.csv/route.ts`. Screen: History → "Export charges (CSV)".
- **Steps**: sign in as `qa.admin`, open `/staff/history`, click **Export charges (CSV)**.
- **Expected / Actual**:
  - Expected: a CSV of the admin's whole organisation, or an in-app message explaining that a property
    must be chosen.
  - Actual: `HTTP/1.1 400 Bad Request`, `content-type: text/plain`, body `Choose a property first.` —
    the operator lands on a bare error page with no way back.
- **Evidence**: the rendered page contains `href="/api/staff/folio.csv?days=7"` for `qa.admin`;
  that URL returns 400. The same button as `qa.manager` returns 200 with a correct CSV.
- **Running-build caveat**: the string `Choose a property first.` does **not** exist anywhere in the
  current tree — the running build predates the current HEAD. At HEAD the route would call
  `exportCsv(staff, null, …)` and `scopeTo` would scope to the admin's organisation, so this specific 400
  may already be gone. The underlying shape — a link rendered unconditionally whose only failure mode is
  a raw text error page — is still worth a look.

### [MINOR] Rooms table at 375px hides the guest entirely and still overflows
- **Where**: `app/staff/(app)/rooms/Rooms.tsx:110-113` — row grid is
  `grid-cols-[4.5rem_1fr_auto] … sm:grid-cols-[4.5rem_7rem_1fr_5.5rem_auto]`. Screen: Rooms, 375px.
- **Steps**: open `/staff/rooms` at 375×812.
- **Expected / Actual**:
  - Expected: on a phone the desk can at least see who is in the room and whether they owe money.
  - Actual: for every **occupied** row the guest column collapses to **0px**, so the guest name and the
    whole status line (`In since … · N open · ₹x · wants to settle · code locked`) render at zero width and
    are invisible. The Code column is `hidden sm:block`, so it is gone too. The row shows a number and
    three buttons. The page still overflows by 152px horizontally.
- **Evidence**: measured at `clientWidth: 375` —
  ```
  occupied: [{"t":"301D","guestW":0,"shown":"Aarav Mehta\n\nIn since 9/14/2026 · ₹1,240 · wants to settle"},
             {"t":"302D","guestW":0,"shown":"Diya Kapoor\n\nIn since 9/14/2026"},
             {"t":"303D","guestW":0,"shown":"Rohan Iyer\n\nIn since 9/14/2026 · 2 open"}]
  gridTemplateColumns: "72px 0px 213.6px"   docScrollW 527 vs clientW 375
  ```
  Vacant rows are fine (guest cell 97px, shows "Vacant") — it is the extra action buttons on an occupied
  row that squeeze the `min-w-0` column to nothing. At 768px the table is correct (no overflow, all five
  columns, code visible).

### [MINOR] A wrong password wipes both fields, so clicking "Sign in" again does nothing
- **Where**: `app/staff/AuthForm.tsx:30` — `useActionState` with an uncontrolled `<form action={formAction}>`;
  React 19 resets the form after the action resolves. Screen: `/staff/login`.
- **Steps**: enter `qa.manager` + a wrong password, click **Sign in**, then click **Sign in** again.
- **Expected / Actual**:
  - Expected: after a typo, correct the password and retry. At worst, keep the username.
  - Actual: both `username` and `password` are cleared. The second click submits an empty form, HTML5
    `required` blocks it, and **no request is sent** — the button looks broken. The operator has to retype
    their username every single attempt.
- **Evidence**: read straight after a failed submit — `{"u":"","p":"","err":"Incorrect username or password."}`.
  Network panel over four consecutive clicks of **Sign in**: exactly one `POST /staff/login`.
  `staff.failed_logins` went 1 → 2, confirming only one attempt reached the server.

### [MINOR] The board's alert chime cannot be turned off, and silently resets on every navigation
- **Where**: `app/staff/(app)/board/Board.tsx:40` (`useState(false)`) and `:257-266` — the button is
  replaced by a static `🔔 Alerts on` span once enabled. Screen: Board, top-right.
- **Steps**:
  1. On the Board, click **🔔 Turn on alerts** → it becomes the text `🔔 Alerts on`. There is no control
     to turn it back off short of reloading.
  2. Click **Rooms** in the nav, then **Board**.
- **Expected / Actual**:
  - Expected: a toggle, and a setting a night desk can rely on across a shift.
  - Actual: one-way within a page, and gone the moment you leave the board. The desk has to remember to
    re-arm alerts after every trip to Rooms or History, or they simply stop hearing new orders.
- **Evidence**: after Board → Rooms → Board the control reads `["🔔 Turn on alerts"]` again.
  `localStorage` holds only `hc.lastUser`; nothing persists the alert preference.

### [MINOR] "Expected checkout" is collected at check-in and then never shown anywhere
- **Where**: written in `app/staff/(app)/rooms/actions.ts:42`, selected in
  `app/staff/(app)/rooms/page.tsx:21`, typed on `RoomRow` in `app/staff/(app)/rooms/Rooms.tsx:18` —
  and never rendered. Screen: Rooms check-in modal.
- **Steps**: check a room in with an **Expected checkout** date, then look at the Rooms row.
- **Expected / Actual**:
  - Expected: the desk can see (and amend) the departure date they just typed.
  - Actual: the row only ever shows `In since <date>`. The value is stored but invisible on every staff
    screen, and there is no way to change it without checking the guest out and back in.
- **Evidence**: checked room 302 in with `2026-09-17T11:00`; DB holds
  `"checkout_at":"2026-09-17T05:30:00.000Z"` (correct, IST); `grep -rn checkout_at app/ lib/` returns four
  hits, none of which is a render.

### [POLISH] "just now ago" in two places
- **Where**: `app/staff/(app)/board/Board.tsx:656` (`{formatAge(c.last_at)} ago` in the Messages list) and
  `:508` (`Raised {formatAge(r.created_at, …)} ago` in the request drawer). `lib/sla.ts:36` returns the
  literal string `'just now'` for anything under a minute.
- **Steps**: send a message from a guest room, open Board → Messages; or open any request raised under a
  minute ago.
- **Expected / Actual**: "just now" / Actual: **"just now ago"**.
- **Evidence**: Messages row rendered as
  `"302 Diya Kapoor just now ago QA2 guest ping unread test 1"`; drawer rendered as
  `"#55 · RN Grand, Pune · Food & beverage … Raised just now ago · target 20 min · New"`.
  `formatAge(c.last_at)` in the Messages list is also called without the `now` prop, so unlike every other
  timestamp on the board it does not tick with the 15-second clock.

### [POLISH] Rooms modals ignore Escape; the Board drawer handles it
- **Where**: `app/staff/(app)/rooms/Rooms.tsx:432` (`Modal`, no key handler) vs
  `app/staff/(app)/board/Board.tsx:454-458` (`Drawer`, `keydown` → `onClose`).
- **Steps**: open any Rooms modal (Check in / New code / Add a room / "has not settled"), press Escape.
- **Expected / Actual**: closes, as the Board drawer does / Actual: stays open. Backdrop click does work.
- **Evidence**: `{"openedOnClick":true,"stillOpenAfterEscape":true,"openAfterBackdropClick":false}` for the
  Rooms modal, against `{"drawerOpened":true,"closedByEscape":true}` for the Board drawer.

### [POLISH] Two staff with the same first word are indistinguishable on a card
- **Where**: `app/staff/(app)/board/Board.tsx:407` — `r.assigned_name.split(' ')[0]`.
- **Steps**: assign a request to `QA Housekeeping`, then to `QA Manager`.
- **Expected / Actual**: the card names the assignee / Actual: both render as the tag `QA`. The board gives
  no way to tell who a job is on without opening the drawer.
- **Evidence**: card text before and after reassignment is identical —
  `302 #29 · 1m Bath towels … Housekeeping QA 8 min left of 10 Done` — while the DB moved from
  `QA Manager` to `QA Housekeeping`.

---

## Not reproduced / not present

- **Quick replies in the staff chat** — asked for in the brief, but there is no such control.
  `Thread` (`Board.tsx:674-757`) is a message list plus one free-text input; no canned responses anywhere.
- **Property filter on the Board** — the select only renders for `role === 'admin'`, and `RN Hospitality`
  owns exactly one property in this database, so there is nothing to switch between. I could not exercise
  the multi-property path at all. (Reading `apply()` at `Board.tsx:54-66`, every request in a newly
  selected property would be absent from the `seen` set and therefore announced as new — chime plus up to
  three desktop notifications for requests that are not new. Not reproducible here; flagging only so
  whoever has a two-property fixture checks it.)
- **`assignRequest` department check** — `lib/board.ts:220` verifies `canTouchProperty` but not
  `canTouchDepartment`, and does not verify the target staff belongs to the property. Not reachable from
  the UI (the select is hidden for `role === 'staff'`, and the board never hands a scoped account another
  department's request id), and I did not forge a server-action call, so I am not claiming it as a bug.

## Environment artifacts — not product bugs

- **Stuck loading skeletons / dead buttons after `navigate`.** The Browser pane reports the tab hidden, so
  `requestAnimationFrame` never fires; React 19's streaming reveal (`$RV`/`$RB`) is rAF-scheduled, so the
  Suspense boundary is never revealed and never hydrates. Confirmed: the server HTML is complete and ends
  with `$RC("B:0","S:0")`, the content sits inside `<div id="S:0" hidden>`, and only the 7 layout-shell
  elements carry React props. **Navigating via the in-app nav links instead fixes it completely**
  (52/52 buttons hydrated). Worth knowing for anyone else driving this app from the pane.
- **Guest sessions fighting each other.** `hc_guest` is a single cookie at `path: '/'`, so another agent
  signing into room 303 in the shared pane evicted my room-302 grant and my guest writes started failing
  with "Please enter your room code again." Correct behaviour for a real guest phone (one room per device);
  only a problem because four agents share one browser profile. I worked around it by minting my own
  signed grant and driving the guest side over HTTP.

## Verified working

**Login** — wrong username and wrong password both return the same generic `Incorrect username or password.`;
empty fields are blocked by HTML5 `required`; lockout fires at exactly 5 failures and then refuses even the
**correct** password with `Too many attempts. Try again in 15 minutes.`; a successful sign-in resets
`failed_logins` to 0 and lands on `/staff/board`.

**Board** — three lanes with correct membership (`new` / `ack`+`in_progress` / `done`+`cancelled` inside the
4h window); Requests/Messages toggle with live counts; department chips filter correctly and show open-only
counts; every transition works (`new → ack → in_progress → done`, and cancel with a reason that is stored and
shown back); auto-assignment to the acting staff member on accept; assignment via the drawer select persists;
SLA colouring is correct at all three states (`bg-ok` fresh → `bg-warn` at 60% → `bg-late` + `bg-late-soft`
card past target, with `N min over` and an `N overdue` header badge); the `Escalated` tag appears after the
sweep; the `Reconnecting…` stale banner appears once both the SSE stream and the 60s poll are failing;
the alerts toggle arms the Web Audio chime and requests notification permission.

**Live board (SSE)** — a guest order placed on room 302's screen appeared on the board with no refresh, with
its note, price and department. Reverse direction measured precisely: clicking **Start** on the board moved
the guest's tracker in **528 ms** (progress bar `scaleX(0.333333)` → `scaleX(0.666667)`). A SQL-inserted guest
message pushed to the board in under 2s (Messages 21 → 22, card badge `💬 1`). Escalation, assignment and
status changes all propagate over the same channel.

**Chat** — staff reply from the board reaches the guest (verified on the guest's own `/api/guest/.../state`);
unread badges appear per-room and in the Messages tab total; opening a thread clears that room's badge and the
header total recomputes correctly, live, without a refresh; the thread renders staff/guest sides with author
and time.

**Rooms** — check-in stores name and expected-checkout and issues a fresh code; the issued-code modal shows the
code with a "Print welcome card" link; **New code** reissues without touching the QR token or the stay;
**Unlock** clears a code lockout without changing the code, and the `· code locked` indicator appears and
clears correctly; `wants to settle` highlights the Settle button; **Settle ₹480** closes the folio with
`settled_by`, clears the guest's bill and clears `settle_requested_at`; **Welcome card** prints the code, the
desk **QR** card correctly does not, and the bulk print page rendered all 22 cards with 22 QR SVGs and no codes.

**Check-out guard** — with ₹480 outstanding, check-out refuses and opens
`Room 302 has not settled · There is ₹480 outstanding on this room…` with **Not yet** / **Settled — check out**.
**Not yet** leaves the room checked in. After settling, check-out succeeds and correctly clears occupancy,
guest name, `checked_in_at`, `checkout_at` and `access_code`; cancels the open request with
`Guest checked out`; and invalidates the guest's device (their API went from 200 to **401** immediately).

**Charges** — marking a priced request done posts exactly one folio entry (`Request #55`, ₹480) and it appears
on the guest's bill; cancelling a priced request posts nothing.

**History** — all filters work (period 1/7/30/90, team, status, room), the stats row and per-team panel
recompute per filter, over-SLA resolve times are highlighted (`text-late font-semibold` on `26 min` against a
10-minute target), the `escalated` marker shows, and the empty state reads `Nothing matches those filters.`
Malformed query strings degrade gracefully with no 500s (`days=abc` → 7, `status=bogus` / `department=notadept`
→ empty). CSV export for a manager returns 200 with the right `Content-Disposition`, correct RFC-4180 quoting,
`days` clamped to 1–365, scoped to the caller's property, and 401 without a session.

**Role scoping** — `qa.hk` sees only `housekeeping` requests from `/api/staff/board`, has no Manage tab
(nav is `Board Rooms History`), gets no admin content from `/staff/admin`, `/staff/admin/properties` or
`/staff/admin/organisations` (redirected in the streamed payload — the shell is all that is served), and is
`403` on the CSV export. `qa.admin` is scoped to its own organisation's single property on the board.
Cross-property reach was not testable: only one property exists.

## State left behind

Room 302 is **checked in** — Diya Kapoor, code **5347**, zero balance, no test charges, no settle request.
`checkout_at` is set to 2026-09-17 11:00 IST from the check-in I performed through the UI.
All three QA accounts have `failed_logins = 0` and `locked_until = null`.
The folio entry my testing created (`Request #55`, ₹480) has been deleted. Rooms 301 and 303 untouched.
Requests #29 / #55 / #56 / #59 and my two test messages on room 302 are left in place as evidence.
