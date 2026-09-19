# Tenant layer - implementation plan

**Status: not started.** Written 2026-09-14. Nothing in this file is built yet.

## The problem

`admin` currently means "sees every property row in the database". `rn.admin` holds it.
That is fine while every property belongs to RN Hospitality. The moment a second hotel
*group* is onboarded, RN's admin sees their rooms, orders and revenue - there is nothing
above `properties` to scope by.

Concretely, the scope expressions that are wrong today:

- `lib/board.ts` → `propertyScope()` returns `sql\`true\`` for an admin
- `lib/board.ts` → `loadChatRooms()` same
- `lib/history.ts` → `scopes()` same
- `lib/admin.ts` → `listProperties`, `listStaff`, `listAudit`, `adminOverview` same
- `lib/auth.ts` → `canTouchProperty()` returns `true` for any admin
- `app/staff/(app)/rooms/page.tsx` → `scopeId` is `null` for an admin, so the query is unscoped

## Target model

Four levels:

| Role | Scope | Who |
| --- | --- | --- |
| `platform` | every organisation | HConcierge (you) |
| `admin` | one organisation, all its properties | RN Hospitality's own admin |
| `manager` | one property | duty manager |
| `staff` | one department at one property | reception, housekeeping, kitchen |

`rn.admin` stays `admin` and becomes scoped to the RN Hospitality organisation. A new
`platform` user is created for HConcierge.

---

## 1. Schema

Add to `db/schema.sql`:

```sql
create table if not exists organisations (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table properties add column if not exists organisation_id uuid references organisations(id) on delete cascade;
alter table staff      add column if not exists organisation_id uuid references organisations(id) on delete cascade;

create index if not exists properties_org_idx on properties (organisation_id);
create index if not exists staff_org_idx      on staff (organisation_id);
```

Replace the role check and the property constraint:

```sql
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('platform','admin','manager','staff'));

-- platform: no org, no property
-- admin:    org, no property
-- manager/staff: org and property
alter table staff drop constraint if exists staff_property_required;
alter table staff add constraint staff_scope_valid check (
  (role = 'platform' and organisation_id is null and property_id is null)
  or (role = 'admin' and organisation_id is not null and property_id is null)
  or (role in ('manager','staff') and organisation_id is not null and property_id is not null)
);
```

**Backfill before adding the constraint**, or it will reject every existing row:

```sql
insert into organisations (slug, name) values ('rn-hospitality', 'RN Hospitality')
  on conflict (slug) do nothing;

update properties set organisation_id = (select id from organisations where slug = 'rn-hospitality')
 where organisation_id is null;

update staff set organisation_id = (select id from organisations where slug = 'rn-hospitality')
 where organisation_id is null and role <> 'platform';
```

Then `alter table properties alter column organisation_id set not null;`.

The platform user has to be created by script - there is no sign-up screen, and no
existing user may promote themselves to `platform`. Add `db/platform-user.mjs`.

---

## 2. `lib/auth.ts`

- `Role` gains `'platform'`. `Staff` gains `organisation_id: string | null` and
  `organisation_name?: string | null`.
- `getStaff()` - join `organisations`, select both.
- Add `requirePlatform()`. Keep `requireAdmin()` but it should accept `platform` too
  (platform can do anything an admin can).
- **`canTouchProperty(staff, propertyId)` is the hard one.** It currently answers from the
  `Staff` object alone. Org-awareness needs the *property's* organisation, which the
  function does not have.

  Change the signature to `canTouchProperty(staff, property: { id, organisation_id })`.
  Most call sites already `select` the row first (`roomFor`, `setRequestStatus`,
  `loadRoomThread`, `createItem`, …) - widen those selects to include
  `organisation_id` via a join on `properties`. Do **not** add a lookup inside the
  helper; that turns one query into two on every permission check.

- `visibleDepartments()` is unchanged.

---

## 3. Scoping

Introduce one shared helper rather than repeating the ternary in a dozen places:

```ts
// lib/scope.ts
export function propertyScope(staff: Staff, propertyId?: string | null) {
  if (staff.role === 'platform') return propertyId ? sql`p.id = ${propertyId}` : sql`true`
  if (staff.role === 'admin')
    return propertyId
      ? sql`p.id = ${propertyId} and p.organisation_id = ${staff.organisation_id}`
      : sql`p.organisation_id = ${staff.organisation_id}`
  return sql`p.id = ${staff.property_id}`
}
```

Then rewrite, in this order:

1. `lib/board.ts` - `propertyScope`, `loadChatRooms`, and the `canTouchProperty` call sites
   in `loadRoomThread`, `markThreadRead`, `replyToRoom`, `setRequestStatus`,
   `assignRequest`, `loadAssignableStaff`
2. `lib/history.ts` - `scopes()`
3. `lib/admin.ts` - `canManageProperty`, `listStaff`, `listProperties`, `listAudit`,
   `adminOverview` (six subqueries, each with its own admin ternary), `createProperty`
   (must set `organisation_id`)
4. `app/staff/(app)/rooms/page.tsx` - `scopeId`
5. `app/staff/(app)/rooms/print/page.tsx` - same unscoped `propertyId` pattern

### Role assignment rules

`lib/admin.ts` → `canAssignRole()`:

- `platform` may create any role, including other `platform` users
- `admin` may create `manager` and `staff`, within their own org only
- `manager` may create `staff`, within their own property only
- nobody may create a role above their own

### Lockout guards

`activeAdminCount()` currently counts admins globally. It must count **per organisation**,
or one org losing its last admin is invisible. Add a separate global guard so the last
`platform` user cannot be deactivated or demoted either.

---

## 4. A live bug to fix while here

`lib/notify.ts` → `sweepEscalations()` recipient query:

```sql
and (property_id = any(${propertyIds}) or role = 'admin')
```

That `or role = 'admin'` sends every escalation to **every admin in the database**,
regardless of property. It is already wrong for multi-property; with multi-tenant it
leaks one client's escalations to another. Scope it to the property's organisation.

---

## 5. Admin panel

- `app/staff/(app)/admin/layout.tsx` - add an **Organisations** tab, visible only to
  `platform`.
- New `app/staff/(app)/admin/organisations/` - list orgs with property/staff/room counts;
  create an org and provision its first `admin` in one step, returning a one-time password
  (reuse the existing `PasswordOnce` component).
- `properties/page.tsx` - currently `requireAdmin()`. Allow `platform` too, and add an
  organisation selector for platform users. An `admin` creating a property gets their own
  org assigned automatically.
- `StaffManager.tsx` - the `ROLES` array needs `platform`, filtered by what the actor may
  assign.

---

## 6. Scripts

- `db/seed.mjs` - create the organisation first, attach the property and staff to it.
- `db/reset.mjs` - unaffected (it clears operational data only), but the summary tables
  should group by organisation.
- `db/platform-user.mjs` - new. Creates or resets the HConcierge platform account. This is
  the break-glass path and the only way a `platform` user can ever exist.

---

## 7. Verification

The test that actually proves it:

1. Create a second organisation with its own property and admin.
2. Sign in as `rn.admin` - the second org's property must not appear in Properties,
   Rooms, Board, History, Directory or Activity.
3. Try to reach it directly by id (`/staff/rooms?property=<other-org-id>`,
   `/staff/admin/catalog?property=<other-org-id>`) - must be empty or refused, not just
   hidden from the picker.
4. Sign in as the platform user - both organisations visible.
5. Confirm an escalation in org B does not message org A's admin.

Step 3 is the one that matters. Hiding a row from a dropdown is not isolation.

---

## Sequencing

Steps 1 and the backfill are additive and break nothing, so they can land first and
independently. Everything from step 2 onward should land together - a half-migrated
`canTouchProperty` will silently widen access rather than narrow it.

The guest side (`lib/guest.ts`, `lib/requests.ts`, `lib/guest-session.ts`, `app/r/[token]/`)
is scoped by room token and is **not affected by any of this**. No risk there.
