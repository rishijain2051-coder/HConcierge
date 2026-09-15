# What's left

Written 14 September 2026 and updated 15 September 2026. The first session added
bill viewing and settling, live order tracking, in-place quantity steppers and a
speed pass, and ran four testing agents over the whole app. The second made the
staff screens work at 375px, audited them, and ran a polish pass — see §8.

Everything the testing pass classified as **blocker** or **major** is fixed.
What follows is what it found and I did not fix, what I decided deliberately,
what was never tested, and what you need to do outside the code.

Full reports with reproductions: [`docs/qa-2026-09-14/`](docs/qa-2026-09-14/).

---

## 1. Do this before the next deploy

**Rotate the Supabase database password.** It was pasted into a chat transcript
early in the project's life. It lives only in `.env.local`, which is gitignored,
and it has never been committed — but it is in a transcript, and it has not been
rotated. This is the one item on this page with a real blast radius.

**Check the Vercel region actually took.** `vercel.json` asks for `bom1`. On
Hobby, multi-region is not available and the setting may be ignored — confirm
in the Vercel dashboard under Project → Settings → Functions that the region is
Mumbai. Left at the default, functions run in Washington while the database is
in Mumbai: a ~230ms round trip, and a page that makes five of them spends over
a second on network alone. This is the largest single performance factor in the
project and it cannot be verified from a development machine.

**Restart any running server.** A `next start` process left over from this
session is serving a stale build. The code on disk is current; the process is
not.

**Run `npm run db:push`.** The schema gained settlement columns, five NOTIFY
triggers, and two constraint fixes. It is idempotent.

---

## 2. Open findings, none severe

Severity is the testing pass's own. File references are to current `main`.

### Guest app

| | Where | What |
|---|---|---|
| POLISH | `app/r/[token]/GuestApp.tsx` `QuickTile` | An item with modifiers or `needs_time` gets no visible control on the Home tiles — "Wake-up call" is just text. Tappable, with nothing to say so. |
| POLISH | `app/r/[token]/GuestApp.tsx` `ItemRow` | A `needs_time` item's button says "Choose", and the sheet it opens offers nothing to choose. The time is asked for later, in the basket. Either label it "Add" or move the time picker into the sheet. |
| POLISH | `app/r/[token]/GuestApp.tsx` `OrderTracker` | Cancel is one tap with no confirmation and no undo. The server correctly refuses once staff have started, but a mis-tap before that is silently destructive. |
| POLISH | `app/r/[token]/GuestApp.tsx` `Catalog` | The category rail resets to the first category every time you leave the tab and come back — `Catalog` unmounts on tab change. Lift `active` to `GuestApp` if this annoys anyone. |
| POLISH | `app/r/[token]/GuestApp.tsx` `ItemSheet.toggle` | When a multi-select group is at its maximum, tapping a fourth option returns the previous state silently. Nothing says why the tap did nothing. |

### Staff screens

| | Where | What |
|---|---|---|
| POLISH | `app/staff/(app)/board/Board.tsx` (assignee tag) | The card shows `assigned_name.split(' ')[0]`, so two people whose names start with the same word are indistinguishable without opening the drawer. |

### Admin panel

| | Where | What |
|---|---|---|
| MINOR | `lib/admin.ts` `listAudit` (`limit 300`) | "Showing the most recent 300 — narrow the period to see further back" is advice that cannot work: narrowing only ever removes older rows. Needs paging or a date-range filter, not a period. |
| MINOR | `lib/admin.ts` `createStaff` / `saveInfoPage` | Over-length usernames are silently truncated to 60 rather than refused; `...` is a legal username; a hotel-info slug typed by hand is stored verbatim (spaces, capitals) while a generated one is sanitised; a section icon accepts a whole string although the hint says one character. Property slugs *are* properly validated — copy that treatment across. |
| POLISH | `lib/admin.ts` `createStaff` | "That username is taken" is returned for a username held by a different customer, which confirms an account exists in another tenant. Usernames are global, so this is hard to remove entirely — but the message could be less certain. |
| POLISH | `lib/admin.ts` (audit calls) + `lib/scope.ts` | Creating an admin is filed with `property_id = null`, and every organisation-scoped view filters on `property_id`, so the single most auditable event in the panel is invisible to the organisation it happened in. Same for `organisation.created`. Fix by scoping the audit view on `organisation_id` as well. |
| POLISH | directory sections | Two sections can carry the same name in one property's directory. |

### API and data

| | Where | What |
|---|---|---|
| MINOR | `lib/requests.ts` (`i.id = any(${ids})`, `id = ${requestId}`) | A malformed uuid from a client throws `22P02` and surfaces as a 500. `lib/scope.ts` and the rooms page now guard this with `isUuid`; the two request paths do not. No injection and no leak — values are parameterised — but it is an uncaught throw any client can trigger, and it fills the log with stack traces. |
| POLISH | `app/api/staff/folio.csv/route.ts` | The export window is built from the app server's clock and compared against `created_at`, written by Postgres `now()`. Measured skew here was 291ms, and a charge posted immediately before an export was missed from it. Build the window in SQL. |
| POLISH | `db/schema.sql` (rooms comment) | The comment says the QR token is "rotated at checkout so a previous guest's photo of the QR stops working". It is not — `checkOut` leaves `token` untouched. No live exposure, because the 4-digit code is the real gate and that *is* cleared. But a comment describing a defence that does not exist is how a later change ends up relying on it. Either implement it or delete the sentence. |

---

## 3. Decisions that look like bugs

Leave these alone unless the reasoning changes.

**Prepared statements are off, on purpose.** `prepare: true` measures a clean
2.0x on every query — one statement in a loop, hundreds of executions, no
errors. Then a realistic mix (a dozen different statements, concurrently, over a
pool) fails within seconds:

```
PostgresError: prepared statement "iszaizk1v24" does not exist
```

Supabase's transaction pooler hands the connection a backend that has never
seen the statement. The comment in `lib/db.ts` carries this. Speed has to come
from making fewer round trips, not cheaper ones.

**Server-sent events, not websockets.** The hosting is serverless — there is no
long-lived process to hold a socket. SSE is a real push channel, `EventSource`
reconnects by itself, and streams close after four minutes so a function billed
by the second is not held open all night.

**The listener connects to port 5432, not 6543.** `LISTEN` is silently dropped
by the transaction pooler — no error, nothing ever arrives. `lib/realtime.ts`
uses the session pooler. Override with `DATABASE_URL_SESSION` if the endpoint
moves.

**The board still polls, once a minute.** That poll is what runs the escalation
sweep. Escalation is the one thing that cannot be pushed: nothing changes in the
database when a request merely gets older.

**Streams drop when the tab is hidden.** A phone in a pocket should cost
nothing. They reopen on focus and on every safety poll.

---

## 4. Not tested

- **768px.** The staff screens were walked at 375px and 1440px on 15 September.
  The tablet middle — a reception iPad in portrait — is still unseen, and it is
  the width where the board's single column is at its least convincing.
- **An unavailable item.** No row in the seed has `available = false`, so the
  guest app's unavailable branch has never been exercised.
- **A modifier group at its maximum.** The only multi-select group has `max: 3`
  and exactly three options, so the limit is unreachable with this data.
- **Multi-property anything.** The one organisation owns one property, so the
  property pickers, the board's property filter, and "copy catalogue from"
  are only lightly covered.
- **Twilio delivery.** Escalation subscriptions were verified; no message was
  ever actually sent.
- **Real devices.** Everything was an emulated viewport.

---

## 5. State of the database as of this session

- One organisation (RN Hospitality), one property (RN Grand, Pune), 113 items,
  7 info pages, 2 escalation rungs.
- Two staff: `rn.admin` (admin) and `hc.ops` (platform). `hc.ops` was reset on
  15 September with `npm run db:platform` to get into the staff screens, and
  both passwords have since been typed into a chat transcript. They are trial
  credentials on a demo database, but rotate them before this is in front of
  anyone: `npm run db:platform` for the platform account, Manage → Staff →
  Reset password for `rn.admin`.
- Room 401 is checked in to **Naman**. That is not test data of mine, so I left
  it. Three QA requests were created against it on 15 September to exercise the
  three SLA states and the live push, and all three were deleted afterwards.
- Every QA fixture — three test accounts, three checked-in rooms, a throwaway
  second tenant, and all the requests, messages and charges they created — has
  been removed.
- **One thing was lost.** While cleaning up, the agent testing the admin panel
  deleted the property's pre-existing 0-minute escalation rung along with its
  own, and re-created it from how it read on screen. If that rung originally
  named an individual rather than the duty managers, that naming is gone.
  Worth a glance at Manage → Escalation.

---

## 6. From the distill pass

`PRODUCT.md` now exists and is the product record: users, purpose, positioning,
constraints, and — most importantly — an **Evidence on Hand** section that says
plainly that RN Hospitality has not committed and that every row in the database
is invented. Read that section before writing a word of marketing copy.

Two things the distill pass could not do, both because the preview and browser
tools were blocked for that session:

- **No visual inspection round.** The cuts were verified at the source level and
  with a clean build, type-check, lint and design-detector run. The *staff*
  screens have since been walked in a browser (§8); the **distilled guest app
  still has not been looked at** at 375px or 1600px. That is the first thing to
  do next session.
- **The double-bezel reversal is unreviewed.** Commit `88738ac` removed the
  tray-and-plate surface that `/high-end-visual-design` had introduced. It is a
  deliberate call — nested cards are the thing distill removes first — but it
  reverses an earlier explicit instruction, so it deserves a look before it
  settles. Reverting that one commit restores the previous look.

No `.impeccable/config.json` was written: this harness has no image generation,
so there is no comp-first/code-first choice to record and code-first is the only
path available.

---

## 7. Session conveniences you may want to remove

- `.claude/launch.json` gained an `hconcierge-prod` entry (`next start` on
  3100). It is there so production timings can be measured against the dev
  server without stopping it. Harmless; delete it if it is clutter.

---

## 8. From the mobile and audit pass, 15 September

Commit `c228f71`. The staff screens were walked in a browser at 375px and
1440px, signed in as `rn.admin`, with three seeded requests covering the on
time, amber and overdue states. The live push, the escalation sweep, the
drawer, the thread view and the room list were all seen working.

Fixed and verified: the app no longer scrolls sideways on a phone; touch
targets clear 44px; the room access code is readable on a phone; alerts no
longer restart the live stream; reissuing a QR asks first; the board card
announces itself to a screen reader; `npm run lint` is green.

Still open from this pass:

| | Where | What |
|---|---|---|
| POLISH | `app/staff/(app)/rooms/Rooms.tsx` | Twenty-two rooms at ~75px a row is a long scroll on a phone to reach 415, and the front desk mostly wants the occupied ones. A room filter, or occupied-first ordering on narrow screens, would earn its keep. Not done because it changes desktop scanning order too. |
| POLISH | `app/staff/(app)/board/Board.tsx` `Card` | The 6px coloured left stripe is the pattern the craft floor refuses. It is kept deliberately: it is the only thing that separates on-time from amber at a glance across a lobby, which is what principle 2 asks for. Revisit only if the card surface starts carrying that state instead. |
| POLISH | `app/staff/(app)/board/Board.tsx` toolbar | At 375px the overdue count and the alerts button wrap to their own right-aligned line once the Requests tab carries a number. Ragged, not broken. |
| MINOR | `lib/admin.ts`, `lib/guest.ts` | The `icon` column is now written by nothing and read by nothing. The two admin fields were removed and existing values ride along untouched on save. Drop the column when the schema is next migrated. |

Three `react-hooks/set-state-in-effect` errors that §2 used to list are gone.
Two were restructured — the chat poll also stopped letting the previous room's
reply land in the open thread — and one, the sign-in clock, carries a documented
`eslint-disable` because a clock has to start empty on the server.
