-- Keep the free Supabase project active with a small, private database write.
-- Three runs per day match Supabase's guidance that a few daily user queries
-- are typically enough to prevent automatic pausing.

create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.project_keepalive (
  singleton boolean primary key default true check (singleton),
  last_ping_at timestamptz not null default clock_timestamp(),
  ping_count bigint not null default 0 check (ping_count >= 0)
);

revoke all on table private.project_keepalive from public, anon, authenticated;

insert into private.project_keepalive (singleton)
values (true)
on conflict (singleton) do nothing;

select cron.schedule(
  'workout_tracker_keepalive',
  '17 2,10,18 * * *',
  $$
    update private.project_keepalive
    set last_ping_at = clock_timestamp(),
        ping_count = ping_count + 1
    where singleton;
  $$
);
