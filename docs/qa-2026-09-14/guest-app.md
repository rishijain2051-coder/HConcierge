# QA-1 — Guest app (Room 301), end to end

Tested against the running **production** build at `http://localhost:3100/r/X-VN6evK058`, room 301, code 9182.
Everything below was reproduced in the browser; code references are the confirmed cause, read after the fact.

Two notes on the environment:

- A dev agent edited `app/r/[token]/actions.ts` and `lib/use-live.ts` **during** this run. The running server is a
  pre-built production bundle, so these findings describe the built version. Line numbers are from the tree as of
  the end of the run.
- The browser pane is a background tab: CSS animations and transitions do not advance and layout is not computed
  until something forces it. Measurements below were taken after forcing layout / finishing animations, so the
  numbers are real; "visual" judgements were only made from screenshots taken after that.

---

### [MAJOR] Chat composer sits underneath the bottom nav — taps land on the nav tabs
- **Where**: `D:\Concierge\app\r\[token]\GuestChat.tsx:86` (`className="bg-paper sticky bottom-0 …"`), against the
  fixed nav in `D:\Concierge\app\r\[token]\GuestApp.tsx:197` and the basket bar at `GuestApp.tsx:308`. Chat tab.
- **Steps**:
  1. Chat tab, with enough history for the page to scroll (16 messages here).
  2. Scroll up at all — anywhere except the very bottom of the page.
  3. Look at where the message input and Send button are.
- **Expected / Actual**: Expected the composer to stay usable above the tab bar. Actual: it is pinned to the bottom
  of the viewport, i.e. *behind* the fixed nav (and behind the basket bar when the basket has anything in it). It is
  invisible and untappable — a tap where it appears to be switches tab instead.
- **Evidence**: at 375x812, `scrollY=400`: input rect `top 752 / bottom 800`, nav `top 754`;
  `document.elementFromPoint()` at the centre of both the input **and** the Send button returns
  `BUTTON ease-glide relative flex flex-…` — a nav tab button.
  With one item in the basket: form `740–812`, basket bar `690–754`, nav `754–812` — fully covered.
  Reproduced again at 768x1024: form `952–1024`, nav top `966`, hit test at the input returns `BUTTON Services`.
  Screenshot at 375x812 shows no composer on screen at all, only the basket bar and the nav.
  Scrolling to the absolute bottom brings it back into view (form `580–652`) — that is the only state where it works.

### [MAJOR] A required modifier group can be emptied; the order is only rejected at submit, and the basket gives no way to fix it
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:902` (`if (already) return [...others, ...inGroup.filter(…)]`
  — the toggle has no "don't drop below min" guard) and `GuestApp.tsx:974` (Add is never disabled). Item sheet + basket sheet.
- **Steps**:
  1. Dining → Main course → Butter Chicken → "Choose". "Spice level" is marked REQUIRED and pre-selects Mild.
  2. Tap the selected spice option once (e.g. Spicy after switching to it) — it deselects. Nothing is selected in the required group now.
  3. "Add · ₹680" is still enabled. Tap it.
  4. Open the basket, tap "Send to the team".
- **Expected / Actual**: Expected either that a required group cannot be emptied, or that Add is blocked with an
  inline message. Actual: it adds silently; the basket row shows only the add-ons ("Extra cheese, Extra butter,
  Extra gravy") with no hint that the spice level is missing; submit fails server-side and the whole basket is refused.
- **Evidence**: after the deselect, selected options were `["Extra butter+₹30","Extra cheese+₹60","Extra gravy+₹50"]`,
  Add button `Add · ₹680`, `disabled: false`. On submit the toast read
  **"Choose a spice level for Butter Chicken."** (server guard at `D:\Concierge\lib\requests.ts:52`), the basket sheet
  stayed open and unchanged. There is no edit affordance on a basket line — the only recovery is to delete the line
  and re-add the item from the menu.

### [MAJOR] One long unbroken word in a note or chat message gives the whole page thousands of pixels of horizontal scroll
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:588` (tracker title `<p>` — no `break-words`/`overflow-wrap`)
  and `D:\Concierge\app\r\[token]\GuestChat.tsx:60` (`max-w-[82%]` bubble, same omission). Home tracker card + Chat.
- **Steps (A, Home)**: Home → "Something else?" → paste 500 characters with no spaces (the field's own maximum) → Send.
- **Steps (B, Chat)**: Chat → send a long URL, e.g. a Google-Maps-style link of ~140 chars.
- **Expected / Actual**: Expected the text to wrap or clip inside the card. Actual: the text runs straight off the
  card and the document itself gains horizontal scroll.
- **Evidence**: A — at `clientWidth 375`, `document.documentElement.scrollWidth = 5820` →
  **5445px of horizontal overflow**; `getComputedStyle(titleP).overflowWrap === "normal"`. Cancelling that one
  request brought `scrollWidth` straight back to `375` (overflow 0), which isolates the cause.
  B — the same page went to `hOverflow: 151` at 375px wide after one long URL was sent.
  Note `ClosedCard` ("Earlier") *does* use `truncate`, so only the live tracker and the chat bubbles are affected.

### [MAJOR] "What time?" is applied to every department in the basket, and a past time is accepted
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:1046` (`scheduledFor` passed once for the whole cart),
  `GuestApp.tsx:1090` (`<input type="datetime-local">` with no `min`), and
  `D:\Concierge\lib\requests.ts:150` (`scheduled_for` written onto *every* request the cart splits into; no validation).
- **Steps**:
  1. Basket: Wake-up call (needs a time), 2× Bath towels (housekeeping), Butter Chicken (kitchen).
  2. The "What time? *" field appears, Send is disabled until it is filled — good.
  3. Set it to **yesterday** 07:00. Send becomes enabled. Send.
- **Expected / Actual**: Expected the time to apply only to the item that needs one, and a past time to be rejected.
  Actual: accepted, and stamped onto all three requests.
- **Evidence**: `sendDisabled:false, validity:true` with value `2026-09-13T07:00`; toast "Sent — 3 teams are on it";
  DB afterwards — refs 51 (front_desk), 52 (housekeeping) **and** 53 (fnb) all carry
  `"scheduled_for": "2026-09-13T01:30:00.000Z"`. The kitchen order for tonight is now scheduled for yesterday morning.
- **Related, same flow**: the chosen time is never shown back to the guest. Tracker #51 read
  `#51 · JUST NOW | Wake-up call | Sent … | About 10 min to go` — the ETA is `created_at + sla`, and `scheduled_for`
  appears nowhere in the guest UI at all, so there is no way to confirm or spot a mistyped time.

### [MAJOR] A dead guest session is invisible — the screen keeps looking live and never sends the guest back to the code gate
- **Where**: `D:\Concierge\lib\use-live.ts` (`if (res.ok) setState(...)` — a non-ok poll is swallowed; `live` is
  returned but `GuestApp.tsx:82` destructures only `{ state, refresh }`), `D:\Concierge\app\api\guest\[token]\state\route.ts:20`
  (401 `{"error":"locked"}`), `D:\Concierge\app\r\[token]\actions.ts:17` (`DENIED` toast).
- **Steps**: use the app normally until the `hc_guest` grant stops matching the room (here it happened mid-session;
  by design the grant is also invalidated whenever the stay's `checked_in_at` changes, i.e. on check-out or re-check-in).
- **Expected / Actual**: Expected the app to notice and show the code gate. Actual: the last known state stays on
  screen looking live indefinitely — a tracker still shows "About 14 min to go" and ticks, while every state fetch is
  401 and the request has in fact moved on. Pressing a control gives a 3.5-second toast telling the guest to do
  something the app gives them no way to do.
- **Evidence**: `fetch('/api/guest/X-VN6evK058/state')` → `401 {"error":"locked"}` repeatedly, and a fetch of the page
  itself returned the code gate HTML (`pageIsGate: true`), while the SPA on screen still rendered the Home tab with a
  live-looking tracker. Tapping "Cancel" produced only the toast **"Please enter your room code again."** and left the
  card in place. Only a manual reload revealed the gate. (Likely trigger in this shared test environment: `hc_guest`
  is one cookie at `path: '/'`, so a second room signing in on the same browser overwrites it — but the handling of
  the 401 is the bug here regardless of what causes it.)

### [MAJOR] Sheets say `aria-modal="true"` but nothing traps or moves focus
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:1317` (`role="dialog" aria-modal="true"`, no focus management,
  background not inert). Item sheet, basket sheet, bill sheet.
- **Steps**: open any sheet, then press Tab a few times.
- **Expected / Actual**: Expected focus to move into the dialog on open and stay inside it. Actual: focus stays where
  it was on the page behind, and Tab walks through the page behind the backdrop.
- **Evidence**: after opening the Butter Chicken sheet, `dialog.contains(document.activeElement) === false`; three
  Tabs later `document.activeElement` was `BUTTON 🍚 Breads, rice & biryani` — a category chip behind the sheet.
  There is also no `aria-labelledby` pointing at the sheet's own `<h2>`.

---

### [MINOR] Bill lines say "Request #54" — the guest cannot tell what they are being charged for
- **Where**: `D:\Concierge\lib\board.ts:187` (`description: \`Request #${current.ref}\``), rendered at
  `GuestApp.tsx:1200`. Bill sheet (header chip and the Home "Your bill" card open the same sheet).
- **Steps**: have completed, charged requests, then open the bill.
- **Expected / Actual**: Expected the line to name what was ordered. Actual: "Request #54 — ₹700", with the ref
  repeated on the sub-line ("Sep 14, 8:26 PM · #54").
- **Evidence**: sheet text — `Request #54 | Sep 14, 8:26 PM · #54 | ₹700 | Request #53 | Sep 14, 8:26 PM · #53 | ₹540`.
  The underlying orders were "2× Masala Chai, Paneer Tikka" and "Butter Chicken" and neither name appears.
  (The two charges were posted by replicating `postCharge` from `lib/board.ts` in SQL, because the guest app has no
  way to post a charge; the `description` string is taken verbatim from that file.)

### [MINOR] The guest never sees the "Delivered" beat — the last step of the 4-step rail is dead code
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:366` (`open` excludes `done`) vs `GuestApp.tsx:638`
  (`request.status === 'done' ? 'Delivered — thank you'`) and `GuestApp.tsx:606` (`request.status !== 'done'`).
- **Steps**: watch a live tracker while the request is driven `new → ack → in_progress → done`.
- **Expected / Actual**: Expected the rail to fill to 4/4 with "Delivered — thank you" for a moment. Actual: the card
  vanishes from "Happening now" the instant the status becomes `done` and reappears in "Earlier" as a one-line
  "Completed" chip. The `done` branches inside `OrderTracker` can never execute.
- **Evidence**: at `in_progress` the card was present with 3 of 4 dots filled and the Cancel button gone; after
  `done` the Home text went straight from `HAPPENING NOW …` to `EARLIER | 🛎️ 🚿 needs towels please 😊 | #28 · 3m ago | Completed`.

### [MINOR] Chat tab dot counts every staff message ever sent and never clears
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:102`
  (`const unreadFromStaff = state.messages.filter((m) => m.sender === 'staff').length`), rendered at `GuestApp.tsx:218`.
- **Steps**: have the front desk send one message; open the Chat tab and read it; look at the tab bar.
- **Expected / Actual**: Expected the dot to clear once read. Actual: it stays lit forever — there is no read state on
  the guest side at all (the `messages.read_at` column exists but `loadGuestState` does not select it and only
  `lib/board.ts` uses it, for the staff direction).
- **Evidence**: with the Chat tab open (`aria-current="page"`) and the staff message visible on screen, the nav
  reported `{"label":"Chat","dot":true}`; still `true` after switching to Home.

### [MINOR] The Home tab's open-request badge is computed and then suppressed — no indicator ever shows
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:201` passes `openRequests.length` as the Home badge;
  `GuestApp.tsx:218` renders it only `{badge > 0 && id !== 'home' && …}`.
- **Steps**: leave 2 requests open, switch to any other tab, look at the Home tab.
- **Expected / Actual**: Expected a dot on Home while something is in flight (that is what the value is for).
  Actual: never rendered.
- **Evidence**: with 2 open trackers on Home, `{"label":"Home","dot":false}` while `{"label":"Chat","dot":true}`.

### [MINOR] The ETA can promise more time than the SLA, because the clock only starts once something is already open
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:511` — `useClock(active)` seeds `now` once at mount and only
  starts its 30 s interval when `active` flips true; it never takes a reading at that moment.
- **Steps**: sit on Home with no open requests for a while (do not switch tabs — that remounts Home and resets the
  clock), then send a "Something else?" request.
- **Expected / Actual**: For a 15-minute SLA the first line should never read more than "About 15 min to go".
  Actual: it overstates the ETA by exactly how long the tab was idle, and only corrects on the next 30 s tick.
- **Evidence**: deliberate repro — all requests cancelled at `15:08:20`, Home left mounted and idle; a freeform
  request (`sla_minutes: 15`) sent at `15:11:05` rendered **"About 18 min to go"**. 32 s later, after the first
  interval tick, the same card read **"About 14 min to go"** — a 4-minute jump. Earlier, incidental data point:
  a 15-minute request created at `14:47:31` showed "About 16 min to go" with Home mounted since ~`14:46:15`
  (browser clock verified in step with the DB: `14:47:52` browser vs `14:47:46` DB, so this is not clock skew).

### [MINOR] Every quantity stepper in the basket has the same accessible name
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:1076` and `:1078` — `label="One fewer"` / `label="One more"`
  with no item name, unlike the catalog rows which do include it (`GuestApp.tsx:816`/`:836`).
- **Steps**: put three different items in the basket and open it.
- **Expected / Actual**: Expected "One more Bath towels". Actual: identical labels on every row.
- **Evidence**: basket with lines `["Bath towels","Toiletries kit","Clean my room now"]` produced aria-labels
  `["Close","One fewer","One more","One fewer","One more","One fewer","One more"]`.
  There is also no explicit "remove" control — a line is deleted by pressing minus at quantity 1.

### [MINOR] Toasts and the chat error are not announced to assistive tech
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:267` (toast container — no `role`/`aria-live`) and
  `D:\Concierge\app\r\[token]\GuestChat.tsx:84` (`<p className="text-late …">{error}</p>`).
- **Steps**: trigger any toast ("Sent to the front desk", "Choose a spice level for Butter Chicken.") or the chat
  rate-limit error.
- **Expected / Actual**: These are the only feedback for a failed submit and a failed send; they should be announced.
  Actual: silent. Note the code gate does this correctly (`role="alert"` on `#code-error`), so the app is inconsistent
  with itself.
- **Evidence**: toast nodes captured via MutationObserver carry no `role` or `aria-live`; the gate's error node
  reported `role: "alert"`.

### [MINOR] The 500-character "Something else?" box shows about two lines of it
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:451-452` (`rows={2}`, `resize-none`, `maxLength={500}`) — no
  auto-grow, no counter.
- **Steps**: Home → "Something else?" → fill the field to its own 500-character maximum.
- **Expected / Actual**: Expected the box to grow, or at least a character counter. Actual: a 49px-tall box holding
  439px of text, with no indication you have hit the cap.
- **Evidence**: `{len:500, maxLength:500, rows:2, heightPx:49, scrollH:439, clipped:true}`. The message itself sends
  and stores correctly.

### [MINOR] The lockout message never tells the guest how long the lock lasts
- **Where**: `D:\Concierge\lib\guest-session.ts:142` returns `lockedMinutes: LOCK_MINUTES` (15) and `attemptsLeft`;
  `D:\Concierge\app\r\[token]\CodeGate.tsx:37` does `setError(res.error)` and discards both.
- **Steps**: exhaust the code attempts (not triggered a second time here, per the brief).
- **Expected / Actual**: Expected "…try again in 15 minutes". Actual: the copy stops at "Too many attempts. Please ask
  the front desk." — the server already computed the number and the client throws it away.
- **Evidence**: code path confirmed in both files; the attempt counter itself behaves correctly (see Verified working).

---

### [POLISH] The "Wake-up call" quick tile looks like a static card
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:864` — `{isSimple(item) && <Stepper …/>}`, so an item with
  `needs_time` or modifiers gets no visible control on the Home tiles.
- **Evidence**: of the six tiles, five report `hasStepper: true` and render a `+`; "Wake-up call" reports
  `hasStepper: false, btns: 1` and is just text — tappable, but with nothing to say so.

### [POLISH] A `needs_time` item says "Choose" and then offers nothing to choose
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:786` (label) vs the sheet it opens.
- **Evidence**: Wake-up call's sheet contained only `Wake-up call | × | Anything to add? | 1 | Add`. Nothing mentions
  a time; that only appears later, in the basket.

### [POLISH] "Cancel" on a live request is a single tap with no confirmation
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:645`. One tap moves the request to Cancelled immediately;
  the server correctly refuses it once staff have started (`lib/requests.ts:221`), but there is no undo and no prompt.

### [POLISH] The category rail loses your place when you leave and come back
- **Where**: `D:\Concierge\app\r\[token]\GuestApp.tsx:697` (`useState(categories[0]?.id ?? '')`) — `Catalog` unmounts
  on tab change, so the selection resets to the first category every time.

---

## Verified working

- **Code gate**: letters stripped on input; Continue stays disabled at 0 and 3 digits; wrong code → "That code is not
  right." with `role="alert"`; the 4th wrong attempt → **"That is not right. One more attempt before this locks."**;
  the correct code signs in and resets `code_attempts` to 0 (verified in the DB). Lock never triggered.
- **Home**: greeting with the guest's first name and the title stripped; "Happening now" trackers with ref, age,
  price and the 4-step rail; ETA copy including the late state ("Taking longer than usual — we have flagged it");
  Cancel on a `new`/`ack` request works and moves it into "Earlier"; "Earlier" caps at 4 and labels
  Completed/Cancelled correctly.
- **Freeform box**: Send disabled while empty; a 1-character message is rejected with "Tell us a little more.";
  emoji round-trip correctly through to the DB (`🛎️ 🚿 needs towels please 😊`); 500 characters send and store.
- **Live updates**: SSE push works — `new → ack → in_progress` moved the rail and removed the Cancel button with no
  reload; `done` moved the card to "Earlier"; a staff chat message and a new folio total both arrived live.
- **Dining + Services**: all 8 dining and all 10 service categories render with the right item counts; both rails
  scroll horizontally (`scrollWidth` 1065 and 1669 vs `clientWidth` 672).
- **Stepper**: `+` → counter, caps at 20, decrements back to 0 and reverts to a `+`; the basket bar appears and
  disappears with it. 20× Ice Cream showed `₹3,600` (20 × ₹180).
- **Item sheet**: required group pre-selects its first option; `max: 1` behaves as a radio; price recalculates live
  (₹540 → ₹600 → ₹680) and multiplies by quantity (₹2,040 at 3, ₹13,600 at 20); quantity stepper disables at 1 and 20;
  the note field accepts text (`maxLength` 200) and survives into the basket line and the DB.
- **Basket bar and sheet**: correct count and total, "Nothing to pay" for free items; quantities editable in the
  sheet; removing the last line empties it and hides the bar; "Note for the team" reaches the DB; Escape and the
  backdrop close the sheet and restore `body.overflow`.
- **Submit**: splits by department — one basket produced three requests (fnb / housekeeping / front_desk) with the
  toast "Sent — 3 teams are on it"; a single-department basket said "Sent to the team"; the sheet closes, the basket
  clears and the app returns to Home. Prices and modifiers are re-resolved server-side.
- **Bill sheet**: opens from both the header chip and the Home card; empty state reads "Nothing has been charged to
  your room yet." with no settle button; with charges it itemises lines and a total (₹1,240); "Ask to settle this"
  switches to the "Someone is on their way" panel, sets `rooms.settle_requested_at` and raises a front-desk request
  reading "Would like to settle the room bill — ₹1,240".
- **Chat**: send works and clears the draft; Send is disabled while empty; the rate limit is exact — messages 1–15
  went through and the 16th returned "Please wait a moment before sending more."; a staff reply renders on the left
  with the sender's name and a timestamp; rapid double-submits are blocked by the `busy` guard.
- **Hotel tab**: all 7 accordions open and close, `aria-expanded` tracks correctly, opening one closes the other,
  and re-tapping the open one closes it.
- **Responsive**: no horizontal scroll at 375x812 or 768x1024 with ordinary content; the header is exactly the 57px
  the category rail's `top-[57px]` assumes; `main`'s `pb-40` clears both the nav and the basket bar (last Home
  element cleared the nav by 102px, last catalog row by 38px above the basket bar and still hit-testable); the item
  sheet fits within `max-h-[88dvh]` at mobile and its Add button is above the nav and hit-testable.
- **Focus**: there is a global visible focus ring — `:focus-visible { outline: 2px solid var(--brand) }` in
  `app/globals.css:130`. Catalog steppers, the sheet close button and the sheet quantity buttons all carry
  aria-labels; the nav uses `aria-current="page"`.

## Not testable in this environment

- **Unavailable items**: every row in the seeded catalog has `available = true`, so the "Unavailable" / 40%-opacity
  branch (`GuestApp.tsx:778`) was never exercised. Flipping one would have affected the other agents' rooms.
- **Modifier max-selection limit**: the only multi-select group ("Add-ons") has `max: 3` and exactly three options,
  so `inGroup.length >= group.max` (`GuestApp.tsx:904`) is unreachable with this data. Worth noting that when it is
  hit, the code returns the previous state silently — no message to say why the tap did nothing.
- **The 5-attempt code lockout** was deliberately not triggered (brief).

## Test data left behind in room 301

- `rooms.settle_requested_at` is set (from the "Ask to settle this" test) — the Home bill card and the bill sheet will
  keep showing the "on their way" copy until it is cleared.
- Two `folio_entries` totalling ₹1,240 ("Request #53", "Request #54"), posted by replicating `lib/board.ts`'s
  `postCharge` in SQL because the guest app cannot post charges itself.
- 16 guest chat messages (15 of them "rate limit test message N") and one staff reply, used for the rate-limit and
  unread-badge tests.
- Requests 51–62 in various states; all open ones were cancelled at the end. `code_attempts` is back to 0 and the
  room was never locked.
