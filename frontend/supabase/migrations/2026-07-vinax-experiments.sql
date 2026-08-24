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
