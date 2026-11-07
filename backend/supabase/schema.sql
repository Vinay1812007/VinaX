-- =============================================================================
-- VinaX database · schema version 17
--
-- The whole database in one file. Open the Supabase dashboard, SQL Editor,
-- paste this file, Run. Every statement is idempotent, so re-running it is
-- safe and never deletes data (reset.sql is the file that wipes).
--
-- Who talks to it: only the Cloudflare Worker (backend/worker), with the
-- service-role key. Row-level security is on and FORCED on every table and no
-- policy exists, so the public anon key can read and write nothing. The app
-- and the owner console never hold a database key.
--
-- What is NOT here: precise locations, the listener's library. Geo is
-- Cloudflare's edge country / region / city. The one place an IP address is
-- kept is sign_ins (version 12): each Google sign-in, for 90 days, so the
-- owner and the listener can tell a sign-in that was not theirs.
--
-- Layout
--   1. extensions and meta        2. listeners and accounts
--   3. usage events               4. feedback and blocked content
--   5. Listen Together rooms      6. push devices and notifications
--   7. settings and experiments   8. audit log, uptime, job runs
--  8b. console admins, error status (version 10)
--   9. VinaX AI conversations    9b. the personal engine
--  10. views
--  11. functions (stats_*, room_*, housekeeping; Trending and Search
--      Insights: version 11)
--  (2b. sign-in history, version 12, sits after accounts; version 13 adds
--  the device system and browser to listeners, and listening time;
--  version 14 adds Top listeners, At risk, the listening heat map and
--  retention by sign-in week; version 15 adds the owner's notes and tags
--  and the profile extras)
--  version 16 adds phone model, system version and how the app runs, and
--  time in the app)
--  version 17 adds weekly_summary for the owner's Monday email)
--  12. security
-- =============================================================================

-- ----------------------------------------------------------------- 1. meta --
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table meta is 'Database facts the Worker reads: schema version, applied-at time.';

-- ---------------------------------------------------- 2. listeners, accounts --

-- One row per device that opted in to usage sharing (or claimed a handle).
-- `id` is the server-derived device id (never the client's raw install uuid).
create table if not exists listeners (
  id            text primary key,
  display_name  text,
  handle        text,
  platform      text not null default 'web',          -- web | android | ios
  app_version   text,
  country       text,                                   -- ISO-2 from the edge
  region        text,
  city          text,
  now_playing   jsonb,                                  -- { id, title, artist, image, language }
  is_playing    boolean not null default false,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  constraint listeners_handle_shape check (handle is null or handle ~ '^[a-z0-9_]{3,20}$'),
  constraint listeners_now_playing_shape check (now_playing is null or jsonb_typeof(now_playing) = 'object')
);
create unique index if not exists listeners_handle_key on listeners (lower(handle)) where handle is not null;
create index if not exists listeners_last_seen_idx on listeners (last_seen desc);
create index if not exists listeners_platform_idx on listeners (platform, last_seen desc);
create index if not exists listeners_name_trgm on listeners using gin (display_name extensions.gin_trgm_ops);
create index if not exists listeners_handle_trgm on listeners using gin (handle extensions.gin_trgm_ops);
comment on table listeners is 'Anonymous devices: latest state only (name, handle, platform, coarse geo, what is playing).';

-- One row per Google sign-in. `id` is Google's stable subject id.
create table if not exists accounts (
  id              text primary key,
  email           text,
  email_verified  boolean not null default false,
  name            text,
  picture         text,
  listener_id     text references listeners (id) on delete set null,
  platform        text,
  app_version     text,
  country         text,
  region          text,
  city            text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);
create index if not exists accounts_last_seen_idx on accounts (last_seen desc);
create index if not exists accounts_listener_idx on accounts (listener_id) where listener_id is not null;
create index if not exists accounts_email_trgm on accounts using gin (email extensions.gin_trgm_ops);
create index if not exists accounts_name_trgm on accounts using gin (name extensions.gin_trgm_ops);
comment on table accounts is 'Signed-in listeners (Google). Deleting the row deletes the synced backup with it.';

-- V2 1.0.1 — every device a signed-in listener uses carries its account, so
-- the console lists the PERSON once (accounts.listener_id is only the latest
-- device). Set at sign-in and on session checks; filled here from the links
-- that already exist.
alter table listeners add column if not exists account_id text references accounts (id) on delete set null;
create index if not exists listeners_account_idx on listeners (account_id) where account_id is not null;
update listeners l set account_id = a.id
  from accounts a
  where a.listener_id = l.id and l.account_id is null;

-- Version 13 — the device's system and browser, read by the Worker from the
-- user agent of every usage report, so the console can tell the Android app
-- from Android in a browser, an iPhone, a Mac, a Windows PC… (iPad Safari
-- usually says it is a Mac, so iPads mostly count as Mac web.)
alter table listeners add column if not exists os text;        -- android | ios | ipados | macos | windows | chromeos | linux
alter table listeners add column if not exists browser text;   -- Chrome | Safari | Edge | Firefox | Samsung Internet | Opera

-- Version 16 — device detail, read by the Worker from the same user agent
-- (the Android app's WebView names the phone model; Chrome's reduced agent
-- and iPhones do not), and how the listener runs VinaX: the Android / iOS
-- app, a web app added to the home screen, or a browser tab (sent by the app).
alter table listeners add column if not exists os_version text;    -- "14", "17.4"
alter table listeners add column if not exists device_model text;  -- "SM-S918B", "RMX3741"
alter table listeners add column if not exists device_brand text;  -- Samsung | Vivo | Xiaomi | Apple | …
alter table listeners add column if not exists display_mode text;  -- app | installed | tab

-- ---------------------------------------------- 2b. sign-in history (v12) --
-- One row per Google sign-in to the app, written by POST /api/auth/google:
-- when, the connection's IP address, the browser / system from the user
-- agent, the app, the edge's geo, and whether this was the account's first
-- sign-in or a device it had not used before. The housekeeping job deletes
-- rows older than 90 days; deleting the account deletes its rows.
create table if not exists sign_ins (
  id           bigint generated always as identity primary key,
  account_id   text not null references accounts (id) on delete cascade,
  at           timestamptz not null default now(),
  ip           text,
  browser      text,
  platform     text,
  app_version  text,
  country      text,
  region       text,
  city         text,
  new_device   boolean not null default false,
  signup       boolean not null default false
);
create index if not exists sign_ins_account_idx on sign_ins (account_id, at desc);
create index if not exists sign_ins_at_idx on sign_ins (at);
comment on table sign_ins is 'Google sign-ins to the app with IP address, browser and edge geo. Kept 90 days (housekeeping); cascades with the account.';
-- …and the twins already listed: a device nobody linked that carries an
-- account's name, in the same place, and first reported within 15 minutes of
-- that account's first sign-in is that account's browser (the sign-in came
-- before its first usage report). Only when exactly one account fits.
update listeners l set account_id = a.id
  from accounts a
  where l.account_id is null
    and not exists (select 1 from accounts x where x.listener_id = l.id)
    and l.display_name is not null and a.name is not null
    and lower(btrim(l.display_name)) = lower(btrim(a.name))
    and coalesce(l.city, '') = coalesce(a.city, '')
    and abs(extract(epoch from (l.first_seen - a.created_at))) < 900
    and (select count(*) from accounts b
         where lower(btrim(b.name)) = lower(btrim(l.display_name))
           and coalesce(b.city, '') = coalesce(l.city, '')
           and abs(extract(epoch from (l.first_seen - b.created_at))) < 900) = 1;

-- The signed-in listener's synced copy of their library and settings — the
-- app's own backup-file JSON. `version` rises by one on every write; a write
-- that names an older version is refused so two devices merge, not overwrite.
create table if not exists account_backups (
  account_id  text primary key references accounts (id) on delete cascade,
  payload     jsonb not null,
  version     bigint not null default 1,
  bytes       integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint account_backups_payload_shape check (jsonb_typeof(payload) = 'object')
);

-- 15.0 — the social layer, all opt-in and all keyed by the account.
--
-- A public profile: what the listener chose to show (a handle, a line, the
-- artists and songs they play most, what is playing now). `summary` is the
-- app's own digest, written by the device with sync; nothing is derived
-- server-side. `public` false keeps it to the listener and their followers.
create table if not exists profiles (
  account_id  text primary key references accounts (id) on delete cascade,
  handle      text not null,
  public      boolean not null default false,
  bio         text,
  summary     jsonb not null default '{}'::jsonb,       -- { topArtists: [{name, plays}], recentLikes: [song…], topLanguages: [{id, pct}] }
  now_playing jsonb,                                    -- { id, title, artist, image } when the listener shares it
  share_now   boolean not null default false,
  updated_at  timestamptz not null default now(),
  constraint profiles_handle_shape check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 160),
  constraint profiles_summary_shape check (jsonb_typeof(summary) = 'object')
);
create unique index if not exists profiles_handle_key on profiles (lower(handle));

-- Who follows whom. One direction per row; no approval step (profiles are
-- public or not, and a private profile shows only to followers it follows back).
create table if not exists follows (
  follower_id text not null references accounts (id) on delete cascade,
  followee_id text not null references accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on follows (followee_id);

-- A playlist that left the device: a public page (`public`), collaborators
-- through `collab_token` (a secret in the invite link), one owner. `songs`
-- carries the app's own song records (≤ 500) so a public page needs no
-- catalogue call. `version` rises by one on every write, like a backup.
create table if not exists shared_playlists (
  id           text primary key,                        -- 12 url-safe chars
  owner_id     text not null references accounts (id) on delete cascade,
  name         text not null,
  description  text,
  songs        jsonb not null default '[]'::jsonb,
  public       boolean not null default false,
  collab_token text,
  version      bigint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shared_playlists_name_len check (char_length(name) between 1 and 80),
  constraint shared_playlists_songs_shape check (jsonb_typeof(songs) = 'array')
);
create index if not exists shared_playlists_owner_idx on shared_playlists (owner_id, updated_at desc);

-- ------------------------------------------------------------- 3. events --

-- Append-only usage log, written only after the listener opted in.
-- kind: open | heartbeat | play | pause | complete | skip | favorite | search |
--       share | register | error | lyric-miss | rec_served | rec_outcome | …
create table if not exists events (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  listener_id  text,
  kind         text not null,
  song_id      text,
  song_title   text,
  song_artist  text,
  song_image   text,
  language     text,
  platform     text,
  app_version  text,
  country      text,
  region       text,
  city         text,
  error_kind   text,
  message      text,
  meta         jsonb,
  verified     boolean not null default false,          -- the device proved its signed id
  constraint events_meta_shape check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 2048))
);
create index if not exists events_at_idx on events (at desc);
create index if not exists events_kind_at_idx on events (kind, at desc);
create index if not exists events_listener_at_idx on events (listener_id, at desc);
create index if not exists events_song_idx on events (song_id) where kind = 'play';
comment on table events is 'Consented usage events. Purged by housekeeping after settings.retention.eventsDays (default 180).';

-- ------------------------------------------- 4. feedback, blocked content --

create table if not exists feedback (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  listener_id  text,
  name         text,
  kind         text not null default 'other',            -- bug | idea | content | other
  message      text not null,
  platform     text,
  app_version  text,
  country      text,
  city         text,
  status       text not null default 'new',              -- new | read | resolved
  note         text,                                     -- the owner's note
  resolved_at  timestamptz,
  constraint feedback_status_shape check (status in ('new', 'read', 'resolved'))
);
create index if not exists feedback_status_at_idx on feedback (status, at desc);

create table if not exists blocked_content (
  id          bigint generated always as identity primary key,
  kind        text not null,                             -- song | album | artist | keyword
  value       text not null,                             -- song id, artist name, keyword
  label       text,                                      -- what the owner sees (a song title)
  reason      text,
  created_at  timestamptz not null default now(),
  constraint blocked_content_kind_shape check (kind in ('song', 'album', 'artist', 'keyword'))
);
create unique index if not exists blocked_content_key on blocked_content (kind, lower(value));

-- ------------------------------------------------------ 5. Listen Together --

create table if not exists rooms (
  code        text primary key,                          -- 6 chars, the join credential
  host_token  text not null,                             -- host secret, never returned twice
  host_name   text,
  current     jsonb,                                     -- the song playing
  queue       jsonb not null default '[]'::jsonb,        -- host's next songs (≤ 12)
  requests    jsonb not null default '[]'::jsonb,        -- guests' requests (≤ 20)
  position    double precision not null default 0,
  playing     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  messages    jsonb not null default '[]'::jsonb,        -- 15.0: a short chat (≤ 40 lines: {by, text, at})
  skip_votes  jsonb not null default '[]'::jsonb         -- 15.0: member ids voting to skip the current song
);
create index if not exists rooms_updated_idx on rooms (updated_at desc);
-- A database made before 15.0 gains the two columns in place.
alter table rooms add column if not exists messages jsonb not null default '[]'::jsonb;
alter table rooms add column if not exists skip_votes jsonb not null default '[]'::jsonb;

create table if not exists room_members (
  room_code    text not null references rooms (code) on delete cascade,
  member_id    text not null,
  name         text,
  last_seen    timestamptz not null default now(),
  reaction     text,
  reacted_at   timestamptz,
  primary key (room_code, member_id)
);
create index if not exists room_members_seen_idx on room_members (room_code, last_seen desc);

-- ------------------------------------------- 6. push devices, notifications --

-- Every device that can receive a push, on either channel.
--   web: `target` is the browser push endpoint, p256dh/auth are its keys
--   fcm: `target` is the Android registration token
create table if not exists push_devices (
  id              bigint generated always as identity primary key,
  channel         text not null,                          -- web | fcm
  target          text not null,
  p256dh          text,
  auth            text,
  platform        text,
  lang            text,
  country         text,
  region          text,
  city            text,
  tz_offset       integer,                                -- minutes east of UTC (quiet hours)
  active          boolean not null default true,
  last_pushed_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint push_devices_channel_shape check (channel in ('web', 'fcm')),
  constraint push_devices_web_keys check (channel <> 'web' or (p256dh is not null and auth is not null))
);
create unique index if not exists push_devices_target_key on push_devices (target);
create index if not exists push_devices_active_idx on push_devices (channel, active, updated_at desc);
create index if not exists push_devices_geo_idx on push_devices (country, region, city) where active;

-- Everything the owner (or a job) sent, with its delivery receipt.
create table if not exists notifications (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  kind          text not null default 'announcement',    -- announcement | song | system
  title         text not null,
  body          text not null,
  link          text not null default '/',
  audience      jsonb not null default '{}'::jsonb,      -- the filter used
  web_total     integer not null default 0,
  web_sent      integer not null default 0,
  web_gone      integer not null default 0,
  fcm_total     integer not null default 0,
  fcm_sent      integer not null default 0,
  failures      jsonb,                                   -- { "403": 2, "error": 1 }
  dedupe_key    text,
  sent_by       text not null default 'owner',
  retracted_at  timestamptz
);
create unique index if not exists notifications_dedupe_key on notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_at_idx on notifications (at desc);

-- --------------------------------------------- 7. settings, experiments --

-- Published settings: one key, one JSON value. Read by the public config
-- routes (cached), written only from the owner console.
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'owner'
);

create table if not exists settings_history (
  id          bigint generated always as identity primary key,
  key         text not null,
  value       jsonb,                                     -- null = the key was cleared
  at          timestamptz not null default now(),
  by          text not null default 'owner'
);
create index if not exists settings_history_key_idx on settings_history (key, at desc);

create table if not exists experiments (
  key         text primary key,
  name        text,
  variants    jsonb not null default '[]'::jsonb,        -- [{ name, pct }]
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint experiments_key_shape check (key ~ '^[a-z0-9-]{1,40}$')
);

-- ------------------------------------------- 8. audit, uptime, job runs --

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null default 'owner',
  action      text not null,
  target      text,
  summary     text not null,
  before      jsonb,
  after       jsonb,
  request_id  text
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_action_idx on audit_log (action, at desc);

create table if not exists uptime_days (
  component  text not null,
  day        date not null,
  up         integer not null default 0,
  total      integer not null default 0,
  primary key (component, day)
);

create table if not exists uptime_latest (
  component   text primary key,
  ok          boolean not null,
  latency_ms  integer,
  checked_at  timestamptz not null default now()
);

create table if not exists job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  summary      jsonb
);
create index if not exists job_runs_job_idx on job_runs (job, started_at desc);

-- ------------------------------------------- 8b. the console (version 10) --

-- Who may open the owner console. Admins sign in with Google; only an email
-- on this list gets in. owner: everything (database upkeep, admins);
-- editor: App Settings, notifications, feedback, blocking, A/B tests;
-- viewer: reads everything, changes nothing. The Worker checks the role on
-- every write. The owner password (ADMIN_LOGIN_PASSWORD) stays as an owner
-- recovery key so a fresh console can invite its first admin.
create table if not exists admins (
  email         text primary key,
  name          text,
  picture       text,
  role          text not null default 'viewer',
  invited_by    text,
  created_at    timestamptz not null default now(),
  last_sign_in  timestamptz,
  constraint admins_role_shape check (role in ('owner', 'editor', 'viewer')),
  constraint admins_email_shape check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
comment on table admins is 'Console admins (Google email → role). Only these emails can sign in to the console.';

-- What the owner decided about one kind of app error (grouped by a
-- fingerprint of its kind and normalised message): new | investigating | fixed | ignored.
create table if not exists error_status (
  fingerprint  text primary key,
  status       text not null default 'new',
  note         text,
  updated_at   timestamptz not null default now(),
  updated_by   text,
  constraint error_status_shape check (status in ('new', 'investigating', 'fixed', 'ignored'))
);

-- A device that can receive pushes belongs to the Google account signed in
-- on it (set when the device registers with a session). The console only
-- sends to signed-in people.
alter table push_devices add column if not exists account_id text references accounts (id) on delete set null;
create index if not exists push_devices_account_idx on push_devices (account_id) where account_id is not null;

-- Notifications can be drafts or scheduled for later; a scheduled one is
-- sent by the cron job when its time comes. `opened` counts taps.
alter table notifications add column if not exists status text not null default 'sent';         -- draft | scheduled | sending | sent | cancelled
alter table notifications add column if not exists scheduled_for timestamptz;
alter table notifications add column if not exists image text;
alter table notifications add column if not exists opened integer not null default 0;
alter table notifications add column if not exists created_by text;
create index if not exists notifications_due_idx on notifications (scheduled_for) where status = 'scheduled';

-- Who blocked a song, album, artist or keyword.
alter table blocked_content add column if not exists blocked_by text;
alter table blocked_content drop constraint if exists blocked_content_kind_shape;
alter table blocked_content add constraint blocked_content_kind_shape check (kind in ('song', 'album', 'artist', 'keyword'));

-- A/B tests: a description, a lifecycle, who is included, and the winner.
alter table experiments add column if not exists description text;
alter table experiments add column if not exists status text not null default 'draft';           -- draft | running | paused | finished
alter table experiments add column if not exists audience jsonb not null default '{}'::jsonb;    -- { platform, minVersion, percent }
alter table experiments add column if not exists started_at timestamptz;
alter table experiments add column if not exists ended_at timestamptz;
alter table experiments add column if not exists winner text;

-- The owner can block a signed-in user (they cannot sign in again) and sign
-- one device out (its session stops working on that device).
alter table accounts add column if not exists blocked_at timestamptz;
alter table listeners add column if not exists signed_out_at timestamptz;

-- The public Storage bucket for pictures the owner uploads in the console
-- (banners, notification images). Public on purpose: the app shows them.
-- Supabase only; a plain Postgres has no storage schema.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('console-media', 'console-media', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
      on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- --------------------------------------- 8c. owner notes and tags (v15) --
-- The console's private note and tags about one signed-in person (tester,
-- friend, VIP, or the owner's own words). Never shown in the app; deleting
-- the account deletes its row.
create table if not exists owner_notes (
  account_id  text primary key references accounts (id) on delete cascade,
  tags        text[] not null default '{}',
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  constraint owner_notes_tags_shape check (cardinality(tags) <= 12),
  constraint owner_notes_note_len check (note is null or char_length(note) <= 2000)
);
create index if not exists owner_notes_tags_idx on owner_notes using gin (tags);
comment on table owner_notes is 'Console-only notes and tags about a signed-in person. Cascades with the account.';

-- --------------------------------------------- 9. VinaX AI conversations --

-- One chat with VinaX AI. Deleting a chat hides it at once (deleted_at); the
-- hourly housekeeping removes it, with its messages, a day later. Deleting
-- the account removes every chat. active_leaf_id is the message the listener
-- last viewed, so a reload opens that branch.
create table if not exists ai_conversations (
  id              uuid primary key,
  account_id      text not null references accounts (id) on delete cascade,
  title           text,
  starred         boolean not null default false,
  model_pref      text,
  active_leaf_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists ai_conversations_account_idx on ai_conversations (account_id, updated_at desc);
create index if not exists ai_conversations_deleted_idx on ai_conversations (deleted_at) where deleted_at is not null;

-- The messages form a tree: an edit or a retry adds a sibling under the same
-- parent, so earlier versions stay. content is the message parts
-- ([{ type: 'text', text } | { type: 'attachment', id }]).
create table if not exists ai_messages (
  id               uuid primary key,
  conversation_id  uuid not null references ai_conversations (id) on delete cascade,
  parent_id        uuid references ai_messages (id) on delete cascade,
  role             text not null,
  content          jsonb not null,
  thinking         text,
  thinking_ms      integer,
  sources          jsonb,
  artifacts        jsonb,
  model_id         text,
  provider         text,
  stop_reason      text,
  usage            jsonb,
  created_at       timestamptz not null default now(),
  constraint ai_messages_role_check check (role in ('user', 'assistant'))
);
create index if not exists ai_messages_conversation_idx on ai_messages (conversation_id, created_at);
create index if not exists ai_messages_parent_idx on ai_messages (parent_id) where parent_id is not null;

-- Files added to a chat. The bytes live in the private Storage bucket
-- ai-attachments at storage_path; the Worker serves them after an ownership
-- check. extracted_text is a PDF's text for models that cannot read PDFs.
create table if not exists ai_attachments (
  id               uuid primary key,
  account_id       text not null references accounts (id) on delete cascade,
  conversation_id  uuid references ai_conversations (id) on delete cascade,
  name             text not null,
  mime             text not null,
  size             integer not null,
  storage_path     text not null,
  extracted_text   text,
  pages            integer,
  created_at       timestamptz not null default now()
);
create index if not exists ai_attachments_account_idx on ai_attachments (account_id, created_at desc);
create index if not exists ai_attachments_conversation_idx on ai_attachments (conversation_id);

-- Version 6: what kind of file it is, and the Gemini Files API copy of a PDF
-- (Google keeps it 48 hours; the Worker re-uploads after that).
alter table ai_attachments add column if not exists kind text check (kind in ('image', 'pdf', 'text'));
alter table ai_attachments add column if not exists gemini_uri text;
alter table ai_attachments add column if not exists gemini_expires_at timestamptz;
create index if not exists ai_attachments_loose_idx on ai_attachments (created_at) where conversation_id is null;

-- The private Storage bucket the files live in (Supabase only; a plain
-- Postgres, such as the Schema workflow's, has no storage schema). Private:
-- the Worker reads it with the service-role key, nobody else can.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('ai-attachments', 'ai-attachments', false, 52428800,
              array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- Search one account's chats by title and message text, newest first.
-- p_query is plain text: the LIKE wildcards in it are escaped here.
create or replace function ai_conversation_search(p_account text, p_query text, p_before timestamptz default null, p_limit integer default 30)
returns setof ai_conversations
language sql stable set search_path = public, pg_temp as $$
  with pat as (
    select '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select c.*
  from ai_conversations c, pat
  where c.account_id = p_account
    and c.deleted_at is null
    and (p_before is null or c.updated_at < p_before)
    and (c.title ilike pat.p
         or exists (
           select 1
           from ai_messages m,
                jsonb_array_elements(case when jsonb_typeof(m.content) = 'array' then m.content else '[]'::jsonb end) e
           where m.conversation_id = c.id and e ->> 'text' ilike pat.p))
  order by c.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- The artifacts gallery (GET /api/ai/artifacts): one row per artifact id per
-- chat, from the newest reply that has it, with how many versions the chat
-- holds. Metadata only, never the content. Deleted chats are left out.
-- p_kind is an artifact type or null; p_query matches titles (the LIKE
-- wildcards in it are escaped here). Paging is by (created_at, key), newest
-- first, where key is '<conversation id>/<artifact id>'.
create or replace function ai_artifact_list(p_account text, p_kind text default null, p_query text default null,
                                            p_before timestamptz default null, p_before_key text default null, p_limit integer default 30)
returns table (conversation_id uuid, conversation_title text, artifact_id text, message_id uuid, kind text, title text,
               language text, incomplete boolean, versions integer, created_at timestamptz, key text)
language sql stable set search_path = public, pg_temp as $$
  with pat as (
    select '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  ),
  found as (
    select m.conversation_id as cid, c.title as ctitle, m.id as mid, m.created_at as at, e.value as a, e.ord
    from ai_conversations c
    join ai_messages m on m.conversation_id = c.id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(m.artifacts) = 'array' then m.artifacts else '[]'::jsonb end) with ordinality e(value, ord)
    where c.account_id = p_account and c.deleted_at is null and m.artifacts is not null
  ),
  latest as (
    select distinct on (f.cid, f.a ->> 'id')
      f.cid, f.ctitle, f.a ->> 'id' as aid, f.mid, f.a ->> 'type' as akind, f.a ->> 'title' as atitle, f.a ->> 'language' as alang,
      coalesce((f.a ->> 'incomplete')::boolean, false) as aincomplete,
      (count(*) over (partition by f.cid, f.a ->> 'id'))::integer as n, f.at,
      f.cid::text || '/' || (f.a ->> 'id') as k
    from found f
    where coalesce(f.a ->> 'id', '') <> ''
    order by f.cid, f.a ->> 'id', f.at desc, f.ord desc
  )
  select l.cid, l.ctitle, l.aid, l.mid, l.akind, l.atitle, l.alang, l.aincomplete, l.n, l.at, l.k
  from latest l, pat
  where (p_kind is null or l.akind = p_kind)
    and (coalesce(p_query, '') = '' or l.atitle ilike pat.p)
    and (p_before is null or (l.at, l.k) < (p_before, coalesce(p_before_key, '')))
  order by l.at desc, l.k desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- Global daily allowances for VinaX AI's paid or capped calls: 'search' (the
-- search API, SEARCH_DAILY_LIMIT) and 'grounding' (Google Search grounding,
-- kept under the free tier). One row per UTC day and kind.
create table if not exists ai_daily_usage (
  day    date not null,
  kind   text not null,
  count  integer not null default 0,
  primary key (day, kind)
);

-- Take one from today's allowance of `kind`: true when taken, false when
-- today's `p_limit` is already used (or the limit is 0). Atomic, so every
-- Worker isolate shares one count.
create or replace function ai_take_daily(p_kind text, p_limit integer)
returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_limit is null or p_limit <= 0 then
    return false;
  end if;
  insert into ai_daily_usage as u (day, kind, count)
    values ((now() at time zone 'utc')::date, p_kind, 1)
    on conflict (day, kind) do update set count = u.count + 1 where u.count < p_limit
    returning u.count into n;
  return n is not null;
end
$$;

-- Version 8: a shared VinaX AI chat. A snapshot of one chat's active branch,
-- taken when its owner made the link or last updated it: the text of each
-- turn (artifacts are inside it), files as names only (never their contents),
-- the web sources; no reasoning. Anyone with the id (128 random bits) can read
-- it through the Worker. One link per chat; stopping sharing deletes the row,
-- and so does deleting the chat (the Worker at once, the purge's cascade
-- too) or the account.
create table if not exists ai_shares (
  id               text primary key,
  account_id       text not null references accounts (id) on delete cascade,
  conversation_id  uuid not null references ai_conversations (id) on delete cascade,
  title            text not null,
  messages         jsonb not null,
  message_count    integer not null,
  bytes            integer not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_shares_id_shape check (id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint ai_shares_title_len check (char_length(title) between 1 and 120),
  constraint ai_shares_messages_shape check (jsonb_typeof(messages) = 'array'),
  constraint ai_shares_size check (bytes between 0 and 1000000)
);
create unique index if not exists ai_shares_conversation_key on ai_shares (conversation_id);
create index if not exists ai_shares_account_idx on ai_shares (account_id, updated_at desc);

-- Version 9: VinaX AI projects. A named workspace with instructions every chat
-- in it follows and files (project knowledge) every chat in it can read. A
-- knowledge file is an ai_attachments row with project_id set and no
-- conversation. Deleting a project removes its files (the Worker removes the
-- stored bytes first); its chats either go with it (the Worker hides them, the
-- hourly purge removes them) or stay as ordinary chats (project_id set null).
-- Deleting the account removes every project.
create table if not exists ai_projects (
  id            uuid primary key,
  account_id    text not null references accounts (id) on delete cascade,
  name          text not null,
  description   text,
  instructions  text,
  starred       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ai_projects_name_len check (char_length(name) between 1 and 60),
  constraint ai_projects_description_len check (description is null or char_length(description) <= 300),
  constraint ai_projects_instructions_len check (instructions is null or char_length(instructions) <= 8000)
);
create index if not exists ai_projects_account_idx on ai_projects (account_id, updated_at desc);
alter table ai_conversations add column if not exists project_id uuid references ai_projects (id) on delete set null;
create index if not exists ai_conversations_project_idx on ai_conversations (project_id, updated_at desc) where project_id is not null;
alter table ai_attachments add column if not exists project_id uuid references ai_projects (id) on delete cascade;
create index if not exists ai_attachments_project_idx on ai_attachments (project_id, created_at) where project_id is not null;

-- One account's chats with every message (all branches), newest chat first,
-- and its projects (instructions, and knowledge files by name): the file
-- GET /api/ai/export hands the listener. Deleted chats are left out. Defined
-- after ai_projects, which it reads.
create or replace function ai_export(p_account text)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'format', 'vinax-ai-chats',
    'version', 1,
    'exportedAt', now(),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'starred', c.starred, 'projectId', c.project_id,
        'createdAt', c.created_at, 'updatedAt', c.updated_at, 'activeLeafId', c.active_leaf_id,
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'parentId', m.parent_id, 'role', m.role, 'content', m.content, 'thinking', m.thinking,
            'model', m.model_id, 'stopReason', m.stop_reason, 'createdAt', m.created_at) order by m.created_at)
          from ai_messages m where m.conversation_id = c.id), '[]'::jsonb)
      ) order by c.updated_at desc)
      from ai_conversations c
      where c.account_id = p_account and c.deleted_at is null), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'instructions', p.instructions, 'starred', p.starred,
        'createdAt', p.created_at, 'updatedAt', p.updated_at,
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('name', a.name, 'kind', a.kind, 'size', a.size) order by a.created_at)
          from ai_attachments a where a.project_id = p.id), '[]'::jsonb)
      ) order by p.updated_at desc)
      from ai_projects p
      where p.account_id = p_account), '[]'::jsonb));
$$;

-- Version 9: VinaX AI memory. Short notes about the listener (at most 50 of
-- at most 200 characters, enforced by the Worker), learned from their chats
-- or added by them in VinaX AI's settings, and put into the system prompt of
-- each new reply. One row per note, so each can be deleted on its own and
-- learning only inserts and deletes rows (no read-modify-write of a list).
-- A note keeps the chat it came from until that chat is purged. The
-- listener's two switches live in ai_memory_prefs (no row = both on); an
-- incognito chat never reads or writes memory. Everything goes with the
-- account.
create table if not exists ai_memories (
  id               uuid primary key,
  account_id       text not null references accounts (id) on delete cascade,
  text             text not null,
  origin           text not null default 'chat',
  conversation_id  uuid references ai_conversations (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_memories_text_len check (char_length(text) between 1 and 200),
  constraint ai_memories_origin check (origin in ('chat', 'user'))
);
create index if not exists ai_memories_account_idx on ai_memories (account_id, created_at);
create index if not exists ai_memories_conversation_idx on ai_memories (conversation_id) where conversation_id is not null;

create table if not exists ai_memory_prefs (
  account_id  text primary key references accounts (id) on delete cascade,
  use_memory  boolean not null default true,
  learn       boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table ai_conversations add column if not exists incognito boolean not null default false;

-- ------------------------------------------------- 9b. the personal engine --

-- Version 7: the account-side recommendation engine (docs/personalisation.md).
-- One taste model per signed-in account, learned from the events the device
-- reports while the listener keeps the engine on; a pool of every song any
-- listener touched, with its embedding; what each account was shown; and the
-- pages the composer built. Deleting the account removes all of it.
--
-- Embeddings need the vector extension. Hosted projects ship it; a plain
-- Postgres needs the package (the Schema workflow's image carries it).
create extension if not exists vector with schema extensions;

-- Every song the engine has met, whoever met it. Written from events and from
-- catalogue lookups the engine makes; never read from the catalogue at page
-- time, so a page answers from here alone. `embedding` is null until the
-- embed step ran; `embed_model` names the space it lives in, and a page only
-- compares vectors of one model.
create table if not exists personal_songs (
  id           text primary key,
  title        text not null,
  artist       text not null,                          -- primary artist's name
  artist_id    text,
  artists      jsonb not null default '[]'::jsonb,     -- [{id, name}]
  album        text,
  album_id     text,
  language     text,
  year         integer,
  duration     integer,                                -- seconds
  image        text,
  key          text not null,                          -- identity family (identityCore canonicalKey)
  facets       jsonb not null default '{}'::jsonb,     -- {mood, genre, vibe, energy, tempo} when known
  embedding    extensions.vector(1024),
  embed_model  text,
  embedded_at  timestamptz,
  plays        bigint not null default 0,              -- community counters, all accounts
  completes    bigint not null default 0,
  skips        bigint not null default 0,
  likes        bigint not null default 0,
  -- A row a device asserted is unverified until the catalogue confirmed it (the engine's
  -- own lookups write verified rows). Only verified rows reach other listeners' pages.
  verified     boolean not null default false,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  constraint personal_songs_artists_check check (jsonb_typeof(artists) = 'array'),
  constraint personal_songs_facets_check check (jsonb_typeof(facets) = 'object')
);
-- A database that took an earlier draft of version 7 gains the column in place.
alter table personal_songs add column if not exists verified boolean not null default false;
create index if not exists personal_songs_embedding_idx on personal_songs using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists personal_songs_backlog_idx on personal_songs (first_seen) where embedding is null;
create index if not exists personal_songs_unverified_idx on personal_songs (first_seen) where not verified;
create index if not exists personal_songs_language_idx on personal_songs (language, last_seen desc);
create index if not exists personal_songs_artist_idx on personal_songs (artist_id) where artist_id is not null;
create index if not exists personal_songs_key_idx on personal_songs (key);

-- What a signed-in listener did, one row per event, written by
-- POST /api/personal/events. `client_id` is the device's own id for the
-- event: a retried batch inserts nothing twice. `context` is small and flat
-- ({hour, dow, tz, shelf, position}).
create table if not exists personal_events (
  id           bigint generated always as identity primary key,
  account_id   text not null references accounts (id) on delete cascade,
  at           timestamptz not null default now(),
  kind         text not null,
  song_id      text not null,
  heard_sec    integer,
  duration_sec integer,
  source       text,
  context      jsonb not null default '{}'::jsonb,
  client_id    text,
  constraint personal_events_kind_check check (kind in ('play', 'complete', 'skip', 'like', 'unlike', 'dislike', 'save', 'queue', 'search_play', 'shown', 'radio_start')),
  constraint personal_events_context_check check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 1024)
);
create unique index if not exists personal_events_client_key on personal_events (account_id, client_id) where client_id is not null;
create index if not exists personal_events_account_idx on personal_events (account_id, at desc);
create index if not exists personal_events_song_idx on personal_events (song_id, at desc) where kind = 'play';
create index if not exists personal_events_kind_at_idx on personal_events (kind, at desc);
create index if not exists personal_events_at_idx on personal_events (at);

-- The taste model: one row per account, folded by the Worker from events
-- (the JSON maps) and recomputed here (the vector). `version` rises with
-- every fold, so two Workers folding at once cannot lose a batch.
create table if not exists personal_taste (
  account_id   text primary key references accounts (id) on delete cascade,
  vector       extensions.vector(1024),
  embed_model  text,
  artists      jsonb not null default '{}'::jsonb,
  languages    jsonb not null default '{}'::jsonb,
  facets       jsonb not null default '{}'::jsonb,
  hours        jsonb not null default '{}'::jsonb,
  songs        jsonb not null default '{}'::jsonb,
  summary      jsonb not null default '{}'::jsonb,
  mode         text not null default 'balanced',        -- familiar | balanced | discover
  events_seen  bigint not null default 0,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint personal_taste_mode_check check (mode in ('familiar', 'balanced', 'discover')),
  constraint personal_taste_json_check check (
    jsonb_typeof(artists) = 'object' and jsonb_typeof(languages) = 'object' and jsonb_typeof(facets) = 'object'
    and jsonb_typeof(hours) = 'object' and jsonb_typeof(songs) = 'object' and jsonb_typeof(summary) = 'object')
);

-- What each account has been shown, queued, played and skipped, so the server
-- does not repeat the device and the device does not repeat the server.
create table if not exists personal_exposure (
  account_id     text not null references accounts (id) on delete cascade,
  song_id        text not null,
  shown          integer not null default 0,
  queued         integer not null default 0,
  played         integer not null default 0,
  completed      integer not null default 0,
  skipped        integer not null default 0,
  liked          boolean not null default false,
  disliked       boolean not null default false,
  last_shown     timestamptz,
  last_queued    timestamptz,
  last_played    timestamptz,
  last_completed timestamptz,
  last_skipped   timestamptz,
  last_disliked  timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (account_id, song_id)
);
alter table personal_exposure add column if not exists last_disliked timestamptz;
create index if not exists personal_exposure_recent_idx on personal_exposure (account_id, updated_at desc);

-- Pages the engine composed: a Home (served from here for its lifetime), a
-- playlist a listener asked for, a radio pool. `page` is the whole answer,
-- with the song records, so showing it again needs no other read.
create table if not exists personal_pages (
  id          uuid primary key,
  account_id  text not null references accounts (id) on delete cascade,
  kind        text not null,
  prompt      text,
  page        jsonb not null,
  taste_version integer,
  events_seen integer,                                  -- the model's event count when the page was built (staleness)
  model_id    text,
  composed    boolean not null default false,          -- the language model shaped it (false = deterministic fallback)
  built_ms    integer,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  constraint personal_pages_kind_check check (kind in ('home', 'playlist', 'radio')),
  constraint personal_pages_page_check check (jsonb_typeof(page) = 'object')
);
alter table personal_pages add column if not exists events_seen integer;
create index if not exists personal_pages_account_idx on personal_pages (account_id, kind, created_at desc);
create index if not exists personal_pages_expires_idx on personal_pages (expires_at) where expires_at is not null;

-- Co-listening: for each song, the songs the same listeners play within the
-- same stretch, rebuilt by the hourly job from the last 30 days of personal
-- and anonymous play events (top 50 partners per song).
create table if not exists personal_colisten (
  song_id     text not null,
  other_id    text not null,
  weight      real not null,
  updated_at  timestamptz not null default now(),
  primary key (song_id, other_id)
);

-- Record a batch of events for one account: insert what is new (a repeated
-- client_id is skipped), update the exposure rows and the community counters.
-- Returns the client ids that were new, so the caller folds only those.
create or replace function personal_record_events(p_account text, p_events jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_new text[] := '{}';
  e jsonb; v_kind text; v_song text; v_at timestamptz; v_client text; n integer;
begin
  if p_account is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('inserted', '[]'::jsonb);
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    v_kind := e ->> 'kind'; v_song := e ->> 'songId'; v_client := e ->> 'id';
    v_at := coalesce((e ->> 'at')::timestamptz, now());
    if v_kind is null or v_song is null then continue; end if;
    insert into personal_events (account_id, at, kind, song_id, heard_sec, duration_sec, source, context, client_id)
      values (p_account, v_at, v_kind, v_song, (e ->> 'heardSec')::integer, (e ->> 'durationSec')::integer,
              e ->> 'source', coalesce(e -> 'context', '{}'::jsonb), v_client)
      on conflict (account_id, client_id) where client_id is not null do nothing;
    get diagnostics n = row_count;
    if n = 0 then continue; end if;
    v_new := v_new || coalesce(v_client, '');

    insert into personal_exposure as x (account_id, song_id, shown, queued, played, completed, skipped, liked, disliked,
                                        last_shown, last_queued, last_played, last_completed, last_skipped, last_disliked, updated_at)
      values (p_account, v_song,
              case when v_kind = 'shown' then 1 else 0 end,
              case when v_kind = 'queue' then 1 else 0 end,
              case when v_kind in ('play', 'search_play', 'radio_start') then 1 else 0 end,
              case when v_kind = 'complete' then 1 else 0 end,
              case when v_kind = 'skip' then 1 else 0 end,
              v_kind = 'like', v_kind = 'dislike',
              case when v_kind = 'shown' then v_at end,
              case when v_kind = 'queue' then v_at end,
              case when v_kind in ('play', 'search_play', 'radio_start') then v_at end,
              case when v_kind = 'complete' then v_at end,
              case when v_kind = 'skip' then v_at end,
              case when v_kind = 'dislike' then v_at end,
              now())
      on conflict (account_id, song_id) do update set
        shown = x.shown + excluded.shown, queued = x.queued + excluded.queued, played = x.played + excluded.played,
        completed = x.completed + excluded.completed,
        -- a play or a completion forgives earlier skips, as the device's ledger does
        skipped = case when v_kind in ('play', 'search_play', 'radio_start', 'complete') then 0 else x.skipped + excluded.skipped end,
        liked = case when v_kind = 'like' then true when v_kind in ('unlike', 'dislike') then false else x.liked end,
        disliked = case when v_kind = 'dislike' then true when v_kind = 'like' then false else x.disliked end,
        last_shown = greatest(x.last_shown, excluded.last_shown), last_queued = greatest(x.last_queued, excluded.last_queued),
        last_played = greatest(x.last_played, excluded.last_played), last_completed = greatest(x.last_completed, excluded.last_completed),
        last_skipped = greatest(x.last_skipped, excluded.last_skipped), last_disliked = greatest(x.last_disliked, excluded.last_disliked),
        updated_at = now();

    update personal_songs set
        plays = plays + case when v_kind in ('play', 'search_play', 'radio_start') then 1 else 0 end,
        completes = completes + case when v_kind = 'complete' then 1 else 0 end,
        skips = skips + case when v_kind = 'skip' then 1 else 0 end,
        likes = greatest(0, likes + case when v_kind = 'like' then 1 when v_kind = 'unlike' then -1 else 0 end),
        last_seen = greatest(last_seen, v_at)
      where id = v_song;
  end loop;
  return jsonb_build_object('inserted', to_jsonb(v_new));
end;
$$;

-- Songs the engine met, written safely: p_rows is an array of song facts
-- (the device's shape). A new row is inserted (verified when p_verified: the
-- facts came from the catalogue, not a device). An existing row only gains
-- what it lacked and a newer last_seen — a device can never rewrite another
-- listener's title, artist or artwork — unless the facts are verified, which
-- replace a device's version. Returns how many rows were new.
create or replace function personal_touch_songs(p_rows jsonb, p_verified boolean default false) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  with src as (
    select r ->> 'id' as id, r ->> 'title' as title, r ->> 'artist' as artist, r ->> 'artistId' as artist_id,
           coalesce(r -> 'artists', '[]'::jsonb) as artists, r ->> 'album' as album, r ->> 'albumId' as album_id,
           r ->> 'language' as language, (r ->> 'year')::integer as year, (r ->> 'duration')::integer as duration,
           r ->> 'image' as image, r ->> 'key' as key, coalesce(r -> 'facets', '{}'::jsonb) as facets
    from jsonb_array_elements(p_rows) r
    where (r ->> 'id') is not null and (r ->> 'title') is not null and (r ->> 'artist') is not null and (r ->> 'key') is not null
  ), ins as (
    insert into personal_songs as s (id, title, artist, artist_id, artists, album, album_id, language, year, duration, image, key, facets, verified, last_seen)
      select id, title, artist, artist_id, artists, album, album_id, language, year, duration, image, key, facets, p_verified, now() from src
      on conflict (id) do update set
        title = case when p_verified then excluded.title else s.title end,
        artist = case when p_verified then excluded.artist else s.artist end,
        artist_id = case when p_verified then coalesce(excluded.artist_id, s.artist_id) else coalesce(s.artist_id, excluded.artist_id) end,
        artists = case when p_verified or jsonb_array_length(s.artists) = 0 then excluded.artists else s.artists end,
        album = case when p_verified then coalesce(excluded.album, s.album) else coalesce(s.album, excluded.album) end,
        album_id = case when p_verified then coalesce(excluded.album_id, s.album_id) else coalesce(s.album_id, excluded.album_id) end,
        language = case when p_verified then coalesce(excluded.language, s.language) else coalesce(s.language, excluded.language) end,
        year = case when p_verified then coalesce(excluded.year, s.year) else coalesce(s.year, excluded.year) end,
        duration = case when p_verified then coalesce(excluded.duration, s.duration) else coalesce(s.duration, excluded.duration) end,
        image = case when p_verified then coalesce(excluded.image, s.image) else coalesce(s.image, excluded.image) end,
        key = case when p_verified then excluded.key else s.key end,
        facets = s.facets || excluded.facets,
        verified = s.verified or p_verified,
        last_seen = greatest(s.last_seen, now())
      returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n from ins;
  return coalesce(n, 0);
end;
$$;

-- Unverified rows the catalogue should confirm, oldest first (the job's work list).
create or replace function personal_unverified(p_limit integer default 40)
returns setof personal_songs
language sql stable set search_path = public, pg_temp as $$
  select * from personal_songs where not verified order by first_seen limit greatest(1, least(coalesce(p_limit, 40), 500));
$$;

-- One account's exposure for a set of songs (the pool), instead of its whole ledger.
create or replace function personal_exposure_for(p_account text, p_songs text[])
returns setof personal_exposure
language sql stable set search_path = public, pg_temp as $$
  select * from personal_exposure where account_id = p_account and song_id = any (p_songs);
$$;

-- Recompute one account's taste vector from its song scores: the score-
-- weighted sum of the embeddings of its p_top strongest songs that are
-- embedded in p_model's space. Returns how many songs went in (0 leaves the
-- vector as it was, so a brand-new account keeps null until something is
-- embedded).
create or replace function personal_recompute_vector(p_account text, p_model text, p_top integer default 150) returns integer
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_arr real[]; n integer;
begin
  with w as (
    select s.key as song_id, (s.value ->> 'score')::real as score
    from personal_taste t, jsonb_each(t.songs) s
    where t.account_id = p_account and (s.value ->> 'score') is not null
    order by abs((s.value ->> 'score')::real) desc
    limit greatest(1, least(coalesce(p_top, 150), 500))
  ), r as (
    select ps.embedding, w.score
    from w join personal_songs ps on ps.id = w.song_id
    where ps.embedding is not null and ps.embed_model = p_model
  ), acc as (
    select u.i, sum(u.e * r.score)::real as v
    from r, unnest(r.embedding::real[]) with ordinality as u(e, i)
    group by u.i
  ), norm as (
    select sqrt(sum(v * v)) as nrm from acc
  )
  select (select array_agg((v / nrm)::real order by i) from acc, norm where nrm > 0), (select count(*) from r) into v_arr, n;
  if n > 0 and v_arr is not null then
    update personal_taste set vector = v_arr::extensions.vector, embed_model = p_model where account_id = p_account;
  end if;
  return coalesce(n, 0);
end;
$$;

-- The songs nearest to an account's taste vector, among verified songs,
-- leaving out what the account was shown, queued, played or skipped within
-- that kind's cooling window (the device's: shown 12 h, queued 2 d, played
-- and completed 3 d, skipped 14 d; disliked never comes back) and, when
-- asked, anything outside p_languages. p_cooling = false lifts the windows.
-- The index scan is widened (ef_search, iterative scan) so the filters do
-- not starve the answer. (id, similarity 0..1, language, artist_id).
create or replace function personal_neighbours(p_account text, p_model text, p_limit integer default 120,
                                               p_languages text[] default null, p_cooling boolean default true)
returns table (id text, similarity real, language text, artist_id text)
language sql stable
set search_path = public, extensions, pg_temp
set hnsw.ef_search = 400
set hnsw.iterative_scan = relaxed_order
as $$
  with near as (
    select s.id, s.language, s.artist_id,
           (1 - (s.embedding <=> (select t.vector from personal_taste t where t.account_id = p_account and t.embed_model = p_model)))::real as similarity
    from personal_songs s
    where s.embedding is not null and s.embed_model = p_model and s.verified
      and (p_languages is null or s.language = any (p_languages))
      and exists (select 1 from personal_taste t where t.account_id = p_account and t.embed_model = p_model and t.vector is not null)
      and not exists (
        select 1 from personal_exposure x
        where x.account_id = p_account and x.song_id = s.id
          and (x.disliked or (p_cooling and (
                 x.last_shown > now() - interval '12 hours' or x.last_queued > now() - interval '2 days'
              or x.last_played > now() - interval '3 days' or x.last_completed > now() - interval '3 days'
              or x.last_skipped > now() - interval '14 days'))))
    order by s.embedding <=> (select t.vector from personal_taste t where t.account_id = p_account and t.embed_model = p_model)
    limit greatest(1, least(coalesce(p_limit, 120), 500))
  )
  select n.id, n.similarity, n.language, n.artist_id from near n order by n.similarity desc;
$$;

-- The songs nearest to one song's embedding (the song itself left out).
create or replace function personal_similar_songs(p_song text, p_model text, p_limit integer default 40)
returns table (id text, similarity real)
language sql stable set search_path = public, extensions, pg_temp set hnsw.ef_search = 200 as $$
  with seed as (select embedding from personal_songs where id = p_song and embedding is not null and embed_model = p_model)
  select s.id, (1 - (s.embedding <=> seed.embedding))::real as similarity
  from personal_songs s, seed
  where s.id <> p_song and s.embedding is not null and s.embed_model = p_model and s.verified
  order by s.embedding <=> seed.embedding
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

-- Co-listening partners of a set of songs, summed across the set.
create or replace function personal_colisten_for(p_songs text[], p_limit integer default 100)
returns table (id text, weight real)
language sql stable set search_path = public, pg_temp as $$
  select c.other_id as id, sum(c.weight)::real as weight
  from personal_colisten c
  where c.song_id = any (p_songs) and not (c.other_id = any (p_songs))
  group by c.other_id
  order by weight desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Rebuild personal_colisten from the last p_days of play events: a listener
-- (an account, or an anonymous device from `events`) who played two songs
-- within an hour of each other links them once; the top p_cap partners per
-- song are kept. A listener's last 150 plays bound the pairs, and a listener
-- with fewer than 3 plays in the window adds nothing. Runs once a day.
create or replace function personal_refresh_colisten(p_days integer default 30, p_cap integer default 50) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare n bigint; v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  create temp table _plays on commit drop as
    select * from (
      select 'a:' || account_id as who, song_id, at,
             row_number() over (partition by account_id order by at desc) as rn
      from personal_events where kind = 'play' and at >= v_since
      union all
      select 'd:' || listener_id, song_id, at,
             row_number() over (partition by listener_id order by at desc)
      from events where kind = 'play' and at >= v_since and listener_id is not null and song_id is not null
    ) p where rn <= 150;
  delete from _plays where who in (select who from _plays group by who having count(*) < 3);
  create index on _plays (who, at);
  create temp table _pairs on commit drop as
    select a.song_id, b.song_id as other_id, count(distinct a.who)::real as weight
    from _plays a join _plays b
      on a.who = b.who and a.song_id <> b.song_id
     and b.at between a.at - interval '1 hour' and a.at + interval '1 hour'
    group by a.song_id, b.song_id;
  delete from personal_colisten;
  insert into personal_colisten (song_id, other_id, weight, updated_at)
    select song_id, other_id, weight, now()
    from (select *, row_number() over (partition by song_id order by weight desc, other_id) as rk from _pairs) r
    where rk <= least(greatest(coalesce(p_cap, 50), 1), 200);
  get diagnostics n = row_count;
  return jsonb_build_object('pairs', n, 'since', v_since);
end;
$$;

-- What the community played most in the window, in the given languages (any
-- language when null), from personal and anonymous plays: LISTENERS who
-- played a song, not plays, so one account cannot push a song up. Verified
-- songs only. (id, plays = distinct listeners).
create or replace function personal_trending(p_languages text[] default null, p_days integer default 7, p_limit integer default 60)
returns table (id text, plays bigint)
language sql stable set search_path = public, pg_temp as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90)) as t),
  plays as (
    select song_id, 'a:' || account_id as who from personal_events, since where kind = 'play' and at >= since.t
    union
    select song_id, 'd:' || listener_id from events, since where kind = 'play' and at >= since.t and song_id is not null and listener_id is not null
  )
  select p.song_id as id, count(distinct p.who) as plays
  from plays p join personal_songs s on s.id = p.song_id and s.verified
  where p_languages is null or s.language = any (p_languages)
  group by p.song_id
  order by plays desc
  limit greatest(1, least(coalesce(p_limit, 60), 500));
$$;

-- The page served: every song on it counts as shown once, so the next page
-- (and the device) know. Returns how many rows moved.
create or replace function personal_mark_shown(p_account text, p_songs text[]) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_account is null or p_songs is null then return 0; end if;
  insert into personal_exposure as x (account_id, song_id, shown, last_shown, updated_at)
    select p_account, s, 1, now(), now() from unnest(p_songs) s
    on conflict (account_id, song_id) do update set shown = x.shown + 1, last_shown = now(), updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Write vectors for many songs in one call: p_rows is {"<song id>": "[…]"}.
-- Returns how many rows took one.
create or replace function personal_set_embeddings(p_model text, p_rows jsonb) returns integer
language plpgsql set search_path = public, extensions, pg_temp as $$
declare n integer;
begin
  if p_model is null or jsonb_typeof(p_rows) <> 'object' then return 0; end if;
  update personal_songs s
     set embedding = (r.value #>> '{}')::extensions.vector, embed_model = p_model, embedded_at = now()
    from jsonb_each(p_rows) r
   where s.id = r.key;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Verified songs with no embedding in p_model's space yet (none at all, or
-- one from an earlier model), oldest first: the backlog job's work list.
create or replace function personal_embed_backlog(p_limit integer default 200, p_model text default null)
returns setof personal_songs
language sql stable set search_path = public, pg_temp as $$
  select * from personal_songs
  where verified and (embedding is null or (p_model is not null and embed_model is distinct from p_model))
  order by first_seen limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- Everything the engine holds about one account, gone. Returns what went.
create or replace function personal_erase(p_account text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare n_events bigint; n_exposure bigint; n_pages bigint; n_taste bigint;
begin
  delete from personal_events where account_id = p_account; get diagnostics n_events = row_count;
  delete from personal_exposure where account_id = p_account; get diagnostics n_exposure = row_count;
  delete from personal_pages where account_id = p_account; get diagnostics n_pages = row_count;
  delete from personal_taste where account_id = p_account; get diagnostics n_taste = row_count;
  return jsonb_build_object('events', n_events, 'exposure', n_exposure, 'pages', n_pages, 'taste', n_taste);
end;
$$;

-- Housekeeping: events past p_keep_days and pages past their expiry.
create or replace function personal_purge(p_keep_days integer default 365) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare n_events bigint; n_pages bigint;
begin
  delete from personal_events where at < now() - make_interval(days => least(greatest(coalesce(p_keep_days, 365), 30), 3650));
  get diagnostics n_events = row_count;
  delete from personal_pages where expires_at is not null and expires_at < now() - interval '1 day';
  get diagnostics n_pages = row_count;
  return jsonb_build_object('events', n_events, 'pages', n_pages);
end;
$$;

-- The console's Personal page in one call.
create or replace function personal_stats() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'accounts', (select count(*) from personal_taste),
    'accountsWithVector', (select count(*) from personal_taste where vector is not null),
    'eventsDay', (select count(*) from personal_events where at >= now() - interval '1 day'),
    'eventsWeek', (select count(*) from personal_events where at >= now() - interval '7 days'),
    'songs', (select count(*) from personal_songs),
    'songsEmbedded', (select count(*) from personal_songs where embedding is not null),
    'backlog', (select count(*) from personal_songs where verified and embedding is null),
    'unverified', (select count(*) from personal_songs where not verified),
    'models', coalesce((select jsonb_object_agg(embed_model, n) from (select embed_model, count(*) as n from personal_songs where embed_model is not null group by 1) m), '{}'::jsonb),
    'pagesDay', (select count(*) from personal_pages where created_at >= now() - interval '1 day'),
    'pagesComposedDay', (select count(*) from personal_pages where created_at >= now() - interval '1 day' and composed),
    'playlistsDay', (select count(*) from personal_pages where created_at >= now() - interval '1 day' and kind = 'playlist'),
    'colistenPairs', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.personal_colisten'::regclass),
    'colistenUpdatedAt', (select max(updated_at) from personal_colisten)
  );
$$;

-- ------------------------------------------------------------- 10. views --

-- Everyone the console lists, ONE ROW PER PERSON: a signed-in listener is one
-- row however many devices they use (the most recent device's platform,
-- place and what is playing, the earliest first-seen, the latest last-seen,
-- and how many devices); a device nobody signed in on is a row of its own.
-- V2 1.0.1 — it used to be one row per device, so a listener who signed in
-- on a new browser was listed twice ("Device only" + "Signed in").
-- (`devices` is a new LAST column, so the view is replaced in place; so are
-- version 13's `os` and `browser`.)
create or replace view directory as
  with dev as (
    select l.*, coalesce(l.account_id, (select a.id from accounts a where a.listener_id = l.id limit 1)) as acct
    from listeners l
  ),
  mine as (
    select d.*,
           row_number() over (partition by d.acct order by d.last_seen desc) as rn,
           count(*) over (partition by d.acct) as n,
           min(d.first_seen) over (partition by d.acct) as first_any,
           max(d.last_seen) over (partition by d.acct) as last_any
    from dev d
    where d.acct is not null
  )
  select d.id as listener_id, null::text as account_id, d.display_name as name, d.handle as handle,
         null::text as email, null::text as picture, d.platform as platform, d.app_version as app_version,
         d.country as country, d.region as region, d.city as city, d.now_playing as now_playing, d.is_playing as is_playing,
         d.first_seen as first_seen, d.last_seen as last_seen, 1::bigint as devices,
         d.os as os, d.browser as browser
  from dev d
  where d.acct is null
  union all
  select m.id, a.id, coalesce(a.name, m.display_name), m.handle, a.email, a.picture,
         m.platform, m.app_version, m.country, m.region, m.city, m.now_playing, m.is_playing,
         least(m.first_any, a.created_at), greatest(m.last_any, a.last_seen), m.n,
         m.os, m.browser
  from mine m
  join accounts a on a.id = m.acct
  where m.rn = 1
  union all
  select null, a.id, a.name, null, a.email, a.picture,
         coalesce(a.platform, 'web'), a.app_version,
         a.country, a.region, a.city,
         null, false, a.created_at, a.last_seen, 0::bigint,
         null::text, null::text
  from accounts a
  where not exists (select 1 from dev d where d.acct = a.id);

-- --------------------------------------------------------- 11. functions --

-- Everything below is `security invoker`: the Worker's service role runs it,
-- the public roles cannot execute it (see section 12).

-- Window helper: 1..365 days.
create or replace function _days(p int) returns int
language sql immutable as $$ select least(greatest(coalesce(p, 7), 1), 365) $$;

-- Version 10 — the console counts PEOPLE signed in with Google, never
-- anonymous devices. A device counts when it belongs to an account (its
-- account_id, or the account's latest device). Anonymous rows stay in the
-- database; they are only left out of these answers. App errors are the
-- exception: every report counts, because a bug is a bug.
create or replace function signed_devices() returns table (listener_id text, account_id text)
language sql stable set search_path = public, pg_temp as $$
  select l.id, coalesce(l.account_id, (select a.id from accounts a where a.listener_id = l.id order by a.last_seen desc limit 1))
  from listeners l
  where l.account_id is not null or exists (select 1 from accounts a where a.listener_id = l.id);
$$;

-- The calendar day in India, where the console's days start.
create or replace function _ist_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Dashboard tiles. Old key names (listeners, newListeners24h) are kept and
-- now mean signed-in users too.
create or replace function stats_overview() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.kind, e.at, s.account_id
    from events e join s on s.listener_id = e.listener_id
    where e.at > now() - interval '60 days'
  ),
  live as (
    select s.account_id, bool_or(l.is_playing) as playing
    from listeners l join s on s.listener_id = l.id
    where l.last_seen > now() - interval '90 seconds'
    group by 1
  ),
  today as (select (_ist_today()::timestamp at time zone 'Asia/Kolkata') as t0)
  select jsonb_build_object(
    'activeNow',         (select count(*) from live),
    'playingNow',        (select count(*) from live where playing),
    'users',             (select count(*) from accounts),
    'listeners',         (select count(*) from accounts),
    'accounts',          (select count(*) from accounts),
    'newListeners24h',   (select count(*) from accounts where created_at > now() - interval '24 hours'),
    'newAccounts7d',     (select count(*) from accounts where created_at > now() - interval '7 days'),
    'newAccountsPrev7d', (select count(*) from accounts where created_at <= now() - interval '7 days' and created_at > now() - interval '14 days'),
    'playsToday',        (select count(*) from ev, today where kind = 'play' and at >= today.t0),
    'playsYesterday',    (select count(*) from ev, today where kind = 'play' and at >= today.t0 - interval '1 day' and at < today.t0),
    'plays24h',          (select count(*) from ev where kind = 'play' and at > now() - interval '24 hours'),
    'plays7d',           (select count(*) from ev where kind = 'play' and at > now() - interval '7 days'),
    'playsPrev7d',       (select count(*) from ev where kind = 'play' and at <= now() - interval '7 days' and at > now() - interval '14 days'),
    'errors24h',         (select count(*) from events where kind = 'error' and at > now() - interval '24 hours'),
    'errorsPrev24h',     (select count(*) from events where kind = 'error' and at <= now() - interval '24 hours' and at > now() - interval '48 hours'),
    'dau',               (select count(distinct account_id) from ev where at > now() - interval '24 hours'),
    'dauPrev',           (select count(distinct account_id) from ev where at <= now() - interval '24 hours' and at > now() - interval '48 hours'),
    'wau',               (select count(distinct account_id) from ev where at > now() - interval '7 days'),
    'wauPrev',           (select count(distinct account_id) from ev where at <= now() - interval '7 days' and at > now() - interval '14 days'),
    'mau',               (select count(distinct account_id) from ev where at > now() - interval '30 days'),
    'mauPrev',           (select count(distinct account_id) from ev where at <= now() - interval '30 days' and at > now() - interval '60 days'),
    'feedbackNew',       (select count(*) from feedback where status = 'new'),
    'pushDevices',       (select count(*) from push_devices where active and account_id is not null),
    'pushPeople',        (select count(distinct account_id) from push_devices where active and account_id is not null),
    'roomsActive',       (select count(*) from rooms where updated_at > now() - interval '15 minutes')
  );
$$;

-- Daily series in India's calendar, every day present (zero-filled).
-- plays, searches and listeners (distinct people) come from signed-in users;
-- errors count every report; newListeners = Google accounts created that day.
create or replace function stats_timeline(p_days int default 14) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with bounds as (select _ist_today() - (_days(p_days) - 1) as d0),
  days as (
    select generate_series((select d0 from bounds), _ist_today(), '1 day')::date as day
  ),
  s as (select * from signed_devices()),
  ev as (
    select (e.at at time zone 'Asia/Kolkata')::date as day,
           count(*) filter (where e.kind = 'play')   as plays,
           count(*) filter (where e.kind = 'search') as searches,
           count(*) filter (where e.kind = 'heartbeat') as heartbeats,
           count(distinct s.account_id)              as listeners
    from events e join s on s.listener_id = e.listener_id
    where e.at >= ((select d0 from bounds)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ),
  err as (
    select (at at time zone 'Asia/Kolkata')::date as day, count(*) as errors
    from events
    where kind = 'error' and at >= ((select d0 from bounds)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  ),
  fresh as (
    select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) as new_users
    from accounts
    where created_at >= ((select d0 from bounds)::timestamp at time zone 'Asia/Kolkata')
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(d.day, 'YYYY-MM-DD'),
      'plays', coalesce(ev.plays, 0),
      'listeners', coalesce(ev.listeners, 0),
      'newListeners', coalesce(fresh.new_users, 0),
      'errors', coalesce(err.errors, 0),
      'searches', coalesce(ev.searches, 0),
      'heartbeats', coalesce(ev.heartbeats, 0)
    ) order by d.day), '[]'::jsonb)
  from days d
  left join ev on ev.day = d.day
  left join err on err.day = d.day
  left join fresh on fresh.day = d.day;
$$;

-- Top songs, artists and languages played by signed-in users, plus what is
-- rising against the previous window. `listeners` = distinct people.
create or replace function stats_music(p_days int default 7, p_limit int default 25) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.song_id, e.song_title, e.song_artist, e.song_image, e.language, s.account_id, e.at
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'play' and e.at > now() - make_interval(days => _days(p_days))
  ),
  prev as (
    select e.song_title, e.song_artist, count(*) as plays
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'play'
      and e.at <= now() - make_interval(days => _days(p_days))
      and e.at >  now() - make_interval(days => _days(p_days) * 2)
    group by 1, 2
  ),
  songs as (
    select song_id, song_title, song_artist, max(song_image) as image,
           count(*) as plays, count(distinct account_id) as listeners
    from ev where song_title is not null
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'songs', coalesce((select jsonb_agg(t) from (
        select s2.song_id as id, s2.song_title as title, s2.song_artist as artist, s2.image, s2.plays, s2.listeners,
               coalesce(p.plays, 0) as prev_plays
        from songs s2 left join prev p using (song_title, song_artist)
        order by s2.plays desc, s2.listeners desc limit least(p_limit, 200)) t), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(t) from (
        select song_artist as artist, count(*) as plays, count(distinct account_id) as listeners
        from ev where song_artist is not null group by 1 order by plays desc limit least(p_limit, 200)) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(language, ''), 'unknown') as language, count(*) as plays, count(distinct account_id) as listeners
        from ev group by 1 order by plays desc limit 40) t), '[]'::jsonb),
    'rising', coalesce((select jsonb_agg(t) from (
        select s2.song_id as id, s2.song_title as title, s2.song_artist as artist, s2.image, s2.plays, coalesce(p.plays, 0) as prev_plays
        from songs s2 left join prev p using (song_title, song_artist)
        where s2.plays > coalesce(p.plays, 0)
        order by (s2.plays - coalesce(p.plays, 0)) desc, s2.plays desc limit 25) t), '[]'::jsonb)
  );
$$;

-- Where signed-in users are (edge geo, never IPs): countries, states, cities.
create or replace function stats_geo(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.country, e.region, e.city, s.account_id, e.kind
    from events e join s on s.listener_id = e.listener_id
    where e.at > now() - make_interval(days => _days(p_days))
  )
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(t) from (
        select coalesce(country, 'XX') as country, count(distinct account_id) as listeners,
               count(*) filter (where kind = 'play') as plays
        from ev group by 1 order by listeners desc, plays desc limit 60) t), '[]'::jsonb),
    'regions', coalesce((select jsonb_agg(t) from (
        select coalesce(country, 'XX') as country, coalesce(region, 'Unknown') as region,
               count(distinct account_id) as listeners, count(*) filter (where kind = 'play') as plays
        from ev group by 1, 2 order by listeners desc, plays desc limit 100) t), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(t) from (
        select coalesce(country, 'XX') as country, region, coalesce(city, 'Unknown') as city,
               count(distinct account_id) as listeners, count(*) filter (where kind = 'play') as plays
        from ev group by 1, 2, 3 order by listeners desc, plays desc limit 150) t), '[]'::jsonb)
  );
$$;

-- Platforms and app versions of signed-in users (one row per person in the
-- directory). `listeners` and `accounts` are kept as aliases of `users`.
create or replace function stats_platforms() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with p as (
    select coalesce(nullif(platform, ''), 'web') as platform, app_version from directory where account_id is not null
  )
  select jsonb_build_object(
    'platforms', coalesce((select jsonb_agg(t) from (
        select platform, count(*) as users, count(*) as listeners, count(*) as accounts
        from p group by 1 order by 2 desc) t), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(t) from (
        select platform, coalesce(app_version, 'unknown') as "appVersion", count(*) as users, count(*) as listeners
        from p group by 1, 2 order by users desc limit 60) t), '[]'::jsonb)
  );
$$;

-- Engagement of signed-in users: hour-of-week heat map (IST), event mix,
-- platforms, per-day plays per person, and segments of accounts.
create or replace function stats_engagement(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.kind, e.platform, s.account_id, e.at
    from events e join s on s.listener_id = e.listener_id
    where e.at > now() - make_interval(days => _days(p_days))
  ),
  hm as (
    select extract(dow  from (at at time zone 'Asia/Kolkata'))::int as d,
           extract(hour from (at at time zone 'Asia/Kolkata'))::int as h,
           count(*)::int as n
    from ev where kind in ('play', 'heartbeat') group by 1, 2
  ),
  grid as (
    select gd.d, gh.h, coalesce(hm.n, 0) as n
    from generate_series(0, 6) gd(d) cross join generate_series(0, 23) gh(h)
    left join hm on hm.d = gd.d and hm.h = gh.h
  ),
  per as (
    select account_id, count(*) filter (where kind = 'play') as plays,
           count(distinct (at at time zone 'Asia/Kolkata')::date) as days
    from ev group by 1
  )
  select jsonb_build_object(
    'byKind', coalesce((select jsonb_agg(t) from (
        select kind, count(*) as n, count(distinct account_id) as listeners from ev group by 1 order by n desc) t), '[]'::jsonb),
    'byPlatform', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'web') as platform, count(*) as n, count(distinct account_id) as listeners
        from ev group by 1 order by n desc) t), '[]'::jsonb),
    'hourly', jsonb_build_object(
        'cells', (select jsonb_agg(cells order by d) from (select d, jsonb_agg(n order by h) as cells from grid group by d) r),
        'peak', (select jsonb_build_object('day', d, 'hour', h, 'n', n) from hm where n > 0 order by n desc, d, h limit 1)),
    'perUser', jsonb_build_object(
        'people', (select count(*) from per),
        'playsPerPerson', (select round(avg(plays)::numeric, 1) from per),
        'daysPerPerson', (select round(avg(days)::numeric, 1) from per),
        'buckets', jsonb_build_object(
          'light', (select count(*) from per where plays between 1 and 9),
          'regular', (select count(*) from per where plays between 10 and 49),
          'heavy', (select count(*) from per where plays >= 50))),
    'segments', jsonb_build_object(
        'new7d',       (select count(*) from accounts where created_at > now() - interval '7 days'),
        'returning7d', (select count(*) from accounts where last_seen > now() - interval '7 days' and created_at <= now() - interval '7 days'),
        'inactive30d', (select count(*) from accounts where last_seen <= now() - interval '7 days' and last_seen > now() - interval '30 days'),
        'dormant',     (select count(*) from accounts where last_seen <= now() - interval '30 days'),
        'power',       (select count(*) from (
                          select s.account_id from events e join s on s.listener_id = e.listener_id
                          where e.kind = 'play' and e.at > now() - interval '30 days' group by 1 having count(*) >= 20) p)),
    'total', (select count(*) from ev)
  );
$$;

-- Weekly cohorts of signed-in users. Version 14: a cohort is the people
-- who first signed in with Google that week (Monday to Sunday, India time).
-- Came back after 1 day = used the app on the next calendar day (India
-- time); after 7 days = on any of days 2–7; after 30 days = on any of days
-- 8–30. Each rate counts only people whose window is already over (d1Of,
-- d7Of, d30Of), so a young cohort is not shown as people who left.
create or replace function stats_retention(p_weeks int default 8) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  cohorts as (
    select a.id as account_id, (a.created_at at time zone 'Asia/Kolkata')::date as join_day
    from accounts a
    where a.created_at >= ((date_trunc('week', _ist_today()) - make_interval(weeks => least(greatest(coalesce(p_weeks, 8), 1), 26) - 1))::timestamp at time zone 'Asia/Kolkata')
  ),
  seen as (
    select distinct s.account_id, (e.at at time zone 'Asia/Kolkata')::date as day
    from events e join s on s.listener_id = e.listener_id
    where s.account_id in (select account_id from cohorts) and e.at > now() - interval '220 days'
  ),
  back as (
    select c.account_id, c.join_day, date_trunc('week', c.join_day)::date as week,
           coalesce(bool_or(d.day = c.join_day + 1), false) as d1,
           coalesce(bool_or(d.day between c.join_day + 2 and c.join_day + 7), false) as d7,
           coalesce(bool_or(d.day between c.join_day + 8 and c.join_day + 30), false) as d30
    from cohorts c left join seen d on d.account_id = c.account_id
    group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'week', to_char(r.week, 'YYYY-MM-DD'), 'size', r.size,
      'd1', r.d1, 'd7', r.d7, 'd30', r.d30, 'd1Of', r.d1_of, 'd7Of', r.d7_of, 'd30Of', r.d30_of
    ) order by r.week desc), '[]'::jsonb)
  from (
    select week, count(*) as size,
           count(*) filter (where d1 and join_day + 1 < _ist_today()) as d1,
           count(*) filter (where d7 and join_day + 7 < _ist_today()) as d7,
           count(*) filter (where d30 and join_day + 30 < _ist_today()) as d30,
           count(*) filter (where join_day + 1 < _ist_today()) as d1_of,
           count(*) filter (where join_day + 7 < _ist_today()) as d7_of,
           count(*) filter (where join_day + 30 < _ist_today()) as d30_of
    from back group by week
  ) r;
$$;

-- The sign-up journey: of everyone who opened the app in the window, how
-- many played a song, signed in with Google, and came back on another day
-- after signing in. Aggregate numbers only; no device is listed anywhere.
create or replace function stats_funnel(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with ev as (
    select listener_id, kind, (at at time zone 'Asia/Kolkata')::date as day from events
    where at > now() - make_interval(days => _days(p_days)) and listener_id is not null
  ),
  s as (select * from signed_devices()),
  opened as (select distinct listener_id from ev),
  played as (select distinct listener_id from ev where kind in ('play', 'heartbeat', 'complete')),
  signed as (select o.listener_id, s.account_id from opened o join s on s.listener_id = o.listener_id),
  back as (
    select distinct sg.account_id from signed sg join ev e on e.listener_id = sg.listener_id
    group by sg.account_id having count(distinct e.day) >= 2
  )
  select jsonb_build_array(
    jsonb_build_object('id', 'open',   'label', 'Opened the app', 'listeners', (select count(*) from opened)),
    jsonb_build_object('id', 'play',   'label', 'Played a song',  'listeners', (select count(*) from played)),
    jsonb_build_object('id', 'signin', 'label', 'Signed in with Google', 'listeners', (select count(distinct account_id) from signed)),
    jsonb_build_object('id', 'return', 'label', 'Came back another day', 'listeners', (select count(*) from back))
  );
$$;

-- Songs signed-in users skip: skip rate among songs with at least p_min plays.
create or replace function stats_skips(p_days int default 7, p_min int default 5) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.kind, e.song_id, e.song_title, e.song_artist, e.song_image, e.at
    from events e join s on s.listener_id = e.listener_id
    where e.kind in ('play', 'skip') and e.at > now() - make_interval(days => _days(p_days))
      and e.song_id is not null and e.song_id <> ''
  ),
  agg as (
    select song_id,
           (array_agg(coalesce(song_title, '')  order by at desc))[1] as title,
           (array_agg(coalesce(song_artist, '') order by at desc))[1] as artist,
           (array_agg(coalesce(song_image, '')  order by at desc))[1] as image,
           count(*) filter (where kind = 'play') as plays,
           count(*) filter (where kind = 'skip') as skips
    from ev group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', song_id, 'title', title, 'artist', artist, 'image', image,
      -- A skip whose play fell just before the window can push skips above
      -- plays; a rate is a percentage, so it is capped at 100.
      'plays', plays, 'skips', skips, 'rate', least(100, round(skips::numeric * 100 / plays))::int
    ) order by (skips::numeric / plays) desc, skips desc), '[]'::jsonb)
  from (select * from agg where plays >= greatest(coalesce(p_min, 1), 1) and skips > 0 order by (skips::numeric / plays) desc, skips desc limit 50) r;
$$;

-- An error message with the song names, ids and numbers taken out, so the
-- same problem on 14 songs is one row.
create or replace function _error_shape(p_message text) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p_message, ''),
    '"[^"]*"|“[^”]*”|''[^'']*''', '…', 'g'),
    '[[:alnum:]_.:/-]*[0-9][[:alnum:]_.:/-]*', '#', 'g'),
    '[[:space:]]+', ' ', 'g')), 300)
$$;

-- App errors (every report counts). Similar messages are one group with its
-- fingerprint (md5 of kind + shape), how many people hit it, and the owner's
-- status for it from error_status.
create or replace function stats_errors(p_days int default 7, p_limit int default 50) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select e.at, coalesce(nullif(e.error_kind, ''), 'error') as error_kind, coalesce(e.message, '') as message,
           _error_shape(e.message) as shape, e.platform, e.app_version, s.account_id
    from events e left join s on s.listener_id = e.listener_id
    where e.kind = 'error' and e.at > now() - make_interval(days => _days(p_days))
  ),
  days as (
    select generate_series(_ist_today() - (_days(p_days) - 1), _ist_today(), '1 day')::date as day
  ),
  grp as (
    select md5(error_kind || '|' || shape) as fingerprint, error_kind, shape,
           count(*) as hits, count(distinct account_id) as users, count(distinct message) as variants,
           max(at) as last_seen, min(at) as first_seen,
           (array_agg(message order by at desc))[1] as message,
           (array_agg(distinct message))[1:3] as samples,
           array_agg(distinct coalesce(platform, 'web')) as platforms,
           array_agg(distinct app_version) filter (where app_version is not null) as versions
    from ev group by 1, 2, 3
  )
  select jsonb_build_object(
    'total', (select count(*) from ev),
    'groups', (select count(*) from grp),
    'users', (select count(distinct account_id) from ev),
    'byDay', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'hits', coalesce(x.n, 0)) order by d.day)
        from days d left join (select (at at time zone 'Asia/Kolkata')::date as day, count(*) as n from ev group by 1) x on x.day = d.day), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(t) from (
        select g.fingerprint, g.error_kind as "errorKind", g.message, g.shape, g.samples, g.variants,
               g.hits, g.users, g.last_seen as "lastSeen", g.first_seen as "firstSeen", g.platforms, g.versions,
               coalesce(st.status, 'new') as status, st.note
        from grp g left join error_status st on st.fingerprint = g.fingerprint
        order by g.hits desc limit least(coalesce(p_limit, 50), 300)) t), '[]'::jsonb)
  );
$$;

-- Version 11 — Trending (console): songs, artists and languages played by
-- signed-in users in this window against the window of the same length just
-- before it. The window starts at midnight India time `p_days - 1` days ago
-- (1..90) and runs to now; the one before it is exactly as long and ends where
-- it starts. Ranks are positions by plays (1 = most played) in each window;
-- prev_rank is null when a song had no plays before (a new entry). `daily`
-- has one count per India calendar day of the window, oldest first.
create or replace function stats_trending(p_days int default 7, p_limit int default 50) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with b as (
    select least(greatest(coalesce(p_days, 7), 1), 90) as days,
           least(greatest(coalesce(p_limit, 50), 1), 100) as lim,
           ((_ist_today() - (least(greatest(coalesce(p_days, 7), 1), 90) - 1))::timestamp at time zone 'Asia/Kolkata') as t0
  ),
  w as (select days, lim, t0, t0 - (now() - t0) as tp from b),
  days as (
    select generate_series(_ist_today() - ((select days from w) - 1), _ist_today(), '1 day')::date as day
  ),
  s as (select * from signed_devices()),
  ev as (
    select coalesce(nullif(e.song_id, ''), lower(e.song_title) || '|' || lower(coalesce(e.song_artist, ''))) as key,
           e.song_id, e.song_title, e.song_artist, e.song_image, e.language, s.account_id, e.at,
           e.at >= (select t0 from w) as cur
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'play' and e.at >= (select tp from w)
  ),
  songs as (
    select key,
           (array_agg(song_id order by at desc) filter (where song_id is not null and song_id <> ''))[1] as id,
           (array_agg(song_title order by at desc))[1] as title,
           (array_agg(song_artist order by at desc) filter (where song_artist is not null and song_artist <> ''))[1] as artist,
           (array_agg(song_image order by at desc) filter (where song_image is not null and song_image <> ''))[1] as image,
           count(*) filter (where cur) as plays,
           count(*) filter (where not cur) as prev_plays,
           count(distinct account_id) filter (where cur) as listeners
    from ev where song_title is not null and song_title <> ''
    group by 1
  ),
  song_rank as (
    select key, row_number() over (order by plays desc, listeners desc, key) as rank from songs where plays > 0
  ),
  song_prev as (
    select key, row_number() over (order by prev_plays desc, key) as prev_rank from songs where prev_plays > 0
  ),
  top as (
    select s2.*, r.rank, p.prev_rank
    from songs s2 join song_rank r using (key) left join song_prev p using (key)
    where r.rank <= (select lim from w)
  ),
  per_day as (
    select key, (at at time zone 'Asia/Kolkata')::date as day, count(*) as n
    from ev where cur and key in (select key from top)
    group by 1, 2
  ),
  artists as (
    select song_artist as artist,
           count(*) filter (where cur) as plays,
           count(*) filter (where not cur) as prev_plays,
           count(distinct account_id) filter (where cur) as listeners
    from ev where song_artist is not null and song_artist <> ''
    group by 1
  ),
  artist_rank as (
    select artist, row_number() over (order by plays desc, listeners desc, artist) as rank from artists where plays > 0
  ),
  artist_prev as (
    select artist, row_number() over (order by prev_plays desc, artist) as prev_rank from artists where prev_plays > 0
  ),
  langs as (
    select coalesce(nullif(language, ''), 'unknown') as language,
           count(*) filter (where cur) as plays,
           count(*) filter (where not cur) as prev_plays,
           count(distinct account_id) filter (where cur) as listeners
    from ev group by 1
  )
  select jsonb_build_object(
    'days', (select days from w),
    'totals', jsonb_build_object(
      'plays',          (select count(*) from ev where cur),
      'prev_plays',     (select count(*) from ev where not cur),
      'listeners',      (select count(distinct account_id) from ev where cur),
      'prev_listeners', (select count(distinct account_id) from ev where not cur),
      'songs',          (select count(*) from songs where plays > 0),
      'new_songs',      (select count(*) from songs where plays > 0 and prev_plays = 0)),
    'songs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'artist', t.artist, 'image', t.image,
        'plays', t.plays, 'prev_plays', t.prev_plays, 'listeners', t.listeners,
        'rank', t.rank, 'prev_rank', t.prev_rank,
        'daily', (select jsonb_agg(coalesce(pd.n, 0) order by d.day) from days d left join per_day pd on pd.key = t.key and pd.day = d.day)
      ) order by t.rank) from top t), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(jsonb_build_object(
        'artist', a.artist, 'plays', a.plays, 'prev_plays', a.prev_plays, 'listeners', a.listeners,
        'rank', r.rank, 'prev_rank', p.prev_rank) order by r.rank)
      from artists a join artist_rank r using (artist) left join artist_prev p using (artist)
      where r.rank <= (select lim from w)), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object(
        'language', l.language, 'plays', l.plays, 'prev_plays', l.prev_plays, 'listeners', l.listeners) order by l.plays desc, l.language)
      from langs l where l.plays > 0 or l.prev_plays > 0), '[]'::jsonb)
  );
$$;

-- Version 11 — Search Insights (console): what signed-in users search for.
-- A search event's message is '<song results>|<query>' (the app writes the
-- query lower-cased and trimmed, 2–80 characters); 0 results means the search
-- found nothing. Rows that do not have that shape are left out. Same windows
-- as stats_trending; `daily` covers the window, every day present.
create or replace function stats_searches(p_days int default 7, p_limit int default 50) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with b as (
    select least(greatest(coalesce(p_days, 7), 1), 90) as days,
           least(greatest(coalesce(p_limit, 50), 1), 200) as lim,
           ((_ist_today() - (least(greatest(coalesce(p_days, 7), 1), 90) - 1))::timestamp at time zone 'Asia/Kolkata') as t0
  ),
  w as (select days, lim, t0, t0 - (now() - t0) as tp from b),
  days as (
    select generate_series(_ist_today() - ((select days from w) - 1), _ist_today(), '1 day')::date as day
  ),
  s as (select * from signed_devices()),
  raw as (
    select e.at, s.account_id, e.at >= (select t0 from w) as cur,
           split_part(e.message, '|', 1) as n_text,
           regexp_replace(lower(btrim(substr(e.message, strpos(e.message, '|') + 1))), '\s+', ' ', 'g') as query
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'search' and e.at >= (select tp from w) and strpos(e.message, '|') > 1
  ),
  ev as (
    select at, account_id, cur, query,
           case when n_text ~ '^[0-9]{1,6}$' then n_text::int end as results
    from raw
    where length(query) between 2 and 80
  ),
  ok as (select * from ev where results is not null),
  q as (
    select query,
           count(*) filter (where cur) as searches,
           count(*) filter (where not cur) as prev_searches,
           count(distinct account_id) filter (where cur) as people,
           count(*) filter (where cur and results = 0) as zero,
           count(distinct account_id) filter (where cur and results = 0) as zero_people,
           max(at) filter (where cur and results = 0) as last_zero_at,
           max(at) filter (where cur) as last_at
    from ok group by 1
  )
  select jsonb_build_object(
    'days', (select days from w),
    'totals', jsonb_build_object(
      'searches',      (select count(*) from ok where cur),
      'people',        (select count(distinct account_id) from ok where cur),
      'zero',          (select count(*) from ok where cur and results = 0),
      'queries',       (select count(*) from q where searches > 0),
      'prev_searches', (select count(*) from ok where not cur),
      'prev_people',   (select count(distinct account_id) from ok where not cur),
      'prev_zero',     (select count(*) from ok where not cur and results = 0)),
    'top', coalesce((select jsonb_agg(t) from (
        select query, searches, people, zero, prev_searches, last_at
        from q where searches > 0
        order by searches desc, people desc, query limit (select lim from w)) t), '[]'::jsonb),
    'zero', coalesce((select jsonb_agg(t) from (
        select query, zero as searches, zero_people as people, searches - zero as found, last_zero_at as last_at
        from q where zero > 0
        order by zero desc, zero_people desc, last_zero_at desc, query limit (select lim from w)) t), '[]'::jsonb),
    'rising', coalesce((select jsonb_agg(t) from (
        select query, searches, prev_searches, people
        from q where searches >= 2 and searches > prev_searches
        order by (searches - prev_searches) desc, searches desc, query limit 25) t), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'), 'searches', coalesce(x.searches, 0), 'zero', coalesce(x.zero, 0)) order by d.day)
      from days d left join (
        select (at at time zone 'Asia/Kolkata')::date as day, count(*) as searches, count(*) filter (where results = 0) as zero
        from ok where cur group by 1) x on x.day = d.day), '[]'::jsonb)
  );
$$;

-- One listener in full: the row, the account, the backup facts, counts, tastes, recent events.
create or replace function listener_profile(p_listener text default null, p_account text default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select * from listeners
    where id = coalesce(p_listener, (select listener_id from accounts where id = p_account))
    limit 1
  ),
  a as (
    select * from accounts
    where id = p_account
       or (p_account is null and (listener_id = p_listener or id = (select account_id from listeners where id = p_listener)))
    limit 1
  ),
  ev as (
    select * from events where listener_id = (select id from l) order by at desc limit 300
  )
  select jsonb_build_object(
    'listener', (select to_jsonb(l) from l),
    'account', (select to_jsonb(a) - 'listener_id' from a),
    'backup', (select jsonb_build_object('version', version, 'bytes', bytes, 'updatedAt', updated_at)
               from account_backups where account_id = (select id from a)),
    'stats', jsonb_build_object(
      'events', (select count(*) from events where listener_id = (select id from l)),
      'plays',  (select count(*) from events where listener_id = (select id from l) and kind = 'play'),
      'plays30d', (select count(*) from events where listener_id = (select id from l) and kind = 'play' and at > now() - interval '30 days'),
      'activeDays30d', (select count(distinct at::date) from events where listener_id = (select id from l) and at > now() - interval '30 days'),
      'errors', (select count(*) from events where listener_id = (select id from l) and kind = 'error'),
      'firstEvent', (select min(at) from events where listener_id = (select id from l)),
      'lastEvent',  (select max(at) from events where listener_id = (select id from l))),
    'topSongs', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, max(song_image) as image, count(*) as plays
        from events where listener_id = (select id from l) and kind = 'play' and song_title is not null
        group by 1, 2 order by plays desc limit 12) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(language, ''), 'unknown') as language, count(*) as plays
        from events where listener_id = (select id from l) and kind = 'play' group by 1 order by plays desc limit 10) t), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.at desc) from ev), '[]'::jsonb)
  );
$$;

-- Remove one listener everywhere (events, memberships, device row, account and
-- its backup when asked). Returns what was deleted.
create or replace function delete_listener(p_listener text default null, p_account text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_listener text := coalesce(p_listener, (select listener_id from accounts where id = p_account));
  v_account  text := coalesce(p_account, (select account_id from listeners where id = p_listener), (select id from accounts where listener_id = p_listener limit 1));
  n_events bigint := 0; n_members bigint := 0; n_feedback bigint := 0; n_listener bigint := 0; n_account bigint := 0;
begin
  if v_listener is not null then
    delete from events where listener_id = v_listener; get diagnostics n_events = row_count;
    delete from room_members where member_id = v_listener; get diagnostics n_members = row_count;
    update feedback set listener_id = null where listener_id = v_listener; get diagnostics n_feedback = row_count;
  end if;
  if v_account is not null then
    delete from accounts where id = v_account; get diagnostics n_account = row_count;
  end if;
  if v_listener is not null then
    delete from listeners where id = v_listener; get diagnostics n_listener = row_count;
  end if;
  return jsonb_build_object('listener', n_listener, 'account', n_account, 'events', n_events,
                            'memberships', n_members, 'feedbackDetached', n_feedback);
end;
$$;

-- Version 13 — which kind of device a person uses, as one key the console
-- shows and filters by: the apps (android-app, ios-app), or a browser on a
-- system (android-web, ios-web, ipados-web, macos-web, windows-web,
-- linux-web, chromeos-web), or other-web when the system is not known yet.
create or replace function _device_key(p_platform text, p_os text) returns text
language sql immutable as $$
  select case
    when coalesce(nullif(p_platform, ''), 'web') = 'android' then 'android-app'
    when p_platform = 'ios' then 'ios-app'
    when p_os in ('android', 'ios', 'ipados', 'macos', 'windows', 'linux', 'chromeos') then p_os || '-web'
    else 'other-web'
  end
$$;

-- ------------------------------------------ device detail, time in app (v16) --

-- Version 16 — time in the app: listening plus time VinaX is on screen with
-- nothing playing. The app sends a `presence` about once a minute while it is
-- visible and idle (from the app version after 1.11.1; older versions only
-- send open / pause, so their idle time is mostly missing). Each play or
-- heartbeat counts until the device's next one of these events, at most 6
-- minutes (as listen_time); each open, pause or presence at most 3 minutes
-- (a longer gap means the app was closed). Seconds per device per India-time
-- day, from p_since (all time when null), for p_listeners (all when null).
create or replace function app_time(p_listeners text[] default null, p_since timestamptz default null)
returns table (listener_id text, day date, seconds bigint)
language sql stable set search_path = public, pg_temp as $$
  select x.listener_id, (x.at at time zone 'Asia/Kolkata')::date as day,
         sum(greatest(0, extract(epoch from least(coalesce(x.nxt, now()),
             x.at + case when x.kind in ('play', 'heartbeat') then interval '6 minutes' else interval '3 minutes' end) - x.at)))::bigint as seconds
  from (
    select e.listener_id, e.kind, e.at, lead(e.at) over (partition by e.listener_id order by e.at) as nxt
    from events e
    where e.kind in ('play', 'heartbeat', 'pause', 'open', 'presence')
      and e.listener_id is not null
      and (p_listeners is null or e.listener_id = any (p_listeners))
      and (p_since is null or e.at > p_since)
  ) x
  group by 1, 2
$$;

-- Time in the app per signed-in person, for a page of the console's lists
-- (All Users, Top listeners): seconds since p_since and today (India time).
create or replace function account_app_time(p_accounts text[], p_since timestamptz default null)
returns table (account_id text, seconds bigint, today bigint)
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices() d where d.account_id = any (coalesce(p_accounts, '{}'::text[])))
  select s.account_id, sum(t.seconds)::bigint, coalesce(sum(t.seconds) filter (where t.day = _ist_today()), 0)::bigint
  from app_time((select array_agg(listener_id) from s), p_since) t
  join s on s.listener_id = t.listener_id
  group by 1
$$;

-- One person's device detail and time in the app, beside user_profile: per
-- device the system version, phone model and maker and how it runs; time in
-- the app today, 7 / 30 days, all time, and per day for the last 14 days.
create or replace function profile_app_time(p_account text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with d as (
    select l.* from listeners l
    where l.account_id = p_account or l.id = (select listener_id from accounts where id = p_account)
  ),
  t as (select x.day, sum(x.seconds)::bigint as seconds
        from app_time((select array_agg(id) from d), null) x group by 1)
  select jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'osVersion', d.os_version, 'model', d.device_model,
                 'brand', d.device_brand, 'display', d.display_mode) order by d.last_seen desc) from d), '[]'::jsonb),
    'today', coalesce((select seconds from t where day = _ist_today()), 0),
    'days7', coalesce((select sum(seconds) from t where day > _ist_today() - 7), 0),
    'days30', coalesce((select sum(seconds) from t where day > _ist_today() - 30), 0),
    'all', coalesce((select sum(seconds) from t), 0),
    'byDay', (select jsonb_agg(jsonb_build_object('day', g.day, 'seconds', coalesce(t.seconds, 0)) order by g.day)
              from (select (_ist_today() - i) as day from generate_series(0, 13) i) g
              left join t on t.day = g.day))
$$;

-- The console's Phones & Browsers page: the devices of signed-in people seen
-- in the last p_days, by how they run VinaX, maker, phone model, Android and
-- iOS version, system and browser. Devices that have not reported since the
-- schema-16 update count as "not known yet".
create or replace function device_breakdown(p_days int default 90) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with d as (
    select l.* from listeners l
    join signed_devices() s on s.listener_id = l.id
    where l.last_seen > now() - make_interval(days => _days(p_days))
  )
  select jsonb_build_object(
    'days', _days(p_days),
    'devices', (select count(*) from d),
    'display', coalesce((select jsonb_object_agg(k, n) from (
        select coalesce(display_mode, case when coalesce(nullif(platform, ''), 'web') <> 'web' then 'app' else 'unknown' end) as k, count(*) as n
        from d group by 1) x), '{}'::jsonb),
    'brands', coalesce((select jsonb_agg(x) from (
        select device_brand as brand, count(*) as devices from d
        where device_brand is not null group by 1 order by devices desc, brand limit 12) x), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(x) from (
        select device_model as model, max(device_brand) as brand, count(*) as devices from d
        where device_model is not null group by 1 order by devices desc, model limit 15) x), '[]'::jsonb),
    'android', coalesce((select jsonb_agg(x) from (
        select os_version as version, count(*) as devices from d
        where os = 'android' and os_version is not null group by 1 order by devices desc, version limit 12) x), '[]'::jsonb),
    'ios', coalesce((select jsonb_agg(x) from (
        select os_version as version, count(*) as devices from d
        where os in ('ios', 'ipados') and os_version is not null group by 1 order by devices desc, version limit 12) x), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(x) from (
        select browser, count(*) as devices from d
        where browser is not null group by 1 order by devices desc, browser limit 10) x), '[]'::jsonb),
    'androidKnown', (select count(*) from d where os = 'android' and os_version is not null),
    'androidAll', (select count(*) from d where os = 'android' or platform = 'android'),
    'modelKnown', (select count(*) from d where device_model is not null)
  )
$$;

-- Locked like every other function: only the Worker's service role runs them.
revoke all on function app_time(text[], timestamptz) from public, anon, authenticated;
revoke all on function account_app_time(text[], timestamptz) from public, anon, authenticated;
revoke all on function profile_app_time(text) from public, anon, authenticated;
revoke all on function device_breakdown(int) from public, anon, authenticated;
grant execute on function app_time(text[], timestamptz) to service_role;
grant execute on function account_app_time(text[], timestamptz) to service_role;
grant execute on function profile_app_time(text) to service_role;
grant execute on function device_breakdown(int) to service_role;

-- Version 13 — listening time, estimated from the usage events the app
-- already sends: a heartbeat every 25 s while music plays, a play when a song
-- counts, a pause, and an open when the app starts or comes back. Each play
-- or heartbeat counts the time until the device's next one of those four
-- events, at most 6 minutes (a phone in the background can send fewer
-- heartbeats; a gap longer than that means the music had stopped). Seconds
-- per device per day (India time), from p_since (all time when null), for
-- p_listeners (every device when null).
-- Version 14 — the stretches listen_time() adds up: one row per play or
-- heartbeat, when it started and the seconds it counts (the rule above).
-- The console's heat map, Top listeners and At risk read these directly.
create or replace function _listen_spans(p_listeners text[] default null, p_since timestamptz default null)
returns table (listener_id text, at timestamptz, seconds numeric)
language sql stable set search_path = public, pg_temp as $$
  select x.listener_id, x.at,
         greatest(0, extract(epoch from least(coalesce(x.nxt, now()), x.at + interval '6 minutes') - x.at))
  from (
    select e.listener_id, e.kind, e.at, lead(e.at) over (partition by e.listener_id order by e.at) as nxt
    from events e
    where e.kind in ('play', 'heartbeat', 'pause', 'open')
      and e.listener_id is not null
      and (p_listeners is null or e.listener_id = any (p_listeners))
      and (p_since is null or e.at > p_since)
  ) x
  where x.kind in ('play', 'heartbeat')
$$;

create or replace function listen_time(p_listeners text[] default null, p_since timestamptz default null)
returns table (listener_id text, day date, seconds bigint)
language sql stable set search_path = public, pg_temp as $$
  select t.listener_id, (t.at at time zone 'Asia/Kolkata')::date as day, sum(t.seconds)::bigint as seconds
  from _listen_spans(p_listeners, p_since) t
  group by 1, 2
$$;

-- Version 14 — where a console window starts: 1 day means today since
-- midnight India time, otherwise the last p_days days.
create or replace function _window_start(p_days int) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select case when coalesce(p_days, 7) <= 1 then (_ist_today()::timestamp at time zone 'Asia/Kolkata')
              else now() - make_interval(days => _days(p_days)) end
$$;

-- Version 14 — Top listeners: signed-in people ranked by listening time in
-- the window (today, 7 or 30 days…), with plays, active days, their most
-- played artist and their newest device and place.
create or replace function stats_top_listeners(p_days int default 7, p_limit int default 100) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  w as (select _window_start(p_days) as t),
  sp as (
    select s.account_id, t.at, t.seconds
    from _listen_spans(null, (select t from w)) t join s on s.listener_id = t.listener_id
  ),
  per as (
    select account_id, sum(seconds)::bigint as seconds, count(distinct (at at time zone 'Asia/Kolkata')::date) as days
    from sp group by 1 having sum(seconds) > 0
  ),
  pl as (
    select s.account_id, e.song_artist, count(*) as n
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'play' and e.at > (select t from w) and s.account_id in (select account_id from per)
    group by 1, 2
  ),
  plays as (select account_id, sum(n) as plays from pl group by 1),
  art as (
    select distinct on (account_id) account_id, song_artist from pl
    where song_artist is not null and song_artist <> '' order by account_id, n desc, song_artist
  ),
  ranked as (select per.*, row_number() over (order by per.seconds desc, per.account_id) as rn from per)
  select jsonb_build_object(
    'since', (select t from w),
    'people', (select count(*) from per),
    'total', (select coalesce(sum(seconds), 0) from per),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'picture', a.picture,
        'seconds', r.seconds, 'days', r.days, 'plays', coalesce(p.plays, 0), 'topArtist', art.song_artist,
        'platform', coalesce(nullif(d.platform, ''), 'web'), 'os', d.os, 'browser', d.browser, 'device', _device_key(d.platform, d.os),
        'appVersion', d.app_version, 'country', d.country, 'region', d.region, 'city', d.city, 'lastSeen', d.last_seen
      ) order by r.rn)
      from ranked r
      join accounts a on a.id = r.account_id
      left join directory d on d.account_id = r.account_id
      left join plays p on p.account_id = r.account_id
      left join art on art.account_id = r.account_id
      where r.rn <= least(greatest(coalesce(p_limit, 100), 1), 500)), '[]'::jsonb)
  );
$$;

-- Version 14 — At risk: signed-in people who used to listen a lot and have
-- gone quiet. Quiet = nothing from any of their devices for p_quiet_days
-- (7) days, but something in the last 90. "A lot" = in the 30 days before
-- their last visit they listened for at least 2 hours OR used the app on at
-- least 5 different days. Most listening first.
create or replace function stats_at_risk(p_quiet_days int default 7, p_limit int default 200) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  ev as (
    select s.account_id, e.listener_id, e.kind, e.at, e.song_artist
    from events e join s on s.listener_id = e.listener_id
    where e.at > now() - interval '120 days'
  ),
  last as (select account_id, max(at) as last_at from ev group by 1),
  quiet as (
    select * from last
    where last_at < now() - make_interval(days => least(greatest(coalesce(p_quiet_days, 7), 1), 60))
      and last_at > now() - interval '90 days'
  ),
  before as (select ev.* from ev join quiet q on q.account_id = ev.account_id where ev.at > q.last_at - interval '30 days'),
  sp as (
    select s.account_id, t.at, t.seconds
    from _listen_spans(coalesce((select array_agg(distinct listener_id) from before), array[]::text[]), now() - interval '120 days') t
    join s on s.listener_id = t.listener_id
    join quiet q on q.account_id = s.account_id
    where t.at > q.last_at - interval '30 days'
  ),
  secs as (select account_id, sum(seconds)::bigint as seconds from sp group by 1),
  act as (
    select account_id, count(distinct (at at time zone 'Asia/Kolkata')::date) as days,
           count(*) filter (where kind = 'play') as plays
    from before group by 1
  ),
  art as (
    select distinct on (account_id) account_id, song_artist from (
      select account_id, song_artist, count(*) as n from before
      where kind = 'play' and song_artist is not null and song_artist <> '' group by 1, 2) x
    order by account_id, n desc, song_artist
  ),
  risk as (
    select q.account_id, q.last_at, coalesce(sc.seconds, 0) as seconds, coalesce(ac.days, 0) as days, coalesce(ac.plays, 0) as plays,
           row_number() over (order by coalesce(sc.seconds, 0) desc, coalesce(ac.days, 0) desc, q.account_id) as rn
    from quiet q
    left join secs sc on sc.account_id = q.account_id
    left join act ac on ac.account_id = q.account_id
    where coalesce(sc.seconds, 0) >= 7200 or coalesce(ac.days, 0) >= 5
  )
  select jsonb_build_object(
    'rule', jsonb_build_object('quietDays', least(greatest(coalesce(p_quiet_days, 7), 1), 60), 'minSeconds', 7200, 'minDays', 5, 'lookbackDays', 30),
    'total', (select count(*) from risk),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'email', a.email, 'picture', a.picture,
        'lastActive', r.last_at, 'seconds', r.seconds, 'days', r.days, 'plays', r.plays, 'topArtist', art.song_artist,
        'platform', coalesce(nullif(d.platform, ''), 'web'), 'os', d.os, 'browser', d.browser, 'device', _device_key(d.platform, d.os),
        'appVersion', d.app_version, 'country', d.country, 'region', d.region, 'city', d.city
      ) order by r.rn)
      from risk r
      join accounts a on a.id = r.account_id
      left join directory d on d.account_id = r.account_id
      left join art on art.account_id = r.account_id
      where r.rn <= least(greatest(coalesce(p_limit, 200), 1), 500)), '[]'::jsonb)
  );
$$;

-- Version 14 — listening time of signed-in people in the window: the
-- weekday × hour heat map (India time, seconds), the busiest hour, each
-- hour of the day, each day, per-person averages and how many people
-- listened lightly / regularly / heavily.
create or replace function stats_listening(p_days int default 7) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  w as (select _window_start(p_days) as t),
  sp as (
    select s.account_id, t.at at time zone 'Asia/Kolkata' as local, t.seconds
    from _listen_spans(null, (select t from w)) t join s on s.listener_id = t.listener_id
  ),
  hm as (
    select extract(dow from local)::int as d, extract(hour from local)::int as h, sum(seconds)::bigint as sec
    from sp group by 1, 2
  ),
  grid as (
    select gd.d, gh.h, coalesce(hm.sec, 0) as sec
    from generate_series(0, 6) gd(d) cross join generate_series(0, 23) gh(h)
    left join hm on hm.d = gd.d and hm.h = gh.h
  ),
  per as (
    select account_id, sum(seconds) as sec, count(distinct local::date) as days
    from sp group by 1 having sum(seconds) > 0
  ),
  daily as (select local::date as day, sum(seconds)::bigint as sec, count(distinct account_id) as people from sp group by 1),
  days as (
    select g::date as day from generate_series(((select t from w) at time zone 'Asia/Kolkata')::date, _ist_today(), interval '1 day') g
  )
  select jsonb_build_object(
    'since', (select t from w),
    'total', (select coalesce(sum(sec), 0)::bigint from per),
    'people', (select count(*) from per),
    'perPerson', (select round(avg(sec))::bigint from per),
    'perPersonDay', (select case when sum(days) > 0 then round(sum(sec) / sum(days))::bigint end from per),
    'hourly', jsonb_build_object(
      'cells', (select jsonb_agg(cells order by d) from (select d, jsonb_agg(sec order by h) as cells from grid group by d) r),
      'byHour', (select jsonb_agg(sec order by h) from (select h, sum(sec)::bigint as sec from grid group by h) r),
      'peak', (select jsonb_build_object('day', d, 'hour', h, 'seconds', sec) from hm where sec > 0 order by sec desc, d, h limit 1)),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(days.day, 'YYYY-MM-DD'), 'seconds', coalesce(daily.sec, 0), 'people', coalesce(daily.people, 0)) order by days.day)
                 from days left join daily on daily.day = days.day), '[]'::jsonb),
    'buckets', jsonb_build_object(
      'light', (select count(*) from per where sec < 1800),
      'regular', (select count(*) from per where sec >= 1800 and sec < 18000),
      'heavy', (select count(*) from per where sec >= 18000))
  );
$$;

-- Version 10 — the console's Users page: signed-in people only, filtered and
-- sorted on the server, one page at a time, with the counts the page shows.
-- p_sort: last_active | joined | plays | listening (v13) | name.
create or replace function admin_users(
  p_q text default null, p_platform text default null, p_active_days int default null,
  p_joined_days int default null, p_joined_from timestamptz default null, p_joined_to timestamptz default null,
  p_country text default null, p_region text default null, p_city text default null,
  p_version text default null, p_language text default null, p_ids text[] default null,
  p_sort text default 'last_active', p_limit int default 50, p_offset int default 0) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with s as (select * from signed_devices()),
  plays as (
    select s.account_id, count(*) as plays
    from events e join s on s.listener_id = e.listener_id
    where e.kind = 'play' group by 1
  ),
  -- Version 13: listening time over the last 30 days (seconds), per person.
  listen as (
    select s.account_id,
           sum(t.seconds) as listen30d,
           sum(t.seconds) filter (where t.day = _ist_today()) as listen_today
    from listen_time(null, now() - interval '30 days') t join s on s.listener_id = t.listener_id
    group by 1
  ),
  lang as (
    select distinct on (account_id) account_id, language from (
      select s.account_id, coalesce(nullif(e.language, ''), 'unknown') as language, count(*) as n
      from events e join s on s.listener_id = e.listener_id
      where e.kind = 'play' and e.at > now() - interval '90 days' group by 1, 2) x
    order by account_id, n desc, language
  ),
  f as (
    select d.account_id as id, a.name, a.email, a.picture,
           coalesce(nullif(d.platform, ''), 'web') as platform, d.app_version, d.country, d.region, d.city,
           d.now_playing, d.is_playing, a.created_at as joined, d.last_seen, d.devices,
           coalesce(p.plays, 0) as plays, lg.language, a.blocked_at,
           d.os, d.browser, _device_key(d.platform, d.os) as device,
           coalesce(ls.listen30d, 0) as listen30d, coalesce(ls.listen_today, 0) as listen_today
    from directory d
    join accounts a on a.id = d.account_id
    left join plays p on p.account_id = d.account_id
    left join listen ls on ls.account_id = d.account_id
    left join lang lg on lg.account_id = d.account_id
    where d.account_id is not null
      and (p_ids is null or d.account_id = any (p_ids))
      and (coalesce(p_q, '') = '' or strpos(lower(coalesce(a.name, '')), lower(p_q)) > 0 or strpos(lower(coalesce(a.email, '')), lower(p_q)) > 0)
      -- a platform (android | web | ios) or, since version 13, a device key (android-app, macos-web…)
      and (p_platform is null or coalesce(nullif(d.platform, ''), 'web') = p_platform or _device_key(d.platform, d.os) = p_platform)
      and (p_active_days is null or d.last_seen > now() - make_interval(days => p_active_days))
      and (p_joined_days is null or a.created_at > now() - make_interval(days => p_joined_days))
      and (p_joined_from is null or a.created_at >= p_joined_from)
      and (p_joined_to is null or a.created_at < p_joined_to)
      and (p_country is null or d.country = p_country)
      and (p_region is null or d.region = p_region)
      and (p_city is null or d.city = p_city)
      and (p_version is null or d.app_version = p_version)
      and (p_language is null or lg.language = p_language)
  ),
  ranked as (
    select f.*, row_number() over (order by
      case when p_sort = 'joined' then f.joined end desc nulls last,
      case when p_sort = 'plays' then f.plays end desc nulls last,
      case when p_sort = 'listening' then f.listen30d end desc nulls last,
      case when p_sort = 'name' then lower(coalesce(f.name, f.email, '')) end asc nulls last,
      f.last_seen desc, f.id) as rn
    from f
  ),
  everyone as (select coalesce(nullif(platform, ''), 'web') as platform, _device_key(platform, os) as device, last_seen from directory where account_id is not null)
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'rn' order by r.rn) from (
        select * from ranked where rn > greatest(coalesce(p_offset, 0), 0)
        order by rn limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb),
    'counts', jsonb_build_object(
      'users', (select count(*) from accounts),
      'new7d', (select count(*) from accounts where created_at > now() - interval '7 days'),
      'activeToday', (select count(*) from everyone where last_seen >= (_ist_today()::timestamp at time zone 'Asia/Kolkata')),
      'byPlatform', jsonb_build_object(
        'android', (select count(*) from everyone where platform = 'android'),
        'web', (select count(*) from everyone where platform = 'web'),
        'ios', (select count(*) from everyone where platform = 'ios')),
      -- Version 13: people per device key (newest device), and today's listening.
      'byDevice', coalesce((select jsonb_object_agg(device, n) from (select device, count(*) as n from everyone group by 1) t), '{}'::jsonb),
      'listenToday', coalesce((select sum(listen_today) from listen), 0),
      'listenersToday', (select count(*) from listen where listen_today > 0))
  );
$$;

-- The choices the Users filters offer: places, app versions and languages
-- that signed-in users actually have.
create or replace function admin_user_filters() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with d as (select * from directory where account_id is not null),
  s as (select * from signed_devices())
  select jsonb_build_object(
    'places', coalesce((select jsonb_agg(t) from (
        select country, region, city, count(*) as users from d
        where country is not null group by 1, 2, 3 order by users desc limit 500) t), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(platform, ''), 'web') as platform, app_version as version, count(*) as users
        from d where app_version is not null group by 1, 2 order by 1, users desc) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(e.language, ''), 'unknown') as language, count(distinct s.account_id) as users
        from events e join s on s.listener_id = e.listener_id
        where e.kind = 'play' and e.at > now() - interval '90 days' group by 1 order by users desc limit 40) t), '[]'::jsonb)
  );
$$;

-- One signed-in person in full, across every device they use: the account,
-- each device (platform, version, place, last seen), counts, top songs,
-- artists and languages, listening history, feedback they sent and recent
-- activity. Device ids are returned only so a device can be signed out.
create or replace function user_profile(p_account text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with a as (select * from accounts where id = p_account),
  d as (
    select l.* from listeners l
    where l.account_id = p_account or l.id = (select listener_id from a)
  ),
  ev as (select e.* from events e where e.listener_id in (select id from d)),
  -- Version 13: listening time per India-time day, all devices together.
  lt as (select t.day, sum(t.seconds)::bigint as seconds
         from listen_time(coalesce((select array_agg(id) from d), array[]::text[]), null) t group by 1)
  select case when not exists (select 1 from a) then null else jsonb_build_object(
    'account', (select jsonb_build_object('id', id, 'email', email, 'name', name, 'picture', picture,
                  'platform', platform, 'appVersion', app_version, 'country', country, 'region', region, 'city', city,
                  'createdAt', created_at, 'lastSeen', last_seen, 'blockedAt', blocked_at) from a),
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', d.id, 'platform', coalesce(nullif(d.platform, ''), 'web'), 'appVersion', d.app_version,
                  'country', d.country, 'region', d.region, 'city', d.city,
                  'firstSeen', d.first_seen, 'lastSeen', d.last_seen, 'signedOutAt', d.signed_out_at,
                  'os', d.os, 'browser', d.browser, 'device', _device_key(d.platform, d.os),
                  'nowPlaying', d.now_playing, 'isPlaying', d.is_playing) order by d.last_seen desc) from d), '[]'::jsonb),
    'backup', (select jsonb_build_object('version', version, 'bytes', bytes, 'updatedAt', updated_at)
               from account_backups where account_id = p_account),
    'stats', jsonb_build_object(
      'plays',         (select count(*) from ev where kind = 'play'),
      'plays30d',      (select count(*) from ev where kind = 'play' and at > now() - interval '30 days'),
      'activeDays30d', (select count(distinct (at at time zone 'Asia/Kolkata')::date) from ev where at > now() - interval '30 days'),
      'favorites',     (select count(*) from ev where kind = 'favorite'),
      'searches',      (select count(*) from ev where kind = 'search'),
      'errors',        (select count(*) from ev where kind = 'error'),
      'firstEvent',    (select min(at) from ev),
      'lastEvent',     (select max(at) from ev),
      'listenToday',   coalesce((select seconds from lt where day = _ist_today()), 0),
      'listen7d',      coalesce((select sum(seconds) from lt where day > _ist_today() - 7), 0),
      'listen30d',     coalesce((select sum(seconds) from lt where day > _ist_today() - 30), 0),
      'listenAll',     coalesce((select sum(seconds) from lt), 0),
      'listenDays30d', (select count(*) from lt where day > _ist_today() - 30 and seconds > 0),
      'avgPerActiveDay30d', coalesce((select round(avg(seconds)) from lt where day > _ist_today() - 30 and seconds > 0), 0)),
    'listenByDay', (select jsonb_agg(jsonb_build_object('day', g.day, 'seconds', coalesce(lt.seconds, 0)) order by g.day)
                    from (select (_ist_today() - i) as day from generate_series(0, 13) i) g
                    left join lt on lt.day = g.day),
    'topSongs', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, max(song_image) as image, count(*) as plays
        from ev where kind = 'play' and song_title is not null
        group by 1, 2 order by plays desc limit 12) t), '[]'::jsonb),
    'topArtists', coalesce((select jsonb_agg(t) from (
        select song_artist as artist, count(*) as plays
        from ev where kind = 'play' and song_artist is not null
        group by 1 order by plays desc limit 10) t), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(language, ''), 'unknown') as language, count(*) as plays
        from ev where kind = 'play' group by 1 order by plays desc limit 10) t), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(t) from (
        select at, song_id as "songId", song_title as title, song_artist as artist, song_image as image, language, platform
        from ev where kind = 'play' order by at desc limit 200) t), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(t) from (
        select id, at, kind, message, status, platform, app_version as "appVersion"
        from feedback where listener_id in (select id from d) order by at desc limit 50) t), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(t) from (
        select at, kind, song_title as title, song_artist as artist, error_kind as "errorKind", message, platform, app_version as "appVersion", city
        from ev order by at desc limit 200) t), '[]'::jsonb)
  ) end;
$$;

-- Data & Privacy: delete one kind of data older than p_keep_days.
--   plays: usage events (everything but errors) · errors: app error reports
--   feedback: feedback messages · notifications: sent / cancelled notifications
create or replace function purge_kind(p_kind text, p_keep_days int) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint := 0; v_cut timestamptz := now() - make_interval(days => greatest(coalesce(p_keep_days, 180), 7));
begin
  if p_kind = 'plays' then
    delete from events where kind <> 'error' and at < v_cut; get diagnostics n = row_count;
  elsif p_kind = 'errors' then
    delete from events where kind = 'error' and at < v_cut; get diagnostics n = row_count;
  elsif p_kind = 'feedback' then
    delete from feedback where at < v_cut; get diagnostics n = row_count;
  elsif p_kind = 'notifications' then
    delete from notifications where at < v_cut and status in ('sent', 'cancelled'); get diagnostics n = row_count;
  else
    raise exception 'purge_kind: unknown kind %', p_kind using errcode = '22023';
  end if;
  return n;
end;
$$;

-- Version 15 — the extras on a person's profile: when in the day they
-- listen (24 India-time hours, last 30 days, from _listen_spans: the
-- listen_time rule), the songs they skip most (`skip` events: the app sends one
-- when a song is skipped early), the songs they come back to on the most
-- different days, and their latest searches (the app sends
-- "<results>|<query>"). The owner's note and tags come from owner_notes.
create or replace function profile_extras(p_account text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with d as (
    select l.id from listeners l
    where l.account_id = p_account or l.id = (select listener_id from accounts where id = p_account)
  ),
  ev as (select e.* from events e where e.listener_id in (select id from d)),
  spans as (
    select t.at, t.seconds
    from _listen_spans(coalesce((select array_agg(id) from d), array[]::text[]), now() - interval '30 days') t
  )
  select case when not exists (select 1 from accounts where id = p_account) then null else jsonb_build_object(
    'hours', (select jsonb_agg(jsonb_build_object('hour', h, 'seconds', coalesce(t.seconds, 0)) order by h)
              from generate_series(0, 23) h
              left join (select extract(hour from at at time zone 'Asia/Kolkata')::int as hour, sum(seconds)::bigint as seconds
                         from spans group by 1) t on t.hour = h),
    'skips', (select count(*) from ev where kind = 'skip'),
    'topSkipped', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, max(song_image) as image, count(*) as skips, max(at) as "lastAt"
        from ev where kind = 'skip' and song_title is not null
        group by 1, 2 order by skips desc, "lastAt" desc limit 10) t), '[]'::jsonb),
    'topReplayed', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, max(song_image) as image,
               count(distinct (at at time zone 'Asia/Kolkata')::date) as days, count(*) as plays, max(at) as "lastAt"
        from ev where kind = 'play' and song_title is not null
        group by 1, 2 having count(distinct (at at time zone 'Asia/Kolkata')::date) >= 2
        order by days desc, plays desc limit 10) t), '[]'::jsonb),
    'searches', coalesce((select jsonb_agg(t order by t.at desc) from (
        select at,
               case when message ~ '^[0-9]{1,9}[|]' then split_part(message, '|', 1)::int end as results,
               case when message ~ '^[0-9]{1,9}[|]' then substr(message, strpos(message, '|') + 1) else message end as query,
               platform
        from ev where kind = 'search' and message is not null
        order by at desc limit 100) t), '[]'::jsonb),
    'notes', (select jsonb_build_object('tags', to_jsonb(tags), 'note', note, 'updatedAt', updated_at, 'updatedBy', updated_by)
              from owner_notes where account_id = p_account)
  ) end;
$$;

-- Every tag the owner has used, with how many people carry it (the Tag filter).
create or replace function owner_tags() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t order by t.users desc, t.tag), '[]'::jsonb) from (
    select tag, count(*) as users from owner_notes, unnest(tags) tag group by 1) t;
$$;

-- One tap on a notification (counted from the app; ids are not secret, so
-- the count is a guide, not an audit).
create or replace function notification_opened(p_id bigint) returns void
language sql set search_path = public, pg_temp as $$
  update notifications set opened = opened + 1 where id = p_id and status = 'sent';
$$;

-- Listen Together: a guest's song request, appended atomically (no lost
-- writes when two guests ask at once), de-duplicated against the queue and
-- the existing requests, capped at the newest 20. Returns false when the room
-- does not exist.
create or replace function room_request(p_code text, p_song jsonb, p_by text) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare
  v_queue jsonb; v_requests jsonb; v_id text := coalesce(p_song ->> 'id', '');
begin
  select queue, requests into v_queue, v_requests from rooms where code = p_code for update;
  if not found then return false; end if;
  if v_id <> '' and (
       exists (select 1 from jsonb_array_elements(v_queue) e where e -> 'song' ->> 'id' = v_id)
    or exists (select 1 from jsonb_array_elements(v_requests) e where e -> 'song' ->> 'id' = v_id)) then
    return true;
  end if;
  v_requests := v_requests || jsonb_build_array(jsonb_build_object('song', p_song, 'by', nullif(p_by, ''), 'at', now()));
  if jsonb_array_length(v_requests) > 20 then
    v_requests := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
                   from (select e, i from jsonb_array_elements(v_requests) with ordinality t(e, i) order by i desc limit 20) s);
  end if;
  update rooms set requests = v_requests where code = p_code;
  return true;
end;
$$;

-- Rooms nobody touched for six hours, members not seen for a day.
create or replace function room_sweep() returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare n_rooms bigint; n_members bigint;
begin
  delete from rooms where updated_at < now() - interval '6 hours'; get diagnostics n_rooms = row_count;
  delete from room_members where last_seen < now() - interval '1 day'; get diagnostics n_members = row_count;
  return jsonb_build_object('rooms', n_rooms, 'members', n_members);
end;
$$;

-- Usage events older than p_keep_days go; the latest-state rows stay.
create or replace function purge_events(p_keep_days int default 180) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  delete from events where at < now() - make_interval(days => least(greatest(coalesce(p_keep_days, 180), 1), 3650));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Push devices that have not checked in for p_days are switched off (a
-- browser or phone that stopped opening the app).
create or replace function retire_push_devices(p_days int default 180) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  update push_devices set active = false
  where active and updated_at < now() - make_interval(days => least(greatest(coalesce(p_days, 180), 7), 3650));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- One status-page probe result: today's tally and the latest state.
create or replace function uptime_tick(p_component text, p_ok boolean, p_latency_ms int) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into uptime_days (component, day, up, total)
    values (p_component, (now() at time zone 'utc')::date, case when p_ok then 1 else 0 end, 1)
    on conflict (component, day) do update
      set up = uptime_days.up + excluded.up, total = uptime_days.total + 1;
  insert into uptime_latest (component, ok, latency_ms, checked_at)
    values (p_component, p_ok, p_latency_ms, now())
    on conflict (component) do update
      set ok = excluded.ok, latency_ms = excluded.latency_ms, checked_at = excluded.checked_at;
end;
$$;

-- The status page in one call: per component, the latest probe and the daily
-- tallies of the window.
create or replace function uptime_report(p_days int default 90) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'component', c.component,
      'ok', l.ok, 'latencyMs', l.latency_ms, 'checkedAt', l.checked_at,
      'uptime', (select round(sum(up)::numeric * 100 / nullif(sum(total), 0), 2) from uptime_days d
                 where d.component = c.component and d.day >= current_date - _days(p_days)),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'up', up, 'total', total) order by day)
                        from uptime_days d where d.component = c.component and d.day >= current_date - _days(p_days)), '[]'::jsonb)
    )), '[]'::jsonb)
  from (select distinct component from uptime_latest union select distinct component from uptime_days) c
  left join uptime_latest l on l.component = c.component;
$$;

-- Table sizes for the Database page (row counts are the planner's estimate).
create or replace function table_stats() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'rows', greatest(c.reltuples, 0)::bigint,
      'bytes', pg_total_relation_size(c.oid)
    ) order by c.relname), '[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
$$;

-- Exact counts for the small tables (cheap) and the estimate for the big ones.
create or replace function table_counts() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'listeners', (select count(*) from listeners),
    'accounts', (select count(*) from accounts),
    'account_backups', (select count(*) from account_backups),
    'profiles', (select count(*) from profiles),
    'follows', (select count(*) from follows),
    'shared_playlists', (select count(*) from shared_playlists),
    'feedback', (select count(*) from feedback),
    'blocked_content', (select count(*) from blocked_content),
    'rooms', (select count(*) from rooms),
    'room_members', (select count(*) from room_members),
    'push_devices', (select count(*) from push_devices),
    'notifications', (select count(*) from notifications),
    'settings', (select count(*) from settings),
    'experiments', (select count(*) from experiments),
    'audit_log', (select count(*) from audit_log),
    'admins', (select count(*) from admins),
    'error_status', (select count(*) from error_status),
    'job_runs', (select count(*) from job_runs),
    'ai_conversations', (select count(*) from ai_conversations),
    'ai_messages', (select count(*) from ai_messages),
    'ai_shares', (select count(*) from ai_shares),
    'ai_projects', (select count(*) from ai_projects),
    'ai_memories', (select count(*) from ai_memories),
    'personal_taste', (select count(*) from personal_taste),
    'personal_pages', (select count(*) from personal_pages),
    'events', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.events'::regclass),
    'personal_events', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.personal_events'::regclass),
    'personal_songs', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.personal_songs'::regclass),
    'personal_exposure', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.personal_exposure'::regclass),
    'personal_colisten', (select greatest(reltuples, 0)::bigint from pg_class where oid = 'public.personal_colisten'::regclass)
  );
$$;

-- Version 17 — the owner's weekly summary email (Monday morning): the last
-- seven whole days in India time (Monday to Sunday when sent on a Monday)
-- next to the seven before. p_to is the first day AFTER the week (default
-- today). Signed-in people only, like the rest of the console; app errors
-- count every report. `atRisk` is the At Risk page's own count (stats_at_risk,
-- version 14: quiet 7+ days after 2 h or 5 active days in the 30 days before),
-- as of now, whatever week p_to names.
create or replace function weekly_summary(p_to date default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with b as (
    select coalesce(p_to, _ist_today()) as d_to,
           (coalesce(p_to, _ist_today()) - 7)::timestamp at time zone 'Asia/Kolkata' as t_from,
           coalesce(p_to, _ist_today())::timestamp at time zone 'Asia/Kolkata' as t_to,
           (coalesce(p_to, _ist_today()) - 14)::timestamp at time zone 'Asia/Kolkata' as t_prev
  ),
  s as (select * from signed_devices()),
  ev as (
    select e.kind, e.at, e.song_title, e.song_artist, s.account_id, (e.at >= b.t_from) as cur
    from events e join s on s.listener_id = e.listener_id, b
    where e.at >= b.t_prev and e.at < b.t_to
  ),
  lt as (
    select s.account_id, t.day, t.seconds
    from listen_time(null, (select (d_to - 38)::timestamp at time zone 'Asia/Kolkata' from b)) t
    join s on s.listener_id = t.listener_id
  )
  select jsonb_build_object(
    'from', (select d_to - 7 from b),
    'to', (select d_to - 1 from b),
    'newUsers', (select count(*) from accounts, b where created_at >= b.t_from and created_at < b.t_to),
    'newUsersPrev', (select count(*) from accounts, b where created_at >= b.t_prev and created_at < b.t_from),
    'totalUsers', (select count(*) from accounts, b where created_at < b.t_to),
    'activeUsers', (select count(distinct account_id) from ev where cur),
    'activeUsersPrev', (select count(distinct account_id) from ev where not cur),
    'plays', (select count(*) from ev where cur and kind = 'play'),
    'playsPrev', (select count(*) from ev where not cur and kind = 'play'),
    'listenSeconds', (select coalesce(sum(seconds), 0) from lt, b where day >= b.d_to - 7 and day < b.d_to),
    'listenSecondsPrev', (select coalesce(sum(seconds), 0) from lt, b where day >= b.d_to - 14 and day < b.d_to - 7),
    'topSongs', coalesce((select jsonb_agg(t) from (
        select song_title as title, song_artist as artist, count(*) as plays, count(distinct account_id) as people
        from ev where cur and kind = 'play' and song_title is not null
        group by 1, 2 order by plays desc, people desc limit 5) t), '[]'::jsonb),
    'topArtists', coalesce((select jsonb_agg(t) from (
        select song_artist as artist, count(*) as plays, count(distinct account_id) as people
        from ev where cur and kind = 'play' and song_artist is not null
        group by 1 order by plays desc, people desc limit 5) t), '[]'::jsonb),
    'atRisk', (stats_at_risk(7, 1) ->> 'total')::int,
    'errors', (select count(*) from events, b where kind = 'error' and at >= b.t_from and at < b.t_to),
    'errorsPrev', (select count(*) from events, b where kind = 'error' and at >= b.t_prev and at < b.t_from),
    'feedback', (select count(*) from feedback, b where at >= b.t_from and at < b.t_to)
  );
$$;

-- --------------------------------------------------------- 12. security --

do $$
declare t text;
begin
  foreach t in array array[
    'meta', 'listeners', 'accounts', 'sign_ins', 'account_backups', 'profiles', 'follows', 'shared_playlists',
    'events', 'feedback',
    'blocked_content', 'rooms', 'room_members', 'push_devices', 'notifications',
    'settings', 'settings_history', 'experiments', 'audit_log', 'uptime_days', 'uptime_latest', 'job_runs',
    'admins', 'error_status',
    'ai_conversations', 'ai_messages', 'ai_attachments', 'ai_daily_usage', 'ai_shares', 'ai_projects', 'ai_memories', 'ai_memory_prefs',
    'personal_songs', 'personal_events', 'personal_taste', 'personal_exposure', 'personal_pages', 'personal_colisten',
    'owner_notes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on directory from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_days', 'signed_devices', '_ist_today', '_error_shape', 'admin_users', 'admin_user_filters', 'user_profile', 'purge_kind', 'notification_opened', 'stats_overview', 'stats_timeline', 'stats_music', 'stats_geo', 'stats_platforms',
                        'stats_engagement', 'stats_retention', '_device_key', 'listen_time', '_listen_spans', '_window_start', 'stats_top_listeners', 'stats_at_risk', 'stats_listening', 'stats_funnel', 'stats_skips', 'stats_errors', 'stats_trending', 'stats_searches',
                        'listener_profile', 'delete_listener', 'room_request', 'room_sweep',
                        'purge_events', 'retire_push_devices', 'uptime_tick', 'uptime_report', 'table_stats', 'table_counts',
                        'ai_conversation_search', 'ai_artifact_list', 'ai_export', 'ai_take_daily',
                        'personal_record_events', 'personal_recompute_vector', 'personal_neighbours', 'personal_similar_songs',
                        'personal_colisten_for', 'personal_refresh_colisten', 'personal_trending', 'personal_embed_backlog', 'personal_set_embeddings', 'personal_mark_shown',
                        'personal_touch_songs', 'personal_unverified', 'personal_exposure_for',
                        'personal_erase', 'personal_purge', 'personal_stats',
                        'profile_extras', 'owner_tags')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- Anything created later in this schema starts locked too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ------------------------------------------------------------- version --
insert into meta (key, value, updated_at)
  values ('schema', jsonb_build_object('version', 17, 'appliedAt', now()), now())
  on conflict (key) do update set value = jsonb_build_object('version', 17, 'appliedAt', now()), updated_at = now();

select 'VinaX schema version 17 applied' as done, (select count(*) from pg_tables where schemaname = 'public') as tables;
