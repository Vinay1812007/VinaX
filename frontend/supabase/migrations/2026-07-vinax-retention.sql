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
