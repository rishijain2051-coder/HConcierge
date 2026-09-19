# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Guests, in the room, on their own phone.** They arrive with no app installed and
no account. They scan a printed card on the desk, type the four digits the front
desk gave them at check-in, and are in for the rest of the stay. They are often
tired, sometimes at 2am, and their alternative is dialling reception — which is
the behaviour this product exists to replace.

**Hotel staff, across two device classes that are both primary.** Reception works
a monitor that is on all day in a lit lobby, glanced at across a desk and driven
with a mouse. Housekeeping, the kitchen and maintenance carry the same board in a
pocket. Neither is secondary: every board decision has to hold at 375px and at
1600px.

**A hotel group's admin.** One or two people per customer who set up the property
once — rooms, directory, staff, target times, escalation — and then rarely return.

**HConcierge itself**, a platform account that onboards customers and manages
their properties without ever seeing a guest's live traffic.

## Product Purpose

Remove the telephone call from a hotel room to reception.

A guest asks for a towel, a biryani, a late checkout or the bill from the phone
already in their hand. Every request routes to the team that actually performs it,
carries its own promised time, and escalates itself when that time is missed.

Success is the switchboard going quiet. If a change makes a guest more likely to
pick up the room phone, it has failed regardless of what else it improved.

## Positioning

A phone call leaves no trace. It has no owner, no clock and no record that it
happened at all.

Every request here is routed by department, timed against its own target, and
escalated up a per-property ladder when it runs late — without anyone watching a
screen, because the escalation sweep runs on a schedule as well as on the board.
That accountability, not the ordering interface, is the part a neighbouring
product cannot truthfully claim by adding a menu to a QR code.

## Operating Context

- **The card is permanent; the code is not.** One printed QR per room, on the desk,
  printed once. The four-digit access code changes with each guest, so a
  photographed QR from a previous stay opens nothing. Checking out invalidates
  every device that stay used.
- **Requests fan out by department.** One basket becomes one request per team: the
  kitchen never sees a towel, housekeeping never waits on a biryani. The promised
  time is the slowest item's, because the request is only done when the whole tray
  arrives.
- **Lateness is a per-property ladder**, configured by the hotel: how long after the
  target, who is told, and whether it only counts when nobody has picked it up.
- **Money accrues to a room folio in integer paise** and is settled at the desk. The
  front office exports a CSV until a real PMS integration exists.
- **Guests and staff run on hotel wifi**, which drops. Nothing may present stale data
  as live.

## Capabilities and Constraints

- **No payment is taken in the app, and none ever will be.** A guest can read an
  itemised bill and ask to settle it, which puts the room and its balance on the
  front desk's board. HConcierge asks for a card number nowhere.
- **Multi-tenancy is first-class.** Organisations own properties, which own rooms.
  Four roles: `platform` > `admin` > `manager` > `staff`. Nothing may assume a
  single hotel. RN Hospitality is customer one, not the only customer.
- **Hosting is serverless**, so live updates are server-sent events over an HTTP
  push channel, not websockets — there is no long-lived process to hold a socket.
- **The database is Supabase Postgres behind a transaction pooler.** Prepared
  statements fail on it under a realistic mix; `LISTEN` is silently dropped and
  needs the session pooler. Both are load-bearing constraints, recorded with
  their reproductions in `lib/db.ts` and `lib/realtime.ts`.
- **The database is in ap-south-1**, so page cost is the number of round trips a
  page makes, not the work inside them.
- **Scheduled escalation runs on Supabase pg_cron**, because the deployment target
  permits one cron run per day.
- **Twilio is optional.** Escalation degrades to in-app only when it is unset.
- **Nothing in the product calls a language model.** The AI Concierge is a
  decision tree read from the hotel's own directory — no model, no inference,
  no provider, no key, no bill. It cannot quote a price the kitchen did not
  set, promise a service the property does not run, or need anybody to review
  what it said to a guest at 3am.
- **Promotions describe, they do not discount.** An offer is shown to the guest
  and, when taken up, lands on the board as a request naming it. Since the app
  never settles a bill, it must never reduce one either: the desk honours the
  offer at checkout exactly as it would a paper voucher.
- **Undecided:** whether the guest app ever needs a language other than English;
  whether a formal accessibility standard will be required by a buyer.

## Brand Commitments

The product is named **HConcierge**. **RN Hospitality** — specifically RN Grand,
Pune — is the named prospect the current build is dressed for.

The guest-facing assistant is the **AI Concierge**, and in this product **AI**
stands for **Automatically Intelligent**: a concierge assembled automatically
from the hotel's own directory, which answers only with what that hotel
actually offers. It is not artificial intelligence and there is no model behind
it. `app/r/[token]/Concierge.tsx` opens by pointing back here and by describing
the mechanism, so nobody maintaining it is misled — and so the expansion itself
lives in exactly one place.

**The expansion belongs in this document and nowhere else.** It must not appear
anywhere in the live app: a guest sees "AI Concierge" and only that. A screen
that stops to explain its own name has raised the question it was answering.

## Evidence on Hand

**RN Hospitality has not committed. Nothing in this repository is their data.**

Every row in the database — the 22 rooms, the 113 directory items, their prices
and target times, the 7 hotel-info pages, the property name and address — is a
plausible invention made to demonstrate the product. It is a pitch, not a
deployment.

Future work must not claim, imply or design around:

- a live installation, a running pilot, or guests currently using it;
- RN Hospitality as a customer, a reference or a logo;
- any measured result — call volume reduced, response times improved, revenue
  lifted — because none has been measured;
- testimonials, case studies, press or named staff.

What is genuinely on hand is the working system itself, which is the pitch: a
real two-sided demo on the marketing page (`app/DemoStage.tsx`, driven by
`lib/demo-data.ts`), and an app a hotelier can be walked through end to end.

## Product Principles

1. **The phone is the thing being replaced.** Any change that makes a guest more
   likely to dial reception is a regression, whatever else it improves.
2. **A late request announces itself.** Accountability is the whole difference
   from a phone call, and it cannot depend on anyone watching a screen.
3. **Money accrues; it is never taken.** The bill is readable from the room and
   settled by a person at the desk.
4. **Customer one is not the only customer.** Multi-tenancy is a working
   requirement today, not a future migration.
5. **Both device classes are primary.** A reception monitor and a housekeeper's
   phone are the same product, and neither is the responsive afterthought.

## Accessibility & Inclusion

No formal standard has been required by a buyer, and none is claimed. The floor
is held anyway, because the guest audience includes elderly, tired and
unfamiliar users at unsociable hours: real contrast on every surface, labelled
controls, keyboard reach, visible focus, and honoured reduced-motion.

The guest app is **English only, deliberately and for now**. Guest-facing strings
sit in components ready to lift, and the directory is data rather than hardcoded
copy, so neither decision is load-bearing — but no translation machinery should
be built on a guess.
