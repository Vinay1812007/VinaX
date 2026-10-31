# Database

VinaX 14.0 brings back a server database, designed from a clean sheet: one schema file, plain table names, a small typed data layer in the Worker, and an owner console that reads it. This document is the reference for all three and the contract the console and the Worker agree on.

## Setting it up

1. Create a Supabase project (any region; Mumbai is closest to most listeners).
2. SQL Editor, paste `backend/supabase/schema.sql` (schema version 5), Run. It is idempotent; re-running it never deletes data. `backend/supabase/reset.sql` wipes everything, for starting over.
3. Set two Worker secrets from `backend/`:

```sh
npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
```

4. Open the console's **Database** page: it shows the schema version the paste wrote and every table.

### Moving from version 4

Version 5 adds `ai_daily_usage` and the function `ai_take_daily`: the daily allowances VinaX AI's web search shares across every Worker. These are the search API calls (`SEARCH_DAILY_LIMIT`) and Google Search grounding (450 a day). Paste `schema.sql` once; nothing that exists changes.

### Moving from version 3

Version 4 adds the VinaX AI tables `ai_conversations`, `ai_messages` and `ai_attachments`, the functions `ai_conversation_search` and `ai_export`, and their row-level security. It changes nothing that exists. Paste `schema.sql` once in the SQL Editor; the Database page then shows version 4. These names are new: the old AI tables `ai_calls` and `shared_chats` are not reused.

### Moving from version 2

Version 3 no longer creates the AI tables `ai_calls` and `shared_chats` or the functions `stats_ai` and `ai_usage_since`, because VinaX has no AI features any more. `schema.sql` never deletes data, so a database that ran version 2 still holds them. To remove them, run `backend/supabase/remove-ai.sql` once, by hand, in the SQL Editor after applying version 3. It deletes every row of those two tables and nothing else, and is safe to re-run. The Schema workflow below never runs it.

### From CI instead of the SQL editor

The **Schema** workflow (`.github/workflows/schema.yml`) can apply `schema.sql` for you. It is inert until a `SUPABASE_DB_URL` secret exists:

1. Supabase dashboard → Project Settings → Database → Connection string. Take the **session pooler** URI (`aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<project ref>`), not the direct host: GitHub's runners have no IPv6 and `db.<ref>.supabase.co` is IPv6-only.
2. GitHub → Settings → Secrets and variables → Actions → new secret `SUPABASE_DB_URL` with that URI and the database password (URL-encode special characters). The job runs in the `production` environment, so required reviewers can be set on it.
3. Every push to `main` that touches `backend/supabase/**` then applies the schema, after the check below is green. **Actions → Schema → Run workflow** with *apply* ticked does the same by hand.

The same workflow runs a **check** on every pull request that touches the schema, with no secrets: a fresh Postgres 16 gets `schema.sql` twice (it must stay idempotent), then `check.sql`, then `reset.sql` and `schema.sql` and `check.sql` again. `backend/supabase/check.sql` seeds a few rows, calls every function with assertions on the answers, proves the constraints and the row-level security, and rolls back. Locally:

```sh
backend/supabase/ci.sh check postgresql://postgres:postgres@localhost:5432/scratch   # a throwaway database
backend/supabase/ci.sh apply "$SUPABASE_DB_URL"                                       # the real one (schema.sql only)
```

`apply` only ever runs `schema.sql`; `reset.sql` and `check.sql` are never run against the production database by the workflow.

Only the Worker holds the service-role key. Row-level security is enabled and forced on every table with no policy, so the project's public anon key can read and write nothing. The app and the console never talk to the database directly.

## Tables

| Table | One row per | Holds |
| --- | --- | --- |
| `meta` | fact | `schema` → `{ version, appliedAt }` |
| `listeners` | device that opted in | display name, handle (unique, lower-case), platform, app version, edge country/region/city, what is playing now, first/last seen |
| `accounts` | Google sign-in | Google subject id, email, name, picture, the linked `listener_id`, sign-in platform/version/geo, created/last seen |
| `account_backups` | signed-in account | the app's backup JSON (`payload`), `version`, `bytes`; deleted with the account |
| `profiles` | signed-in account (15.0) | opt-in public profile: `handle` (unique, case-insensitive), `public`, `bio`, `summary` (the device's digest), `now_playing`, `share_now`; deleted with the account |
| `follows` | account → account (15.0) | `follower_id`, `followee_id`; no self-follow; both sides cascade |
| `shared_playlists` | signed-in account (15.0) | `name`, `songs` (display fields, ≤ 500), `public`, `collab_token` (invite secret), `version` for merges; deleted with the account |
| `events` | consented usage event | `kind` (play, pause, heartbeat, open, error, search, skip, favorite, share, rec_served…), song facts, language, platform, geo, error kind/message, `meta` (≤ 2 KB), `verified` |
| `feedback` | message from a listener | kind (bug/idea/content/other), message, platform, geo, `status` (new/read/resolved), owner `note` |
| `blocked_content` | blocked thing | `kind` (song/artist/keyword), `value`, `label`, `reason`; unique per kind + value |
| `rooms` | Listen Together room | `code`, `host_token`, host name, `current`, `queue` (≤ 12), `requests` (≤ 20), position, playing |
| `room_members` | member of a room | name, last seen, reaction + time; cascade with the room |
| `push_devices` | device that can receive a push | `channel` (web/fcm), `target` (endpoint or token, unique), web keys, lang, geo, `tz_offset`, `active`, last pushed |
| `notifications` | push the owner or a job sent | title, body, link, `audience` filter, web/fcm totals, failures, `dedupe_key`, `retracted_at` |
| `settings` / `settings_history` | published setting | `key` → JSON `value`, who and when; every change also appended to history |
| `experiments` | A/B experiment | key, name, `variants` `[{ name, pct }]`, active |
| `audit_log` | owner action | actor, action, target, summary, redacted before/after, request id |
| `uptime_days` / `uptime_latest` | status probe | per component: daily up/total tallies and the latest probe |
| `job_runs` | scheduled job run | job, started/finished, ok, summary |
| `ai_conversations` | VinaX AI chat | `account_id`, `title`, `starred`, `model_pref`, `active_leaf_id` (the branch a reload opens), `deleted_at` (hidden; purged a day later); deleted with the account |
| `ai_messages` | message in a chat | `parent_id` (a tree: an edit or a retry adds a sibling), `role` (user/assistant), `content` (parts), `thinking`, `thinking_ms`, `sources`, `artifacts`, `model_id`, `provider`, `stop_reason`, `usage`; cascade with the chat |
| `ai_daily_usage` | UTC day × kind | VinaX AI's shared daily allowances (`search`, `grounding`): `count` taken so far; rows older than 90 days are removed by the hourly housekeeping |
| `ai_attachments` | file added to a chat | `name`, `mime`, `size`, `storage_path` (private bucket `ai-attachments`), `extracted_text`, `pages`; deleted with the account (used from phase 4) |

The view `directory` merges `listeners` and `accounts` into one row per person (device rows with their account when linked, plus account-only rows).

### Functions

All `security invoker`, executable by the service role only. Each answers JSON shaped for the console.

| Function | Answers |
| --- | --- |
| `stats_overview()` | the Overview tiles: activeNow, listeners, newListeners24h, accounts, newAccounts7d, plays24h, plays7d, errors24h, dau, wau, mau, feedbackNew, pushDevices, roomsActive |
| `stats_timeline(days)` | `[{ day, plays, listeners, newListeners, errors, searches }]`, every day present |
| `stats_music(days, limit)` | `{ songs, artists, languages, rising }` |
| `stats_geo(days)` | `{ countries, cities }` |
| `stats_platforms()` | `{ platforms: [{ platform, listeners, accounts }], versions: [{ platform, appVersion, listeners }] }` |
| `stats_engagement(days)` | `{ byKind, byPlatform, hourly: { cells[7][24], peak }, segments, total }` (hours in IST) |
| `stats_retention(weeks)` | `[{ week, size, d1, d7, d30 }]` |
| `stats_funnel(days)` | `[{ id, label, listeners }]` |
| `stats_skips(days, min)` | `[{ id, title, artist, image, plays, skips, rate }]` |
| `stats_errors(days, limit)` | `{ total, byDay, top: [{ errorKind, message, hits, lastSeen, platforms, versions }] }` |
| `listener_profile(listener, account)` | `{ listener, account, backup, stats, topSongs, languages, events }` |
| `delete_listener(listener, account)` | removes the person everywhere; answers the counts |
| `room_request(code, song, by)` | atomic guest request append (false = no such room) |
| `room_sweep()` | drops rooms idle 6 h and members unseen 1 day |
| `purge_events(keepDays)` | deletes old usage events; answers the count |
| `retire_push_devices(days)` | switches off devices that stopped checking in |
| `uptime_tick(component, ok, latencyMs)` / `uptime_report(days)` | the status page's history |
| `table_stats()` / `table_counts()` | sizes and counts for the Database page |
| `ai_take_daily(kind, limit)` | takes one from today's allowance of `kind`: true when taken, false once `limit` is used (or when it is 0); atomic, so every isolate shares one count |
| `ai_export(account)` | every VinaX AI chat of one account with all its messages (every branch), newest first, as the file `GET /api/ai/export` downloads; deleted chats left out |
| `ai_conversation_search(account, query, before, limit)` | one account's VinaX AI chats whose title or message text contains `query` (wildcards escaped), newest first |

## The Worker's data layer

`backend/worker/functions/_lib/db.ts`:

```ts
import { db, q, like, dbConfigured } from '../_lib/db';

const r = await db.select<Row>(env, 'feedback', q().eq('status', 'new').order('at', 'desc').limit(50));
if (!r.ok) return dbFailure(r);          // r.error: not_configured | unauthorized | not_found | conflict | bad_request | unavailable
r.rows
await db.insert(env, 'events', row);
await db.upsert(env, 'listeners', row, 'id');
await db.update(env, 'feedback', q().eq('id', id), { status: 'read' }, { returning: true });
await db.remove(env, 'rooms', q().eq('code', code));
await db.count(env, 'events', q().eq('kind', 'play'));
await db.rpc<Overview>(env, 'stats_overview');
```

Every call answers a result and never throws; every request has an 8 s deadline; a `limit` above 1000 is paged. `q()` encodes every value; `like()` escapes text for `ilike` patterns.

Companions in `_lib/`:

| File | Role |
| --- | --- |
| `edge.ts` | edge geo, platform/version headers, `clip`, `intIn`, `daysParam`, `songFacts`, `jsonResponse` |
| `identity.ts` | device identity: signed ids (`signed_device_id` in, `signed_device_id_next` out), `d_…` ids derived from the install id, fresh `r_…` ids |
| `settings.ts` | `SETTING_KEYS` (the whole vocabulary), `readSettings` (memoised a minute), `setting`, `settingsMap`, `writeSetting` (with history) |
| `audit.ts` | `audit(ctx, { action, summary, target, before, after })` with secret redaction |
| `admin.ts` | `isAdminAsync`, `adminJson`, `notConfigured()`, `dbFailure(fail)`, `badRequest()` |

### Rules every route follows

- A **public** route with no database answers the shape the app already handles (`503 not_configured` for rooms, feedback and push registration; empty lists for the blocklist, experiments, announcements; defaults for config; `unavailable` for account sync).
- An **admin GET** with no database answers `200 { configured: false }`; a failed database call answers `502 { configured: true, error: 'db_<reason>' }` so the console never shows a zero for a failure. An **admin POST** with no database answers `503 { error: 'db_not_configured' }`.
- Every admin write goes through `audit()`.
- Admin routes are POST-only for writes (`{ action, … }` bodies); the console has no PUT/DELETE.
- Geo is the edge's; the body is never trusted for it. Device ids come from `identity.ts`, never raw from the body.

## Admin API

All under `/api/admin/`, gated by `isAdminAsync`. `?days=` is 1..90 (default 7).

| Route | GET answers | POST actions |
| --- | --- | --- |
| `overview` | `{ configured, schema, kpis, timeline[14], platforms, attention: [{ level, text, page, tab }] }` | — |
| `live` | `{ configured, now, listening: [{ id, name, handle, platform, country, city, song, isPlaying, lastSeen }], feed: [{ at, kind, listener, song, message, platform, country }], rooms: [{ code, hostName, members, song, playing, updatedAt, createdAt }] }` | `end_room { code }`, `end_all_rooms` |
| `listeners` | list `?q=&platform=&days=&limit=&offset=` → `{ configured, total, rows: directory rows camel-cased, counts: { listeners, accounts, byPlatform } }`; profile `?id=<listener>` or `?account=<sub>` → `{ configured, profile }` (`listener_profile`) | `delete { id?, account?, reason }` |
| `analytics` | `?view=music|geo|engagement|retention|funnel|skips|errors` → `{ configured, days, view, data }` where `data` is the matching function's answer (engagement also carries `timeline` and `platforms`) | `clear_errors` |
| `feedback` | `?status=new|read|resolved|all&kind=&limit=&offset=` → `{ configured, total, counts: { new, read, resolved }, rows }` | `status { id, status, note? }`, `delete { id }`, `delete_resolved` |
| `content` | `{ configured, blocked: [...], suggestions: [{ id, title, artist, image, plays }] }` | `block { kind, value, label?, reason? }`, `unblock { id }` |
| `settings` | `{ configured, keys: SETTING_KEYS, values, updated: { key: { at, by } } }`; `?key=` → `{ configured, key, value, updatedAt, updatedBy, history: [{ at, by, value }] }` | `{ key, value }` (null clears) → `{ ok, key, value, updatedAt }`; `400 unknown_key`, `413 too_large` |
| `experiments` | `{ configured, rows }` | `save { key, name, variants, active }`, `delete { key }` |
| `push` | `{ configured, web: { configured, active }, fcm: { configured, active }, geo: { countries, regions, cities }, langs, rules }` | send `{ title, body, link, filter: { country?, region?, city?, lang?, channel? }, activity?, dryRun?, dedupeKey? }` → dry run `{ dryRun: true, web, fcm, audience }`; send `{ ok, id, web: { total, sent, gone, failed }, fcm: { total, sent, failed }, audience }`; `409 duplicate` |
| `notifications` | `?limit=` → `{ configured, rows }` | `retract { id }` |
| `audit` | `?limit=&action=` → `{ configured, rows }` | — |
| `database` | `{ configured, reachable, schema, tables: [{ name, rows, bytes }], counts, jobs: [{ job, schedule, lastAt, ok, summary, overdue }], retention: { eventsDays }, missing: [] }` | `purge_events { days }`, `sweep_rooms`, `retire_push { days }`, `run_job { job }` |
| `envcheck` | unchanged shape; now lists `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required) and `CRON_SECRET` (optional) | — |

## Public routes that read or write it

| Route | Behaviour |
| --- | --- |
| `POST /api/events` | consent header required; resolves the device (`identity.ts`), writes an `events` row and upserts the `listeners` row; answers `204`, or `200 { signed_device_id_next }` on first contact |
| `POST /api/feedback` | writes `feedback`; `{ ok: true }` |
| `GET/POST /api/room` | rooms and members; the host token authorises `update` and `end`; guests `request`, `react`, `heartbeat`, `leave` |
| `POST /api/push/subscribe`, `fcm-register`, `unsubscribe` | `push_devices` rows (channel web / fcm) |
| `POST /api/auth/google`, `GET/POST /api/auth/me` | `accounts` row written at sign-in and refreshed on the session check (10 min); `delete: true` removes the account and its backup |
| `GET/PUT /api/account/data` | `account_backups` with optimistic versions: `200`, `204`, `409 { version, updatedAt, backup }` |
| `GET/PUT/DELETE /api/profile`, `GET /api/profile/<handle>` | `profiles` (+ `follows` for counts and private visibility) |
| `GET/POST /api/follow` | `follows`, `profiles`, `accounts` (name, picture) |
| `GET/POST/DELETE /api/shared-playlist`, `GET/POST /api/shared-playlist/<id>` | `shared_playlists`; collaborator writes need the invite token; owner writes `409 { playlist }` on a stale version |
| `GET/POST /api/username` | the handle on `listeners`; `409 taken` with suggestions |
| `GET /api/experiments` | active experiments |
| `GET /api/announcements` | the `announcement` setting (ignored when retracted) |
| `GET /api/appconfig?key=client|banners|festival|flags` | settings, sanitised by `clientConfig.ts` |
| `GET /api/blocklist` | `blocked_content` as `{ ids, artists, keywords }` |
| `GET /api/site-mode` | the `site-mode` setting plus the maintenance window → `{ mode, note }` |
| `GET /api/status` | live probes plus `uptime_report(90)` and the `status-note` setting |

## Scheduled jobs

The Worker's Cron Trigger (`[triggers] crons` in `wrangler.toml`) fires every 30 minutes; `_lib/jobs.ts` decides what runs and records every run in `job_runs`:

| Job | When | Does |
| --- | --- | --- |
| `status-tick` | every run | probes website, catalogue, admin; `uptime_tick` per component |
| `housekeeping` | once an hour | `room_sweep`, `purge_events(retention.eventsDays)`, `retire_push_devices(180)`, and removes VinaX AI chats deleted more than a day ago (not fatal before schema 4 is applied) |

`POST /api/cron/run { job }` with `x-cron-secret: $CRON_SECRET` (or the owner token) runs a job now; the Database page has a button for it.

## Privacy

Stored: coarse edge geo, anonymous device ids, display names and handles the listener chose, Google profile basics for signed-in listeners, the synced backup, song facts for plays. Not stored: IP addresses, precise location. Usage events are purged after `retention.eventsDays` (default 180). VinaX AI chats are stored with the account and removed with it. A listener's **Delete my data** removes the account, its backup, its VinaX AI chats and the device row; the console's delete removes everything about one person.
