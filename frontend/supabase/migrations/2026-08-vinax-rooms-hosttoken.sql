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
