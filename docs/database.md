# Database

VinaX 14.0 brings back a server database, designed from a clean sheet: one schema file, plain table names, a small typed data layer in the Worker, and an owner console that reads it. This document is the reference for all three and the contract the console and the Worker agree on.

## Setting it up

1. Create a Supabase project (any region; Mumbai is closest to most listeners).
2. SQL Editor, paste `backend/supabase/schema.sql` (schema version 12), Run. It is idempotent; re-running it never deletes data. `backend/supabase/reset.sql` wipes everything, for starting over.
3. Set two Worker secrets from `backend/`:

```sh
npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
```

4. Open the console's **Database** page: it shows the schema version the paste wrote and every table.

### Moving from version 11

Version 12 adds one table, `sign_ins`: a row per Google sign-in to the app (time, IP address, browser, platform and version, edge geo, `signup`, `new_device`), written by `POST /api/auth/google`, deleted after 90 days by the housekeeping job and with its account (`on delete cascade`). It is the only table that holds an IP address ([data-and-privacy.md](data-and-privacy.md)). Paste `schema.sql` once (or let the Schema workflow apply it); the Database page then shows version 12. Until then sign-ins are simply not recorded (the insert fails quietly), the profile's Sign-ins tab is empty, and the console shows its "one-time update" note; sign-in itself keeps working.

### Moving from version 10

Version 11 adds two functions for the console's **Trending** and **Search & Library** pages ([admin-console.md](admin-console.md)); it changes no table and deletes nothing. Paste `schema.sql` once (or let the Schema workflow apply it); the Database page then shows version 11. Until then those two pages say the database needs its one-time update (`502 db_update_needed`) and every other page keeps working.

- `stats_trending(days, limit)` compares the songs, artists and languages signed-in users played in the window with the window of the same length just before it: plays, people, rank now and rank before (null = a new entry) and, for songs, one count per India calendar day.
- `stats_searches(days, limit)` reads search events (their `message` is `'<song results>|<query>'`, as the app's search writes it) and answers the totals, the most searched words, the searches that found nothing, what is searched more than before, and a daily series. Rows without that shape are left out.

### Moving from version 9

Version 10 comes with the rebuilt owner console ([admin-console.md](admin-console.md)). Paste `schema.sql` once (or let the Schema workflow apply it); nothing is deleted and the Database page then shows version 10. Apply it before or together with the Worker that uses it: until then the console shows an owner a "database update needed" banner, and the pages that call the new functions say so instead of loading.

- **The console counts signed-in people only.** `signed_devices()` lists every device that belongs to a Google account; `stats_overview`, `stats_timeline`, `stats_music`, `stats_geo`, `stats_platforms`, `stats_engagement`, `stats_retention` and `stats_skips` now count only those (people, not devices), and days follow India's calendar (`_ist_today()`). Anonymous `listeners` rows and their events stay in the database; they are only left out of these answers. App errors still count every report. `stats_funnel` is the sign-up journey (opened the app, played, signed in, came back) and returns aggregate numbers only.
- **New tables:** `admins` (who may open the console: email, role owner / editor / viewer, invited by, last sign-in) and `error_status` (the owner's status for one group of app errors).
- **New columns:** `push_devices.account_id` (the signed-in account on that device), `notifications.status` / `scheduled_for` / `image` / `opened` / `created_by` (drafts, scheduled sends, taps), `blocked_content.blocked_by` and the `album` kind, `experiments.description` / `status` / `audience` / `started_at` / `ended_at` / `winner`, `accounts.blocked_at`, `listeners.signed_out_at`.
- **New functions:** `admin_users` (the Users page: filters, sort, paging and counts on the server), `admin_user_filters`, `user_profile` (one person across all their devices), `purge_kind` (Data & Privacy retention per kind of data), `notification_opened`, `_error_shape` (groups similar error messages).
- **Storage:** a public bucket `console-media` for pictures uploaded in the console (banners, notification images). Supabase only.

### Moving from version 8

Version 9 adds VinaX AI projects ([ai.md](ai.md#projects)): the table `ai_projects` with its row-level security, a nullable `project_id` on `ai_conversations` (`on delete set null`: deleting a project keeps its chats unless the Worker deletes them first) and on `ai_attachments` (`on delete cascade`: a project's knowledge files go with it), and `ai_export` now also lists the projects. It deletes nothing and changes no existing row. Paste `schema.sql` once; the Database page then shows version 9. Apply it before deploying the Worker that uses it: until then every chat read answers `503 unavailable`, because the Worker asks for the new `project_id` column.

It also adds VinaX AI's memory ([ai.md](ai.md#memory)): the tables `ai_memories` (one row per note) and `ai_memory_prefs` (the listener's two switches), with their row-level security, and the column `ai_conversations.incognito` (default false). It changes nothing that exists. A Worker deployed before it keeps chatting: memory reads fail closed (no memory, no learning) and the incognito flag is read on its own query, but Settings → Memory answers `503 unavailable` until the schema is applied. It also adds the function `ai_artifact_list` (VinaX AI's artifacts gallery; it reads what replies already saved) and raises the `ai-attachments` bucket's file size limit from 20 MB to 50 MB, so the owner can allow larger PDFs. Paste `schema.sql` once; the Database page then shows version 9.

### Moving from version 7

Version 8 adds `ai_shares`, the shared VinaX AI chat links ([ai.md](ai.md#sharing)), with its row-level security. It changes nothing that exists. Paste `schema.sql` once; the Database page then shows version 8. Apply it before deploying the Worker that uses it, or Share answers `503 unavailable` for lack of its table (the chat itself keeps working). The name is new on purpose: the old `shared_chats` table from version 2 is not reused.

### Moving from version 6

Version 7 adds the personal engine ([personalisation.md](personalisation.md)): the tables `personal_songs`, `personal_events`, `personal_taste`, `personal_exposure`, `personal_pages` and `personal_colisten`, their functions (`personal_*`), and the `vector` extension the embeddings need (hosted projects ship it; the Schema workflow's scratch container uses an image that has it). It changes nothing that exists. Paste `schema.sql` once; the Database page then shows version 7. Apply it before deploying the Worker that uses it, or every `/api/personal/*` route answers `503 unavailable` for lack of its tables.

### Moving from version 5

Version 6 adds three columns to `ai_attachments`: `kind` (image, pdf or text), and `gemini_uri` with `gemini_expires_at` (the Gemini Files API copy of a PDF). It also creates the private Storage bucket `ai-attachments` that VinaX AI's files live in. The bucket is created only on Supabase, where the `storage` schema exists; a plain Postgres skips it. Paste `schema.sql` once; nothing that exists changes.

### Moving from version 4

Version 5 adds `ai_daily_usage` and the function `ai_take_daily`: the daily allowances VinaX AI's web search shares across every Worker. These are the search API calls (`SEARCH_DAILY_LIMIT`) and Google Search grounding (450 a day). Paste `schema.sql` once; nothing that exists changes.

### Moving from version 3

Version 4 adds the VinaX AI tables `ai_conversations`, `ai_messages` and `ai_attachments`, the functions `ai_conversation_search` and `ai_export`, and their row-level security. It changes nothing that exists. Paste `schema.sql` once in the SQL Editor; the Database page then shows version 4. These names are new: the old AI tables `ai_calls` and `shared_chats` are not reused.

### Moving from version 2

Version 3 no longer creates the AI tables `ai_calls` and `shared_chats` or the functions `stats_ai` and `ai_usage_since`, because they belonged to the AI features that were removed (VinaX AI, added later, has its own tables from version 4 onward). `schema.sql` never deletes data, so a database that ran version 2 still holds them. To remove them, run `backend/supabase/remove-ai.sql` once, by hand, in the SQL Editor after applying version 3. It deletes every row of those two tables and nothing else, and is safe to re-run. The Schema workflow below never runs it.

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
| `sign_ins` | each Google sign-in (schema 12) | account, time, IP address, browser, platform/version, edge geo, first sign-in / new device; 90 days, cascades with the account |
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
| `ai_conversations` | VinaX AI chat | `account_id`, `title`, `starred`, `model_pref`, `active_leaf_id` (the branch a reload opens), `project_id` (the project it is in, or null; set null when the project goes), `incognito` (never reads or writes memory), `deleted_at` (hidden; purged a day later); deleted with the account |
| `ai_projects` | VinaX AI project | `account_id`, `name` (1–60 characters), `description` (≤ 300), `instructions` (≤ 8,000: every chat in the project follows them), `starred`, `created_at`, `updated_at`; its knowledge files are `ai_attachments` rows with its `project_id`; deleted by its owner or with the account |
| `ai_messages` | message in a chat | `parent_id` (a tree: an edit or a retry adds a sibling), `role` (user/assistant), `content` (parts), `thinking`, `thinking_ms`, `sources`, `artifacts`, `model_id`, `provider`, `stop_reason`, `usage`; cascade with the chat |
| `ai_shares` | shared VinaX AI chat | `id` (22 base64url characters, 128 random bits: the link's key), `account_id`, `conversation_id` (unique: one link per chat), `title`, `messages` (the snapshot: `[{ role, text, files?: [{ name, kind }], sources?, createdAt }]`, no reasoning, no file contents), `message_count`, `bytes` (≤ 1,000,000), `created_at`, `updated_at` (the last snapshot); deleted on Stop sharing, with the chat, or with the account |
| `ai_memories` | a note in VinaX AI's memory | `id`, `account_id`, `text` (1–200 characters; the Worker keeps at most 50 per account), `origin` (`chat` learned, `user` added), `conversation_id` (the chat it was learned from; `on delete set null`, so the note outlives the chat), `created_at`, `updated_at`; deleted on Delete or Forget everything, or with the account |
| `ai_memory_prefs` | an account's memory switches | `account_id` (primary key), `use_memory`, `learn` (both default true; no row means both on), `updated_at`; deleted with the account |
| `ai_daily_usage` | UTC day × kind | VinaX AI's shared daily allowances (`search`, `grounding`): `count` taken so far; rows older than 90 days are removed by the hourly housekeeping |
| `personal_songs` | catalogue song the personal engine met | title, artist and `artist_id`, `artists`, album, language, year, duration, image, identity `key`, `facets` (mood, genre, vibe, energy, tempo), `verified` (the catalogue confirmed the row; a device-asserted row stays unverified and off every page until then), the `embedding` (1024 dimensions) with `embed_model` and `embedded_at`, community counters (`plays`, `completes`, `skips`, `likes`), first/last seen; no account attached |
| `personal_events` | event a signed-in listener's device reported | `account_id`, `at`, `kind` (play, complete, skip, like, unlike, dislike, save, queue, search_play, shown, radio_start), `song_id`, `heard_sec`, `duration_sec`, `source`, `context` (hour, dow, tz, shelf, position), `client_id` (unique per account: a retried batch inserts nothing twice); cascade with the account |
| `personal_taste` | signed-in account | the taste model: `vector` (+ `embed_model`), `artists`, `languages`, `facets`, `hours`, `songs` (score maps), `summary`, `mode` (familiar / balanced / discover), `events_seen`, `version` (rises with every fold; the update lands only while it is the version read); cascade with the account |
| `personal_exposure` | account × song | `shown`, `queued`, `played`, `completed`, `skipped` counts (a play resets the skips), `liked`, `disliked`, the `last_*` times (including `last_disliked`); cascade with the account |
| `personal_pages` | page the engine built | `kind` (home / playlist / radio), `prompt`, `page` (the whole answer with its song records), `taste_version`, `events_seen` (staleness), `model_id`, `composed` (the language model shaped it), `built_ms`, `expires_at`; cascade with the account |
| `personal_colisten` | song × partner song | `weight` (listeners who played both within an hour, last 30 days, a listener's last 150 plays; top 50 partners per song), rebuilt once a day |
| `ai_attachments` | file added to a chat | `name`, `mime`, `size`, `kind` (image / pdf / text), `project_id` (a project's knowledge file: no conversation, cascade with the project), `storage_path` (private bucket `ai-attachments`, at `<account>/<conversation or new>/<id>`, or `<account>/project-<project>/<id>`), `extracted_text` (a text file, or the text the page read out of a PDF), `pages`, `gemini_uri` / `gemini_expires_at` (the Gemini Files API copy of a PDF). The rows go with the account or the chat; the stored files are removed by the Worker first (account deletion, the console's delete, the hourly housekeeping), and files never sent are removed after a day (a project's files are not "never sent": they stay until removed) |

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
| `stats_trending(days, limit)` | version 11, Trending: `{ days, totals: { plays, prev_plays, listeners, prev_listeners, songs, new_songs }, songs: [{ id, title, artist, image, plays, prev_plays, listeners, rank, prev_rank, daily: [n per day] }], artists: [{ artist, plays, prev_plays, listeners, rank, prev_rank }], languages: [{ language, plays, prev_plays, listeners }] }`. The window starts at midnight India time `days - 1` days ago (1..90, limit 1..100); the one before is as long. `prev_rank` null = not played before |
| `stats_searches(days, limit)` | version 11, Search Insights: `{ days, totals: { searches, people, zero, queries, prev_searches, prev_people, prev_zero }, top: [{ query, searches, people, zero, prev_searches, last_at }], zero: [{ query, searches, people, found, last_at }], rising: [{ query, searches, prev_searches, people }], daily: [{ day, searches, zero }] }` from search events `'<results>\|<query>'` (malformed rows left out; `zero` = found no song; limit 1..200) |
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
| `ai_artifact_list(account, kind, query, before, before_key, limit)` | the VinaX AI artifacts gallery: one row per artifact id per chat of one account (its newest version and how many versions there are), deleted chats left out, by type and title (wildcards escaped), newest first, paged by time and key; metadata only, never the content |
| `personal_record_events(account, events)` | inserts the new events of a batch (a repeated `client_id` is skipped), updates the exposure rows and the community counters; answers `{ inserted: [client ids] }` |
| `personal_touch_songs(rows, verified)` | inserts songs the engine met; a known row only gains what it lacked unless the facts are verified (from the catalogue), which replace a device's version and verify the row; answers how many were new |
| `personal_unverified(limit)` / `personal_exposure_for(account, songs)` | the device-asserted rows awaiting confirmation / one account's exposure for a set of songs |
| `personal_recompute_vector(account, model, top)` | the taste vector from the account's strongest `top` songs embedded in `model`'s space; answers how many went in |
| `personal_neighbours(account, model, limit, languages, cooling)` | the verified songs nearest the taste vector, outside each kind's cooling window and never disliked, over a widened index scan: `(id, similarity, language, artist_id)` |
| `personal_similar_songs(song, model, limit)` | the songs nearest one song's embedding |
| `personal_colisten_for(songs, limit)` | co-listening partners of a set of songs, summed |
| `personal_refresh_colisten(days, cap)` | rebuilds `personal_colisten` from personal and anonymous plays; answers `{ pairs, since }` |
| `personal_trending(languages, days, limit)` | the verified songs the most listeners played in the window, in those languages (listeners, not plays) |
| `personal_embed_backlog(limit, model)` / `personal_set_embeddings(model, rows)` | verified songs without a vector in that model's space, oldest first / write vectors for many songs in one call |
| `personal_erase(account)` | everything the engine holds about one account; answers the counts |
| `personal_purge(keepDays)` | events past `keepDays` and pages a day past their expiry |
| `personal_stats()` | the console's Personal engine tab in one call |

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
| `trends` | `?view=trending&days=` → `{ configured, days, view, data }` (`stats_trending`); `?view=search&days=` → the same with `stats_searches`, plus `pins` and `synonyms`; `?view=pins` → `{ configured, pins, synonyms }` (settings only). An older database answers `502 db_update_needed` | editor: `pin { query, song: { id, title, artist, image } }`, `unpin { query }` (setting `search-pins`, at most 100), `synonym { typed, meant }` (adds to `search-synonyms`, at most 200) → `{ ok, key, value }`; `400 bad_query`, `bad_song`, `bad_synonym`, `too_many` |
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
| `GET/POST /api/ai/projects`, `GET/PATCH/DELETE /api/ai/projects/<id>` | `ai_projects`, with its chats (`ai_conversations.project_id`) and files (`ai_attachments.project_id`); owner only; delete removes the files and keeps the chats (or, with `?chats=delete`, hides them) |
| `GET/POST/DELETE /api/ai/memories`, `DELETE /api/ai/memories/<id>`, `GET/PUT /api/ai/memories/prefs` | `ai_memories`, `ai_memory_prefs`; the account's own rows only. `POST /api/ai/chat` reads both (and `ai_conversations.incognito`) for each reply and inserts or deletes notes after it |
| `GET/POST /api/ai/shares`, `GET/DELETE /api/ai/shares/<id>`, `POST /api/ai/shares/<id>/continue` | `ai_shares`; the owner lists, makes, updates and deletes; `GET` of one link is public (no session) by its 128-bit id; continue copies the snapshot into a new `ai_conversations` + `ai_messages` chat of the reader |
| `GET/POST /api/username` | the handle on `listeners`; `409 taken` with suggestions |
| `GET /api/experiments` | active experiments |
| `GET /api/announcements` | the `announcement` setting (ignored when retracted) |
| `GET /api/appconfig?key=client|banners|festival|flags` | settings, sanitised by `clientConfig.ts` |
| `GET /api/blocklist` | `blocked_content` as `{ ids, artists, keywords }` |
| `GET /api/site-mode` | the `site-mode` setting plus the maintenance window → `{ mode, note }` |
| `GET /api/status` | live probes plus `uptime_report(90)` and the `status-note` setting |

## Scheduled jobs

The Worker's Cron Trigger (`[triggers] crons` in `wrangler.toml`) fires every 5 minutes; `_lib/jobs.ts` decides what is due (each job's own `every`, from the `jobs` setting) and records every run in `job_runs`:

| Job | Default | Does |
| --- | --- | --- |
| `status-tick` | every 30 min | probes website, catalogue, admin; `uptime_tick` per component |
| `housekeeping` | hourly | `room_sweep`, `purge_events(retention.eventsDays)` (or `purge_kind` per kind), `retire_push_devices(180)`, removes VinaX AI chats deleted more than a day ago (not fatal before schema 4 is applied), `personal_purge(365)` and, on the first run from 21:00 UTC, `personal_refresh_colisten(30, 50)` (not fatal before schema 7); prunes `job_runs` older than 30 days |
| `personal-embed` | every 30 min | confirms up to 25 device-asserted songs with the catalogue, then embeds up to 200 verified songs that have no vector in the configured model yet; skipped while the engine is off |
| `alerts` | every 5 min | Smart Alerts (`_lib/alerts.ts`): counts `events` (errors, plays) and new `feedback`, probes the site, and for each firing rule writes one `notifications` row (`kind = 'system'`, `dedupe_key = 'alert:<rule>:<cooldown>:<bucket>'`) and pushes it to the chosen admins' phones; see admin-console.md → Smart Alerts |
| `scheduled-notifications` | every 5 min | sends `notifications` rows whose `scheduled_for` has come (`_lib/scheduledPush.ts`) |

`POST /api/cron/run { job }` with `x-cron-secret: $CRON_SECRET` (or the owner token) runs a job now; the Database page has a button for it.

## Privacy

Stored: coarse edge geo, anonymous device ids, display names and handles the listener chose, Google profile basics for signed-in listeners, the synced backup, song facts for plays, and — for signed-in listeners who keep the personal engine on — their reported listening events, taste model, exposure and composed pages. Not stored: precise location; an IP address only in `sign_ins` (schema 12, 90 days). Usage events are purged after `retention.eventsDays` (default 180); personal events after a year. VinaX AI chats are stored with the account and removed with it. A listener's **Erase my taste model** removes every `personal_*` row of theirs; **Delete my data** removes the account, its sign-in history, its backup, its VinaX AI chats, its personal-engine rows and the device row; the console's delete removes everything about one person.
