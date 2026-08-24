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
