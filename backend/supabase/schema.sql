-- =============================================================================
-- VinaX database · schema version 2
--
-- The whole database in one file. Open the Supabase dashboard, SQL Editor,
-- paste this file, Run. Every statement is idempotent, so re-running it is
-- safe and never deletes data (reset.sql is the file that wipes).
--
-- Who talks to it: only the Cloudflare Worker (backend/worker), with the
-- service-role key. Row-level security is on and FORCED on every table and no
-- policy exists, so the public anon key can read and write nothing. The app
-- and the owner console never hold a database key.
--
-- What is NOT here: raw IP addresses, precise locations, AI chats, the
-- listener's library. Geo is Cloudflare's edge country / region / city.
--
-- Layout
--   1. extensions and meta        2. listeners and accounts
--   3. usage events               4. AI calls
--   5. feedback and blocked content
--   6. Listen Together rooms      7. push devices and notifications
--   8. settings and experiments   9. audit log, uptime, job runs
--  10. views                     11. functions (stats_*, room_*, housekeeping)
--  12. security
-- =============================================================================

-- ----------------------------------------------------------------- 1. meta --
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table meta is 'Database facts the Worker reads: schema version, applied-at time.';

-- ---------------------------------------------------- 2. listeners, accounts --

-- One row per device that opted in to usage sharing (or claimed a handle).
-- `id` is the server-derived device id (never the client's raw install uuid).
create table if not exists listeners (
  id            text primary key,
  display_name  text,
  handle        text,
  platform      text not null default 'web',          -- web | android | ios
  app_version   text,
  country       text,                                   -- ISO-2 from the edge
  region        text,
  city          text,
  now_playing   jsonb,                                  -- { id, title, artist, image, language }
  is_playing    boolean not null default false,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  constraint listeners_handle_shape check (handle is null or handle ~ '^[a-z0-9_]{3,20}$'),
  constraint listeners_now_playing_shape check (now_playing is null or jsonb_typeof(now_playing) = 'object')
);
create unique index if not exists listeners_handle_key on listeners (lower(handle)) where handle is not null;
create index if not exists listeners_last_seen_idx on listeners (last_seen desc);
create index if not exists listeners_platform_idx on listeners (platform, last_seen desc);
create index if not exists listeners_name_trgm on listeners using gin (display_name extensions.gin_trgm_ops);
create index if not exists listeners_handle_trgm on listeners using gin (handle extensions.gin_trgm_ops);
comment on table listeners is 'Anonymous devices: latest state only (name, handle, platform, coarse geo, what is playing).';

-- One row per Google sign-in. `id` is Google's stable subject id.
create table if not exists accounts (
  id              text primary key,
  email           text,
  email_verified  boolean not null default false,
  name            text,
  picture         text,
  listener_id     text references listeners (id) on delete set null,
  platform        text,
  app_version     text,
  country         text,
  region          text,
  city            text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);
create index if not exists accounts_last_seen_idx on accounts (last_seen desc);
create index if not exists accounts_listener_idx on accounts (listener_id) where listener_id is not null;
create index if not exists accounts_email_trgm on accounts using gin (email extensions.gin_trgm_ops);
create index if not exists accounts_name_trgm on accounts using gin (name extensions.gin_trgm_ops);
comment on table accounts is 'Signed-in listeners (Google). Deleting the row deletes the synced backup with it.';

-- The signed-in listener's synced copy of their library and settings — the
-- app's own backup-file JSON. `version` rises by one on every write; a write
-- that names an older version is refused so two devices merge, not overwrite.
create table if not exists account_backups (
  account_id  text primary key references accounts (id) on delete cascade,
  payload     jsonb not null,
  version     bigint not null default 1,
  bytes       integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint account_backups_payload_shape check (jsonb_typeof(payload) = 'object')
);

-- 15.0 — the social layer, all opt-in and all keyed by the account.
--
-- A public profile: what the listener chose to show (a handle, a line, the
-- artists and songs they play most, what is playing now). `summary` is the
-- app's own digest, written by the device with sync; nothing is derived
-- server-side. `public` false keeps it to the listener and their followers.
create table if not exists profiles (
  account_id  text primary key references accounts (id) on delete cascade,
  handle      text not null,
  public      boolean not null default false,
  bio         text,
  summary     jsonb not null default '{}'::jsonb,       -- { topArtists: [{name, plays}], recentLikes: [song…], topLanguages: [{id, pct}] }
  now_playing jsonb,                                    -- { id, title, artist, image } when the listener shares it
  share_now   boolean not null default false,
  updated_at  timestamptz not null default now(),
  constraint profiles_handle_shape check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 160),
  constraint profiles_summary_shape check (jsonb_typeof(summary) = 'object')
);
create unique index if not exists profiles_handle_key on profiles (lower(handle));

-- Who follows whom. One direction per row; no approval step (profiles are
-- public or not, and a private profile shows only to followers it follows back).
create table if not exists follows (
  follower_id text not null references accounts (id) on delete cascade,
  followee_id text not null references accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on follows (followee_id);

-- A playlist that left the device: a public page (`public`), collaborators
-- through `collab_token` (a secret in the invite link), one owner. `songs`
-- carries the app's own song records (≤ 500) so a public page needs no
-- catalogue call. `version` rises by one on every write, like a backup.
create table if not exists shared_playlists (
  id           text primary key,                        -- 12 url-safe chars
  owner_id     text not null references accounts (id) on delete cascade,
  name         text not null,
  description  text,
  songs        jsonb not null default '[]'::jsonb,
  public       boolean not null default false,
  collab_token text,
  version      bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shared_playlists_name_len check (char_length(name) between 1 and 80),
  constraint shared_playlists_songs_shape check (jsonb_typeof(songs) = 'array')
);
create index if not exists shared_playlists_owner_idx on shared_playlists (owner_id, updated_at desc);

-- A VinaX AI conversation the listener chose to share: a read-only copy at
-- a link, kept 90 days, deleted with the account. Chats never land here
-- otherwise (see the header).
create table if not exists shared_chats (
  id          text primary key,                         -- 12 url-safe chars
  owner_id    text not null references accounts (id) on delete cascade,
  title       text,
  payload     jsonb not null,                           -- { messages: [{role, content}], model? }
  bytes       integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '90 days',
  constraint shared_chats_payload_shape check (jsonb_typeof(payload) = 'object')
);
create index if not exists shared_chats_owner_idx on shared_chats (owner_id, created_at desc);
create index if not exists shared_chats_expires_idx on shared_chats (expires_at);

-- ------------------------------------------------------------- 3. events --

-- Append-only usage log, written only after the listener opted in.
-- kind: open | heartbeat | play | pause | complete | skip | favorite | search |
--       share | register | error | lyric-miss | rec_served | rec_outcome | …
create table if not exists events (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  listener_id  text,
  kind         text not null,
  song_id      text,
  song_title   text,
  song_artist  text,
  song_image   text,
  language     text,
  platform     text,
  app_version  text,
  country      text,
  region       text,
  city         text,
  error_kind   text,
  message      text,
  meta         jsonb,
  verified     boolean not null default false,          -- the device proved its signed id
  constraint events_meta_shape check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 2048))
);
create index if not exists events_at_idx on events (at desc);
create index if not exists events_kind_at_idx on events (kind, at desc);
create index if not exists events_listener_at_idx on events (listener_id, at desc);
create index if not exists events_song_idx on events (song_id) where kind = 'play';
comment on table events is 'Consented usage events. Purged by housekeeping after settings.retention.eventsDays (default 180).';

-- ---------------------------------------------------------- 4. AI calls --

create table if not exists ai_calls (
  id                 bigint generated always as identity primary key,
  at                 timestamptz not null default now(),
  feature            text not null,                     -- chat | dj | playlist | search | home | title | …
  lane               text,
  provider           text,
  model              text,
  ok                 boolean not null default false,
  status             integer,
  error              text,
  client             text,                              -- web | android | ios | console
  latency_ms         integer,
  prompt_tokens      integer,
  completion_tokens  integer
);
create index if not exists ai_calls_at_idx on ai_calls (at desc);
create index if not exists ai_calls_feature_at_idx on ai_calls (feature, at desc);
comment on table ai_calls is 'One row per model call: what, which model, how long, how many tokens. Never the prompt.';

-- ------------------------------------------- 5. feedback, blocked content --

create table if not exists feedback (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  listener_id  text,
  name         text,
  kind         text not null default 'other',            -- bug | idea | content | other
  message      text not null,
  platform     text,
  app_version  text,
  country      text,
  city         text,
  status       text not null default 'new',              -- new | read | resolved
  note         text,                                     -- the owner's note
  resolved_at  timestamptz,
  constraint feedback_status_shape check (status in ('new', 'read', 'resolved'))
);
create index if not exists feedback_status_at_idx on feedback (status, at desc);

create table if not exists blocked_content (
  id          bigint generated always as identity primary key,
  kind        text not null,                             -- song | artist | keyword
  value       text not null,                             -- song id, artist name, keyword
  label       text,                                      -- what the owner sees (a song title)
  reason      text,
  created_at  timestamptz not null default now(),
  constraint blocked_content_kind_shape check (kind in ('song', 'artist', 'keyword'))
);
create unique index if not exists blocked_content_key on blocked_content (kind, lower(value));

-- ------------------------------------------------------ 6. Listen Together --

create table if not exists rooms (
  code        text primary key,                          -- 6 chars, the join credential
  host_token  text not null,                             -- host secret, never returned twice
  host_name   text,
  current     jsonb,                                     -- the song playing
  queue       jsonb not null default '[]'::jsonb,        -- host's next songs (≤ 12)
  requests    jsonb not null default '[]'::jsonb,        -- guests' requests (≤ 20)
  position    double precision not null default 0,
  playing     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  messages    jsonb not null default '[]'::jsonb,        -- 15.0: a short chat (≤ 40 lines: {by, text, at})
  skip_votes  jsonb not null default '[]'::jsonb         -- 15.0: member ids voting to skip the current song
);
create index if not exists rooms_updated_idx on rooms (updated_at desc);
-- A database made before 15.0 gains the two columns in place.
alter table rooms add column if not exists messages jsonb not null default '[]'::jsonb;
alter table rooms add column if not exists skip_votes jsonb not null default '[]'::jsonb;

create table if not exists room_members (
  room_code    text not null references rooms (code) on delete cascade,
  member_id    text not null,
  name         text,
  last_seen    timestamptz not null default now(),
  reaction     text,
  reacted_at   timestamptz,
  primary key (room_code, member_id)
);
create index if not exists room_members_seen_idx on room_members (room_code, last_seen desc);

-- ------------------------------------------- 7. push devices, notifications --

-- Every device that can receive a push, on either channel.
--   web: `target` is the browser push endpoint, p256dh/auth are its keys
--   fcm: `target` is the Android registration token
create table if not exists push_devices (
  id              bigint generated always as identity primary key,
  channel         text not null,                          -- web | fcm
  target          text not null,
  p256dh          text,
  auth            text,
  platform        text,
  lang            text,
  country         text,
  region          text,
  city            text,
  tz_offset       integer,                                -- minutes east of UTC (quiet hours)
  active          boolean not null default true,
  last_pushed_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint push_devices_channel_shape check (channel in ('web', 'fcm')),
  constraint push_devices_web_keys check (channel <> 'web' or (p256dh is not null and auth is not null))
);
create unique index if not exists push_devices_target_key on push_devices (target);
create index if not exists push_devices_active_idx on push_devices (channel, active, updated_at desc);
create index if not exists push_devices_geo_idx on push_devices (country, region, city) where active;

-- Everything the owner (or a job) sent, with its delivery receipt.
create table if not exists notifications (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  kind          text not null default 'announcement',    -- announcement | song | system
  title         text not null,
  body          text not null,
  link          text not null default '/',
  audience      jsonb not null default '{}'::jsonb,      -- the filter used
  web_total     integer not null default 0,
  web_sent      integer not null default 0,
  web_gone      integer not null default 0,
  fcm_total     integer not null default 0,
  fcm_sent      integer not null default 0,
  failures      jsonb,                                   -- { "403": 2, "error": 1 }
  dedupe_key    text,
  sent_by       text not null default 'owner',
  retracted_at  timestamptz
);
create unique index if not exists notifications_dedupe_key on notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_at_idx on notifications (at desc);

-- --------------------------------------------- 8. settings, experiments --

-- Published settings: one key, one JSON value. Read by the public config
-- routes (cached), written only from the owner console.
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'owner'
);

create table if not exists settings_history (
  id          bigint generated always as identity primary key,
  key         text not null,
  value       jsonb,                                     -- null = the key was cleared
  at          timestamptz not null default now(),
  by          text not null default 'owner'
);
create index if not exists settings_history_key_idx on settings_history (key, at desc);

create table if not exists experiments (
  key         text primary key,
  name        text,
  variants    jsonb not null default '[]'::jsonb,        -- [{ name, pct }]
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint experiments_key_shape check (key ~ '^[a-z0-9-]{1,40}$')
);

-- ------------------------------------------- 9. audit, uptime, job runs --

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null default 'owner',
  action      text not null,
  target      text,
  summary     text not null,
  before      jsonb,
  after       jsonb,
  request_id  text
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_action_idx on audit_log (action, at desc);

create table if not exists uptime_days (
  component  text not null,
  day        date not null,
  up         integer not null default 0,
  total      integer not null default 0,
  primary key (component, day)
);

create table if not exists uptime_latest (
  component   text primary key,
  ok          boolean not null,
  latency_ms  integer,
  checked_at  timestamptz not null default now()
);

create table if not exists job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  summary      jsonb
);
create index if not exists job_runs_job_idx on job_runs (job, started_at desc);

-- ------------------------------------------------------------- 10. views --

-- Everyone the console lists: each device row, with its account when linked,
-- plus accounts that never linked a device. One row per person as far as the
-- data can tell.
create or replace view directory as
  select l.id                      as listener_id,
         a.id                      as account_id,
         coalesce(a.name, l.display_name) as name,
         l.handle,
         a.email,
         a.picture,
         l.platform,
         l.app_version,
         l.country, l.region, l.city,
         l.now_playing, l.is_playing,
         least(l.first_seen, a.created_at) as first_seen,
         greatest(l.last_seen, a.last_seen) as last_seen
  from listeners l
  left join accounts a on a.listener_id = l.id
  union all
  select null, a.id, a.name, null, a.email, a.picture,
         coalesce(a.platform, 'web'), a.app_version,
         a.country, a.region, a.city,
         null, false, a.created_at, a.last_seen
  from accounts a
  where a.listener_id is null;

-- --------------------------------------------------------- 11. functions --

-- Everything below is `security invoker`: the Worker's service role runs it,
-- the public roles cannot execute it (see section 12).

-- Window helper: 1..365 days.
create or replace function _days(p int) returns int
language sql immutable as $$ select least(greatest(coalesce(p, 7), 1), 365) $$;

-- Overview tiles.
create or replace function stats_overview() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'activeNow',       (select count(*) from listeners where last_seen > now() - interval '90 seconds'),
    'listeners',       (select count(*) from listeners),
    'newListeners24h', (select count(*) from listeners where first_seen > now() - interval '24 hours'),
    'accounts',        (select count(*) from accounts),
    'newAccounts7d',   (select count(*) from accounts where created_at > now() - interval '7 days'),
    'plays24h',        (select count(*) from events where kind = 'play' and at > now() - interval '24 hours'),
    'plays7d',         (select count(*) from events where kind = 'play' and at > now() - interval '7 days'),
    'errors24h',       (select count(*) from events where kind = 'error' and at > now() - interval '24 hours'),
    'dau',             (select count(distinct listener_id) from events where at > now() - interval '24 hours'),
    'wau',             (select count(distinct listener_id) from events where at > now() - interval '7 days'),
    'mau',             (select count(distinct listener_id) from events where at > now() - interval '30 days'),
    'feedbackNew',     (select count(*) from feedback where status = 'new'),
    'pushDevices',     (select count(*) from push_devices where active),
    'roomsActive',     (select count(*) from rooms where updated_at > now() - interval '15 minutes'),
    'aiCalls24h',      (select count(*) from ai_calls where at > now() - interval '24 hours')
  );
$$;

-- Daily series with every day present (zero-filled).
create or replace function stats_timeline(p_days int default 14) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with days as (
    select generate_series((current_date - (_days(p_days) - 1))::date, current_date, '1 day')::date as day
  ),
  ev as (
    select at::date as day,
           count(*) filter (where kind = 'play')   as plays,
           count(*) filter (where kind = 'error')  as errors,
           count(*) filter (where kind = 'search') as searches,
           count(distinct listener_id)             as listeners
    from events
    where at >= (current_date - (_days(p_days) - 1))::timestamptz
    group by 1
  ),
  fresh as (
    select first_seen::date as day, count(*) as new_listeners
    from listeners
    where first_seen >= (current_date - (_days(p_days) - 1))::timestamptz
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'plays', coalesce(ev.plays, 0),
      'listeners', coalesce(ev.listeners, 0),
      'newListeners', coalesce(fresh.new_listeners, 0),
      'errors', coalesce(ev.errors, 0),
      'searches', coalesce(ev.searches, 0)
    ) order by d.day), '[]'::jsonb)
  from days d
  left join ev on ev.day = d.day
  left join fresh on fresh.day = d.day;
$$;

-- Top songs, artists and languages, plus what is rising against the previous window.
create or replace function stats_music(p_days int default 7, p_limit int default 25) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select song_id, song_title, song_artist, song_image, language, listener_id, at
    from events
    where kind = 'play' and at > now() - make_interval(days => _days(p_days))
  ),
  prev as (
    select song_title, song_artist, count(*) as plays
    from events
    where kind = 'play'
      and at <= now() - make_interval(days => _days(p_days))
      and at >  now() - make_interval(days => _days(p_days) * 2)
    group by 1, 2
  ),
  songs as (
    select song_id, song_title, song_artist, max(song_image) as image,
           count(*) as plays, count(distinct listener_id) as listeners
    from ev where song_title is not null
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'songs', coalesce((select jsonb_agg(t) from (
        select song_id as id, song_title as title, song_artist as artist, image, plays, listeners
        from songs order by plays desc, listeners desc limit least(p_limit, 200)) t), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(t) from (
        select song_artist as artist, count(*) as plays, count(distinct listener_id) as listeners
        from ev where song_artist is not null group by 1 order by plays desc limit least(p_limit, 200)) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(language, ''), 'unknown') as language, count(*) as plays, count(distinct listener_id) as listeners
        from ev group by 1 order by plays desc limit 40) t), '[]'::jsonb),
    'rising', coalesce((select jsonb_agg(t) from (
        select s.song_title as title, s.song_artist as artist, s.image, s.plays, coalesce(p.plays, 0) as prev_plays
        from songs s left join prev p using (song_title, song_artist)
        order by (s.plays - coalesce(p.plays, 0)) desc, s.plays desc limit 15) t), '[]'::jsonb)
  );
$$;

-- Where listeners are (edge geo, never IPs).
create or replace function stats_geo(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select country, region, city, listener_id, kind
    from events where at > now() - make_interval(days => _days(p_days))
  )
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(t) from (
        select coalesce(country, 'XX') as country, count(distinct listener_id) as listeners,
               count(*) filter (where kind = 'play') as plays
        from ev group by 1 order by listeners desc limit 60) t), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(t) from (
        select coalesce(country, 'XX') as country, region, coalesce(city, 'Unknown') as city,
               count(distinct listener_id) as listeners, count(*) filter (where kind = 'play') as plays
        from ev group by 1, 2, 3 order by listeners desc limit 150) t), '[]'::jsonb)
  );
$$;

-- Platforms and app versions of everyone in the directory.
create or replace function stats_platforms() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'platforms', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'web') as platform,
               count(*) filter (where listener_id is not null) as listeners,
               count(*) filter (where account_id is not null) as accounts
        from directory group by 1 order by 2 desc) t), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'web') as platform, coalesce(app_version, 'unknown') as "appVersion", count(*) as listeners
        from directory group by 1, 2 order by listeners desc limit 40) t), '[]'::jsonb)
  );
$$;

-- Engagement: hour-of-week heat map (IST), event mix, segments.
create or replace function stats_engagement(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select kind, platform, listener_id, at from events
    where at > now() - make_interval(days => _days(p_days))
  ),
  hm as (
    select extract(dow  from (at at time zone 'Asia/Kolkata'))::int as d,
           extract(hour from (at at time zone 'Asia/Kolkata'))::int as h,
           count(*)::int as n
    from ev where kind in ('play', 'heartbeat') group by 1, 2
  ),
  grid as (
    select gd.d, gh.h, coalesce(hm.n, 0) as n
    from generate_series(0, 6) gd(d) cross join generate_series(0, 23) gh(h)
    left join hm on hm.d = gd.d and hm.h = gh.h
  )
  select jsonb_build_object(
    'byKind', coalesce((select jsonb_agg(t) from (
        select kind, count(*) as n, count(distinct listener_id) as listeners from ev group by 1 order by n desc) t), '[]'::jsonb),
    'byPlatform', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'web') as platform, count(*) as n, count(distinct listener_id) as listeners
        from ev group by 1 order by n desc) t), '[]'::jsonb),
    'hourly', jsonb_build_object(
        'cells', (select jsonb_agg(cells order by d) from (select d, jsonb_agg(n order by h) as cells from grid group by d) r),
        'peak', (select jsonb_build_object('day', d, 'hour', h, 'n', n) from hm where n > 0 order by n desc, d, h limit 1)),
    'segments', jsonb_build_object(
        'new7d',       (select count(*) from listeners where first_seen > now() - interval '7 days'),
        'returning7d', (select count(*) from listeners where last_seen > now() - interval '7 days' and first_seen <= now() - interval '7 days'),
        'inactive30d', (select count(*) from listeners where last_seen <= now() - interval '7 days' and last_seen > now() - interval '30 days'),
        'dormant',     (select count(*) from listeners where last_seen <= now() - interval '30 days'),
        'power',       (select count(*) from (select listener_id from events where kind = 'play' and at > now() - interval '30 days' group by 1 having count(*) >= 20) p)),
    'total', (select count(*) from ev)
  );
$$;

-- Weekly cohorts: of the listeners first seen that week, how many came back.
create or replace function stats_retention(p_weeks int default 8) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with firsts as (
    select listener_id, min(at) as first_at from events
    where listener_id is not null group by 1
  ),
  cohorts as (
    select listener_id, first_at, date_trunc('week', first_at)::date as week
    from firsts where first_at >= now() - make_interval(weeks => least(greatest(coalesce(p_weeks, 8), 1), 26))
  ),
  back as (
    select c.week, c.listener_id,
           bool_or(e.at >= c.first_at + interval '1 day'  and e.at < c.first_at + interval '2 days')  as d1,
           bool_or(e.at >= c.first_at + interval '2 days' and e.at < c.first_at + interval '8 days')  as d7,
           bool_or(e.at >= c.first_at + interval '8 days' and e.at < c.first_at + interval '31 days') as d30
    from cohorts c join events e on e.listener_id = c.listener_id
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'week', to_char(r.week, 'YYYY-MM-DD'), 'size', r.size, 'd1', r.d1, 'd7', r.d7, 'd30', r.d30
    ) order by r.week desc), '[]'::jsonb)
  from (
    select week, count(*) as size,
           count(*) filter (where d1) as d1, count(*) filter (where d7) as d7, count(*) filter (where d30) as d30
    from back group by week
  ) r;
$$;

-- Onboarding funnel: distinct listeners who reached each step.
create or replace function stats_funnel(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select kind, listener_id from events
    where at > now() - make_interval(days => _days(p_days)) and listener_id is not null
      and kind in ('open', 'register', 'play', 'heartbeat', 'complete', 'favorite', 'search', 'share')
  ),
  steps(ord, id, label, kinds) as (values
    (1, 'open',     'Opened the app',  array['open', 'play', 'heartbeat', 'search', 'register']),
    (2, 'register', 'Chose a name',    array['register']),
    (3, 'play',     'Played a song',   array['play', 'heartbeat', 'complete']),
    (4, 'complete', 'Finished a song', array['complete']),
    (5, 'favorite', 'Liked a song',    array['favorite']),
    (6, 'search',   'Searched',        array['search']),
    (7, 'share',    'Shared',          array['share']))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'label', s.label,
      'listeners', (select count(distinct e.listener_id) from ev e where e.kind = any (s.kinds))
    ) order by s.ord), '[]'::jsonb)
  from steps s;
$$;

-- Songs listeners bail on: skip rate among songs with at least p_min plays.
create or replace function stats_skips(p_days int default 7, p_min int default 5) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select kind, song_id, song_title, song_artist, song_image, at from events
    where kind in ('play', 'skip') and at > now() - make_interval(days => _days(p_days))
      and song_id is not null and song_id <> ''
  ),
  agg as (
    select song_id,
           (array_agg(coalesce(song_title, '')  order by at desc))[1] as title,
           (array_agg(coalesce(song_artist, '') order by at desc))[1] as artist,
           (array_agg(coalesce(song_image, '')  order by at desc))[1] as image,
           count(*) filter (where kind = 'play') as plays,
           count(*) filter (where kind = 'skip') as skips
    from ev group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', song_id, 'title', title, 'artist', artist, 'image', image,
      -- A skip whose play fell just before the window can push skips above
      -- plays; a rate is a percentage, so it is capped at 100.
      'plays', plays, 'skips', skips, 'rate', least(100, round(skips::numeric * 100 / plays))::int
    ) order by (skips::numeric / plays) desc, skips desc), '[]'::jsonb)
  from (select * from agg where plays >= greatest(coalesce(p_min, 1), 1) and skips > 0 order by (skips::numeric / plays) desc, skips desc limit 50) r;
$$;

-- App errors reported by listeners.
create or replace function stats_errors(p_days int default 7, p_limit int default 50) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select at, error_kind, message, platform, app_version from events
    where kind = 'error' and at > now() - make_interval(days => _days(p_days))
  ),
  days as (
    select generate_series((current_date - (_days(p_days) - 1))::date, current_date, '1 day')::date as day
  )
  select jsonb_build_object(
    'total', (select count(*) from ev),
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'hits', coalesce(x.n, 0)) order by d.day)
        from days d left join (select at::date as day, count(*) as n from ev group by 1) x on x.day = d.day), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(error_kind, ''), 'error') as "errorKind", coalesce(message, '') as message,
               count(*) as hits, max(at) as "lastSeen",
               array_agg(distinct coalesce(platform, 'web')) as platforms,
               array_agg(distinct app_version) filter (where app_version is not null) as versions
        from ev group by 1, 2 order by hits desc limit least(coalesce(p_limit, 50), 200)) t), '[]'::jsonb)
  );
$$;

-- AI usage: volume, health, latency, tokens.
create or replace function stats_ai(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select * from ai_calls where at > now() - make_interval(days => _days(p_days))
  ),
  days as (
    select generate_series((current_date - (_days(p_days) - 1))::date, current_date, '1 day')::date as day
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (select count(*) from ev),
      'ok', (select count(*) filter (where ok) from ev),
      'fail', (select count(*) filter (where not ok) from ev),
      'p50', (select percentile_cont(0.5) within group (order by latency_ms) from ev where latency_ms is not null),
      'p95', (select percentile_cont(0.95) within group (order by latency_ms) from ev where latency_ms is not null),
      'promptTokens', (select coalesce(sum(prompt_tokens), 0) from ev),
      'completionTokens', (select coalesce(sum(completion_tokens), 0) from ev)),
    'byFeature', coalesce((select jsonb_agg(t) from (
        select feature, count(*) as total, count(*) filter (where ok) as ok, count(*) filter (where not ok) as fail,
               percentile_cont(0.5) within group (order by latency_ms) as p50,
               percentile_cont(0.95) within group (order by latency_ms) as p95
        from ev group by 1 order by total desc) t), '[]'::jsonb),
    'byProvider', coalesce((select jsonb_agg(t) from (
        select coalesce(provider, 'unknown') as provider, count(*) as total, count(*) filter (where ok) as ok,
               count(*) filter (where not ok) as fail
        from ev group by 1 order by total desc) t), '[]'::jsonb),
    'byModel', coalesce((select jsonb_agg(t) from (
        select coalesce(model, 'unknown') as model, coalesce(provider, 'unknown') as provider, count(*) as calls,
               count(*) filter (where not ok) as fail,
               coalesce(sum(prompt_tokens), 0) as "promptTokens", coalesce(sum(completion_tokens), 0) as "completionTokens"
        from ev group by 1, 2 order by calls desc limit 60) t), '[]'::jsonb),
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'),
        'total', coalesce(x.total, 0), 'ok', coalesce(x.ok, 0), 'fail', coalesce(x.fail, 0)) order by d.day)
        from days d left join (select at::date as day, count(*) as total, count(*) filter (where ok) as ok,
                                      count(*) filter (where not ok) as fail from ev group by 1) x on x.day = d.day), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(t) from (
        select error, count(*) as count from ev where error is not null group by 1 order by count desc limit 15) t), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(t) from (
        select at, feature, lane, provider, model, ok, status, error, client, latency_ms as "latencyMs"
        from ev order by at desc limit 40) t), '[]'::jsonb)
  );
$$;

-- Today's token use by model (the AI spend caps read this, never whole rows).
create or replace function ai_usage_since(p_since timestamptz) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select coalesce(model, 'unknown') as model, coalesce(provider, 'unknown') as provider, count(*) as calls,
           coalesce(sum(prompt_tokens), 0) as "promptTokens", coalesce(sum(completion_tokens), 0) as "completionTokens"
    from ai_calls
    where at >= greatest(p_since, now() - interval '2 days')
      and (error is null or error not in ('ai_disabled', 'ai_over_budget'))
    group by 1, 2 order by calls desc limit 200) t;
$$;

-- One listener in full: the row, the account, the backup facts, counts, tastes, recent events.
create or replace function listener_profile(p_listener text default null, p_account text default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select * from listeners
    where id = coalesce(p_listener, (select listener_id from accounts where id = p_account))
    limit 1
  ),
  a as (
    select * from accounts
    where id = p_account or (p_account is null and listener_id = p_listener)
    limit 1
  ),
  ev as (
    select * from events where listener_id = (select id from l) order by at desc limit 300
  )
  select jsonb_build_object(
    'listener', (select to_jsonb(l) from l),
    'account', (select to_jsonb(a) - 'listener_id' from a),
    'backup', (select jsonb_build_object('version', version, 'bytes', bytes, 'updatedAt', updated_at)
               from account_backups where account_id = (select id from a)),
    'stats', jsonb_build_object(
      'events', (select count(*) from events where listener_id = (select id from l)),
      'plays',  (select count(*) from events where listener_id = (select id from l) and kind = 'play'),
      'plays30d', (select count(*) from events where listener_id = (select id from l) and kind = 'play' and at > now() - interval '30 days'),
      'activeDays30d', (select count(distinct at::date) from events where listener_id = (select id from l) and at > now() - interval '30 days'),
      'errors', (select count(*) from events where listener_id = (select id from l) and kind = 'error'),
      'firstEvent', (select min(at) from events where listener_id = (select id from l)),
      'lastEvent',  (select max(at) from events where listener_id = (select id from l))),
    'topSongs', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, max(song_image) as image, count(*) as plays
        from events where listener_id = (select id from l) and kind = 'play' and song_title is not null
        group by 1, 2 order by plays desc limit 12) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(language, ''), 'unknown') as language, count(*) as plays
        from events where listener_id = (select id from l) and kind = 'play' group by 1 order by plays desc limit 10) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.at desc) from ev), '[]'::jsonb)
  );
$$;

-- Remove one listener everywhere (events, memberships, device row, account and
-- its backup when asked). Returns what was deleted.
create or replace function delete_listener(p_listener text default null, p_account text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_listener text := coalesce(p_listener, (select listener_id from accounts where id = p_account));
  v_account  text := coalesce(p_account, (select id from accounts where listener_id = p_listener limit 1));
  n_events bigint := 0; n_members bigint := 0; n_feedback bigint := 0; n_listener bigint := 0; n_account bigint := 0;
begin
  if v_listener is not null then
    delete from events where listener_id = v_listener; get diagnostics n_events = row_count;
    delete from room_members where member_id = v_listener; get diagnostics n_members = row_count;
    update feedback set listener_id = null where listener_id = v_listener; get diagnostics n_feedback = row_count;
  end if;
  if v_account is not null then
    delete from accounts where id = v_account; get diagnostics n_account = row_count;
  end if;
  if v_listener is not null then
    delete from listeners where id = v_listener; get diagnostics n_listener = row_count;
  end if;
  return jsonb_build_object('listener', n_listener, 'account', n_account, 'events', n_events,
                            'memberships', n_members, 'feedbackDetached', n_feedback);
end;
$$;

-- Listen Together: a guest's song request, appended atomically (no lost
-- writes when two guests ask at once), de-duplicated against the queue and
-- the existing requests, capped at the newest 20. Returns false when the room
-- does not exist.
create or replace function room_request(p_code text, p_song jsonb, p_by text) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare
  v_queue jsonb; v_requests jsonb; v_id text := coalesce(p_song ->> 'id', '');
begin
  select queue, requests into v_queue, v_requests from rooms where code = p_code for update;
  if not found then return false; end if;
  if v_id <> '' and (
       exists (select 1 from jsonb_array_elements(v_queue) e where e -> 'song' ->> 'id' = v_id)
    or exists (select 1 from jsonb_array_elements(v_requests) e where e -> 'song' ->> 'id' = v_id)) then
    return true;
  end if;
  v_requests := v_requests || jsonb_build_array(jsonb_build_object('song', p_song, 'by', nullif(p_by, ''), 'at', now()));
  if jsonb_array_length(v_requests) > 20 then
    v_requests := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
                   from (select e, i from jsonb_array_elements(v_requests) with ordinality t(e, i) order by i desc limit 20) s);
  end if;
  update rooms set requests = v_requests where code = p_code;
  return true;
end;
$$;

-- Rooms nobody touched for six hours, members not seen for a day, and
-- (15.0) shared chats past their expiry.
create or replace function room_sweep() returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare n_rooms bigint; n_members bigint; n_chats bigint;
begin
  delete from rooms where updated_at < now() - interval '6 hours'; get diagnostics n_rooms = row_count;
  delete from room_members where last_seen < now() - interval '1 day'; get diagnostics n_members = row_count;
  delete from shared_chats where expires_at < now(); get diagnostics n_chats = row_count;
  return jsonb_build_object('rooms', n_rooms, 'members', n_members, 'sharedChats', n_chats);
end;
$$;

-- Usage events older than p_keep_days go; the latest-state rows stay.
create or replace function purge_events(p_keep_days int default 180) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  delete from events where at < now() - make_interval(days => least(greatest(coalesce(p_keep_days, 180), 1), 3650));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Push devices that have not checked in for p_days are switched off (a
-- browser or phone that stopped opening the app).
create or replace function retire_push_devices(p_days int default 180) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  update push_devices set active = false
  where active and updated_at < now() - make_interval(days => least(greatest(coalesce(p_days, 180), 7), 3650));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- One status-page probe result: today's tally and the latest state.
create or replace function uptime_tick(p_component text, p_ok boolean, p_latency_ms int) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into uptime_days (component, day, up, total)
    values (p_component, (now() at time zone 'utc')::date, case when p_ok then 1 else 0 end, 1)
    on conflict (component, day) do update
      set up = uptime_days.up + excluded.up, total = uptime_days.total + 1;
  insert into uptime_latest (component, ok, latency_ms, checked_at)
    values (p_component, p_ok, p_latency_ms, now())
    on conflict (component) do update
      set ok = excluded.ok, latency_ms = excluded.latency_ms, checked_at = excluded.checked_at;
end;
$$;

-- The status page in one call: per component, the latest probe and the daily
-- tallies of the window.
create or replace function uptime_report(p_days int default 90) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'component', c.component,
      'ok', l.ok, 'latencyMs', l.latency_ms, 'checkedAt', l.checked_at,
      'uptime', (select round(sum(up)::numeric * 100 / nullif(sum(total), 0), 2) from uptime_days d
                 where d.component = c.component and d.day >= current_date - _days(p_days)),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'up', up, 'total', total) order by day)
                        from uptime_days d where d.component = c.component and d.day >= current_date - _days(p_days)), '[]'::jsonb)
    )), '[]'::jsonb)
  from (select distinct component from uptime_latest union select distinct component from uptime_days) c
  left join uptime_latest l on l.component = c.component;
$$;

-- Table sizes for the Database page (row counts are the planner's estimate).
create or replace function table_stats() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'rows', greatest(c.reltuples, 0)::bigint,
      'bytes', pg_total_relation_size(c.oid)
    ) order by c.relname), '[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
$$;

-- Exact counts for the small tables (cheap) and the estimate for the big ones.
create or replace function table_counts() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'listeners', (select count(*) from listeners),
    'accounts', (select count(*) from accounts),
    'account_backups', (select count(*) from account_backups),
    'profiles', (select count(*) from profiles),
    'follows', (select count(*) from follows),
    'shared_playlists', (select count(*) from shared_playlists),
    'shared_chats', (select count(*) from shared_chats),
    'feedback', (select count(*) from feedback),
    'blocked_content', (select count(*) from blocked_content),
    'rooms', (select count(*) from rooms),
    'room_members', (select count(*) from room_members),
    'push_devices', (select count(*) from push_devices),
    'notifications', (select count(*) from notifications),
    'settings', (select count(*) from settings),
    'experiments', (select count(*) from experiments),
    'audit_log', (select count(*) from audit_log),
    'job_runs', (select count(*) from job_runs),
    'events', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.events'::regclass),
    'ai_calls', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.ai_calls'::regclass)
  );
$$;

-- --------------------------------------------------------- 12. security --

do $$
declare t text;
begin
  foreach t in array array[
    'meta', 'listeners', 'accounts', 'account_backups', 'profiles', 'follows', 'shared_playlists', 'shared_chats',
    'events', 'ai_calls', 'feedback',
    'blocked_content', 'rooms', 'room_members', 'push_devices', 'notifications',
    'settings', 'settings_history', 'experiments', 'audit_log', 'uptime_days', 'uptime_latest', 'job_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on directory from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_days', 'stats_overview', 'stats_timeline', 'stats_music', 'stats_geo', 'stats_platforms',
                        'stats_engagement', 'stats_retention', 'stats_funnel', 'stats_skips', 'stats_errors', 'stats_ai',
                        'ai_usage_since', 'listener_profile', 'delete_listener', 'room_request', 'room_sweep',
                        'purge_events', 'retire_push_devices', 'uptime_tick', 'uptime_report', 'table_stats', 'table_counts')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- Anything created later in this schema starts locked too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ------------------------------------------------------------- version --
insert into meta (key, value, updated_at)
  values ('schema', jsonb_build_object('version', 2, 'appliedAt', now()), now())
  on conflict (key) do update set value = jsonb_build_object('version', 2, 'appliedAt', now()), updated_at = now();

select 'VinaX schema version 2 applied' as done, (select count(*) from pg_tables where schemaname = 'public') as tables;
