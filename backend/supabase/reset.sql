-- =============================================================================
-- VinaX database · RESET
--
-- Drops every VinaX table, view and function so schema.sql can be applied to
-- a clean slate. THIS DELETES ALL DATA. Run it only when you mean to start
-- over; then paste schema.sql and run that. It also drops the old AI tables
-- and functions schema versions 1 and 2 had (ai_calls, shared_chats,
-- stats_ai, ai_usage_since), the personal engine's (versions 7–20) and the
-- song reactions of versions 19–24 (song_reactions, song_reaction_counts,
-- stats_reactions), in case they are still there.
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
           'room_request', 'room_control', 'room_sweep', 'purge_events', 'retire_push_devices', 'uptime_tick', 'uptime_report',
           'table_stats', 'table_counts', 'ai_conversation_search', 'ai_artifact_list', 'ai_export', 'ai_take_daily',
           'signed_devices', '_ist_today', '_error_shape', 'admin_users', 'admin_user_filters', 'user_profile', 'purge_kind', 'notification_opened',
           'account_set_password', 'account_check_password', 'account_has_password', 'song_reaction_counts',
           '_device_key', '_listen_spans', '_window_start', 'listen_time', 'app_time', 'account_app_time', 'profile_app_time',
           'device_breakdown', 'weekly_summary', 'profile_extras', 'owner_tags', 'ai_feedback_stats')
           or p.proname like 'outreach\_%' or p.proname = '_outreach_people'
           or p.proname like 'personal\_%')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop table if exists
  personal_colisten, personal_pages, personal_exposure, personal_taste, personal_events, personal_songs,
  ai_feedback, ai_memory_prefs, ai_memories, ai_shares, ai_daily_usage, ai_attachments, ai_messages, ai_conversations, ai_projects,
  owner_notes, outreach, song_reactions, admins, error_status,
  job_runs, uptime_latest, uptime_days, audit_log, experiments, settings_history, settings,
  notifications, push_devices, room_members, rooms, blocked_content, feedback, ai_calls, events,
  shared_chats, shared_playlists, follows, profiles,
  email_codes, account_passwords, sign_ins, account_backups, accounts, listeners, meta
cascade;

select 'VinaX database reset — now run schema.sql' as done;
