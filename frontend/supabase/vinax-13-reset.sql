-- ============================================================================
-- VinaX 13 — CLEAN THE EXISTING DATABASE AND CREATE EVERY TABLE FRESH
-- One paste in the database dashboard → SQL Editor → Run.
--
-- ⚠  DESTRUCTIVE AND IRREVERSIBLE  ⚠
-- Part 1 PERMANENTLY DELETES every VinaX table and function in the `public`
-- schema (everything named vinax_…): listener analytics and play events,
-- errors and vitals, feedback, the admin audit trail, AI call logs, the
-- content blocklist, Listen Together rooms, push registrations (devices sign
-- up again on their next open), A/B experiments, trends, the SEO URL list,
-- usernames, Google accounts and synced account data, and every owner setting
-- in vinax_config (AI controls, prices, house rules, site mode, headlines).
-- Nothing that is not named vinax_… is touched.
--
-- Part 2 is frontend/supabase/vinax-13.sql: the complete current schema
-- (tables, indexes, functions, row-level security) plus the 13.0 account
-- tables. The Worker's secrets do not change — it is the same project.
--
-- After running: everyone signs in with Google again; re-publish the owner
-- console settings; run the "Trending headlines" workflow once.
-- ============================================================================

-- ------------------------------ Part 1 · clean ------------------------------
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

-- ------------------------------ Part 2 · create -----------------------------
-- ============================================================================
-- VinaX 13 — the whole database for a NEW, EMPTY project, in one paste.
-- Database dashboard -> SQL Editor -> paste this file -> Run. Takes seconds.
--
-- What it is: schema.sql (tables, indexes, row-level security, analytics
-- functions) followed by every file in migrations/ in dependency order, then
-- the 13.0 account tables. Every statement is idempotent, so a re-run is safe.
-- Nothing here deletes data.
--
-- Afterwards: set the Worker secrets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
-- to the new project (docs/operations.md, "Moving to a new database").
-- ============================================================================

-- ======================= schema.sql =======================
-- VinaX — complete database schema.
-- Paste into Supabase -> SQL Editor and run once to (re)create everything the
-- app + admin need: tables, indexes, row-level security, and analytics RPCs.
-- Data is coarse + anonymous (device id, optional name, city-level geo). No raw IPs.
-- Safe to re-run (uses "if not exists" / "create or replace").

-- ============================== TABLES ==============================

create table if not exists vinax_users (
  device_id            text primary key,
  name                 text,
  -- Unique handle claimed at onboarding via POST /api/username. Display
  -- names collide across listeners; the handle never does.
  username             text,
  platform             text,
  app_version          text,
  country              text,
  city                 text,
  region               text,
  current_song_title   text,
  current_song_artist  text,
  current_song_image   text,
  is_playing           boolean default false,
  first_seen           timestamptz default now(),
  last_seen            timestamptz default now()
);
-- Idempotent add for deploys that predate usernames, + the case-insensitive
-- unique index that makes two devices claiming the same handle impossible.
alter table if exists vinax_users
  add column if not exists username text;
create unique index if not exists vinax_users_username_unique
  on vinax_users (lower(username))
  where username is not null;

create table if not exists vinax_events (
  id          bigint generated always as identity primary key,
  device_id   text,
  type        text,           -- play | error | ...
  song_id     text,
  song_title  text,
  song_artist text,
  song_image  text,
  language    text,
  platform    text,
  app_version text,
  error_kind  text,
  message     text,
  country     text,
  city        text,
  region      text,
  -- Audit finding H-SRV-6: true when the row's device_id was proven via
  -- signed_device_id HMAC, false when it was derived server-side from
  -- ip+ua. Lets analytics downweight the derived rows if desired.
  origin_verified boolean default false,
  -- 7.2: recommendation telemetry (rec_served / rec_outcome only). The
  -- Worker whitelists keys and caps it at 1 KB; see
  -- migrations/2026-09-vinax-7.2-events-meta.sql.
  meta        jsonb,
  created_at  timestamptz default now()
);
-- Idempotent add for existing deploys that predate H-SRV-6.
alter table if exists vinax_events
  add column if not exists origin_verified boolean default false;
-- Idempotent add for existing deploys that predate 7.2 events meta.
alter table if exists vinax_events
  add column if not exists meta jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vinax_events_meta_shape') then
    alter table vinax_events
      add constraint vinax_events_meta_shape
      check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 2048))
      not valid;
  end if;
end $$;

create table if not exists vinax_feedback (
  id          bigint generated always as identity primary key,
  device_id   text,
  name        text,
  type        text,           -- bug | idea | other
  message     text,
  app_version text,
  platform    text,
  country     text,
  city        text,
  status      text default 'new',
  created_at  timestamptz default now()
);

create table if not exists vinax_blocklist (
  song_id    text primary key,
  song_title text,
  reason     text,
  created_at timestamptz default now()
);

create table if not exists vinax_ai_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  feature     text not null,  -- dj | playlist | lyrics | home
  model       text,
  ok          boolean not null default false,
  status      int,
  error       text,
  client      text,           -- web | app
  latency_ms  int
);
-- Token counts for the AI Cost panel and the 7.2 daily spend caps (the
-- 2026-09 rollups migration adds the same columns; a no-op where they exist).
alter table if exists vinax_ai_events
  add column if not exists prompt_tokens int,
  add column if not exists completion_tokens int;

create table if not exists vinax_rooms (
  code        text primary key,
  host_name   text,
  song        jsonb,
  position    double precision default 0,
  playing     boolean default false,
  updated_at  timestamptz default now(),
  created_at  timestamptz default now(),
  -- Host secret authorising update/end actions. Returned once on create,
  -- kept only client-side. Rooms created before this migration have NULL
  -- host_token and are grandfathered by the API until they expire naturally.
  host_token  text
);

-- Idempotent add for existing databases upgrading from a schema without
-- host_token (see audit finding H8).
alter table vinax_rooms add column if not exists host_token text;

create table if not exists vinax_room_members (
  code      text,
  device_id text,
  name      text,
  last_seen timestamptz default now(),
  primary key (code, device_id)
);

create table if not exists vinax_push_subscriptions (
  endpoint       text primary key,
  p256dh         text not null,
  auth           text not null,
  lang           text,
  country        text,     -- CF ISO-2, set/updated at subscribe time
  region         text,     -- CF human name (state / province)
  city           text,     -- CF city name (may be null on some networks)
  tz_offset      int,      -- device UTC offset in minutes east (quiet-hours gate)
  last_pushed_at timestamptz, -- last notification send (frequency-cap gate)
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);
-- Idempotent add for existing deployments (the CREATE above only fires on a
-- brand-new table). Safe to re-run.
alter table vinax_push_subscriptions add column if not exists tz_offset int;
alter table vinax_push_subscriptions add column if not exists last_pushed_at timestamptz;
-- Geo columns added post-hoc for the location-targeted push feature.
alter table if exists vinax_push_subscriptions
  add column if not exists country text,
  add column if not exists region  text,
  add column if not exists city    text;

-- Android FCM device tokens (written by /api/push/fcm-register, read by the
-- admin push sender). Was missing from this file while the code used it.
create table if not exists vinax_fcm_tokens (
  token          text primary key,
  platform       text,
  lang           text,
  country        text,
  region         text,
  city           text,
  tz_offset      int,
  last_pushed_at timestamptz,
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table vinax_fcm_tokens add column if not exists tz_offset int;
alter table vinax_fcm_tokens add column if not exists last_pushed_at timestamptz;
alter table if exists vinax_fcm_tokens
  add column if not exists country text,
  add column if not exists region  text,
  add column if not exists city    text;

-- SEO URL corpus — one row per indexable catalog URL (song/album/artist/
-- playlist). Fed by the seo-crawl cron + entity page renders + live-search
-- sitemaps; consumed by the paginated /sitemaps/<type>-<n>.xml endpoints.
-- PUBLIC catalog metadata only — never any user or device data.
create table if not exists vinax_seo_urls (
  key         text primary key,               -- '<type>:<entity_id>'
  type        text not null,                  -- song | album | artist | playlist
  entity_id   text not null,
  slug        text not null,
  title       text,
  lang        text,
  added_at    timestamptz not null default now(),
  lastmod     timestamptz not null default now(),
  expanded_at timestamptz,                    -- frontier: last artist/album walk
  expand_page int not null default 0          -- frontier: next page to walk
);

-- ============================== INDEXES ==============================

create index if not exists idx_vinax_users_last_seen   on vinax_users (last_seen desc);
create index if not exists idx_vinax_events_created    on vinax_events (created_at desc);
create index if not exists idx_vinax_events_device     on vinax_events (device_id);
-- Typed windows (rec_served / rec_outcome, the rollups); same name as the
-- migrations use, so re-running either is a no-op.
create index if not exists vinax_events_type_created_at_idx on vinax_events (type, created_at desc);
create index if not exists idx_vinax_feedback_created  on vinax_feedback (created_at desc);
create index if not exists idx_vinax_room_members_seen on vinax_room_members (code, last_seen desc);
create index if not exists vinax_ai_events_created_idx on vinax_ai_events (created_at desc);
create index if not exists vinax_ai_events_feature_idx on vinax_ai_events (feature);
create index if not exists idx_vinax_fcm_tokens_active on vinax_fcm_tokens (active, updated_at desc);
-- Geo-targeted push filters on both channels stay fast as subscribers grow.
create index if not exists idx_vinax_push_subs_geo on vinax_push_subscriptions (country, region, city) where active = true;
create index if not exists idx_vinax_fcm_tokens_geo on vinax_fcm_tokens (country, region, city) where active = true;
-- Sitemap pagination + crawl-frontier reads on the SEO corpus.
create index if not exists vinax_seo_urls_type_added on vinax_seo_urls (type, added_at, key);
create index if not exists vinax_seo_urls_frontier   on vinax_seo_urls (type, expanded_at nulls first);

-- Admin-published app config (banners, home-screen defaults). One key→jsonb
-- row per surface; written by /api/admin/appconfig, read publicly (cached)
-- through /api/appconfig.
create table if not exists vinax_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ===================== ROW-LEVEL SECURITY (service-role only) =====================
-- RLS with no policies blocks the public anon key; the Cloudflare functions use
-- the service-role key, which bypasses RLS.

alter table vinax_users              enable row level security;
alter table vinax_events             enable row level security;
alter table vinax_feedback           enable row level security;
alter table vinax_blocklist          enable row level security;
alter table vinax_ai_events          enable row level security;
alter table vinax_rooms              enable row level security;
alter table vinax_room_members       enable row level security;
alter table vinax_push_subscriptions enable row level security;
alter table vinax_fcm_tokens         enable row level security;
alter table vinax_seo_urls           enable row level security;
alter table vinax_config             enable row level security;

-- ===================== RESET EXISTING FUNCTIONS =====================
-- Dropping tables does NOT drop functions, and "create or replace" cannot change
-- a function's return type. Drop any prior vinax_* functions so the definitions
-- below recreate them cleanly (safe + idempotent on a fresh project too).
do $$
declare r record;
begin
  for r in
    select format('drop function if exists %I.%I(%s) cascade;',
                  n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as stmt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'vinax\_%'
  loop
    execute r.stmt;
  end loop;
end $$;

-- ===================== ANALYTICS FUNCTIONS (admin dashboards) =====================

create or replace function vinax_top_songs(days int default 7, lim int default 25)
returns table(song_title text, song_artist text, song_image text, plays bigint)
language sql stable as $$
  select song_title, song_artist, max(song_image) as song_image, count(*)::bigint as plays
  from vinax_events
  where type = 'play' and song_title is not null
    and created_at > now() - make_interval(days => days)
  group by song_title, song_artist
  order by plays desc
  limit lim;
$$;

create or replace function vinax_top_artists(days int default 7, lim int default 25)
returns table(song_artist text, plays bigint)
language sql stable as $$
  select song_artist, count(*)::bigint as plays
  from vinax_events
  where type = 'play' and song_artist is not null
    and created_at > now() - make_interval(days => days)
  group by song_artist
  order by plays desc
  limit lim;
$$;

create or replace function vinax_top_languages(days int default 7, lim int default 20)
returns table(language text, plays bigint)
language sql stable as $$
  select coalesce(language, 'unknown') as language, count(*)::bigint as plays
  from vinax_events
  where type = 'play'
    and created_at > now() - make_interval(days => days)
  group by coalesce(language, 'unknown')
  order by plays desc
  limit lim;
$$;

create or replace function vinax_plays_by_day(days int default 14)
returns table(day date, plays bigint)
language sql stable as $$
  select date_trunc('day', created_at)::date as day, count(*)::bigint as plays
  from vinax_events
  where type = 'play'
    and created_at > now() - make_interval(days => days)
  group by 1
  order by 1;
$$;

create or replace function vinax_geo(days int default 7)
returns table(country text, city text, listeners bigint, plays bigint)
language sql stable as $$
  select coalesce(country, '??') as country,
         coalesce(city, 'Unknown') as city,
         count(distinct device_id)::bigint as listeners,
         (count(*) filter (where type = 'play'))::bigint as plays
  from vinax_events
  where created_at > now() - make_interval(days => days)
  group by 1, 2
  order by listeners desc;
$$;

create or replace function vinax_platforms()
returns table(platform text, listeners bigint)
language sql stable as $$
  select coalesce(platform, 'web') as platform, count(*)::bigint as listeners
  from vinax_users
  group by 1
  order by listeners desc;
$$;

create or replace function vinax_user_summary()
returns json
language sql stable as $$
  select json_build_object(
    'total_users',  (select count(*) from vinax_users),
    'active_24h',   (select count(*) from vinax_users  where last_seen  > now() - interval '24 hours'),
    'new_24h',      (select count(*) from vinax_users  where first_seen > now() - interval '24 hours'),
    'total_plays',  (select count(*) from vinax_events where type = 'play')
  );
$$;

create or replace function vinax_versions()
returns table(app_version text, platform text, users bigint)
language sql stable as $$
  select coalesce(app_version, 'unknown') as app_version,
         coalesce(platform, 'web') as platform,
         count(*)::bigint as users
  from vinax_users
  group by 1, 2
  order by users desc;
$$;

create or replace function vinax_errors(days int default 7, lim int default 50)
returns table(error_kind text, message text, hits bigint, last_seen timestamptz)
language sql stable as $$
  select coalesce(error_kind, 'error') as error_kind,
         coalesce(message, '') as message,
         count(*)::bigint as hits,
         max(created_at) as last_seen
  from vinax_events
  where type = 'error'
    and created_at > now() - make_interval(days => days)
  group by 1, 2
  order by hits desc
  limit lim;
$$;

create or replace function vinax_errors_by_day(days int default 14)
returns table(day date, hits bigint)
language sql stable as $$
  select date_trunc('day', created_at)::date as day, count(*)::bigint as hits
  from vinax_events
  where type = 'error'
    and created_at > now() - make_interval(days => days)
  group by 1
  order by 1;
$$;

create or replace function vinax_tech_summary()
returns json
language sql stable as $$
  select json_build_object(
    'errors_24h',      (select count(*) from vinax_events where type = 'error' and created_at > now() - interval '24 hours'),
    'plays_24h',       (select count(*) from vinax_events where type = 'play'  and created_at > now() - interval '24 hours'),
    'active_sessions', (select count(*) from vinax_users  where last_seen > now() - interval '5 minutes'),
    'versions',        (select count(distinct app_version) from vinax_users where app_version is not null)
  );
$$;

create or replace function vinax_blockable_songs(days int default 30, lim int default 40)
returns table(song_id text, song_title text, song_artist text, plays bigint)
language sql stable as $$
  select song_id,
         max(song_title) as song_title,
         max(song_artist) as song_artist,
         count(*)::bigint as plays
  from vinax_events
  where type = 'play' and song_id is not null
    and created_at > now() - make_interval(days => days)
  group by song_id
  order by plays desc
  limit lim;
$$;

create or replace function vinax_overview()
returns json language sql stable as $$
  select json_build_object(
    'active_now',   (select count(*) from vinax_users  where last_seen  > now() - interval '60 seconds'),
    'total_users',  (select count(*) from vinax_users),
    'new_today',    (select count(*) from vinax_users  where first_seen > now() - interval '24 hours'),
    'plays_today',  (select count(*) from vinax_events where type='play'  and created_at > now() - interval '24 hours'),
    'plays_7d',     (select count(*) from vinax_events where type='play'  and created_at > now() - interval '7 days'),
    'errors_24h',   (select count(*) from vinax_events where type='error' and created_at > now() - interval '24 hours'),
    'dau',          (select count(distinct device_id) from vinax_events where created_at > now() - interval '24 hours'),
    'wau',          (select count(distinct device_id) from vinax_events where created_at > now() - interval '7 days'),
    'mau',          (select count(distinct device_id) from vinax_events where created_at > now() - interval '30 days'),
    'feedback_new', (select count(*) from vinax_feedback where status = 'new')
  );
$$;

create or replace function vinax_new_users_by_day(days int default 14)
returns table(day date, users bigint) language sql stable as $$
  select date_trunc('day', first_seen)::date as day, count(*)::bigint as users
  from vinax_users
  where first_seen > now() - make_interval(days => days)
  group by 1 order by 1;
$$;

create or replace function vinax_plays_by_hour(days int default 7)
returns table(hour int, plays bigint) language sql stable as $$
  select extract(hour from created_at)::int as hour, count(*)::bigint as plays
  from vinax_events
  where type='play' and created_at > now() - make_interval(days => days)
  group by 1 order by 1;
$$;

create or replace function vinax_trending(days int default 7, lim int default 15)
returns table(song_title text, song_artist text, song_image text, plays bigint, prev_plays bigint)
language sql stable as $$
  with cur as (
    select song_title, song_artist, max(song_image) as img, count(*) as c
    from vinax_events
    where type='play' and song_title is not null
      and created_at > now() - make_interval(days => days)
    group by 1, 2
  ),
  prev as (
    select song_title, song_artist, count(*) as c
    from vinax_events
    where type='play' and song_title is not null
      and created_at <= now() - make_interval(days => days)
      and created_at >  now() - make_interval(days => days * 2)
    group by 1, 2
  )
  select cur.song_title, cur.song_artist, cur.img,
         cur.c::bigint, coalesce(prev.c, 0)::bigint
  from cur left join prev using (song_title, song_artist)
  order by (cur.c - coalesce(prev.c, 0)) desc, cur.c desc
  limit lim;
$$;

-- Return type changed (added username) — drop the old signature first.
drop function if exists vinax_top_listeners(int, int);
create or replace function vinax_top_listeners(days int default 7, lim int default 20)
returns table(device_id text, name text, username text, plays bigint) language sql stable as $$
  select e.device_id, max(u.name) as name, max(u.username) as username, count(*)::bigint as plays
  from vinax_events e
  left join vinax_users u on u.device_id = e.device_id
  where e.type='play' and e.created_at > now() - make_interval(days => days)
  group by e.device_id
  order by plays desc
  limit lim;
$$;

create or replace function vinax_languages(days int default 7)
returns table(language text, plays bigint, listeners bigint) language sql stable as $$
  select coalesce(language, 'unknown') as language,
         count(*)::bigint as plays,
         count(distinct device_id)::bigint as listeners
  from vinax_events
  where type='play' and created_at > now() - make_interval(days => days)
  group by 1 order by plays desc;
$$;

create or replace function vinax_segments()
returns json language sql stable as $$
  select json_build_object(
    'new_7d',       (select count(*) from vinax_users where first_seen > now() - interval '7 days'),
    'returning_7d', (select count(*) from vinax_users where last_seen > now() - interval '7 days' and first_seen <= now() - interval '7 days'),
    'inactive_30d', (select count(*) from vinax_users where last_seen <= now() - interval '7 days' and last_seen > now() - interval '30 days'),
    'power_users',  (select count(*) from (
        select device_id from vinax_events
        where type='play' and created_at > now() - interval '30 days'
        group by device_id having count(*) >= 20
      ) p)
  );
$$;

-- Atomic append to a room's requests[] list. Two concurrent guest requests
-- both reading the previous state then writing back would lose one entry —
-- this function does the read-modify-write inside a single statement so
-- neither is dropped (audit finding M12). De-dupes against existing queue
-- and requests entries, caps history at 20.
create or replace function vinax_room_append_request(p_code text, p_song jsonb, p_by text)
returns void language plpgsql
security invoker
set search_path = public, pg_temp as $$
declare
  v_song jsonb;
  v_current jsonb;
  v_queue jsonb;
  v_requests jsonb;
  v_new_id text;
begin
  select song into v_song from vinax_rooms where code = p_code for update;
  if not found then
    raise exception 'room_not_found';
  end if;
  if v_song ->> 'v' = '2' then
    v_current := v_song -> 'current';
    v_queue := coalesce(v_song -> 'queue', '[]'::jsonb);
    v_requests := coalesce(v_song -> 'requests', '[]'::jsonb);
  else
    v_current := v_song;
    v_queue := '[]'::jsonb;
    v_requests := '[]'::jsonb;
  end if;
  v_new_id := coalesce(p_song ->> 'id', '');
  -- de-dupe against queue + existing requests
  if v_new_id <> '' then
    if exists (
      select 1 from jsonb_array_elements(v_queue) e where e -> 'song' ->> 'id' = v_new_id
    ) or exists (
      select 1 from jsonb_array_elements(v_requests) e where e -> 'song' ->> 'id' = v_new_id
    ) then
      return; -- already present, ignore
    end if;
  end if;
  v_requests := v_requests || jsonb_build_array(
    jsonb_build_object('song', p_song, 'by', nullif(p_by, ''))
  );
  -- cap at 20 by keeping the newest entries, restored to chronological order
  if jsonb_array_length(v_requests) > 20 then
    v_requests := (
      select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
      from (
        select e, i from jsonb_array_elements(v_requests) with ordinality as t(e, i)
        order by i desc limit 20
      ) s
    );
  end if;
  update vinax_rooms
    set song = jsonb_build_object('v', 2, 'current', v_current, 'queue', v_queue, 'requests', v_requests)
    where code = p_code;
end;
$$;

create or replace function vinax_ai_metrics(p_days int default 7)
returns jsonb language sql security definer
-- Pinning search_path prevents a role that can EXECUTE this definer function
-- from shadowing vinax_ai_events via a private schema (audit finding M24).
set search_path = public, pg_temp as $$
  with ev as (
    select * from vinax_ai_events
    where created_at >= now() - make_interval(days => greatest(p_days, 1))
  )
  select jsonb_build_object(
    'total', (select count(*) from ev),
    'ok', (select count(*) from ev where ok),
    'fail', (select count(*) from ev where not ok),
    'avg_latency_ms', (select coalesce(round(avg(latency_ms))::int, 0) from ev where latency_ms is not null),
    'by_feature', coalesce((select jsonb_agg(t) from (
        select feature, count(*)::int as total,
               count(*) filter (where ok)::int as ok,
               count(*) filter (where not ok)::int as fail
        from ev group by feature order by total desc) t), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(t) from (
        select coalesce(model, '(none)') as model, count(*)::int as count
        from ev group by model order by count desc) t), '[]'::jsonb),
    'by_client', coalesce((select jsonb_agg(t) from (
        select coalesce(client, '(unknown)') as client, count(*)::int as count
        from ev group by client order by count desc) t), '[]'::jsonb),
    'by_error', coalesce((select jsonb_agg(t) from (
        select error, count(*)::int as count
        from ev where error is not null group by error order by count desc limit 12) t), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(t) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               count(*)::int as total,
               count(*) filter (where ok)::int as ok,
               count(*) filter (where not ok)::int as fail
        from ev group by 1 order by 1) t), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(t) from (
        select to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as ts,
               feature, coalesce(model, '') as model, ok, status, error, client, latency_ms
        from ev order by created_at desc limit 30) t), '[]'::jsonb)
  );
$$;

-- ===================== 7.2 VERIFIED TRENDS =====================
-- The same definitions as migrations/2026-09-vinax-7.2-trends.sql (read that
-- file's header for what each table holds and the retention rule). Here so a
-- fresh install gets them; an existing project runs the migration instead.
-- ------------------------------------------------------------------- runs ---
create table if not exists public.vinax_trend_runs (
  id                 uuid primary key,
  source             text not null,
  region             text not null,
  trigger            text not null default 'cron',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  ok                 boolean not null default false,
  status             text not null default 'running'
                     check (status in ('running', 'ok', 'error', 'skipped')),
  error              text,
  attempts           int not null default 0,
  items_fetched      int not null default 0,
  items_inserted     int not null default 0,
  matched            int not null default 0,
  queued_for_review  int not null default 0,
  quota_units        int not null default 0,
  snapshot_key       text,
  duplicate_snapshot boolean not null default false
);
-- Last success per source/region, quota used today, the console's run log.
create index if not exists vinax_trend_runs_source_started_idx
  on public.vinax_trend_runs (source, region, started_at desc);
create index if not exists vinax_trend_runs_success_idx
  on public.vinax_trend_runs (region, finished_at desc) where ok;

-- -------------------------------------------------------------- snapshots ---
create table if not exists public.vinax_trend_snapshots (
  id           bigint generated always as identity primary key,
  source       text not null,
  region       text not null,
  chart        text not null,
  snapshot_key text not null,
  observed_at  timestamptz not null,
  fetched_at   timestamptz not null,
  item_count   int not null default 0,
  run_id       uuid,
  constraint vinax_trend_snapshots_key unique (source, region, chart, snapshot_key)
);
-- Newest snapshot per source/region, and the comparable earlier one for momentum.
create index if not exists vinax_trend_snapshots_latest_idx
  on public.vinax_trend_snapshots (region, source, chart, observed_at desc);
-- Retention sweep.
create index if not exists vinax_trend_snapshots_fetched_idx
  on public.vinax_trend_snapshots (fetched_at);

-- ----------------------------------------------------------- observations ---
create table if not exists public.vinax_trend_observations (
  id                bigint generated always as identity primary key,
  snapshot_id       bigint not null references public.vinax_trend_snapshots (id) on delete cascade,
  source            text not null,
  source_item_id    text not null,
  url               text,
  region            text not null,
  chart             text not null,
  title             text not null,
  credit            text,
  language_evidence jsonb not null default '{}'::jsonb,
  observed_at       timestamptz not null,
  fetched_at        timestamptz not null,
  expires_at        timestamptz not null,
  source_rank       int not null check (source_rank > 0),
  statistics        jsonb,
  provenance        jsonb not null default '{}'::jsonb,
  constraint vinax_trend_observations_item unique (snapshot_id, source_item_id),
  constraint vinax_trend_observations_rank unique (snapshot_id, source_rank)
);
-- The public read: one snapshot's unexpired items in rank order
-- (the unique (snapshot_id, source_rank) index already serves it).
create index if not exists vinax_trend_observations_expiry_idx
  on public.vinax_trend_observations (snapshot_id, expires_at);
-- The console: the latest observation of an item under review.
create index if not exists vinax_trend_observations_item_idx
  on public.vinax_trend_observations (source, source_item_id, observed_at desc);

-- ---------------------------------------------------------------- matches ---
create table if not exists public.vinax_trend_matches (
  id                 bigint generated always as identity primary key,
  source             text not null,
  source_item_id     text not null,
  catalog_id         text,
  catalog_title      text,
  catalog_artist     text,
  catalog_language   text,
  mapping_confidence real not null default 0 check (mapping_confidence >= 0 and mapping_confidence <= 1),
  method             text not null,
  status             text not null
                     check (status in ('matched', 'review', 'accepted', 'rejected', 'corrected')),
  reason             text,
  candidates         jsonb not null default '[]'::jsonb,
  reviewed_by        text,
  reviewed_at        timestamptz,
  history            jsonb not null default '[]'::jsonb,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  constraint vinax_trend_matches_item unique (source, source_item_id)
);
-- The review queue and the confidence distribution.
create index if not exists vinax_trend_matches_status_idx
  on public.vinax_trend_matches (status, last_seen_at desc);
-- Recent review decisions.
create index if not exists vinax_trend_matches_reviewed_idx
  on public.vinax_trend_matches (reviewed_at desc) where reviewed_at is not null;
-- Retention sweep.
create index if not exists vinax_trend_matches_seen_idx
  on public.vinax_trend_matches (last_seen_at);

-- -------------------------------------------------------------- editorial ---
create table if not exists public.vinax_trend_editorial (
  id           bigint generated always as identity primary key,
  dedupe_key   text not null,
  title        text not null,
  artist       text,
  catalog_id   text,
  region       text not null default 'IN',
  language     text,
  position     int not null default 1 check (position between 1 and 100),
  evidence_url text not null check (evidence_url ~ '^https://'),
  note         text,
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'withdrawn')),
  imported_by  text,
  imported_at  timestamptz not null default now(),
  import_batch text,
  constraint vinax_trend_editorial_dedupe unique (dedupe_key),
  constraint vinax_trend_editorial_window check (expires_at > starts_at)
);
-- The editorial provider's read: active entries of a region inside their window.
create index if not exists vinax_trend_editorial_active_idx
  on public.vinax_trend_editorial (region, status, expires_at);

-- -------------------------------------------------------------- lock down ---
-- Same posture as every other vinax_ table: RLS on, no policies, no grants
-- for the public roles. The Worker's service-role key bypasses RLS.
alter table public.vinax_trend_runs         enable row level security;
alter table public.vinax_trend_snapshots    enable row level security;
alter table public.vinax_trend_observations enable row level security;
alter table public.vinax_trend_matches      enable row level security;
alter table public.vinax_trend_editorial    enable row level security;
revoke all on table public.vinax_trend_runs         from anon, authenticated;
revoke all on table public.vinax_trend_snapshots    from anon, authenticated;
revoke all on table public.vinax_trend_observations from anon, authenticated;
revoke all on table public.vinax_trend_matches      from anon, authenticated;
revoke all on table public.vinax_trend_editorial    from anon, authenticated;

-- 7.2: today's AI token use by model, for the backend-enforced daily spend
-- caps (_lib/ai.ts). Same definition as
-- migrations/2026-09-vinax-7.2-ai-controls.sql; service role only.
create or replace function public.vinax_ai_usage_since(p_since timestamptz)
returns table (model text, calls bigint, prompt_tokens bigint, completion_tokens bigint, calls_without_usage bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(e.model, '(none)') as model,
         count(*)::bigint as calls,
         coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
         coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
         count(*) filter (where e.prompt_tokens is null or e.completion_tokens is null)::bigint as calls_without_usage
  from vinax_ai_events e
  -- Never scan more than two days, whatever the caller asks for.
  where e.created_at >= greatest(p_since, now() - interval '2 days')
    -- Calls the controls refused are logged for the operations panel but
    -- spent nothing.
    and (e.error is null or e.error not in ('ai_disabled', 'ai_over_budget'))
  group by 1
  order by 2 desc
  limit 500;
$$;
revoke execute on function public.vinax_ai_usage_since(timestamptz) from anon, authenticated;
grant execute on function public.vinax_ai_usage_since(timestamptz) to service_role;


-- ======================= migrations/20260825_username.sql =======================
-- Unique username (handle) for the no-login identity model.
-- Display names collide across listeners; the handle never does.
-- Claimed by POST /api/username at onboarding; shown as @username in admin.
alter table vinax_users add column if not exists username text;
create unique index if not exists vinax_users_username_unique
  on vinax_users (lower(username))
  where username is not null;


-- ======================= migrations/2026-07-vinax-experiments.sql =======================
-- ============================================================================
-- VinaX — E2 A/B experiments table (admin Engagement panel)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- One row per experiment. Variant splits live as jsonb
-- (e.g. [{"name":"control","pct":50},{"name":"b","pct":50}]); assignment is
-- computed on-device from a deterministic hash — the table stores only the
-- experiment DEFINITIONS, never any assignment or per-device data.
-- ============================================================================
create table if not exists public.vinax_experiments (
  key        text primary key,
  name       text,
  variants   jsonb not null default '[]'::jsonb,
  active     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Same deny-all posture as every other vinax table: the service role (which
-- bypasses RLS) is the only reader/writer; the public anon key gets nothing.
alter table public.vinax_experiments enable row level security;
alter table public.vinax_experiments force row level security;
revoke all on table public.vinax_experiments from anon, authenticated;

-- Verify.
select key, active, variants from public.vinax_experiments;


-- ======================= migrations/2026-07-vinax-reactions.sql =======================
-- ============================================================================
-- VinaX v3.9.17 — Listen Together reactions (Package D11)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- Two nullable columns on the members table: each member's reaction lives on
-- their OWN row (keyed code+device_id), so concurrent reactions can never race
-- — no RPC needed, unlike the shared song-request array. Until this runs, the
-- app's reaction buttons answer honestly ("Reactions aren't enabled on this
-- server yet") and nothing else changes.
-- ============================================================================
alter table public.vinax_room_members add column if not exists reaction text;
alter table public.vinax_room_members add column if not exists reacted_at timestamptz;

-- The polls filter on (code, reacted_at); rooms are small, but the index keeps
-- the reaction query off any seq-scan path as the members table grows.
create index if not exists vinax_room_members_reacted_idx
  on public.vinax_room_members (code, reacted_at)
  where reaction is not null;

-- Verify: both columns present.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vinax_room_members'
  and column_name in ('reaction', 'reacted_at');


-- ======================= migrations/2026-07-vinax-retention.sql =======================
-- ============================================================================
-- VinaX — E1 cohort retention RPC (admin Engagement panel)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- Weekly cohorts from vinax_events: every device's first-seen week, then
-- whether it came back on day 1, within days 2-7, and within days 8-30.
-- Anonymous by construction — device_id is already a pseudonymous id; the
-- function returns only aggregate counts, never ids.
-- ============================================================================
create or replace function public.vinax_retention(p_weeks int default 8)
returns table (
  cohort_week date,
  cohort_size bigint,
  d1 bigint,
  d7 bigint,
  d30 bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with firsts as (
    select device_id, min(created_at) as first_at
    from vinax_events
    where device_id is not null and device_id <> 'admin'
    group by device_id
  ),
  cohorts as (
    select
      f.device_id,
      f.first_at,
      date_trunc('week', f.first_at)::date as cohort_week
    from firsts f
    where f.first_at >= now() - (p_weeks || ' weeks')::interval
  ),
  returns_ as (
    select
      c.cohort_week,
      c.device_id,
      bool_or(e.created_at >= c.first_at + interval '1 day'
          and e.created_at <  c.first_at + interval '2 days') as r1,
      bool_or(e.created_at >= c.first_at + interval '2 days'
          and e.created_at <  c.first_at + interval '8 days') as r7,
      bool_or(e.created_at >= c.first_at + interval '8 days'
          and e.created_at <  c.first_at + interval '31 days') as r30
    from cohorts c
    join vinax_events e on e.device_id = c.device_id
    group by c.cohort_week, c.device_id
  )
  select
    cohort_week,
    count(*)                          as cohort_size,
    count(*) filter (where r1)        as d1,
    count(*) filter (where r7)        as d7,
    count(*) filter (where r30)       as d30
  from returns_
  group by cohort_week
  order by cohort_week desc;
$$;

-- Only the backend (service role) may call it — same deny-all posture as the
-- RLS hardening script.
revoke execute on function public.vinax_retention(int) from anon, authenticated;

-- Verify: should return up to 8 rows (may be empty on a fresh project).
select * from public.vinax_retention(8);


-- ======================= migrations/2026-08-vinax-rooms-hosttoken.sql =======================
-- ============================================================================
-- VinaX — Listen Together rooms: host_token + reaction columns
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- WHY THIS EXISTS: the July security hardening (audit finding H8) made room
-- creation write a host_token so only the host can control/end a session.
-- The column was added to schema.sql but never shipped as a runnable
-- migration — on databases created before H8, EVERY "Start session" insert
-- has been rejected by PostgREST since that deploy ("Could not start a
-- session"). This file closes that gap, and includes the D11 reaction
-- columns so one paste fixes the whole rooms feature.
-- ============================================================================

alter table public.vinax_rooms        add column if not exists host_token text;

-- D11 — room reactions (were delivered separately in
-- 2026-07-vinax-reactions.sql; repeated here so rooms need only one paste).
alter table public.vinax_room_members add column if not exists reaction   text;
alter table public.vinax_room_members add column if not exists reacted_at timestamptz;
create index if not exists vinax_room_members_react_idx
  on public.vinax_room_members (code, reacted_at)
  where reaction is not null;


-- ======================= migrations/2026-08-vinax-seo-urls.sql =======================
-- ============================================================================
-- VinaX — SEO URL corpus (the "infinite catalog" index feed)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- One row per indexable catalog URL (song / album / artist / playlist).
-- Fed continuously by three producers:
--   1. /api/cron/seo-crawl  — the catalog walker (hourly GitHub Action):
--      expands artists page-by-page into their full song + album lists.
--   2. Entity page renders  — every /song|album|artist|playlist/:id render
--      harvests the entity and everything it links to.
--   3. Legacy live-search sitemaps — each rebuild contributes its finds.
-- Consumed by /sitemaps/<type>-<n>.xml (10k URLs per page, no upper bound)
-- via the /sitemap.xml index. Contains only PUBLIC catalog metadata — no
-- user or device data of any kind.
-- ============================================================================
create table if not exists public.vinax_seo_urls (
  key         text primary key,               -- '<type>:<entity_id>'
  type        text not null,                  -- song | album | artist | playlist
  entity_id   text not null,
  slug        text not null,                  -- url-safe name part
  title       text,
  lang        text,
  added_at    timestamptz not null default now(),
  lastmod     timestamptz not null default now(),
  -- Frontier bookkeeping (artists/albums only): when this entity's own
  -- song/album lists were last expanded, and which page the walk is on.
  expanded_at timestamptz,
  expand_page int not null default 0
);

-- Sitemap pagination reads: stable (type, added_at, key) ordering.
create index if not exists vinax_seo_urls_type_added
  on public.vinax_seo_urls (type, added_at, key);

-- Frontier reads: oldest-expanded (nulls = never) artists first.
create index if not exists vinax_seo_urls_frontier
  on public.vinax_seo_urls (type, expanded_at nulls first);

-- Same deny-all posture as every other vinax table: the service role (which
-- bypasses RLS) is the only reader/writer; the public anon key gets nothing.
alter table public.vinax_seo_urls enable row level security;
alter table public.vinax_seo_urls force row level security;
revoke all on table public.vinax_seo_urls from anon, authenticated;

-- Verify.
select count(*) as seo_urls from public.vinax_seo_urls;


-- ======================= migrations/2026-09-vinax-rollups-and-tokens.sql =======================
-- ============================================================================
-- VinaX — exact admin rollups + AI token accounting (v5.16.0)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- 1. Three rollup RPCs so the admin Feature Usage, Onboarding Funnel and
--    Skip Report panels count EVERY event in the window instead of the
--    newest 10,000 rows the REST path could carry:
--      vinax_usage(p_days)         → jsonb {byType, byPlatform, heatmap, peak, total}
--      vinax_funnel(p_days)        → jsonb [{id, label, devices}]
--      vinax_skips(p_days, p_min)  → jsonb [{id, title, artist, image, plays, skips, rate}]
--    Until this file is applied the endpoints fall back to sampling and say
--    so (`source: 'sampled'`). Aggregates only — no device ids leave the DB.
-- 2. Two token columns on vinax_ai_events for the AI Cost panel. The
--    backend strips them from an insert when the provider sent no usage, so
--    an older table keeps accepting rows either way.
-- 3. Indexes that keep the rollups cheap as vinax_events grows.
--
-- ⚠ supabase/schema.sql drops ALL vinax_% functions before recreating its
--   own set — re-apply this file after any schema.sql re-run.
-- ============================================================================

-- ---------------------------------------------------------------- indexes ---
create index if not exists vinax_events_type_created_at_idx
  on public.vinax_events (type, created_at desc);
-- Same name as schema.sql's definition → a no-op where it already exists.
create index if not exists idx_vinax_events_created
  on public.vinax_events (created_at desc);

-- ---------------------------------------------------------- token columns ---
alter table public.vinax_ai_events
  add column if not exists prompt_tokens int,
  add column if not exists completion_tokens int;

-- -------------------------------------------------------------- vinax_usage -
-- Feature usage + listening heatmap. The heatmap is IST weekday × hour of
-- play/heartbeat events (day 0 = Sunday, matching JS getUTCDay()); `peak` is
-- the first busiest cell in row-major order, null when nothing played.
create or replace function public.vinax_usage(p_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ev as (
    select type, platform, device_id, created_at
    from vinax_events
    where created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
  ),
  hm as (
    select extract(dow  from (created_at at time zone 'Asia/Kolkata'))::int as d,
           extract(hour from (created_at at time zone 'Asia/Kolkata'))::int as h,
           count(*)::int as n
    from ev
    where type in ('play', 'heartbeat')
    group by 1, 2
  ),
  grid as (
    select gd.d, gh.h, coalesce(hm.n, 0) as n
    from generate_series(0, 6) as gd(d)
    cross join generate_series(0, 23) as gh(h)
    left join hm on hm.d = gd.d and hm.h = gh.h
  )
  select jsonb_build_object(
    'byType', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(type, ''), 'unknown') as type,
               count(*)::int as n,
               count(distinct device_id) filter (where device_id <> '')::int as devices
        from ev group by 1 order by n desc) t), '[]'::jsonb),
    'byPlatform', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'unknown') as platform, count(*)::int as n
        from ev group by 1 order by n desc) t), '[]'::jsonb),
    'heatmap', (select jsonb_agg(cells order by d) from (
        select d, jsonb_agg(n order by h) as cells from grid group by d) r),
    'peak', (select jsonb_build_object('day', d, 'hour', h, 'n', n)
             from hm where n > 0 order by n desc, d, h limit 1),
    'total', (select count(*)::int from ev)
  );
$$;

-- ------------------------------------------------------------- vinax_funnel -
-- Distinct devices that reached each onboarding step inside the window. The
-- step → event-type membership mirrors STEPS in api/admin/funnel.ts; the
-- percentage against the first step is computed by the endpoint.
create or replace function public.vinax_funnel(p_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ev as (
    select type, device_id
    from vinax_events
    where created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
      and device_id is not null and device_id <> ''
      and type in ('open', 'register', 'play', 'heartbeat', 'complete', 'favorite', 'search', 'share')
  ),
  steps(ord, id, label, types) as (values
    (1, 'open',     'Opened the app',  array['open', 'play', 'heartbeat', 'search', 'register']),
    (2, 'register', 'Chose a name',    array['register']),
    (3, 'play',     'Played a song',   array['play', 'heartbeat', 'complete']),
    (4, 'complete', 'Finished a song', array['complete']),
    (5, 'favorite', 'Liked a song',    array['favorite']),
    (6, 'search',   'Searched',        array['search']),
    (7, 'share',    'Shared',          array['share'])
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'label', s.label,
      'devices', (select count(distinct e.device_id)::int from ev e where e.type = any(s.types))
    ) order by s.ord), '[]'::jsonb)
  from steps s;
$$;

-- -------------------------------------------------------------- vinax_skips -
-- Songs listeners bail on most: skip rate among songs with at least p_min
-- plays, ranked by rate then skips, top 50. Title/artist/image come from the
-- newest event for the song (what the sampled path showed too).
create or replace function public.vinax_skips(p_days int default 7, p_min int default 5)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ev as (
    select type, song_id, song_title, song_artist, song_image, created_at
    from vinax_events
    where type in ('play', 'skip')
      and created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
      and song_id is not null and song_id <> ''
  ),
  agg as (
    select song_id,
           (array_agg(coalesce(song_title, '')  order by created_at desc))[1] as title,
           (array_agg(coalesce(song_artist, '') order by created_at desc))[1] as artist,
           (array_agg(coalesce(song_image, '')  order by created_at desc))[1] as image,
           count(*) filter (where type = 'play')::int as plays,
           count(*) filter (where type = 'skip')::int as skips
    from ev
    group by song_id
  ),
  ranked as (
    select song_id, title, artist, image, plays, skips,
           round(skips::numeric * 100 / plays)::int as rate
    from agg
    where plays >= greatest(p_min, 1) and skips > 0
    order by rate desc, skips desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', song_id, 'title', title, 'artist', artist, 'image', image,
      'plays', plays, 'skips', skips, 'rate', rate
    ) order by rate desc, skips desc), '[]'::jsonb)
  from ranked;
$$;

-- Only the backend (service role) may call these — same deny-all posture as
-- the retention RPC and the RLS hardening script.
revoke execute on function public.vinax_usage(int)       from anon, authenticated;
revoke execute on function public.vinax_funnel(int)      from anon, authenticated;
revoke execute on function public.vinax_skips(int, int)  from anon, authenticated;
grant  execute on function public.vinax_usage(int)       to service_role;
grant  execute on function public.vinax_funnel(int)      to service_role;
grant  execute on function public.vinax_skips(int, int)  to service_role;

-- Verify (each may be empty/zero on a fresh project):
select public.vinax_usage(7);
select public.vinax_funnel(7);
select public.vinax_skips(7, 5);


-- ======================= migrations/2026-09-vinax-7.2-ai-controls.sql =======================
-- ============================================================================
-- VinaX 7.2 — AI spend caps: today's observed use in one bounded read.
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- The Worker enforces the owner's `ai-controls` record (vinax_config) on every
-- AI call (backend/worker/functions/_lib/ai.ts). Its daily token / cost caps
-- need today's token sums; this function returns them grouped by model
-- (a few dozen rows at most) instead of shipping every row of the day to each
-- isolate. Until it exists the Worker samples at most 10,000 of today's rows
-- and reports the figures as a lower bound when the sample is full.
--
-- No listener data: vinax_ai_events holds feature, model, status and token
-- counts only.
--
-- ⚠ supabase/schema.sql drops ALL vinax_% functions before recreating its own
--   set; it recreates this one too, so a schema.sql re-run keeps it.
-- ============================================================================

-- The token columns arrive with the 2026-09 rollups migration; repeated here
-- so this file stands alone (a no-op where they exist).
alter table public.vinax_ai_events
  add column if not exists prompt_tokens int,
  add column if not exists completion_tokens int;

create or replace function public.vinax_ai_usage_since(p_since timestamptz)
returns table (model text, calls bigint, prompt_tokens bigint, completion_tokens bigint, calls_without_usage bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(e.model, '(none)') as model,
         count(*)::bigint as calls,
         coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
         coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
         count(*) filter (where e.prompt_tokens is null or e.completion_tokens is null)::bigint as calls_without_usage
  from vinax_ai_events e
  -- Never scan more than two days, whatever the caller asks for.
  where e.created_at >= greatest(p_since, now() - interval '2 days')
    -- Calls the controls refused are logged for the operations panel but
    -- spent nothing.
    and (e.error is null or e.error not in ('ai_disabled', 'ai_over_budget'))
  group by 1
  order by 2 desc
  limit 500;
$$;

-- Service role only (the Worker); never the public keys. Same pattern as
-- 2026-07-vinax-retention.sql.
revoke execute on function public.vinax_ai_usage_since(timestamptz) from anon, authenticated;
grant execute on function public.vinax_ai_usage_since(timestamptz) to service_role;


-- ======================= migrations/2026-09-vinax-7.2-events-meta.sql =======================
-- ============================================================================
-- VinaX 7.2 — recommendation telemetry metadata on vinax_events.
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- /api/events accepts an optional `meta` object for two event types only
-- (rec_served, rec_outcome). The Worker whitelists its keys, clips strings,
-- bounds numbers and caps the serialised object at 1 KB before it gets here;
-- every other event type never carries meta. Written only with the
-- listener's analytics consent, like every other event.
--
-- Until this file is applied the Worker retries a meta-carrying insert once
-- without `meta` (PostgREST answers 400 / PGRST204 for the unknown column), so
-- ingestion keeps working and only the metadata is lost.
-- ============================================================================

alter table public.vinax_events
  add column if not exists meta jsonb;

-- Defence in depth behind the Worker's own 1 KB cap. jsonb renders with
-- spaces after separators, so the database limit leaves headroom above the
-- compact JSON the Worker measures. NOT VALID: existing rows are not scanned.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vinax_events_meta_shape') then
    alter table public.vinax_events
      add constraint vinax_events_meta_shape
      check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 2048))
      not valid;
  end if;
end $$;

-- Reads are "rec_served / rec_outcome in a time window". Same name as the
-- 2026-09 rollups migration's index, so this is a no-op where it exists.
create index if not exists vinax_events_type_created_at_idx
  on public.vinax_events (type, created_at desc);


-- ======================= migrations/2026-09-vinax-7.2-trends.sql =======================
-- ============================================================================
-- VinaX 7.2 — verified trends (docs/trends.md)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent: safe to run
-- again; every object is created only if it is missing.
--
-- Five tables, written only by the Worker with the service-role key:
--   vinax_trend_runs          one row per provider × region × run: started,
--                             finished, ok, error, attempts, items, quota
--                             units used. Last success = newest ok row.
--   vinax_trend_snapshots     one row per stored chart snapshot. The unique
--                             key (source, region, chart, snapshot_key) is
--                             what makes ingestion idempotent: re-running a
--                             job for the same snapshot inserts nothing.
--   vinax_trend_observations  what a source said, item by item: its own id
--                             and link (never a catalogue id), rank, language
--                             evidence, statistics as returned, provenance,
--                             observed / fetched / expires times.
--   vinax_trend_matches       one row per source item: the catalogue song it
--                             maps to (or not), confidence, method, review
--                             status, reviewer and the correction history.
--   vinax_trend_editorial     the owner's editorial imports: evidence link,
--                             start, expiry, who imported them and when.
--
-- Retention. The video platform's developer policies let data read without
-- user credentials be stored for at most 30 calendar days before it is
-- deleted or refreshed. The scheduled job deletes snapshots (observations go
-- with them, ON DELETE CASCADE) 28 days after they were fetched, and matches
-- that have not been seen again for 28 days. See docs/trends.md.
--
-- Metadata only. Nothing here holds audio, and nothing should.
-- ============================================================================

-- ------------------------------------------------------------------- runs ---
create table if not exists public.vinax_trend_runs (
  id                 uuid primary key,
  source             text not null,
  region             text not null,
  trigger            text not null default 'cron',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  ok                 boolean not null default false,
  status             text not null default 'running'
                     check (status in ('running', 'ok', 'error', 'skipped')),
  error              text,
  attempts           int not null default 0,
  items_fetched      int not null default 0,
  items_inserted     int not null default 0,
  matched            int not null default 0,
  queued_for_review  int not null default 0,
  quota_units        int not null default 0,
  snapshot_key       text,
  duplicate_snapshot boolean not null default false
);
-- Last success per source/region, quota used today, the console's run log.
create index if not exists vinax_trend_runs_source_started_idx
  on public.vinax_trend_runs (source, region, started_at desc);
create index if not exists vinax_trend_runs_success_idx
  on public.vinax_trend_runs (region, finished_at desc) where ok;

-- -------------------------------------------------------------- snapshots ---
create table if not exists public.vinax_trend_snapshots (
  id           bigint generated always as identity primary key,
  source       text not null,
  region       text not null,
  chart        text not null,
  snapshot_key text not null,
  observed_at  timestamptz not null,
  fetched_at   timestamptz not null,
  item_count   int not null default 0,
  run_id       uuid,
  constraint vinax_trend_snapshots_key unique (source, region, chart, snapshot_key)
);
-- Newest snapshot per source/region, and the comparable earlier one for momentum.
create index if not exists vinax_trend_snapshots_latest_idx
  on public.vinax_trend_snapshots (region, source, chart, observed_at desc);
-- Retention sweep.
create index if not exists vinax_trend_snapshots_fetched_idx
  on public.vinax_trend_snapshots (fetched_at);

-- ----------------------------------------------------------- observations ---
create table if not exists public.vinax_trend_observations (
  id                bigint generated always as identity primary key,
  snapshot_id       bigint not null references public.vinax_trend_snapshots (id) on delete cascade,
  source            text not null,
  source_item_id    text not null,
  url               text,
  region            text not null,
  chart             text not null,
  title             text not null,
  credit            text,
  language_evidence jsonb not null default '{}'::jsonb,
  observed_at       timestamptz not null,
  fetched_at        timestamptz not null,
  expires_at        timestamptz not null,
  source_rank       int not null check (source_rank > 0),
  statistics        jsonb,
  provenance        jsonb not null default '{}'::jsonb,
  constraint vinax_trend_observations_item unique (snapshot_id, source_item_id),
  constraint vinax_trend_observations_rank unique (snapshot_id, source_rank)
);
-- The public read: one snapshot's unexpired items in rank order
-- (the unique (snapshot_id, source_rank) index already serves it).
create index if not exists vinax_trend_observations_expiry_idx
  on public.vinax_trend_observations (snapshot_id, expires_at);
-- The console: the latest observation of an item under review.
create index if not exists vinax_trend_observations_item_idx
  on public.vinax_trend_observations (source, source_item_id, observed_at desc);

-- ---------------------------------------------------------------- matches ---
create table if not exists public.vinax_trend_matches (
  id                 bigint generated always as identity primary key,
  source             text not null,
  source_item_id     text not null,
  catalog_id         text,
  catalog_title      text,
  catalog_artist     text,
  catalog_language   text,
  mapping_confidence real not null default 0 check (mapping_confidence >= 0 and mapping_confidence <= 1),
  method             text not null,
  status             text not null
                     check (status in ('matched', 'review', 'accepted', 'rejected', 'corrected')),
  reason             text,
  candidates         jsonb not null default '[]'::jsonb,
  reviewed_by        text,
  reviewed_at        timestamptz,
  history            jsonb not null default '[]'::jsonb,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  constraint vinax_trend_matches_item unique (source, source_item_id)
);
-- The review queue and the confidence distribution.
create index if not exists vinax_trend_matches_status_idx
  on public.vinax_trend_matches (status, last_seen_at desc);
-- Recent review decisions.
create index if not exists vinax_trend_matches_reviewed_idx
  on public.vinax_trend_matches (reviewed_at desc) where reviewed_at is not null;
-- Retention sweep.
create index if not exists vinax_trend_matches_seen_idx
  on public.vinax_trend_matches (last_seen_at);

-- -------------------------------------------------------------- editorial ---
create table if not exists public.vinax_trend_editorial (
  id           bigint generated always as identity primary key,
  dedupe_key   text not null,
  title        text not null,
  artist       text,
  catalog_id   text,
  region       text not null default 'IN',
  language     text,
  position     int not null default 1 check (position between 1 and 100),
  evidence_url text not null check (evidence_url ~ '^https://'),
  note         text,
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'withdrawn')),
  imported_by  text,
  imported_at  timestamptz not null default now(),
  import_batch text,
  constraint vinax_trend_editorial_dedupe unique (dedupe_key),
  constraint vinax_trend_editorial_window check (expires_at > starts_at)
);
-- The editorial provider's read: active entries of a region inside their window.
create index if not exists vinax_trend_editorial_active_idx
  on public.vinax_trend_editorial (region, status, expires_at);

-- -------------------------------------------------------------- lock down ---
-- Same posture as every other vinax_ table: RLS on, no policies, no grants
-- for the public roles. The Worker's service-role key bypasses RLS.
alter table public.vinax_trend_runs         enable row level security;
alter table public.vinax_trend_snapshots    enable row level security;
alter table public.vinax_trend_observations enable row level security;
alter table public.vinax_trend_matches      enable row level security;
alter table public.vinax_trend_editorial    enable row level security;
revoke all on table public.vinax_trend_runs         from anon, authenticated;
revoke all on table public.vinax_trend_snapshots    from anon, authenticated;
revoke all on table public.vinax_trend_observations from anon, authenticated;
revoke all on table public.vinax_trend_matches      from anon, authenticated;
revoke all on table public.vinax_trend_editorial    from anon, authenticated;

-- Verify (all empty on a fresh project):
select count(*) as runs from public.vinax_trend_runs;
select count(*) as snapshots from public.vinax_trend_snapshots;
select count(*) as matches from public.vinax_trend_matches;


-- ======================= migrations/2026-10-vinax-12.2-accounts.sql =======================
-- 12.2 — optional Google sign-in: one row per Google account.
-- Idempotent; paste into the SQL editor. Reached only by the Worker with the
-- service key: RLS on, no policies, so anon/authenticated roles see nothing.
--
-- google_sub  the stable Google account id ("sub" in the ID token)
-- username    the listener's existing VinaX username, linked on first sign-in
--             when the device proved it owns it (a valid signed device id)
-- device_id   the last device that signed in (vinax_users.device_id)

create table if not exists vinax_accounts (
  google_sub      text primary key,
  email           text,
  email_verified  boolean not null default false,
  name            text,
  picture         text,
  username        text,
  device_id       text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

create unique index if not exists vinax_accounts_username_lower
  on vinax_accounts (lower(username)) where username is not null;

alter table vinax_accounts enable row level security;


-- ======================= migrations/2026-07-vinax-rls-audit.sql =======================
-- ============================================================================
-- VinaX — Supabase RLS audit + hardening (audit §6)
-- Paste the WHOLE file into Supabase Dashboard → SQL Editor → Run.
--
-- WHY THIS IS SAFE TO RUN AS-IS
--   Every VinaX backend call uses the SERVICE-ROLE key (functions/_lib/
--   supabase.ts), which bypasses RLS entirely — so locking the public roles
--   cannot break the app. The web/Android client NEVER talks to Supabase
--   directly (verified: zero supabase references in src/). Therefore the
--   correct posture is deny-all for `anon` and `authenticated`: RLS on,
--   no policies for them, no table grants, no future-table grants.
--
-- WHAT AN ATTACKER HAS WITHOUT THIS
--   The project URL + anon key are discoverable for any Supabase project.
--   If a table was created with default grants and RLS off, the anon key can
--   read (or write!) it over PostgREST. These tables hold push tokens and
--   anonymous analytics — exactly what the privacy promise says stays private.
--
-- The script is idempotent and skips tables that don't exist in your project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1 · AUDIT (read-only) — the "before" picture
-- ----------------------------------------------------------------------------
select 'BEFORE: table RLS status' as report;
select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  c.relforcerowsecurity                       as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname like 'vinax_%'
order by 1;

select 'BEFORE: policies on vinax tables' as report;
select schemaname, tablename, policyname, roles, cmd, permissive
from pg_policies
where schemaname = 'public' and tablename like 'vinax_%'
order by tablename, policyname;

select 'BEFORE: public-role grants on vinax tables' as report;
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'vinax_%'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- ----------------------------------------------------------------------------
-- PART 2 · HARDEN (idempotent)
--   For every vinax_* table that exists:
--     1. enable + force RLS (force = even the table owner obeys policies;
--        service_role still bypasses via BYPASSRLS)
--     2. revoke every privilege from anon + authenticated
--   Then close the future: default privileges for new tables/sequences.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'vinax_events',        -- anonymous play/telemetry events
    'vinax_ai_events',     -- AI lane usage counters
    'vinax_users',         -- anonymous device registrations (name only)
    'vinax_feedback',      -- listener feedback / broken-track reports
    'vinax_push_subscriptions', -- web push endpoints (+ coarse geo columns)
    'vinax_fcm_tokens',    -- Android push tokens
    'vinax_rooms',         -- Listen Together rooms
    'vinax_room_members',  -- Listen Together members
    'vinax_blocklist'      -- admin content blocklist
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
      raise notice 'hardened: %', t;
    else
      raise notice 'skipped (not present): %', t;
    end if;
  end loop;
end $$;

-- Any vinax_* table added later starts locked too (covers tables created by
-- the postgres role in the dashboard SQL editor — the usual path).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Belt-and-braces: sequences backing existing vinax tables.
do $$
declare
  s record;
begin
  for s in
    select sequencename from pg_sequences
    where schemaname = 'public' and sequencename like 'vinax_%'
  loop
    execute format('revoke all on sequence public.%I from anon, authenticated', s.sequencename);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- PART 3 · VERIFY — the "after" picture. Expect:
--   * every vinax table: rls_enabled = true, rls_forced = true
--   * zero rows in the grants report
--   * the policy report unchanged (any leftover policies are inert without
--     grants, but review anything listed — a policy naming anon/authenticated
--     that you don't recognise deserves a manual DROP POLICY.)
-- ----------------------------------------------------------------------------
select 'AFTER: table RLS status' as report;
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname like 'vinax_%'
order by 1;

select 'AFTER: public-role grants remaining (expect ZERO rows)' as report;
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'vinax_%'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select 'AFTER: policies remaining (review anything unexpected)' as report;
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename like 'vinax_%'
order by tablename, policyname;


-- ======================= 13.0 — account sync =======================
-- One row per Google account: the account's synced data, in the same format
-- as the app's backup file (library and playlists, history, taste profile,
-- settings, smart collections, bookmarks, Home layout — never AI chats).
-- Written only by the Worker (/api/account/data) with the service key.
-- `version` goes up by one on every write; a write that names an older
-- version is refused (409) with the newer copy, so two devices merge instead
-- of overwriting each other. Deleting the account removes the row too.

create table if not exists vinax_account_data (
  google_sub  text primary key references vinax_accounts (google_sub) on delete cascade,
  backup      jsonb not null,
  version     bigint not null default 1,
  bytes       integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table vinax_account_data enable row level security;


-- ======================= migrations/2026-10-vinax-13.7-account-basics.sql =======================
-- 13.7 — account basics for the owner console + faster console search.
-- Idempotent; paste into the SQL editor (already part of vinax-13.sql).
--
-- Every signed-in account now carries coarse sign-in facts, written by the
-- Worker at sign-in and on the session check (/api/auth/google, /api/auth/me):
--   country, region, city  Cloudflare's edge geo for the request (never the IP)
--   platform               web | android | ios
--   app_version            the app build that signed in
-- Listening activity (plays, searches, favourites) stays opt-in and lives in
-- vinax_users / vinax_events as before. Disclosed on the Privacy page.

alter table vinax_accounts add column if not exists country     text;
alter table vinax_accounts add column if not exists region      text;
alter table vinax_accounts add column if not exists city        text;
alter table vinax_accounts add column if not exists platform    text;
alter table vinax_accounts add column if not exists app_version text;

create index if not exists vinax_accounts_last_seen on vinax_accounts (last_seen desc);
create index if not exists vinax_accounts_device_id on vinax_accounts (device_id) where device_id is not null;

-- Console search ("contains" on name, username, Gmail) uses trigram indexes so
-- ILIKE '%text%' stays fast as the tables grow. pg_trgm lives in whichever
-- schema the project installed it in (Supabase: `extensions`).
create extension if not exists pg_trgm with schema extensions;
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists vinax_accounts_name_trgm  on vinax_accounts using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_accounts_email_trgm on vinax_accounts using gin (email %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_accounts_uname_trgm on vinax_accounts using gin (username %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_users_name_trgm     on vinax_users using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_users_uname_trgm    on vinax_users using gin (username %I.gin_trgm_ops)', s);
end $$;

-- ======================= status page (uptime) =======================
-- Read and written by /api/status (the status page and the status-tick
-- workflow). Kept outside the vinax_ prefix since they were first created,
-- so a vinax_ reset leaves the uptime history alone.

create table if not exists uptime_daily (
  component  text not null,
  day        date not null,
  up         integer not null default 0,
  total      integer not null default 0,
  primary key (component, day)
);

create table if not exists uptime_last (
  component   text primary key,
  ok          boolean not null,
  latency_ms  integer,
  checked_at  timestamptz not null default now()
);

alter table uptime_daily enable row level security;
alter table uptime_last  enable row level security;
