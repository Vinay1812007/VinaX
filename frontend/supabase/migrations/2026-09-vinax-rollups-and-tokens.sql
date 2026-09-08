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
