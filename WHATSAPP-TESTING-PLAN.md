# WhatsApp escalation — testing plan

**Status: built and verified end to end on real WhatsApp, 2026-09-15.** On branch
`whatsapp-links`. What is proven, and what is not, is recorded in §7.

Verified against the live gateway: the escalation sweep delivered, a verified number
received a 42-character job link, an unverified number received the same words with no
link, the link opened the job list with no session, Accept and Mark done both wrote through
`setRequestStatus` with the correct actor in the audit log, and a completion notice reached
both numbers. Not yet exercised by a human on a real handset — see §7.

This is a throwaway-grade experiment with a real question behind it: **when a request is
late and nobody has the board open, does a WhatsApp message get it picked up?**
Everything below is chosen to answer that in a week without committing the product to
anything.

Meta's official Cloud API is the production answer and is not in scope here. What gets
built during this test has to survive that move, which is the constraint that shapes most
of the decisions below.

---

## The problem

`notifyNewRequest` and `sweepEscalations` in `lib/notify.ts` already decide *who* should
be told and *what* to say. Both end at `sendMessage(phone, body)`, which posts to
Twilio — and Twilio is unset, so today every escalation logs to the console and reaches
nobody. The escalation ladder has never delivered a message in anger; `WHATS-LEFT.md`
records that as untested.

So the gap is not the logic. It is the last inch: a transport, and something for the
recipient to *do* with the message other than go and find a laptop.

---

## Shape

```
guest request → Vercel (hconcierge.vercel.app) → Tailscale Funnel → laptop
                       ↑                                              │
                       │                                       OpenWA + Baileys
                 staff taps link                                      │
                       │                                              ↓
                  staff's phone ←────────── WhatsApp ────────── staff's phone
```

Two directions, and only the first needs any plumbing:

- **Outbound.** Vercel calls the gateway on the laptop to send a message. The laptop has
  no public address, so this goes through Tailscale Funnel.
- **Inbound.** There is none. Tapping the link is a plain HTTPS request from the staff
  member's phone to `hconcierge.vercel.app`, which is already public. WhatsApp is not in
  that path, the gateway never needs to receive a webhook, and no message-id bookkeeping
  exists.

That second point is why this plan is small. Dropping typed keyword replies ("yes",
"done") in favour of a link removes the entire inbound half: no webhook route, no shared
secret on it, no parser, and no guessing which of a person's open requests a bare "done"
referred to.

---

## Why a link and not keyword replies

| | Keywords | Link |
| --- | --- | --- |
| Which request? | Ambiguous with two open jobs. Needs a heuristic or a message-id table. | The page lists them; you pick. `?r=` highlights the one the message was about. |
| Who is this? | The sender's phone number — and `staff.phone` is free text, nullable, hand-typed, never verified. | The signed token is the authorisation, and §5 makes the number itself prove out first. The sender's number proves nothing and doesn't need to. |
| Ports to Cloud API? | Yes | Yes |
| Needs inbound webhooks | Yes | No |

Reply *buttons* were considered and rejected: flaky on unofficial gateways, and on the
Cloud API they need an approved interactive template. A link behaves identically on both.

---

## 1. Gateway — OpenWA on the laptop

The clone at `D:\OPENWA` is a WhatsApp HTTP gateway wrapping two engines:
whatsapp-web.js `1.34.7` (Puppeteer driving real WhatsApp Web) and Baileys `7.0.0-rc14`
(a direct websocket client, no browser).

**The session in use is running whatsapp-web.js, not Baileys** — it was already paired that
way, and switching engines means re-scanning the QR. That cost a real outage during setup:
stopping the gateway left its Chromium alive holding a lock on
`data/sessions/session-<name>`, and the session came back `failed` with *"The browser is
already running … use a different userDataDir or stop the running browser first"* until the
orphaned browser tree was killed by hand. A websocket client cannot fail that way. Treat the
recommendation below as still open.

**Use the Baileys engine** — `ENGINE_TYPE=baileys`. We send one line of text; a Chromium
process is ~400MB of extra failure surface for that, and `scripts/patch-wwebjs-*`, six
patch files against upstream breakage, is a fair summary of the whatsapp-web.js
maintenance tax. Flip the env var if Baileys ever lacks something we need.

Configuration, in `D:\OPENWA\.env`:

| | Value | Why |
| --- | --- | --- |
| `ENGINE_TYPE` | `baileys` | No Chromium. |
| `PORT` | `2785` | Default. |
| `API_MASTER_KEY` | 32+ random chars | The **only** thing between the internet and our WhatsApp session once Funnel is up. Boot refuses anything shorter or well-known. |
| `SERVE_DASHBOARD` | `false` | See §2. |
| `ENABLE_SWAGGER` | unset | The docs mount is not behind the API-key guard. |
| `NODE_ENV` | `production` | Keeps `VALIDATION_ERROR_DETAIL` off, so a rejected request doesn't reflect our payload shape back at the caller. |

Bring-up:

1. `npm install`, then start it.
2. Create a session — `POST /api/sessions` — and start it.
3. `GET /api/sessions/{id}/qr`, scan with **a throwaway SIM**. Never the hotel's number,
   never a personal one: unofficial clients get numbers banned, and that is the accepted
   cost of this test.
4. Keep the session id. It goes into a Vercel env var.

Sending is one call:

```
POST /api/sessions/{sessionId}/messages/send-text
X-API-Key: <API_MASTER_KEY>
{ "chatId": "919876543210@c.us", "text": "…", "linkPreview": false }
```

`linkPreview: false` is not cosmetic. On Baileys a preview is an opt-in *blocking outbound
fetch per URL in the text*, so leaving it on delays every message by a round trip to our
own site — and puts a fetcher on the staff member's job-list URL, which renders their
pending work. The page is read-only by design (§4) so nothing breaks, but there is no
reason to hand it out.

---

## 2. Exposure — Tailscale Funnel

> **Measured 2026-09-15: Funnel does not serve this tailnet, and the rest of this section
> is therefore aspirational.** Everything on the node is correct — the `funnel` and `https`
> capabilities are granted, `funnel-ports` allows 443/8443/10000, `CertDomains` lists the
> host, `tailscale cert` provisions a real certificate, the node is online and `netcheck`
> reports UDP up with DERP Bengaluru at 113ms. `tailscale funnel status` reports
> `Funnel on`. And yet nothing outside can connect: Vercel gets `ConnectTimeoutError` to
> both ingress addresses (103.84.155.153, 103.84.155.217) on every attempt, and an
> independent third-party proxy gets `522` after 20s. Both 443 and 8443 behave the same.
>
> **The trap that hid this for an hour:** on a machine running Tailscale, `curl` to the
> Funnel hostname connects in ~20ms and succeeds. That is the local client short-circuiting
> its own ingress IPs through the tunnel — it never touches the public path. A Funnel is
> only proven by a request from a machine that is *not* on the tailnet.
>
> Until Tailscale's side works, production cannot reach the gateway. Messages are sent from
> the laptop with `NEXT_PUBLIC_BASE_URL` pointed at production, so the links in them open
> the deployed app — which is enough to test the staff journey on a real handset, and is not
> enough to call the integration done.


Vercel has to reach port 2785 on the laptop. Tailscale is already installed, and the
pattern is already working in another project on this machine:
`D:\OSWAL HANDICRAFTS - ERP\Start-Oswal-ERP.bat` funnels its client port, checks whether
Funnel is already on before re-applying it, reads the public URL back out of
`tailscale funnel status`, and documents the Windows quoting trap — calling `tailscale`
by quoted absolute path breaks as soon as the output is piped, because `cmd` spawns a
child for the pipe and loses the quotes. Lift that block; change the port.

```
tailscale funnel --bg 2785
```

The resulting `https://<machine>.<tailnet>.ts.net` is stable across restarts, which is the
reason to prefer it over ngrok: it goes into a Vercel env var once and is never touched
again.

**Two things Funnel makes true, and both matter:**

- The gateway becomes reachable by anyone who finds the address. `API_MASTER_KEY` is the
  entire defence. Funnel is public by design — Tailscale's private-network encryption is
  not protecting this.
- The gateway serves its **control dashboard on the same port** — the screen where
  sessions are managed and the QR is scanned. Hence `SERVE_DASHBOARD=false` on the
  funneled instance. If the dashboard is wanted, run it separately and don't funnel it.
  Confirmed by measurement before the tunnel was opened: `/` answered **200** and
  `/api/docs` answered **200**, both with no API key, while `/api/sessions` answered 401.
  Swagger is not behind the key guard and publishes the schema and exact running version.
  `D:\OPENWA\.env` now sets `SERVE_DASHBOARD=false` and `ENABLE_SWAGGER=false`; both
  surfaces answer 404 through the Funnel, and the API still answers 401 without a key and
  200 with one.

Funnel only accepts public traffic on 443, 8443 and 10000. No Funnel config is currently
active on this machine, so all three are free; the Oswal launcher claims one when it next
runs.

---

## 3. Transport — one branch in `sendMessage`

`lib/notify.ts` `sendMessage(to, body)` is the only place any message leaves the app.
`sweepEscalations`, `notifyNewRequest`, the board poll and the pg_cron backstop all route
through it. So the transport change is a branch in that one function, ahead of the Twilio
block, taken when `OPENWA_URL` is set. No provider interface, no registry, no new file.

`staff.phone` is free text (`+91 98…`, sometimes with spaces), so it needs
`replace(/\D/g, '')` and a `@c.us` suffix. **Test-setup requirement:** every test phone
must be stored in full international form. A number saved as `98…` with no country code
goes to the wrong country silently.

Same error handling as the Twilio path — log and return `false`. `lib/requests.ts` already
calls this fire-and-forget on purpose: a gateway hiccup must not fail a guest's order.

New env vars: `OPENWA_URL`, `OPENWA_SESSION`, `OPENWA_KEY`, and `NOTIFY_ON_DONE=1` if
completion notices are wanted (§6).

**Team names come from a join, not a second query.** Teams became rows on `main`
(`departments`, unique on `organisation_id, slug`), so a hotel can rename a team or add one.
`departmentLabel` humanises an unknown slug — "Spa wellness" — which is not wrong but is not
what anybody typed. All three message queries left-join `departments` for the real name and
fall back to `departmentLabel`. A join rather than `teamLabels()` because this is the
escalation path and round trips are the cost this project is explicitly avoiding; the join
rides an index it already has and adds none.

**`NEXT_PUBLIC_BASE_URL` is the one setting that decides whether a link works at all.**
`baseUrl()` in `lib/qr.ts` prefers it over the live request host, so a stale value silently
sends every staff member a link to the wrong origin. This cost a test run: the value copied
from the local `.env.local` was `http://localhost:3000`, and the first real escalation
delivered a link to a port that was not serving this code. On Vercel it must be the public
origin, or unset so the request host is used. Nothing errors when it is wrong — the message
arrives looking perfectly correct and the link just goes nowhere.

---

## 4. One link — a person's job list, not a per-action button

**Every message carries exactly one link, and it is the same link every time: that staff
member's own pending-jobs page.** Accept, done, everything happens there. No per-action
links.

The earlier draft of this plan sent three links per message — accept, done, my jobs. That
was worse on every axis, and the reason is worth recording so nobody reinvents it: a link
lands on a *page*, not on a state change (see below), so tapping `Accept` in the chat
already cost two taps. The per-action links were paying three long URLs per message, three
tokens per send, and a whole class of stale-link problems to pre-select a row.

What the single link removes outright:

- **Staleness.** The link means "whatever is pending for me, now". A message tapped forty
  minutes late lands on current state by construction. There is no stale-link case left to
  design for.
- **Per-send work.** The token has no request in it, so it is *the same URL all shift*.
  Mint it once per recipient, not three times per escalation.
- **GET-that-mutates.** The link is read-only by definition. A link previewer or security
  scanner following it cannot change anything; the writes are POSTs from the page.

### The token

The signing scheme already exists. `lib/guest-session.ts` has `sign`/`read`: base64url
payload, HMAC-SHA256, `timingSafeEqual` on compare, `exp` inside the payload. This is
those two functions over a smaller payload.

Pack it as bytes, not JSON — the JSON version of even this short payload is ~100 bytes of
text and lands a 170-character token that wraps over three lines and reads like phishing.

```
1  byte   version + type
16 bytes  staff id            — 2 bytes if a short staff ref is ever added
4  bytes  expiry, unix seconds
10 bytes  truncated HMAC-SHA256 over the above
```

31 bytes → a **42-character token**; 23 characters if a `staff.ref smallint` is ever added.
Reuse `SESSION_SECRET`.

Two details that are load-bearing:

- **The version byte is the type tag.** A guest grant is `{ rid, cin, exp }` signed with
  the same key. Without an explicit type the two token families verify against each other
  and safety rests on which fields happen to be undefined.
- **A truncated MAC is fine here.** 43 base64 characters of HMAC guard a capability that
  expires within a shift. Truncation is specified behaviour for HMAC; keep at least 80
  bits, reject invalid tokens in constant time, and rate-limit `/w/` so 2^80 stays
  theoretical.

Expiry: end of shift, twelve hours at the outside. Note that this token is broader than a
per-request one — it grants the whole job list rather than one job — which is a reason to
keep `exp` tight, and a reason §5 matters more rather than less.

**Deep-link without a second token:** append the request as a plain query — `/w/<token>?r=1341`
— and let the page scroll to and highlight that row. It needs no signature, because it only
chooses what to emphasise; the token is what grants authority. Free, and it puts back the
one thing per-action links were actually good at.

**Not doing:** a `links` table of short random ids. It reaches ~6 characters and costs a
table, a sweeper for expired rows, and a database write on the send path — and this
project's own notes are explicit that round trips are its dominant cost and speed has to
come from making fewer of them. Public URL shorteners are worse again: an external
dependency in the escalation path, and bit.ly-style links get flagged inside WhatsApp.

**Worth buying separately:** a short custom domain. `hconcierge.vercel.app` is 21 of the
characters in every link, and a `*.vercel.app` URL arriving from an unknown number reads
as phishing to exactly the person who needs to trust it. `baseUrl()` in `lib/qr.ts` already
prefers `NEXT_PUBLIC_BASE_URL`, so that is configuration, not code. With a short host the
whole link is ~33 characters.

### The page — `app/w/[token]/page.tsx`

One route, one file. It renders that person's open requests via
`loadBoard(staff, propertyId)`, which exists, with Accept and Done on each row. The `Staff`
object is loaded by id from the token — no session cookie, no login, which is the entire
point on a shared handset.

Each button POSTs to `setRequestStatus(staff, requestId, next)` from `lib/board.ts`,
unchanged. It already enforces the property check, the department check and the legal
transition table, posts the folio charge on `done`, and writes the audit row.

Rows show current status, so a job someone else already took reads honestly — "in progress,
Ravi" — rather than offering a button that silently does nothing.

Replay is safe by construction, which is worth knowing so we don't over-build:
`setRequestStatus` returns `ok` early when the status already matches, `NEXT_STATUS` never
moves a request backwards out of `done`, and `postCharge` is idempotent. The residual risk
is someone else in that chat opening the page and acting — a wrong name in the audit log,
bounded by `exp` and by §5.

**Emphasis follows the expected next step.** `done` is irreversible — `NEXT_STATUS` has no
exit from it — and it posts the folio charge. So while a job is still new the wide primary
button is Accept and Done is the small quiet one; Mark done only becomes primary once the
job has been accepted, which is when it is genuinely the obvious action. Two adjacent
primary buttons on a 375px screen is a mis-tap that cannot be undone, and that mis-tap
happened during the first test run rather than in a hotel, which is the only reason it is
written down here instead of in a complaint.

**Revocation lives in the row, not the token.** The token is only a pointer; the page
re-reads the `staff` row on every render, so it must require `active` *and*
`phone_verified_at is not null` there. That gives instant revocation without any token
state: deactivating someone kills their link on the next tap, and because the §5 trigger
clears verification whenever the number changes, editing a phone kills the old link too.
Fail closed — the cost of being wrong is one extra message carrying a fresh link, and the
cost of failing open is a live capability sitting in a chat nobody controls any more.

---

## 5. Phone verification — a number earns links by proving itself

**Why this is not optional.** Signed links moved the identity problem; they did not remove
it. Before, `staff.phone` being wrong meant a missed message. Now the link *is* the
credential, so one mistyped digit in `StaffManager` hands a working accept/done button for
a real request to a stranger's WhatsApp. That number is typed by hand by an admin and
nothing has ever checked it. Verification is the layer that turns "we sent a capability to
this handset" from something an admin asserted into something someone proved.

### Schema

On `staff`, all `add column if not exists` in the house style:

| Column | |
| --- | --- |
| `phone_verified_at` | timestamptz. Null means unverified. The gate. |
| `phone_code` | text, the 6-digit code awaiting entry |
| `phone_code_expires` | timestamptz, 10 minutes out |
| `phone_code_sent_at` | timestamptz, throttles re-sends |
| `phone_code_attempts` | int not null default 0 |
| `phone_code_locked_until` | timestamptz |

Plus a trigger: `before update on staff when (old.phone is distinct from new.phone)` →
null `phone_verified_at` and clear the code columns. A trigger rather than a line in
`updateStaff`, because `updateStaff` is not the only writer — `createStaff`, `db/seed.mjs`
and a hand-run `update` all change phones, and a verification flag that survives a number
change is worse than no flag at all. One guard where every path already converges.

### The flow

1. An admin saves a number in `StaffManager`. It is unverified; nothing has changed about
   how the form works.
2. The app sends that number a **plain WhatsApp with no links**: a 6-digit code, the
   property name, and one line saying to ignore it if unexpected.
3. The staff member signs in to the board **once** — they already have a username and
   password — and enters the code.
4. From then on, messages to that number carry action links.

**The code is typed into an authenticated session, not tapped from the message.** A
tap-to-confirm link would only prove that *somebody* received the message: if the admin
mistyped the number, the stranger who got it taps out of curiosity and is now "verified",
which is precisely the hole this section exists to close. Requiring entry inside a signed-
in session proves control of the staff account and of the handset in one step — which is
exactly the claim every later action link depends on.

Step 3 also costs nothing against the premise of this experiment. Staff not opening the
app is the *daily* reality; a one-time setup at the desk with a manager standing there is
not that.

### Reuse, don't invent

`submitRoomCode` in `lib/guest-session.ts` is already this function for guests, and it has
had the edge cases beaten out of it. Copy its shape:

- Read the row and clear an **expired** lock in a single statement. Its comment records
  why: otherwise the count stays at the maximum, the next typo re-locks for another
  fifteen minutes, and the person can never get in again.
- `timingSafeEqual`, so a response cannot narrow the code digit by digit.
- Five attempts, fifteen-minute lock — the same `MAX_ATTEMPTS` / `LOCK_MINUTES` constants.
- Audit both ends: `staff.phone_verified` and `staff.phone_code_locked`.

`generateAccessCode()` next door is the 4-digit version; a 6-digit sibling is one line.

**Throttle the send as well as the entry.** Refuse a new code while the current one is
under 60 seconds old. Without that, "resend" is a button for spraying a stranger's
WhatsApp — and on an unofficial gateway that is also the fastest way to get the throwaway
number banned, which ends the whole test.

### Unverified degrades to text, it does not go silent

An unverified number still receives the escalation — room, item, minutes late — with no
tappable links and a line saying to open the board. It does **not** get skipped.

This is the same shape `PRODUCT.md` already commits to for Twilio being unset: escalation
degrades to in-app rather than disappearing. Dropping the message instead would mean a
late request reaching nobody because of a settings flag, which is an invisible failure of
exactly the kind this feature exists to prevent.

`StaffManager` shows **verified / pending** beside the number, with a resend action.
Without that, nobody can tell why one person gets tappable alerts and another doesn't.

---

## 6. Message shape

**Both message types carry the same one link**, because the link is per-person and not
per-request. `notifyNewRequest` and `sweepEscalations` in `lib/notify.ts` already share
`sendMessage`, so they share this too — nothing about escalation needs its own transport,
its own link scheme or its own page.

New request, to the department:

```
Room 402 — towels (#1341)
hconcierge.vercel.app/w/kQ3f…?r=1341
```

Escalation, to whoever the rung names:

```
LATE · Room 402 — towels (#1341)
18 min old, past its 15 min target, still unaccepted.
hconcierge.vercel.app/w/nR2x…?r=1341
```

Unverified number — same information, nothing tappable (§5):

```
LATE · Room 402 — towels (#1341)
18 min old, past its 15 min target, still unaccepted.
Open the board to accept. (This number is not verified for
one-tap actions — ask your manager.)
```

**The page is right for both audiences with no extra work.** `loadBoard` scopes by
property *and* by department according to role, and orders new → ack → in progress. A
housekeeper's link opens housekeeping's late jobs; a duty manager escalated to on rung two
opens the whole property's, which is exactly what someone being escalated to needs to see.
That is existing behaviour, not something this plan adds.

Completion, to the same people — `NOTIFY_ON_DONE=1`, off by default:

```
HConcierge: Room 402 — towels (#1341) is done, by Ravi. ₹0 to the room folio.
```

**The completion notice carries no link.** There is nothing left to act on, and a link here
would invite a tap onto a list this request has already left — the stale-picture problem the
single live link exists to avoid. It names who closed it and what it cost, which is what
makes it checkable at the desk.

**Deliberately no pending-jobs list in the message body.** WhatsApp messages are immutable
in practice, so every action would append a *new* list, and by mid-shift the chat holds a
dozen lists that disagree with each other. Someone scrolls up, reads one from forty minutes
ago, and taps against a picture that is no longer true. `PRODUCT.md` rules this out by
name: nothing may present stale data as live. The link *is* that list, in the one place it
cannot go stale.

Keep the message itself to two or three lines. The room and the item are what makes someone
decide to tap; everything else is on the page.

---

## 7. What was run, and what is still untested

Verified on 2026-09-15 against the live gateway and the dev database:

| | |
| --- | --- |
| Escalation delivered | `sweepEscalations` fired rung 2 and the message arrived. This was the path `WHATS-LEFT.md` recorded as never having delivered anything. |
| Verified number gets a link | 42-character token, correct origin, `?r=` pointing at the right row. |
| Unverified number degrades | Same words, no link, explicit reason. Not skipped. |
| Link opens with no session | Job list rendered for the right person and property, late job in red. |
| Accept writes through | One submit → `ack`, assignee set, `request.ack` filed against the right name. |
| Mark done writes through | `done`, `completed_at` set, `request.done` filed. |
| Completion notice | Reached both test numbers with who closed it. |
| Token tests | `npm test` — forgery, tampering, expiry, junk input, wrong token family. Seven cases in `lib/staff-link.test.ts`, all negative but one. |
| 375px | Checked at 375×812; buttons meet the 44px touch target. |
| Verification round trip | A person signed in, asked for a code, received it on a real handset and typed it back: `staff.phone_code_sent` 08:57:56 → `staff.phone_verified` 08:58:49. That number then received a link instead of the text-only fallback, with its own distinct token. |
| A hotel's own team name | A request on the custom `spa_wellness` team read "Spa & wellness" — the name the hotel typed — rather than the humanised "Spa wellness". |

Still untested, and each needs a human or a deploy:

1. **Working a job from the handset.** The verification round trip was done on a real phone,
   but every Accept and Mark done so far was driven against localhost from this machine.
   Nobody has received a job alert on a phone, tapped through and finished the work.
2. **Tailscale Funnel and Vercel.** Everything above ran with the gateway and the app both
   on localhost, so the gateway was reached directly. The Funnel hop in §2 has not been
   opened, and no message has been sent from a deployed build.
4. **The lock and throttle paths.** Five wrong codes, the fifteen-minute lock, and the
   sixty-second resend refusal are written and typechecked but never tripped.
4. **Expiry in the wild.** A token past `exp` renders the expired page in principle; no
   token has actually aged out.

## Not building, on purpose

- **Inbound message handling.** The link removed the need. If WhatsApp replies are ever
  wanted, that is a webhook, a shared secret on it, and the which-request problem back
  again.
- **Reply buttons.** Flaky unofficially, template-gated officially.
- **Per-action links.** Cut deliberately, see §4. One link per person, all actions on the
  page.
- **A phone-number uniqueness constraint on `staff`.** Two people sharing a verified
  handset each still get their own token, and `loadBoard` scopes each to their own role —
  so a shared number means seeing both lists, not a privilege leak. Add the constraint if
  the sender's number ever becomes a credential; with links it never does.
- **A message log or outbox table.** Fire-and-forget matches the existing Twilio path. Add
  one when a missed message needs to be *provable* — a production concern, not a test one.
- **Single-use or revocable tokens.** Would need state. Replay is already harmless, `exp`
  bounds the window, and the `active` / `phone_verified_at` re-read in §4 covers real
  revocation.
- **Anything to survive the laptop sleeping.** It's a test machine that stays up. Worth
  being explicit that this is the one assumption that does not survive contact with
  production: when the laptop is down the app keeps working perfectly and escalation
  messages silently stop. That failure is invisible, which is why the gateway moves to an
  always-on host the moment this stops being an experiment.

---

## What changes for Meta's Cloud API

Small, and that is the point of §3 and §4.

- `sendMessage` gets a different branch. Nothing else in the app knows what delivered a
  message.
- Escalation text becomes an approved template — the room, the item, the minutes and the
  link as filled-in variables. The message is already that sentence with values swapped in,
  so the wording ports; and a single-link message is a far easier template to get approved
  than one carrying three.
- The link, the `/w/[token]` route, the signing scheme, the §5 verification flow and
  `setRequestStatus` are all transport-agnostic and don't change at all.

What this test therefore does *not* tell us: anything about template approval, opt-in, or
the 24-hour window. Code that works against an unofficial gateway can still be refused by
the Cloud API. What it does tell us is whether staff tap the links — which is the only
question worth spending a week on before paying for the official path.
