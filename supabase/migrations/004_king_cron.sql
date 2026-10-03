-- Production-only migration. Run after 003 in Supabase SQL Editor.
-- The embedded PostgreSQL used by unit tests does not provide pg_cron.
create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'neon-maze-daily-leader',
  '59 23 * * *',
  $$select private.capture_daily_leader((clock_timestamp() at time zone 'UTC')::date)$$
);
