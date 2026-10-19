-- 13.7 — account basics for the owner console + faster console search.
-- Idempotent; paste into the SQL editor (already part of vinax-13.sql).
--
-- Every signed-in account now carries coarse sign-in facts, written by the
-- Worker at sign-in and on the session check (/api/auth/google, /api/auth/me):
--   country, region, city  Cloudflare's edge geo for the request (never the IP)
--   platform               web | android | ios
--   app_version            the app build that signed in
-- Listening activity (plays, searches, favourites) stays opt-in and lives in
-- vinax_users / vinax_events as before. Disclosed on the Privacy page.

alter table vinax_accounts add column if not exists country     text;
alter table vinax_accounts add column if not exists region      text;
alter table vinax_accounts add column if not exists city        text;
alter table vinax_accounts add column if not exists platform    text;
alter table vinax_accounts add column if not exists app_version text;

create index if not exists vinax_accounts_last_seen on vinax_accounts (last_seen desc);
create index if not exists vinax_accounts_device_id on vinax_accounts (device_id) where device_id is not null;

-- Console search ("contains" on name, username, Gmail) uses trigram indexes so
-- ILIKE '%text%' stays fast as the tables grow. pg_trgm lives in whichever
-- schema the project installed it in (Supabase: `extensions`).
create extension if not exists pg_trgm with schema extensions;
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists vinax_accounts_name_trgm  on vinax_accounts using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_accounts_email_trgm on vinax_accounts using gin (email %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_accounts_uname_trgm on vinax_accounts using gin (username %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_users_name_trgm     on vinax_users using gin (name %I.gin_trgm_ops)', s);
  execute format('create index if not exists vinax_users_uname_trgm    on vinax_users using gin (username %I.gin_trgm_ops)', s);
end $$;
