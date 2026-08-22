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
