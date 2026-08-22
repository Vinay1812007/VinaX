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
