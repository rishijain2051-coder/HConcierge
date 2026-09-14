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
  department    text not null check (department in ('front_desk','housekeeping','fnb','maintenance','all')),
  role          text not null default 'staff' check (role in ('admin','manager','staff')),
  phone         text,
  active        boolean not null default true,
  must_change_password boolean not null default false,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists staff_username_key on staff (lower(username));

-- admins are group-level and have no property; everyone else must have one
alter table staff drop constraint if exists staff_property_required;
alter table staff add constraint staff_property_required
  check (role = 'admin' or property_id is not null);

-- -------------------------------------------------------------------- rooms
-- token is what the printed QR encodes. Rotated at checkout so a previous
-- guest's photo of the QR stops working.
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
  department      text not null check (department in ('front_desk','housekeeping','fnb','maintenance')),
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
  department      text not null check (department in ('front_desk','housekeeping','fnb','maintenance')),
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

-- platform and admin are property-less; everyone below them is pinned to one.
-- The organisation columns stay nullable at this level and are enforced in
-- lib/admin.ts, which is the only writer.
alter table staff drop constraint if exists staff_property_required;
alter table staff add constraint staff_property_required
  check (role in ('platform','admin') or property_id is not null);

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
  department      text check (department in ('front_desk','housekeeping','fnb','maintenance')),
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
