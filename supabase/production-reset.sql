-- ============================================================================
-- VinaX — FULL PRODUCTION RESET (2026-08-10, app v4.3.0)
-- ONE paste in Supabase Dashboard → SQL Editor → Run.
--
-- ⚠⚠  DESTRUCTIVE AND IRREVERSIBLE  ⚠⚠
-- This PERMANENTLY DELETES all server-side data:
--   · listener analytics & play events        · error/vitals telemetry
--   · feedback inbox + admin audit trail      · AI event logs
--   · content BLOCKLIST (re-block after!)     · Listen Together rooms
--   · push subscriptions, web + FCM (devices re-register on next app open)
--   · A/B experiment definitions
-- NOT affected (all personalization is on-device by design): listeners'
-- favorites, history, downloads, taste profiles, settings — every device
-- keeps working and simply reappears in analytics as it comes online.
--
-- What you get after: the complete, current, production schema — every
-- table, index, RPC function, the H8 host_token column (Listen Together),
-- the D11 reaction columns, the A/B experiments table, the retention
-- cohort function, and deny-all RLS on every table. Runs top to bottom in
-- one transaction-free pass; each section is idempotent on its own.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0 · DROP EVERYTHING (tables cascade; schema.sql's own preamble drops all
--     vinax_% functions before recreating them)
-- ---------------------------------------------------------------------------
drop table if exists public.vinax_room_members      cascade;
drop table if exists public.vinax_rooms             cascade;
drop table if exists public.vinax_push_subscriptions cascade;
drop table if exists public.vinax_fcm_tokens        cascade;
drop table if exists public.vinax_ai_events         cascade;
drop table if exists public.vinax_blocklist         cascade;
drop table if exists public.vinax_feedback          cascade;
drop table if exists public.vinax_events            cascade;
drop table if exists public.vinax_users             cascade;
drop table if exists public.vinax_experiments       cascade;


-- ---------------------------------------------------------------------------
-- 1 · CORE SCHEMA (tables, indexes, RLS, all admin RPC functions)
-- ---------------------------------------------------------------------------
-- VinaX — complete database schema.
-- Paste into Supabase -> SQL Editor and run once to (re)create everything the
-- app + admin need: tables, indexes, row-level security, and analytics RPCs.
-- Data is coarse + anonymous (device id, optional name, city-level geo). No raw IPs.
-- Safe to re-run (uses "if not exists" / "create or replace").

-- ============================== TABLES ==============================

create table if not exists vinax_users (
  device_id            text primary key,
  name                 text,
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
  created_at  timestamptz default now()
);
-- Idempotent add for existing deploys that predate H-SRV-6.
alter table if exists vinax_events
  add column if not exists origin_verified boolean default false;

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
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  lang       text,
  country    text,     -- CF ISO-2, set/updated at subscribe time
  region     text,     -- CF human name (state / province)
  city       text,     -- CF city name (may be null on some networks)
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
-- Geo columns added post-hoc for the location-targeted push feature.
alter table if exists vinax_push_subscriptions
  add column if not exists country text,
  add column if not exists region  text,
  add column if not exists city    text;

-- Android FCM device tokens (written by /api/push/fcm-register, read by the
-- admin push sender). Was missing from this file while the code used it.
create table if not exists vinax_fcm_tokens (
  token      text primary key,
  platform   text,
  lang       text,
  country    text,
  region     text,
  city       text,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table if exists vinax_fcm_tokens
  add column if not exists country text,
  add column if not exists region  text,
  add column if not exists city    text;

-- ============================== INDEXES ==============================

create index if not exists idx_vinax_users_last_seen   on vinax_users (last_seen desc);
create index if not exists idx_vinax_events_created    on vinax_events (created_at desc);
create index if not exists idx_vinax_events_device     on vinax_events (device_id);
create index if not exists idx_vinax_feedback_created  on vinax_feedback (created_at desc);
create index if not exists idx_vinax_room_members_seen on vinax_room_members (code, last_seen desc);
create index if not exists vinax_ai_events_created_idx on vinax_ai_events (created_at desc);
create index if not exists vinax_ai_events_feature_idx on vinax_ai_events (feature);
create index if not exists idx_vinax_fcm_tokens_active on vinax_fcm_tokens (active, updated_at desc);
-- Geo-targeted push filters on both channels stay fast as subscribers grow.
create index if not exists idx_vinax_push_subs_geo on vinax_push_subscriptions (country, region, city) where active = true;
create index if not exists idx_vinax_fcm_tokens_geo on vinax_fcm_tokens (country, region, city) where active = true;

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

create or replace function vinax_top_listeners(days int default 7, lim int default 20)
returns table(device_id text, name text, plays bigint) language sql stable as $$
  select e.device_id, max(u.name) as name, count(*)::bigint as plays
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

-- ---------------------------------------------------------------------------
-- 2 · LISTEN TOGETHER REACTIONS (D11)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3 · A/B EXPERIMENTS (E2)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4 · RETENTION COHORTS — must come AFTER the core schema, whose
--     preamble drops every vinax_% function including this one
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5 · RLS POSTURE VERIFICATION — final SELECT should show every
--     vinax_% table with rls_enabled = true and zero policies
-- ---------------------------------------------------------------------------
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
