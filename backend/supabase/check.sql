-- =============================================================================
-- VinaX database · CHECK
--
-- Proves a database that has schema.sql applied really works: seeds a few
-- rows, calls every function the Worker calls and asserts on the answers,
-- then rolls everything back. It writes nothing that outlives the run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f check.sql
--
-- CI runs it on a fresh Postgres (.github/workflows/schema.yml). It is safe
-- against a real project too (the seed ids all start with `check_` and the
-- transaction rolls back), but the workflow only runs it on the scratch
-- database, so the production database is never touched by a test.
-- =============================================================================

begin;

-- ------------------------------------------------------------------ seed --
insert into listeners (id, display_name, handle, platform, app_version, country, region, city, first_seen, last_seen) values
  ('check_l1', 'Asha', 'check_asha', 'web',     '14.0.1', 'IN', 'TG', 'Hyderabad', now() - interval '20 days', now()),
  ('check_l2', 'Ravi', null,         'android', '14.0.0', 'IN', 'KA', 'Bengaluru', now() - interval '2 days',  now() - interval '10 days'),
  ('check_l3', null,   null,         'web',     null,     'US', null, null,        now() - interval '40 days', now() - interval '35 days');

insert into accounts (id, email, name, listener_id, platform, created_at, last_seen) values
  ('check_a1', 'check-a@example.com', 'Asha', 'check_l1', 'web', now() - interval '3 days', now()),
  ('check_a2', 'check-b@example.com', 'Bo',   null,       null,  now(),                    now());

insert into account_backups (account_id, payload, version, bytes) values ('check_a1', '{"v": 1}', 1, 8);

insert into events (at, listener_id, kind, song_id, song_title, song_artist, song_image, language, platform, app_version, country, region, city, error_kind, message, meta)
select now() - (g || ' hours')::interval,
       (array['check_l1', 'check_l2', 'check_l3'])[1 + g % 3],
       (array['play', 'skip', 'error', 'search', 'open', 'register', 'complete', 'favorite', 'share', 'heartbeat'])[1 + g % 10],
       'check_s' || (g % 7), 'Check Song ' || (g % 7), 'Check Artist ' || (g % 3), 'img',
       (array['te', 'hi', 'en'])[1 + g % 3], 'web', '14.0.1', 'IN', 'TG', 'Hyderabad',
       case when g % 10 = 2 then 'TypeError' end, case when g % 10 = 2 then 'boom' end, '{"a": 1}'::jsonb
from generate_series(0, 400) g;

insert into ai_calls (at, feature, lane, provider, model, ok, status, error, client, latency_ms, prompt_tokens, completion_tokens)
select now() - (g || ' minutes')::interval, 'chat', 'fast', 'groq', 'check_m' || (g % 2), g % 5 <> 0, 200,
       case when g % 5 = 0 then 'timeout' end, 'web', 100 + g, 10, 20
from generate_series(0, 50) g;

insert into feedback (listener_id, name, kind, message) values ('check_l1', 'Asha', 'bug', 'x'), (null, null, 'idea', 'y');
insert into blocked_content (kind, value, label) values ('song', 'check_s1', 'Check Song 1');
insert into rooms (code, host_token, host_name, current, queue) values ('CHECK1', 'tok', 'Asha', '{"id": "check_s1"}', '[{"song": {"id": "check_s2"}}]');
insert into room_members (room_code, member_id, name) values ('CHECK1', 'check_l1', 'Asha');
insert into push_devices (channel, target, p256dh, auth, platform, lang, country, region, city) values
  ('web', 'https://push.example/check/1', 'k', 'a', 'web', 'en', 'IN', 'TG', 'Hyderabad'),
  ('fcm', 'check_token_1', null, null, 'android', 'te', 'IN', 'KA', 'Bengaluru');
insert into notifications (title, body, dedupe_key) values ('hi', 'there', 'check_1');
insert into settings (key, value) values ('check_setting', '{"on": true}');
insert into settings_history (key, value) values ('check_setting', '{"on": true}');
insert into experiments (key, name) values ('check-exp', 'Check');
insert into audit_log (action, summary) values ('check', 'check');
insert into job_runs (job) values ('check');

-- ------------------------------------------------------------- functions --
do $$
declare v jsonb; n bigint; b boolean;
begin
  -- constraints the Worker relies on
  begin
    insert into listeners (id, handle) values ('check_bad', 'Not Valid!');
    raise exception 'listeners_handle_shape did not refuse an invalid handle';
  exception when check_violation then null;
  end;
  begin
    insert into listeners (id, handle) values ('check_dup', 'check_asha');
    raise exception 'listeners_handle_key did not refuse a duplicate handle';
  exception when unique_violation then null;
  end;
  begin
    insert into events (kind, meta) values ('rec_served', ('{"big": "' || repeat('x', 3000) || '"}')::jsonb);
    raise exception 'events_meta_shape did not refuse a 3 KB meta';
  exception when check_violation then null;
  end;

  v := stats_overview();
  assert (v ->> 'listeners')::int >= 3, 'stats_overview.listeners';
  assert (v ->> 'accounts')::int >= 2, 'stats_overview.accounts';
  assert (v ->> 'plays7d')::int > 0, 'stats_overview.plays7d';
  assert (v ->> 'feedbackNew')::int >= 2, 'stats_overview.feedbackNew';

  v := stats_timeline(14);
  assert jsonb_array_length(v) = 14, 'stats_timeline: 14 days';
  assert (v -> 13 ->> 'day') = to_char(current_date, 'YYYY-MM-DD'), 'stats_timeline: ends today';

  v := stats_music(7, 25);
  assert jsonb_array_length(v -> 'songs') > 0 and jsonb_array_length(v -> 'artists') > 0 and jsonb_array_length(v -> 'languages') > 0, 'stats_music';

  v := stats_geo(7);
  assert jsonb_array_length(v -> 'countries') > 0 and jsonb_array_length(v -> 'cities') > 0, 'stats_geo';

  v := stats_platforms();
  assert jsonb_array_length(v -> 'platforms') >= 2, 'stats_platforms: web and android';

  v := stats_engagement(7);
  assert jsonb_array_length(v -> 'hourly' -> 'cells') = 7 and jsonb_array_length(v -> 'hourly' -> 'cells' -> 0) = 24, 'stats_engagement: 7×24 grid';
  assert (v ->> 'total')::int > 0, 'stats_engagement.total';

  v := stats_retention(8);
  assert jsonb_typeof(v) = 'array', 'stats_retention';

  v := stats_funnel(7);
  assert jsonb_array_length(v) = 7 and (v -> 0 ->> 'listeners')::int > 0, 'stats_funnel';

  v := stats_skips(7, 1);
  assert jsonb_array_length(v) > 0 and (v -> 0 ->> 'rate')::int between 0 and 100, 'stats_skips';

  v := stats_errors(7, 50);
  assert (v ->> 'total')::int > 0 and jsonb_array_length(v -> 'top') > 0, 'stats_errors';

  v := stats_ai(7);
  assert (v -> 'summary' ->> 'total')::int = 51 and (v -> 'summary' ->> 'fail')::int = 11, 'stats_ai.summary';

  v := ai_usage_since(now() - interval '1 day');
  assert jsonb_array_length(v) = 2, 'ai_usage_since: two models';

  v := listener_profile('check_l1', null);
  assert (v -> 'listener' ->> 'id') = 'check_l1' and (v -> 'account' ->> 'id') = 'check_a1', 'listener_profile by listener';
  assert (v -> 'backup' ->> 'version')::int = 1, 'listener_profile.backup';
  assert (v -> 'stats' ->> 'plays')::int > 0 and jsonb_array_length(v -> 'events') > 0, 'listener_profile.stats';
  v := listener_profile(null, 'check_a2');
  assert v -> 'listener' = 'null'::jsonb and (v -> 'account' ->> 'id') = 'check_a2', 'listener_profile: account without a device';

  assert room_request('CHECK1', '{"id": "check_s9", "title": "t"}', 'check_l1'), 'room_request: appended';
  assert not room_request('NOPE00', '{"id": "check_s9"}', 'check_l1'), 'room_request: unknown room is false';
  assert room_request('CHECK1', '{"id": "check_s2"}', 'check_l1'), 'room_request: a queued song is a no-op true';
  select jsonb_array_length(requests) into n from rooms where code = 'CHECK1';
  assert n = 1, 'room_request: de-duplicated against the queue';

  v := room_sweep();
  assert (v ->> 'rooms')::int = 0 and (v ->> 'members')::int = 0, 'room_sweep leaves fresh rooms alone';
  n := purge_events(180);
  assert n = 0, 'purge_events keeps recent events';
  n := retire_push_devices(180);
  assert n = 0, 'retire_push_devices keeps fresh devices';

  perform uptime_tick('check', true, 120);
  perform uptime_tick('check', false, null);
  v := uptime_report(90);
  assert jsonb_array_length(v) >= 1, 'uptime_report';
  select (e ->> 'uptime')::numeric into n from jsonb_array_elements(v) e where e ->> 'component' = 'check';
  assert n = 50, 'uptime_report: one up, one down = 50%';

  assert jsonb_array_length(table_stats()) >= 19, 'table_stats lists every table';
  v := table_counts();
  assert (v ->> 'listeners')::int >= 3 and (v ->> 'rooms')::int >= 1, 'table_counts';

  select count(*) into n from directory where account_id in ('check_a1', 'check_a2');
  assert n = 2, 'directory: one row per person';

  v := delete_listener('check_l1', null);
  assert (v ->> 'listener')::int = 1 and (v ->> 'account')::int = 1 and (v ->> 'events')::int > 0 and (v ->> 'memberships')::int = 1, 'delete_listener by listener';
  select exists (select 1 from account_backups where account_id = 'check_a1') into b;
  assert not b, 'delete_listener: the backup went with the account';
  v := delete_listener(null, 'check_a2');
  assert (v ->> 'account')::int = 1 and (v ->> 'listener')::int = 0, 'delete_listener by account';

  -- security: the public roles can read nothing
  select bool_and(relrowsecurity and relforcerowsecurity) into b
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  assert b, 'row-level security is enabled and forced on every table';
  assert not has_table_privilege('anon', 'public.listeners', 'select'), 'anon cannot read listeners';
  assert not has_table_privilege('authenticated', 'public.events', 'select'), 'authenticated cannot read events';
  assert not has_function_privilege('anon', 'public.stats_overview()', 'execute'), 'anon cannot call stats_overview';

  assert (select (value ->> 'version')::int from meta where key = 'schema') = 1, 'meta.schema.version';
  raise notice 'check.sql: every function answered as expected';
end $$;

rollback;
select 'VinaX schema check passed' as done;
