-- =============================================================================
-- VinaX database · RESET
--
-- Drops every VinaX table, view and function so schema.sql can be applied to
-- a clean slate. THIS DELETES ALL DATA. Run it only when you mean to start
-- over; then paste schema.sql and run that.
-- =============================================================================

drop view if exists directory;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'stats\_%' or p.proname in ('_days', 'ai_usage_since', 'listener_profile', 'delete_listener',
           'room_request', 'room_sweep', 'purge_events', 'retire_push_devices', 'uptime_tick', 'uptime_report',
           'table_stats', 'table_counts'))
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists
  job_runs, uptime_latest, uptime_days, audit_log, experiments, settings_history, settings,
  notifications, push_devices, room_members, rooms, blocked_content, feedback, ai_calls, events,
  account_backups, accounts, listeners, meta
cascade;

select 'VinaX database reset — now run schema.sql' as done;
