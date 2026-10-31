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
-- 15.0 — the social layer
insert into profiles (account_id, handle, public, bio, summary) values ('check_a1', 'check_asha', true, 'hello', '{"topArtists": [{"name": "A", "plays": 3}]}');
insert into profiles (account_id, handle, public) values ('check_a2', 'check_bo', false);
insert into follows (follower_id, followee_id) values ('check_a2', 'check_a1');
insert into shared_playlists (id, owner_id, name, songs, public, collab_token) values ('check_pl0001', 'check_a1', 'Check list', '[{"id": "check_s1"}]', true, 'tok');

insert into events (at, listener_id, kind, song_id, song_title, song_artist, song_image, language, platform, app_version, country, region, city, error_kind, message, meta)
select now() - (g || ' hours')::interval,
       (array['check_l1', 'check_l2', 'check_l3'])[1 + g % 3],
       (array['play', 'skip', 'error', 'search', 'open', 'register', 'complete', 'favorite', 'share', 'heartbeat'])[1 + g % 10],
       'check_s' || (g % 7), 'Check Song ' || (g % 7), 'Check Artist ' || (g % 3), 'img',
       (array['te', 'hi', 'en'])[1 + g % 3], 'web', '14.0.1', 'IN', 'TG', 'Hyderabad',
       case when g % 10 = 2 then 'TypeError' end, case when g % 10 = 2 then 'boom' end, '{"a": 1}'::jsonb
from generate_series(0, 400) g;

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
-- VinaX AI: one chat with a question, an answer and an edited question (a branch)
insert into ai_conversations (id, account_id, title, active_leaf_id) values
  ('00000000-0000-4000-8000-00000000c001', 'check_a1', 'Check chat about ragas', '00000000-0000-4000-8000-00000000c012');
insert into ai_messages (id, conversation_id, parent_id, role, content, created_at) values
  ('00000000-0000-4000-8000-00000000c010', '00000000-0000-4000-8000-00000000c001', null, 'user', '[{"type": "text", "text": "What is a raga?"}]', now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-00000000c011', '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c010', 'assistant', '[{"type": "text", "text": "A melodic framework, like Yaman."}]', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-00000000c012', '00000000-0000-4000-8000-00000000c001', null, 'user', '[{"type": "text", "text": "Explain a raga simply"}]', now());
insert into ai_attachments (id, account_id, conversation_id, name, mime, size, kind, storage_path) values
  ('00000000-0000-4000-8000-00000000c020', 'check_a1', '00000000-0000-4000-8000-00000000c001', 'notes.txt', 'text/plain', 12, 'text', 'check_a1/00000000-0000-4000-8000-00000000c001/00000000-0000-4000-8000-00000000c020');

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

  -- V2 1.0.1 — a signed-in listener on a second device (a new browser) is
  -- still ONE row: the newest device's facts, the device count, no "Device only" twin.
  insert into listeners (id, display_name, platform, account_id, first_seen, last_seen) values
    ('check_l4', 'Asha', 'android', 'check_a1', now() - interval '30 days', now() + interval '1 minute');
  select count(*) into n from directory where account_id = 'check_a1' or listener_id in ('check_l1', 'check_l4');
  assert n = 1, 'directory: two devices of one account are one row';
  select devices into n from directory where account_id = 'check_a1';
  assert n = 2, 'directory: the row counts both devices';
  select (platform = 'android' and listener_id = 'check_l4' and first_seen < now() - interval '29 days') into b from directory where account_id = 'check_a1';
  assert b, 'directory: newest device facts, earliest first-seen';
  v := stats_platforms();
  select (e ->> 'listeners')::int into n from jsonb_array_elements(v -> 'platforms') e where e ->> 'platform' = 'android';
  assert n >= 2, 'stats_platforms counts devices, not directory rows';
  v := listener_profile('check_l4', null);
  assert v -> 'account' ->> 'id' = 'check_a1', 'listener_profile: a second device opens its account';
  delete from listeners where id = 'check_l4';

  -- The twin already listed (signed in before its first usage report) folds
  -- in on the next schema apply; a namesake elsewhere or an hour later does not.
  insert into accounts (id, email, name, city, created_at, last_seen) values ('check_a5', 'twin@example.com', 'Twin Person', 'Hyderabad', now() - interval '1 hour', now());
  insert into listeners (id, display_name, city, first_seen, last_seen) values
    ('check_l5', 'Twin Person', 'Hyderabad', now() - interval '58 minutes', now()),
    ('check_l6', 'Twin Person', 'Delhi',     now() - interval '58 minutes', now()),
    ('check_l7', 'Twin Person', 'Hyderabad', now() - interval '5 minutes',  now());
  update listeners l set account_id = a.id
    from accounts a
    where l.account_id is null
      and not exists (select 1 from accounts x where x.listener_id = l.id)
      and l.display_name is not null and a.name is not null
      and lower(btrim(l.display_name)) = lower(btrim(a.name))
      and coalesce(l.city, '') = coalesce(a.city, '')
      and abs(extract(epoch from (l.first_seen - a.created_at))) < 900
      and (select count(*) from accounts b
           where lower(btrim(b.name)) = lower(btrim(l.display_name))
             and coalesce(b.city, '') = coalesce(l.city, '')
             and abs(extract(epoch from (l.first_seen - b.created_at))) < 900) = 1;
  select count(*) into n from directory where email = 'twin@example.com' or listener_id = 'check_l5';
  assert n = 1, 'twin folded into its account';
  select count(*) into n from listeners where id in ('check_l6', 'check_l7') and account_id is null;
  assert n = 2, 'namesakes elsewhere or later stay separate';
  delete from listeners where id in ('check_l5', 'check_l6', 'check_l7');
  delete from accounts where id = 'check_a5';

  -- VinaX AI: search by title and by message text, scoped to the account
  select count(*) into n from ai_conversation_search('check_a1', 'ragas', null, 30);
  assert n = 1, 'ai_conversation_search: by title';
  select count(*) into n from ai_conversation_search('check_a1', 'yaman', null, 30);
  assert n = 1, 'ai_conversation_search: by message text';
  select count(*) into n from ai_conversation_search('check_a2', 'ragas', null, 30);
  assert n = 0, 'ai_conversation_search: another account sees nothing';
  select count(*) into n from ai_conversation_search('check_a1', '%', null, 30);
  assert n = 0, 'ai_conversation_search: % is literal, not a wildcard';
  -- VinaX AI daily allowances: a limit of 2 gives two, then no; 0 gives none
  delete from ai_daily_usage where kind = 'check_kind';
  assert ai_take_daily('check_kind', 2) and ai_take_daily('check_kind', 2), 'ai_take_daily: within the limit';
  assert not ai_take_daily('check_kind', 2), 'ai_take_daily: the limit holds';
  assert not ai_take_daily('check_kind_zero', 0), 'ai_take_daily: 0 means off';
  assert (select count from ai_daily_usage where kind = 'check_kind') = 2, 'ai_take_daily: counted once each';

  begin
    insert into ai_attachments (id, account_id, name, mime, size, kind, storage_path) values ('00000000-0000-4000-8000-00000000c021', 'check_a1', 'x', 'x', 1, 'video', 'x');
    assert false, 'ai_attachments.kind refuses an unknown kind';
  exception when check_violation then null;
  end;

  v := ai_export('check_a1');
  assert v ->> 'format' = 'vinax-ai-chats' and jsonb_array_length(v -> 'conversations') = 1, 'ai_export: one chat';
  assert jsonb_array_length(v -> 'conversations' -> 0 -> 'messages') = 3, 'ai_export: every message, every branch';
  assert jsonb_array_length(ai_export('check_a2') -> 'conversations') = 0, 'ai_export: another account gets nothing';
  begin
    insert into ai_messages (id, conversation_id, role, content) values ('00000000-0000-4000-8000-00000000c0ff', '00000000-0000-4000-8000-00000000c001', 'system', '[]');
    assert false, 'ai_messages.role refuses system';
  exception when check_violation then null;
  end;

  v := delete_listener('check_l1', null);
  assert (v ->> 'listener')::int = 1 and (v ->> 'account')::int = 1 and (v ->> 'events')::int > 0 and (v ->> 'memberships')::int = 1, 'delete_listener by listener';
  select exists (select 1 from account_backups where account_id = 'check_a1') into b;
  assert not b, 'delete_listener: the backup went with the account';
  select exists (select 1 from profiles where account_id = 'check_a1') into b;
  assert not b, 'delete_listener: the profile went with the account';
  select exists (select 1 from follows where followee_id = 'check_a1') into b;
  assert not b, 'delete_listener: follows of the account went too';
  select exists (select 1 from shared_playlists where owner_id = 'check_a1') into b;
  assert not b, 'delete_listener: shared playlists went with the account';
  select exists (select 1 from ai_conversations where account_id = 'check_a1') into b;
  assert not b, 'delete_listener: VinaX AI chats went with the account';
  select exists (select 1 from ai_messages where conversation_id = '00000000-0000-4000-8000-00000000c001') into b;
  assert not b, 'delete_listener: VinaX AI messages went with their chat';
  select exists (select 1 from ai_attachments where account_id = 'check_a1') into b;
  assert not b, 'delete_listener: VinaX AI attachments went with the account';
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
  assert not has_table_privilege('anon', 'public.ai_messages', 'select'), 'anon cannot read VinaX AI messages';
  assert not has_function_privilege('anon', 'public.ai_conversation_search(text, text, timestamptz, integer)', 'execute'), 'anon cannot search VinaX AI chats';

  assert (select (value ->> 'version')::int from meta where key = 'schema') = 6, 'meta.schema.version';
  raise notice 'check.sql: every function answered as expected';
end $$;

rollback;
select 'VinaX schema check passed' as done;
