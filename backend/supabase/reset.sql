-- =============================================================================
-- VinaX database · RESET
--
-- Drops every VinaX table, view and function so schema.sql can be applied to
-- a clean slate. THIS DELETES ALL DATA. Run it only when you mean to start
-- over; then paste schema.sql and run that. It also drops the old AI tables
-- and functions schema versions 1 and 2 had (ai_calls, shared_chats,
-- stats_ai, ai_usage_since), in case they are still there.
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
           'table_stats', 'table_counts', 'ai_conversation_search'))
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists
  ai_attachments, ai_messages, ai_conversations,
  job_runs, uptime_latest, uptime_days, audit_log, experiments, settings_history, settings,
  notifications, push_devices, room_members, rooms, blocked_content, feedback, ai_calls, events,
  shared_chats, shared_playlists, follows, profiles,
  account_backups, accounts, listeners, meta
cascade;

select 'VinaX database reset — now run schema.sql' as done;
