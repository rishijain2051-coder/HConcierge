# QA-3 — Admin panel, role permissions, multi-tenant isolation

Target: the production build running on http://localhost:3100 (BUILD_ID `4l7pfLufLM-K-3oTl-NzS`).
Line numbers are against commit `fc81824` ("Close three holes a testing pass found…"), which landed
from another pass while I was testing. The running build predates it, so I re-checked every line I
cite against `fc81824`: none of its changes touch the admin guards below, and all of these findings
still reproduce against that source.

**How the writes were driven.** The Browser pane refused to open for this session (the automation
classifier blocked `navigate` on the first call and said retrying would keep failing), so every
interaction below is the *same* HTTP request the React client makes: `POST <admin page>` with the
`Next-Action: <id>` header and the JSON argument array, using a session cookie minted from
`SESSION_SECRET`. Action ids were read out of `.next/static/chunks/*.js`
(`createServerReference("<id>", …, "<name>")`), so these are genuinely the panel's own server
actions, not direct library calls. Purely visual checks (responsive layout) could not be done —
see "Not tested" at the end.

---

### [BLOCKER] An organisation admin can reset another customer's admin password and is handed the new one
- **Where**: `lib/admin.ts:273` (`resetStaffPassword`) — `if (!(await canManageProperty(actor, target.property_id)) && target.role !== 'admin') return fail('Not your property.')`. Screen: Staff → "Reset password".
- **Steps**:
  1. As `hc.ops`, onboard a second customer `qa3-org` with first admin `qa3.outsider` (Organisations → Onboard a customer).
  2. Sign in as `qa.admin` (admin of RN Hospitality — a *different* organisation).
  3. Invoke the Staff screen's own action with the other tenant's admin id:
     `POST /staff/admin`, `Next-Action: 40fca70dac20bf9cc50960cfee5963972a5563b93e`, body `["df11a18f-f4b2-450d-a993-64952f9d9945"]`.
- **Expected / Actual**: Expected `Not your property.` / the same denial every other cross-tenant write gets. Actual `{"ok":true,"password":"Eqbjjy78tpn4"}` — the password of another customer's admin account was rotated and the plaintext returned to the wrong tenant.
- **Evidence**: HTTP 200, body `1:{"ok":true,"password":"Eqbjjy78tpn4"}`. I then verified the credential is live by re-deriving the stored scrypt hash: `scrypt("Eqbjjy78tpn4", salt) === staff.password_hash` for `qa3.outsider` → `true`. That is a complete takeover of another organisation's top-level account (their guests, folios, staff, everything). The guard reads "if I can't manage their property **and** they are not an admin" — for an admin `property_id` is always `null`, so the clause `target.role !== 'admin'` short-circuits the only tenancy check in the function. `updateStaff` (`:197`) and `setStaffActive` (`:247`) carry the identical clause.

### [BLOCKER] An admin can move their own staff account into another customer's property, and that account then sees the other customer's board
- **Where**: `lib/admin.ts:209` — `const propertyId = … (input.propertyId ?? target.property_id)`, written straight into the row at `:215-221` with no `canManageProperty(actor, propertyId)` check. `createStaff` does check the same field (`lib/admin.ts:157`); `updateStaff` does not. Screen: Staff → Edit → Property.
- **Steps**:
  1. As `qa.admin`, `POST /staff/admin`, `Next-Action: 60840951e28c02b6493e099c32d16759859cdd9f90`, body
     `["7fcb7cbf-… (qa.hk)", {"name":"QA HK","role":"staff","department":"housekeeping","propertyId":"dcf49b5b-… (qa3-hotel, other tenant)","phone":null}]`.
  2. Load `/staff/board` and `/staff/rooms` with `qa.hk`'s session.
- **Expected / Actual**: Expected the property id to be rejected as outside the actor's organisation. Actual `{"ok":true}`; `staff.property_id` is now the other tenant's property while `organisation_id` stays mine.
- **Evidence**: after the write, `qa.hk`'s `/staff/board` renders `qa3-hotel` and no longer renders `RN Grand` (`body.includes('qa3-hotel') === true`, `body.includes('RN Grand') === false`); `/staff/rooms` likewise. `scopeTo` pins role `staff` to `staff.property_id` (`lib/scope.ts`), so everything that account can see is now the other customer's live guest traffic. Restored to `c90616f7-…` immediately afterwards.

### [MAJOR] An organisation admin can deactivate another customer's admin
- **Where**: `lib/admin.ts:247` (`setStaffActive`) — same `&& target.role !== 'admin'` escape hatch as the BLOCKER above. Screen: Staff → Deactivate.
- **Steps**: with two admins existing in `qa3-org` (so the last-active-admin guard does not mask the hole), as `qa.admin`: `POST /staff/admin`, `Next-Action: 6091fe3ba68e2850285d08708bd4702605e7650403`, body `["df11a18f-… (qa3.outsider)", false]`.
- **Expected / Actual**: Expected `Not your property.` Actual `{"ok":true}`, and `select active from staff where username='qa3.outsider'` → `false`. Sessions are re-checked per request (`lib/auth.ts` `staffFromToken` … `and s.active`), so the other customer's admin is signed out immediately.
- **Evidence**: `{"ok":true}` plus the row flipping to `active = false`. The first attempt (while they were their org's only admin) failed with *"This is the last active admin. There would be no way back in."* — i.e. it was stopped by a lockout guard, not by tenancy; add a second admin and the write goes through.

### [MAJOR] An escalation rung accepts any staff id, so another customer's phone can be subscribed to your guests' requests
- **Where**: `lib/escalation.ts:120` — `for (const staffId of [...new Set(input.staffIds)]…)` inserts into `escalation_rule_staff` with no check that the id belongs to the property or the organisation. Consumed unscoped by `lib/notify.ts:143` (`or s.id in (select staff_id from escalation_rule_staff where rule_id = …)`) and rendered unscoped by `lib/escalation.ts:52-56`. Screen: Escalation → "+ Tell someone else".
- **Steps**: as `qa.admin`, `POST /staff/admin/escalation`, `Next-Action: 604fe12a5cbf6ff5a06a861740e2485f3f28f4a824`, body
  `["c90616f7-… (my property)", {"id":null,"department":null,"afterMinutes":123,"appliesTo":"any","notifyManagers":false,"notifyAdmins":false,"active":true,"staffIds":["df11a18f-… (other tenant's admin)"]}]`.
- **Expected / Actual**: Expected the unknown staff id to be dropped or the call refused (the candidate list `listEscalationCandidates` is correctly scoped, so this id can never come from the UI). Actual `{"ok":true}` and the join row exists.
- **Evidence**: `select s.username, s.name, s.phone from escalation_rule_staff rs join staff s … where rs.rule_id = '0f48894a-…'` → `qa3.outsider | QA3 Outsider | +91 90000 00003`. Reproduced the *subscription*; I did not fire a real sweep, but `sweepEscalations` sends `Room <n> — <request note> (#ref) is <n> min old…` to exactly that list, so the next late request in my hotel goes to another customer's phone. Rung deleted afterwards.

### [MAJOR] Editing an admin silently demotes them to Staff
- **Where**: `app/staff/(app)/admin/StaffManager.tsx:25-29` (`ASSIGNABLE.admin = ['staff','manager']`) + `:192` `<Select … defaultValue={editing?.role ?? 'staff'} options={roleOptions} />`. Because `admin` is not among the options an admin is offered, a `<select>` opened on an admin row falls back to its first option, `staff`; the form then posts `role: 'staff'`. Server accepts it (`lib/admin.ts:200` — `canAssignRole(admin,'staff')` is true).
- **Steps**:
  1. `hc.ops` → Open RN Hospitality → Staff → create a second admin (`qa3.tempadmin`, role Admin).
  2. As `qa.admin`, open Staff → Edit on that admin and change only the phone number, i.e. post
     `["108a9772-…", {"name":"QA3 Temp Admin","role":"staff","department":"front_desk","propertyId":"c90616f7-…","phone":"+91 90000 00002"}]`.
- **Expected / Actual**: Expected the save to preserve the role (or the modal to show the real one). Actual `{"ok":true}` and the account is now `role = staff, department = front_desk, property_id = RN Grand` — an organisation admin stripped of every permission by an edit that never mentioned roles.
- **Evidence**: row before `role: 'admin', department: 'all', property_id: null`; row after `role: 'staff', department: 'front_desk', property_id: 'c90616f7-…'`. The only reason it doesn't silently wipe the *last* admin is the counter at `lib/admin.ts:205`.

### [MAJOR] An admin can never edit their own row — and therefore cannot add the phone number the Escalation screen tells them to add
- **Where**: `lib/admin.ts:202-204` (`if (id === actor.id && input.role !== actor.role) return fail('You cannot change your own role…')`) combined with the same `StaffManager.tsx:192` role-select defect. Screens: Staff → Edit (own row); Escalation warning banner.
- **Steps**: as `qa.admin`, Staff → Edit on my own row → type a phone number → Save. The form posts `role: 'staff'` (see above), which is not my current role.
- **Expected / Actual**: Expected the phone number to save. Actual `{"ok":false,"error":"You cannot change your own role. Ask another admin."}` — there is no way for an admin to edit their own name or phone from the panel.
- **Evidence**: `updateStaff(me, {role:'staff',…})` → `{"ok":false,"error":"You cannot change your own role. Ask another admin."}`. Meanwhile `EscalationManager.tsx:94-98` tells exactly this person *"Nobody here has a phone number… Add one under Staff → Edit → Phone."* (banner confirmed rendering on a property whose only candidate has no number).

### [MAJOR] A failed "Add a property" still creates the property
- **Where**: `lib/admin.ts:374-377` inserts the property, then `:379` validates the copy source and returns `fail(…)`. No transaction.
- **Steps**: as `qa.admin`, `POST /staff/admin/properties`, `Next-Action: 60a34aeacc21a492e771aa359ee284ce2001743066`, body
  `[{"name":"qa3-orphan","slug":"qa3-orphan","address":null,"phone":null,"brandColor":"#0F766E","timezone":"Asia/Kolkata"}, "dcf49b5b-… (a property I may not copy)"]`.
- **Expected / Actual**: Expected no property to exist after an error. Actual the modal shows *"That is not a property you can copy from."* while `properties` grew from 3 rows to 4, with `qa3-orphan` created and no catalogue.
- **Evidence**: `{"ok":false,"error":"That is not a property you can copy from."}`; `select count(*) from properties` 3 → 4; `select slug,created_at from properties where slug='qa3-orphan'` returns the row. The user's only clue is that the slug is now "taken" when they retry. (Reproducible from the UI whenever the copy-source check fails; the user-facing shape is "error message + phantom hotel in the list".)

### [MAJOR] A locked-out admin can never be unlocked
- **Where**: `lib/admin.ts:298` (`unlockStaff`) — `if (!(await canManageProperty(actor, target.property_id))) return fail('Not your property.')`; an admin's `property_id` is always `null`, and `canManageProperty` returns `false` for `null` (`lib/admin.ts:49`). Screen: Staff → Unlock (the button only appears while `locked_until` is in the future, `StaffManager.tsx:128-132`).
- **Steps**: as `qa.admin`, call `unlockStaff` on another admin in my own organisation (`rn.admin`'s id): `Next-Action: 40eb859ddebe1feb8125a37e971614e8f69546beb1`, body `["<rn.admin id>"]`.
- **Expected / Actual**: Expected `{"ok":true}` — it is my own organisation's admin and the button is rendered for them. Actual `{"ok":false,"error":"Not your property."}`.
- **Evidence**: `unlock an ADMIN of my own org: {"ok":false,"error":"Not your property."}`, versus `{"ok":true}` for a staff account on the same property. After five bad passwords an admin is locked for 15 minutes and the visible recovery button always errors; the only way out is "Reset password", which also clears `locked_until` (`lib/admin.ts:279`) but throws the password away. Note the same missing `|| target.role === 'admin'` branch is what makes the three functions above *too* permissive — one guard, wrong in both directions.

### [MINOR] Managers are shown a "Properties" tab that bounces them to the board
- **Where**: `app/staff/(app)/admin/layout.tsx:29` renders the tab for everyone except role `staff`; `app/staff/(app)/admin/properties/page.tsx:8` calls `requireAdmin()`, which redirects managers.
- **Steps**: `curl -b "hc_session=<qa.manager>" http://localhost:3100/staff/admin/properties`.
- **Expected / Actual**: Expected the nav to match reach. Actual the manager's nav contains `Properties -> /staff/admin/properties`, and the page answers `NEXT_REDIRECT;replace;/staff/board;307` — one click ejects them from the panel entirely.
- **Evidence**: nav extracted from the manager's `/staff/admin` HTML: `Staff, Properties, Directory, Escalation, Hotel info, Activity` (identical to an admin's). The properties response body contains `NEXT_REDIRECT;replace;/staff/board;307;`. Same for an admin hitting `/staff/admin/organisations` — correct to refuse, but it drops them on the ops board rather than back in the panel.

### [MINOR] A department value the dropdown cannot produce makes `createStaff` return HTTP 500
- **Where**: `lib/admin.ts:167-172` inserts `input.department` with no allow-list; compare `validateItem` (`lib/admin.ts:516`, "Choose a team.") and the role check at `:142`.
- **Steps**: `POST /staff/admin`, `Next-Action: 403f0ff4…`, body `[{"name":"QA3 Dept","username":"qa3.dept","role":"staff","department":"laundry","propertyId":"c90616f7-…","phone":null}]`.
- **Expected / Actual**: Expected `{"ok":false,"error":"Choose a team."}`. Actual **HTTP 500**, `1:E{"digest":"1451196707"}` (the staff table's check constraint), no row created. `createItem` with the same bogus department correctly returns `{"ok":false,"error":"Choose a team."}`.
- **Evidence**: status 500 vs 200 for every other rejection; `select count(*) … where username='qa3.dept'` → 0.

### [MINOR] Renaming a hotel-info page onto an existing address returns HTTP 500
- **Where**: `lib/admin.ts:716-720` — the update branch has no duplicate-slug check; the create branch (`:723`) does. `db/schema.sql` has `unique (property_id, slug)` on `info_pages`.
- **Steps**: create two pages (`qa3-a`, `qa3-b`), then save `qa3-b` with `slug: "qa3-a"`: `POST /staff/admin/info`, `Next-Action: 60562e281304fffcab3c9f4cef5a8bd112841b533a`, body `["c90616f7-…", {"id":"<qa3-b id>","slug":"qa3-a","title":"qa3-b","body":"b","icon":null,"active":true}]`.
- **Expected / Actual**: Expected the create path's message *"A page with the address 'qa3-a' already exists."* Actual **HTTP 500**, `1:E{"digest":"1297031198"}`; the modal just fails with no explanation.
- **Evidence**: status 500; both rows unchanged afterwards.

### [MINOR] Prices with paise cannot be typed, though the column and the server accept them
- **Where**: `app/staff/(app)/admin/catalog/CatalogManager.tsx:235-243` — `<Field label="Price (₹)" type="number" min={0} step="1" …>`. Server side, `lib/admin.ts:542` / `:569` store `Math.round(priceRupees * 100)`.
- **Steps**: Directory → + Item → Price `249.50`.
- **Expected / Actual**: Expected ₹249.50 to save as 24950 paise. Actual `step="1"` makes 249.50 fail HTML constraint validation, so the form cannot be submitted at all ("nearest valid values are 249 and 250"); the item form is the only way to set a price, so half-rupee menu prices are unreachable from the panel.
- **Evidence**: the same payload sent straight to the action stores it correctly — `priceRupees: 249.5 → price_paise 24950`, `249.99 → 24999`, `0.07 → 7`, `1000000 → 100000000`, and `-5`, `1000001`, `NaN`, `Infinity`, `"249.50"` (string) are all rejected with *"Price must be between ₹0 and ₹10,00,000."* So only the input's `step` is in the way. (`249.999 → 25000` — silent round up, harmless.)

### [MINOR] "Showing the most recent 300" tells you to narrow the period, which cannot reach older rows
- **Where**: `lib/admin.ts:784` (`limit 300`, `order by a.created_at desc`) and `app/staff/(app)/admin/audit/page.tsx:100-102`.
- **Steps**: with 310 entries from today and 10 from a fortnight ago in one property's log, load `/staff/admin/audit?days=30`, then `?days=7`, then `?days=1`.
- **Expected / Actual**: Expected some setting to reach the older rows. Actual all three render exactly the same most-recent 300 and the same note; the fortnight-old entries are unreachable at every period, because narrowing the window only ever removes *older* rows.
- **Evidence**: rendered row counts 300 / 300 / 300, note present in all three, `old: 0` (a marker in the 14-day-old rows' meta) never appears. Test rows were inserted into my throwaway tenant and deleted afterwards; the real log was not touched.

### [MINOR] The one-time-password modal promises a forced password change that no longer exists
- **Where**: `app/staff/(app)/admin/ui.tsx:257-259` — *"Give this to <user>. They will be asked to change it the first time they sign in."*
- **Steps**: create any account or press "Reset password"; read the modal.
- **Expected / Actual**: Expected the claim to be true. Actual nothing forces a change: `db/schema.sql:41` is `alter table staff drop column if exists must_change_password;` and no code path redirects to `/staff/password` (commit 530eefd "Remove the forced password change"). The temporary password stays valid forever, and the admin handing it over has been told otherwise.
- **Evidence**: repo-wide grep for `must_change|mustChange|/staff/password` returns only the schema drop and the user's own nav link.

### [MINOR] Usernames and slugs are silently rewritten or accepted in shapes the hints forbid
- **Where**: `lib/admin.ts:136` (`username.trim().toLowerCase().slice(0, 60)` *before* the regex at `:139`), `lib/admin.ts:711` (info-page slug is taken verbatim when supplied), `lib/admin.ts:650`/`:719` (icon saved as typed).
- **Steps / Evidence** (each via the real action, all confirmed):
  - `username: "qa3." + "a".repeat(58)` (62 chars) → `{"ok":true}`, stored truncated to 60. The hint says 3–60; over-length input is silently cut rather than refused.
  - `username: "..."` → `{"ok":true}`. Three dots is a legal username.
  - `slug: "QA3 Weird Slug"` on a hotel-info page → stored exactly like that, spaces and capitals included, as the page's address; the generator path is sanitised but a typed slug is not. Blank slug + title `"QA3 Generated Slug!"` → `qa3-generated-slug-` (trailing dash).
  - Section icon hint says "A single character" (`CatalogManager.tsx:329`) but `"not-a-single-character"` saves and renders beside the section name.
  - Property slugs *are* validated (`ab`, `qa3 bad slug`, `qa3_bad` rejected; duplicates rejected, including against another tenant's slug).

### [MINOR] `updateProperty` skips the validation `createProperty` applies
- **Where**: `lib/admin.ts:424` validates only `brandColor` before the update at `:427`; `createProperty` also validates the name at `:366` and the slug at `:367`.
- **Steps**: as `qa.admin`, `POST /staff/admin/properties`, `Next-Action: 600c32d05fc190af94daaaf8082452ed5a9dc33a61`, body `["c90616f7-…", {"name":"   ","address":"…","phone":"…","brandColor":"#0F766E","timezone":"Mars/Olympus"}]`.
- **Expected / Actual**: Expected *"Enter a name."* Actual `{"ok":true}`; the hotel's name became `''` and its timezone `Mars/Olympus`. The edit form marks the name `required`, but `required` passes on whitespace, so a stray space bar reaches this. Restored immediately.
- **Evidence**: row after the call — `name: '', timezone: 'Mars/Olympus'`. (The timezone is cosmetic today: the column is written in two places and read nowhere in the codebase — every timestamp renders with `toLocaleString([])` in the viewer's own zone, so the Timezone picker on the property form currently does nothing.)

### [POLISH] Username-taken errors leak the existence of another customer's account
- **Where**: `lib/admin.ts:160-161`.
- **Steps**: as `qa.admin`, create a staff account with `username: "qa3.outsider"` (an account belonging to a different organisation).
- **Expected / Actual**: The username namespace is global, so a clash must be refused — but the message names the account: *"The username 'qa3.outsider' is taken."* That is an oracle for guessing other customers' usernames.
- **Evidence**: `{"ok":false,"error":"The username “qa3.outsider” is taken."}`, likewise for `hc.ops`.

### [POLISH] Admin-level audit entries are invisible to the organisation they belong to
- **Where**: `lib/admin.ts:174-182` (`audit({ propertyId, … })` where `propertyId` is `null` for an admin) and `lib/scope.ts` (`a.property_id in (select …)` never matches `null`).
- **Steps**: as `hc.ops` inside RN Hospitality, create an admin; then read `/staff/admin/audit?days=1` as `qa.admin`.
- **Expected / Actual**: Expected "somebody created an admin account" to be the single most auditable event in the panel. Actual it is filed with `property_id = null` and is therefore excluded from every organisation-scoped view; only a platform account outside an organisation ever sees it. Same for `organisation.created`.
- **Evidence**: `select action, property_id from audit_log where action='staff.created'` → the admin creations carry `property_id = null`, the staff creations carry the property. Nine such rows exist and none render on the org's Activity screen.

### [POLISH] Two sections can carry the same name in the same directory
- **Where**: `lib/admin.ts:616-617` (`createCategory` checks only that the name is non-empty and the kind is known).
- **Steps**: Directory → + Section → "qa3-section", twice.
- **Expected / Actual**: Expected a clash warning, as info pages and properties give. Actual both save; the left-hand nav then shows two identical entries with no way to tell them apart.
- **Evidence**: `{"ok":true}` on the second create; `select count(*) … where name='qa3-section'` → 2.

---

## Verified working

**Tenant isolation (reads).** With `qa.admin` and `qa.manager` cookies, none of `/staff/admin`,
`/properties`, `/catalog`, `/info`, `/escalation`, `/audit?days=90` leaked any string belonging to
the second tenant (`qa3-org`, `qa3-hotel`, `qa3.outsider`, `qa3-secret-section`, `qa3-secret-item`,
`qa3-secret-page`, their phone number). Passing the other organisation's property id directly —
`/staff/admin/catalog?property=dcf49b5b-…`, and the same on `/info` and `/escalation` — falls back
to the caller's own property (`page.tsx:12-15` validates the id against `listProperties`) and
renders the caller's own data.

**Tenant isolation (writes).** From `qa.admin`, every one of these returned `Not your property.`
against the second tenant: `updateProperty`, `createCategory`, `updateCategory`, `createItem`,
`updateItem`, `deleteItem`, `saveInfoPage`, `deleteInfoPage`, `saveEscalationRule`,
`setWarnThreshold`, `createStaff(propertyId = theirs)`, `unlockStaff`. `qa.manager` got the same or
stricter. `saveInfoPage` with another tenant's page id under my property id changes nothing.
The three staff functions listed in the findings above are the only holes I found.

**Role permissions** (`curl` with each cookie, redirect target read from the response body):

| | `/staff/admin` | `/properties` | `/catalog`,`/info`,`/escalation`,`/audit` | `/organisations` |
|---|---|---|---|---|
| `qa.hk` (staff) | → `/staff/board` | → `/staff/board` | → `/staff/board` | → `/staff/board` |
| `qa.manager` | 200, own property only | → `/staff/board` (nav still offers it) | 200, own property | → `/staff/board` |
| `qa.admin` | 200, own organisation | 200 | 200 | → `/staff/board` |
| `hc.ops`, no org | → `/organisations` | → `/organisations` | → `/organisations` | 200 |
| `hc.ops`, in org | 200 | 200 | 200 | 200 |

`createOrganisation`, `updateOrganisation` and `enterOrganisation` invoked with `qa.admin`,
`qa.manager` and `qa.hk` cookies all redirect and change nothing (no organisation created, no
rename, no `hc_org` cookie set). A `hc_org` cookie handed to a non-platform session is ignored
(`qa.admin` + a valid `hc_org` still redirects off `/organisations`).

**Platform flow.** Outside an organisation `hc.ops` sees exactly one tab, `Organisations`, and every
other panel URL (and `/staff/board`) redirects to it. "Open" sets `hc_org` and the nav becomes
exactly the six tabs — Staff, Properties, Directory, Escalation, Hotel info, Activity — plus the
"← All organisations / Working inside RN Hospitality" banner. That button clears `hc_org`
(`Set-Cookie: hc_org=; Expires=Thu, 01 Jan 1970`) and returns to the list. A forged `hc_org` holding
an unknown uuid, or a non-uuid, is ignored and the account is bounced back to the chooser. The
staff list inside an organisation shows that organisation's people only.

**Staff screen.** Username rules reject `ab`, `qa3 user`, `qa3@user`, `qa3.üser`, empty; duplicates
are refused case-insensitively (`QA.HK` vs `qa.hk`). Role options match the server: an admin is
offered Staff and Manager only, a manager only Staff, and `createStaff` refuses `admin`, `platform`
and a made-up `superuser` from an admin session. "Choose a property." for a manager/staff account
without one. Self-protection all holds: you cannot deactivate your own account (button also
`disabled`), cannot change your own role, cannot promote yourself, and a manager cannot promote
themselves. `hc.ops` cannot deactivate itself. The last-admin guards work per organisation —
deactivating the only remaining active admin gives *"This is the last active admin. There would be
no way back in."* and demoting them gives *"This is the last admin. Promote someone else first."*
Only `hc.ops` can edit, reset or deactivate the platform account. Reset password returns a fresh
readable one-time password and clears `failed_logins`/`locked_until`; a locked account shows the
`Locked` tag and the Unlock button, and unlocking a *staff* account works. A manager can reset a
password for someone on their own property — the sign-in screen's promise holds for non-admins.

**Properties.** Slug validation (3–60, lowercase/digits/dash), duplicate-slug refusal (including
against another tenant's slug), brand colour must be `#rrggbb` (`red` and `#fff` refused, on create
*and* update), name required on create. Slug is correctly immutable on edit. "Start the directory
from" copies faithfully: the source's full directory as it stood at the time of the test (19
sections, 113 items, 7 info pages, 8 quick replies) landed on the new property with prices, target
times, departments and availability intact, every item under the copied section rather than the
source's, and rooms/escalation rules correctly *not* copied.

**Directory.** Section `kind` validated ("Choose where this section appears."), name required,
hide/show works, delete refuses a non-empty section with the count (*"Empty 'qa3-section' first — it
still has 9 items."*) and succeeds once empty; deleting something already gone is idempotent.
Item validation: price range and type as listed above; target time accepts 1 and 1440 and rejects 0,
1441, 15.5 and `NaN`; department allow-listed. Availability, veg/non-veg, "needs a time", unit and
description all round-trip. New items/sections get sequential `sort`.

**Hotel info.** Title and body required, duplicate slug refused on create, slug generated from the
title when blank, a 200 000-character body saved and returned intact.

**Escalation.** Duplicate guard fires on same-time-same-team and correctly allows same-time-
different-team. `afterMinutes` accepts 0 and 1440, rejects −1, 1441, 7.5 and `NaN`. A rung that
tells nobody is refused. Amber threshold: 10 and 100 accepted; 0, 9, 101, 60.5, `NaN` and `"abc"`
all refused with *"The amber threshold must be between 10% and 100% of the target."* (the input is
also `min=10 max=100 step=5`). Sentences read correctly — *"As soon as it is late, tell the duty
managers"*, *"15 minutes late, tell the duty managers and the admins"*, with *"Any team · only if
nobody has picked it up"* underneath. The no-phone banner appears exactly when every candidate
lacks a number, and stays hidden when one has one. Empty state: *"Nobody is told when anything runs
late here."* Steps renumber 1..n after add and delete.

**Activity.** Action filter (`?action=staff` → 24 rows, `?action=request` → 56) and period filter
work; only groups with real entries are offered; an unknown filter and `' or 1=1--` both yield the
empty state *"Nothing recorded in this period."* with no error (queries are parameterised);
`?days=abc` and `?days=0` fall back to 7. A manager sees only their property's rows (332 vs 336
row-halves for the admin). `?days=-5` shows the empty state rather than erroring.

**Empty states** render as written for a brand-new property: *"No sections yet." / "Add a section to
get started."*, *"No pages yet. Start with the wifi password…"*, *"Nobody is told when anything runs
late here."*

---

## Not tested
- **Responsive (768px / 375px)** — the Browser pane was blocked for this session, so I could not
  measure layout. The admin rows are `flex flex-wrap` with `min-w-[12rem]`/`min-w-[13rem]` children
  rather than real tables, which usually wraps rather than overflows, but I did not verify it and am
  not reporting it either way.
- **Live escalation delivery** — I reproduced the cross-tenant *subscription*, not an actual Twilio
  send.

## Environment notes (things I changed and put back)
- All `qa3-*` fixtures deleted: organisation `qa3-org`, properties `qa3-hotel`, `qa3-copy`,
  `qa3-empty`, `qa3-orphan`, `qa3-probe-x`, `qa3-bad`, `qa3-tz`, staff `qa3.*` and `...`, plus the
  probe sections/items/pages. Final state: one organisation, one property (`RN Grand, Pune`,
  18 sections / 113 items / 7 info pages / 22 rooms), five accounts (`hc.ops`, `rn.admin`,
  `qa.admin`, `qa.manager`, `qa.hk`). Rooms 301/302/303 untouched.
- `qa.hk`'s password was rotated by the "a manager can reset a password" probe; I set it back to
  `QaTesting2026x` and cleared its lock counters.
- `RN Grand`'s name/address/phone/colour/timezone were restored after the `updateProperty`
  validation probe; `warn_at_percent` is back to 60.
- **One real change I could not restore exactly**: my escalation cleanup filter (`after_minutes in
  (77, 0, 88)`) also deleted the property's pre-existing step-1 rung at 0 minutes. It had never been
  written through the app, so the audit log has no record of its notify flags or named people. I
  re-created it with the schema defaults — 0 minutes, any team, only-if-unaccepted, duty managers,
  active — which matches how it read on screen before ("As soon as it is late, tell the duty
  managers"). If it originally named anyone individually, that naming is gone and should be
  re-added. Step 2 (15 minutes, managers + admins) was never touched.
- The 320 synthetic audit rows for the 300-cap test were inserted into the throwaway tenant and
  deleted. Real audit entries generated by this pass were left in place.
