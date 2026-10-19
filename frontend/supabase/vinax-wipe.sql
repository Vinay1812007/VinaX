-- ============================================================================
-- VinaX — REMOVE THE WHOLE DATABASE (nothing is created)
-- Database dashboard → SQL Editor → paste → Run.
--
-- ⚠  DESTRUCTIVE AND IRREVERSIBLE  ⚠
-- PERMANENTLY DELETES every VinaX table, view and function in the `public`
-- schema (everything named vinax_…) and the status page's uptime history
-- (uptime_daily, uptime_last): Google accounts and synced libraries, listener
-- records and play events, errors, feedback, the admin audit trail, AI logs,
-- push registrations, rooms, experiments, trends, SEO URLs, usernames and
-- every owner setting in vinax_config (AI controls, prices, house rules, site
-- mode, headlines, flags, banners). Nothing else in the project is touched.
--
-- The app does not work until the schema is created again: run vinax-13.sql
-- right after this file (vinax-13-reset.sql is this file + vinax-13.sql in one
-- paste). Afterwards everyone signs in with Google again, devices register
-- for push again on their next open, and console settings must be published
-- again.
-- ============================================================================

do $$
declare r record;
begin
  -- Views first (none are expected), then tables (cascade removes their
  -- indexes, constraints and dependent rows), then functions.
  for r in select table_name from information_schema.views where table_schema = 'public' and table_name like 'vinax\_%' loop
    execute format('drop view if exists public.%I cascade', r.table_name);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'vinax\_%' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'vinax\_%'
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists public.uptime_daily cascade;
drop table if exists public.uptime_last cascade;

-- Check: expect ZERO rows.
select tablename as left_over from pg_tables
where schemaname = 'public' and (tablename like 'vinax\_%' or tablename like 'uptime\_%');
