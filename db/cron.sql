-- HConcierge - escalation sweep via Supabase pg_cron.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- after the app is deployed and you know its URL.
--
-- Why not Vercel Cron? On the Hobby plan a cron job may only run once a DAY, which
-- is useless for a ten-minute sweep. Postgres schedules this itself at no cost and
-- pg_net makes the outbound HTTP call.
--
-- Budget: */10 is 6/hour x 24 = 144 runs/day, inside the 200/day cap. If you ever
-- tighten it, */8 (180/day) is the floor.
--
-- The job calls the app rather than reimplementing the sweep in SQL, so the
-- escalation rules and the WhatsApp fan-out stay in lib/notify.ts and there is only
-- one definition of "late" in the system.
--
-- Replace TWO placeholders below:
--   YOUR_HCONCIERGE_DOMAIN -> the deployed host, e.g. hconcierge.vercel.app
--                             (no scheme, no trailing slash)
--   YOUR_CRON_SECRET       -> the CRON_SECRET from the app's environment
--
-- The domain is a placeholder rather than a fixed value because a URL baked into a
-- tracked file is a URL that goes stale silently: the job keeps firing, keeps getting
-- an error from a host nobody owns any more, and no escalation is ever sent while the
-- app itself looks perfectly healthy.
--
-- The secret is deliberately NOT stored in this file, because this file is tracked by
-- git. It does end up inside cron.job.command once scheduled, which is unavoidable
-- with pg_net - treat CRON_SECRET as a shared secret between Supabase and the app
-- rather than a user credential. Vault does not help here: the job body has to
-- resolve it at call time either way.

create extension if not exists pg_cron;

-- `with schema extensions`, because without it pg_net is created in whatever schema
-- happens to be current - usually `public`, which Supabase's linter flags and which a
-- destructive schema reset would drop along with the app's own tables. The functions
-- themselves always live in `net` regardless, which is why the cron command below
-- calls `net.http_post`.
create extension if not exists pg_net with schema extensions;

-- Re-running is safe: drop any previous schedule first.
select cron.unschedule('hconcierge-escalate')
where exists (select 1 from cron.job where jobname = 'hconcierge-escalate');

select cron.schedule(
  'hconcierge-escalate',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_HCONCIERGE_DOMAIN/api/cron/escalate',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb,
    -- Comfortably inside the route's 60s maxDuration.
    timeout_milliseconds := 20000
  );
  $$
);

-- ------------------------------------------ pg_cron's own log grows without limit
-- cron.job_run_details gets one row per run and pg_cron removes none. At 144 runs a
-- day that is ~52,000 rows a year whether or not anyone uses the app. Far slower than
-- a per-minute job, but still unbounded.
--
-- Nothing in HConcierge rotates it today. Keeping a week of history is enough to
-- diagnose "this has been failing since Tuesday", so if it ever needs bounding:
--
--   delete from cron.job_run_details where end_time < now() - interval '7 days';
--
-- The delete only marks tuples dead; autovacuum returns the space. To reclaim it at
-- once after a large first prune:
--   vacuum (analyze) cron.job_run_details;

-- ------------------------------------------------------ if escalations go silent
-- The dangerous failure, because Postgres calls it a success: the URL above going
-- stale. net.http_post only QUEUES the request, so cron.job_run_details records
-- `succeeded` as soon as the statement runs - it never learns what came back. A
-- renamed or deleted deployment will produce thousands of consecutive "successful"
-- ticks that all got a 404, while no escalation is sent at all.
--
-- The only place the truth exists is net._http_response. A 401 there means
-- CRON_SECRET differs between Supabase and the app; a 404 means this file was re-run
-- with the wrong domain, or not re-run after a rename.
--
-- The other failure: pg_net disappearing from the database. The job keeps firing and
-- fails instantly with `ERROR: schema "net" does not exist`. Nothing in the app can
-- report that, because the route is never reached. The whole fix is:
--
--   create extension if not exists pg_net with schema extensions;
--
-- Keep `with schema extensions`. pg_net reports extrelocatable = false, so
-- ALTER EXTENSION ... SET SCHEMA is refused afterwards - the schema is only choosable
-- at creation. To move an existing one out of `public`, drop and recreate in a single
-- transaction so no tick can land while net.http_post is absent:
--
--   begin;
--   drop extension pg_net;
--   create extension pg_net with schema extensions;
--   -- must return 1 before you commit; roll back if it doesn't
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'net' and p.proname = 'http_post';
--   commit;
--
-- ------------------------------------------------------------------ verification
-- Confirm the job is registered:
--   select jobid, jobname, schedule, active from cron.job;
--
-- Whether Postgres fired it (not what the app replied):
--   select runid, status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'hconcierge-escalate')
--   order by start_time desc
--   limit 20;
--
-- What the app actually returned:
--   select id, status_code, content, created
--   from net._http_response
--   order by created desc
--   limit 20;
--
-- A 200 with {"escalated":0} is the normal idle result - the sweep ran and nothing
-- was overdue.
--
-- -------------------------------------------------------------------- teardown
--   select cron.unschedule('hconcierge-escalate');
