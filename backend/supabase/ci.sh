#!/usr/bin/env bash
# =============================================================================
# VinaX database · CI runner
#
#   backend/supabase/ci.sh check  <database url>   prove the schema on a scratch database
#   backend/supabase/ci.sh apply  <database url>   apply schema.sql to a real project
#
# check — for a throwaway Postgres (CI's service container, a local cluster):
#   1. creates the Supabase roles the schema grants to, when they are missing
#   2. applies schema.sql, then applies it AGAIN (it must be idempotent)
#   3. runs check.sql (seeds, calls every function, asserts, rolls back)
#   4. runs reset.sql, applies schema.sql a third time, runs check.sql again
#   Nothing survives: the database is scratch by definition.
#
# apply — for the production project (the SUPABASE_DB_URL secret):
#   1. applies schema.sql (idempotent: adds what is missing, deletes nothing)
#   2. reads back meta.schema and the table count and prints them
#   It never runs reset.sql or check.sql against this database.
#
# Needs psql (apt: postgresql-client). The URL is a normal libpq URL:
#   postgresql://user:password@host:5432/dbname
# =============================================================================
set -euo pipefail

mode="${1:-}"
url="${2:-${DATABASE_URL:-}}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { echo "usage: $0 check|apply <database url>" >&2; exit 2; }
[ "$mode" = check ] || [ "$mode" = apply ] || usage
[ -n "$url" ] || { echo "no database url given" >&2; usage; }

# Quiet, stop on the first error, never prompt for a password.
psql_() { PGCONNECT_TIMEOUT=20 psql "$url" -v ON_ERROR_STOP=1 -X -q -w "$@"; }
step() { printf '\n== %s\n' "$*"; }

step "connecting"
psql_ -At -c "select 'PostgreSQL ' || current_setting('server_version') || ' as ' || current_user || ' on ' || current_database();"

if [ "$mode" = check ]; then
  step "roles (anon, authenticated, service_role) — created when missing"
  psql_ <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
SQL

  step "schema.sql — first apply"
  psql_ -f "$here/schema.sql"
  step "schema.sql — second apply (must be idempotent)"
  psql_ -f "$here/schema.sql"
  step "check.sql — functions and constraints, rolled back"
  psql_ -f "$here/check.sql"
  step "reset.sql — wipe"
  psql_ -f "$here/reset.sql"
  step "schema.sql — apply on the wiped database"
  psql_ -f "$here/schema.sql"
  step "check.sql — again"
  psql_ -f "$here/check.sql"
  step "ok: schema.sql applies, re-applies, resets and every function answers"
  exit 0
fi

# ---- apply ------------------------------------------------------------------
step "schema.sql — apply (idempotent; nothing is deleted)"
psql_ -f "$here/schema.sql"
step "verify"
psql_ -At <<'SQL'
select 'schema version ' || (value ->> 'version') || ', applied ' || (value ->> 'appliedAt') from meta where key = 'schema';
select count(*) || ' tables in public' from pg_tables where schemaname = 'public';
select count(*) || ' functions in public' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select case when bool_and(relrowsecurity and relforcerowsecurity) then 'row-level security forced on every table' else 'WARNING: a table is missing forced row-level security' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
SQL
step "ok: applied"
