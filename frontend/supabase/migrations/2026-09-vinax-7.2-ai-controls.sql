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
