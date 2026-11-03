# Owner console

The owner console is served at `/admin/` (https://admin.vinaxmusic.online/admin/). The console rebuild (schema version 10) reorganised it for someone who has never seen the code: twenty pages in six groups, plain English everywhere, and no setting that needs JSON, an id, a version string or a raw address typed by hand. Every control is a dropdown, toggle, slider, date or time picker, search picker, drag-to-reorder list, checkbox, radio button, chip or "⋯" menu.

It counts **people signed in with Google** only. Anonymous devices (`listeners` rows without an account) stay in the database but never leave the API: the `stats_*` functions, the Users list, Live Now, the notification audience and the AI tester picker all filter on the server ([database.md](database.md#moving-from-version-8)). App errors are the one exception: every report counts.

| Group | Pages (route) |
| --- | --- |
| Home | Dashboard (`#/dashboard`), Live Now (`#/live`) |
| People | Users (`#/users`), Feedback (`#/feedback`) |
| Music | Song Stats (`#/song-stats`), Music Library (`#/library`) |
| Engage | Send Notification (`#/notifications`), A/B Tests (`#/ab-tests`) |
| App Settings | Home Screen, Features & AI, App Updates, Maintenance, Notification Rules, Search & Music Sources, Help Center, Data & Privacy (`#/app-settings/<page>`) |
| System | App Health (`#/health`), Database (`#/database`), Google Search (`#/google-search`), Admins & Roles (`#/admins`) |

Old addresses redirect (`#/overview` → Dashboard, `#/listeners` → Users, `#/publish` → App Settings › Home Screen, `#/notify` → Send Notification, `#/analytics` → Song Stats, `#/analytics/errors` → App Health › App Errors, `#/catalog` → Music Library, `#/experiments` → A/B Tests, `#/seo` → Google Search). Any other unknown address shows **Page not found** with a **Go to Dashboard** button.

## The three answers every page handles

| The server says | The page shows |
| --- | --- |
| `{ configured: false }` | A setup card: the database is not connected on the Worker |
| `502 { error: 'db_…' }` | "Could not load" in plain words with **Try again**. Never a zero. `db_update_needed` (a function or column the Worker expects is missing) means the database still runs an older `schema.sql`; owners also see a banner at the top of every page |
| Data, or an empty answer | The data; for an empty answer, a friendly empty state with a small picture and an action button |

## Files

The console is standalone static files in `frontend/public/admin/`, copied into the build unchanged. It never imports app code or app CSS.

| File | Role |
| --- | --- |
| `index.html` | Content security policy, icon sprite, sign-in screen, sidebar, top bar, one `<script>` per file and one stylesheet per area |
| `theme-boot.js` | Pre-paint: the stored theme (Light, Dark, Match my device) and the collapsed sidebar |
| `console.css` | Tokens (dark default, `html.light`), layout, shared components; `css/<area>.css` hold page styles (people, music, engage, system, settings-a, settings-b) |
| `core.js` | The framework, global `VX`: DOM builder, API client, formatting (Indian numbers, one time zone, India by default), base components, charts, page registry |
| `kit/controls.js` | The shared controls (below). Loaded right after `core.js` |
| `kit/settings.js` | The App Settings framework (below) |
| `festivals.js` | Generated festival calendar for the Festival Theme editor |
| `pages/*.js` | One file per page; each calls `VX.page({...})` or `VX.settingsPage({...})` |
| `app.js` | The shell. Loaded last |

Every script is a classic script with its own tag in `index.html`: `scripts/admin-stamp.mjs` adds `?v=<content hash>` to each listed URL at build time, and `public/_headers` marks every console file `no-cache`.

### Content security policy

```
default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/
```

The only outside script is Google's sign-in button. Pages build DOM only through `VX.h`, which makes text nodes; `innerHTML` and friends are banned (a unit test enforces it).

## Sign-in, roles and the change log

Admins sign in with **Google**. Only an email on the **Admins & Roles** list gets in, and the Worker checks the role on every request; hiding a button is never the check. Setup steps are under [System pages](#system-pages) below.

| Role | Can |
| --- | --- |
| Viewer | See everything, change nothing (every write answers `403 forbidden`; the page shows controls read-only with a note) |
| Editor | Change App Settings, send notifications, set feedback and error statuses, block and unblock music, run A/B tests, block users and sign devices out |
| Owner | Everything, including Database upkeep, Admins & Roles, clearing app errors and deleting a user's data |

Pieces: `_lib/adminAuth.ts` (console sessions `adm1.<payload>.<hmac>`, 12 hours; the role is read from `admins` and memoised a minute), `_lib/admin.ts` (`adminPrincipal`, `requireRole`, the recovery password with its brute-force lockout), `_lib/adminRoute.ts` (`adminGet` = any admin; `adminPost` = editor unless the route asks for owner, as a role or a function of the body). The owner recovery password (`ADMIN_LOGIN_PASSWORD`) still signs in as an Owner from a collapsed box on the sign-in screen; it opens by itself when Google sign-in is not set up. Delete the secret to allow Google only.

Every change leaves a row in `audit_log` through `_lib/audit.ts` with the admin's email as `actor` (`owner` for the recovery password and jobs). **Database › Change log** lists them with Admin, Action and Date range filters.

## Controls (`kit/controls.js`)

| API | What it is |
| --- | --- |
| `VX.me`, `VX.can('edit' \| 'owner')`, `ui.readOnlyNote()` | Who is signed in and what they may do |
| `ui.stats([{ label, value, info, delta, deltaLabel, inverse, sub, onClick }])` | Stat cards; `info` is the required ⓘ explanation in plain English |
| `ui.info(text)` | An ⓘ tooltip (hover, focus or tap) |
| `ui.menu(items, { label, text })` | The "⋯" action menu (keyboard, Escape) |
| `ui.dropdown`, `ui.radios`, `ui.checks`, `ui.checkbox`, `ui.slider`, `ui.switchRow`, `ui.chips` | Choice controls |
| `ui.sortable({ items, render, onChange })` | Drag to reorder, with ↑ ↓ buttons and arrow keys |
| `ui.picker`, `ui.userPicker`, `ui.musicPicker({ type })` | Search pickers (users by name or email; songs, albums, artists, playlists) |
| `ui.datePicker`, `ui.timePicker`, `ui.dateTimePicker`, `ui.dateRange`, `VX.time.*` | Pickers in the console's time zone |
| `ui.colorPicker`, `ui.imageUpload({ aspect, purpose })` | Colour, and a picture cropped in the browser then stored by `POST /api/admin/upload` in the public `console-media` bucket |
| `ui.phone(children)` | Phone mock-up for live previews |
| `ui.statusChip('live' \| 'builtin' \| 'unsaved')` | "Live in app", "Using app's built-in setting", "Unsaved changes" |
| `ui.dataTable({ columns, rows, rowMenu, bulk, filters, server, … })` | Search, filter dropdowns, click-to-sort, Columns menu, Rows per page (25 / 50 / 100), paging (client or server), checkbox bulk select with a "With selected" menu, a pinned "⋯" row menu, Export (CSV / Excel) |
| `ui.attention(items)` | "Needs your attention" with **Dismiss for today** |
| `ui.emptyState`, `ui.loadingCards`, `ui.notFound` | Friendly states; loading is a skeleton, never a blank screen |
| `VX.confirm({ typed: true })` | A confirm that needs `CONFIRM` typed (destructive actions) |

## The shell (`app.js`)

- Sidebar in six groups with the App Settings sub-menu; it collapses to icons on a laptop and becomes a menu on a phone. At the bottom: "Live site" (green) or "Test site" (amber) and the app version.
- Top bar: breadcrumb, global search (**Ctrl K** / ⌘K: pages, tabs, settings, users and songs), the date range (Today, Last 7 / 30 / 90 days, Custom) on pages that declare `range: true` (`ctx.range`), auto-refresh with an interval (15 s, 30 s, 1 min, 5 min), "Last updated 17:00 IST" and refresh, the theme (Light, Dark, Match my device), and the profile menu (email, role, time zone, sign out).
- Routes are `#/<page id>/<tab>?<params>`; page ids may contain a slash (`app-settings/home-screen`). `ctx.onLeave(fn)` guards unsaved changes: leaving asks first.
- Owners see a "One-time database update needed" banner while `meta.schema` is older than the Worker's `SCHEMA_WANTED`.

## The App Settings framework (`kit/settings.js`)

Each App Settings page is `VX.settingsPage({ id, title, sections })`; each section edits one key of the `settings` table through `POST /api/admin/settings { key, value }` (null = back to the app's built-in setting). Every section gets the status chip, **Save & apply** (with "Users will see this change within 1 minute. Continue?"), **Cancel changes**, **Reset to built-in setting**, an optional live preview, and **Change history** (the last 20 changes in plain words, each with **Restore this version**). A section supplies `fromValue`, `toValue`, `validate`, `describe`, `render`, optional `preview` and `confirmSave` (used for Maintenance mode and forced updates, which need `CONFIRM`).

## Adding a page

1. Create `frontend/public/admin/pages/<id>.js` calling `VX.page({ id, title, group, icon, order, desc, tabs | render, range })` (group is one of Home, People, Music, Engage, App Settings, System; icons are the sprite ids in `index.html` without `i-`), or `VX.settingsPage(...)` for a settings page.
2. Add its `<script>` to `index.html` before `app.js`.
3. Add the Worker route under `backend/worker/functions/api/admin/` with `adminGet` / `adminPost`, register it in `backend/worker/index.ts`, and add mocks to `frontend/e2e/support/console-mocks/` — the unit test and `e2e/console-pages.spec.ts` then cover it automatically.


## Pages

Each page below lists its tabs, the routes it calls and what each control writes. `?days=` is 1..90 wherever a page follows the date range.

### Home · Dashboard (`#/dashboard`)

The landing page. One call: `GET /api/admin/overview?days=1..90` (default 14). The page sends the top bar's date range: a preset sends its days, and a custom range asks for the days from its start to today and keeps only the chosen days.

The answer is `{ configured, schema, days, kpis, timeline, platforms, versions, attention, checkedAt }`:

- `kpis` comes from `stats_overview`, signed-in users only (errors count every report).
- `timeline` comes from `stats_timeline(days)`, using India's calendar days.
- `platforms` comes from `stats_platforms` and counts `users` per platform.
- `attention` is a list of `{ id, level: bad|warn|info, text, action, page, tab?, params? }` built by `attentionFor()` in `overview.ts`. It covers:
  - the database not being set up, or being behind schema version 10;
  - errors in the last 24 hours, marked bad above 20 or when they more than double;
  - new feedback;
  - no phones registered for notifications;
  - open Listen Together rooms.

The page is laid out as follows:

- **Needs your attention.** Built with `ui.attention`. Each alert has a button that opens its page, and a "⋯ → Dismiss for today" menu. Dismissals are stored in this browser for the current day.
- **Ten stat cards.** Each has an ⓘ tooltip and opens its page with the filter already applied:
  - Listening right now → Live
  - Plays today, compared with yesterday → Song Stats, today
  - Total users → Users
  - New users this week, compared with last week → Users, joined in the last 7 days, newest first
  - Active today, this week and this month, each compared with the period before → Users, active in the last 1, 7 or 30 days
  - App errors in 24 h (going down counts as good) → App Health errors, today
  - New feedback → Feedback, New
  - Phones ready for notifications → Send Notification, Setup check
  - Listen Together rooms live → Live, Rooms
- **Four charts.** Each card has a **See details** button that opens the related page with the same range:
  - plays and active users per day (line)
  - users by platform (donut)
  - new users per day (bars)
  - searches and errors per day (line)

### Home · Live Now (`#/live/now|activity|rooms`)

The page makes one call, `GET /api/admin/live`. The answer is `{ configured, now, counts: { activeNow, playingNow, roomsOpen }, listening, feed, rooms }`.

- **Signed-in people only.** A device counts when it belongs to an account: its `account_id` is set, or it is the account's latest device. Anonymous devices and their events are dropped on the server. Device ids never reach the browser.
- **`listening`.** One row per person, using their newest device active in the last 5 minutes: `{ key, user: { id, name, email, picture }, platform, appVersion, country, city, song, isPlaying, lastSeen }`.
- **`feed`.** The newest 60 signed-in events: `{ id, at, kind, user, song, message, errorKind, platform, city }`.
- **`rooms`.** Rooms with activity in the last 6 hours: `{ code, hostName, members, song, playing, updatedAt, createdAt }`.

The page has three tabs: **Listening now**, **Recent activity** and **Listen Together rooms**.

- Above the tabs are four cards: Active now, Playing now, Rooms open and Server time.
- A **Refresh** dropdown polls every 15 s (the default), 30 s or 1 min, or not at all. The choice is stored per browser.
- On a person's row, the ⋯ menu offers View profile (opens Users with the drawer), Send notification (`#/notifications/compose?users=<id>`) and Copy email.

Two actions change things, and both need the Editor role:

- **End this room**, after a confirm: `POST /api/admin/live { action: 'end_room', code }`.
- **End all rooms**, after typing CONFIRM: `{ action: 'end_all_rooms' }`.

### People · Users (`#/users`)

The page lists only Google accounts, with one row per person.

**`GET /api/admin/listeners`** returns the list. It runs the SQL function `admin_users`, which filters, sorts and pages on the server.

- Query parameters (anything invalid is ignored):
  - `q`: name or email
  - `platform`
  - `active`: days since last active
  - `joined`: days since joining, or `joinedFrom` and `joinedTo` (dates in India time, both inclusive)
  - `country`, `region`, `city`
  - `version`
  - `language`: the person's most-played language over 90 days
  - `sort`: `last_active` (default), `joined`, `plays` or `name`
  - `limit` (25, 50 or 100; at most 200) and `offset`
  - `ids`: a comma-separated list of account ids
- Answer: `{ configured, total, limit, offset, rows, counts }`.
  - Each row is `{ id (Google account id), name, email, picture, platform, appVersion, country, region, city, nowPlaying, isPlaying, joined, lastSeen, devices, plays, language, blocked }`.
  - `counts` is `{ users, new7d, activeToday, byPlatform: { android, web, ios } }`.
- `kit/controls.js` `VX.findUsers` uses `?q=&limit=` for every user picker (AI testers, global search).

The other two GETs on the same route:

- **`GET ?filters=1`** returns `{ places: [{ country, region, city, users }], versions: [{ platform, version, users }], languages: [{ language, users }] }` from `admin_user_filters`.
- **`GET ?account=<id>`** returns `{ profile }` from `user_profile`. The profile holds the account, every device, counts, top songs, top artists, languages, the last 200 plays, the person's feedback and the last 200 activity events. A device's `id` is used only to sign that device out and is never shown.

**`POST /api/admin/listeners`** changes things. Every action is audited, and the role is checked on the server.

| Action | Body | Role | What it writes |
| --- | --- | --- | --- |
| Block user | `{ action: 'block', account, reason? }` | Editor | `accounts.blocked_at = now`. `/api/auth/google` then answers `403 blocked`, and `/api/auth/me` answers `401 { error: 'signed_out', reason: 'blocked' }` |
| Unblock | `{ action: 'unblock', account }` | Editor | `blocked_at = null` |
| Sign out this device | `{ action: 'signout_device', account, device }` | Editor | Sets that device's `listeners.signed_out_at = now` and `account_id = null`, and clears `accounts.listener_id` if it pointed at the device. The device's next `/api/auth/me` check is refused with `reason: 'device_signed_out'`. Only a proved device header counts, and only when the session was issued before the sign-out. Signing in again on that device clears `signed_out_at` |
| Delete user's data | `{ action: 'delete', account, reason }` | Owner | First removes the VinaX AI files, then runs `delete_listener` for every device of the account (events, room memberships, device rows, the account and its backup) and answers the summed counts |

The Users page is laid out as follows:

- **Six stat cards**, each with ⓘ: Total users, New this week, Active today, Android, Web and iOS. Clicking a card applies that filter.
- **Filters.** A search box and dropdowns for:
  - Platform
  - Last active
  - Joined: Today, 7 days, 30 days, or Custom, which opens a date-range dialog
  - Country → State → City, where each dropdown narrows the next
  - App version: the real versions, marked "(latest)"
  - Language
  - Sort by
- **URL.** Every filter is kept in the address, so a link from the Dashboard opens the page already filtered.
- **Table columns.** User (photo, name, email, a "Blocked" chip), Devices, Platform & version (with an "Update available" chip when the version is older than `/api/version`), Location, Now playing (a green dot while live), Joined and Last active. Email, Favourite language and Plays start hidden and can be turned on from the Columns menu.
- **Paging and export.** Rows per page and paging come from the server. Export downloads CSV or Excel, of the selected rows or of every matching row (up to 5,000).
- **Row ⋯ menu.** View profile, Send notification, Copy email, Add as AI tester, Block or Unblock user, and Delete user's data (Owner only: pick a reason, then type CONFIRM).
- **Bulk actions.** Send notification goes to `#/notifications/compose?users=<id,id>`. Export downloads the selected rows. Add as AI testers reads the `vinax-ai` setting, merges the people into `testers` (at most 50) and, after a confirm, posts the whole value to `/api/admin/settings`.
- **Profile drawer.** Opened by clicking a row, or by `#/users?user=<id>`. It has five tabs:
  - Overview: four stat cards, the facts, top artists and top songs.
  - Listening history.
  - Devices: each device with platform, version, place and last seen, and **Sign out this device**.
  - Feedback sent.
  - Activity log, in plain words ("Liked a song", "Hit a problem").
  - Closing the drawer removes `user` from the address.

Viewers see every number. Actions that change something are hidden from them or refused, and the server answers 403 regardless.

### People · Feedback (`pages/feedback.js`)

Tabs with counts (New · Read · Resolved · All, kept in `?status=`), filters for type (Bug, Idea, Song problem, Other), platform and time (Any time, Today, 7/30/90 days). Each message is a card: who sent it (photo, name, email, or "Not signed in"), the type, when, the message, any owner note, the device (platform, version, city) and a Status dropdown. The "⋯" menu has Reply by notification, Copy message, Copy email, View profile (opens Users with `?user=`) and Delete (confirm). The Resolved tab has **Delete all resolved** (type `CONFIRM`). Empty state: "No new feedback. Messages users send from Settings → Feedback appear here."

| Route | Shape |
| --- | --- |
| `GET /api/admin/feedback?status=new\|read\|resolved\|all&kind=&platform=&days=\|from=&to=&limit=&offset=` | `{ total, counts: { new, read, resolved, all }, rows }`. Counts follow the type, platform and date filters. Each row has `user: { id, name, email, picture } \| null` (the Google account behind the device) and `canReply` (that account has an active push device). The device id is never returned |
| `POST { action: 'status', id, status, note? }` | New → Read → Resolved |
| `POST { action: 'reply', id, title?, message }` | Sends a notification to the sender's signed-in devices (`push_devices.account_id`), writes a `notifications` row (`audience.feedback`, `created_by`), notes the reply on the message and marks it Read. `409 no_account` (sent while signed out) or `409 no_device` (no notifications turned on), `400 push_not_configured` |
| `POST { action: 'delete', id }` · `{ action: 'delete_resolved' }` | Delete |

### Music · Song Stats (`pages/song-stats.js`)

Follows the top-bar date range (`ctx.range.days`, 1–90). Every number counts signed-in users only (schema 8), except the sign-up journey. Tabs: **Top Songs** (stat cards, table with art, plays, users, a "▲ rising" chip when plays grew at least 20 % and by 3 on the period before, "New" when there were none), **Rising** (extra plays and % change), **Top Artists**, **Languages** (bars, share donut, table), **Where Users Are** (countries as bars, then Country → State dropdowns narrowing a states table and a cities table; places come from the network edge, never GPS; no map, so no third-party requests), **How Much They Listen** (people, plays per person, days active per person, busiest hour, plays per person per day, light/regular/heavy listeners, who is coming back, the hour-of-week heat map in India time), **Do They Come Back** (weekly groups with "Came back after 1 day / 7 days / 30 days"), **Sign-up Journey** (Opened the app → Played a song → Signed in with Google → Came back another day, as step bars with the % of the step before) and **Songs People Skip** (skip rate meter). Song rows have a "⋯" menu: Copy song ID, Open in app, Add to banner (`#/app-settings/home-screen?section=banners&addSong=<id>&title=`), Use in notification (`#/notifications/compose?song=<id>&title=`), Block song.

`GET /api/admin/analytics?view=music|rising|geo|engagement|retention|funnel|skips|errors&days=` → `{ days, view, data }`; `music`/`rising` → `stats_music` (songs carry `prev_plays`), `geo` → `{ countries, regions, cities }`, `engagement` adds `perUser` and the timeline. `view=errors` and `POST { action: 'clear_errors' }` (owner) stay for App Health.

The page also defines `VX.music` (shared with Music Library): `url(kind, id)`, `open`, `block(kind, value, label)` (asks the reason: Copyright, Wrong audio, Offensive, Other), `songMenu(song, ctx)`, `previewButton(src, title)` (plays the first 30 seconds) and `stop()`.

### Music · Music Library (`pages/library.js`)

**Search music**: a Look for dropdown (Songs, Albums, Artists, Playlists) and a search box (kept in `?q=` and `?type=`, so the global search opens it prefilled). Result cards show art, title, artist, year, language and length, a ▶ 30-second preview on songs, and a "⋯" menu: Copy ID, Open in app, Add to banner, Use in notification, Block. **Blocked songs & albums**: stat cards per kind, a table (item and kind, Reason dropdown that saves at once, Blocked by, Date, **Unblock** with a confirm), a Show filter, and **Block more** (an artist picker, a word in titles).

| Route | Shape |
| --- | --- |
| `GET /api/admin/catalog-search?q=&type=songs\|albums\|artists\|playlists&limit=` (old `kind=song\|album` still works) | `{ items: [{ id, title, name, subtitle, image, type, language, year, duration, album, preview }], type, source, error }`. `preview` is the 48 kbps stream of a song (null for others) |
| `GET /api/admin/content` | `{ blocked: [{ id, kind, value, label, reason, blockedBy, createdAt }], suggestions, reasons }` |
| `POST /api/admin/content { action: 'block', kind: song\|album\|artist\|keyword, value, label?, reason? }` | `blocked_by` is the admin's email; a reason outside the four is stored as Other |
| `POST { action: 'reason', id, reason }` · `{ action: 'unblock', id }` | Change why, or unblock |

`GET /api/blocklist` now also returns `albums`. The app hides a blocked album (`normalizeAlbum` answers null, so it drops out of search, artist pages and album pages) and every song whose `album.id` is blocked (`isBlockedSong`).

### Engage · Send Notification (`#/notifications`)

Tabs: **Compose** (`compose`) · **History** (`history`) · **Saved audiences** (`audiences`) · **Setup check** (`setup`). Old `#/notify/*` addresses redirect here.

Only people signed in with Google are ever reached: a `push_devices` row counts when `account_id` is set. The app sends its session (`Authorization: Bearer vx1…`) with `POST /api/push/subscribe` and `POST /api/push/fcm-register`; the Worker links the device to that account (or unlinks it when no session comes). Signing in or out re-registers at once (`relinkPush` / `relinkNativePush`, wired in `AnnouncementBridge`). A database still on schema 7 saves the device unlinked instead of failing.

| Route | Shape |
| --- | --- |
| `GET /api/admin/push` | `{ web: { configured, active, allDevices }, fcm: {…}, people, geo: { countries, regions, cities }, langs, rules, quiet: { quiet, until } }` — `active` and the geo/language buckets count signed-in devices only |
| `POST /api/admin/push` | `{ title, body, link, image?, filter: { country, region, city, lang, channel }, activity: active7 \| quiet \| dormant14, users: [account ids], dedupeKey }` plus one of: `dryRun` → `{ people, devices, web, fcm, skippedRecent, audience, quiet }`; `test` → the signed-in admin's own devices only (needs Google sign-in; no history row); `draft` (+ `draftId` to update) → `{ id, status: 'draft' }`; `when: 'schedule', scheduledFor` (1 minute to 60 days ahead) → `{ id, status: 'scheduled' }`; otherwise send now → `{ id, status: 'sent', people, web, fcm, audience }`. `409 quiet_hours { until }` during quiet hours unless `ignoreQuiet: true`; `409 kind_off` when announcements are switched off; `409 duplicate` for a repeated dedupe key |
| `GET /api/admin/notifications?status=all\|sent\|scheduled\|draft` | `{ rows: [{ id, at, title, body, link, image, status, scheduledFor, audience, filter, web, fcm, delivered, opened, openRate, sentBy }], counts: { sent, scheduled, draft } }` |
| `POST /api/admin/notifications` | `retract { id }` (also clears the matching announcement), `cancel { id }` (scheduled only), `delete { id }` (drafts and cancelled only) |
| `POST /api/push/opened { id }` | Public, rate-limited: +1 on that notification's `opened` (`notification_opened`). Sent by the service worker's `notificationclick` and the Android tap handler; payloads carry the notification `id` (web push `id`, FCM `data.id`) |

Activity filters read the account's `last_seen`, not the device. Audience labels are plain words ("Hyderabad · Telugu · Active in last 7 days", "Everyone", "3 chosen users"). Pictures (`ui.imageUpload`, purpose `notification`) go out as the web push `image` and FCM `notification.image`.

**Scheduled sends.** `_lib/scheduledPush.ts` → `runScheduledNotifications(env, now)`: up to 3 due rows per run, each claimed `scheduled → sending` (so overlapping runs never double-send), audience rebuilt from the row, Notification Rules applied, receipt marks it `sent`. During quiet hours nothing is claimed; it waits for the next run. The cron job calls it (see Jobs).

**Notification Rules** (`push` setting, read by `rulesOf`): `{ minGapHours, quiet: { enabled, start, end } (India time), types: { announcements, releases, recommendations, reminders } }`; the old `{ minGapHours, quietStart, quietEnd }` is still read. The frequency cap skips devices pushed within `minGapHours` (test sends ignore it); console sends count as `announcements`; `kindAllowed(rules, kind)` is there for job-sent kinds.

**Saved audiences** live in the `push-audiences` setting: `[{ id, name, filter, activity, users }]` (up to 30). **Setup check** reads `GET /api/admin/push`, `envcheck` (Push group) and `fcmcheck`, and explains each ✗ in plain words, with the secret names under "Technical".

### Engage · A/B Tests (`#/ab-tests`)

The app picks each device's version on the device (FNV-1a over `deviceId:key`), so the server never knows who is in which version; "users per version" is people active in the last 7 days × the test's share, labelled "about".

| Route | Shape |
| --- | --- |
| `GET /api/admin/experiments` | `{ rows: [{ key, name, description, variants: [{ name, pct }], audience: { platform, minVersion, percent }, status, active, startedAt, endedAt, winner }], activeUsers }` — rows from before get `status` from `active` |
| `POST /api/admin/experiments` | `save { key, name, description, variants, audience, status }` (`active: true` still means running); `status { key, status: draft \| running \| paused \| finished, winner? }` (the winner must be one of the versions; `ended_at` set on finish); `delete { key }` |
| `GET /api/experiments` (public) | Running tests only: `{ experiments: [{ key, variants, audience }] }`; falls back to the old columns on a schema-7 database |

Targeting is real on both sides (`inAudience` in `_lib/experiments.ts` and `src/features/experiments/useExperiment.ts`, same fixtures): platform must match unless `all`, the app must be at least `minVersion`, and a second hash over `deviceId:key:in` must fall under `percent` (raising it only adds people). The New test form offers the slots the app reads today — `home-shelf-order` (control / discovery-first) and `rec-next-songs` (control / taste-0.15 / taste-0.18) — or "Something new", which needs an app update to have any effect. One test per slot (the key is the primary key).

### App Settings › Home Screen (`pages/settings-home.js`)

| Section | Controls | Stored value (`settings` key) | Who reads it |
| --- | --- | --- | --- |
| Banners & Offers | Card list with drag to reorder; per card an On/Off switch, a state chip (Live / Starts … / Ended / Off) and ⋯ Edit · Duplicate · Delete; **Add banner** opens a form: title, subtitle, square picture (`ui.imageUpload`, purpose `banner`, 400×400), **Opens** dropdown (a song, album, playlist or artist through a search picker; Charts; a page in the app from a fixed list; nothing), start/end dates, show switch. At most 10 live. `#/app-settings/home-screen?addSong=<id>&songTitle=&songArtist=&songImage=` opens the form prefilled (Song Stats → Add to banner) | `banners`: `[{ id, title, subtitle, img, linkType: song\|album\|playlist\|artist\|charts\|page, linkId, linkLabel, start, end, enabled }]` (dates `YYYY-MM-DD`; `linkLabel` is console-only) | `activeBanners` (`_lib/clientConfig.ts`) drops `enabled: false` and out-of-date cards, accepts `charts` and `page` (only the paths in `BANNER_PAGES`); the app's `PromoBanner` opens `/charts` or the page |
| Festival Theme | Radio: follow the festival calendar (built-in) / choose the look myself; then a dropdown None · Diwali · Sankranti · Ugadi · Holi · Eid · Christmas · New Year · Custom; Custom adds any festival from `festivals.js` and a colour picker; dates; On/Off; phone preview | `festival`: `{ mode: off\|force, id, color, start, end, enabled }`; following the calendar clears the key | `publicFestival` passes `color` for a forced festival; `enabled: false` = no override (calendar). The app (`useFestivalNow` → `FestiveSplash`) sets `--ember-400/500/600` from the colour while the skin is on |
| Home Greeting | On/Off; Morning, Afternoon, Evening, Night text boxes (160 characters); "Start with the person's first name" checkbox; preview of the line showing now | `greeting`: `{ morning, afternoon, evening, night, withName, enabled }` (an older `{ text }` loads into all four boxes) | `publicGreeting` sends `{ text, parts, withName }` (`text` = first filled part, for older apps); the app's `greetingLine` (`services/appRules.ts`) picks the part of the day on the device clock (5–12, 12–17, 17–21, night) and prefixes "Hi Asha!" |
| Top Message Bar | Message (240), Style (Info / Good news / Warning / Urgent), "Where a tap goes" (nothing, an app page, a song/album/playlist picker), dates, "Can users close it?", On/Off, preview | `broadcast`: `{ id, text, style, link, linkLabel, start, end, dismissible, enabled }` — `id` is derived from the words, link and style, so changing them shows the bar again to people who closed it; dates are stored as the start and end of the day in the console's time zone | `publicBroadcast` passes `style` and `dismissible: false`; the app's `BroadcastBar` (`components/OwnerMessages.tsx`) shows it above every page (it replaced the 15-second toast) |
| Home Layout | Drag-to-reorder list of the 12 Home sections, each with a Shown/Hidden switch; at least one must stay shown | `home-layout`: `{ order, hidden, title?, description? }` (default order with nothing hidden clears the key) | Unchanged: `publicClientConfig` → `homeLayout` |
| Pop-up Announcement | Title, message, button text, "The button opens" picker, Show (Once per user / Once a day / Every time the app opens), platform checkboxes (Android app, Website, iPhone), dates, On/Off, preview | `announcement`: `{ title, body, button, link, linkLabel, show, platforms, popup: true, start, end, enabled, ts }` — `ts` is a hash of the content, so an edit shows it again | `publicAnnouncement` (`api/announcements.ts`) checks the switch and dates and passes the pop-up fields; the app's `AnnouncementPopup` decides with `announcementDue`. A value the push sender writes (no `popup`) stays an Android notification only, as before; the Android bridge still shows a local notification once per `ts` |

### App Settings › Features & AI (`pages/settings-features.js`)

| Section | Controls | Stored value | Who reads it |
| --- | --- | --- | --- |
| Feature Switches | One switch per flag the app reads, with a plain description. Today only **Listen Together** | `flags`: `{ listenTogether: false }` (only "off" is stored; unknown flags are kept) | `publicFlags` → `flagOn` in the app |
| VinaX AI Assistant | Open to all signed-in users; Testers (user search picker → photo chips, up to 50; account ids never shown); Allow web search; AI models (switch per model, drag to set the order, "Top = tried first", from `GET /api/admin/ai`); Limits: daily message limit per user (10 / 25 / 50 / 100 / Unlimited), web searches a day (Server default 100 / Off / 50 … 2,000), sliders for messages per minute (1–30, default 20), pictures per message (1–20, 10), files per message (1–20, 20), files per chat (1–100, 50), largest PDF (1–50 MB, 30), most PDF pages (1–1000, 500), largest text file (1–5 MB, 2); Instructions for every VinaX AI model (4,000 characters, counter) | `vinax-ai`: `{ enabled, testers, search, models: { id: { enabled?, order } }, dailyLimit, instructions, limits: { …changed values only, searchesPerDay } }` | `sanitizeAiSettings` (`_lib/ai/config.ts`) reads `dailyLimit`; the chat route counts each person's messages per UTC day with `ai_take_daily('msg:<account>', limit)` and answers `429 daily_limit` (the app says "You've reached today's message limit"). `instructions` and `limits` take effect once vinax-71's branch `vinax/ai-owner-instructions` is merged; until then the server ignores them |
| Recommendations | Personal recommendations and Build Home for each person switches; ten sliders with plain names (Match each person's taste, Mix of new vs familiar songs, New releases, Stay in their languages, Favourite artists, Songs people play together, Popular with everyone, Time of day, Avoid songs they skip, Avoid repeating songs), each half to double the built-in amount | `personal-config`: `{ enabled, composer, embedModel, weights: { tasteFit, novelty, freshness, language, artist, colisten, community, hour, skips, exposure, … } }` (only changed weights; others kept) | `_lib/personal/config.ts` (clamps 0.5–2×) |
| Music AI | Music AI switch; Order Up Next with AI; Arrange Home with AI; Let people make songs, with a "songs each person can make a day" slider (1–50, default 5) | `ai-music`: `{ enabled, rerank, home, generate: { enabled, dailyQuota } }` | `_lib/ai/music.ts`, `api/ai/generate-song.ts` (unchanged) |

### App Settings › App Updates (`pages/settings-updates.js`)

Per platform (Android app, Website, iPhone app): an **Oldest version allowed** dropdown filled from the versions signed-in users report (`GET /api/admin/listeners?filters=1` → `versions`), with each version's user count, and an **Update type** radio (Suggest update / Force update). A live line says "This will affect N users on older versions". One update message box. Saving a forced rule asks the admin to type CONFIRM.

Stored: `min-version`: `{ android|web|ios: { minVersion: "1.8.2", mode: suggest|force }, message, build? }` (an older `build` rule is kept until the setting is reset).

Who reads it: `publicVersionPolicy` adds `versionPolicy` to the client bundle (`minBuild` stays for older apps); `/api/version` adds `minVersion` and `updateMode` for Android. In the app, `VersionNotice` (`components/OwnerMessages.tsx`) compares the installed version name (`compareVersions`): Suggest shows a bar people can close for the day; Force shows a full-screen "Update needed" card (website: reload; Android: the installer opens as a mandatory update via `checkForUpdate`, which also treats `updateMode: force` as mandatory).

### App Settings › Maintenance (`#/app-settings/maintenance`)

| Section | Controls | Stored value | Who reads it |
| --- | --- | --- | --- |
| Site Mode (`site-mode`) | Radio cards Normal / Read-only / Maintenance, optional message. Read-only and Maintenance ask for confirmation; Maintenance needs `CONFIRM` typed. Normal clears the key (the built-in mode) | `{ mode: "readonly" \| "maintenance", note? }` | `/api/site-mode` (`publicSiteMode`), the Worker router (`_lib/readOnly.ts` refuses saving writes with 503 `read_only`), the app's `SiteGate` (maintenance screen, read-only notice) and `services/siteMode.ts` (feedback, account sync) |
| Scheduled Maintenance (`maintenance-window`) | On/Off, Starts / Ends date-time pickers (console time zone, IST by default), "Warn users before" 15 min / 1 h / 1 day, message | `{ enabled, start, end, warnBefore: 15 \| 60 \| 1440, note? }` (a value without `enabled` counts as on) | `publicSiteMode` (maintenance while inside the window; `upcoming` while it is within two days), the client bundle (`maintenance`), `SiteGate` (warning notice from `warnFrom`, switches at `start`) |
| Status Page Note (`status-note`) | Show the note on/off, Level All good / Minor issue / Major outage, message | `{ enabled, text, level: "ok" \| "minor" \| "major" }` | `/api/status` (`note`, `noteLevel`; a note saved before v8 has no level and keeps the old amber box), `public/status/app.js` |

Read-only mode refuses POST/PUT/PATCH/DELETE on `/api/feedback`, `/api/account/data`, `/api/profile`, `/api/follow`, `/api/shared-playlist` and `/api/username`. Listening, events, Listen Together, sign-in, push registration, VinaX AI and the console keep working. Older apps treat `readonly` as live (the server still refuses their writes).

### App Settings › Notification Rules (`#/app-settings/notification-rules`)

"Max notifications per person" (1 every 6 h / 12 h / day / 2 days), Quiet hours switch with from/until time pickers, and a switch per kind (New releases, Recommendations, Announcements, Reminders). Stored in `push` as `{ minGapHours: 6 | 12 | 24 | 48, quiet: { enabled, start: "HH:MM", end: "HH:MM" }, types: { releases, recommendations, announcements, reminders } }`. Unset means no limits (the page says so). The push sender enforces it.

### App Settings › Search & Music Sources (`#/app-settings/search`)

| Section | Controls | Stored value | Who reads it |
| --- | --- | --- | --- |
| Search Synonyms (`search-synonyms`) | Two word boxes ("When people type" ↔ "Also search for"), Add, a delete button per pair | `{ "typed": "meant" }` | client bundle `synonyms` → app search |
| Music Sources (`catalog-sources`) | Drag to set priority, On/Off per source (at least one stays on) | `{ "<source>": false, _order: ["<source>", …] }` (`_order` only when reordered) | client bundle `disabledSources`, `sourceOrder` → `constants/endpoints.ts` `activeBases()` |
| Language Order (`language-order`) | Drag to reorder the 12 Home languages, Shown/Hidden per language, phone preview | `{ order: [...], hidden: [...] }` (the old plain list is still read) | client bundle `languageOrder`, `hiddenLanguages` → Home's language rail |

### App Settings › Help Center (`#/app-settings/help-center`)

Accordion editor: Add question (up to 30), drag to reorder, Question, Answer, Category dropdown (General, Playing music, Account & sign-in, Downloads & offline, Listen Together, Problems & fixes), Shown/Hidden switch, Delete (confirmed). Phone preview grouped by category. Stored in `support-faq` as `[{ q, a, category, enabled }]`; the Worker drops hidden questions and passes the category; the app's Help page lists the owner's questions first, grouped by category, before the built-in ones.

### App Settings › Data & Privacy (`#/app-settings/privacy`)

"Keep for" dropdown (30 / 90 / 180 / 365 days / Forever) for Play history, Error reports, Feedback and Notification logs. Stored in `retention` as `{ eventsDays, errorsDays, feedbackDays, notificationsDays }`; Forever is stored as 3650 days (the housekeeping job's longest period). Shortening a period asks before saving, because the hourly housekeeping job deletes older data within the hour. Unset: play history 180 days, error reports with play history, feedback and notification logs kept.

## System pages

### Admin sign-in and roles — setup

Admins sign in with Google. Only an email on the **Admins & Roles** list (the `admins` table) gets in; the Worker checks the role on every request.

1. **Authorise the console's address on the Google sign-in client.** Google Cloud Console → APIs & Services → Credentials → the OAuth web client whose id is `GOOGLE_CLIENT_ID` in `backend/worker/wrangler.toml` → *Authorised JavaScript origins* → add `https://admin.vinaxmusic.online` (and any preview origin you use). Without it, Google's button shows "The given origin is not allowed".
2. **Name the first owners.** Set the Worker secret `ADMIN_OWNER_EMAILS` to a comma-separated list of Google emails (`npx wrangler secret put ADMIN_OWNER_EMAILS --config worker/wrangler.toml`). These emails are always Owners, even with no `admins` row; their first sign-in writes the row. Invite everyone else from Admins & Roles.
3. **The recovery password.** `ADMIN_LOGIN_PASSWORD` still works as an Owner ("Owner (recovery password)" in the Change log), behind *Owner recovery password* on the sign-in screen. Keep it for emergencies (Google down, origin not authorised yet) or delete the secret to allow Google sign-in only.
4. **Run the database update** (schema version 10, below) — the `admins` table must exist for anyone but bootstrap owners and the password.

| Piece | Where |
| --- | --- |
| Sessions | `adm1.<payload>.<hmac>`, 12 hours, signed with `AUTH_SECRET` (falls back like app sessions). Sent as `x-admin-token`. The role is re-read from `admins` (memoised one minute), so a demotion or removal applies within a minute |
| `GET /api/admin/session` | Never 401: `{ googleClientId, googleReady, passwordAllowed, me, schema, schemaWanted, databaseConfigured }` |
| `POST /api/admin/session { credential }` | Google ID token → `{ token, me, expiresIn }`; `403 not_an_admin` / `email_not_verified`, `401 invalid_token`, `503 google_not_configured` |
| Roles | viewer < editor < owner. `adminGet` allows any admin; `adminPost` needs editor unless the route asks for owner (`{ role: 'owner' }` or a function of the body). Viewers get `403 { error: 'forbidden', need }` |
| Owner-only writes | Database (all actions), Admins & Roles, clearing app errors, deleting a user's data |
| `GET/POST /api/admin/admins` | List (any admin); `invite { email, role }`, `role { email, role }`, `remove { email }` (owner). `409 last_owner` when the last Owner would be demoted or removed; `409 already_admin` |
| Audit | Every row names the admin (`actor` = email) |

### App Health (`#/health/<tab>`)

| Tab | id | Route |
| --- | --- | --- |
| App Errors | `errors` | `GET /api/admin/errors?days=` → `{ total, groups, users, byDay, top }` from `stats_errors`: every report counts, grouped by kind + message shape (`_error_shape` strips song names, ids and numbers, so "Download timed out — 14 songs" is one row), each with `fingerprint`, `variants`, `samples`, `users` (signed-in people affected), platforms, versions, `status`. `POST { action: 'status', fingerprint, status: new\|investigating\|fixed\|ignored, note? }` (editor) upserts `error_status`; `POST { action: 'clear' }` (owner, typed CONFIRM in the page) deletes error events |
| Server Checks | `checks` | `GET /api/admin/edge` |
| Music Sources | `sources` | `GET /api/admin/musicapi` (on a button press) |
| AI Assistant | `ai` | `GET /api/admin/ai`; `POST { model }` tests one model (editor) |
| Recommendations | `recommendations` | `GET/POST /api/admin/personal` |
| App Versions | `versions` | `GET /api/admin/releases` |
| API Keys Status | `keys` | `GET /api/admin/envcheck`: each key with a plain `label`, `Set ✓` / `Missing ✗` only, never a value |

"What happened" is worked out in the page (`VX.health.explain`) from the kind and message: downloads, playback, app crashes, notifications, other — each with a plain sentence. The page uses the top bar's date range.

### Database (`#/database/<tab>`)

- **Tables** (`tables`): `GET /api/admin/database` now gives each table a friendly `label`, `about`, exact or `approximate` row count (an ⓘ explains "Approximate"), size, and `keptFor` from the `retention` setting; plus `totalBytes`, `schemaWanted` and `expected`.
- **Scheduled jobs** (`jobs`): each job has a plain `about`, `enabled`, `every` (minutes) and `choices`. `POST { action: 'job_setting', job, enabled?, every? }` (owner) writes the `jobs` setting; `run_job` runs one now.
- **Change log** (`changes`): `GET /api/admin/audit?actor=&action=&from=&to=&limit=&offset=` → `{ total, rows, actors, actions }`; dates are whole days in India's time zone and `to` includes its day. Rows open a drawer with the value before and after.
- **Maintenance** (`maintenance`, linked from the "database update needed" banner): the **Database update** card (installed vs wanted schema version, the paste-into-SQL-Editor steps), then Clean up old data, Rebuild statistics (co-listening), Close empty rooms, Forget silent phones — each explained, confirmed, and the destructive one needs CONFIRM typed.

### Scheduled jobs (`_lib/jobs.ts`)

| Job | Default | What |
| --- | --- | --- |
| `status-tick` | every 30 min | status page checks |
| `housekeeping` | hourly | rooms, retention purges, push devices, AI chats, personal engine purge, nightly co-listening (21:00 UTC run) |
| `personal-embed` | every 30 min | recommendation learning |
| `scheduled-notifications` | every 5 min (each cron run) | `runScheduledNotifications` from `_lib/scheduledPush.ts` |

The `jobs` setting `{ "<job>": { enabled, every } }` switches a job off or slows it; `every` must be one of the job's `choices`. A job is due when it is on and its last run started at least `every − 2` minutes ago (read from `job_runs`), so the cron's own interval only sets the finest grain. A job is "running late" after `max(2 × every + 15, 45)` minutes.

Retention (`retention` setting): `eventsDays` (usage, default 180, 7–3650), `errorsDays`, `feedbackDays`, `notificationsDays` (missing or 0 = keep forever). With `errorsDays` set, usage and error reports are purged separately (`purge_kind('plays' | 'errors')`); otherwise `purge_events` keeps the old behaviour. There is no "forever" for usage: the longest is 3650 days.

### Google Search (`#/google-search/<tab>`)

- **Summary** (`summary`): cards (Pages Google can find, Sitemaps, Pages with no problems, robots.txt, Server load per check), sitemaps table, **Check again**, and **Bots allowed to read the site**.
- **Page check** (`pages`): each key page with *What's wrong* and *How to fix* (`VX.seoExplain` turns crawler findings into plain words), plus a song / album / artist picker that checks that page.
- **Search Console** (`console`): links and the weekly routine.

**Bots and robots.txt.** `_lib/robots.ts` lists the crawlers (Search engines / AI bots / SEO tools) with their built-in rule; the `robots` setting `{ bots: { "<bot>": true | false } }` overrides any of them. robots.txt itself stays a **static file** on the website host — a Worker-served robots.txt answered 429 when the daily quota ran out and Google stopped crawling the domain (wrangler.toml, 11.0.3). So:

1. `GET /api/robots` (public, cached 5 min) answers the text built from the setting (the built-in policy with no setting or no database — it blocks exactly what the committed `public/robots.txt` blocks; a test pins that).
2. `frontend/scripts/robots-from-api.mjs`, the last build step, fetches it on Cloudflare Pages builds (`CF_PAGES=1`) and writes `dist/robots.txt` when the answer is clearly a robots file; elsewhere, or on any failure, the committed file stays.
3. Saving the bots card calls `POST /api/admin/seo { action: 'publish_robots' }` (editor), which POSTs the **`PAGES_DEPLOY_HOOK`** secret (a Cloudflare Pages deploy hook: Pages project → Settings → Builds → Deploy hooks) so the site rebuilds and the new robots.txt is live in minutes. Without the secret, the choice is saved and goes live with the next website build (every release), and the page says so.

`GET /api/admin/seo?view=bots` → `{ groups, bots: [{ id, name, about, group, allowByDefault, allowed, live }], saved, publishReady }` — `live` is what the live robots.txt does right now, so a bot whose choice is not live yet is marked.

### Admins & Roles (`#/admins`)

Table: admin (photo, name, "You", "Always Owner" for `ADMIN_OWNER_EMAILS`), email, Role dropdown, last sign-in, ⋯ Remove; **Invite admin** (Google email + role). Non-owners see it read-only. The last Owner's role and Remove are locked, and the server refuses them too.

### Tests

- `backend/worker/__tests__/consoleAuth.test.ts` — sessions (issue, read, expiry, forgery, other secret), principals (Google role from `admins`, recovery password = owner, removed admin refused, bootstrap owners, unreadable table refused), role gating (viewer 403, editor allowed, owner-only actions, database owner-only, audit actor), `POST/GET /api/admin/session`, Admins & Roles (owner-only, invite/role/remove, duplicates, last owner).
- `backend/worker/__tests__/consoleSystem.test.ts` — App Errors (grouped answer, status upsert with who, clear owner-only, `db_update_needed`), Change log filters and dropdown choices, jobs (settings, due rule, retention, cron skips switched-off jobs, per-kind purges, `job_setting`), bots (built-in rules match the committed robots.txt, owner choices, `/api/robots`, the bots view, publish via the deploy hook), API keys (plain labels, no values).
- `frontend/src/__tests__/robotsFromApi.test.ts` — the build step only publishes a real robots file.
- Mocks for the preview server and e2e: `frontend/e2e/support/console-mocks/system.mjs`.


## Tests

- `frontend/src/__tests__/adminConsole.test.ts` loads the real `core.js`, the kit and every page into a DOM: `index.html` loads every file in order under the strict CSP, every page registers a unique id in one of the six groups with an existing icon, App Settings pages come in the spec's order, old addresses redirect to existing pages, the spec's plain words (no "Publish", "App default", "Device only"), no markup from strings, and **every page and tab renders from empty answers and from failing ones** without printing `undefined`, `NaN` or `[object Object]`.
- `frontend/e2e/console-shell.spec.ts`: sign-in, the six groups and the sub-menu, redirects and Page not found, Ctrl+K, date range / theme / auto-refresh, the phone menu, the database update banner.
- `frontend/e2e/console-pages.spec.ts`: every page and tab with data, with empty answers and with a failing server (no errors, an ⓘ on every stat card, no banned words, no `d_` ids), no sideways scrolling at phone width, viewers cannot save, saving asks first and posts, Users opens a profile. Both specs use `e2e/support/consoleMocks.ts` and the per-area mock files in `e2e/support/console-mocks/` (the same files drive a local preview server).
- `backend/worker/__tests__/console*.test.ts`: one file per area (Auth, People, Music, Engage, SettingsA, SettingsB, System) against a mocked database, including role checks; `backend/supabase/check.sql` asserts every new SQL function.

## Limits

- Dates and "today" follow India's calendar on the server; the profile menu only changes how times are shown.
- Users per version on A/B Tests is an estimate: the app picks each person's version on their phone.
- Minutes listened and feedback screenshots are not collected by the app, so Song Stats shows plays per person and feedback cards show no picture.
- Existing phones join the notification audience only after they register again while signed in (Android on its next open, the web app within a day).
- Blocking a user stops new sign-ins and session checks at once; other account routes accept their existing session until the app next checks it.
