-- HConcierge schema (Postgres / Supabase)
-- Money is stored as integer paise. Never use floats for money.
-- Run with: npm run db:push

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- properties
create table if not exists properties (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  address      text,
  phone        text,
  timezone     text not null default 'Asia/Kolkata',
  currency     text not null default 'INR',
  brand_color  text not null default '#0F766E',
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------------- staff
-- role   'admin'   group-level, sees every property
--        'manager' runs one property, receives escalations
--        'staff'   works one department's board
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references properties(id) on delete cascade,
  username      text not null,
  name          text not null,
  password_hash text not null,
  department    text not null,  -- a departments.slug, or 'all' for every team
  role          text not null default 'staff' check (role in ('platform','admin','manager','staff')),
  phone         text,
  active        boolean not null default true,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists staff_username_key on staff (lower(username));
-- passwords are set and reset by an admin; nothing forces a change at sign-in
alter table staff drop column if exists must_change_password;

-- HConcierge and group admins have no property; everyone else must have one
alter table staff drop constraint if exists staff_property_required;
alter table staff add constraint staff_property_required
  check (role in ('platform','admin') or property_id is not null);

-- -------------------------------------------------------------------- rooms
-- token is what the printed QR encodes, and it is permanent: the card is
-- printed once and lives on the desk. Checkout does NOT rotate it — an earlier
-- comment here claimed it did, which is the kind of sentence a later change
-- ends up trusting. What checkout clears is access_code below, and that is the
-- gate. Rotating the token is a deliberate act from the Rooms screen, for a
-- card that has been damaged or photographed, and it means reprinting.
create table if not exists rooms (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  number        text not null,
  floor         text,
  room_type     text,
  token         text unique not null,
  occupied      boolean not null default false,
  guest_name    text,
  checked_in_at timestamptz,
  checkout_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (property_id, number)
);

-- Per-stay access code. The QR token identifies the room and is permanent, so
-- the printed card never has to be replaced; this 4-digit code is the part that
-- changes with the guest. Alone it is only 10,000 combinations, which is why
-- code_attempts/code_locked_until exist — it is a second factor behind a random
-- token that lives physically inside the room, not a password.
alter table rooms add column if not exists access_code       text;
alter table rooms add column if not exists code_set_at        timestamptz;
alter table rooms add column if not exists code_attempts      int not null default 0;
alter table rooms add column if not exists code_locked_until  timestamptz;

-- ------------------------------------------------------------------ catalog
-- kind drives which guest screen the category appears on:
--   amenity     free housekeeping items (towels, pillows)
--   fnb         room service menu (cart + modifiers)
--   service     paid services (laundry, spa, airport transfer)
--   front_desk  wake-up call, late checkout, luggage
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  kind        text not null check (kind in ('amenity','fnb','service','front_desk')),
  name        text not null,
  icon        text,
  sort        int not null default 0,
  active      boolean not null default true
);
create index if not exists categories_property_idx on categories (property_id, kind, sort);

-- modifier_groups is JSONB rather than two more tables: it is read-mostly
-- config, never queried by modifier, and it saves a whole CRUD screen.
-- Shape: [{ name, min, max, options: [{ name, price_paise }] }]
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  category_id     uuid not null references categories(id) on delete cascade,
  name            text not null,
  description     text,
  price_paise     int not null default 0,
  unit            text,
  department      text not null,  -- a departments.slug
  sla_minutes     int not null default 15,
  veg             boolean,
  needs_time      boolean not null default false,
  modifier_groups jsonb not null default '[]'::jsonb,
  available       boolean not null default true,
  sort            int not null default 0
);
create index if not exists items_category_idx on items (category_id, sort);

-- read-only directory content: wifi password, checkout time, pool hours
create table if not exists info_pages (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  slug        text not null,
  title       text not null,
  body        text not null,
  icon        text,
  sort        int not null default 0,
  active      boolean not null default true,
  unique (property_id, slug)
);

-- ----------------------------------------------------------------- requests
create table if not exists requests (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  room_id         uuid not null references rooms(id) on delete cascade,
  ref             bigint generated always as identity,
  kind            text not null check (kind in ('order','amenity','service','front_desk','other')),
  department      text not null,  -- a departments.slug
  status          text not null default 'new' check (status in ('new','ack','in_progress','done','cancelled')),
  note            text,
  scheduled_for   timestamptz,
  total_paise     int not null default 0,
  sla_minutes     int not null default 15,
  guest_name      text,
  assigned_to     uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at    timestamptz,
  escalated_at    timestamptz,
  cancel_reason   text
);
create index if not exists requests_board_idx on requests (property_id, status, created_at desc);
create index if not exists requests_poll_idx  on requests (property_id, updated_at desc);
create index if not exists requests_room_idx  on requests (room_id, created_at desc);

-- name and price are snapshotted so editing the menu never rewrites history
create table if not exists request_items (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references requests(id) on delete cascade,
  item_id          uuid references items(id) on delete set null,
  name             text not null,
  qty              int not null default 1 check (qty > 0),
  unit_price_paise int not null default 0,
  modifiers        jsonb not null default '[]'::jsonb,
  note             text
);
create index if not exists request_items_request_idx on request_items (request_id);

-- ----------------------------------------------------------------- messages
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  room_id     uuid not null references rooms(id) on delete cascade,
  sender      text not null check (sender in ('guest','staff')),
  staff_id    uuid references staff(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists messages_room_idx on messages (room_id, created_at);
-- loadChatRooms() is the one board query with no bound on it: it reads every
-- message a property has ever sent to find the newest per room, and it runs on
-- every live push and every poll. This matches its shape exactly - property,
-- then room, then newest first - so the distinct-on walks the index instead of
-- sorting the table. Free today at a few dozen rows; the difference after a
-- season of chat is the whole board.
create index if not exists messages_property_idx on messages (property_id, room_id, created_at desc);
-- The unread count hanging off both loadBoard() and loadChatRooms(), one
-- correlated subquery per row. Partial, so it indexes only the handful of
-- messages that are actually unread rather than the whole table.
create index if not exists messages_unread_idx on messages (room_id)
  where sender = 'guest' and read_at is null;

create table if not exists quick_replies (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  label       text not null,
  body        text not null,
  sort        int not null default 0
);

-- -------------------------------------------------------------------- folio
-- Every charge goes through lib/folio.ts and lands here. When a PMS is wired
-- up later that adapter reads this table; nothing else in the app posts money.
create table if not exists folio_entries (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  room_id      uuid not null references rooms(id) on delete cascade,
  request_id   uuid references requests(id) on delete set null,
  description  text not null,
  amount_paise int not null,
  guest_name   text,
  created_at   timestamptz not null default now(),
  exported_at  timestamptz,
  voided_at    timestamptz,
  void_reason  text
);
create index if not exists folio_room_idx on folio_entries (room_id, created_at desc);
-- one charge per request, so a double-tap or retry cannot bill twice
create unique index if not exists folio_request_key on folio_entries (request_id) where request_id is not null;

-- ---------------------------------------------------------------- audit log
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  staff_id    uuid references staff(id) on delete set null,
  actor       text not null,
  action      text not null,
  entity      text,
  entity_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on audit_log (created_at desc);

-- One row per browser that has agreed to be woken. `endpoint` is the push
-- service's own URL for that browser and is the identity: it is unique so a
-- shared handset changing hands re-points to whoever subscribed last rather
-- than notifying the person who had it yesterday. p256dh and auth are the
-- browser's encryption keys -- unused today, because HConcierge sends a push
-- with no payload and the service worker fetches what to say (see lib/push.ts),
-- but they are what the browser handed over and re-subscribing everybody to get
-- them back later would be the expensive way to find that out.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  last_push_at timestamptz
);
create index if not exists push_staff_idx on push_subscriptions (staff_id);

-- keep requests.updated_at honest without every query remembering to set it
create or replace function touch_updated_at() returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$ language plpgsql;

drop trigger if exists requests_touch on requests;
create trigger requests_touch before update on requests
  for each row execute function touch_updated_at();

-- =========================================================================
-- Tenancy. An organisation is a customer: RN Hospitality is one, and owns
-- its properties. Without this layer `admin` means "every property row in
-- the database", which stops being acceptable the moment a second hotel
-- group exists.
-- =========================================================================

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

-- 'platform' is HConcierge itself: above every organisation, held by nobody
-- else. It can only be created by db/platform-user.mjs — no in-app path
-- promotes anyone to it.
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('platform','admin','manager','staff'));

-- The organisation columns stay nullable at this level and are enforced in
-- lib/admin.ts, which is the only writer.

-- =========================================================================
-- Escalation. Replaces the hardcoded "1x target, then 2x target, tell every
-- manager and admin" rule with a per-property ladder.
--
-- after_minutes is minutes PAST the request's own target, so one rule reads
-- the same for a 10-minute towel and a 40-minute biryani: "fifteen minutes
-- late, tell the GM".
-- =========================================================================

alter table properties add column if not exists warn_at_percent int not null default 60;

-- Which rung of the ladder has already fired for this request.
alter table requests add column if not exists escalation_step int not null default 0;

create table if not exists escalation_rules (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  -- null means every team
  department      text,  -- a departments.slug; null means every team
  step            int not null default 1,
  after_minutes   int not null default 0,
  applies_to      text not null default 'unaccepted'
                  check (applies_to in ('unaccepted','unfinished','any')),
  notify_managers boolean not null default true,
  notify_admins   boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists escalation_rules_idx on escalation_rules (property_id, step);

-- Named people on a rung, in addition to (or instead of) the role switches.
create table if not exists escalation_rule_staff (
  rule_id  uuid not null references escalation_rules(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  primary key (rule_id, staff_id)
);

-- =========================================================================
-- Settling the bill.
--
-- HConcierge does not take payment — a guest asks to settle, the front desk
-- takes the money the way it always has, and marks the folio settled. What
-- the app adds is that the guest can see the bill before that conversation
-- instead of being handed a printout at checkout.
-- =========================================================================

alter table folio_entries add column if not exists settled_at timestamptz;
alter table folio_entries add column if not exists settled_by text;
create index if not exists folio_room_open_idx
  on folio_entries (room_id) where voided_at is null and settled_at is null;

-- Set when the guest taps "ask to settle", cleared when the desk settles.
alter table rooms add column if not exists settle_requested_at timestamptz;

-- =========================================================================
-- Live updates.
--
-- One NOTIFY per changed row, on two channels: the guest screen watches its
-- room, the staff board watches its property. Putting this in a trigger
-- rather than in the write paths means every writer publishes — guest
-- actions, staff actions and the escalation cron alike — and there is no
-- call site to forget when a new one is added.
-- =========================================================================

create or replace function hc_notify() returns trigger language plpgsql as $$
declare
  room_id uuid;
  prop_id uuid;
begin
  if tg_table_name = 'rooms' then
    room_id := coalesce(new.id, old.id);
  else
    room_id := coalesce(new.room_id, old.room_id);
  end if;
  prop_id := coalesce(new.property_id, old.property_id);

  if room_id is not null then perform pg_notify('hc_room', room_id::text); end if;
  if prop_id is not null then perform pg_notify('hc_property', prop_id::text); end if;
  return null;
end $$;

drop trigger if exists hc_notify_requests on requests;
create trigger hc_notify_requests after insert or update or delete on requests
  for each row execute function hc_notify();

drop trigger if exists hc_notify_messages on messages;
create trigger hc_notify_messages after insert or update or delete on messages
  for each row execute function hc_notify();

drop trigger if exists hc_notify_folio on folio_entries;
create trigger hc_notify_folio after insert or update or delete on folio_entries
  for each row execute function hc_notify();

drop trigger if exists hc_notify_rooms on rooms;
create trigger hc_notify_rooms after insert or update or delete on rooms
  for each row execute function hc_notify();

-- An order's lines arrive as their own rows, moments after the request itself.
-- Without a trigger here the pushed frame can carry "items": [] — the kitchen
-- sees an order with no dishes on it until the next poll.
create or replace function hc_notify_request_item() returns trigger language plpgsql as $$
declare parent record;
begin
  select room_id, property_id into parent
    from requests where id = coalesce(new.request_id, old.request_id);
  if found then
    perform pg_notify('hc_room', parent.room_id::text);
    perform pg_notify('hc_property', parent.property_id::text);
  end if;
  return null;
end $$;

drop trigger if exists hc_notify_request_items on request_items;
create trigger hc_notify_request_items after insert or update or delete on request_items
  for each row execute function hc_notify_request_item();

-- ------------------------------------------------------------- audit scope
-- Every organisation-scoped view filters the log on property_id, and the most
-- auditable event in the panel — an admin being created — is filed with
-- property_id null, because an admin belongs to no single property. The result
-- was that granting someone the run of an organisation was invisible to that
-- organisation. The log now carries the organisation too.
alter table audit_log add column if not exists organisation_id uuid
  references organisations(id) on delete set null;

-- Backfill: every row already written can be placed from its property.
update audit_log a
   set organisation_id = p.organisation_id
  from properties p
 where a.property_id = p.id and a.organisation_id is null;

create index if not exists audit_log_org_idx on audit_log (organisation_id, created_at desc);

-- ------------------------------------------------------------------- teams
-- The four teams used to be a CHECK constraint repeated on five tables, which
-- meant a hotel with a spa, a valet or a concierge desk could not have one
-- without a migration. They are rows now, owned by the organisation, and the
-- columns that route to them keep holding the slug — an FK rewrite across
-- requests, items, staff and escalation_rules buys referential integrity that
-- the application already enforces, at the cost of touching every query in the
-- product.
--
-- 'all' is not a team. It stays a sentinel on staff.department meaning "every
-- team", which is what a manager or an admin has.
create table if not exists departments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  slug            text not null,
  name            text not null,
  sort            int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organisation_id, slug)
);
create index if not exists departments_org_idx on departments (organisation_id, sort);

-- Every organisation starts with the four that were hardcoded, so nothing that
-- already exists has to be re-pointed.
insert into departments (organisation_id, slug, name, sort)
select o.id, d.slug, d.name, d.sort
  from organisations o
  cross join (values ('front_desk', 'Front desk', 0),
                     ('housekeeping', 'Housekeeping', 1),
                     ('fnb', 'Food & beverage', 2),
                     ('maintenance', 'Maintenance', 3)) as d(slug, name, sort)
 on conflict (organisation_id, slug) do nothing;

-- The constraints that made a fifth team impossible. The set of teams is now a
-- table, and which slugs are legal depends on the organisation — which a CHECK
-- constraint cannot express.
alter table staff            drop constraint if exists staff_department_check;
alter table items            drop constraint if exists items_department_check;
alter table requests         drop constraint if exists requests_department_check;
alter table escalation_rules drop constraint if exists escalation_rules_department_check;

-- staff.department still may not be empty, and 'all' is still meaningful.
alter table staff drop constraint if exists staff_department_present;
alter table staff add constraint staff_department_present check (length(department) > 0);

-- ----------------------------------------------------- staff on more than one team
-- A department account used to see exactly one team's board, so a hotel whose
-- head of housekeeping also runs the laundry had to choose which half of the
-- job the software knew about, or promote them to manager and hand them the
-- whole property.
--
-- An array rather than a join table: it is a handful of slugs, it is read with
-- the staff row on every single request, and the routed columns elsewhere
-- already hold slugs rather than ids. `department` stays the person's main
-- team — it is what the header shows, and what lib/notify.ts matches on.
alter table staff add column if not exists extra_teams text[] not null default '{}';
-- ------------------------------------------------- staff phone verification
-- A staff phone number used to be write-only: the app sent to it and a wrong
-- number meant a missed message. WhatsApp action links change the stakes —
-- the link IS the credential, so one mistyped digit hands a stranger a working
-- job list. The number now has to prove itself before it earns a link.
--
-- Unverified is not silent: lib/notify.ts still sends, without the link. See
-- WHATSAPP-TESTING-PLAN.md §5.
alter table staff add column if not exists phone_verified_at       timestamptz;
alter table staff add column if not exists phone_code              text;
alter table staff add column if not exists phone_code_expires      timestamptz;
alter table staff add column if not exists phone_code_sent_at      timestamptz;
alter table staff add column if not exists phone_code_attempts     int not null default 0;
alter table staff add column if not exists phone_code_locked_until timestamptz;

-- Verification follows the number, not the row. A trigger rather than a line in
-- updateStaff, because updateStaff is not the only writer — createStaff,
-- db/seed.mjs and a hand-run update all change phones, and a verification flag
-- that outlives the number it verified is worse than no flag at all. One guard
-- where every path already converges.
create or replace function staff_phone_changed() returns trigger language plpgsql as $$
begin
  new.phone_verified_at       := null;
  new.phone_code              := null;
  new.phone_code_expires      := null;
  new.phone_code_sent_at      := null;
  new.phone_code_attempts     := 0;
  new.phone_code_locked_until := null;
  return new;
end $$;

drop trigger if exists staff_phone_reset on staff;
create trigger staff_phone_reset before update of phone on staff
  for each row when (old.phone is distinct from new.phone)
  execute function staff_phone_changed();

-- --------------------------------------------------------- outbound messages
-- A queue for when the app cannot reach the WhatsApp gateway directly.
--
-- Tailscale Funnel does not serve this tailnet (WHATSAPP-TESTING-PLAN.md §2),
-- so Vercel cannot call the gateway on the laptop. Rather than expose anything,
-- the direction is reversed: the app writes a row here and a drainer running
-- beside the gateway picks it up. Nothing inbound, nothing to install.
--
-- Only used when OPENWA_OUTBOX=1. Off, lib/notify.ts sends inline as before.
create table if not exists outbound_messages (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text
);

-- The drainer's one query: oldest unsent first.
create index if not exists outbound_pending_idx
  on outbound_messages (created_at) where sent_at is null;

-- ------------------------------------------------- the audit log is append-only
-- The logging itself was already complete — 48 call sites and 42 actions, board
-- status transitions included. What was missing was the guarantee: `audit_log`
-- was an ordinary table and the application's own role could rewrite or delete
-- any row in it, which makes "audit log" a description of intent rather than a
-- property of the system.
--
-- A trigger rather than `revoke update, delete`, for two reasons. Supabase's
-- pooled role is frequently the table owner, and an owner ignores its own
-- revokes — so a grant-based approach can be a silent no-op. And a revoke is
-- lost the moment a role is recreated, while a trigger travels with the schema
-- and shows up in every dump.
--
-- Deliberately not a hash chain. `prev_hash` per row defends against somebody
-- who already has direct database access and can therefore also drop this
-- trigger; that is a different threat model from this one.
create or replace function audit_is_append_only() returns trigger language plpgsql as $$
begin
  -- One exception, and it is not a loophole. All three of `staff_id`,
  -- `property_id` and `organisation_id` are `on delete set null`, so deleting
  -- a staff member, a property or a whole customer asks Postgres to null those
  -- pointers on every audit row that referenced them. That is not an edit to
  -- the record: the actor, the action, the entity, the meta and the timestamp
  -- are all untouched, and the actor's *name* was always stored as text
  -- precisely so the trail survives the account. All that is released is a
  -- pointer to a row that no longer exists.
  --
  -- Refused outright, the audit log becomes the reason a customer cannot be
  -- off-boarded — found the first time it was tried, and then found a second
  -- time with `staff_id`, because deleting an organisation cascades to its
  -- staff before it reaches the log.
  --
  -- Deliberately narrow: every other column must be byte-identical, compared
  -- as jsonb so that a column added later is covered without anybody
  -- remembering to come back here, and the three pointers may only move toward
  -- null. An update that rewrites `actor` while also nulling `property_id` is
  -- still refused.
  if tg_op = 'UPDATE'
     and to_jsonb(new) - 'staff_id' - 'property_id' - 'organisation_id'
       = to_jsonb(old) - 'staff_id' - 'property_id' - 'organisation_id'
     and (new.staff_id is null or new.staff_id = old.staff_id)
     and (new.property_id is null or new.property_id = old.property_id)
     and (new.organisation_id is null or new.organisation_id = old.organisation_id)
  then
    return new;
  end if;

  raise exception 'audit_log is append-only: % on audit row % was refused',
    lower(tg_op), coalesce(old.id::text, '(unknown)')
    using errcode = 'restrict_violation',
          hint = 'Correct the record by appending a new entry, not by editing this one.';
end;
$$;

drop trigger if exists audit_append_only on audit_log;
create trigger audit_append_only
  before update or delete on audit_log
  for each row execute function audit_is_append_only();

-- ------------------------------------------------------------- guest contact
-- Optional, taken at check-in, and the only reason it exists is to send the
-- welcome card to the phone the guest will actually use it on. Cleared on
-- checkout alongside everything else about that stay, so the hotel is not
-- quietly accumulating a marketing list out of a room-service product.
alter table rooms add column if not exists guest_phone text;

-- -------------------------------------------------------------- off-boarding
-- A customer leaving is not one button. Suspending is reversible and takes
-- effect everywhere immediately — nobody on that customer can sign in and no
-- guest link opens — which is what a hotel that has given notice, or is
-- disputing an invoice, actually needs. Deleting is the separate, final step,
-- and `lib/organisations.ts` will not do it until the customer has been
-- suspended first.
alter table organisations add column if not exists suspended_at timestamptz;
