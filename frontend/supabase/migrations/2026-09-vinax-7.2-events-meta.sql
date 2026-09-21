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
