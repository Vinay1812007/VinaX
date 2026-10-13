-- 12.2 — optional Google sign-in: one row per Google account.
-- Idempotent; paste into the SQL editor. Reached only by the Worker with the
-- service key: RLS on, no policies, so anon/authenticated roles see nothing.
--
-- google_sub  the stable Google account id ("sub" in the ID token)
-- username    the listener's existing VinaX username, linked on first sign-in
--             when the device proved it owns it (a valid signed device id)
-- device_id   the last device that signed in (vinax_users.device_id)

create table if not exists vinax_accounts (
  google_sub      text primary key,
  email           text,
  email_verified  boolean not null default false,
  name            text,
  picture         text,
  username        text,
  device_id       text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

create unique index if not exists vinax_accounts_username_lower
  on vinax_accounts (lower(username)) where username is not null;

alter table vinax_accounts enable row level security;
