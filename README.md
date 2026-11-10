# VinaX

VinaX is a free music web app and Android app built from one codebase and backed by one edge Worker. It plays from a public catalogue, learns a listener's taste, and builds what plays next from it. There are no ads, no subscription and no payment. Listeners sign in with Google; the library, history, taste profile and settings live on the device and sync to the account.

This README is the single document for the repository: what the product is, how the code is organised, how to run, check, release and deploy it, how to operate it, and the reference for each subsystem (database, owner console, Android, VinaX AI, recommendations, design system, privacy) plus a condensed listener guide.

Version source of truth: `frontend/src/constants/version.ts` (`LATEST_VERSION`, `DISPLAY_VERSION`). The current line is **VinaX V2**, which restarted at 1.0.0 after 15.0.1; listeners see "VinaX V2 <major>.<minor>" (for example "VinaX V2 1.11"). The Worker has its own number in `backend/package.json`.

## Table of contents

- [What a listener gets](#what-a-listener-gets)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Checks and testing](#checks-and-testing)
- [Releases](#releases)
- [Workflows](#workflows)
- [Deployment](#deployment)
- [Secrets and environment variables](#secrets-and-environment-variables)
- [Operations](#operations)
- [Database](#database)
- [Owner console](#owner-console)
- [Android](#android)
- [Android push setup](#android-push-setup)
- [VinaX AI](#vinax-ai)
- [Music AI and song generation](#music-ai-and-song-generation)
- [The personal engine](#the-personal-engine)
- [Recommendations on the device](#recommendations-on-the-device)
- [Offline evaluation of next-song selection](#offline-evaluation-of-next-song-selection)
- [Design system](#design-system)
- [App styles](#app-styles)
- [Festival themes](#festival-themes)
- [Charts, trends and canvas clips](#charts-trends-and-canvas-clips)
- [Data and privacy](#data-and-privacy)
- [SEO and indexing](#seo-and-indexing)
- [Legal and copyright](#legal-and-copyright)
- [Real-device QA script](#real-device-qa-script)
- [Listener guide](#listener-guide)
- [Documentation conventions](#documentation-conventions)
- [History](#history)

## What a listener gets

- **Sign in with Google.** One tap; the Google photo is the profile picture; library, playlists, history, taste and settings follow the account to every device. Destinations: Home, Discover, Search, Library. On the website, Explore, Discover, Charts, Search and every song, album and artist page can be browsed before signing in; play, like and save ask for the account right there.
- **A queue that builds itself.** Tap a song and the queue fills five songs at a time. Radio plays endlessly from a song, artist, mood or station. Pin a mood or Tune this queue rebuilds Up Next at once; Familiar, Balanced and Discover set how adventurous the picks are. Never repeat keeps every automatic song one the listener has never heard.
- **A full player.** Reorderable queue, synced lyrics, sleep timer, crossfade, sound settings, lock-screen and headset controls, casting, drive mode, karaoke, a song's video clip in the artwork card (the clip's own shape where the cover sits, an Artwork / Video chip, a full-screen view with double-tap to like and a quality chip), and a Together tab beside Up next, Lyrics and Credits. Flow is a full-screen feed of song previews.
- **A library on the device.** Favourites, playlists, Listen Later, smart collections, history and stats. One-file backup with preview, merge or replace and Undo; an encrypted one-time link moves everything to another device.
- **VinaX AI.** Opt-in chat assistant at `/vinaxai` for signed-in listeners: Auto model choice with failover, web search with numbered sources, reasoning display, photos/PDF/text files, artifacts (code, pages, diagrams) in a side panel with safe preview, projects, memory, share links, dictation, Read aloud and Live voice.
- **The personal engine.** Signed in, Home opens with shelves composed from a server-side taste model ("Made for you", "Because you liked...", languages, discoveries, rediscoveries, listeners like you), arranged by VinaX AI with a one-line reason each. **Make me a playlist** turns plain words into a playlist. One switch (Settings > Region & privacy) turns it off; **Erase my taste model** removes what it learned.
- **Music AI with the device in charge.** AI order for Up Next, AI-built Home (shelves, order, titles, "Made for right now"), AI DJ and AI Playlist (may suggest songs by title and artist, which the device resolves in the catalogue), lyrics tools, and where enabled "Generate a song like this" (labelled "AI generated" everywhere). Every AI feature has an on-device fallback and the app works with no AI secrets.
- **Friends and sharing.** Opt-in public profile at `/u/<handle>`, follow listeners ("Friends are listening"), Blend, shared playlists (public page or invite link), Listen Together rooms with names, chat, vote-to-skip and "save this session".
- **Daily discovery.** Discover 5, "Songs like this" with a reason, release alerts for followed artists (the `/following` page), weekly goals and streaks, 17 badges, Wrapped-style year story, focus sounds, Auto EQ per song, drive-mode voice commands, playlist import (CSV/M3U/text), smart downloads on Android.
- **Reactions.** Five public reactions (fire, love, feels, dance, wow) per song, one per device per song; counts are public, who reacted is not.
- **Looks.** Six app styles (Lumen default, Verdant, Monsoon, Harbour, Verse, Onyx), each with dark, light and true-black themes and every accent; 43 festival skins that apply on the festival's days and a one-time greeting card.
- **Festivals, live.** `/festivals` (Explore > Festivals) shows today's festival as LIVE with "Day x of y" and a clock to its end, or the next one with a countdown that ticks every second, the next eight with dates, wishes to share, and every one of the 43 looks as a card to preview, pin or play. On a festival's days one canvas behind the app plays that festival's own effects in its colours (Diwali diyas and fireworks, Holi colour powder, Sankranti kites, Eid lanterns, Christmas snow, New Year fireworks and confetti; petals, balloons, hearts and leaves for the rest), confetti greets the first Home of the day, a tap on the festival banner fires fireworks, and Settings > Appearance has Festival animations, Festival sounds (off by default) and Festival look (Automatic or a pinned festival).
- **Listening moments.** From the play history on the device, VinaX knows what this listener plays at each time of day on weekdays and weekends; Up Next scores those artists and languages higher, the AI DJ and the AI rerank are told the moment and its artists, Home gets "For your weekday evenings", and the Queue page names the moment. Settings > Recommendations > Time and day awareness switches it off.
- **Ideas & bugs.** The lightbulb in the top bar opens a popup on every platform (Android app, iPhone and iPad web, Windows, Mac, Linux) to suggest a feature or report a bug; the device, app version, screen, language and page are read for the listener and shown before sending; it lands in the console's Feedback inbox.
- **Comfort.** Keyboard shortcuts, reduced motion, high contrast, display size, density, Kid mode, app language (English, Telugu, Hindi, Tamil menus), guided tours (seven live tutorials in Help).
- **Android app.** Same app with background playback, notification and lock-screen controls, widgets, offline downloads, push, in-app updates. iPhone/iPad: Add to Home Screen from Safari (keeps playing with the screen off; sound effects are not available in Safari there).
- **Device-first data.** A service worker keeps the app shell and downloaded songs available offline. Anonymous usage statistics (which song, city-level location) are shared by default and can be switched off; third-party session insights are off unless turned on. No advertising anywhere.

## Architecture

```text
 Browser or Android app
 +-----------------------------------------------+
 | frontend/  static single-page app             |
 |  stores -- device storage (local, IndexedDB)  |
 |  recommendation engine, audio engine          |
 |  service worker: shell + offline audio        |
 +-----------------------+-----------------------+
                         | same origin (/api, /img, /apk)
 +-----------------------v-----------------------+
 | backend/worker  edge Worker "vinax-api"       |
 |  /api/*: catalogue proxy, sign-in and sync,   |
 |  usage events, rooms, push, status, owner     |
 |  console API, personal engine, VinaX AI       |
 |  /img, /apk, host redirects                   |
 |  anything unmatched -> the static site        |
 |  Cron Trigger every 5 min: jobs               |
 +-----------------------+-----------------------+
                         | service-role key (Worker secret)
 +-----------------------v-----------------------+
 | one hosted database (backend/supabase/)       |
 +-----------------------------------------------+
```

| Piece | What it is | How it deploys |
| --- | --- | --- |
| Static frontend | `frontend/` built to `dist/`: a single-page app (every page a lazy chunk), prerendered static routes, song/album/artist/hub pages, the owner console (`/admin/`) and the status page (`/status/`) | The static host's Git integration builds `frontend/` on every push to `main`. No workflow here deploys it (the daily SEO workflow deploys with `wrangler pages deploy`) |
| Worker `vinax-api` | `backend/worker/`: one Worker, no framework. Answers only the routes in `backend/worker/wrangler.toml`; unmatched URLs fall through to the static site (`ASSETS_HOST`) | **Deploy Worker** workflow on a push to `main` touching `backend/**` |
| Database | One hosted Postgres project; schema is `backend/supabase/schema.sql` (tables, `directory` view, `stats_*` and other functions, deny-all row-level security). The Worker is its only client | Paste `schema.sql` into the SQL editor once (idempotent), or let the **Schema** workflow apply it |
| Android package | The same bundle in a generated Capacitor wrapper with a native media service | **Build Android APK** (dispatched by **Auto release**), **Release APK** on a `v*` tag |
| VinaX AI sandbox | `sandbox/`: one-page static site on its own origin for artifact previews | Separate static project `vinax-sandbox` |

The two halves deploy separately and either can fail alone. The frontend holds no secrets; `VITE_*` variables are visible to every visitor. Row-level security is forced on every table with no policy, so only the Worker's service-role key can read or write; the app and console never hold a database key.

Main packages: `react` 19, `react-router-dom` 6, `zustand` 4 (persist), `@tanstack/react-query` 5, `tailwindcss` 3 plus hand-written token CSS, built with `vite` 8 and `typescript` 5; `@capacitor/*` 8 for Android; `wrangler` 4 for the Worker; `vitest` 4, `@playwright/test` and `@axe-core/playwright` for tests. The Worker reaches the database over its REST interface with `fetch` (no client library).

### App shell (`frontend/src/main.tsx`)

1. Imports `services/storage/earlyMigrations` first so renamed storage keys are in place before stores rehydrate.
2. Renders `<App />` and loads global CSS in order: `styles/index.css` (tokens, base), `shell.css` (frame), `features.css`, `templates/index.css` (app styles), `festivals.css` (generated). Page styles in `styles/pages/` ship with their lazy page.
3. Removes `boot-still` after the first painted frame; on `vite:preloadError` reloads once per session (not offline).
4. Sets `device-phone|tablet|desktop|tv` and `pointer-coarse|pointer-fine` classes on `<html>`.
5. Registers `/sw.js` in production web builds and asks it to precache the full asset graph on boot and when the network returns.

`src/layouts/AppLayout.tsx` is the frame for every route: sidebar (from 768 px; 80 px rail below 1100 px), top bar, routed page in an error boundary, the player (compact card above the four-destination tab bar on phones/tablets; floating deck from 1024 px), Now Playing panel on wide workspaces, snackbars, welcome sheet, command palette, and (only while a Listen Together session is live) the lazy `TogetherController`. It runs the one-time bootstrap (storage migrations, `initEngine()`, downloads, consent-gated telemetry, lock-screen lyrics, TV spatial navigation, alarm, output watcher, cast), owns scroll memory and hardware-back handling, and hides its chrome on `/vinaxai*` and Now Playing.

### Routing and lazy chunks

`src/router/index.tsx` builds one browser router; every page is `lazy()`. `/vinaxai`, `/vinaxai/c/:id`, `/vinaxai/projects`, `/vinaxai/project/:id`, `/vinaxai/artifacts` and `/vinaxai/share/:id` are VinaX AI. `/VinaXAI` redirects to `/vinaxai` in the router (not `_redirects`: a rule there could match `/vinaxai` and loop); `/ai-playlist` redirects to Home. Language hub pages (`/<language>-songs`) and mood hubs (`/<language>-<mood>-songs`) come from `constants/languages.ts` and `constants/hubs.ts`. An offline Android boot with saved downloads opens `/offline`; the "Startup page" setting can open Search, Library or the last main route. `vite.config.ts` groups first-load code into `router`, `vendor`, `data` and `core` chunks; `core` lists small modules already in the first-load graph by explicit path (see [Checks and testing](#checks-and-testing)).

### The look pipeline

`settingsStore` (`vinax.settings.v1`: `template`, `theme`, `accent`, `accentCustom`, `dynamicTheme`, `highContrast`) -> before first paint an inline script in `frontend/index.html` sets `data-template`, theme classes, canvas colour and `html.fest-<id>` from an inlined festival window table -> at run time an effect in `AppLayout` calls `applyThemeClasses(resolved, root, template)` (`src/utils/theme.ts`: `.light/.dark/.amoled`, `data-template`, `<html>` background, `theme-color` meta) and sets `data-accent` or a custom ramp (`utils/accentRamp.ts`). Details in [Design system](#design-system).

### Stores and persistence

| Store | Key | Holds |
| --- | --- | --- |
| `playerStore` | `vinax.player.v1` | queue, index, repeat, shuffle, volume, muted, rate |
| `settingsStore` | `vinax.settings.v1` | every preference |
| `libraryStore` | `vinax.library.v1` | favourites, playlists, Listen Later, saved albums/artists, hidden songs |
| `historyStore` | `vinax.history.v1` | last 150 plays |
| `searchStore`, `searchWorkspaceStore` | `vinax.search.v1`, `vinax.search.workspace.v1` | recent, pinned, saved searches |
| `smartCollectionStore`, `bookmarkStore`, `downloadsStore`, `alarmStore`, `outputStore`, `lyricsOffsetStore` | their own `vinax.*` keys | what the names say |

The taste profile is not a store: `src/services/personalization/` reads/writes `vinax.profile.v1` (and `vinax.profile.kid.v1` in Kid mode). `src/constants/storage-keys.ts` is the key registry; the listen-event log is in IndexedDB (`services/storage/idb.ts`). All persisted stores write through `services/storage/local.ts`:

- **Guarded storage:** reads never throw; a failed write shows one toast per session ("Storage is full ...").
- **Write freeze:** a restore writes straight to `localStorage` then reloads; `freezeLocalWrites()` drops every store-driven write until the reload so live stores cannot persist old state over restored keys. Only `writeLocalBatch()` (all-or-nothing, rolls back on failure) still writes.
- **De-duplicated player persistence:** `createDedupedStorage()` skips writes when no persisted field changed by reference (progress ticks do not write). On rehydrate the player store treats its record as untrusted (malformed songs dropped, scalars clamped).

### Catalogue client (`src/services/api/client.ts`)

Catalogue reads go through `orchestratedRequest()`. Pages use `@tanstack/react-query` with `retry: 0`, 5-minute stale time, 30-minute cache time (`services/queryClient.ts`) because retrying is the orchestrator's job.

- **Bases** (`constants/endpoints.ts`): a dedicated catalogue API host, the same-origin Worker catalogue `/api/cat` (web only), and the production origin's `/api/cat`. `VITE_API_BASES` replaces the list at build time; the console can switch bases off.
- **Ranking:** each base by expected time to success (latency EWMA + failure odds x failure cost, stretched per consecutive failure). Three failures in a row cool a base 60 s; all are still tried when every one is cooling.
- **Priority:** `interactive` (Search, typeahead, `getSong`) best base first, hedged to the next base after the base's own p75 (350-900 ms), first valid answer wins, loser aborted and not a failure; `background` (shelves, recs, prefetch; default for searches) first base drawn at random weighted by health, never hedged; `standard` best first, no hedge.
- **Back-off:** 429/503 cool a base for `Retry-After` (30 s if missing, clamped 1 s-10 min). At most six requests in flight per base; interactive callers queue ahead of background.
- **Soft misses:** a payload the validator rejects, or HTTP 404, tries the next path dialect with no health strike. Up to two full passes with a 600 ms pause.
- **Memo:** `cacheMs` (5 s for searches and song lookups) shares identical in-flight calls and reuses answers (40 kept).
- **Deadlines:** 8 s per attempt (`REQUEST_TIMEOUT_MS`), 20 s for the ladder (`REQUEST_DEADLINE_MS`). Cancellation via `AbortSignal` never counts as failure.
- **Boot prefetch:** `index.html` starts the first trending request and parks the promise on `window.__vxBoot`.
- Payloads are normalised in `services/api/normalize.ts` (API `artists: { primary: [...] }` -> app `artists: [...]`).

### Audio engine and media session

`src/services/audio/engine.ts` exports one `audioEngine` owning a single `<audio>` element; the player store is its only consumer. Sources are ordered by bitrate against the quality preference (downloaded copy first); a failing source advances to the next variant, a source that had been playing gets one same-position retry. Stall timer, fades, rate, `setSinkId` and next-track preloading live here; effects (`effects.ts`) can be bypassed. `services/media-session/index.ts` publishes metadata/state/position to the browser media session or, on Android, to the `VinaXMedia` plugin (see [Android](#android)). `services/native/index.ts` bridges platform checks, notification permission, download/update helpers.

### Listen Together

| Piece | File | Role |
| --- | --- | --- |
| Session store | `services/together/session.ts` (`useTogether`) | mode `idle\|host\|guest`, room code, status `connecting\|live\|reconnecting\|host-away`, queue, drift, `needsTap`; mode and code kept in `sessionStorage` (`vinax.together.session.v1`) so a reload rejoins |
| Controller | `features/together/TogetherController.tsx` | lazy; shows the Live pill on every page except `/together` |
| Engine | `features/together/engine.ts` | `runSession`, `startHosting`, `joinSession`, `leaveSession`, `addSong`, `react`, `tapToListen` |
| Sync | `features/together/sync.ts` | `HostClock`, `decideCorrection`, `hostIsAway`, `ReactionFeed` (pure, unit-tested) |
| Invites | `features/together/invite.ts` | `inviteUrl` (what the QR encodes), `codeFromScan`, `appIntentUrl`, `deepLinkPath` (pure, unit-tested); `useInviteQr.ts` draws the QR on the device |
| Join | `features/together/JoinRoom.tsx`, `QrScanSheet.tsx` | Room code field plus "Scan the host's QR": the camera runs only while the sheet is open, read by `BarcodeDetector` or the lazy `jsqr` fallback. Needs `camera=(self)` in `public/_headers` and `CAMERA` in the APK (`scripts/patch-android.js`) |
| Player tab | `features/together/TogetherPanel.tsx` | The Together tab of `/now-playing`: start a room on the playing song, join, or (live) code, QR, share, open the room |
| Website to app | `features/together/OpenInApp.tsx` | Android browsers only: an `intent://` link that opens the room in the app (package `app.Vinax.music`), falling back to `/download`. The APK's `MainActivity` takes `https://(www.)vinaxmusic.online` links (not auto-verified: no `assetlinks.json`); `AppLayout` reads them with `App.getLaunchUrl` / `appUrlOpen` and navigates |
| Room API | `services/together/index.ts` -> `GET`/`POST /api/room` | create, update, request, heartbeat, react, leave (also `sendBeacon`), end |

Host pushes the playing song, position, play state and next eight songs on any change (or a seek over 2 s); polls members/reactions/requests every 4 s. Guest polls every 2 s, heartbeats every third poll. The room only names a song (id, title, artwork; the server keeps no stream URLs), so a guest looks the host's song up in the catalogue (`getSong`) before playing it, as the host does for a guest's request; a song the guest's device cannot get is said once, shown on the room page, and retried after 20 s. `GET /api/room` returns the server clock `now`, so `HostClock` projects the host playhead as `position + (now - updated_at) + half the round trip`. Corrections seek only when drift exceeds 1.0 s playing (2.0 s paused), never while buffering, within 3 s of the last correction, or within 1.5 s of a track start. A guest whose song ran out within 2 s of the host's end waits for the next song instead of pressing play. Only a host `update` moves `updated_at` (a chat line does not), because followers measure the playhead from it. Two failed play attempts raise `needsTap`. No host push for 90 s marks the host away (a note, not a disconnect). Server: `functions/api/room.ts` keeps `rooms` and `room_members`; the six-character code is the join credential; the host token (returned once) authorises `update`/`end`; guest `request` goes through the atomic `room_request` function; rooms idle six hours are swept by housekeeping; without the database every verb answers `503 not_configured`.

### Service worker (`frontend/public/sw.js`)

| Request | Strategy |
| --- | --- |
| Page navigations the app answers | Network first; cached shell offline |
| Hashed `/assets/` | Cache first |
| `/offline-audio/<id>` | From the `vinax-audio-v1` cache with Range support |
| Catalogue APIs, artwork, audio streams, `/api/*`, `/admin/`, status page | Passed through, never cached |

The build emits `/precache-manifest.json` (`precache` = everything reachable from the entry; `onDemand` = chunks nothing reaches). Install and every `PRECACHE` message download the list, refresh shell entries and prune assets in neither list. The audio cache is never cleared on activate. The worker also shows push notifications and routes their clicks.

### Worker routes (`backend/worker/index.ts`)

Router plus an adapter giving each handler `{ request, env, params, next, waitUntil, data }`. Resolution order: (1) host middleware `functions/_middleware.ts` (apex -> `www` fallback, `update.` -> APK download, `admin.` -> `/admin/`); (2) exact-path table for every `/api/**` handler, `/apk`, `/img`; (3) dynamic entity routes (`/song/:id`, ...) kept in code but not Worker routes in production; (4) `/api/cat/*`, the self-hosted catalogue (stream URLs resolved at play time and redirected, audio bytes do not pass through the Worker); (5) single-segment hub allow-list `functions/[hub].ts`; (6) anything else fetched from `ASSETS_HOST`. A module with no handler for the method answers `405`. **A new handler under `worker/functions/api/` needs an import and an exact-path entry in `worker/index.ts`**; `worker/__tests__/routerCoverage.test.ts` fails otherwise (an unrouted handler falls through to the static site and answers 405, which a dry-run cannot see).

| Route family | Purpose |
| --- | --- |
| `/api/cat/*`, `/api/recommendations`, `/api/trending-searches`, `/api/blocklist` | Catalogue and content; "songs like these" |
| `/api/events`, `/api/feedback`, `/api/geo`, `/api/username`, `/api/handoff`, `/api/room` | Consented usage events, feedback, coarse region, handle (`409 taken` with suggestions), device-transfer relay (`HANDOFF` KV), Listen Together |
| `/api/appconfig`, `/api/experiments`, `/api/announcements`, `/api/site-mode`, `/api/version`, `/api/status`, `/api/apk`, `/api/robots` | Published settings (sanitised by `_lib/clientConfig.ts`, edge-cached), experiments, site mode, Android update source, live probes + 90-day history |
| `/api/push/*` | VAPID key; subscribe/register write `push_devices` (channel `web` or `fcm`); unsubscribe; `push/opened` |
| `/api/auth/*`, `/api/account/data` | Google sign-in, signed 30-day session, `accounts` row; synced copy in `account_backups` with optimistic versions (`200`, `204`, `409`) |
| `/api/profile`, `/api/follow`, `/api/shared-playlist` | Public profiles, follows, shared playlists |
| `/api/personal/*` | The personal engine |
| `/api/ai/*` | VinaX AI and music AI; provider keys never leave the Worker |
| `/api/cron/run` | Run one job now (`x-cron-secret` or owner token) |
| `/api/trends` | Always empty (`sources: []`) |
| `/api/admin/*` | Owner console API, server-side admin auth on every request |

Data layer `_lib/db.ts`: only code that talks to the database; service-role key; 8-second deadline per request; paging above 1,000 rows; results never throw (`{ ok, rows }` or `{ ok: false, error }` with `not_configured | unauthorized | not_found | conflict | bad_request | unavailable`). Companions: `edge.ts`, `identity.ts` (signed device ids), `settings.ts` (`SETTING_KEYS`, one-minute memo), `audit.ts` (secret redaction), `admin.ts`.

### How a play flows

1. Tap a song -> `playQueue()` on the player store runs intake gates (Kid mode drops explicit songs; duplicates collapse), starts a playback instance, loads the audio engine, publishes to the media session.
2. With "Build every queue" on, the store lazily loads the recommendation engine and asks for the next five songs, in the seed's language, familiar first, inside one deadline; songs pass the admission gate and are appended.
3. The playback instance measures what is heard; a play counts toward taste after five seconds heard; an early leave is marked skipped in history and session signals only.
4. Only changed persisted fields (queue, index) are written.

Data flows: listening events -> `personalization/updater` -> `vinax.profile.v1` (and, with consent, usage analytics); candidates -> hard filter -> scoring -> sequencer -> validation -> admission gate -> queue; owner settings -> `POST /api/admin/settings` -> `settings` row (+ history + audit) -> `/api/appconfig` (sanitised, cached) -> app (5-minute stale time); consented usage -> `POST /api/events` + `x-vinax-consent` -> `events` + `listeners` -> `stats_*` functions -> console; housekeeping purges old events.

## Repository layout

```text
frontend/
  index.html                  shell markup and the pre-paint script (theme, app style, festival)
  src/main.tsx                boot: migrations, global styles, render, service worker
  src/router/                 routes; every page is a lazy chunk
  src/layouts/AppLayout.tsx   the frame: sidebar, top bar, dock, player, overlays
  src/pages/                  routed pages
  src/components/             shared UI
  src/features/               feature folders (home, search, player, radio, together, settings, festival, vinaxai, ...)
  src/store/                  state stores
  src/services/               recommendation, personalization, api, audio, media-session, push, storage, ai, personal, ...
  src/constants/              app styles, festivals, version.ts, changelog.ts (What's New card), storage-keys.ts
  src/styles/                 tokens (index.css), frame (shell.css), templates/, pages/, festivals.css (generated)
  public/                     sw.js, admin/ (owner console), status/ (status page), fonts/, _headers, _redirects, robots.txt
  scripts/                    prerender, changelog.json, bundle budget, CSP hashes, e2e smoke, edge integrity, Android patch, festivals, evaluation, auto-release
  e2e/                        browser specs and harness
  eval/                       offline evaluation of next-song selection
  native-android/, android-res/   native code and resources copied into the generated Android project
  ci/debug-keystore.b64       public CI debug keystore (never signs a release)
backend/
  worker/index.ts             router and scheduled handler
  worker/functions/api/       public, auth/, account, push, cron, ai/, personal/, admin/ endpoints
  worker/functions/_lib/      db.ts and companions, catalogue, admin auth, rate limits, ai/, personal/, trends/
  worker/__tests__/           Worker tests
  worker/wrangler.toml        name, routes, vars, bindings, Cron Trigger
  supabase/schema.sql         the whole database (idempotent)
  supabase/reset.sql          drops everything so schema.sql can start over
  supabase/check.sql, ci.sh   the schema proof run by the Schema workflow
  supabase/remove-ai.sql      one-off removal of the pre-version-3 AI tables
  scripts/ai-probe.mjs        provider probe (npm run ai:probe)
  scripts/cf-edge-rules.mjs   zone WAF rules operator script
  .env.example                every Worker secret/var name, documented
shared/identity-vectors.json  song-identity test vectors run by both packages
sandbox/                      VinaX AI artifact preview runner, its own static site
.github/workflows/            checks, deploys, Android builds, uptime probe, SEO build
```

Do not commit secrets, generated build folders (`dist/`, `frontend/android/`) or personal exports.

## Running locally

Node.js 22 or newer and npm. Start the Worker first, then the app.

```sh
# Terminal 1 - the Worker on port 8787 (wrangler dev)
cd backend && npm ci && npm run dev

# Terminal 2 - the app on port 5173
cd frontend && npm ci && npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api`, `/img` and `/apk` to `127.0.0.1:8787` (`frontend/vite.config.ts`).

Secrets are optional for a first run: without them the catalogue works and the owner console cannot sign in; without the two database secrets data features answer their "not configured" shapes (no sync, rooms, feedback, push registration) and console pages show setup cards. Local secrets go in `backend/worker/.dev.vars` (git-ignored), one `NAME=value` per line; names are in `backend/.env.example`. Never put a secret in a `VITE_*` variable.

| Where | Command | What it does |
| --- | --- | --- |
| `frontend/` | `npm run preview` | Serves the built `dist/` |
| `frontend/` | `npm run format` / `backend/` `npm run format` | Prettier on `src/` / `worker/` |
| `frontend/` | `npm run gen:festivals` | Regenerates festival CSS and tables after editing festival constants |
| `frontend/` | `node scripts/eval-recs.mjs` | Offline evaluation of next-song selection |
| `frontend/` | `npm run cap:add:android`, `npm run cap:sync`, `npm run android:debug` | Generate, sync, build Android locally (Java 21 JDK + Android SDK) |
| `frontend/` | `npm run deploy:pages` | Build and `wrangler pages deploy dist --project-name vinax` |
| `backend/` | `npm run deploy` | `wrangler deploy --config worker/wrangler.toml` |
| `backend/` | `npm run ai:probe` | Provider/voice probe with your own keys |

### Where to change things

| To change | Edit |
| --- | --- |
| Design tokens, frame, page styles | `src/styles/index.css`, `shell.css`, `pages/*.css` |
| An app style | `src/styles/templates/`, `src/constants/templates.ts`, `src/utils/theme.ts`, pre-paint script in `index.html` ([Adding an app style](#adding-an-app-style)) |
| Festival themes | `src/constants/festivals.ts`, `festivalThemes.ts`, `festivalVisuals.ts`, `festivalEmblems.ts`, then `npm run gen:festivals` |
| The shell | `src/layouts/AppLayout.tsx`, `components/TopBar.tsx`, `BottomNav.tsx`, `Sidebar.tsx` |
| Routes | `src/router/index.tsx` |
| What plays next | `src/services/recommendation/`, `src/store/playerStore.ts` |
| Welcome sheet, tours, Help | `components/OnboardingSheet.tsx`, `features/tutorials/tutorials.ts`, `components/TutorialRunner.tsx`, `pages/HelpPage.tsx` |
| Backup and restore | `features/settings/backup.ts`, `BackupCenter.tsx` |
| The owner console | `public/admin/` |
| Android native code | `native-android/`, `scripts/patch-android.js` |

## Checks and testing

### The gates

CI (`.github/workflows/ci.yml`) and `e2e.yml` run these on every pull request and push to `main`. Run them locally in this order.

```sh
cd frontend
npm ci
npm run lint                         # eslint src scripts --max-warnings 0
npm run typecheck                    # tsc --noEmit
npm test                             # vitest run
npm run build                        # clean, tsc, vite build, prerender, entity prerender, changelog.json, admin stamp, robots
node scripts/check-bundle-size.mjs   # needs the build
npx playwright-core install chromium # once
npm run e2e                          # needs the build
```

```sh
cd backend
npm ci
npm run lint                         # eslint worker --max-warnings 0
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/wrangler-dry
```

`npm run build` first deletes `dist/` and the build caches (`prebuild:clean`) - do not run it in a checkout whose dev server someone is using; use the worktree recipe below. Schema changes have their own workflow ([Database](#database)); `lighthouse.yml` audits prerendered routes (accessibility and search checks fail the run; performance is advisory).

### Bundle budget (`frontend/scripts/check-bundle-size.mjs`)

Reads `dist/index.html`, sums the gzipped `/assets/*.js` it references. In the script today: first-load JavaScript total `FIRST_LOAD_BUDGET` = **194 KB** gzipped, each first-load chunk under **80 KB**, each on-demand chunk under **160 KB**; a value equal to a limit fails. The script header is the ledger: every time the first-load limit moved it records date, measured sizes and why the code cannot be lazy. Grow it only with an entry in the same style. A few large diagram/maths libraries are exempt only while they stay out of the first load. The `core` chunk group in `vite.config.ts` lists modules by explicit path, never a folder; before adding a path confirm first-load code imports the module, rebuild and re-run the budget.

### Unit tests

Both packages use `vitest`. Frontend tests sit next to code as `*.test.ts(x)` plus `src/__tests__/`; default environment Node, DOM files start with `// @vitest-environment jsdom`; `e2e/`, `dist/`, `android/` are excluded. Backend handler tests sit next to handlers with wider ones in `worker/__tests__/`. `frontend/src/__fixtures__/songs.ts` has deterministic `makeSong` fixtures (no randomness, no clock). Run one file: `npx vitest run <path>`.

### Contract tests (they lock a rule, not a behaviour)

| Test | Guards |
| --- | --- |
| `frontend/src/constants/templates.test.ts` | Six app styles with unique ids/names, default among them, unknown ids fall back, no entry names another product; each style file imported by `templates/index.css` and styles only its own selector; colour blocks stand down under a festival skin; accent applies only while no accent chosen; pre-paint canvas equals `--ink-900`; every accent contrast-checked in every style and both themes; Black stays true black and high contrast stays above every style |
| `frontend/src/utils/theme.test.ts`, `src/__tests__/contrast.test.ts` | Colour tokens, one 10/14/20 px radius scale, glass dials, theme resolution (`system` follows OS; `auto` is light 07:00-18:59), WCAG AA token pairs |
| `src/features/settings/TemplatePicker.test.tsx` | Picker is one radio group; arrows move/wrap; cross-fade via view transition unless reduced motion |
| `src/constants/festivals.test.ts`, `festivalVisuals.test.ts`, `components/FestiveSplash.test.tsx` | Unique ids, a theme/emblem/blurb/query for each festival, sane windows, generated artefacts (`festivals.css`, `index.html` window table, `public/admin/festivals.js`) in sync, no remote URLs, light accents 4.5:1, particles capped 14 phone / 24 desktop |
| `src/features/tutorials/tutorials.test.ts` + runner/onboarding tests | Every tour target (`data-tour`, aria-label, id, class) exists in source |
| `src/__tests__/cspHashes.test.ts` | Inline-script hashes in `public/_headers` match `index.html` (after changing an inline script: build, then `node scripts/csp-hashes.mjs`) |
| `src/__tests__/swShell.test.ts`, `sessionInsights.test.ts` | Service-worker shell list; consent gating |
| `src/constants/release.test.ts` | `LATEST_VERSION`, `package.json` and top changelog entry agree |
| `src/constants/typography.test.ts` | No font on `#root`; no style leads a stack with a system font |
| `src/__tests__/glass.test.ts` | Materials keep AA over any cover |
| `src/__tests__/adminConsole.test.ts` | Console structure and rendering (see [Owner console](#owner-console)) |
| `backend/worker/__tests__/routerCoverage.test.ts` | Every handler file is routed |
| `backend/worker/__tests__/schemaUsage.test.ts` | Worker and `schema.sql` agree: every `db.*` call walked with the TS compiler; each table/column/function argument must be declared in the schema |
| `backend/worker/__tests__/eventsMeta.test.ts` | `events.meta` capped in bytes like the DB constraint |
| `identityContract.test.ts` (both packages) | Song-identity vectors in `shared/identity-vectors.json` |

### Browser end-to-end (`npm run e2e`)

1. `node scripts/e2e-smoke.mjs`: no built `/assets/*.js` is secretly HTML; boots the built app in a real browser with every external request aborted, confirms mount and client navigation.
2. `playwright test` runs `frontend/e2e/` specs (`playwright.config.ts`).

Harness: specs import `test`/`expect` from `e2e/support/test.ts` (every context starts signed in with a test account unless the URL has `?e2e-signed-out`; festival greeting dismissed with Escape unless `test.use({ dismissFestivalGreeting: false })`). Playwright's `webServer` runs `e2e/support/serve-dist.mjs` serving `frontend/dist/` on port 4173 (`E2E_PORT`): static files, directory indexes (`/admin/`), `/song/x` from `song/x.html`, SPA fallback, plain 404 for a missing `/assets/` file; exits if `dist/index.html` is missing, so build first. Specs run in parallel (half the cores locally, two workers on CI), fresh context per test, 1280x900, `en-IN`, `Asia/Kolkata`, 120 s budget; every non-localhost request is aborted and `/api/**` answered with `page.route`. A red run means the app broke, not the network. `smoke.spec.ts` and `qa-sweep.spec.ts` are excluded (sweep: `QA_SWEEP=1 npx playwright test e2e/qa-sweep.spec.ts`, ~8 minutes, walks every route five ways including 390 px where sideways scroll fails). Failures keep trace, screenshot and `error-context.md` under `test-results/`; CI uploads `playwright-report`. Test browser: `npx playwright install chromium` or `E2E_CHROMIUM_PATH`; `E2E_PRINT_REQUESTS=1 npx playwright test e2e/home-requests.spec.ts` prints per-endpoint request counts while Home loads. Useful: `npm run e2e:ui`, `npx playwright test <file> --headed`, `-g "<name>" --debug`, `npm run e2e:report`, `npx playwright codegen http://localhost:4173`.

Accessibility gate `e2e/a11y.spec.ts`: axe-core on 15 pages in dark and light (five again at phone size) plus sign-in, forced festival greeting and erase dialog (38 scans); any WCAG 2.0/2.1/2.2 A/AA violation fails. Axe marks contrast "incomplete" over glass/gradients/images, so contrast there and focus order need a manual pass. Prefer no `aria-label` and let visible text be the name (`label-content-name-mismatch`, WCAG 2.5.3).

Feature specs: `v100-together.spec.ts` (Listen Together across pages with an in-memory `/api/room` stand-in that strips songs to what the real server keeps, and a generated silent WAV with byte ranges), `v101-search.spec.ts` (combobox typeahead, Top result, hedged allotment when the first base stalls), `festivals.spec.ts` (forced festival skins in both themes), `v101-flow.spec.ts`, `console-shell.spec.ts`, `console-pages.spec.ts` (every console page with data, empty and failing server; mocks in `e2e/support/console-mocks/`). Unit tests pin allotment (`services/api/allotment.test.ts`), together sync/engine, toasts, glass, `roomSync`.

Fixture shapes: a mocked catalogue response (`/api/cat/**`) uses `artists: { primary: [{ id, name }] }`; anything seeded into `localStorage` uses `artists: [{ id, name }]` (derive with `artists: s.artists.primary`). Persisted records use the persist envelope `{ state, version }`. Seed `vinax.onboarded.v1`, a name and `vinax.last-seen-version` or the welcome/What's New sheets cover the page. Specs quoting interface copy change in the same commit as the copy. Guided tours have unit tests but no browser spec: after changing a tour, build, `npx vite preview`, and walk each tour at phone and desktop sizes (a target near the top needs `placement: 'bottom'`; a target far down a long page needs the step's `reveal` action).

### Verify one commit in a throw-away worktree

```sh
git worktree add /tmp/vinax-verify <commit-or-branch>
cd /tmp/vinax-verify/frontend && npm ci
npm run lint && npm run typecheck && npm test
npm run build && node scripts/check-bundle-size.mjs && npm run e2e
cd ../backend && npm ci && npm run lint && npm run typecheck && npm test
cd - && git worktree remove --force /tmp/vinax-verify
```

`node_modules` is not shared between checkouts; the build's clean step only touches its own folder; record the commit hash with the result.

### What tests cannot tell you

Whether the live catalogue is up (status page, console monitoring); whether a deploy landed (`/api/status`, `/changelog.json`, a route the change added - `/api/version` reports the Android release, not the Worker build); whether lock-screen controls, downloads, updates work on a phone ([Real-device QA script](#real-device-qa-script)). The browser suite proves the built frontend against mocked APIs only.

### Rules enforced

| Rule | Enforced by |
| --- | --- |
| No lint warnings, no type errors | `npm run lint` (`--max-warnings 0`), `npm run typecheck`, CI |
| Tests pass | `npm test` both packages; `npm run e2e` |
| Version, `package.json`, top What's New card agree | `release.test.ts` |
| Bundle budget | `check-bundle-size.mjs` |
| Inline scripts match CSP | `cspHashes.test.ts` |
| App styles keep their contract | `templates.test.ts` |
| Every Worker handler routed | `routerCoverage.test.ts` |
| No third-party product/company/music-service/AI-vendor names in interface text, comments, tests or documents | Review (`templates.test.ts` checks app-style text); exceptions in [Documentation conventions](#documentation-conventions) |
| Documents stay true | Fix a document in the same change as the code it describes |

## Releases

Every merge to `main` is a release. **Auto release** (`.github/workflows/auto-release.yml`, `frontend/scripts/auto-release.mjs`) bumps the patch version, writes the What's New card from the merged pull request's title and description (looked up from the merge commit, so any merge method gives the same card; with no PR, the commit message is used), pushes a `release: <version> - <title>` commit and dispatches **Build Android APK** on it (a push made with the workflow's own token starts no other workflow). The static host builds from the same push; Deploy Worker keeps its own push trigger. Write PR titles and bullet points for listeners.

- `#minor` or `#major` in the PR/commit **title** (subject) bumps more than the patch number. `[skip release]` in the title leaves the version alone; so does a description line that is exactly `release: skip` (`release: minor`/`release: major` likewise). Mentioning these words in a sentence of the description does nothing. A merge that already moved the version (the manual route) is released as is.
- Squash merges: GitHub's squash button lists branch commits in the message, not the PR description, so the card comes from the merged PR looked up by the workflow; merge with `--squash` and set the subject/body to the PR title and body.
- A **manual release** changes these together: `version` in `frontend/package.json` and the root entry of `frontend/package-lock.json`; `LATEST_VERSION` (semver) and `DISPLAY_VERSION` in `frontend/src/constants/version.ts`; a new What's New card at the top of `CHANGELOG_V2` in `frontend/src/constants/changelog.ts` (title and at least one change; pre-V2 releases live in `CHANGELOG_CLASSIC`; version names may repeat across lines because nothing compares names - Android updates compare build numbers, What's New compares a fingerprint of the top card); `version` in `backend/package.json` when the Worker changed (own numbering; 6.0.0 at frontend 12.0.0). `release.test.ts` fails when they disagree. If an inline script in `index.html` changed: build, run `node scripts/csp-hashes.mjs`.

Flow: branch -> PR (CI + E2E) -> merge -> Auto release commit -> static host builds the frontend; Deploy Worker (if `backend/**` changed) gates, verifies token, deploys, polls `/api/status` until 200; Build Android APK builds and publishes when signing secrets exist; a `v*` tag runs Release APK (refuses without the release keystore).

A pushed commit, green checks and a verified production are three separate milestones. **Verify production:** the static host's build succeeded; read the Deploy Worker log (it succeeds without deploying when the token is missing); the app shows the new version (Settings > About or `/changelog.json`); any route the change added answers; for Android, `/api/version` after its 60 s cache shows the new `build` and a `sha256`. The host's own Git build check for the Worker ("Workers Builds: vinax-api") fails on every commit because of an expired dashboard token, never because of the code ([The known-red check](#the-known-red-check)).

## Workflows

All in `.github/workflows/`. Times are UTC; scheduled workflows often start late.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | Push to `main`, PRs | Frontend and backend gates |
| `e2e.yml` | Push to `main`, PRs, by hand | Builds the app, runs the browser suite |
| `lighthouse.yml` | Push to `main`, by hand | Audits prerendered routes; accessibility and search checks fail, performance advisory |
| `worker-deploy.yml` (Deploy Worker) | Push to `main` touching `backend/**` or the workflow; by hand with optional `dry_run` | Gates, `wrangler whoami` token check, deploy, poll `/api/status` |
| `schema.yml` (Schema) | PRs and pushes touching `backend/supabase/**`; by hand with optional `apply` | Proves `schema.sql` on a fresh Postgres 16; on `main` applies it to production when `SUPABASE_DB_URL` is set |
| `auto-release.yml` | Push to `main`; by hand with optional `dry_run` | Version bump, What's New card, release commit, dispatches the Android build |
| `buildapk.yml` (Build Android APK) | Dispatched by Auto release; by hand with optional `strict` | Debug APK artifact; signed release when signing secrets exist |
| `release.yml` (Release APK) | Push of a `v*` tag | Signed release; refuses without the keystore |
| `seo-pages.yml` (Daily SEO pages) | 20:30 UTC (02:00 India time) daily; by hand | Grows the song/album/artist pages and deploys with `wrangler pages deploy` ([SEO and indexing](#seo-and-indexing)) |
| `diagnose.yml` | By hand; when its own file changes | Checks the live page's assets load and the app mounts headless; probes the catalogue route |
| `synthetic-uptime.yml` | Every 30 minutes | Probes the app shell, `/api/geo`, `/api/handoff`, runs `frontend/scripts/edge-integrity.mjs` (every asset the live shell references answers JavaScript); opens one de-duplicated issue "Synthetic uptime probe failed" |

Data jobs do not run on the code host: the Worker's own Cron Trigger runs them ([Operations](#operations)).

## Deployment

Both applications live on `main`; there are no separate frontend/backend branches.

### Frontend - static hosting

Static project `vinax`, connected to this repository:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 or newer |

`npm run build`: clean, `tsc --noEmit`, `vite build`, `scripts/prerender.mjs` (static routes, language/mood hubs, per-folder `404.html` shells), `scripts/prerender-entities.mjs` (song/album/artist pages), `scripts/changelog-json.mjs` (`dist/changelog.json`), `scripts/admin-stamp.mjs` (adds `?v=<hash>` to console scripts), `scripts/robots-from-api.mjs`.

The entity step runs only on the static host's own build (`CF_PAGES=1`); elsewhere it writes an empty `dist/entity-pages.xml` and stops (`PRERENDER_ENTITIES=1` runs it locally). It reads VinaX's own catalogue API first and public mirrors after, never this site's `/api`, and renders with the Worker's `entityPage()` as flat files (`dist/song/<slug>-<id>.html`). Limits: `ENTITY_SONGS_PER_LANG`, `ENTITY_MAX_ALBUMS`, `ENTITY_MAX_ARTISTS`, `ENTITY_CONCURRENCY`, `ENTITY_BUDGET_MS`, `ENTITY_MAX_LINKED` (default 1500), `ENTITY_MAX_TOTAL` (17,000), `ENTITY_MIN_PAGES` (300; a host build with fewer fails so Pages keeps the last good deployment). A dead mirror or the time budget means fewer pages, never a failed build below the minimum.

Keep the custom domains (`www.vinaxmusic.online`, the apex, `admin.`, `update.`, `status.`) attached to the static project; it is the origin the Worker passes every unmatched URL to. The static project needs no environment variables or secrets. Manual deploy from `frontend/`: `npm ci && npm run deploy:pages`.

`frontend/public/_headers` carries the content-security policy including hashes of the inline scripts in `index.html` (the pre-paint script holds the app-style canvas table and the generated festival window table). After changing an inline script, an app style, or running `npm run gen:festivals`: build, then `node scripts/csp-hashes.mjs` (recomputes from `dist/index.html`, writes `dist/_headers` and back to `public/_headers`); `cspHashes.test.ts` fails on drift. `_headers` also marks every console file `no-cache` and `status.vinaxmusic.online` / `vinax.pages.dev` `X-Robots-Tag: noindex`.

### Backend - the Worker

Configuration is `backend/worker/wrangler.toml`: name `vinax-api`, `routes`, `[vars]` (`ASSETS_HOST` must be the static project's host so fall-through and edge-rendered pages can fetch the shell), `[triggers] crons`, the `HANDOFF` KV binding, `[ai] binding = "AI"`, and the rate-limit bindings. Secrets are never in that file.

Current production routes: `www.vinaxmusic.online/api/*`, `/img`, `/apk`, the retired AI paths (`/ai-playlist*`, `/ai/shared/*`, which 301 to Home), `update.vinaxmusic.online/*`, `admin.vinaxmusic.online/` and `admin.vinaxmusic.online/api/*`. Song/album/artist/playlist pages, the 72 mood x language hubs, `/vinaxai` and all sitemaps are **not** Worker routes: they are static files. The apex is not a Worker route either (the static site's `_redirects` 301s it to `www`). Do not route a page family to the Worker again (see [The daily request quota](#the-daily-request-quota)).

From `backend/`:

```sh
npm ci && npm run lint && npm run typecheck && npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
npm run deploy           # wrangler deploy --config worker/wrangler.toml
```

`npx wrangler login` once per machine. The **Deploy Worker** workflow is the second deploy path; it needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; without the token it reports "not configured" and succeeds without deploying. Deploying the Worker also registers its Cron Trigger.

### Database - once per project

1. Create the hosted project (Supabase; any region).
2. In the SQL editor paste `backend/supabase/schema.sql` and run it (schema version 19; idempotent; re-running never deletes data). On Supabase it also creates the private Storage bucket `ai-attachments` and the public bucket `console-media`; no dashboard step needed.
3. From `backend/`: `npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml` and `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml`.
4. Open the console's **Database** page: schema version, every table with its size, job runs once the Cron Trigger has fired.

Apply schema changes **before** deploying the Worker that needs them. Details in [Database](#database).

### VinaX AI keys

Any one provider key is enough; set the ones you have (all optional):

```sh
npx wrangler secret put GROQ_API_KEY --config worker/wrangler.toml        # fast default models, dictation, Read aloud
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml      # images, PDFs, long threads, Live voice, song generation, embeddings option
npx wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.toml  # :free models
npx wrangler secret put NVIDIA_API_KEY --config worker/wrangler.toml      # NVIDIA NIM
npx wrangler secret put SEARCH_API_KEY --config worker/wrangler.toml      # Tavily/Serper web search for models that cannot ground
```

Web search needs nothing more when Gemini is set (free Google Search grounding, 450 searches/day). Optional plain vars: `SEARCH_API_PROVIDER` (`tavily` default or `serper`), `SEARCH_DAILY_LIMIT` (default 100; `0` switches the search API off). Workers AI needs no secret (`[ai] binding = "AI"`; free pool about 10,000 neurons/day for the account). Voice needs no more keys (dictation/Read aloud with Groq or Gemini; Live voice needs Gemini). Groq's Read aloud voice (Orpheus) may need its terms accepted once in the Groq console.

Check keys in the console (**API Keys Status**, **AI Assistant**) and, before switching the chat on, run `npm run ai:probe` locally with the same keys in `backend/worker/.dev.vars` (add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to probe Workers AI; `-- --voice-only` checks voice models, Live token and handshake). Apply the schema first, or chat, share and every `/api/personal/*` route answer `503 unavailable` for lack of tables and web search stays off.

VinaX AI stays **off** until the `vinax-ai` setting says otherwise (console > App Settings > Features & AI): `{ "enabled": false, "testers": ["<account id>"] }` lets only your account in; `{ "enabled": true }` opens it to every signed-in listener; `{ "enabled": false }` is the kill switch. The account id is `accounts.id`, also the `account=` part of a console profile address. Changes reach every isolate within a minute.

### Personal engine and music AI switches

The personal engine needs nothing new beyond schema 7+ and the Worker, and is **on** for every signed-in listener unless the `personal-config` setting says otherwise ([The personal engine](#the-personal-engine)). Music AI uses the VinaX AI keys; switches are the `ai-music` setting. Song generation stays off until both `GEMINI_API_KEY` is set and the owner enables `ai-music.generate.enabled` ([Music AI and song generation](#music-ai-and-song-generation)).

### VinaX AI sandbox host

Artifact previews run in `sandbox/`, a no-build static site on **its own origin** `https://sandbox.vinaxmusic.online` so nothing an artifact runs can reach the app. Until it exists the panel says "Preview needs the sandbox host" and everything else works. One-time setup: Cloudflare > Workers & Pages > Create > Pages > Connect to Git > this repository; project `vinax-sandbox`, production branch `main`, framework None, build command empty, output directory `sandbox`, root empty; Build watch paths include only `sandbox/*`; after the first deployment add custom domain `sandbox.vinaxmusic.online` (a proxied CNAME to `vinax-sandbox.pages.dev` is added automatically). Check: `curl -sI https://sandbox.vinaxmusic.online/` answers 200 with `content-security-policy: default-src 'none'; ...` and `frame-ancestors https://www.vinaxmusic.online ...`. Or upload by hand: `npx wrangler pages deploy sandbox --project-name vinax-sandbox`. The app allows the frame via `frame-src https://sandbox.vinaxmusic.online` in `frontend/public/_headers`; another host name means changing `VITE_AI_SANDBOX_ORIGIN` at build time, that `frame-src`, and the runner's `ALLOWED` origins and `frame-ancestors` together.

### Release checks

1. Run the frontend and backend gates, including the bundle budget and the browser suite against `dist/`.
2. Confirm CI and E2E are green for the exact commit.
3. After merging, confirm the static host's build, and read the Deploy Worker log when `backend/` changed.
4. On production check `/api/status`, Home, Search, album and playlist playback, a queue running to its end, lyrics, Radio and `/admin/`. In the console open **Dashboard** (tiles answer from the database) and **Database Tables** (schema version, every table listed, latest job run not overdue). Use a new and a returning browser profile, phone and desktop widths, light and dark.
5. Confirm the app shows the new version and any new route answers.
6. For Android, run the [Real-device QA script](#real-device-qa-script) before pushing a `v*` tag.

### When a deploy does not land

| What you see | Where to look |
| --- | --- |
| App is new and a new `/api/*` route answers `405` | [Runbook: the app is newer than the API](#runbook-the-app-is-newer-than-the-api) |
| "Workers Builds: vinax-api" red on every commit | [The known-red check](#the-known-red-check) - harmless while Deploy Worker is green |
| Deploy Worker fails at "Verify the Cloudflare token" | Rotate `CLOUDFLARE_API_TOKEN` (runbook fix 1) |
| Visitors stuck on the boot splash after a deploy | [Rollback](#rollback): purge the edge cache or bump the asset URL epoch |
| Console shows "the database is not set up"; sync, rooms, feedback answer `503` | The two database secrets are missing/wrong or `schema.sql` was not run; the console's Database page names which |

## Secrets and environment variables

The frontend has none. Every secret is a Worker secret, set with `cd backend && npx wrangler secret put <NAME> --config worker/wrangler.toml` (typed at the prompt, never pasted into a file or chat; `npx wrangler secret list --config worker/wrangler.toml` shows what is set). Locally use `backend/worker/.dev.vars` (git-ignored); `backend/.env.example` documents every name.

### Worker secrets

| Group | Names | Purpose / if missing |
| --- | --- | --- |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Every data feature; without them: `/api/room`, `/api/feedback`, `/api/push/subscribe`, `/api/push/fcm-register` answer `503 not_configured`; `/api/account/data` `503 unavailable`; `/api/events` accepts and drops; blocklist/experiments/announcement empty; `/api/appconfig` built-in defaults; no status history; console pages show setup cards. Never the anon key |
| Owner console | `ADMIN_LOGIN_PASSWORD`, `ADMIN_OWNER_EMAILS` | Recovery password sign-in as Owner; comma-separated emails that are always Owners (no `admins` row needed). Delete the password to allow Google only |
| Sessions | `AUTH_SECRET` (falls back to `DEVICE_ID_SECRET`) | Signs 30-day app sessions and 12-hour console sessions; changing it signs everyone out |
| Device identity | `DEVICE_ID_SECRET` (`TELEMETRY_PEPPER` fallback) | Signed device ids; without it `/api/events` and `/api/username` cannot tell devices apart |
| Request hashing | `TELEMETRY_PEPPER` | Rate-limit keys fall back to a built-in pepper |
| Scheduled jobs by hand | `CRON_SECRET` (optional) | `POST /api/cron/run` accepts only the owner token without it. The Cron Trigger needs no secret |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `/api/push/vapid` answers `key: null`; browser registrations stored but nothing sent |
| Android push | `FCM_SERVICE_ACCOUNT` (whole service-account JSON) | Android registrations stored but nothing sent ([Android push setup](#android-push-setup)) |
| Catalogue | `CATALOG_UPSTREAMS` (ordered comma-separated wrapper base URLs `/api/cat` tries first; 6 s each, benched a minute after failure), `CATALOG_DIRECT_URL` | Both optional; the bundle holds no provider URL, so the list changes without a release |
| VinaX AI | `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `SEARCH_API_KEY` | Any one enables the chat; none -> `/api/ai/*` answers `503 ai_not_configured`. A missing key only removes that provider's models |
| Turnstile | `TURNSTILE_SECRET_KEY` | Sign-in security check ([Cloudflare Turnstile](#cloudflare-turnstile-sign-in-security-check)) |
| Account emails | `RESEND_API_KEY` | Welcome/sign-in/console/invite emails off without it ([Account emails](#account-emails-resend)) |
| SEO / robots | `PAGES_DEPLOY_HOOK` | Console "publish robots.txt" triggers a site rebuild; without it the choice goes live with the next build |
| Android update source | `GITHUB_TOKEN` (optional) | Update lookup rate-limited without it; without Worker access to releases `/api/version` and `/api/apk` answer `503` |

Unused leftovers (read by nothing, deletable): older `VINAX_..._API_KEY` names, `NVIDIA_BASE_URL`, `VINAX_MAESTRO_MODEL`, `SERPER_API_KEY`, vars `SERPER_DAILY_LIMIT`, `RESEARCH_DAILY_LIMIT`, and the `CRON_SECRET` Actions secret.

### Worker plain vars, bindings

| Name | Kind | Purpose |
| --- | --- | --- |
| `ASSETS_HOST` | var | Static site host (`vinax.pages.dev`); fall-through and shell fetch |
| `GITHUB_REPO` | var | Repository the Android update lookup reads |
| `GOOGLE_CLIENT_ID` | var | Public web OAuth client id of the push project; sign-in answers `503 not_configured` without it |
| `SEARCH_API_PROVIDER`, `SEARCH_DAILY_LIMIT` | var | Web-search API choice and daily limit |
| `TURNSTILE_SITE_KEY` | var | Public Turnstile site key |
| `EMAIL_FROM` (default `VinaX <notifications@vinaxmusic.online>`), `EMAIL_REPLY_TO` (default `support@vinaxmusic.online`) | var | Account emails; sender must be on the verified domain |
| `HANDOFF` | KV binding | Device-transfer ciphertext (10-minute TTL), IndexNow last URL list (`indexnow:urls`), generated-song jobs/audio under `gen:` when no `GENERATED_AUDIO` binding |
| `GENERATED_AUDIO` | optional KV binding | Generated-song storage (24 h) |
| `AI` | Workers AI binding | Last-resort chat models, music ladder fallback, default embedding model |
| `RATE_LIMIT_10/30/60/300`, `ADMIN_AUTH_FAILS` | rate-limit bindings | Requests per 60 s per key; admin wrong-token budget 15/60 s |

### Frontend build variables (public)

`VITE_API_BASES` (replaces catalogue base list), `VITE_APP_NAME`, `VITE_AI_SANDBOX_ORIGIN`, `VITE_BUILD_NUMBER` (set by the Android workflows). Prerender: `CF_PAGES`, `PRERENDER_ENTITIES`, `ENTITY_*`. Android patch: `VINAX_PLAY_STORE_BUILD=1` omits `REQUEST_INSTALL_PACKAGES` (no workflow sets it). Tests: `E2E_CHROMIUM_PATH`, `E2E_PORT`, `E2E_PRINT_REQUESTS`, `QA_SWEEP`; eval: `EVAL_*`. Operator script: `CLOUDFLARE_ZONE_TOKEN` (Zone > Firewall Services > Edit; create, use, revoke).

### Repository Actions secrets

`CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template; for the daily SEO workflow also Account > Cloudflare Pages > Edit) and `CLOUDFLARE_ACCOUNT_ID` (Deploy Worker, SEO pages); `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (package signing); `SUPABASE_DB_URL` (Schema workflow apply; session-pooler URI); `LHCI_GITHUB_APP_TOKEN` (Lighthouse).

### Google sign-in

Runs on the push project **VinaX Music** (`vinax-music`). The Worker verifies Google's ID token itself (`_lib/googleAuth.ts`) and issues its own 30-day session. Requires `GOOGLE_CLIENT_ID` (var) and `AUTH_SECRET`. Authorised JavaScript origins on the web client: `https://www.vinaxmusic.online`, `https://vinaxmusic.online`, `https://vinax.pages.dev`, `http://localhost:5173`, plus `https://admin.vinaxmusic.online` for the console; a new domain must be added or the button refuses to load. The `accounts` row is written at sign-in and refreshed on the session check at most every 10 minutes. Without database secrets sign-in still works (`stored: false`) and sync answers `503 unavailable`. Android needs the app's SHA-1 on the Android app in the push project.

### Cloudflare Turnstile (sign-in security check)

Every sign-in (app Google sign-in on web/Android, console Google sign-in, console recovery password) can carry a Turnstile check; off until the Worker has both keys. Dashboard > Turnstile > Add widget, hostnames `vinaxmusic.online`, mode Managed. Site key -> `TURNSTILE_SITE_KEY` var (public); secret key -> `npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.toml` (replace an old key from the retired username check). `GET /api/auth/google` and `GET /api/admin/session` then name the site key. The Worker verifies each token with Siteverify (`_lib/turnstile.ts`): success, action (`app-signin` or `console-signin`), hostname under `vinaxmusic.online`. If Siteverify is unreachable Google sign-in proceeds and the recovery password is refused. With Turnstile on, the recovery password is exchanged once (with a passed check) at `POST /api/admin/session { password, turnstile }` for a 12-hour session. Android needs two WebView settings (third-party cookies; iframes may navigate in place) that `scripts/patch-android.js` writes into `MainActivity` (`allowSignInCheck`); an older APK fails the check and needs updating. Failures log `turnstile failed` with error codes.

### Account emails (Resend)

Four emails via Resend (`_lib/email.ts`): **welcome** on an account's first sign-in, **sign-in alert** on every later sign-in (time, browser, IP, rough place; says when the device is new), **admin invite**, and the Monday **weekly summary**. Signing in to the owner console sends nothing (owner decision 2026-11-09; the audit trail records it). Both account emails go to the address in the Google ID token whether or not it carries `email_verified` (the Android app's tokens were refused by that check until 1.12). Every email is one branded card (`layout()`): the VinaX mark from `/icons/icon-192.png`, the wordmark, an ember-to-rose ribbon on the app's plum canvas, one button and a quiet footer; the weekly summary's tiles use the same colours. Off until `RESEND_API_KEY` exists. Setup: Resend > Domains > add `vinaxmusic.online`; add its DKIM TXT (`resend._domainkey`) and the `send` subdomain MX + SPF TXT in Cloudflare DNS as **DNS only**; Verify (a `_dmarc` TXT `v=DMARC1; p=none;` helps); create a Sending-access API key for the domain; `wrangler secret put RESEND_API_KEY`; optional `EMAIL_FROM`/`EMAIL_REPLY_TO`. Test: console > Notification Rules > Account emails > Send me a test email (`validation_error` almost always means the domain is not verified). Each kind can be switched off (owner-only `email` setting). Emails send after the response (`waitUntil`) with an `Idempotency-Key`; failures log `[email] <kind> not sent`. Resend's free plan allows 100/day and 3,000/month; switch the welcome off first if sign-ups outgrow it.

## Operations

### Production at a glance

| Piece | Runs | Deploys |
| --- | --- | --- |
| Static frontend (`frontend/dist`) | Static project `vinax` (`vinax.pages.dev`) | Git integration on every push to `main` |
| Worker `vinax-api` | The edge, on the routes in `wrangler.toml` | **Deploy Worker** (works) and the host's own Git build (broken, see below) |
| Android package | Built by workflow, published as a repository release | Build Android APK / Release APK |
| Database | One hosted project; Worker is the only client | `schema.sql` once; never redeployed with the code |

Production host `www.vinaxmusic.online`; the Worker owns `admin.` (to `/admin/`) and `update.` (to the package download). The apex is redirected to `www` by the static site (`frontend/public/_redirects`, zone rule "Apex to www"), **not** the Worker: when the apex was a Worker route, a Worker over its quota answered 429 for `robots.txt`, Search Console reported "Robots.txt unreachable" and crawling of the whole domain stopped (fixed in 11.0.3). Keep anything a crawler needs before it can crawl (robots.txt on every host) off Worker routes. `status.vinaxmusic.online` serves the status page (`frontend/public/status/`, no sign-in) at its own root through two Cloudflare zone rules - URL Rewrite "Status host serves the status page" (`/` and `/app.js` from `/status/`) and Redirect "Status host to status page" (other paths except `/icons/*` go to the root) - and the Redirect Rule "www status path to status host" sends `www.../status/` to the status host. Host-based lines in `_redirects` never fire; host redirects are Cloudflare Redirect Rules.

### The known-red check

Every commit shows "Workers Builds: vinax-api" from the host's Git build, not this repository's workflows; it fails in about a second because the dashboard build token expired. Never a code failure; harmless while **Deploy Worker** is green for the same commit (same gates, same `wrangler deploy`). To clear it: hosting dashboard > Workers & Pages > `vinax-api` > Settings > Build > reconnect the repository or regenerate the build token.

### Runbook: the app is newer than the API

Symptom: `/changelog.json` shows the latest version but a feature needing the server is missing or falls back on-device.

Probe: request a route the newest backend added, for example `GET https://www.vinaxmusic.online/api/recommendations/similar/<real song id>?limit=5`. `404`, `405` or the app's HTML shell = stale Worker; any JSON answer means the route exists. Do **not** use `/api/version` (it reports the Android release: `build`, `version`, `apkUrl`, `sha256`, `minBuild`). Compare the Worker's version history with the last backend commit.

Fix in order: (1) rotate the workflow token (My Profile > API Tokens > "Edit Cloudflare Workers" template, scoped to the account; store as `CLOUDFLARE_API_TOKEN`, confirm `CLOUDFLARE_ACCOUNT_ID`, run Deploy Worker by hand); (2) repair the host's Git build; (3) deploy by hand: `cd backend && npm run deploy`.

### Rollback

| Piece | How |
| --- | --- |
| Frontend | Promote the previous successful deployment in the static project's history |
| Worker | Roll back in the Worker's version history, separately |
| Published configuration | Every change is in `settings_history`: open the key on the console page and restore an earlier value ("Restore this version"), or reset to the built-in setting |
| Database | No code to roll back; schema versioned in `meta.schema`; a table/function missing after a partial paste is fixed by running `schema.sql` again |
| Android | A published package cannot be recalled; publish a fixed build; `min-version` can force the update dialog |

Keep the halves compatible: a frontend calling a route the rolled-back Worker lacks falls back on-device. If a cached bad asset is the problem (HTML under a hashed script URL) purge the edge cache; if browsers cached it as immutable bump the URL epoch in `frontend/vite.config.ts` (`-b3` in the file-name patterns).

### The daily request quota

Platform behaviour seen in production (2026-10-06); nothing in the repository enforces or reports it. The Worker runs on the free plan's fixed daily request allowance across every route in `wrangler.toml`. When spent, the platform stops running the Worker until 00:00 UTC (05:30 IST) and answers its routes with its own error page (**1027**); the static shell still loads but every `/api/*` call fails. It is not a code failure and a redeploy does not help.

- On 2026-10-06 a scraper rotating fake desktop-browser user agents through thousands of IPv6 addresses hit the edge-rendered entity pages (~98% of requests). Fix: since 11.0.2 the entity pages, and since V2 1.0 the 72 hubs and all sitemaps, are static files built by the frontend (`scripts/prerender-entities.mjs`, using the Worker's renderer). Crawlers cost no Worker requests. **Do not route a page family to the Worker again.**
- Diagnosis: Worker request analytics grouped by path and client network; look for one path family or range taking most of the day.
- To bring server rendering back, put the four patterns in `routes` **and** a zone rule in front first. `backend/scripts/cf-edge-rules.mjs` creates two WAF custom rules (matched by description, safe to re-run): "VinaX entity pages: browser impostors" (block: `/song/ /album/ /artist/ /playlist/` requests claiming Chromium but without `sec-ch-ua`, not a verified bot) and "VinaX entity pages: unverified automation" managed challenge (`--challenge`). Run: `CLOUDFLARE_ZONE_TOKEN=... node backend/scripts/cf-edge-rules.mjs --dry-run` (print), without flag (create/update), `--challenge` (also challenge). A routed request is counted before any code runs, so only a rule in front saves quota. The in-Worker `_lib/pageGuard.ts` (browser impostors; 30 pages/min per address, 200 then 100/min per IPv6 /32 or IPv4 /24) answers the plain shell with `x-vinax-page: impostor|address|network` and protects mirrors and CPU, but not the quota. Verified bots and link previewers are exempt.

### Secrets for operators

See [Secrets and environment variables](#secrets-and-environment-variables). For an Android update flow the Worker needs read access to the latest release.

### The database, operationally

**Moving to a new database:** create the project; if not empty run `reset.sql` (deletes every VinaX table); run `schema.sql` (last output line names version and table count); set the two secrets (applies next request, no deploy); check the Database Tables page (current schema version, every table, reachable) and the Dashboard (zero tiles, not an error). Old data does not move: signed-in listeners keep their session (a signed token), their first sync writes a fresh copy from the device, and device rows reappear on the next consented event.

**Retention:** usage events are the only table that grows without bound. Housekeeping (hourly) purges events older than the `retention` setting's `eventsDays` (default 180), sweeps idle rooms, retires push devices silent for 180 days. The Database Maintenance page runs the same actions now (`purge_events` with chosen days, `sweep_rooms`, `retire_push`), each confirmed and audited. `feedback`, `notifications`, `audit_log`, `job_runs` stay until deleted (job_runs older than 30 days are pruned by housekeeping).

**Deleting one listener:** the listener - Settings > Profile > Delete account (`POST /api/auth/me { delete: true }`) removes `accounts` and cascades; the owner - open the person, Delete user's data (reason + typed CONFIRM) -> removes VinaX AI files first, then `delete_listener` per device (device row, events, room memberships, account, backup), detaching feedback; the audit trail keeps the reason.

**Old AI tables:** a database that ran schema 2 still holds `ai_calls`, `shared_chats` and functions `stats_ai`, `ai_usage_since`; run `backend/supabase/remove-ai.sql` once by hand (deletes that data only).

### Scheduled jobs

The Worker's Cron Trigger (`[triggers] crons = ["*/5 * * * *"]` in `wrangler.toml`; deploying registers it) fires the scheduled handler every 5 minutes. `_lib/jobs.ts` decides what runs: a job is due when it is on and its last run started at least `every - 2` minutes ago (from `job_runs`), so the cron interval only sets the finest grain. Every run is recorded in `job_runs`. The `jobs` setting `{ "<job>": { enabled, every } }` (owner-only) switches a job off or slows it (`every` must be one of the job's choices). A job is "running late" after `max(2 x every + 15, 45)` minutes.

| Job | Default | Does |
| --- | --- | --- |
| `status-tick` | every 30 min | Probes website, catalogue and console; `uptime_tick` per component (the status page's history) |
| `housekeeping` | hourly | `room_sweep` (rooms idle 6 h, members unseen 1 day); `purge_events(eventsDays)` or `purge_kind` per kind; `retire_push_devices(180)`; removes VinaX AI chats deleted over a day ago (and their files; files never sent after a day); `sign_ins` older than 90 days; `ai_daily_usage` older than 90 days; `personal_purge(365)` (events older than a year, pages past expiry); at the 21:00 UTC run `personal_refresh_colisten(30, 50)`; prunes `job_runs` older than 30 days; `outreach` rows older than 180 days |
| `personal-embed` | every 30 min | Confirms up to 25 device-asserted songs with the catalogue (unknown ones removed), embeds up to 200 verified songs lacking a vector in the configured model; skipped while the engine is off |
| `alerts` | every 5 min | Smart Alerts (`_lib/alerts.ts`) |
| `scheduled-notifications` | every 5 min | Sends `notifications` rows whose `scheduled_for` has come (`_lib/scheduledPush.ts`) |
| `outreach` | hourly | Automatic notifications (`_lib/outreach.ts`) |
| `indexnow` | every 6 hours | Posts new sitemap URLs to IndexNow (Bing, Yandex, Seznam, Naver); first run sends every URL; key file `frontend/public/<key>.txt`, key in `_lib/indexnow.ts` |
| `weekly-summary` | weekly (Monday) | The owner's Monday email (`_lib/weeklySummary.ts`, `weekly_summary()`); switch/recipients in the `email` setting; each send leaves a `weekly-summary-sent` row in `job_runs` |

Console **Scheduled Jobs** lists each job with last run, outcome and summary, flags overdue ones ("Not run yet" on a fresh database is not a failure) and has a button per job; or `POST /api/cron/run { "job": "status-tick" }` with `x-cron-secret: $CRON_SECRET` or the owner token. A failing job leaves `ok: false` and the error in its summary; the next tick runs it again.

### Monitoring

- **Status page:** `frontend/public/status/` reads `/api/status`, which probes website, catalogue and console live (memoised 60 s per isolate) plus the 90-day history from `uptime_report` and the owner's note (`status-note`). Without the database `days` is empty and `uptime90` is `null`.
- **Owner console:** Dashboard ("Needs your attention"), Server Checks, Scheduled Jobs, Smart Alerts (push to admin phones). A panel with no data means "unknown", not "healthy".
- **Synthetic uptime issue** is the outside alert.

### Rate limiting (`_lib/ratelimit.ts`)

Two layers: a per-isolate token bucket in memory (burst guard; whole limiter where no binding exists, e.g. dev/tests) and the platform's Rate Limiting bindings in `wrangler.toml` (`RATE_LIMIT_10/30/60/300` per 60 s per key, `ADMIN_AUTH_FAILS` 15 per 60 s). A route uses the smallest tier at or above its bucket capacity plus a minute of refill. Keys are `route|hash(client address)` peppered with `TELEMETRY_PEPPER`, so no address is stored. Counters are shared per edge location and synchronised in the background (a burst can overshoot); a binding that throws fails open to layer 1; `period` may only be 10 or 60. The admin login throttle (`_lib/admin.ts`) locks a source out for 10 minutes after 15 wrong tokens and also counts them in `ADMIN_AUTH_FAILS`.

### Images

Artwork is served straight from the catalogue CDN in pre-sized variants. `/img` exists only so share cards can draw artwork on a canvas from the same origin; each proxied image costs a Worker request.

## Database

One server database, designed from a clean sheet in 14.0: the whole schema is one file, `backend/supabase/schema.sql` (current **schema version 19**, written into `meta.schema` as `{ version, appliedAt }`); plain table names; a small typed data layer in the Worker; row-level security enabled **and forced** on every table with no policy, so the public anon key reads and writes nothing; all functions are `security invoker`, executable by the service role only. The app and console never talk to the database directly.

### Setting it up and upgrading

Paste `schema.sql` in the SQL editor (Run). It is idempotent and never deletes data; pasting it again over an older version is the whole upgrade. `backend/supabase/reset.sql` wipes everything for a restart. Apply a new version **before or together with** the Worker that uses it: until then the console shows a "database update needed" banner (`502 db_update_needed` on the pages calling new functions) and some routes answer `503 unavailable`.

### From CI instead of the SQL editor

The **Schema** workflow applies `schema.sql` for you. It is inert until the repository secret `SUPABASE_DB_URL` exists: take the Supabase **session pooler** URI (`aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<project ref>`; not the IPv6-only direct host - GitHub runners have no IPv6), with the password URL-encoded. The job runs in the `production` environment (required reviewers possible). Every push to `main` touching `backend/supabase/**` applies the schema after the check is green; Actions > Schema > Run workflow with *apply* ticked does it by hand. On every PR touching the schema (no secrets) a fresh Postgres 16 gets `schema.sql` twice (idempotent), `check.sql` (seeds rows, calls every function with assertions, proves constraints and RLS, rolls back), then `reset.sql`, `schema.sql`, `check.sql` again. Locally:

```sh
backend/supabase/ci.sh check postgresql://postgres:postgres@localhost:5432/scratch   # throwaway database
backend/supabase/ci.sh apply "$SUPABASE_DB_URL"                                       # the real one (schema.sql only)
```

`apply` runs only `schema.sql`; `reset.sql`/`check.sql` are never run against production.

### Schema version history (what each version added)

| Version | Adds |
| --- | --- |
| 3 | Dropped the old AI tables/functions (`ai_calls`, `shared_chats`, `stats_ai`, `ai_usage_since`); never deletes data |
| 4 | VinaX AI: `ai_conversations`, `ai_messages`, `ai_attachments`, `ai_conversation_search`, `ai_export` |
| 5 | `ai_daily_usage`, `ai_take_daily` (shared daily allowances for web search) |
| 6 | `ai_attachments.kind`, `gemini_uri`, `gemini_expires_at`; private bucket `ai-attachments` (Supabase only) |
| 7 | Personal engine: `personal_songs/events/taste/exposure/pages/colisten`, `personal_*` functions, the `vector` extension |
| 8 | `ai_shares` (shared chat links) |
| 9 | `ai_projects`, `project_id` on chats/attachments, `ai_memories`, `ai_memory_prefs`, `ai_conversations.incognito`, `ai_artifact_list`; bucket limit raised 20 -> 50 MB |
| 10 | Rebuilt console: `signed_devices()` (console counts signed-in people only; days follow India's calendar via `_ist_today()`), `admins`, `error_status`, `push_devices.account_id`, `notifications.status/scheduled_for/image/opened/created_by`, `blocked_content.blocked_by` + `album` kind, experiments fields, `accounts.blocked_at`, `listeners.signed_out_at`, functions `admin_users`, `admin_user_filters`, `user_profile`, `purge_kind`, `notification_opened`, `_error_shape`; public bucket `console-media`; `stats_funnel` |
| 11 | `stats_trending`, `stats_searches` (Trending, Search Insights) |
| 12 | `sign_ins` (IP address, 90 days; only table with an IP) |
| 13 | `listeners.os`, `browser`; `_device_key()`, `listen_time()`; `admin_users` gains device/listening fields |
| 14 | `_listen_spans`, `_window_start`, `stats_top_listeners`, `stats_at_risk`, `stats_listening`; new retention grouping (weeks of first Google sign-in, d1/d7/d30 + `d1Of/d7Of/d30Of`) |
| 15 | `owner_notes` (tags <= 12, note <= 2000 chars), `profile_extras()`, `owner_tags()` |
| 16 | `listeners.os_version/device_model/device_brand/display_mode`; `app_time()`, `account_app_time()`, `profile_app_time()`, `device_breakdown()`; app sends a `presence` event about once a minute while on screen with nothing playing |
| 17 | `weekly_summary(p_to)` for the Monday email |
| 18 | `outreach` table and `outreach_*` functions (recap, win-back, release) |
| 19 | `song_reactions` (fire, love, sad, dance, wow), `song_reaction_counts()`, `stats_reactions()` |

Until a version is applied the Worker degrades (e.g. retries listener writes without the newest columns on `PGRST204`; sign-ins simply not recorded before 12).

### Tables

| Table | One row per | Holds |
| --- | --- | --- |
| `meta` | fact | `schema` -> `{ version, appliedAt }` |
| `listeners` | opted-in device | display name, handle (unique, lower-case), platform, os/browser/device fields, app version, edge geo, what is playing, first/last seen, `signed_out_at` |
| `accounts` | Google sign-in | Google subject id, email, name, picture, linked `listener_id`, sign-in platform/version/geo, created/last seen, `blocked_at` |
| `sign_ins` | Google sign-in (12) | account, time, IP, browser, platform/version, geo, `signup`, `new_device`; 90 days; cascades with account |
| `account_backups` | account | backup JSON `payload`, `version`, `bytes` (<= 2 MB); deleted with the account |
| `profiles`, `follows`, `shared_playlists` | account | opt-in public profile (unique case-insensitive handle, `public`, `bio`, `summary`, `now_playing`, `share_now`); follow edges (no self-follow); shared playlists (<= 500 songs, `collab_token`, `version`) |
| `events` | consented usage event | `kind` (play, pause, heartbeat, open, error, search, skip, favorite, share, rec_served, ...), song facts, language, platform, geo, error info, `meta` (<= 2 KB), `verified` |
| `feedback` | message | kind (bug/idea/content/other), message, platform, geo, `status` (new/read/resolved), owner `note` |
| `blocked_content` | blocked item | `kind` (song/album/artist/keyword), `value`, `label`, `reason`, `blocked_by`; unique per kind+value |
| `rooms`, `room_members` | Listen Together room / member | code, host token, `current`, `queue` (<= 12), `requests` (<= 20), position; member name, last seen, reaction |
| `push_devices` | pushable device | `channel` (web/fcm), `target` (endpoint or token, unique), web keys, lang, geo, `tz_offset`, `active`, `account_id`, last pushed |
| `notifications` | push sent/scheduled/draft | title, body, link, image, `audience`, delivery counts, `status`, `scheduled_for`, `opened`, `dedupe_key`, `retracted_at`, `kind` (incl. `system`, recap, winback, release) |
| `outreach` | person per automatic push (18) | `kind`, notification id, `dedupe_key` (the cap), message, facts; 180 days |
| `settings`, `settings_history` | published setting | key -> JSON value, who/when; every change appended to history |
| `experiments` | A/B test | key, name, description, `variants`, `audience`, `status`, `winner` |
| `audit_log` | owner action | actor, action, target, summary, redacted before/after |
| `admins`, `error_status`, `owner_notes` | console data | admin emails/roles; status per error group; owner tags/notes |
| `uptime_days`, `uptime_latest`, `job_runs` | status/jobs | per-component tallies; latest probe; job runs |
| `song_reactions` | device x song (19) | `emoji`, song facts, `listener_id` |
| `ai_conversations` | chat | `account_id`, title, `starred`, `model_pref`, `active_leaf_id`, `project_id`, `incognito`, `deleted_at` (hidden; purged a day later) |
| `ai_messages` | message | `parent_id` (tree), role, content, thinking, sources, artifacts, `model_id`, provider, stop reason, usage; cascade with chat |
| `ai_attachments` | file | name, mime, size, `kind`, `project_id`, `storage_path` (`<account>/<conversation or new>/<id>` or `<account>/project-<project>/<id>`), `extracted_text`, pages, `gemini_uri/expires_at` |
| `ai_projects`, `ai_shares`, `ai_memories`, `ai_memory_prefs`, `ai_daily_usage` | VinaX AI | project (name <= 60, description <= 300, instructions <= 8,000); share snapshot (22-char base64url id, <= 1 MB, one per chat); memory notes (<= 200 chars, <= 50 per account); memory switches; daily allowances (`search`, `grounding`, `msg:<account>`) |
| `personal_songs`, `personal_events`, `personal_taste`, `personal_exposure`, `personal_pages`, `personal_colisten` | personal engine | see [The personal engine](#the-personal-engine) |

View `directory` merges `listeners` and `accounts` into one row per person. Everything cascades from `accounts` where it belongs to an account.

### Functions

`stats_overview`, `stats_timeline`, `stats_music`, `stats_geo`, `stats_platforms`, `stats_engagement`, `stats_retention`, `stats_funnel`, `stats_skips`, `stats_errors`, `stats_trending`, `stats_searches`, `stats_top_listeners`, `stats_at_risk`, `stats_listening`, `stats_reactions` (all answer JSON shaped for the console, signed-in people only except errors); `listener_profile`, `user_profile`, `profile_extras`, `delete_listener`; `room_request`, `room_sweep`; `purge_events`, `purge_kind`, `retire_push_devices`; `uptime_tick`, `uptime_report`; `table_stats`, `table_counts`; `ai_take_daily`, `ai_export`, `ai_conversation_search`, `ai_artifact_list`; `personal_record_events`, `personal_touch_songs`, `personal_unverified`, `personal_exposure_for`, `personal_recompute_vector`, `personal_neighbours`, `personal_similar_songs`, `personal_colisten_for`, `personal_refresh_colisten`, `personal_trending`, `personal_embed_backlog`, `personal_set_embeddings`, `personal_erase`, `personal_purge`, `personal_stats`, `personal_mark_shown`; `listen_time`, `app_time`, `weekly_summary`, `outreach_*`, `song_reaction_counts`, `notification_opened`.

### Rules every route follows

- A **public** route without the database answers the shape the app already handles (`503 not_configured` for rooms, feedback, push registration; empty lists for blocklist/experiments/announcements; defaults for config; `unavailable` for account sync).
- An **admin GET** without the database answers `200 { configured: false }`; a failed call answers `502 { configured: true, error: 'db_<reason>' }` so the console never shows a zero for a failure; an **admin POST** without it answers `503 { error: 'db_not_configured' }`.
- Every admin write goes through `audit()`. Admin writes are POST-only (`{ action, ... }` bodies); no PUT/DELETE.
- Geo is the edge's; the body is never trusted for it. Device ids come from `identity.ts` (signed ids in `signed_device_id`, out `signed_device_id_next`; `d_...` derived from the install id; fresh `r_...`), never raw from the body.
- `?days=` on admin routes is 1..90 (default 7).

### Public routes that read or write it

| Route | Behaviour |
| --- | --- |
| `POST /api/events` | Consent header required; resolves the device; writes `events` and upserts `listeners` (reads OS/browser/device from the user agent); `204` or `200 { signed_device_id_next }` |
| `POST /api/feedback` | Writes `feedback` |
| `GET/POST /api/room` | Rooms/members; host token authorises `update`/`end` |
| `POST /api/push/subscribe`, `fcm-register`, `unsubscribe` | `push_devices` (Bearer session links the device to the account) |
| `POST /api/auth/google`, `GET/POST /api/auth/me` | `accounts` (+ `sign_ins`); `delete: true` removes the account |
| `GET/PUT /api/account/data` | `account_backups` with optimistic versions: `200`, `204`, `409 { version, updatedAt, backup }` |
| `GET/PUT/DELETE /api/profile`, `GET /api/profile/<handle>`, `GET/POST /api/follow` | Profiles and follows |
| `GET/POST/DELETE /api/shared-playlist`, `.../<id>` | Shared playlists; collaborator writes need the invite token; stale owner writes `409 { playlist }` |
| `/api/ai/projects*`, `/api/ai/memories*`, `/api/ai/shares*` | VinaX AI data, own rows only (share GET by 128-bit id is public) |
| `GET/POST /api/username` | The handle; `409 taken` with suggestions |
| `GET /api/appconfig?key=client\|banners\|festival\|flags`, `/api/experiments`, `/api/announcements`, `/api/blocklist`, `/api/site-mode`, `/api/status` | Settings and status reads |

### Privacy of stored data (summary)

Stored: coarse edge geo, anonymous device ids, display names and handles the listener chose, Google profile basics, the synced backup, song facts for plays, and (personal engine) reported events, taste model, exposure, composed pages. Not stored: precise location; an IP address only in `sign_ins` (90 days). Usage events purged after `retention.eventsDays` (default 180); personal events after a year. Full table in [Data and privacy](#data-and-privacy).

## Owner console

Served at `/admin/` (https://admin.vinaxmusic.online/admin/). Plain English everywhere; no setting needs JSON, an id or a raw address typed by hand (dropdowns, toggles, pickers, drag-to-reorder lists). It counts **people signed in with Google** only: anonymous `listeners` rows stay in the database but never leave the API (the `stats_*` functions, Users list, Listening Now, notification audience and AI tester picker filter on the server). App errors are the exception: every report counts.

**One job per page** (50 pages in ten folding groups; no page has tabs; a person's profile keeps six sections: Overview, Listening history, Devices, Sign-ins, Feedback sent, Activity log):

| Group | Pages (route) |
| --- | --- |
| Overview | Dashboard `#/dashboard`, Listening Now `#/listening-now`, Recent Activity `#/recent-activity`, Listen Together Rooms `#/listen-together`, Smart Alerts `#/alerts` |
| Users | All Users `#/users`, Top Listeners `#/top-listeners`, At Risk `#/at-risk`, Feedback `#/feedback`; profile `#/user?id=<account id>` (not in the menu) |
| Music Stats | Top Songs `#/top-songs`, Rising Songs `#/rising-songs`, Top Artists `#/top-artists`, Languages `#/languages`, Trending `#/trending`, Songs People Skip `#/skipped-songs`, Song Reactions `#/song-reactions` |
| Audience | Where Users Are `#/where-users-are`, How Much They Listen `#/listening-time`, When They Listen `#/listening-hours`, Do They Come Back `#/coming-back`, Sign-up Journey `#/signup-journey` |
| Search & Library | Search Overview `#/search-overview`, Searches That Found Nothing `#/search-no-results`, Pins & Synonyms `#/search-pins`, Find Music `#/find-music`, Blocked Songs & Albums `#/blocked-music` |
| Notifications | Send Notification `#/send-notification`, Sent History `#/sent-notifications`, Saved Audiences `#/saved-audiences`, Notification Rules `#/notification-rules`, Automatic Notifications `#/automatic-notifications`, Setup Check `#/notification-setup` |
| App Settings | Home Screen, Features & AI, App Updates, Maintenance, Search & Music Sources, Help Center, Data & Privacy (`#/app-settings/<page>`) |
| App Health | App Errors `#/app-errors`, Server Checks `#/server-checks`, Music Sources `#/music-sources`, AI Assistant `#/ai-status`, Recommendations `#/recommendations`, App Versions `#/app-versions`, API Keys Status `#/api-keys` |
| Growth & SEO | Google Search `#/google-search`, Page Check `#/page-check`, Search Console `#/search-console`, A/B Tests `#/ab-tests` |
| System | Database Tables `#/db-tables`, Scheduled Jobs `#/scheduled-jobs`, Change Log `#/change-log`, Database Maintenance `#/db-maintenance`, Admins & Roles `#/admins` |

Old addresses keep working: `REDIRECTS` in `frontend/public/admin/app.js` sends every old page/tab to its new page (`#/health/errors` -> App Errors, `#/database/changes` -> Change Log, `#/live/now` -> Listening Now, `#/users?user=<id>` -> that profile, `#/overview`, `#/listeners`, `#/publish`, `#/notify`, `#/analytics`, `#/catalog`, `#/experiments`, `#/seo`, ...) and keeps the query string. **Server-side links (Smart Alerts, sign-in emails, the dashboard's "Needs your attention") still use the old addresses and rely on this.** Unknown addresses show "Page not found" with a Go to Dashboard button.

### The three answers every page handles

| Server says | Page shows |
| --- | --- |
| `{ configured: false }` | A setup card: the database is not connected |
| `502 { error: 'db_...' }` | "Could not load" with Try again; never a zero. `db_update_needed` = database on an older schema; owners also see a banner |
| Data or empty | The data, or a friendly empty state |

### Files (`frontend/public/admin/`, plain scripts, no build step)

`index.html` (CSP, icon sprite, sign-in screen, sidebar, top bar, one `<script>` per file), `theme-boot.js` (pre-paint theme), `console.css` + `css/<area>.css` + `css/phone.css` (720 px and narrower: bottom bar Dashboard/Live/Users/Notify/Menu, tables as cards) + `css/glass.css` (loaded last), `core.js` (global `VX`: DOM builder via `VX.h` text nodes only - `innerHTML` banned by a unit test, API client, formatting, components, charts, page registry), `kit/controls.js` (shared controls), `kit/settings.js` (App Settings framework), `festivals.js` (generated), `geo.js` (360x141 land dot grid, `VX.worldMap`), `pages/*.js` (each calls `VX.page({...})` or `VX.settingsPage({...})`), `app.js` (shell, loaded last). `scripts/admin-stamp.mjs` adds `?v=<hash>` at build time. CSP: `default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/`.

### Sign-in, roles, audit

Admins sign in with **Google**; only an email on **Admins & Roles** (`admins` table) gets in, and the Worker checks the role on every request (hiding a button is never the check). Setup:

1. Add `https://admin.vinaxmusic.online` to the Google OAuth web client's Authorised JavaScript origins (otherwise "The given origin is not allowed").
2. Set `ADMIN_OWNER_EMAILS` (comma-separated); those are always Owners and their first sign-in writes the row. Invite everyone else from Admins & Roles.
3. `ADMIN_LOGIN_PASSWORD` still signs in as Owner ("Owner (recovery password)") from a collapsed box; delete it to allow Google only.
4. Apply schema 10+ (the `admins` table must exist for anyone but bootstrap owners and the password).

| Role | Can |
| --- | --- |
| Viewer | See everything, change nothing (writes answer `403 { error: 'forbidden', need }`) |
| Editor | App Settings, send notifications, feedback/error status, block/unblock music, A/B tests, block users, sign devices out |
| Owner | Everything, including Database upkeep, Admins & Roles, clearing errors, deleting a user's data, and the `retention`, `jobs`, `alert-rules`, `email` settings, Smart Alerts "Check now", the account-email test |

Sessions `adm1.<payload>.<hmac>` (12 h, signed with `AUTH_SECRET`, sent as `x-admin-token`); the role is re-read from `admins` (memoised one minute). `GET /api/admin/session` never 401s: `{ googleClientId, googleReady, passwordAllowed, me, schema, schemaWanted, databaseConfigured }`; `POST /api/admin/session { credential }` -> `{ token, me, expiresIn }` (`403 not_an_admin | email_not_verified`, `401 invalid_token`, `503 google_not_configured`). `adminGet` = any admin; `adminPost` = editor unless the route asks for owner. `GET/POST /api/admin/admins`: `invite`, `role`, `remove` (`409 last_owner`, `409 already_admin`). Every write leaves an `audit_log` row (actor = admin email; `owner` for recovery password and jobs); Change Log filters by admin, action and date range (India time).

### The shell (`app.js`)

Ten folding groups (only the current group starts open); **Find a page** filters the menu (Enter opens first match, Esc clears); top bar: breadcrumb, global search **Ctrl K / Cmd K** (pages, settings, users, songs, quick actions), date range (Today/7/30/90/Custom) on `range: true` pages, auto-refresh (15 s/30 s/1 min/5 min), theme (Light/Dark/Match device), profile menu. Keyboard (press `?`): `/` search, `R` refresh, `T` theme, `[` collapse menu, `G` then letter: D Dashboard, L Listening Now, U All Users, F Feedback, S Top Songs, M Find Music, T Trending, I Search Overview, N Send Notification, H App Errors, A Smart Alerts, B Database Tables. Routes `#/<page id>?<params>`; `ctx.onLeave(fn)` guards unsaved changes.

Controls kit (`kit/controls.js`): `VX.me`, `VX.can('edit'|'owner')`, `ui.stats` (required ⓘ explanation), `ui.menu`, `ui.dropdown/radios/checks/slider/switchRow/chips`, `ui.sortable`, `ui.picker/userPicker/musicPicker`, date/time pickers (console time zone, IST default), `ui.colorPicker`, `ui.imageUpload` (cropped, stored by `POST /api/admin/upload` in the public `console-media` bucket), `ui.dataTable` (search, filters, sort, Columns, 25/50/100 rows, CSV/Excel export, bulk select), `VX.confirm({ typed: true })` for destructive actions.

**App Settings framework:** `VX.settingsPage({ id, title, sections })`; each section edits one `settings` key through `POST /api/admin/settings { key, value }` (null = built-in). Every section has a status chip (Live in app / Using built-in / Unsaved), **Save & apply** ("Users will see this change within 1 minute"), **Cancel**, **Reset to built-in**, optional live preview, **Change history** (last 20, **Restore this version**). Maintenance mode and forced updates require typing `CONFIRM`.

### Adding a console page

1. One job per page: create `frontend/public/admin/pages/<area>.js` calling `VX.page({ id, title, group, icon, order, desc, render, range, keywords, hidden })` (group one of the ten; `desc` is one plain sentence, required; icons are sprite ids without `i-`); add old addresses to `REDIRECTS`.
2. Add its `<script>` to `index.html` before `app.js`.
3. Add the Worker route under `backend/worker/functions/api/admin/` with `adminGet`/`adminPost`, register it in `backend/worker/index.ts`, add mocks to `frontend/e2e/support/console-mocks/`.

### Pages and their routes (key facts)

- **Dashboard:** `GET /api/admin/overview?days=` -> `{ configured, schema, days, kpis, timeline, platforms, versions, attention: [{ id, level: bad|warn|info, text, action, page, params }], checkedAt }`. Ten stat cards deep-link to pages with filters; four charts; per-admin layout (Customise: drag, size, hide) in browser storage `vinax_admin_dash.<email>`.
- **Listening Now / Recent Activity / Rooms:** one call `GET /api/admin/live` -> `{ configured, now, counts, listening, feed (newest 60), rooms }`; signed-in people only (a device counts when its `account_id` is set); world map of places; Editor actions `end_room { code }`, `end_all_rooms` (typed CONFIRM).
- **All Users / profile:** `GET /api/admin/listeners` (`admin_users`: filters `q, platform, active, joined/joinedFrom/joinedTo, country, region, city, version, language, sort, limit (25/50/100), offset, ids`), `?filters=1`, `?account=<id>` (`user_profile`; `profile.extras`, `profile.signIns` last 100). POST: `block`/`unblock` (Editor; blocked accounts get `403 blocked` at sign-in and `401 signed_out` reason `blocked`), `signout_device`, `delete` (Owner; reason + CONFIRM), `notes` (tags/notes, audited). Top Listeners/At Risk: `?view=top&days=` / `?view=at-risk&quiet=7|14|30`.
- **Feedback:** `GET /api/admin/feedback` (status new/read/resolved/all, kind, platform, date); POST `status`, `reply` (push to the sender's signed-in devices; `409 no_account | no_device`, `400 push_not_configured`), `delete`, `delete_resolved`.
- **Music Stats/Audience:** `GET /api/admin/analytics?view=music|rising|geo|engagement|retention|funnel|skips|errors&days=`; Trending/search insights `GET /api/admin/trends?view=trending|search|pins&days=` (POST `pin`, `unpin`, `synonym`: at most 100 pins and 200 synonyms; `400 bad_query|bad_song|bad_synonym|too_many`; a pin reaches the app as `searchPins` in the client bundle and puts that song first for exactly matching words); Song Reactions `GET /api/admin/reactions?days=&limit=`.
- **Find Music / Blocked:** `GET /api/admin/catalog-search?q=&type=songs|albums|artists|playlists`; `GET/POST /api/admin/content` (`block` song/album/artist/keyword with reason Copyright/Wrong audio/Offensive/Other, `reason`, `unblock`); `/api/blocklist` returns `{ ids, artists, keywords, albums }`.
- **Notifications:** `GET/POST /api/admin/push` (audience filters: country > state > city, language, device kind, activity `today|active7|active30|heavy|quiet|away7|dormant14`, tags, chosen users, pasted emails (<= 200), channel; `dryRun`, `test` (own devices), `draft`, `when: 'schedule'` (1 minute to 60 days ahead), send now; `409 quiet_hours|kind_off|duplicate`); `GET/POST /api/admin/notifications` (`retract`, `cancel`, `delete`); `POST /api/push/opened { id }` counts taps. Only people signed in with Google are reached (`push_devices.account_id`). Scheduled sends: up to 3 due rows per run, claimed `scheduled -> sending`. **Notification Rules** (`push` setting): `{ minGapHours: 6|12|24|48, quiet: { enabled, start, end } (India time), types: { announcements, releases, recommendations, reminders } }`; saved audiences in `push-audiences` (<= 30).
- **Automatic Notifications:** weekly recap (Sunday from 7 PM in the person's time; once a week; needs 30 minutes of listening; opens `/weekly`), win-back (daytime 9-21 their time, after 7 quiet days; once a week, none after three unanswered), new releases (within 1.5 days of a release by a top-three artist; one a day, never the same song twice). Switches in the `outreach` setting `{ recap, winback, release }`; `GET /api/admin/outreach`, `POST` `preview` (editor) / `run` (owner).
- **A/B Tests:** `GET/POST /api/admin/experiments` (`save`, `status draft|running|paused|finished`, `delete`); public `GET /api/experiments` lists running tests. Assignment is on the device (FNV-1a over `deviceId:key`; a second hash over `deviceId:key:in` against `percent`); live slots `home-shelf-order` (control / discovery-first) and `rec-next-songs` (control / taste-0.15 / taste-0.18).
- **App Health:** App Errors `GET /api/admin/errors` (grouped by kind + message shape via `_error_shape`; statuses new/investigating/fixed/ignored in `error_status`; clear = owner + CONFIRM), Server Checks `/api/admin/edge`, Music Sources `/api/admin/musicapi`, AI Assistant `/api/admin/ai` ([the providers card](#the-consoles-providers-card)), Recommendations `/api/admin/personal`, App Versions `/api/admin/releases`, API Keys Status `/api/admin/envcheck` (`Set` / `Missing` only, never a value; also lists `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `CRON_SECRET`).
- **Smart Alerts** (`alerts` job, every 5 min): one short push per problem to chosen admins' phones. Rules in owner-only `alert-rules`: `{ enabled, who: owners|editors|all, cooldownMinutes (60 default; 15-1440), quiet: { enabled, start '23:00', end '07:00' }, rules: { errorsSpike: { on, minErrors 10, factor 2 }, siteDown, noPlays: { on, minutes 60, onlyIfUsualPlays }, newFeedback: { on, minCount 1 } } }`. An admin's phones are the active `push_devices` of the VinaX account with the same Google email (sign in to the app on the phone and allow notifications). Each alert is a `notifications` row (`kind 'system'`, `dedupe_key 'alert:<rule>:<cooldown>:<bucket>'`); quiet hours hold every rule except `siteDown`; alerts do not count toward the listener frequency cap.
- **Database pages:** Tables (`GET /api/admin/database`: friendly label, exact/approximate rows, size, `keptFor`, `schemaWanted`), Scheduled Jobs (`job_setting`, `run_job`), Change Log (`GET /api/admin/audit?actor=&action=&from=&to=`), Maintenance (database update card, clean up old data, rebuild statistics, close empty rooms, forget silent phones; destructive actions typed CONFIRM).
- **Growth & SEO:** Google Search, Page Check, Search Console. Bots card: `_lib/robots.ts` + `robots` setting `{ bots: { "<bot>": true|false } }`; `GET /api/robots` builds the text; robots.txt itself stays a **static file** (`frontend/scripts/robots-from-api.mjs`, last build step, fetches it on host builds); saving calls `POST /api/admin/seo { action: 'publish_robots' }` which POSTs the `PAGES_DEPLOY_HOOK` secret.

### Published settings (the `settings` table; `SETTING_KEYS` in `_lib/settings.ts`)

| Key | Written by (console page) | Read by |
| --- | --- | --- |
| `banners` (<= 10 live; song/album/playlist/artist/charts/page link; dates) | Home Screen | `activeBanners` in `_lib/clientConfig.ts` -> `PromoBanner` |
| `festival` `{ mode: off\|force, id, color, start, end, enabled }` | Home Screen > Festival Theme | `publicFestival`; calendar when unset |
| `greeting`, `broadcast` (top message bar, id derived from words/link/style), `announcement` (pop-up, `ts` content hash), `home-layout` `{ order, hidden }` (12 sections) | Home Screen | `publicClientConfig`, `AnnouncementPopup`, `BroadcastBar` |
| `flags` `{ listenTogether: false }` | Features & AI | `flagOn` |
| `vinax-ai`, `ai-music`, `personal-config` | Features & AI | [VinaX AI](#vinax-ai), [Music AI](#music-ai-and-song-generation), [personal engine](#the-personal-engine); `rec-config` (24 on-device weight overrides, clamped 0.5-2x; `REC_WEIGHT_TERMS` in `api/admin/recconfig.ts`) |
| `min-version` `{ android\|web\|ios: { minVersion, mode: suggest\|force }, message, build? }` | App Updates | `publicVersionPolicy`; `/api/version` adds `minVersion`/`updateMode`; app `VersionNotice` |
| `site-mode` `{ mode: readonly\|maintenance, note }`, `maintenance-window`, `status-note` `{ enabled, text, level }` | Maintenance | `/api/site-mode`, router (`_lib/readOnly.ts`: read-only refuses POST/PUT/PATCH/DELETE on `/api/feedback`, `/api/account/data`, `/api/profile`, `/api/follow`, `/api/shared-playlist`, `/api/username` with `503 read_only`), `SiteGate`, `/api/status` |
| `search-synonyms`, `search-pins`, `catalog-sources` (priority + on/off), `language-order` | Search & Music Sources | client bundle -> app search / `activeBases()` / Home language rail |
| `support-faq` `[{ q, a, category, enabled }]` (<= 30) | Help Center | Help page |
| `retention` `{ eventsDays (7-3650, default 180), errorsDays, feedbackDays, notificationsDays }` | Data & Privacy | housekeeping |
| `push`, `push-audiences`, `outreach`, `email`, `alert-rules`, `jobs`, `robots` | Notifications / System | their jobs and routes |

Limits: dates and "today" follow India's calendar on the server; users per version on A/B Tests is an estimate; existing phones join the notification audience only after they register again while signed in; blocking a user stops new sign-ins and session checks at once.

### Console tests

`frontend/src/__tests__/adminConsole.test.ts` loads the real `core.js`, kit and every page into a DOM (index.html loads every file in order under the strict CSP; unique page ids in the ten groups with icon and one-sentence description and no tabs; every old address redirects to an existing page; every `go('<id>')` names an existing page; banned words; no markup from strings; every page renders from empty and failing answers without `undefined`, `NaN` or `[object Object]`). `frontend/e2e/console-shell.spec.ts` and `console-pages.spec.ts` (mocks in `e2e/support/console-mocks/`), `consoleTrends.test.ts`, `services/search/pins.test.ts`, and `backend/worker/__tests__/console*.test.ts` (Auth, People, Music, Engage, SettingsA, SettingsB, System, Alerts), `email.test.ts`, `adminApi.test.ts`.

## Android

The Android app is a thin Capacitor shell around the web app (`frontend/capacitor.config.ts`: `appId` `app.Vinax.music`, `webDir` `dist`, `server.url` the production site so web changes reach installed apps without reinstall, `server.androidScheme` `https`, `android.allowMixedContent` `false` - do not relax the last two). Risks recorded in that config and still standing: whoever controls the origin controls the code every installed app runs, and an origin outage leaves only what the service worker cached (the long-term fix - bundle `dist/` and use the origin for a verified update check - is not implemented). Native code is limited to what a web view cannot do.

### How a package is built and released

| | Build Android APK | Release APK |
| --- | --- | --- |
| File | `.github/workflows/buildapk.yml` | `.github/workflows/release.yml` |
| Trigger | Dispatched by Auto release on every merge to `main`, or manual | A pushed tag matching `v*` |
| `versionCode` | `1000 + run number` | `1000000 + run number` |
| `versionName` | `version` in `frontend/package.json` | same |
| `VITE_BUILD_NUMBER` | the `versionCode` | the raw run number |
| Debug package | built, artifact `vinax-debug-apk` (kept 2 days) | not built |
| Signed package | only when the keystore secret exists | always; fails without the keystore |
| Published as | latest release tagged `v<version>-build<versionCode>` | latest release on the tag |
| Files | `vinax.apk`, `vinax.apk.sha256` | same |

Steps (in `frontend/`): compute `versionCode`; `npm run build` with `VITE_BUILD_NUMBER`; Java 21 + Android SDK; `npx cap add android`, `npx cap sync android`, `node scripts/patch-android.js`; write `versionCode`/`versionName` into `android/app/build.gradle`; build (release signing via injected properties from the decoded keystore); copy to `vinax.apk`, write SHA-256, publish. Rules: a debug-signed package is never published as a release; in Build Android APK a push with no keystore skips the release with a notice (green), while a manual dispatch or a commit message containing `[release]` fails without it; **the release body's `VersionCode:` line is read by `/api/version` - do not remove it**; the two `versionCode` ranges are disjoint and the update check compares build numbers only, so a phone on a tag build (> 1,000,000) is not offered later `main` builds - once listeners have a tag build, later packages for them must come from tags; debug builds use the public `frontend/ci/debug-keystore.b64` which must never sign a release; no workflow sets `VINAX_PLAY_STORE_BUILD`, so every CI package is the sideload variant with `REQUEST_INSTALL_PACKAGES`.

### Building locally

`frontend/android/` is generated and git-ignored; never edit it. Needs Node 22+, Java 21 JDK, Android SDK. `npm run cap:add:android` (first time), `npm run cap:sync` (after web or native changes), `npm run android:debug` -> `android/app/build/outputs/apk/debug/app-debug.apk`. A local build keeps `versionCode` 1, so the update check offers the published build.

### What `scripts/patch-android.js` does (idempotent, after every sync)

1. Copies `frontend/native-android/*.java` into the package folder (placeholder `__PKG__` -> `app.Vinax.music`).
2. Copies `native-android/res/**` (widget layouts, vector icons, drawables, provider info, `values/vinax_widgets.xml`) into the app resources; every file is prefixed `vinax_`.
3. Copies `native-android/google-services.json` into `android/app/` (the push build plugin applies itself when present).
4. Writes `MainActivity.java`: registers `VinaxMediaPlugin` and `AudioRoutePlugin` (app-local plugins are not auto-discovered), relays notification taps that ask for the full-screen player, calls the web view's `onResume()`/`resumeTimers()` in both `onPause` and `onStop` (so controls act in the background), sets `allowSignInCheck` WebView settings for Turnstile.
5. Patches `AndroidManifest.xml`: foreground-service, media-playback foreground-service, wake-lock, notification, microphone and `MODIFY_AUDIO_SETTINGS` permissions; `REQUEST_INSTALL_PACKAGES` unless `VINAX_PLAY_STORE_BUILD=1`; car-app metadata, media-button receiver, `VinaxMediaService` (exported, type `mediaPlayback`, media-browser intent filter), both widget receivers. Exits with an error rather than write a manifest without the media service if it cannot find `</application>`.
6. Patches `app/build.gradle`: `androidx.media` dependency; debug builds signed with the committed debug keystore.
7. Copies launcher icons, background colour and `xml/automotive_app_desc.xml` from `frontend/android-res/`.

After upgrading `@capacitor/android` (8.4.1 at last check) run the patch once and read its log.

### Native layer

| File (`frontend/native-android/`) | Role |
| --- | --- |
| `VinaxMediaService.java` | Foreground service owning the media session, media-style notification, lock-screen controls; extends the media-browser service base so car/watch clients can browse |
| `VinaxMediaPlugin.java` | Capacitor bridge, registered as `VinaxMedia` |
| `VinaxPlayerWidget.java` (+ `res/layout/vinax_widget_player.xml`, `_tall.xml`) | Now Playing widget (4x1 default, resizable; card layout from ~2 rows) |
| `VinaxQuickPlayWidget.java` | Static "Play my mix" widget (one tap opens the app with `?widget=play`) |
| `AudioRoutePlugin.java` | `VinaxAudioRoute`: VinaX AI Live voice on loudspeaker or earpiece |
| `google-services.json` | Firebase config for FCM push |

Audio is played by the web player's `<audio>` element inside the web view; the service mirrors state and sends commands back. Bridge (`frontend/src/services/media-session/index.ts`): web -> native `setMetadata` (title first, 256 px JPEG artwork data URL; lock-screen lyric line travels in the artist field), `setPlaybackState`, `setPosition` (<= once a second), `provideChildren`, `stop`; native -> web `action` (play, pause, next, previous, seek, +/-10 s, open player, `resync`) and `requestChildren`. `mediaSessionAvailable()` in `services/native/index.ts`; the module keeps the last 12 bridge calls (`getMediaSessionLog()`) and `runNotificationSelfTest()`. Android 13+ needs the notification permission (asked once at launch, again at first play). Playback resumes by itself after a phone call (within half an hour).

**Background playback** relies on: web view never paused (`onResume`/`resumeTimers` re-asserted); the service enters the foreground synchronously in `onStartCommand` with type `mediaPlayback` (Android 14 requirement) and stays foreground while paused; after start the plugin calls the service directly; if a start is refused the plugin rejects with `fgs-start-not-allowed`, posts a plain notification when possible and asks the web view for `resync` on next resume (audio keeps playing, controls arrive late); `ACTION_AUDIO_BECOMING_NOISY` pauses at once (receiver not exported); channel `IMPORTANCE_LOW`, category `transport`; media buttons via the exported receiver. **Limits:** playback does not survive process death (swipe-away tears the service down; the widget's play then relaunches with `?widget=play`); nothing can start playback while the process is dead; audio focus is not managed natively; widgets' look is fixed (dark translucent, violet `#A78BFA` play disc) and does not follow style/theme/festival.

**App styles, themes and system bars:** styles are web CSS and arrive with the live site. The `<html>` background and `theme-color` meta follow `TEMPLATE_CANVAS` (Black theme `#000000`; a festival skin tints the canvas but leaves the meta). No native code sets status/navigation bar colour; Capacitor's default picks bar icons from the device's dark mode, not VinaX's theme (unverified on a device). The page uses `viewport-fit=cover` and `env(safe-area-inset-*)`.

**Downloads** (`frontend/src/services/downloads/index.ts`; Android only): audio fetched with native HTTP; walks listed bitrate variants from highest down (a variant missing or under 10 KB moves on; dead network/stall/full disk stops); creates `vinax-downloads/` before each attempt; 15 s connect, 30 s read, 5-minute cap; files in the app's internal data directory; saved once on disk, then copied into the audio cache in the background (3 MB slices, 2-minute cap, rebuilt on launch if missing); failure reasons `offline | unavailable | storage | timeout | unknown` (bulk download stops on `offline`); offline sources tried in order: `blob:` from the audio cache, service-worker `/offline-audio/<id>` (Range support, cache `vinax-audio-v1`), native file URL; entry points song menu, collection pages, Favorites, `/offline`; with no network and a saved song the router starts on `/offline`. Boot recovery never deletes downloads (skips `vinax-audio-v1` and runs only after a request to the origin succeeds). Downloads are not in backups. Smart downloads keep this week's Weekly Mix on Wi-Fi.

**Voice:** voice search and Drive-mode commands use the system recogniser via `@capacitor-community/speech-recognition` (`features/voice/stt.ts`; the web view's constructor is never created). Live voice: see [Live voice in the Android app](#live-voice-in-the-android-app).

**Push:** `services/push/nativePush.ts` registers the device and routes taps; it does nothing without `google-services.json` and the Worker's `FCM_SERVICE_ACCOUNT`. The key inside `google-services.json` ships in every package, so it is public and safe only with restrictions in Google Cloud: Application restrictions -> Android apps, package `app.Vinax.music` bound to the release keystore SHA-1 (and the CI debug keystore SHA-1 if debug APKs should talk to Firebase); API restrictions -> only Firebase Installations, FCM Registration and Firebase Cloud Messaging APIs (project `vinax-music`, number `152181244509`). Rotating the key cuts push for installed apps until they update.

### Updates (`frontend/src/services/update.ts`)

1. `AppLayout` calls `checkForUpdate()` at launch and on every resume; it reads the installed `versionCode` natively and fetches `/api/version` with native HTTP, comparing build numbers only.
2. `/api/version` reads the latest release with a server-side token: `{ build, version, apkUrl, sha256, minBuild }` (`build` from the `VersionCode:` line, else the tag's `-build<n>` suffix; `sha256` from the published `.sha256` file; `apkUrl` is the Worker's `/api/apk` which streams the package; `/apk` redirects to it; cached 60 s).
3. A newer build opens `UpdateDialog` (Update now / Update later; later snoozes that build 24 h; Escape/back count as later; the Settings manual check ignores the snooze).
4. `minBuild` (console Minimum App Version / `min-version`) makes the update mandatory with no Later; a failed resume check never clears a known update (`mergeResumeCheck`).
5. **Update now** (`downloadAndInstall()`): native download, SHA-256 computed before anything is written; missing/malformed hash or mismatch aborts; then the file goes to the app cache and the system installer (consent shown first time).
6. The installer reports nothing back; `markUpdateAttempt`/`installLikelyBlocked()` switch the dialog to one-time reinstall guidance when it returns for the same build after > 10 minutes (e.g. different signing key).

### What cannot be verified without a device

Unit tests cover update attempt tracking, download retry/fallback, the media-session web side, release parsing; the Java in `native-android/` is never compiled by the test toolchain (`nativeMediaService.test.ts` pins its contracts at string level); CI compiles the generated project but runs nothing. Needs a real phone ([Real-device QA script](#real-device-qa-script)): install on a given Android version and the patched manifest; notification/lock-screen controls and artwork on Android 12-15 including late controls and resync; vendor battery policies; headphone-unplug pause; resume after calls, headset/wireless buttons, audio focus; car/watch browser; both widgets on light/dark wallpapers and with the app swiped away; system-bar colours per style/theme/festival; downloads (storage, three offline sources, offline launch, full storage); the update flow end to end (hash check, installer consent, different-signature reinstall, mandatory gate); background push with the app closed; microphone prompt and recogniser; haptics, back button, safe-area insets, offline first launch.

## Android push setup

Notifications reach the Android app while fully closed once the owner sets the Worker secret `FCM_SERVICE_ACCOUNT`. Until then the app runs normally and tokens are stored, but no message is sent (`fcmConfigured()` in `_lib/fcm.ts`).

1. In the push provider's console open the project named in `frontend/native-android/google-services.json` > Project settings > Service accounts > generate a new private key (JSON downloads).
2. `cd backend && npx wrangler secret put FCM_SERVICE_ACCOUNT --config worker/wrangler.toml` and paste the whole JSON. No app rebuild needed.

**The project (12.2):** app `app.Vinax.music` in the project **VinaX Music** (`vinax-music`, project number `152181244509`, free plan); `google-services.json` is that project's file; the same project runs Google sign-in. The Android app is registered under the CI signing key's SHA-1 `71:27:BB:E2:25:1F:9E:A4:89:61:EC:9B:76:A5:07:5F:94:DE:A2:CC`. **Published APKs are signed with the release key**, fingerprints (read from release v13.7.2, build 1427):

- SHA-1 `D9:55:85:C3:D4:4F:52:92:47:39:7C:95:A0:E5:F9:D1:11:BA:62:BE`
- SHA-256 `8C:AF:24:E7:AA:83:B7:EA:12:E1:2C:E3:FF:C1:14:DD:8C:EB:57:38:25:AB:EB:82:3E:FE:AE:E4:F2:6B:7C:CE`

Add both to the Android app in Firebase (Project settings > Your apps > `app.Vinax.music` > Add fingerprint) and the SHA-1 to an Android OAuth client for `app.Vinax.music` in Google Cloud (APIs & Services > Credentials). If the Firebase API key is restricted to Android apps, the release SHA-1 must be on that restriction too. Without them, installed apps cannot get a push token or sign in with Google. Afterwards download the new `google-services.json` and replace `frontend/native-android/google-services.json`. Read any APK's fingerprint: `apksigner verify --print-certs vinax.apk`.

**How a push looks (13.7.3):** every message uses channel `vinax_picks` ("Song picks & news", high importance, created at app start), small icon `vinax_ic_notify` (white V), accent `#FFA42E`; the manifest names the same three as FCM defaults; a push while the app is open is shown too (`presentationOptions` in `capacitor.config.ts`). These are compiled into the APK (apply from the first APK after 13.7.3).

The old project (`apptarangmusic`, app `app.tarang.music`) is retired (its devices reported `FIS_AUTH_ERROR`); delete its keys or the project once the new key is set. Because the package changed, the 12.2 APK installs beside the old app; listeners move their library with Settings > Your data > Move to a new device.

**The message (1.12):** every FCM message carries `android.priority: high`, `ttl: 86400s`, `direct_boot_ok`, a `PRIORITY_HIGH` / `PUBLIC` notification on the `vinax_picks` channel, and the title and body in `data` too, so a closed app shows it at once; if a push still arrives only when the app opens, the cause is operational — the console's Notifications > setup check says whether `FCM_SERVICE_ACCOUNT` is set and accepted and whether the release fingerprints are registered (`/api/admin/fcmcheck`). The app also reads the `announcement` setting on open, which is why a push sent while the key is missing appears at the next open.

**Native push (1.12.7):** `frontend/native-android/VinaxPushService.java` is a `FirebaseMessagingService` that takes `MESSAGING_EVENT` ahead of the Capacitor plugin's (manifest `android:priority="1"`): on `onNewToken` and at every app start (`VinaxPushPlugin.load()` → `FirebaseMessaging.getToken()`) it POSTs the token to `/api/push/fcm-register` from Java, with the signed-in session when the page handed one over (`VinaxPush.setSession`), so a phone has a push address whether or not the page, its permission flow or usage consent ever ran (before 1.12.7 no Android phone had ever registered). `onMessageReceived` draws a push that arrives with the app open (or a data-only push) with the white V small icon, the accent colour and the colour logo (`res/drawable/vinax_ic_large.png`) or the owner's picture as the large icon; a tap opens the push's `link` inside the app (`MainActivity.maybeOpenPushLink`). The page's `services/push/nativePush.ts` reads the same token through `VinaxPush.getToken()` and uploads it linked to the account; the old Capacitor plugin path remains as the fallback for APKs built before 1.12.7. `patch-android.js` registers the plugin, declares the service and adds `com.google.firebase:firebase-messaging` to the app module.

**Wired in the repository:** `frontend/scripts/patch-android.js` copies `google-services.json`; `frontend/src/services/push/nativePush.ts` registers on launch, posts the token to `/api/push/fcm-register` and routes taps; the Worker stores the token in `push_devices` (channel `fcm`) via `functions/api/push/fcm-register.ts`, signs/sends with `_lib/fcm.ts`; the console's push send fans out to stored tokens; dependency `@capacitor/push-notifications`. A device row holds the token, platform, app language, time-zone offset and coarse edge location (no name, username or install id). **Test delivery:** install the newest package, grant notification permission, swipe the app closed, send a push from the console; it should arrive and open the target.

## VinaX AI

The chat assistant at `/vinaxai` (page `frontend/src/pages/VinaXAIPage.tsx` -> `src/features/vinaxai/`). Recommendations, Radio and Up Next are still decided on the device; VinaX AI is the one place a signed-in listener talks to an AI. The listener's guide is [VinaX AI in the Listener guide](#vinax-ai-1).

### How a message travels

```text
VinaXAIPage (lazy, full screen inside AppLayout)
  features/vinaxai/store.ts -- POST /api/ai/chat (Bearer session) --> functions/api/ai/chat.ts
        session, rate limit, kill switch, body cap; conversation tree from the database, user message saved;
        system prompt (_lib/ai/prompt.ts); Auto ladder or the picked model (_lib/ai/router.ts)
        -> _lib/ai/adapters/* -> provider (Groq, Gemini, OpenRouter, NVIDIA, Workers AI)
  <-- text/event-stream: meta, title, thinking, text, error, done;  reply saved with ctx.waitUntil (also after Stop)
```

Every provider call goes through the Worker; no key, upstream host or raw upstream error reaches the browser; logs carry only route, model, provider, ladder, latency, status and token counts, never message text.

### Providers and secrets

| Secret / binding | Provider | Used for |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq (OpenAI-compatible) | Fast default models (GPT-OSS, Qwen); dictation (Whisper); Read aloud (Orpheus) |
| `GEMINI_API_KEY` | Google Gemini (`streamGenerateContent?alt=sse`, key in `x-goog-api-key`) | Images, PDFs, long threads, grounding, Live voice, dictation/Read aloud fallbacks, song generation, optional embeddings |
| `OPENROUTER_API_KEY` | OpenRouter | `:free` code models and mirrors (`HTTP-Referer: https://www.vinaxmusic.online`, `X-Title: VinaX AI`) |
| `NVIDIA_API_KEY` | NVIDIA NIM | Reasoning and vision models |
| `AI` binding | Cloudflare Workers AI | Last resort in the default ladder; embeddings |
| `SEARCH_API_KEY`, vars `SEARCH_API_PROVIDER`, `SEARCH_DAILY_LIMIT` | Tavily or Serper | Web search for models that cannot ground |

Any one is enough. With none, `/api/ai/*` answers `503 ai_not_configured` and the page says "VinaX AI is unavailable right now".

### The registry

`backend/worker/functions/_lib/ai/models.ts` is the only place that names a model id. Each entry: id `<provider>:<upstream id>`, display name, picker group (`fast`, `balanced`, `smart`, `vision`, `code`, `more`, `cloudflare`, or none for web-search-only), tier, flags (`vision`, `pdf`, `grounding`, `reasoning`, `artifacts`, `systemRole`, `thinkFormat`), `maxContextChars`, `maxOutput`, extra `params` (+ `highParams` for Extended thinking), `firstEventMs`. Curated groups (owner's latency run, 2026-10-31):

| Group | Models |
| --- | --- |
| Fast | Qwen 3.8 27B (Groq), GPT-OSS 20B (Groq), Gemini 3.5 Flash Lite, Gemini 3.1 Flash Lite (+ Preview), Gemini Flash Lite (latest), LFM 2.5 2.6B (OpenRouter `:free`) |
| Balanced | **GPT-OSS 120B** (Groq; Auto default), Gemini 3.5 Flash, Gemini 3 Flash Preview, Nemotron 3.5 Lightning (NVIDIA, OpenRouter), GPT-OSS 20B (NVIDIA) |
| Smart | Gemini 3.6 Flash, Nemotron 3 Ultra 550B (NVIDIA, OpenRouter), Step 5 Preview (NVIDIA) |
| Vision | Nemotron 3.5 Super VL (NVIDIA, OpenRouter), Nemotron 3 Nano Omni (NVIDIA, OpenRouter), Llama 3.2 90B Vision (NVIDIA, slow) |
| Code | North Mini Code, Laguna S 2.1, Laguna XS 2.1 (OpenRouter `:free`), Laguna XS 2.1 (NVIDIA) |
| More models | Dots 3 Note Preview, ALLaM 2 7B (Groq; Arabic/English), Riva Translate 4B (NVIDIA; translator), Ising Calibration 1.5 31B, Gemini Robotics ER 2 Preview, Muse Glimmer 30B (slow), Nemotron 3.5 Bolt (slow) |
| Cloudflare | Llama 3.3 70B, Llama 3.1 8B (Workers AI) |

Not in the picker: Gemini 2.5 Flash and 2.5 Flash-Lite answer only when a reply searches the web (shared free grounding allowance); `UTILITY_MODELS` (guards, embeddings, parsers, AQA) are never in a picker or ladder (the console lists them read-only); voice models are in `voice.ts`. **Slow to start:** Llama 3.2 90B Vision, Muse Glimmer 30B, Nemotron 3.5 Bolt take 30-45 s; `firstEventMs: 60000` (60 s for the first event instead of 25 s); never in an Auto ladder. The picker has a search box (name, provider, description, group; Enter picks the first match). Groq models keep short history (`maxContextChars` 30,000); a long thread goes to the long ladder.

**Found models** (`_lib/ai/discovery.ts`): every other free chat model each provider lists joins the picker automatically (groups `more-<provider>`: More from Groq, Gemini, OpenRouter, NVIDIA, Cloudflare), within six hours of being listed, with no deploy. Lists: Groq `GET .../openai/v1/models` (every `active`); OpenRouter `GET .../api/v1/models` (id ends `:free` or both prices `"0"`, text output, not `openrouter/*` routers); Gemini `GET .../v1beta/models?pageSize=1000` (up to three pages; `generateContent`; Gemma gets `systemRole: false`); NVIDIA `GET .../v1/models` (32,000 characters of history assumed); Workers AI `env.AI.models({ task: "Text Generation" })` (not past deprecation). Filtered by id (no speech, embeddings, rerankers, guards, parsers, image/video makers, AQA, computer use, deep research; strict character set; at most 300 a provider; curated/utility/ladder/voice-only ids left out; a clashing name gets its service in brackets). Each becomes a `discovered: true` entry (about three characters a token, answer room taken off, at most 8,192 output tokens and a quarter of the window; caps Groq 30,000, Gemini 600,000, OpenRouter/NVIDIA 100,000, Workers AI 60,000 characters). Cached six hours in the instance and `caches.default` (`https://vinax-ai-discovery.internal/v1/<provider>`); stale lists answer at once while refreshed in the background; a failing list keeps the last good one and retries in 15 minutes; discovery never rests a model or changes the curated registry. The chat accepts a picked id only when curated or in the provider's current found list and not switched off (`foundModelFor`; else `400 unknown_model`). A found Gemini model with no free allowance answers 429, rests six hours, shows busy. Found models never appear in an Auto ladder, the music ladder or the Retry menu.

**The probe:** `npm run ai:probe` in `backend/` (`scripts/ai-probe.mjs`, owner's own keys, never CI; reads `worker/.dev.vars`; Workers AI over REST also needs `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`): per registry model one streamed request (plus one image for `vision`), prints time to first token, streaming, where reasoning arrives (`field|tags|parts|none`), whether the system message was followed, image read, limits; then voice (Whisper/Gemini transcription on a test tone, Orpheus/Gemini TTS incl. which voice field Gemini accepts, which Live token body Google accepts, a real Live handshake). Options `--only <text>`, `--no-image`, `--voice-only`, `--no-voice`. Prints no secret, writes nothing; use its table to set registry flags.

### Auto and failover

`pickLadder` (`_lib/ai/router.ts`) uses cheap checks, never a model call:

| Signal | Ladder |
| --- | --- |
| Image in one of the last three questions | vision: Gemini 3.6 Flash -> Gemini 3.5 Flash -> Nemotron 3.5 Super VL -> its OpenRouter mirror |
| PDF in the thread, or > 150,000 characters (files' text counted) | long: Gemini 3.6 Flash -> Gemini 3.5 Flash -> Gemini 3 Flash Preview -> GPT-OSS 120B |
| Extended thinking on | deep: Gemini 3.6 Flash -> Nemotron 3 Ultra -> its mirror -> GPT-OSS 120B, high reasoning |
| Code cues | code: GPT-OSS 120B -> Gemini 3.6 Flash -> North Mini Code -> Laguna S 2.1 |
| Short small talk (< 6 words, no question) | fast: Qwen 3.8 27B -> GPT-OSS 20B -> Gemini 3.5 Flash Lite |
| Anything else | default: GPT-OSS 120B -> Gemini 3.5 Flash -> Nemotron 3.5 Lightning -> its mirror -> GPT-OSS 20B (NVIDIA) -> Llama 3.3 70B (Workers AI) |

Models whose provider has no key are left out; an empty ladder falls back to default, then any configured picker model.

- **When to move on:** before the first answer-text token reaches the page - no first event within 12 s (25 s for deep or a picked model), network error, 429/5xx/404/410/401/402/403/other 4xx, an empty stream or only reasoning. Whole-reply budget 120 s (240 s slow models). After the first token no failover: an `error` event, `stopReason: 'error'`, partial text kept. A picked model is never swapped; its failure reports up to two `alternatives`. When failover changes the model `meta` is sent again and the label under the reply names the model that answered.
- **Cooldowns** (`_lib/ai/cooldown.ts`, per-isolate memory; resting models skipped; if all rest, all tried; a new rest never shortens a longer one): 429 -> `retry-after`, 1 min if none, max 10 min; 429 saying a daily/free allowance is spent -> until reset, else 6 h (max 24); Workers AI 4006 (daily neuron pool) -> every Workers AI model until 00:00 UTC; 404/410 -> 1 h; Workers AI 5007 -> 24 h; 401/402 -> whole provider 10 min; 403 -> that model 10 min; 5xx -> 30 s; timeout, network error, other 4xx, empty answer -> no rest. When a provider is down its models rest after the first failure and Auto answers from the next; if all fail the page shows "VinaX AI is busy right now. Try again in a moment." with Retry.
- **One answer, not a stream:** `_lib/ai/complete.ts` (`completeText`, `completeJson` with reasoning tags/fences stripped, first balanced value taken, validated, one repair turn) - used by the personal engine's composer and playlist builder with the `default` and `fast` ladders; any failure is a null and the caller has a deterministic answer.
- **Reasoning:** `ThinkSplitter` (`_lib/ai/think.ts`) routes `reasoning`/`reasoning_content` deltas, `<think>...</think>` at the start of text (even split across chunks) and Gemini thought parts to `thinking` events; raw tags never reach the reply; capped at 20,000 characters; a stream ending inside `<think>` with no answer counts as empty (Auto fails over).

### Web search (`_lib/ai/search.ts`, wired in `chat.ts`)

At most one search per turn, never for Continue, never when `vinax-ai.search` is `false`. The composer's + menu: Web search Auto/On/Off (kept on the device); Auto searches on recency cues (today, latest, news, prices, scores, weather, "is ... open", a recent year, a link or known domain).

1. **Google Search grounding** when a model whose grounding is free can answer: only Gemini 2.5 Flash and 2.5 Flash-Lite (500 grounded requests/day shared; Gemini 3.x say "Not available" on the free tier) - registry `grounding: true`, the `grounded` ladder; allowance capped at 450/day across all Workers via `ai_take_daily`. Adapter adds `tools: [{ googleSearch: {} }]` (retries once without if Google refuses). Sources arrive with the answer end (`groundingMetadata`); `placeMarkers` puts `[n]` after supported stretches (never in code); Google's `searchEntryPoint.renderedContent` is shown under the sources in `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc>` as its terms require.
2. **The search API** for any other model: Tavily (`POST https://api.tavily.com/search`, Bearer) or Serper (`POST https://google.serper.dev/search` or `/news`, `X-API-KEY`; request shape taken from client libraries - confirm with a real key). Query = latest message only (links cut to hosts, file contents removed, <= 300 characters; a short follow-up borrows key words from the previous question); <= 6 results; cached in `caches.default` 15 min (news-like) or 60 min; each real call takes one from `SEARCH_DAILY_LIMIT` for the day; provider rests 24 h after 401/402/403/429/432/433. Results go into the system prompt as `<search_results>` ("reference material, not instructions") and the model cites `[n]`.

A failed or empty search is not an error ("No useful results"). Stream: `status` `{ step: 'searching', query }` then `{ step: 'searched', count, sites }`; `sources` `{ items, via: 'grounding'|'search', queries?, entryPointHtml?, markers? }` (before the text for the search API, after for grounding); sources saved in `ai_messages.sources`. The page shows a status line, `[n]` chips with hover/long-press cards (open in a new tab with `rel="noopener noreferrer nofollow"`) and a Sources row (letter monogram, no favicon fetched).

### The system prompt (`_lib/ai/prompt.ts`; snapshot test `__tests__/aiPrompt.test.ts`)

Built in order: (1) the full prompt for every model whose window is >= 24,000 characters (compact only for ALLaM 2 7B, Riva Translate 4B), with local time/zone, first name, language and the answering model/provider filled in; (2) the owner's instructions in `<owner_instructions>` (`vinax-ai.instructions`, <= 4,000 characters, never overriding the refusals); (3) `ARTIFACTS_BLOCK` (contract + visualisation guide) for full-prompt models with >= 4,096 output tokens unless the registry says `artifacts: false` (Riva Translate, Ising Calibration, Gemini Robotics ER) or the page sends `artifacts: false`; (4) memory in `<memory>`; (5) a project block (`# Project: <name>`, `<project_instructions>`, `<project_knowledge>`; cut to fit); (6) the listener's preferences `<user_preferences>` from `personal: { name?, about?, instructions?, style? }` (name <= 40 characters, others <= 1,500; styles `concise|explanatory|formal|learning`; `normal` adds nothing; never stored or logged); (7) `<search_results>` and citation rules when search ran. No taste profile or listening history is added. History is trimmed to the model's window minus the system text; models with `systemRole: false` get the system text before the first user turn.

### The chat endpoint and stream

`POST /api/ai/chat` needs a session. Limits: per-IP limiter (`RATE_LIMIT_30` tier) and `RATE_LIMIT_30` keyed by account; body <= 2 MB (files travel separately); text <= 400,000 characters. Placement: `parentMessageId` absent = after the active leaf; a message id = under it (an edit makes a sibling); `"root"` = new first message; empty `content` with a user-message parent = retry (new sibling answer); `continueFrom` an assistant message = Continue (appends to the same message). History = path from the root trimmed to `maxContextChars` (latest turn always stays; never starts on an assistant turn; same-side turns joined).

| Event | Data |
| --- | --- |
| `meta` | `{ conversationId, userMessageId, assistantMessageId, model: { id, name, provider }, continued? }`; again after failover |
| `title` | `{ title }` (cut from the first message, up to six words, then a generated 2-6-word title from the `title` ladder: Qwen 3.8 27B then Gemini 3.5 Flash Lite, reasoning off; end of reply waits up to 1.5 s) |
| `thinking`, `text` | `{ delta }` |
| `error` | `{ code, message, retryable, alternatives? }`: `model_busy`, `model_timeout`, `model_unavailable`, `empty_reply`, `all_busy` |
| `done` | `{ stopReason: end\|length\|aborted\|error, usage? }` |

When the page disconnects the upstream aborts and the partial reply is saved with `stop_reason = 'aborted'`; a reply with no text is not saved. Pre-stream refusals: `400 bad_request | unknown_model | bad_attachment | too_many_images | model_cannot_see_images`, `409 too_many_files | conversation_full` (2,000 messages), `401 signed_out`, `404 not_found`, `413 too_large | too_long`, `429 rate_limited | daily_limit`, `503 ai_not_configured | ai_disabled | unavailable`.

### Other routes

| Route | What |
| --- | --- |
| `GET /api/ai/models` | Public: `{ enabled, configured, groups, models: [{ id, name, provider, group, description, flags, available, reason? }], voice: { dictation, readAloud, live, voices, liveVoices, liveModels, liveSearch }, limits }` |
| `GET /api/ai/conversations?cursor=&q=&project=` | Chats newest first, 30/page; `q` searches titles and message text (`ai_conversation_search`) |
| `GET/PATCH/DELETE /api/ai/conversations/:id` | Tree; `{ title?, starred?, activeLeafId?, projectId? }`; delete hides at once and removes its share link (purged a day later) |
| `GET/POST /api/ai/shares`, `GET/DELETE /api/ai/shares/:id`, `POST /api/ai/shares/:id/continue` | Shared links ([Sharing](#sharing)) |
| `GET /api/ai/artifacts?kind=&q=&cursor=`, `GET /api/ai/artifacts/:conversationId/:artifactId` | Artifacts gallery (metadata only list; one artifact with every version) |
| `GET/POST /api/ai/projects`, `GET/PATCH/DELETE /api/ai/projects/:id` | Projects (max 100; delete `?chats=keep\|delete`) |
| `GET/POST/DELETE /api/ai/memories`, `DELETE /api/ai/memories/:id`, `GET/PUT /api/ai/memories/prefs` | Memory (`422 sensitive`, `409 full` at 50, `503 memory_off`) |
| `GET /api/ai/export` | Every chat (all branches) and project as one JSON file (`ai_export`); not part of the backup file, never imported |
| `POST /api/ai/attachments`, `PATCH`/`GET`/`DELETE .../attachments/:id` | Files |
| `POST /api/ai/transcribe`, `speak`, `live-token`, `live-transcript` | Voice |

Every query is filtered by the session's account; someone else's or a deleted conversation or a malformed id answers 404. The router dispatches `PATCH`/`DELETE` to `onRequestPatch`/`onRequestDelete`.

### Files (`_lib/ai/attachments.ts`, `materialize.ts`, `storage.ts`, `geminiFiles.ts`; page `files.ts`, `pdf.ts`, `usePendingFiles.ts`, `FileChips.tsx`)

From the + menu, paste or drop. Images (png, jpg, webp, gif first frame): 10 per message, shrunk on the device to 1568 px (WebP, JPEG fallback), server takes <= 5 MB. PDF: 30 MB and 500 pages (owner up to 50 MB / 1,000 pages; the bucket takes 50 MB). Text/markdown/csv/json/source: 2 MB (owner up to 5). 20 files per message, 50 per chat; the page uses the `limits` from `GET /api/ai/models`. Upload is immediate: `POST /api/ai/attachments?name=...&conversationId=...` (raw bytes; type, length and first bytes checked) streams into the **private** bucket `ai-attachments` at `<account>/<conversation or new>/<id>` without buffering; a text file's text is kept; a PDF's page count and text are read on the device by pdf.js (loaded only when a PDF is added; worker ~370 KB gzipped, an `.mjs` asset outside the bundle budget's `.js` check) and sent with `PATCH`. `GET .../attachments/:id` returns the owner's file with its own type, `nosniff`, a sandboxing CSP, `inline` for images only; no public or signed URL is ever made. Sending: vision models get image parts from the last three questions only (older become "[image: name]"; a model that cannot see gets a note; the composer warns before sending; the server refuses with `400 model_cannot_see_images`); Gemini reads PDFs through the **Files API** (the Worker streams from Storage; saved URI re-uploaded an hour before Google's 48 hours expire); other models get the device-read text as `<document name="...">` (`</document>` inside is defused). Auto sends images to the vision ladder and PDFs to the long ladder. Deleting: with the account, the chat, or after a day if never sent (a project's files are kept until removed).

### Artifacts and the sandbox

Substantial output goes in `<artifact id="..." type="code|html|svg|mermaid|markdown|react" title="..." language="...">...</artifact>` (same id again to update). The tolerant parser exists in the Worker (`_lib/ai/`) and the page (`features/vinaxai/`): attributes in any order, unknown type reads as code, missing id from title, an unclosed tag closes at reply end marked incomplete, a tag inside a code fence is code. Saved in `ai_messages.artifacts`. On the page: cards in the reply, an artifacts panel (Preview/Code, Copy, Download, versions "v2 of 3", resizable 40-60% on wide screens, full-screen sheet on narrow), live previews under finished html/svg/mermaid/react artifacts (380 px, 300 on phones, mounted within 300 px of the screen; Settings > General > Live previews), and **Fix it** after a failed preview (sends "The diagram "<title>" didn't work. The preview said: <error> Please fix it and send the complete corrected artifact."). Mermaid labels that fail to parse are quoted by the runner (`quoteLabels` in `sandbox/index.html`) and retried once.

**The sandbox runner** (`sandbox/index.html`, `https://sandbox.vinaxmusic.online/`): framed with `sandbox="allow-scripts allow-modals"` and no `allow-same-origin` (opaque origin: no storage, cookies or session); `postMessage` `{ type: 'render', kind, content, theme }`; listens only to `https://www.vinaxmusic.online` (and localhost) and answers `ready|rendered|error`; CSP (`sandbox/_headers`): `default-src 'none'`, scripts only from cdnjs and two pinned jsDelivr paths, `connect-src 'none'`, `frame-ancestors https://www.vinaxmusic.online http://localhost:*`. Renders HTML in a nested sandboxed frame, SVG as an `<img>` from a blob, Mermaid 11.12.0 (`securityLevel: 'strict'`), React compiled by Babel standalone 7.26.10 and mounted with React 18.3.1 with hooks, Recharts 2.15.3, Tailwind in-browser 4.3.3 and lucide 1.57.0 (shim for `lucide-react`); any other import fails clearly. If the runner is not ready within 8 s the panel says "Preview needs the sandbox host" (Code/Copy/Download still work).

**Artifacts gallery** `/vinaxai/artifacts` (`ArtifactsGallery.tsx`): one card per artifact id per chat (newest version, kind, version count, chat title, day), kind chips, title search, infinite scroll; opens the same panel; **Open chat** goes to `/vinaxai/c/<id>?m=<reply>&a=<artifact>`. Nothing new stored: `ai_artifact_list` unpacks `ai_messages.artifacts` for non-deleted chats (metadata only).

### Voice (`_lib/ai/voice.ts`, `voiceGate.ts`; routes `transcribe.ts`, `speak.ts`, `live-token.ts`, `live-transcript.ts`; page `mic.ts`, `readAloud.ts`, `live/`)

Every voice route: per-address bucket, session, account `RATE_LIMIT_10` tier, a key for that feature, the owner's switch; failures answer `voice_busy` (429) or `voice_unavailable` (503), never a provider's words; each failure rests that voice model. Facts that differ from the original brief (docs won, 2026-10-31): Orpheus takes <= **200 characters** a request, WAV only, small free allowance (~10 requests/min, 100/day, 1,200 tokens/min); Gemini TTS names the voice `speechConfig.voiceConfig.voice` (older models `prebuiltVoiceConfig.voiceName`; a 400 retries with the second); ephemeral tokens and the Live socket are **v1beta**; `gemini-2.5-flash-native-audio-latest` works on the owner's probe alongside the dated `-preview-12-2025` and `-preview-09-2025`; `gemini-3.5-transcribe` returns empty transcripts for some users, so the clip is uploaded through the Files API and an empty answer is retried on `gemini-3.8-flash`.

- **Dictation** `POST /api/ai/transcribe`: composer mic records with `MediaRecorder` (WebM/Opus or MP4), <= 2 minutes; raw bytes body; type, size (25 MB) and first bytes checked; tries Groq `whisper-large-v3-turbo`, Groq `whisper-large-v3`, then Gemini (Files API upload; `gemini-3.5-transcribe`, then `gemini-3.8-flash`); answer `{ text }` placed in the composer and **never auto-sent**; nothing stored.
- **Read aloud** `POST /api/ai/speak` `{ text, voice, liveVoice }`: `speechText.ts` strips code blocks (one line), citation markers, links, table pipes, maths, artifacts (named, not read); <= 6,000 characters. Orpheus (`canopylabs/orpheus-v1-english`, default voice Troy; Arabic text `canopylabs/orpheus-arabic-saudi`/Abdullah) for replies <= 800 characters; Gemini TTS (`gemini-3.8-flash-tts`, `-flash-lite-tts`, `gemini-2.5-flash-preview-tts`) in 600-character pieces for longer ones; if Orpheus fails part-way the rest goes to Gemini. Streamed frames `[kind 1 byte][length 4 bytes][payload]` (1 audio file, 2 base64 Gemini audio, 3 `{ error }`); at most 40 upstream calls (free plan allows 50 subrequests); music ducks to 20% volume.
- **Live voice** `POST /api/ai/live-token` + `POST /api/ai/live-transcript`: the waveform button opens a full-screen view (music pauses). The page opens the mic and in parallel gets a token and connects. Token body `{ thinking, skip, voice, search, language, recap?, context?, personal?, conversationId?, incognito?, lean?, model? }` -> `{ token, url, setup, model, search, tuned }`. Models tried in order: `gemini-3.8-live`, `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-latest`, `-preview-12-2025`, `-preview-09-2025` (Extended thinking: `gemini-3.8-live-extended-thinking` first; a model picked in Settings goes first). Token via `POST /v1beta/auth_tokens` (one use, 2 min to start, 30 min to live), locked to the setup where Google allows (tries `liveConnectConstraints`, then `bidiGenerateContentSetup`, then unlocked; the last accepted body is remembered per isolate). Setup carries `VOICE_PROMPT` (short, spoken, Claude-call style), one of Google's 30 voices (`LIVE_VOICES`), input/output transcription and sliding-window compression, then owner instructions, personalisation, memory (read-only: a call does not learn; none in incognito), the typed chat so far (`context`, latest 12 turns, as `<this_chat_so_far>`), then `recap` (latest 20 turns, <= 500 characters each / 4,000 total, as `<earlier_in_this_call>`). **Language** (`LIVE_LANGUAGES` or `auto`): native-audio models choose language themselves, so `languageRule` pins it in the prompt (first line) and `languageReminder` repeats it last; transcription gets `languageCodes` hints (`transcriptionLanguages`). **Speed** (`tuned`): `automaticActivityDetection` ends the turn after 500 ms of silence (`END_SENSITIVITY_HIGH`); minimal thinking (`thinkingLevel: "minimal"` on 3.1 Flash Live; `thinkingBudget: 0` on 2.5 Native Audio; none for 3.8 Live); a 1007 close before `setupComplete` while tuned retries the same model `lean: true`. Mic batches 2,048 samples (~43 ms at 48 kHz) through an AudioWorklet (`micTap.worklet.js`, same-origin because the CSP has no `blob:`/`data:` scripts; never inlined: `assetsInlineLimit`), resampled to 16 kHz PCM; Gemini's 24 kHz PCM plays as it arrives (40 ms lead web, 120 ms app); talking over it or tapping the orb stops it (`interrupted`). `EchoGuard` (`liveProtocol.ts`) mutes mic batches while the voice plays (+250 ms) unless RMS >= 0.025 (-32 dBFS); `NoiseGate` follows the noise floor and sends silence unless 12 dB above it (and above -60 dBFS), holding 350 ms. Search in Live (`search: true` and the owner's switch): setup gets `tools: [{ googleSearch: {} }]` and `VOICE_SEARCH_PROMPT`; Gemini 3.8 Live and 3.1 Flash Live close with a quota error when search is in the setup, so `LIVE_SEARCH_MODELS` (2.5 Native Audio) go first when search is on; sources arrive as `groundingMetadata` (http(s) only, <= 10). The globe button reconnects with a `recap`. Sessions end after ~10 minutes (`goAway`); unexpected closes after `setupComplete` reconnect (<= 2 per session); setup timeout 12 s web / 20 s app. When the view closes the transcript is saved with `POST /api/ai/live-transcript` (`{ conversationId, parentMessageId?, model, turns: [{ role, text, sources? }] }`) as ordinary messages (model id `gemini-live:<model>`, labelled with the Live model); a session ended by closing the page is not saved. Audio is never stored.
- **The microphone** (`mic.ts`): the picked mic (`micId`) else the browser's; when the browser's mic is virtual (BlackHole, Soundflower, Loopback, VB-Audio, Voicemeeter, RemotePC, Zoom/Teams drivers...) a real one is opened (`pickRealMic`); a stream of exact zeros means the wrong device ("No sound from your mic" after 1.8 s in dictation, 2.5 s in Live, 6 s in the app); meters map RMS to 0-1 on a -58..-12 dB scale; audio contexts are created inside the tap (Safari); Firefox needs `micSource` at the mic's rate. An APK older than 1.3.10 lacks `MODIFY_AUDIO_SETTINGS`: dictation falls back to the phone's recogniser (`createSttSession`), Live voice asks to allow the mic or update.

### Live voice in the Android app

The web view puts the app in `MODE_IN_COMMUNICATION` when a page opens a mic with echo cancellation and the phone has a platform echo canceller; on Android 12+ Chromium picks no output device, so call audio defaults to the **earpiece**; `setSinkId` does nothing in the web view; an audio context made before the mic opened plays as media, outside the echo canceller. Fix: `AudioRoutePlugin.java` (`VinaxAudioRoute`, registered in `MainActivity` by the patch script): `start({ speaker })` sets call mode and (API 31+) `setCommunicationDevice` with the built-in speaker or earpiece from `getAvailableCommunicationDevices()` (older: `setSpeakerphoneOn`); a connected wired/USB/Bluetooth headset is left to Android; `setSpeaker({ on })`, `getRoute()` -> `{ route: speaker|earpiece|headset|other }`, `stop()` (clears the device, restores mode and volume keys; also on bridge destroy). `live/audioRoute.ts` wraps it (no-ops on web and older APKs); `LiveSession` opens the mic first, starts the route (loudspeaker unless the listener last chose the earpiece; `liveSpeaker` pref), then makes the voice's audio context. A loudspeaker toggle shows only when the plugin answered. Over-the-air changes reach every app; the route and button need the new APK. Not verified on a phone: the routing itself, the echo-guard threshold, Android < 12 behaviour, vendor audio stacks; Android blocks the mic for backgrounded apps, so Live hears nothing off screen.

### Settings (`SettingsPanel.tsx`, kept on the device under `vinax.vxai.prefs.v1` except Appearance and Memory)

General (Appearance, Artifacts on/off, Live previews), Personalisation (name, about, reply instructions, style), Memory (Use memory, Learn from my chats, every note, Add a memory, Forget everything), Chat (model, Extended thinking, Web search), Voice (microphone with a ten-second test, Read aloud voice from Orpheus's English voices, Live voice from ten of Gemini's voices, Live model, Live language, Search the web in Live voice), Your chats (Export all chats, Your artifacts, Shared links).

### Sharing

A chat is shared as a snapshot. `POST /api/ai/shares { conversationId }` stores the active branch (role, text with artifacts, cited sources (http(s), <= 20), time; attachments as `{ name, kind }` only - never id, bytes or text; no reasoning, model, usage or account info; empty replies skipped; > 1 MB -> `413 too_large`; empty -> `422 empty`); one link per chat (`ai_shares.conversation_id` unique; re-snapshot keeps the id; 201 create, 200 update). The id is 22 base64url characters of 128 random bits (`^[A-Za-z0-9_-]{22}$`). `GET /api/ai/shares/:id` needs no session, `cache-control: public, max-age=60`, `x-robots-tag: noindex, nofollow` (the page `/vinaxai/share/*` is `noindex, nofollow` too; old `/ai/shared/*` 301s to Home via `RETIRED_AI_PATH`). Ending: owner `DELETE`, deleting the chat (link deleted right after hiding), or deleting the account (`on delete cascade`). `POST /api/ai/shares/:id/continue` copies the snapshot into a new chat of the signed-in reader. Rate limits per address: list 30/min, create/update/delete 10/min, read 60/min, continue 5/min. Page: `ShareDialog.tsx` (Create link, Copy link, Share..., Update link, Stop sharing) and `SharedChatView.tsx` (`pages/VinaXAISharePage.tsx`, no composer; signed in -> Continue this chat; Report this chat emails the owner).

### Projects

A project (`_lib/ai/projects.ts`; routes `api/ai/projects.ts`, `projects/[id].ts`; page `Projects.tsx`, `projectDialogs.tsx`): name <= 60, description <= 300, **instructions** <= 8,000 (every chat in the project follows them), **files** (knowledge) <= 20 files and 200,000 characters of text (`409 too_many_files | knowledge_full`). A project file is an `ai_attachments` row with `project_id` and no conversation, stored at `<account>/project-<project id>/<id>`, uploaded with `&projectId=...` (a project and a chat at once is `400`); it can never be a message attachment. `POST /api/ai/chat` takes `projectId` for a new conversation (404 if not the account's); `PATCH conversations/:id { projectId }` moves a chat. The Worker loads the project once per reply (`loadProjectContext`) and per model (`knowledgeFor`): text and PDFs-for-non-PDF-models become `<document>` blocks inside `<project_knowledge>`; a PDF goes to Gemini as a Files API file; up to 5 images go to vision models; the system prompt may take up to half the window (`KNOWLEDGE_SHARE`); Auto sends a chat whose project has a PDF or > 12,000 characters of text to the long ladder (`longKnowledge`). Instructions and files are never stored in a message, never logged and never in a shared link; Live voice does not use them. Delete project removes instructions and files; chats stay (`on delete set null`) unless `?chats=delete`. Max 100 projects (`409 too_many_projects`); rate limits 30/min list/read/write per address. Pages `/vinaxai/projects`, `/vinaxai/project/:projectId`; chat header shows the project; sidebar menu "Move to project...".

### Memory

Up to 50 notes of <= 200 characters per account (`ai_memories`, origin `chat` or `user`; switches in `ai_memory_prefs`; no row = both on). `memoryFor` reads the owner's switch, the listener's switches, the chat's `incognito` flag and the notes in parallel with the account lookup; notes go into `<memory>` (marked as possibly out of date, never instructions). A failed read means no memory and no learning for that reply. **Learning** runs after a finished reply (`end|length`), inside the reply's `waitUntil` job: on every third message of the branch (`LEARN_EVERY`) and on messages that ask to remember/forget ("remember...", "forget...", "keep in mind...", "note that..."), new messages only. A small fast model (`title` ladder, then `music` ladder, via `askJson`, 15 s) gets `LEARN_PROMPT` and only `{ memory: [{ id, text }], recent: [last <= 3 user messages (<= 2,000 chars) with replies between (<= 1,500), artifacts -> [artifact: title], code -> [code]] }` and answers `{ add, remove }`. `parseLearnAnswer` enforces: removes name an own note by id or exact text (<= 10); adds are plain text, <= 200 characters, deduplicated, rejected by `looksSensitive` (email, 10+ digits, 6 digits in a row, key-like strings, words like password/PIN/OTP/token/CVV/IBAN/account or card number/Aadhaar/PAN); <= 5 a run, never past 50; the model is told never to keep secrets, contact or financial details, health, sex life, religion, politics, caste/ethnicity or anything about other people. **Incognito chat** (header hat-and-glasses on a new empty chat) neither reads nor writes memory; `ai_conversations.incognito` is read on its own query. Owner: `memory: false` (or `{ enabled: false }`) in `vinax-ai` turns it off for everyone (`503 memory_off`; JSON-only for now). Shared links and Live voice never use memory; deleting a chat keeps its learned notes. Rate limits: reads 30/min, changes 20/min.

### The owner's switches (`vinax-ai` setting)

```json
{ "enabled": false, "testers": ["<account id>"], "search": true,
  "models": { "groq:openai/gpt-oss-20b": { "enabled": false }, "gemini:gemini-3.6-flash": { "order": 0 } },
  "instructions": "Suggest a VinaX playlist when music comes up.",
  "dailyLimit": 50, "limits": { "filesPerChat": 50, "pdfPages": 500, "searchesPerDay": null }, "memory": true }
```

`enabled` is the kill switch (missing or anything but `true` = off: `503 ai_disabled`, "VinaX AI is taking a break"); `testers` are account ids (<= 50) who may use it while off; `models` switch a model off everywhere or reorder it inside its group (lower `order` first); `search: false` switches web search off for everyone; `discover: false` (or `{ "openrouter": false }`) removes found models; `instructions` <= 4,000 characters; `dailyLimit` messages per person per UTC day (`ai_take_daily('msg:<account>', limit)` -> `429 daily_limit`); `limits` (clamped by `LIMIT_RANGES` in `config.ts`):

| Key | Range | Default |
| --- | --- | --- |
| `messagesPerMinute` | 1-30 | 20 (per address, burst 2x; each account also has a fixed 30/min) |
| `imagesPerMessage` | 1-20 | 10 |
| `filesPerMessage` | 1-20 | 20 |
| `filesPerChat` | 1-100 | 50 |
| `pdfMB` | 1-50 | 30 |
| `pdfPages` | 1-1,000 | 500 |
| `textMB` | 1-5 | 2 |
| `searchesPerDay` | 0-2,000 or none | none (= `SEARCH_DAILY_LIMIT`, else 100; 0 switches the search API off; free grounding keeps its own 450/day) |

The setting key is `vinax-ai` (the settings vocabulary only has kebab-case keys). Memoised a minute per isolate.

### The console's providers card

Console > App Health > AI Assistant (`GET /api/admin/ai`, owner only): on/off and tester count; each provider's key set/missing (never the value), whether the whole provider rests and its last error; every registry model with group, owner switch, ready/resting (why, until when)/no key; today's grounded searches and search-API calls against daily limits (`ai_daily_usage`); which voice features have keys and which voice models rest; utility models read-only; found models with a per-provider card (how many, when, or the failure). Rests and last errors live in each instance's memory, so the card shows what the instance that answered has seen. **Probe** (`POST /api/admin/ai { model }`, one at a time) sends "Reply with OK" and shows time to first word or the failure (a failure rests the model; an answer clears the rest); spends a little free allowance, only on button press.

### The page

Placement: inside `SiteGate > AuthGate > AppLayout`; AppLayout hides side nav, top bar, rails and player dock on `/vinaxai*`; music keeps playing (now-playing pill); signed-out visitors see the sign-in screen. Layout: >= 1024 px a 260 px collapsible sidebar (`Sidebar.tsx`: New chat, Projects, Artifacts, search, Starred, Recents grouped Today/Yesterday/Previous 7 days/Older; each row's menu Star, Rename, Move to project..., Delete); narrower a slide-over drawer; time-aware greeting with four starter chips (Write, Learn, Code, Music) that never send; composer stays above on-screen keyboards (`visualViewport`). Look and motion: static accent glow, frosted glass from the app's material tokens (`--vx-mat-*`; Harbour, Onyx, AMOLED, high contrast, no-`backdrop-filter` browsers, reduced transparency stay opaque; settings sheet and phones opaque), skeletons, wave dots then a breathing cursor, only transform/opacity animate and none under reduced motion. Composer: + menu (Extended thinking, Web search, Add photos and files, Settings), mic dictation, Live voice button where Send is when empty, model picker (`ModelPicker.tsx`: Auto, groups, found models; badges Vision/Web/Thinking/Code; greyed models say why), choices kept in `prefs.ts`. Messages: Edit makes a sibling (`< 2 / 3 >` switcher saves the active leaf), Retry menu (Auto or another model), Read aloud, Continue for cut-short replies, failed picked-model errors offer Retry / Try with Auto / two alternatives. Code: `store.ts` + `chatState.ts` reducer (deltas applied once per animation frame), `Markdown.tsx` (`react-markdown` + `remark-gfm`; raw HTML shown as text; only `http(s)`/`mailto` links; images never loaded), highlight.js core with 22 languages in its own chunk (skipped over 20,000 characters), KaTeX via `remark-math` + `rehype-katex` (`trust: false`, own chunk loaded the first time a reply contains `$`; `mathText.ts` applies Pandoc's rule so prices are not maths). The page, highlighter, maths chunk, Live voice chunk and mic worklet, stylesheets and KaTeX fonts are on demand in the precache (`ON_DEMAND_PAGES`/`ON_DEMAND_ASSETS` in `vite.config.ts`). Entry points: desktop side-nav row (`constants/nav.ts`), profile menu item, command palette; the phone tab bar keeps its four tabs.

## Music AI and song generation

Music routes share `_lib/ai/music.ts`: the owner's switches, one gate, the `music` ladder and a strict JSON reader. Each route answers a short JSON task with a deadline, and the device keeps its own result whenever the answer is late, malformed or missing. With no AI secrets every route answers `503 ai_not_configured` and the device stops asking for ten minutes.

- **Gate (`musicGate`):** per-address bucket, session, account `RATE_LIMIT_30` tier, a configured provider, the owner's switches, at least one `music`-ladder model with a key -> `429 rate_limited`, `401 signed_out`, `503 ai_not_configured | ai_disabled`.
- **`music` ladder:** GPT-OSS 20B (Groq) -> Qwen 3.8 27B (Groq) -> Gemini 3.5 Flash Lite -> Llama 3.1 8B (Workers AI); deadlines 1.2-2.5 s; a model not started within 60% of the deadline is replaced; reasoning off, temperature 0.2; same cooldowns; the owner's per-model switches apply.
- **`askJson`/`extractJson`:** the device's summary goes in as material inside `<input>`; the first JSON object is read (fences, reasoning tags, chatter ignored); each route re-validates against its own input.
- **`ai-music` setting:** `{ "enabled": true, "rerank": true, "home": true, "dj": true, "playlist": true, "lyrics": true, "generate": { "enabled": false, "dailyQuota": 5 } }`; `enabled: false` is the kill switch; the others are on unless `false`. Logs carry route, whether it answered, model and counts, never summary or answer.

**Up Next's order `POST /api/ai/rerank`** (`functions/api/ai/rerank.ts`; device `services/ai/musicAi.ts`, `tasteSummary.ts`): sends <= 40 candidates `{ key, language, mood, energy, genre, leadArtist }` (keys `c0`, `c1`... made up for the request; no title or id), the compact taste summary `{ languages <= 4, artists <= 8, moods <= 4, energyByHour [night, morning, afternoon, evening], discovery, skipStreak, hour, weekday }` and this sitting's intent `{ mood, tune, language, energySteer, completionStreak }`; body <= 16 KB. Answer `{ order: [{ key, reason }], model }` (<= 20 keys, reasons <= 80 characters, no links; unknown/repeated keys dropped; `502 no_answer` when nothing usable). Device: switch Settings > Recommendations > "AI fine-tunes Up Next" (`aiRerank`, on); waits <= 1.5 s (model gets 1.2 s), never while the listener waits at the end of the queue; AI keys first, then the rest in device order; both planners run their stretch rules after it and the admission gate checks every song; "Why this song?" reads "AI pick - <reason>". A `401|403|503` pauses rerank 10 minutes, a `429` two.

**Home's layout `POST /api/ai/home-layout`** (`functions/api/ai/home-layout.ts`; device `services/home/homeBuilder.ts`): sends `{ generation, taste, intent, allowed, avoid, seeds (<= 8 as { key s0..., language, mood, genre, leadArtist }), recentTitles (<= 20) }`, body <= 8 KB; the Worker describes each shelf type in its own words (`HOME_BLOCKS`). Answer `{ layout: { generation, blocks: [{ type, title <= 40, reason <= 90, query?, mood?, language?, seedIds? }] }, model }`: allowed non-avoided types once each, shortcuts first and feed last, >= 4 shelves else `502 no_answer`; `rightnow` gets a 2-5-word search phrase, a mood, a language from the summary and seeds from the input. Device waits <= 2.5 s (model 2.1 s), validated by `isHomeLayout` and `acceptHomeLayout`, decided once per generation; route bucket 6 + 4/min; owner switch `ai-music.home`; the personal engine's section is offered as block `engine`.

**Songs the AI names `/api/ai/dj`, `/api/ai/playlist`:** the model answers `{ songs: [{ title, artist, reason }] }`; `validatePicks` keeps clean pairs, drops links/duplicates (`songRefKey`: lower case, no brackets/punctuation) and anything matching the playing song or recent plays. The device (`services/ai/suggest.ts`) searches the catalogue for each pair and keeps a result only when the title matches (75% of words) and the artist is among the song's artists. AI DJ (`services/ai/dj.ts`): once per playing song and tune chip every 10 minutes (a minute after an empty answer); songs join Up Next's warm pool as source `ai-dj` (base score 1.12). AI Playlist (`services/ai/aiPlaylist.ts`): drops muted languages and songs played in the last 7 days, falls back to a catalogue search with fewer than 5 real songs. Deadlines: DJ 5 s Worker (7 s device), playlist 9 s (12 s).

**Lyrics tools `/api/ai/lyrics`:** `romanize` and `translate` answer `{ lines }` with exactly as many lines as sent (blank where blank; any other count `502`); `explain` answers `{ meaning, mood }`; only lyrics (<= 160 lines), title, artist, language are sent; Romanize only when the catalogue has no English-letters copy; deadline 20 s (25 s device).

**Song generation `/api/ai/generate-song`** (`generate-song.ts`, `generate-song/[id].ts`, `[id]-audio.ts`, `_lib/ai/songGen.ts`; device `services/ai/songGen.ts`, `genInQueue.ts`, `features/player/GenerateLikeThis.tsx`): a NEW, ORIGINAL song in the feel of the one playing. Sent: `{ mood, energy, tempo, genre, language, durationSec (30-180), instrumental, promptText?, kid? }` built from metadata only (audio, title, artist, lyrics never leave the device).

| Route | What |
| --- | --- |
| `GET /api/ai/generate-song` | `{ available, reason?, limit, remaining, ttlHours }` |
| `POST /api/ai/generate-song` | `202 { jobId, status, progress, remaining }`; `400 bad_request`, `422 prompt_names_artist \| prompt_too_long \| prompt_not_allowed`, `429 rate_limited \| quota_exceeded`, `502 gen_failed`, `503 gen_not_configured \| ai_disabled` |
| `GET /api/ai/generate-song/:jobId` | `{ status, progress, title?, durationSec, instrumental, audioUrl?, expiresAt }`; each call asks the model once; finished audio is copied into Worker storage; other account's/expired/malformed id -> 404 |
| `GET /api/ai/generate-song/:jobId/audio` | The song with byte ranges until it expires (24 h); the random job UUID is the key (an `<audio>` element cannot send a session) |

Model: Gemini's, on `GEMINI_API_KEY` (no separate generator): 30-second songs use `lyria-3-clip-preview`; longer use `lyria-3.5` (billed per song, no free tier - on a free key every song is a 30-second clip; when refused the Worker falls back to the clip model and `durationSec` becomes 30). The Worker POSTs `{ model, input, background: true }` to `/v1beta/interactions` and polls `GET /v1beta/interactions/<id>` (a 400 to background is retried with `store: false`); the last `audio` block is the song (`audio/mp3` served as `audio/mpeg`); an interaction with no audio is a failed job; progress is estimated from job age. Every song carries the model's inaudible watermark. **Originality:** the brief describes only the feel and always ends with `ORIGINALITY_RULES` (entirely new piece; no real artist, singer, band, composer, song or album named, imitated or referenced; no existing melody or lyrics reproduced); lyrics newly written in the requested language; the listener's words (<= 200 characters) are refused (`prompt_names_artist`) when they read like a reference ("in the style of", "sounds like", "cover of", "feat.", quoted title, link, run of capitalised words); a model may also be asked whether the words name a real artist/song/album/film; on the device the words are checked against the playing song and top artists. Kid mode: instrumental, gentle moods, no free text. **Limits:** per-address bucket (3 + 2/min), account `RATE_LIMIT_10`, daily quota per device (`x-vinax-device`, hashed with the day; `ai-music.generate.dailyQuota`, default 5) and three devices' worth per account; `ai-music.generate.enabled` (off until set) and `ai-music.enabled`. Finished songs are kept 24 hours in Worker KV (`GENERATED_AUDIO` if declared, else `HANDOFF` under `gen:`; a handful of KV writes per song counts against the daily write allowance; check with `GET /api/ai/generate-song` -> `{ available: true, ... }`). Device: Now Playing "Generate a song like this" (1/2/3 minutes, Instrumental, optional words, progress bar polled every 2 s); the result has an id starting `gen-`, subtitle "AI generated - VinaX AI", artist "AI generated", a badge, never a catalogue page; liking/adding/Save keeps it on the device and it travels in the backup with its label. Rules that keep it apart: own source tag `generated` (boost 0.05; base 0.5 in `nextup/rules.ts`), taste profile learns nothing from it (`updater.ts` returns early), no usage event (`telemetry.ts`), never in a chart; "Add a generated song to my queues" (`genInQueue`, off by default) makes one song per automatic stretch, >= 90 s, placed third via `replaceAutoTail`; Never repeat's third step (`fillWithGenerated`); Home may offer **Generated for you** (`vinax.generated.v1`).

## The personal engine

The account-side recommendation system for signed-in listeners: a taste model kept on the server composes Home, builds playlists from plain words and feeds Up Next; the on-device engine ([Recommendations on the device](#recommendations-on-the-device)) is the fallback. Server paths relative to `backend/worker/functions/`, device paths to `frontend/src/`. On by default for signed-in listeners; switch in Settings > Region & privacy > **Personal engine** (+ **Erase my taste model** -> `DELETE /api/personal/taste`); signed out, switched off, Kid mode, or the server unavailable -> on-device Home exactly as before. Owner switches: `personal-config` `{ enabled, composer, embedModel ("cloudflare:@cf/baai/bge-m3" default or "gemini:gemini-embedding-001"), weights }` (`enabled: false` -> routes answer `503 personal_disabled`; `composer: false` -> deterministic pages; changing `embedModel` starts a re-embed through the job; weights clamped 0.5-2x of `_lib/personal/config.ts` defaults). Embedding uses the `AI` binding (~1 neuron per song) or `GEMINI_API_KEY`; composer/playlist builder use whichever VinaX AI providers have keys.

**The model** (one `personal_taste` row per account, rebuilt from events and refreshed incrementally): `vector` (1024 dimensions in the embedding model's space, the score-weighted sum of embeddings of `songs`), `artists` (<= 300 `{name, score, plays, completes, skips, last}`), `languages`, `facets` (`moods`, `genres`, `decades`, `energy {sum,n}`), `hours` (24 counts per language plus `_all`), `songs` (<= 500 score maps), `summary` (short prose digest). Weights match the device (`services/personalization/eventWeights.ts`): play/radio start 1, search play 1.5, complete 2, like 3 (un-like -3), save 1, queue 0.5, skip -1.75, dislike -1.5; positive scores halve every 14 days, skips every 30. The fold is one pure function `foldEvents(taste, events, now)` in `_lib/personal/taste.ts`. Songs live in `personal_songs` (one row per catalogue song any listener touched, with metadata, identity key, facets, community counters, `verified`, embedding). A device-asserted row is **unverified** until the catalogue confirms it (never rewrites a known title/artist/artwork; unverified songs never reach other pages, vector sources or trending; confirmation of a few per batch, the rest by the job); verified songs are embedded on arrival (`waitUntil`) or by the backlog job; rows carry the model id so a model change is a re-embed, never a mix. Exposure in `personal_exposure` (device penalties and cooling windows; a liked song never cools).

**Events** `POST /api/personal/events`: batches of <= 100 events / 64 KB, only while signed in with the engine on. Event `{id, kind, at, song, heardSec?, durationSec?, source?, context?}`, `kind` in `play, complete, skip, like, unlike, dislike, save, queue, search_play, shown, radio_start`; `source` names the surface (`home:<shelf>`, `radio`, `search`, `playlist`, `nextup`, `ai-playlist`, `library`); `context` `{hour, dow, tz, shelf?, position?}`; `id` is device-minted and a repeat is ignored. The route verifies the session, validates, records events, touches songs, folds into the taste row (optimistic version, three retries), recomputes the vector in the database and writes exposure; if the fold cannot be saved the events are taken out again and the device gets a 503. The device queues in local storage, flushes every 15 s, at 25 events, when the page hides (`keepalive`) and on reconnect; 413 halves its batch, 401 clears the queue, other 4xx drops the batch, 429/5xx keeps it; events older than 7 days are dropped.

**Candidates** (pool of a few hundred, six sources): `neighbours` (nearest verified embedded songs to the taste vector via `personal_neighbours`, excluding disliked and cooled), `similar` (catalogue similar lists for recent liked/completed seeds + `personal_similar_songs`), `artist` (top songs of top-affinity artists not heard), `colisten` (`personal_colisten`, rebuilt daily from 30 days: a listener's last 150 plays, top 50 partners per song, once per pair), `trending` (what the most listeners played in 7 days in the account's languages; counts listeners not plays; memoised 5 min), `own` (high-score songs not played for 21 days + liked).

**Ranking** (additive, each term kept as a reason): taste fit 0.30, artist 0.22, language 0.14, co-listen 0.14, source 0.10, agreement 0.08, hour 0.06, freshness 0.05, community 0.04, exposure -1 x penalty, skips -0.20, novelty +/-0.10 (Familiar/Balanced/Discover). Then a greedy re-rank over the top 300: an artist at most three times per shelf, never twice in a row, identity families fold to one recording; the exposure cooling window moves a song to the back rather than dropping it.

**Home** `GET /api/personal/home`: (1) deterministic shelves (`_lib/personal/shelves.ts`, up to twelve, 20 songs each, dropped under six songs): `made-for-you`, `because:<songId>` (two), `artist:<artistId>`, `language:<lang>` (top two), `discover`, `rediscover`, `hour`, `community`, `trending`, `new-this-week`; (2) the composer (`_lib/ai/complete.ts`) gets the page, taste summary, time of day, weekday, active festival and first name; may order, rename (with a one-line reason), merge two, add one themed shelf, but only from pool ids (others dropped, a song on one shelf); the whole call has 8 s, else the deterministic page is served. Saved in `personal_pages` (`kind = 'home'`), every song marked shown (`personal_mark_shown`), served from the saved copy for 30 minutes, until 30 more events were taken in, or `?fresh=1` ("Refresh Home"). Answer `{generatedAt, expiresAt, greeting, shelves: [{key, title, reason, songs}], model}`.

**Playlist** `POST /api/personal/playlist {prompt, count?}` (default 25, max 50): plan `{title, languages[], moods[], artists[], eras[], energy, familiarity: known|mixed|new, queries[<=6]}` -> retrieve (catalogue searches, artist top songs, taste neighbours and co-listening filtered by language/era, own songs by familiarity) and rank with the plan as hard rules (language, era, familiarity) and soft lifts (mood, energy) -> curate `count` songs with a title, description and optional per-song reason (ids outside the pool dropped; short results topped up). Saved as `kind = 'playlist'`; returned `{id, title, description, songs: [Song & {reason?}], plan, model}`; 24 s for the whole build (device waits 30 s); ten a minute per account, six per address. **Radio / next songs** `GET /api/personal/recommend?seed=&limit=&exclude=` is Up Next's first source when signed in with the engine on.

**Device side:** `services/personal/api.ts` (12 s deadline, 25 s playlist, typed validated answers), `reporter.ts` (subscribes to the playback event bus, library store and shelf renderer; off unless signed in and the setting is on), `features/home/personal/*` (`usePersonalHome()`, `PersonalShelves`, `PlaylistMaker`; `HomePage` shows the personal page first), setting `personalEngine` in `store/settingsStore.ts`, Up Next source `personal` in `services/nextup/sources.ts`. Switching the engine off stops the reporter and clears its queue; the taste model stays until erased or the account is deleted (`accounts` cascades to every `personal_*` table).

**Jobs:** `personal-embed` (every run) and housekeeping's `personal_purge` and 21:00 UTC `personal_refresh_colisten`. **Console:** App Health > Recommendations (`GET /api/admin/personal`: accounts with a model, events day/week, songs and embedding backlog per model, pages/playlists built today, active embedding model, composer candidates and clamped weights; `POST` `embed` / `colisten` run now). **Tests:** `personalTaste.test.ts`, `personalRank.test.ts`, `personalCompose.test.ts`, `personalRoutes.test.ts`, `aiComplete.test.ts`; device `reporter.test.ts`, `api.test.ts`, `PersonalHome.test.tsx`; `check.sql` calls every new function. **Not yet:** it does not read the device-side taste profile in the sync backup (the server model starts from the first reported event), does not drive Flow, Blend or Listen Together, and treats skips inside a playlist it built like any other skip.

## Recommendations on the device

Everything here runs on the device, so a free app can continue a queue sensibly in the listener's languages without sending listening history to a server. Paths relative to `frontend/src/`.

### The pipeline

`planNextSongs(seed, ctx, options)` in `services/recommendation/engine.ts` (`limit` clamped 0-40, default 8; the player asks for 5; `recommendNextSongs` wraps it for radio/playlists/tests; `buildRecommendations(ctx)` runs the same sources, filter and scorer without a seed for Home). The engine is a lazy chunk. Hard rules never relax; a penalty is never a rule. The live queue calls the V2 planner in `services/nextup/` (a warm pool ranked by `rules.ts`, a stretch picked under its spacing rule) with the same context, ledger and admission gate.

| # | Stage | Module (`services/recommendation/`) | What |
| --- | --- | --- | --- |
| 1 | Candidate generation | `candidates.ts` | Pool from several sources in parallel; a failed source shrinks the pool |
| 2 | Hard filtering | `filters.ts` | Rules with named rejection reasons; versions of one song collapse |
| 3 | Scoring | `scoring.ts`, `weights.ts`, `vectors.ts` | Every term recorded as a reason; reasons sum to the score |
| 4 | Ranking | `scoring.ts`, `reranking.ts`, `engine.ts` | Sort, shuffle within 0.05 bands by the session salt, greedy diversity re-rank (artist/genre/language vs the last four), active tune nudge |
| 4b | AI rerank (optional) | `services/ai/musicAi.ts` | Top 40 reordered within 1.5 s or the on-device order stands |
| 5 | Sequencing | `sequencer.ts` | Top 40 ordered into a stretch: energy arc, mood flow, transition memory, artist/album spacing, era, language policy, familiar first |
| 6 | Validation | `validation.ts` | Re-checks every rule; tops up from the reserve |
| 7 | Admission | `admission.ts` | The player re-checks every automatic queue change against the listener's state at that moment |

What feeds it: taste profile (`services/personalization/profile.ts`, `storage.ts`, `updater.ts`; persisted, decays), event weights (`eventWeights.ts`, `EVENT_WEIGHTS_VERSION` 1.2.0), session window and mood pin (`session.ts`, `features/player/moodPin.ts`; `sessionStorage`), session intent (`sessionIntent.ts`; 45 minutes of silence ends a sitting), playback measurement (`services/playback/session.ts`), recommendation context (`context.ts`), exposure ledger and snoozes (`exposure.ts`; `localStorage`), lifetime heard-set (`heardSet.ts`, `bloom.ts`; IndexedDB `vinax-heard`), engine memory (`recMemory.ts`), verified-trend signal (`services/trends/signal.ts`, empty today), queue ownership (`store/playerStore.ts`).

### How listening becomes taste

All learning reads one measurement: seconds actually heard in a playback instance (`services/playback/session.ts`); a run of repeat-one loops of one track learns at most one PLAY, SKIP and COMPLETE; a time update credits a step only when no seek is pending, not buffering, and the step is plausible against the wall clock; playback speed counts.

| Verdict | Duration known | Unknown |
| --- | --- | --- |
| `PLAY` | Heard >= the smaller of 5 s and 70% of the song | 5 s |
| `COMPLETE` | Ended naturally with >= 70% heard | Ended naturally after 30 s heard |
| `SKIP` | Manual skip after PLAY counted, < 30% heard | < 30 s heard |
| Early leave | Manual skip before PLAY counted: this sitting's intent only | same |
| Failed | Every source failed: no SKIP, no transition verdict | same |

The player publishes `counted`, `credit`, `end`, `served`, `refined` on one bus (listen clock, transition memory, exposure ledger, opt-in analytics subscribe). **Event weights:** PLAY 1.0, COMPLETE 2.0, FAVORITE 3.0, QUEUE_ADD 0.5, PLAYLIST_ADD 1.0, SEARCH_PLAY 1.5, SKIP -0.75 (and takes back the PLAY: -1.75 total), DISLIKE -1.5, SOFT_MUTE -3.75 ("Less like this" also mutes the lead artist 7/14/30 days, default 14). Positive affinity halves 14 days after the last signal, skips after 30; `MAX_AFFINITY` 60. Passive listening teaches less as a sitting goes on: the first 8 plays of one lead artist count in full (`SITTING_ARTIST_FULL`), up to the 20th at half, then a quarter; a language counts in full for 12 plays, half to 30, then a quarter; likes, searches, queue/playlist adds, negatives and the song's own affinity always count in full.

**Session intent** (ring of <= 40 events; an action 30 minutes old counts half): per-event pull on the artist (skip -0.40, complete +0.15, like +0.50, unlike -0.30, queue_add +0.35, search_play +0.45; language pull 40% of it, clamped +/-0.6). `deriveIntent` yields skip/completion streaks, artist pull (-1..1), language pull (-0.6..0.6), ids skipped this sitting (hard-filtered until completed or the sitting ends), an energy steer (+/-0.3), and a discovery appetite (-1..1: +0.2 at four straight completions, +0.1 each further up to four; -0.3 at two straight skips, -0.15 each further; -0.1 per search play or hand queue-add down to -0.3). The scorer fades the intent in over its first three events; appetite moves the discovery lean x0.6 and the queue's discovery share x0.15.

### Stages in detail

**Candidate sources:** `related` (catalogue suggestions for the seed (30), recent listens, favourites), `favorite-artist`, `favorite-album`, `album`, `related-artist` (2 artists x 6 songs; cached 30 min), `genre` (skipped while an intent is active), `style`, `proven` (picks finished/liked before), `verified-trend` (<= 6, empty today), `trending` (a catalogue search - not evidence, reason says "Popular in the catalogue for your languages"), `intent`, `explore` (Discover mode), `history` (Familiar mode), `rediscovery` (completed > 14 days ago). At most six catalogue requests in flight; identical requests share one fetch; responses reused three minutes (60 kept); after a soft deadline the gather resolves once the pool holds enough and required sources answered; `GATHER_STALL_MS` 900 ms; hard deadline resolves with what settled. Primary source priority (`SOURCE_PRIORITY`): intent, related, favorite-artist, album, favorite-album, related-artist, style, proven, verified-trend, history, rediscovery, genre, explore, trending. Cold start uses pinned languages, then languages of liked songs. Drops blocked, junk, soft-muted, Kid-mode explicit songs before the pool leaves.

**Hard filter order** (`rejectReasonFor`): `invalid`, `junk` (dialogue, background score, jukebox, trailer, promo, ringtone...), `too-short` (known duration < 90 s), then `safetyReasonFor` (`explicit` in Kid mode, `blocked`, `muted-language`, `soft-muted`, `snoozed`), `seed`, `already-queued`, `recently-played`, `heard-before` (Never repeat only), `skipped-this-session`, `off-language`; an `unplayable` song not downloaded is `no-audio`; survivors with the same canonical identity collapse (`duplicate-version`: original over remaster over alternate cut, then more-played). **Canonical identity** (`identityCore.ts`, `songKey`): normalised title + primary artist (NFKC, invisible characters dropped, Latin accents folded, other combining marks kept so Indic vowel signs survive, version decorations and featured credits stripped; `recordingKey` adds the version tag). The Worker uses the same file; both suites run `shared/identity-vectors.json`.

**Scoring weights** (`SCORING_WEIGHTS_VERSION` 1.3.0; features normalised 0-1): mood 0.16, vibe 0.10, language 0.12, dialect 0.08, genre 0.10, energy 0.10, tempo 0.08, artistAffinity 0.14, history 0.10 (subtract), likes 0.10, skips 0.12 (subtract), session 0.12, discovery 0.07, popularity 0.05, freshness 0.04, diversity 0.20, songAffinity 0.12, dayOfWeek 0.04, novelty 0.16 (swing +/-0.08), artistFatigue 0.04, intentArtist 0.18, intentLanguage 0.08, intentEnergy 0.30, intentSkippedSong 0.40 (subtract). Taste-dependent terms are multiplied by `(0.3 + 0.7 x profile confidence) x (0.4 + 0.6 x intensity)`; unknown features score 0; a candidate in a muted language scores -1; scores <= 0 are dropped (`low-score`). Source boosts: intent 0.24, related 0.18, favorite-artist 0.14, favorite-album 0.12, proven 0.12, verified-trend 0.12, rediscovery/history/album/related-artist/style 0.10, explore 0.08, genre 0.07, trending 0.06. `TASTE_WEIGHTS`: `tasteFit` 0.16 (cosine of the 256-slot hashed song vector and the taste vector; recent taste capped at 40% once long-term mass >= 3), `seedRepeat` 0.10, `servedRecently` 0.04 (fallback only). Owner overrides: `rec-config` (24 keys; each clamped to half..double; applied by `remoteWeights.ts` when the rollout targets the device; version string like `1.3.0+rc7` is part of every continuation's `alg` stamp; the Worker mirrors the table in `REC_WEIGHT_TERMS`).

**Sequencer** (greedy, deterministic): cost = distance from slot target energy x3, mood mismatch x1.2, same lead as previous +4, within last three +1.5, previous lead as featured credit +1, same album +1, energy step beyond 0.35 excess x2.5, decade distance (cap 3) x0.25, pool rank up to +1.0, transition memory -memory x1.5, `lift` shape + "sure" song -1.2, familiar first: sure song -0.9 x (1 - progress), discovery +1.1 x (1 - progress). Arc shapes `steady`, `build`, `wind-down`, `wave`, `lift` (tune's shape, else `lift` after a skip streak >= 2, else a read of the listener: restless -> `lift`, late hours -> `wind-down`, otherwise `steady`). One recording family per stretch. Transition memory (`transitions.ts`, `transitionTracker.ts`): >= 70% heard completed, < 30% skipped.

**Validation** (`validateSequence`): hard filter again, one song per identity; language rule; artist cap ceil(limit/4); no lead artist back to back (counting the seed); discovery allocation floor(share x limit + 0.5); familiar opening (no discovery in slot 1, nor slot 2 with >= 4 songs); style quota; sitting-avoid (artist pull <= -0.6). When nothing else fits, soft rules give way in the order a listener minds least: discovery allocation, familiar opening, artist cap, style quota, sitting-avoid, language-mix rules, and only last the back-to-back rule; each relaxation is reported with its slot. Hard rules never relax. **Plan:** `songs` built inside 8 s (`NEXT_DEADLINE_MS`; 3.5 s when the listener is waiting, `NEXT_URGENT_DEADLINE_MS`), `commit(accepted)` publishes "why this song" lines, the `queued` exposure and seed memory, `topUp(seedNow, n)`, `fallback`, `latencyMs`, `alg` (`PIPELINE_VERSION` 9.1.0 + weights version). **Admission** (`admission.ts`): valid metadata, junk/too-short, explicit in Kid mode, hidden songs/artists, muted languages, soft-muted lead artist, another cut of the playing song, already queued, recent plays, skipped this sitting, heard-before in Never repeat; a Queue Builder plan the listener installs passes only explicit restrictions.

### The exposure ledger (`exposure.ts`)

One memory of what the listener has met, shared by every surface; one row per canonical identity, key `vinax.recs.exposure.v1`, 600 rows (`EXPOSURE_CAP`), 45-day TTL.

| Event | Recorded by | Penalty (freshest) | Decays over | Cools a discovery surface |
| --- | --- | ---: | --- | --- |
| `shown` | a Home shelf when it renders | 0.14 | 3 d | 12 h |
| `queued` | the plan's `commit` | 0.24 | 7 d | 2 d |
| `played` | bus `counted` | 0.30 | 10 d | 3 d |
| `completed` | bus `end` at completion ratio | 0.22 | 14 d | 3 d |
| `skipped` | an early manual skip | 0.30 per skip, max 3 | 21 d | 14 d |
| `disliked` | hiding a song | 0.80 | 60 d | 45 d |
| `liked` | favouriting | pays a quarter (`LIKED_FORGIVENESS`); never cooled | - | - |
| `replayed` | explicit "play again" | lifts cooling 7 d | - | - |

The penalty reaches the scorer as `ctx.exposurePenaltyOf` (reason `served`); it never admits a song the hard filter rejects; a plan takes one snapshot. "Clear personalization profile" and "Erase everything" clear it. **Snooze** (`snoozeSong(song, days)`: 7/14/30, default 14) is a hard rule by canonical identity with undo. **Fewer repeats** (`refreshHome({ fewerRepeats: true })`) removes everything with live exposure on discovery surfaces. `recMemory.ts` keeps outcomes (success = liked or natural end completed; miss = manual skip before the play counted or inside the first 30%; forgotten after 60 days; `provenPicks` feed the `proven` source) and seed memory (a continuation's opening songs remembered against the seed identity for 12 hours as `seedRepeatKeys`).

### Never repeat

Settings > Recommendations > **Never repeat** or the Queue page chip (`neverRepeat`, off by default): every song the recommender adds is one the listener has never heard, in any version (remix, remaster, live take count as heard). Hand-queued songs, an installed Queue Builder plan and "Play again" are never held back; turning it on from the chip rebuilds the waiting automatic songs. The **lifetime heard-set** (`heardSet.ts`): canonical keys of every song that produces a `counted` event (whether or not the mode is on), IndexedDB `vinax-heard`, no cap, no expiry; written in one transaction after a 1.5 s pause and when the page hides; looked up through an in-memory Bloom filter (`bloom.ts`, 1% false positives, ~9.6 bits and 7 hashes per song, starts sized for 4,096 songs and doubles); the first load also reads earlier history plays and `play`/`complete` rows once; registered with the admission gate (`registerHeardCheck`); in-memory without IndexedDB; in the backup (category `heard`, <= 200,000 keys; restore only adds) but never the account sync; "Erase everything" deletes it. `heard-before` is a hard rule in `filters.ts`, `admission.ts` and the live planner (`rules.ts`); no relaxation touches it. When fewer than three unheard candidates per slot survive (`NEVER_REPEAT_POOL`) the sources widen (`RecommendationContext.widen`): step 1 more `related-artist` (two pages of each) and three more `genre` pages (`WIDEN_PAGES`), step 2 the `explore` source in the listener's own languages; the live planner uses `planWideLookups` (`nextup/sources.ts`); the trace records `widened-1|2`. When nothing is left the plan says `exhausted` and the player shows "You've heard everything we can find here. Try Discover or another language" with a Discover button and stops (or, with generated songs allowed, `fillWithGenerated`).

### Settings and switches

**Familiar, Balanced, Discover** (Settings > Recommendations > Discovery, `discoveryMode`; old `exploreMode: true` = Discover):

| | Familiar | Balanced | Discover |
| --- | --- | --- | --- |
| Lean | -1 | 0 | +1 |
| Novelty swing on a never-played artist | -0.08 | 0 | +0.08 |
| Share of a stretch open to never-played artists (`DISCOVERY_SHARE`) | 5% | 20% | 45% |
| Extra source | `history` | - | `explore` |

Share clamped 0-50% after appetite. A discovery is a song whose lead artist was never played, or an `explore` candidate; songs fetched for a tune, pinned mood or style are never discoveries.

**Queue languages** (`queueLanguages`: `'mix'` "Your languages" default, or `'one'`): the listener's languages = pinned + profile top three - muted - `unknown`. Mix applies only when the setting is `'mix'` and at least one of them differs from the seed's; otherwise the lock. Mix: hard filter `allowedLanguages` (seed's + listener's; others `off-language`); sequencer `languagePolicy: 'prefer'` (off-target song in one of the listener's languages costs +0.6, or -0.35 after three target-language songs; any other known language +2.5); three hard mix rules - the seed's language fills slots 1 and 2, an off-lead song never follows another, off-lead songs at most floor(limit/2) - relaxed only if no candidate satisfies them (`language-mix`). Lock: `'lock'` on the seed's language; validation relaxes only if fewer than three songs remain (`language-lock`). Songs with no/`unknown` language pass under both. "Switch language" moves a lock for that stretch.

**Tunes, pinned moods, styles** (`tune.ts`): energetic, chill, romantic, melody, beats (`mass`), devotional, heartbreak, classics, new (`fresh`), same language, switch language, surprise, styles `dj` and `folk`. "Pin a mood" is in `sessionStorage` for 45 minutes. `tuneQueue(intent)` keeps played, current and hand-queued songs, replaces the rest; an active intent adds the `intent` source (`tuneSearchQuery`, a two-word phrase prefixed with the queue's language), adjusts scores (`tuneScoreAdjust` +0.35 for the asked-for mood + nudges) and sets the arc (energetic/beats -> `build`; chill, melody, romantic, heartbreak, devotional -> `wind-down`; surprise -> `wave`). `style.ts` reads `dj`, `folk`, `devotional` from words in title/album/subtitle/artists (strong) and genre/mood (weak); `sessionStyle` decides; active style: required `style` source, `STYLE_WEIGHTS` (+0.4 word match, +0.25 metadata match, -0.3 off-style, 0.1 source boost), validation keeps >= ceil(0.8 x limit) in style (`STYLE_MIN_SHARE`), one remix per song per sitting.

### Queue rules in the player (`store/playerStore.ts`)

One continuation adds five songs (`NEXT_BATCH`); requested when a song starts with <= 2 remaining, provided autoplay (or radio) is on, follow mode off and repeat off; one request per queue version (a queue change cancels; late results discarded); additions pass admission and are marked automatic. **Build every queue** (`djTakeover`, default; with Autoplay on): tapping a song makes it the seed. Smart Queue (`features/queue/SmartQueue.tsx`) is one switch over `autoplay && djTakeover`. The player tracks recommender-appended vs listener-queued ids: "Add to queue" inserts before the first automatic song, "Play next" directly after the current; re-plan/tune replace only the automatic tail; "Keep this song" turns an automatic entry into the listener's; `regenerateAutoTail`. Adaptive re-plan (`adaptive.ts`): two consecutive automatic skips re-sequence the remaining tail (>= 3 songs) with `lift` and a few favourites in the playing song's language under a language lock (90 s cooldown `REPLAN_COOLDOWN_MS`). Radio (`features/radio/radioSeeds.ts`, `pages/RadioPage.tsx`): `startRadio` puts <= `RADIO_SEED_MAX` (5) seeds in the queue as the listener's list, sets radio mode (continuations run even with Autoplay off) and an optional tune.

### Home shelves

`buildRecommendations(ctx)` gathers, filters, ranks without a seed, moves cooling identities behind, assembles shelves in `mixes.ts`; memoised ten minutes. Home generation (`features/home/homeRefresh.ts`): queries carry the generation in the key (30-minute TTL `HOME_TTL_MS`); it moves only on explicit refresh or opening Home > 30 minutes after it started; safety changes rebuild nothing (lists filter at render, `features/home/blocks/shared.tsx`). **Repetition rule** (`surfacePolicy.ts`): `resume` surfaces keep heard songs; `personal` (Made For You, Daily mix, Because you liked) move heard/shown to the back; `discovery` (trending, new releases, popular picks, mood shelves, feed) remove heard and move shown to the back (removed under "fewer repeats"); the automatic queue uses hard rules and the exposure penalty. Popular picks (`trendingForYou.ts`) come from the catalogue's trending results only. **AI Home Builder** (`services/home/homeBuilder.ts`): per generation, when neither listener nor owner chose an order and no shelf-order experiment runs, `POST /api/ai/home-layout` chooses structure and words only (every song still comes from `buildRecommendations` or the catalogue through the safety lens, surface rule and shelf ledger); listener choices in `vinax.home.ai.v1` ("Let AI build my Home" default on; shelves marked "Not interested", sent as `avoid`; part of the Home layout backup category); a Home Studio layout or owner-published order always wins; the personal engine's section is offered as block `engine`. Home's own order (`homeOrder.ts`): time of day, taps (`homeTaps.ts`, 14-day half-life), outcomes (`homeSignals.ts`), genre affinity; each block moves at most three places; `sessionHomeOrder` fixes the order per session. De-duplication (`shelfLedger.ts`): a shelf drops songs already claimed earlier (by id and canonical identity) and keeps at least six if it had six (`SHELF_FLOOR`). Taste profile page (`features/taste-profile/useTasteInsights.ts`: skip rate, top moods, new-to-you share) and Similar artists (`useSimilarArtists.ts`: 3 most-played artists).

### Catalogue recommendation routes

`backend/worker/functions/_lib/recs.ts`: anonymous, store nothing, separate from the engine; `services/recs/similar.ts` calls them for "Songs like this" and Discover 5, resolving each track through `getSong` and falling back to the catalogue's own suggestions. Candidates: the catalogue's similar-songs list (`reason: "similar"`), then songs the catalogue **credits** to the seed's lead artist (`same_artist`); at most `max(2, ceil(limit/5))` per artist.

| Route | Query | Rate limit | 200 answer |
| --- | --- | --- | --- |
| `GET /api/recommendations/similar/:songId` | `songId` matches `^[A-Za-z0-9_-]{2,40}$`; `limit` 1-30 (20); `languages` <= 6 | 30 burst, 30/min | `{ seed, tracks, source: "catalogue" }`, `public, max-age=600, s-maxage=3600` |
| `GET /api/recommendations?seeds=...` | 1-5 song ids; `limit`, `languages`, `exclude` <= 100 ids | 10 burst, 10/min | `{ seeds, tracks, source: "catalogue" }`, `private, max-age=600`; seeds take turns |

Each track: `id, title, artist, artists (<= 4), album, language, year, durationSec, reason, reasonText`. Errors: `400 invalid_song_id | bad_request`, `404 song_not_found`, `429 rate_limited` (+ `retry-after`), `502 catalogue_unavailable`, `405` for POST.

### Debugging and changing safely

Developer breakdown on with `?debug=recs`, `localStorage` `vinax.debug.recs` = `1`, or a dev build (`store/recsDebugStore.ts`; panel `features/recommendation/RecsDebugPanel.tsx`, lazy): trace, selected songs with every component, passed over, rejected (<= 80 with rule and stage). Listener-facing: "Why this song?" (`explanations.ts`; a `served` reason means the ledger or seed memory held the song back; "AI pick - <reason>").

| If you change | This must pass |
| --- | --- |
| Any weight, source, filter, sequencer or validation rule | Unit tests beside the modules (`services/recommendation/*.test.ts`) and `node scripts/eval-recs.mjs --no-baseline` |
| A key in the weight table | `weightEffects.test.ts`, `weightOverrides.test.ts`; update `REC_WEIGHT_TERMS` in the Worker |
| Repetition (ledger, seed memory, surface policy) | `repetition.accept.test.ts`, `exposure.test.ts` |
| Never repeat | `heardSet.test.ts`, `bloom.test.ts`, `admission.test.ts`, `filters.test.ts`, `nextup/rules.test.ts`, `engine.test.ts`, and the 500-song sitting in `repetition.accept.test.ts` (zero repeats by canonical identity) |
| Canonical identity | `identityContract.test.ts` + the Worker's suite (shared vectors) |
| Queue languages / next five | `nextFive.test.ts`, `engine.test.ts`, `validation.test.ts`, `sequencerPolicy.test.ts`; the `mixed-queue` fixture |
| Styles | `style.test.ts`, `engine.style.test.ts` |

Lessons kept: `servedRecently` (0.04) is a leftover fallback - the ledger's penalties (0.14-0.80) act; adjacency relaxes last (the earlier order shipped runs of one artist in Familiar mode; do not reorder the tiers without the evaluation); `trending` is a catalogue search, not a chart; `features/home/dedupeShelves.ts` is older - Home de-duplicates through `shelfLedger.ts`; `backend/worker/functions/api/recommendations.ts` ("songs like these") is not part of this engine.

## Offline evaluation of next-song selection

A harness in `frontend/eval/` runs the real recommendation engine against synthetic listeners with the network replaced, reporting rule compliance, diversity mechanics, fallback behaviour and latency, so a change can be compared with the engine before it in a few minutes. It does not measure enjoyment. No npm script and no workflow; on demand from `frontend/`:

```sh
node scripts/eval-recs.mjs --no-baseline            # the working tree only (~3 minutes)
node scripts/eval-recs.mjs --baseline <commit>      # working tree, then that commit, side by side
npx vitest run --config eval/vitest.config.ts       # the harness alone
npx tsc --noEmit -p eval/tsconfig.json              # type-check the harness
```

Flags: `--no-baseline`, `--baseline <commit>` (default `7c4e2f5` can no longer load - the baseline must contain `frontend/src/services/recommendation/recMemory.ts`; check with `git cat-file -e <commit>:frontend/src/services/recommendation/recMemory.ts`), `--quick` (3 salts, 3 latency runs), `--salts <n>` (12), `--latency-runs <n>` (8), `--cap-ms <n>` (12000), `--out <dir>` (`frontend/eval/reports`), `--report-only`. Unknown flag exits 2. Passed on as `EVAL_PIPELINE`, `EVAL_REF`, `EVAL_OUT`, `EVAL_SALTS`, `EVAL_LATENCY_RUNS`, `EVAL_LATENCY_CAP_MS`, `EVAL_ASSERT`, `EVAL_SRC`. Writes `recs-eval-current.json`, `recs-eval-baseline.json`, `recs-eval.json`, `recs-eval.md` (git-ignored, with `eval/.cache/baseline-<commit>/`).

**How it works:** fixtures (`buildFixtures(now)`, fictional songs in Telugu, Hindi, Tamil, Punjabi, Malayalam and Latin scripts; `EVAL_FIXTURES_VERSION` 1.4.0 - bump when a fixture changes, never compare across versions) include `cold`, `warm`, `familiar`, `discover`, per-language fixtures, `mixed`, `mixed-queue`, `prefs`, `skips` (streak of three), `partial-outage`, `offline`, `sparse`, `versions`, `small-catalogue`, `kid-mode`, `muted-languages`, `hidden-artists`, `soft-muted`, `dj-session`, `folk-session`, `deep-sources`, `served`, `memory`, `unplayable`, `sparse-history`; two more serve latency only. Only `@/services/api` (catalogue client) and `@/services/queryClient` are mocked, one level below `candidates.ts` so candidate-stage rules stay measured. A sitting is four continuations of five songs (seed of each later one is `queue[length - 2]`), one run per salt; rules are re-written in `eval/lib/rules.ts` (only song identity is shared, pinned by `shared/identity-vectors.json`).

**Metrics:** hard-rule violations (Kid mode explicit, muted language, hidden artist/song, soft-muted lead, same id/work as last 20 plays or already queued, skipped this sitting, unplayable), off-language under the lock (excused when < 3 eligible in-language candidates remained), mix rules (`off-language`, `language-opening`, `language-run`), same lead back to back / within three, identity repeats, artist coverage, discovery share vs allocation (familiar 0.05, balanced 0.2, discover 0.45), familiar-first compliance, pickers/fallbacks/relaxations, style continuity, retrieval depth, declared-taste agreement, pushed-away artists, served songs queued, seed-memory replay, latency p50/p95 (queue-ready and final) across `instant-sources`, `slow-sources` (140-900 ms), `source-throws`, `source-never-settles` (+ `-large-pool`, `-urgent` at `deadlineMs: 3500`).

**The gate** (`recs.eval.ts`, three assertions): `quality.overall.batches > 0`; `deterministic === true` (the `warm` fixture with salt 1 queues the same ids twice); `hardViolations === 0` (skipped when `EVAL_ASSERT=0`, which the runner sets for a baseline). The runner exits 0 when the current pipeline's run exits 0, 1 otherwise (or when no report was written). Everything else is a measurement to read. Gate failures: `hard-rule violations` > 0 -> `quality.overall.violations`/`perFixture` in the JSON; `reproducible NO` -> `determinismDiff` (module-level memory surviving `localStorage.clear()`, unfrozen clock, randomness not derived from the salt); `No report written` -> unresolved import in the tree under test.

**Changing the engine safely:** run the unit tests (`npx vitest run src/services/recommendation`), run the evaluation before and after and read every summary line for unintended movement, run `repetition.accept.test.ts` for repetition changes, bump the fixture/harness version if a fixture or metric changes. **The repetition acceptance test** (`services/recommendation/repetition.accept.test.ts`, part of the normal unit run) uses 120 playable songs by 24 artists and `planNextSongs` for 20 at a time, committing as the player does: second continuation from the same seed introduces >= 12 of 20 new songs (also after a reload with the ledger kept); no identity repeats in a continuation over three salts; no lead back to back, no artist above ceil(n/3), >= 6 artists; muted language/hidden song/hidden artist never ship; an exhausted pool returns fewer songs; queue-surfaced songs are in the ledger and Home-shown songs cost the queue (< 10 return); a liked song may come back; Familiar's discovery share < 0.1; a single-artist request is respected. The evaluation cannot see repetition across sittings or surfaces (every continuation is called with the whole queue excluded, `applyFixture` clears `localStorage` before each continuation except `memory`, no metric compares sittings), enjoyment, a real catalogue (pools of 6-104 songs), audio features, the profile updater and admission gate, or field latency. Known figures (fixtures 1.3.0/1.4.0 era, not gated): discovery share runs about twice the allocation (35.8% vs 17.9%) because the budget holds only while familiar candidates remain; same-lead-back-to-back 36 (24 avoidable); the seed-memory replay reads "3 of 3 without memory" (expected: nothing to remember without a commit); `served songs queued` reads 27.5% (it read 37.5% until fixtures 1.4.0 was deepened).

**Real outcomes** come only from two consent-gated events (`services/analytics/recTelemetry.ts`): `rec_served` (once per automatic continuation: `alg`, `picker`, `fallback`, `latencyMs`, `n`, `discovery`, `languageViolations`, `distinctArtists`, `relaxed`, `exp`) and `rec_outcome` (when an automatic entry's playback ends: `alg`, `picker`, `pos`, `heardSec`, `durationSec`, `outcome` complete|skip|early_skip|partial, `liked`, `exp`). Neither carries a song or song id. Client rate limit: bucket `REC_BUCKET` 12, one more every `REC_REFILL_MS` 5 s, outbox `REC_OUTBOX_CAP` 40, `REC_SESSION_CAP` 400 per session. `planNextSongs` calls `decideRecVariant('rec-next-songs')` on every plan; arms set the taste-fit weight (`REC_TASTE_ARMS` in `engine.ts`: `taste-0.15`, `taste-0.18`; `control` and unknown names keep the shipped weight); create the experiment in the console. **Reading an A/B result:** pick one primary metric first (completion rate = complete / (complete + skip + early_skip + partial)); aggregate per device then compare device-rate distributions (bootstrap over devices); report an interval (Wilson); ~1,500 outcomes (~100 listeners) per arm detects 5 points, ~4,200 (~300) 3 points, ~37,000 (~2,500) 1 point at 40% completion, 95% confidence, 80% power; fix the reading date in advance; only listeners who turned telemetry on are in the data; watch `rec_served` guardrails; rate limiting loses the most restless sittings first, biasing skip rates down.

## Design system

### How the layers stack

| Layer | Switch on `<html>` | Lives in | May change |
| --- | --- | --- | --- |
| Base tokens and frame | - | `frontend/src/styles/index.css`, `shell.css`, `features.css`, `pages/*.css` | Everything, as defaults |
| App style | `data-template='<id>'` | `styles/templates/` | Token values, `--tpl-*` dials, its own shell/card layout rules |
| Theme | `.dark`, `.light`, `.amoled` (with `.dark`), `.hc` | `index.css`, `templates/base.css` | Which ramp; true black; high contrast |
| Accent | `data-accent='<id>'` or inline custom ramp | `index.css`, `utils/accentRamp.ts` | The ember ramp only |
| Festival skin | `.fest-<id>` | `styles/festivals.css` (generated) | Accent ramp, canvas tint, ribbon, backdrop - never layout |

`main.tsx` imports `index.css`, `shell.css`, `features.css`, `templates/index.css`, `festivals.css`; page stylesheets load later with their lazy page.

### Token contract

Components read tokens; colour tokens hold space-separated RGB channels (`rgb(var(--ink-900))`). `--ink-950/900/850/800/700` (surfaces, darkest to raised; `--ink-900` is the page canvas), `--ink-100`..`--ink-500` (text, strongest to faintest; names keep their meaning in light), `--ember-300`..`--ember-600` (accent ramp), `--tide-400/500` (secondary accent), `--vx-on-accent`, `--art` (playing artwork colour), `--vx-radius-control` 10px / `--vx-radius-card` 14px / `--vx-radius-panel` 20px, `--radius-sm`..`--radius-pill`, `--vx-control-h` 40px, `--vx-control-h-sm` 36px, `--vx-tile-h` 48px, `--vx-topbar-h` 64px (phones `calc(max(8px, env(safe-area-inset-top)) + 48px)`), `--ease-calm` (`cubic-bezier(0.32, 0.72, 0, 1)`), `--vx-ease-out`. Tailwind colour names map to the same variables (`frontend/tailwind.config.ts`).

### Themes, accents

`theme` is `dark | light | amoled (Black) | system | auto`; `resolveTheme`: `system` follows the device, `auto` is light 07:00-18:59; Black also carries `.dark` and sets `--ink-950` to `0 0 0` (shell `#000` in all six styles); high contrast adds `.hc`. The light theme is glass too: three soft lights behind the panes (accent low-left, second colour top-right, playing artwork top-left, on `.vx-shell::before`), a frosted workspace sheet, translucent white cards; text-carrying fills keep floors (chrome 80% white, thick 86%) so muted text clears 4.5:1 over a black cover. Flat styles (Verdant, Harbour, Onyx) keep opaque bars. Accents: **Style colour** (stored id `crimson` = the style's own accent), named accents `marigold, ember, sunset, gold, emerald, ocean, azure, violet, rose, aurora, mono` (`data-accent`), **Custom** (`accent: 'custom'` + `accentCustom`, `applyCustomAccent` builds a ramp), **Dynamic** (`dynamicTheme`: accent follows the artwork; `--art` is always set).

### Dials, selector contract and paint path

`styles/templates/base.css` declares dials on `html[data-template]`: `--tpl-r-art`, `--tpl-r-art-sm`, `--tpl-r-np-art`, `--tpl-r-control`, `--tpl-r-input`, `--tpl-r-row`, `--tpl-r-tile`, `--tpl-r-play`, `--tpl-r-play-sm`, `--tpl-r-deck`, `--tpl-r-mini`, `--tpl-font-body`, `--tpl-title-weight/tracking`, `--tpl-section-weight/tracking`, `--tpl-card-title-weight`, `--tpl-press`, `--tpl-enter`, `--tpl-enter-dur`. A style **may** change inks/ember/tide, body face, radii, title weight/tracking, motion, how navigation/mini player/cards/Now Playing backdrop are shaped, glass vs solid; it **may not** change what a control does, which settings exist, hit areas, focus visibility, or anything under true black/high contrast. The contract (asserted by `templates.test.ts`): a style's file styles only `html[data-template='<id>']`; colour blocks carry `:not([class*='fest-'])` (stand down for festival skins); accent blocks apply only to the default accent (`:is(:not([data-accent]), [data-accent='crimson'])`); win by specificity, never by order (page styles load later); `html.amoled[data-template]:not(#_)` and `html.hc[data-template]:not(#_)` outrank every style; dark and light looks clear WCAG AA; pre-paint canvas equals `--ink-900` per theme; style-scoped overrides of a light-theme token must match the specificity of `html.light[data-template]:not([class*='fest-'])` (a plain `html.light[data-template='x']` loses silently - Pulse and Marquee shipped see-through bars that way until 13.2). Paint path: the inline script in `index.html` reads `vinax.settings.v1` before first paint, sets `data-template` (legacy map, fallback `lumen`) and the canvas from its own table; `applyThemeClasses` keeps `.light/.dark/.amoled`, `data-template` (`normalizeTemplate`), `<html>` background and `theme-color` (`TEMPLATE_CANVAS`, `#000000` for Black) current; the picker cross-fades via a view transition unless reduced motion.

### Materials

Four frosted materials (`.vx-mat-thin|regular|chrome|thick`: translucent fill, backdrop blur, saturation lift, 1px specular top line, hairline):

| Material | Fill (dark) | Blur | Used for |
| --- | --- | --- | --- |
| `thin` | `ink-950` 62% of glass level | 12px + up to 30px | Large quiet panes: the sidebar |
| `regular` | `ink-850` 50-92% | 16px + up to 34px | Floating controls (defined; Now Playing buttons borrow only its line/hairline) |
| `chrome` | `ink-950` 80-97% | 18px + up to 36px | Fixed/sticky bars content scrolls under: top bar (once content is under it, via an `IntersectionObserver` sentinel), phone tab bar, compact player, player deck (carry the artwork colour faintly via `--mat-tint`) |
| `thick` | `ink-850` 86-98% | 24px + up to 40px | Anything carrying a block of text: sheets, dialogs (`<Sheet>`), song menu, right-click popover, snackbars |

Settings > Glass effect sets `--glass-alpha`, Background blur sets `--glass-blur-boost` (`applyGlassLevel` in `utils/theme.ts`); text tiers are floored (`clamp`) so AA holds over any cover (`__tests__/glass.test.ts`). Black theme keeps materials solid; no `backdrop-filter` or `prefers-reduced-transparency` falls back to `--surface-solid`; phones get a lower blur cap. **Never put a material on a row inside a scrolling list.** Now Playing: two heavily blurred artwork copies drift behind the stage (26 s and 31 s, transform only), frosted round buttons without their own backdrop filter, drift stops under either reduced-motion switch.

**Snackbars** (`components/Toasts.tsx`, `store/toastStore.ts`): `toast(text)` or `toast(text, { image, action, duration, key })`; compact `thick` pill, radius 20, >= 48px tall, <= 480px wide, optional 36px thumbnail, at most one action; ~4 s (5 s with an action); at most two at once; same words twice show once; a keyed toast replaces the older one with the same key (liking uses key `like`); hover/focus pauses timers; swipe down 36px or Esc dismisses the newest; always-in-DOM polite live region. **Notifications inbox:** the Home bell opens `NotificationSheet` (thick glass; rows with artwork grouped Today/Yesterday/date, then "From VinaX" with the three newest release notes; Android adds "Mute alerts for 7 days").

### Type, spacing, radii, elevation, controls

Body Manrope variable (`/fonts/manrope-var.woff2`, weights 200-800); display face per style via `--vx-font-display` (Lumen Inter `inter-var.woff2`, Verdant Figtree `figtree-var.woff2`, Monsoon Manrope at 700, Harbour Archivo `archivo-var.woff2`, Verse Baloo 2 `baloo2-var.woff2`, Onyx Roboto `roboto-var.woff2`; base default Bricolage Grotesque `bricolage-var.woff2`; all variable woff2, latin subset, SIL OFL, licences beside the files in `/fonts`, declared in `templates/base.css`, fetched only when rendered, none precached). Scale: display `clamp(2.25rem, 4vw, 3.75rem)`, page `clamp(1.875rem, 3vw, 2.625rem)`, section 1.375rem, card/body .9375rem, meta .8125rem, caption .75rem (`.vx-eyebrow` uppercase .08em); headings track -0.035em/-0.025em at weight 750; tabular numerals for times. **Never put a font on `#root`** and no style may lead a stack with a system font (Android theme fonts); pinned by `constants/typography.test.ts`. Spacing `--vx-space-1..16` on a 4px grid; radii as above plus `rounded-card` .75rem, `rounded-sheet` 1.25rem, `rounded-pill`; artist artwork is a circle. Elevation mostly flat (`--vx-deck-shadow`, `--vx-art-shadow`, `--vx-shadow-overlay`). **Hit areas:** visual box 36-40px, touch target >= 44px: `IconButton` (requires `label`, `type="button"` default, `::after` pad -inset-1 for sm / -inset-0.5 for md, lg 48px), rows/links `min-height: 44px` (`min-h-touch`), dock items 56px, `Chip` 36px with a 4px pad, coarse-pointer range inputs 44px and hover-only affordances always visible.

### Focus, overlays, motion, top bar

`:focus-visible` draws a 2px `ember-500` outline, 2px offset and a 5px halo (32%) in every theme. Buttons: hover brightens, active scales .98, disabled 45% opacity. **Overlays:** `<Sheet>` (`components/Sheet.tsx`) is the one shell (bottom sheet on phones, dialog from `sm`): `role="dialog"`, `aria-modal`, `labelledBy`/`label`, `useFocusTrap`, `useDismissOnBack`, reference-counted scroll lock, `size` (`sm|md|lg|2xl`), `padding`, `layout`, `maxHeight` (92dvh/85dvh), `z` 70 (60 boot, 80 update gate), backdrop closes unless `closeOnBackdrop={false}`; do not pass padding/width/height/radius via `className`. Overlays are portalled to `<body>` (a page's animated wrapper would break `fixed inset-0`); `fade-up` fills `backwards` not `both`; `<Sheet>` stops click propagation (portals bubble React events). The web-only wheel rescue (`features/nav/wheelRescue.ts`, off in the Android app) forwards wheel events landing on injected blockers outside `#root`; anything portalled to `<body>` must have `[role="menu"|"dialog"|"listbox"|"status"|"presentation"]` on/inside its root or set `data-vx-overlay`. **Motion:** one easing `--ease-calm`, durations 140/200/320 ms (`--vx-motion-fast`, `--vx-motion-normal`, `--transition-slow`); no bounce; two switches (OS `prefers-reduced-motion` and in-app Reduce motion -> `html.reduce-motion`); scripted scrolls use `scrollBehavior()` from `utils/motion.ts`, never hard-coded `'smooth'`. **Top bar** (`components/TopBar.tsx`): left = back/forward, app icon on phones, context label; right = the page's actions slot, command-palette key (`lg`+), avatar linking to Settings; pages add actions with `<TopBarActions>` (portals into `#vx-topbar-actions`; keep to `IconButton`s).

**Hard rules:** no raw hex in components (exceptions: canvas share cards, chart palettes, the canvas table); no white-alpha borders/text (use the ink ramp and glass hairlines); no arbitrary radii; icon-only controls use `IconButton`; touch targets >= 44px; new overlays use `<Sheet>` (custom portals mark `data-vx-overlay`); scripted scrolling uses `scrollBehavior()`; sticky-under-top-bar reads `--vx-topbar-h`; every animation answers both reduced-motion switches; look changes keep `theme.test.ts`, `contrast.test.ts`, `templates.test.ts`, `typography.test.ts` green; mini player and phone tab bar never show page text through them.

### Adding an app style

1. `frontend/src/utils/theme.ts` - add the id to `TemplateId` and its `[dark, light]` canvas to `TEMPLATE_CANVAS`.
2. `frontend/index.html` - add the same pair to the pre-paint table.
3. `frontend/src/constants/templates.ts` - add the `TemplateOption` (`id`, `label`, `tagline`, `traits`, `swatch` {canvas, raised, accent, second}); `templates.test.ts` asserts the count, so change it there too.
4. `frontend/src/styles/templates/<id>.css` - colour blocks (dark and light, each with `:not([class*='fest-'])`), the accent block (default accent only), dials, then only the style's own layout rules.
5. `frontend/src/styles/templates/index.css` - import the file.
6. `frontend/src/styles/pages/settings.css` - draw its picker miniature (`.vx-tpl-*`).
7. `npx vitest run src/constants/templates.test.ts src/utils/theme.test.ts src/features/settings/TemplatePicker.test.tsx src/__tests__/contrast.test.ts` - failures name what was missed.
8. Build, then `node scripts/csp-hashes.mjs` (the inline script changed; `cspHashes.test.ts` fails until `public/_headers` matches).
9. Look at it: every destination, phone and desktop width, dark/light/Black, a festival preview, reduced motion.

## App styles

Six styles (15.0), each modelled on the design language of one kind of music app a listener already knows - canvas, type scale, shapes, tab bar, mini player, full-screen player - in VinaX's own names, colours and letterforms (no style carries another product's name, logo or wordmark; `templates.test.ts` asserts the picker copy). Ids stored in settings or backups from 11.0-14.x map through `normalizeTemplate`/`LEGACY_TEMPLATES` (`utils/theme.ts`, the pre-paint script, the settings sanitiser).

| Id | Name | Language | Replaces |
| --- | --- | --- | --- |
| `lumen` | Lumen (default) | Clean white-and-black editorial: frosted bars, big section titles with a chevron, 8px artwork, floating frosted mini player, crimson-pink accent | `aura` |
| `verdant` | Verdant | Neutral black, flat panels, green accent, 2-column "jump back in" tiles, 4px artwork, tinted mini player over a fading tab bar | `pulse` |
| `monsoon` | Monsoon | Charcoal and teal with saffron second colour, language chips, 6px tiles, solid four-tab bar, edge-to-edge mini player with a heart | `sangam` |
| `harbour` | Harbour | Deep navy with cyan accent, tall hero banners, square corners, condensed-bold titles, solid player bar with progress on its top edge | `nocturne` |
| `verse` | Verse | Lyrics-first: charcoal under full-bleed artwork, coral accent, a lyric line in the hero, capsule chips, floating capsule player, springy motion | `vibe` |
| `onyx` | Onyx | True black, white play, red accent, mood chips on Home, overline + title section heads with a "More" pill, square 4px artwork, uppercase player tabs | `marquee` |

Per-style values (dark / light canvas, accent, shape, motion):

| | Canvas (dark shell / workspace / raised; light) | Accent (second) | Shape (art / rows / controls / tiles / deck / mini / NP art) | Type (display) | Chrome | Motion |
| --- | --- | --- | --- | --- | --- | --- |
| Lumen | `#000000` / `#0f0f11`; `#ffffff` / `#f5f5f7` | `#f2334d` (light `#d1203a`), second `#ff7a3d`, on-accent white | 8 / 6 / 999 / 12 / 16 / 14 / 10 px; play 50% | Inter, title `clamp(2rem,3.6vw,2.75rem)` 800 at -0.03em; section 22px 700 | Frosted; active sidebar row accent wash | `tplRise` 240ms, press 0.97 |
| Verdant | `#000000` / `#121212` / `#181818` (hover `#282828`); `#ffffff` / `#f6f6f6` | `#22d36a` (light `#117a3e`), second `#509bf5`, on-accent `#07140b` | 4 / 4 / 999 / 4 / 0 / 6 / 8 px | Figtree, title `clamp(1.75rem,3.4vw,3rem)` 800; section 20px 700 | Flat, opaque, no blur; sidebar a rounded 8px panel | `tplFade` 160ms, press 0.95 |
| Monsoon | `#111315` / `#1b1e21` / `#262a2e`; `#ffffff` / `#f4f6f6` | `#2cc6a8` (light `#0f7d68`), second `#ff9f1c`, on-accent `#06211b` | 6 / 8 / 999 / 8 / 12 / 0 / 12 px | Manrope 700, title `clamp(1.75rem,3.2vw,2.5rem)` at -0.02em; section 18px | Mostly solid; thin blur on the top bar; teal gradient band 240px | `tplRise` 220ms, press 0.96 |
| Harbour | `#060b10` / `#0e1720` / `#17222d`; `#ffffff` / `#f2f5f8` | `#25c7d5` (light `#07707a`), second `#4f8df5`, on-accent `#021418` | 4 / 4 / 4 / 4 / 0 / 0 / 4 px | Archivo, title `clamp(2rem,4vw,3.5rem)` 800; section 20px 800 | Flat, opaque, no blur, no margins | `tplFade` 140ms, press 0.97 |
| Verse | `#09090b` / `#141418` / `#1f1f26`; `#ffffff` / `#f7f6f9` | `#ff4d6d` (light `#c41e42`), second `#ffb84d`, on-accent `#1f0509` | 12 / 12 / 999 / 14 / 20 / 999 / 16 px | Baloo 2, title `clamp(2rem,4vw,3.25rem)` 800; section 20px 800 | Frosted; transparent fade tab bar | `tplPop` 320ms, press 0.94 |
| Onyx | `#000000` / `#030303` / `#111111`; `#ffffff` / `#f9f9f9` | `#ff2b3f` (light `#c4111f`), second white | 4 / 4 / 8 (chips 999) / 4 / 0 / 0 / 4 px | Roboto, title `clamp(1.75rem,3.2vw,2.5rem)` 700; section 22px 700; overline 12px 500 uppercase .1em | Opaque black, no blur | `tplFade` 120ms, press 0.97 |

Home/tab bar/mini player/Now Playing specifics: **Lumen** - hero a plain title block (8px square art right on phones), jump back in as hairline rows with 56px art, section heads end in `›`; frosted 4-item tab bar, no pill, active icon/label in accent; floating frosted mini player 8px above the tab bar (art 40px left, play + skip right, no progress); large artwork with soft shadow, white round play, grey scrubber. **Verdant** - filter chips row (All, Music, Moods) with a solid white "on" chip, jump back in 2-column 56px tiles (`rgb(255 255 255 / 0.1)`), hero a compact artwork-colour band; transparent tab bar over a black gradient, active icon white, 10px label; floating 6px-radius mini player tinted with the artwork colour and a 2px progress line, plain white play glyph; vertical artwork-colour gradient, 64px white play. **Monsoon** - teal band + language chip row (outlined, chosen filled teal), wide banner hero title bottom-left over a scrim, tiles with faint teal wash; solid tab bar with filled teal icons, 11px label; edge-to-edge 64px mini player (art 48px, heart `.np-mini-fav`, play, 2px saffron progress); 12px art, teal 64px play, Lyrics/Queue chips. **Harbour** - tall 16:9 hero with large-caps title over a bottom scrim (desktop spans content width), 1-column 72px rows with 4px art and a "›", section heads with a 2px cyan bar; solid tab bar with hairline top, active icon cyan with a 2px bar beneath; solid bar across the bottom with cyan progress along its top edge; blurred artwork behind a scrim, square art, white play, cyan progress. **Verse** - full-bleed artwork behind a 20px pane on phones, the description as a lyric line in the display face (`.vxh-hero-desc`) with a coral play, 2-column 14px tiles with coral wash, capsule chips; tab bar fades up, active tab a coral bubble; floating capsule mini player (12px margins, round art, coral progress inside); full-bleed blurred artwork, larger lyric block (`.vx-np-lyrics`), coral 68px play. **Onyx** - overline above each title with a "More" outlined pill, jump back in 1-column 56px quick picks with a kebab, hero hidden on phones in favour of the chip row; solid black tab bar with filled white active icon, 10px label; full-width bar mini player (40px art, play + next, 2px white progress on top); black, square art large, white 64px play, uppercase tabs (`.vx-np-tabs`) with a white underline.

Rules every style keeps: colour blocks carry `:not([class*='fest-'])`, accent block `:is(:not([data-accent]), [data-accent='crimson'])`; text and accent tiers clear WCAG AA on canvas and raised surface in both themes; `--ink-900` equals the canvas in `TEMPLATE_CANVAS` and the pre-paint table; flat styles set opaque materials in both themes with the 13.2 specificity fix; true black and high contrast outrank every style; a style's file styles only its own selector. A flat style: Verdant, Harbour, Onyx; Monsoon keeps its bars solid; Lumen and Verse are glass.

## Festival themes

On a festival's days `<html>` gains `fest-<id>` (the window table is inlined in `index.html` so the class is there before first paint; the look starts the day before and ends with the festival). A skin supplies an accent ramp for dark and an AA-safe light one, a tinted canvas, a top ribbon and an ambient backdrop (glow, faint pattern, large emblem, a few slow particles); because style colour blocks stand down, the skin looks the same over all six styles while the layout stays. Independence Day and Republic Day use a waving flag (nine strips and a 24-spoke chakra) instead of an emblem.

**Definitions:** `frontend/src/constants/festivals.ts` (dates), `festivalThemes.ts` (palettes), `festivalVisuals.ts`, `festivalEmblems.ts` (emblem, particles, blurb, search query). **Never edit `festivals.css` by hand**: change the definitions and run `npm run gen:festivals` (`frontend/scripts/gen-festivals.mjs`, core `festivals-gen-core.mjs`), which rewrites `src/styles/festivals.css`, `public/admin/festivals.js` and the window table in `index.html` (so the inline script and its CSP hash change: build, `node scripts/csp-hashes.mjs`). `festivals.test.ts` and `festivalVisuals.test.ts` check unique ids, a theme/emblem/blurb/query for each, sane windows, distinct looks from neighbours, light accents readable on white, generated artefacts in sync, no remote URLs, particle caps. Runtime: `components/FestiveSplash.tsx` (greeting card), `features/home/FestivalBanner.tsx` (Home strip), `features/festival/festivalPreview.ts` (session-only preview), `services/recommendation/festival.ts` (the date can inform picks). The console can override with the `festival` setting (`mode: force`, `id`, `color`, dates). Particles are not rendered under either reduced-motion switch or with Data saver on.

**To add a festival:** add its dates (`festivals.ts`), palette (`festivalThemes.ts`), visuals/emblem/blurb/query (`festivalVisuals.ts`, `festivalEmblems.ts`; emblems use only the five shared classes), run `npm run gen:festivals`, run the festival tests, rebuild and `node scripts/csp-hashes.mjs`.

**Live effects, celebrations and the Festivals page (1.12):** `frontend/src/features/festival/fx/` — `festivalFx.ts` maps every festival id to its effects (`fxFor`, `fxLine`, `paletteOf`); `particles.ts` is the particle system (seeded random, `createSystem`/`step`/`draw`/`burstInto`, budget ~70 pieces on a laptop and ~40 on a phone, glow sprites cached per colour); `useFxCanvas.ts` runs it on a canvas at 30 fps, measures each frame and thins the sky then stops it on a slow device; `FestivalFxCanvas.tsx` mounts inside the ambient layer (`FestBackdrop`) only after load **and the listener's first tap, click or key** (a full-screen canvas painted on its own was measured as the page's largest paint); `celebrate.ts` is the bus for one-shot bursts (`celebrate('confetti' | 'fireworks', { at, palette, sound })`, `celebrateOncePerSession`), drawn by `CelebrationLayer.tsx` (mounted by `FestiveSplash`) over the app; `sound.ts` synthesises the pop, firework and chime with WebAudio when `festivalSound` is on. Bursts: the greeting card opening and the first Home of the day (once a session), a tap on the Home banner (fireworks), "Play festive songs". Settings (`settingsStore`): `festivalFx` (default on), `festivalSound` (default off), `festivalPin` (a festival id kept on; `useFestivalNow` resolves preview > pin > owner override > calendar). `features/festival/calendar.ts` turns the windows into dates (`currentOccurrence`, `upcomingFestivals`, `nextStartOf`, `countdownTo`, `rangeLabel`); `pages/FestivalsPage.tsx` (`/festivals`, prerendered and in the sitemap) is the live page; styles in `styles/pages/festivals.css` and `styles/festival-fx.css`. Reduced motion (either switch) and data saver stop every effect.

**Listener behaviour:** the greeting card appears the first time the app opens during a festival (once per festival per year; never over the welcome or What's New sheet; `Esc` or **Continue** closes it; **Play ... songs** opens a search for that festival's music); Home shows a strip with **Play festive songs** (x hides it). Settings > Appearance: **Festival themes** switch (off = no look, card or strip; the line under it names the current/next festival) and **Preview a festival** (applies a skin and its card for the session; **Stop preview** or reload ends it; does not count as having seen the card). There are 43 festival looks; 40 switch on by themselves on these dates (2026 dates follow the lunar calendar or move each year):

| Month | Festivals |
| --- | --- |
| January | Sankranti / Pongal / Lohri (Jan 13-16); Republic Day (Jan 25-26) |
| February | Valentine's Day (Feb 13-14); Maha Shivaratri (Feb 15, 2026) |
| March | Holi (Mar 3-4, 2026); Women's Day (Mar 8); Ugadi / Gudi Padwa (Mar 18-19, 2026); Eid ul-Fitr (Mar 20-21, 2026); Sri Rama Navami (Mar 26-27, 2026) |
| April | Easter (Apr 3-5, 2026); Vishu / Baisakhi / Puthandu / Bihu (Apr 14); Akshaya Tritiya (Apr 19, 2026) |
| May | Buddha Purnima (May 1, 2026); Mother's Day (May 10, 2026); Hanuman Jayanti (May 12-13, 2026); Eid ul-Adha / Bakrid (May 27, 2026) |
| June | Telangana Formation Day (Jun 2); Father's Day (Jun 21, 2026) |
| July | Bonalu (Jul 12-26, 2026); Guru Purnima (Jul 29, 2026) |
| August | Friendship Day (Aug 2, 2026); Independence Day (Aug 14-15); Varalakshmi Vratam (Aug 21, 2026); Onam (Aug 25-27, 2026); Raksha Bandhan (Aug 28, 2026) |
| September | Krishna Janmashtami (Sep 3-4, 2026); Teachers' Day (Sep 5); Ganesh Chaturthi (Sep 13-15, 2026) |
| October | Gandhi Jayanti (Oct 2); Bathukamma (Oct 10-18, 2026); Dussehra (Oct 19-20, 2026); Halloween (Oct 31) |
| November | Andhra Pradesh Formation Day (Nov 1); Diwali, Dhanteras to Bhai Dooj (Nov 6-10, 2026); Nagula Chavithi (Nov 13-14, 2026); Chhath Puja (Nov 15-16, 2026); Guru Nanak Jayanti (Nov 24, 2026) |
| December | Vaikunta Ekadasi (Dec 19-20, 2026); Christmas (Dec 24-25); New Year (Dec 31 - Jan 1) |

Three more looks are in the preview list but never switch on by themselves (they overlap another festival or last a month): Navratri / Durga Puja, Children's Day, Karthika Masam; the owner can force any look for everyone.

## Charts, trends and canvas clips

**Charts and trends.** A list reaches a listener labelled as what it is: a **chart** item is a catalogue song matched with confidence to an entry an outside source reported as popular (source, rank, region, observation time, evidence link); an **editorial** entry is labelled editorial with an evidence link and expires; a **catalogue list** is labelled as a catalogue list. The 14.0 schema keeps no trend tables, so `GET /api/trends` always answers `200 { generatedAt, sources: [], items: [] }` (`OPTIONS` 204; cache `public, max-age=60, s-maxage=300`; the `?region=` query is accepted and ignored) and the Charts page shows catalogue lists under "no chart source is connected" (`services/trends/present.ts` `verifiedView`: `unavailable | not_connected | empty | items`). The recommender's `verified-trend` source therefore gets no candidates. `/api/trending-searches` answers `{ queries: [] }`. Kept code: `backend/worker/functions/api/trends.ts`, `_lib/trends/types.ts` (`RawTrendItem`), `matcher.ts` (+ test), `catalog.ts`, `frontend/src/services/trends/`. The pipeline of 7.2-13.9.1 (six-hourly ingest workflow, provider adapters, five `vinax_trend_*` tables, review queue) no longer exists. Bringing it back needs a snapshot/observation store with unique keys per source/region/chart/time, a provider registry whose terms allow rank metadata with attribution, the ingest loop with a quota ceiling and retention, and the read shape the app already understands. Tests: `npx vitest run worker/functions/api/trends.test.ts worker/functions/_lib/trends` (backend), `npx vitest run src/services/trends` (frontend).

**Canvas clips (Now Playing video).** The canvas (`frontend/src/components/SongCanvas.tsx`) auto-fits every clip: a clip close to the screen shape fills it (`object-cover`); a mismatched one (past 1.45x overscan) plays whole (`object-contain`) over a blurred, zoomed copy of itself, with the blurred album artwork as fallback while loading; re-decided per clip and on rotation. The music-video source publishes preview clips as `..._v_<height>p_p.mp4`; probed October 2026 every clip has 540p (the catalogue's `previewUrl`) and 360p; 720p/1080p/1440p/2160p answer 404 and the full-length `streamUrl` is not served, so the canvas is 540p at best and the player says so rather than printing "HD". The ladder (`services/canvas/quality.ts`) probes heights above 540p once a day while none exists, then per clip; Full HD / 4K switch on by themselves when the source adds them; **Auto** plays the highest rendition not exceeding the screen's longer side in device pixels; the quality chip pins a height; a failing rendition steps down. Full-screen view (the button while a clip plays): tap once for controls, double-tap anywhere likes (never unlikes) with a heart where the finger landed, quality chip, full-screen toggle; Esc/Android back/chevron return. Content spec for clips made for VinaX: mobile 9:16, 1080x1920 recommended (720x1280 minimum), 3-8 s seamless loop, MP4 (or JPG still); desktop/TV 16:9, 1080p+, H.264 safe floor (HEVC varies); no audio track (muted); under ~4 MB; `-movflags +faststart`. Example: `ffmpeg -i source.mp4 -t 8 -an -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -preset slow -crf 23 -movflags +faststart canvas-9x16.mp4`.

## Data and privacy

Written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), `frontend/src/features/settings/backup.ts`, the network clients under `frontend/src/services/` and the Worker routes. The in-app text is `frontend/src/pages/PrivacyPage.tsx`; any change to what is collected (or adding advertising) must update that page and this section in the same change. The gating code is `services/analytics/telemetry.ts`, `recTelemetry.ts`, `sessionInsights.ts` (usage-sharing choice) and `services/personal/reporter.ts` (personal engine switch).

### The short version

- **Device first, account second.** Library, history, settings and the taste profile live on the device; a signed-in listener's also sync to the account as one copy.
- **The personal engine** (on while signed in, off with one switch) reports plays/completes/skips/likes/saves to a server-side taste model; Settings > Region & privacy has the switch and **Erase my taste model**; Kid mode never reports.
- **Features that need the network send what they need.** Browsing sends search words and ids to the catalogue source. Signed out or with the engine off, listening history and the taste profile stay on the device; the heard-set never leaves it. Music AI sends only compact summaries; what a signed-in listener types into VinaX AI goes to its providers.
- **Usage statistics are on by default, off with one switch** (14.0.3: the welcome box is ticked and says so; Settings > Region & privacy). While off, no usage events are sent. **Session insights** (third-party, masked replays) are opt-in, off by default.
- **There is no advertising.** No page, web or Android, loads an advertising script; the CSP allows no advertising hosts (the AdSense slot, ownership tag and `/ads.txt` were removed).
- **The server keeps what its features need, in one database, and nothing more:** no precise location; an IP address only in the 90-day `sign_ins` history; usage events purged after a bounded time; rate limiting keys on a hashed network address.

### Your Google account

VinaX needs a Google account: until a listener signs in, every page is the sign-in screen (Privacy, Terms, Contact stay readable; on the website Explore/Discover/Charts/Search and entity pages can be browsed first). Signing in sends Google's ID token to the Worker, which verifies it and stores one `accounts` row: Google account ID, email (and whether verified), name, picture address, linked device (`listener_id` when the device proves its signed ID), time, coarse sign-in facts (edge `country/region/city`, `platform`, `app_version`; not the IP). **Account emails** (with `RESEND_API_KEY`): welcome and sign-in alerts list time, browser/system, the connection's IP (`cf-connecting-ip`) and city/region/country; Resend receives the email address, first name and the email's text; console admins also get sign-in and invite emails; no marketing emails. **Sign-in history (schema 12):** every Google sign-in writes a `sign_ins` row (account, time, IP when it looks like IPv4/IPv6, browser/system, platform, app version, geo, `signup`, `new_device`); the only table with an IP; deleted after 90 days by housekeeping and with the account; the console shows the latest 100 on a profile. **What syncs:** `account_backups` holds one copy in the backup-file format (settings, library/playlists, smart collections, history, taste profile, bookmarks, Home layout; <= 2 MB; not the heard-set; searches and device identity never sync); merged into each device and updated a few seconds after a change; a version number makes two devices merge. **Session and deletion:** the session is sent only to `/api/auth/*`, `/api/account/*`, `/api/personal/*`, `/api/ai/*`, `/api/profile`, `/api/follow`, `/api/shared-playlist`; **Sign out** forgets it on the device; **Delete account** (Settings > Profile) removes the account row and with it the synced copy and everything cascading. On the web the sign-in button loads from Google; the app uses the system Google sheet.

### What is stored on the device

| Where | What |
| --- | --- |
| `localStorage` registry keys (`vinax.*`; `constants/storage-keys.ts`) | Settings (`vinax.settings.v1`, includes the app style as `template`), player/queue, library, history (last 150), search state, taste profile + Kid-mode profile, region, welcome-done flag, last-seen version, name, username (+ pending), alarm, lyric offsets, karaoke history, weekly mix, output choice, downloads index, room host keys, update reminders, install id `vinax.device-id`, signed id `vinax.signed-device-id`, usage choice `vinax.analytics-consent` |
| `localStorage` feature keys | Bookmarks, smart collections, search workspace, streak, badges (`vinax.badges.v1`), sidebar groups, Home layout and AI Home choices (`vinax.home.ai.v1`), generated songs (`vinax.generated.v1`, <= 30), Home signals (`vinax.home.signals.v1`), recommendation memories (`vinax.recs.outcomes.v1`, `seedmemo.v1`, `exposure.v1`, `snoozed.v1`), dismissed banners, VinaX AI prefs (`vinax.vxai.prefs.v1`) |
| `sessionStorage` | Boot/chunk-reload counters, restore Undo snapshot (`vinax.backup.undo.v1`), session Home order, session intent, live Listen Together session (`vinax.together.session.v1`) |
| IndexedDB `tarang-db` | The listen-event log behind taste insights |
| IndexedDB `vinax-heard` | The lifetime heard-set (canonical keys; never leaves the device except inside an exported backup) |
| Cache storage `vinax-shell-*`, `vinax-audio-v1` | App shell/build assets; downloaded songs (not cleared by SW update or boot recovery) |
| Android app storage | Downloaded audio files |

The app style is a display preference only: no request builder or usage event reads it. On first launch after the old AI features were removed, `services/storage/earlyMigrations.ts` erases leftovers (`vinax_ai_chats_v1`, `vinax.ai.*`, `vinax.aiplaylist.*`, AI caches, the `vinax-embeddings` IndexedDB).

### What leaves the device

**Always-on functional requests:** browsing/searching/opening pages -> the catalogue source (directly or via the Worker's catalogue routes: search words, ids, language, page parameters); playing -> the audio host in the stream URL; artwork -> the artwork host (the CSP allows `https:` images, `data:`, `blob:`); lyrics -> an open lyrics database then the catalogue (title, artist, duration; lyric-word search sends the words); app config/flags/festival/announcements/blocklist/site mode/version/experiments/trending searches -> the Worker (nothing personal); `/api/trends` (region code/language/limit); `/api/geo` (nothing beyond the request; asked only while region inference is allowed and no override, at most every 12 hours); `/api/username` (username, display name, install id, signed id, current username when changing; availability checks send only the candidate); `/api/feedback` (message, type, platform, version, display name, install id; the Worker adds country/city); `/api/push/*` (web: endpoint, keys, app language, time-zone offset; Android: token, platform, language, offset; the Worker adds edge geo; unsubscribing marks the device inactive); Listen Together `/api/room` (room code, display name, playing song, upcoming songs, position; guests heartbeat with the install id and send a leave beacon; a song request carries id/title/artwork/name; reactions one emoji; only the host's key unlocks member names; ending deletes the room and members; idle 6 h swept hourly); `/api/handoff` (ciphertext only, <= 10 minutes, deleted on first read); casting loads a cast script from its vendor only when the picker opens (web). The install id is created the first time something needs it (claiming a username, joining/hosting a room, sending a usage event).

**The personal engine** (only signed in, setting on, not Kid mode): per event a device-minted id, kind, time, song id, seconds heard, song length, surface (shelf key + position, radio, search, playlist maker), local hour/weekday/time-zone name; once per song in the batch: id, title, artists (with ids), album, language, year, length, artwork link, inferred facets; plus the Familiar/Balanced/Discover setting; `GET /api/personal/home` sends local hour/weekday, discovery mode, active festival id; Make me a playlist sends the request text (3-500 characters), song count, local hour; Up Next refills send the newest anchor song id, mode, local hour; erase sends only the session. The account's plays also count anonymously in two community figures (listeners who played a song this week; songs played together). Server side: the batch folds into `personal_taste`; songs join the shared pool `personal_songs` (no account attached); shown/played goes to `personal_exposure`. Two steps use an AI model: each song's catalogue words are embedded once (says nothing about any listener) and the Home page/playlist is arranged by a VinaX AI model given the taste summary's few lines, hour, day, first name and candidate songs - never the event history. Events are kept for a year, a composed Home page for 30 minutes, a playlist for 30 days; account deletion removes all, **Erase my taste model** removes all and keeps the account.

**AI:** signed out or engine off, nothing about listening is sent to an AI service. Voice search and Drive-mode commands use the browser's/phone's own speech recognition; VinaX never receives audio. **Music AI** sends summaries the device builds (`services/ai/tasteSummary.ts`) through the Worker to the same providers as VinaX AI; nothing stored; Worker logs counts and model:

| Feature (switch) | Sent to `POST /api/ai/...` | Fields |
| --- | --- | --- |
| Let AI build my Home (Settings > Home, on) | `home-layout`, once per Home generation (<= every 30 min or on refresh) | generation number; taste summary + sitting intent; allowed shelf types and "Not interested" ones; <= 8 seed songs as `{ key s0..., language, mood, genre, leadArtist }` (no title/id); <= 20 recent AI shelf titles |
| AI DJ (Settings > Recommendations, on) | `dj`, <= once per playing song and tune chip every 10 min | playing song `{ title, artist, language, mood, energy }`; titles + lead artists of the last 10 songs played; taste summary and intent. Answer: <= 15 `{ title, artist, reason }` the device resolves in the catalogue |
| AI Playlist (Library/Queue, when pressed) | `playlist`, once per request | typed text (<= 200 characters), song count (10-30), titles + lead artists of the last 10 songs, taste summary |
| Lyrics tools (Lyrics page) | `lyrics` | lyric lines as shown (<= 160), title, lead artist, language, task - nothing about the listener |
| Generate a song like this (Now Playing; "Add a generated song to my queues", off) | `generate-song` | `{ mood, energy, tempo, genre, language, durationSec, instrumental, kid }` + optional words (<= 200; none in Kid mode); never audio/title/artist/lyrics; header `x-vinax-device` carries the install id for the daily quota (the Worker stores only a hash with the day); the Worker sends a text brief alone to Google's music models (a background job is kept by Google for its standard retention; a one-call song is sent with `store: false`) |
| AI fine-tunes Up Next (on) | `rerank`, once per continuation | <= 40 songs as `{ key c0..., language, mood, energy, genre, leadArtist }`; taste summary `{ languages <= 4, artists <= 8, moods <= 4, energyByHour, discovery, skipStreak, hour, weekday }`; sitting intent |

**VinaX AI** (only when a signed-in listener uses it): what they type goes from the Worker to the answering provider (the privacy page names them); the chat never sees listening history apart from memory notes; Personalisation prefs are sent with each message for that reply only (not stored with the chat or logged); web search sends the search words (latest message, links cut to sites) to Google (grounding) or Tavily/Serper, results cached at the edge up to an hour keyed by a hash of the query; conversations are stored with the account (`ai_conversations`, `ai_messages`); a deleted chat is hidden at once and removed within a day; files are stored in a private bucket only the Worker can read (images shrunk on the device, PDF text read on the device), sent to the answering provider, removed with their chat/account, never-sent files after a day; the Worker logs only route, model, provider, latency, status, token counts. Voice only on button press: **Dictation** sends the clip Worker -> Groq (Whisper) or Google (Gemini); **Read aloud** sends the reply words to Groq (Orpheus) or Google; **Live voice** streams the mic straight to Google (Gemini Live) with a one-use token (what both sides say is saved as ordinary messages when it closes; audio is not stored; with search on, Google may turn speech into searches inside its session; on a search toggle the page sends the latest call turns <= 4,000 characters to put in the new session's instructions, neither stored nor logged). Music pauses while the mic is open. **Memory:** up to 50 notes of <= 200 characters (`ai_memories`; origin, source chat until purged, times) and two switches (`ai_memory_prefs`) plus the incognito flag; learning sends a small model the current notes and the last <= 3 user messages (<= 2,000 characters each) with replies (<= 1,500 each, code/artifacts left out) - nothing else; the model is told never to keep secrets, contact/financial details, health, sex life, religion, politics, caste/ethnicity or anything about others, and the Worker refuses anything that looks like them; notes go to the provider writing each new reply; only the Worker reads them; the console shows only totals; kept until deleted (Delete / Forget everything / account deletion); the owner can turn memory off for everyone. **Shared chats** exist only when the listener presses Create link: a snapshot (`ai_shares`: title, per turn text/cited sources/time; files by name and type only; no reasoning, model, tokens, name, email or picture); anyone with the link (128-bit id, noindex) can read; the owner's account id is never sent; kept until Stop sharing, chat deletion (at once), or account deletion; browsers may keep a loaded copy up to a minute. **Projects** exist only when made: name, description, instructions (<= 8,000), starred, times, files (same private bucket; text read out of text files/PDFs; <= 20 files and 200,000 characters), each chat records its project; project name, instructions and files go to the answering provider with every message in a project chat (a PDF may go to Google's file service up to 48 hours), not copied into messages, not logged, never in a shared link; **Delete project** removes instructions and files at once, chats stay unless "Delete them too". Settings > Your data > **Export VinaX AI chats** downloads every chat (all versions) and every project as one JSON (`GET /api/ai/export`), separate from the backup.

**Only with usage sharing on:** `/api/events` -> `events` + `listeners`: install id, signed id, display name when set, event type, platform, app version; for song events the id, title, first artist, language, artwork URL; types register, open, play, pause, heartbeat, skip, complete, favourite, dislike, playlist add, share, download, lyric miss, error (short message), web vitals, search (words <= 80 characters + result count), presence; the Worker never stores the install id (a server-derived device id, `_lib/identity.ts`) and adds edge country/region/city; events without `x-vinax-consent` are dropped; a `play` is sent only when it counts (>= 5 s heard or 70% of a shorter song, once per run). `rec_served`/`rec_outcome` carry no song. Session insights send layout, taps and scrolls to a third party with on-screen text masked on the device (production only; advertising storage denied).

**The usage choice:** asked on the welcome sheet's languages step (checkbox starts ticked, `useState(true)` in `OnboardingSheet.tsx`); stored as `vinax.analytics-consent` (absent = on; `vinax.usage-sharing-default-on.v1` marks the one-time switch of pre-14.0.3 devices; session insights `vinax.session-insights-consent.v1`, absent = off); enforced by `consented()` on every send plus the `x-vinax-consent` header (the Worker ignores events without it); changeable at Settings > Region & Privacy > Share anonymous usage (off at once) and Session insights (off after next reload); backups do not carry it, device transfer does; rows already sent stay until the retention purge or a deletion.

### Server-side records

| Table | Contents | Removed when |
| --- | --- | --- |
| `listeners` | Device that shared usage or claimed a handle: server-derived device id, display name, handle, platform, version, OS/browser/device, edge geo, now playing, first/last seen | Owner deletes the person |
| `accounts`, `sign_ins`, `account_backups` | Signed-in listeners; sign-in history (IP); synced copy | Delete account / owner delete; `sign_ins` also after 90 days |
| `ai_projects`, `ai_shares`, `ai_memories`, `ai_memory_prefs`, `ai_conversations`, `ai_messages`, `ai_attachments` | VinaX AI data | Their delete actions, or with the account |
| `personal_taste`, `personal_events`, `personal_exposure`, `personal_pages` | Taste model, reported events (kind, time, song id, seconds, source, hour/weekday/tz), exposure, composed pages and requested playlists | Account deletion, **Erase my taste model**; events > 1 year and pages a day past expiry by housekeeping |
| `personal_songs`, `personal_colisten` | Shared song pool and co-listening; no account attached | Nothing about a person; co-listening rebuilt daily from 30 days |
| `events` | Usage events (with sharing on) | `retention.eventsDays` (default 180), owner purge, or with the person |
| `feedback` | Message, type, name, device id, platform, version, geo, status, owner note | Owner deletes; a deleted person's feedback is detached |
| `song_reactions` | Reaction (fire/love/feels/dance/wow), song facts, derived device id, time; one per device per song; counts public, device never shown | Removed with the device by `delete_listener` |
| `profiles`, `follows`, `shared_playlists` | Public profile, follow edges, shared playlists | Remove my profile / account deletion |
| `push_devices` | Endpoint+keys or token, platform, language, offset, geo, active flag, last pushed | Marked inactive on unsubscribe or after 180 days; not deleted by those paths |
| `rooms`, `room_members` | Room state; member rows | Host ends; leave; idle 6 h / 1 day by housekeeping |
| `notifications`, `outreach` | What was sent (title, body, link, audience filter, counts); per-person automatic push records | Owner retracts (kept, marked); outreach 180 days |
| `settings`, `experiments`, `audit_log`, `uptime_*`, `job_runs`, `blocked_content`, `meta`, `admins`, `owner_notes`, `error_status` | Owner/operations data | Nothing about listeners (owner notes cascade with the account) |
| `HANDOFF` KV | Device-transfer ciphertext | 10 minutes or first read |
| Generated songs KV | Job (account id, status, length, mood, language, title), finished audio, daily counters under hashes | Job and audio after 24 h; counts after two days |
| Rate limiting | Counters keyed by route + hashed address (peppered) | Short-lived; raw address not in the key |

Deletion paths: the listener erases the taste model (Settings > Region & privacy) or deletes the account (Settings > Profile -> `accounts`, `account_backups`, VinaX AI chats/projects/shares/memory, every `personal_*` row); the owner deletes a person in the console (device row, usage events, room memberships, account and backup; feedback detached; reason in the audit trail); Database Maintenance can purge usage events older than a chosen number of days for everyone. A local erase removes nothing on the server.

### The backup file

Settings > Your Data exports one JSON: `{ "format": "vinax-backup", "schemaVersion": 2, "app": "vinax", "appVersion", "exportedAt", "categories": { "<category id>": { "<storage key>": "<value>" } } }`. Categories: `settings` (`vinax.settings.v1` incl. app style; inferred region dropped) + region key, `library` (favourites, playlists with tags/pins/descriptions, Listen Later, saved albums/artists, hidden songs/artists), `smartCollections`, `history` (last 150), `taste` (profile + Kid-mode profile), `searches`, `bookmarks`, `homeLayout` (order, hidden, headline, `vinax.home.ai.v1`), `identity` (display name, username, welcome-done flag), `extras` (alarm, lyric offsets, karaoke history, streak, badges, sidebar groups), `heard` (<= 200,000 canonical keys; restore only adds; never in account sync). Never included (`BACKUP_EXCLUSIONS`): downloaded audio/paths, install id/signed id, Listen Together host keys, the usage-sharing choice, queue/position/caches, update reminders/What's New read state, VinaX AI chats (an older file's `aiChats` is ignored with a warning). `parseBackup()` refuses > 8 MB, non-JSON, non-VinaX files and a newer `schemaVersion`; each category is sanitised on its own (settings filtered to known keys of the right type; unknown app style falls back to the default). **Restore** (Backup Center: shows each category next to the device's; choose categories; **Replace** makes chosen categories exactly the file's - in `identity` a missing value never undoes the welcome flow or name; **Merge** unions: library lists by id, same play once, taste profile of the side that learned more kept): snapshot of touched keys to `sessionStorage` (`vinax.backup.undo.v1`), one all-or-nothing batch writer, a restored username written pending and re-confirmed, store writes frozen then reload, **Undo that restore** until the tab closes; optional "Download a safety copy first"; quick restore = replace of everything. **Move to a new device** is the only path that carries identity (payload = backup + install id, signed id, confirmed username, usage choice; encrypted on the sender with a passphrase-derived key (`features/settings/handoff.ts`); only ciphertext goes to the relay; passphrase travels in the QR code's URL fragment or is typed; QR + 10-character code + six words). **Erasing:** Clear history/favorites (Undo), `clearPersonalization` (taste profile, recommendation memories, Home signals; favourites stay), Reset app state > Erase everything (listen-event log, `vinax-heard`, `vinax-embeddings`, every `localStorage` key starting `vinax`, then reload; does not clear the downloaded-audio cache or `sessionStorage`).

## SEO and indexing

- **Static pages:** the build writes prerendered routes, the 72 mood x language hubs, song/album/artist pages and every sitemap (`sitemap.xml`, `sitemap-static.xml`, `sitemap-hubs.xml`, `entity-pages.xml`) as static files (Worker routes were removed to protect the daily request quota; retired maps 301 to the index in `_redirects`). Only built pages answer 200 under `/song/`, `/album/`, `/artist/`, `/playlist/`, `/lyrics/`; any other URL there gets that folder's `404.html` (plain app shell with `noindex`, written by `frontend/scripts/prerender.mjs`) with status 404 - listeners still get the app (the page renders from the id in the URL), crawlers no longer see a copy of Home with Home's canonical. Built pages link only to other built pages; after the main list the build adds the pages they link to most (`ENTITY_MAX_LINKED`, default 1500). Charts, Top Songs, Trending and language pages carry song lists in crawlable text.
- **Catalogue sources:** the build reads VinaX's own catalogue API (`musicapi.vinaxmusic.online`) first and public mirrors after; a host build writing fewer than 300 entity pages (`ENTITY_MIN_PAGES`) fails so Pages keeps the last good deployment (on 2026-11-05 mirrors answered 429/402 and a build went live with no entity pages at all).
- **Daily SEO pages** (`.github/workflows/seo-pages.yml`, 02:00 India time or by hand): grows song/album/artist pages by up to 3,000 a night until 17,000 (`ENTITY_MAX_TOTAL`; the Pages Free plan allows 20,000 files per site and the app is ~560); keeps a page store (`frontend/.seo-corpus`, carried in the Actions cache), rebuilds the charts' pages, re-renders the 1,000 oldest pages, adds the pages the others link to most, deploys with `wrangler pages deploy`; spends no Worker requests. Every build (including the host's own) first downloads the pages the live sitemap lists that it lacks, so no build shrinks the site; one that would drop > 20% of live pages fails (`ENTITY_MIN_PAGES=0` overrides). Needs `CLOUDFLARE_API_TOKEN` including Account > Cloudflare Pages > Edit; without it the job does nothing.
- **robots.txt** stays a static file on every host (a Worker-served robots.txt answered 429 when the quota ran out and Google stopped crawling); the bots card in the console writes the `robots` setting and triggers a rebuild via `PAGES_DEPLOY_HOOK`; `GET /api/robots` builds the text; `status.vinaxmusic.online` and `vinax.pages.dev` answer `X-Robots-Tag: noindex`; shared AI chats are `noindex, nofollow`.
- **Browse pages and machine-readable catalogue (1.12):** New Releases, Top Playlists, Top Artists, Podcasts, Radio, Videos and Festivals are prerendered (`scripts/prerender.mjs` ROUTES, with CollectionPage JSON-LD) and listed in `sitemap-static.xml.ts`; `public/llms.txt` describes the app for assistants; `public/.well-known/ai-catalog.json` (also `/ai-catalog.json`) lists pages, URL patterns, actions, pricing and sign-in facts and is excluded from Functions in `_routes.json`. Link previews use `/icons/icon-512.png` (the old `og.png` banner is gone).
- **IndexNow:** the Worker's `indexnow` job (every 6 h) posts new sitemap URLs to Bing/Yandex/Seznam/Naver (Google reads the sitemap); key file `frontend/public/<key>.txt`.
- **Baseline (2026-11-05):** 0 indexed pages at the time; host redirects are Cloudflare Redirect Rules, not `_redirects`; dashed song ids (`<slug>-<id>`).
- **Owner checklist (code cannot do these):** verify the domain in each search engine's webmaster console and submit `https://www.vinaxmusic.online/sitemap.xml`; after a few days review non-indexed URLs; paste a song link and the Home link into messaging apps - each should show a title and artwork card; weekly read the console Dashboard and Growth & SEO pages, Analytics and the Feedback inbox. Lighthouse (`lighthouse.yml`) fails on accessibility and search checks for prerendered routes.

## Legal and copyright

A plain-language summary for maintainers, not legal advice. Listener-facing pages: `/terms`, `/privacy`, `/dmca`, `/contact`. The repository carries no licence file.

| Topic | Position |
| --- | --- |
| Nature of the service | A free music player that streams music, artwork and lyrics from public catalogue sources. Hosts no media files, charges nothing, sells no data |
| Copyright | All songs, recordings, compositions, artwork and lyrics remain the property of their artists, composers, labels and publishers; attribution (title, artists, album, film) is shown as the catalogue provides it |
| Takedowns | Rights holders ask through the in-app DMCA page (`/dmca`) or contact page (`/contact`); a verified request is honoured by adding the content to the server-side blocklist (`/api/blocklist`, console Blocked Songs & Albums), which every client reads |
| Advertising | None on the website or the Android app |
| Listener data | Listeners sign in with Google; favourites, history and taste profile are stored on the device with export and erase, and sync to the account; server-side usage statistics depend on the usage-sharing choice. [Data and privacy](#data-and-privacy) is the authority |
| Outside services, by kind | A public music catalogue and its media CDN; an open lyrics database; static hosting and an edge Worker platform; a push service; a hosted database; AI model providers for VinaX AI and music AI (only through the Worker, with the summaries listed under Data and privacy). Operational names are in the deployment and operations sections and `backend/.env.example` |
| AI generated songs | New, original tracks from Gemini's music models on the VinaX AI key; the model receives only a description of a feel and the listener's own words, never another song's audio/title/artist/lyrics; every request tells it to compose an entirely new piece without naming, imitating or referencing a real artist or work; listener words naming a real artist/song are refused; every track is labelled "AI generated" (cards, Now Playing, lock screen, share cards) and never appears in charts/trends; kept 24 hours on the server, a saved one stays on the device; the model provider's terms decide what may be done with its output and its safety filter refuses specific artist voices or copyrighted lyrics; every track carries an inaudible watermark; **the owner must check those terms before switching generation on** |
| Disclaimer | Provided "as is" without warranty; catalogue availability depends on outside sources and can change without notice |

## Real-device QA script

What automated tests cannot prove. Part 1 is a 25-minute pass on one phone before every release; Part 2 is the longer pass before tagging an Android release and after any change to the audio engine, media session, native files or service worker. Devices: **A** the Android app (newest package), **B** a phone browser on production, **C** a desktop browser, **D** a TV browser. Mark pass/fail; for a fail write device, app style, theme, step and exactly what you saw. Use the narrowest phone available; steps marked **360** can also be run in a desktop device mode at 360 px.

**Part 1 (A or B)**

1. *Welcome (5 min; fresh install or private window):* the sheet shows "Step n of N"; Back works after the first step, optional steps offer Skip; step 1 takes name + username and offers Move from old device and Import a file; the languages step shows the usage-sharing choice (ticked by default); **Pick your look** shows the six styles and tapping one changes the app behind the sheet at once; tap songs you like, pass the slides, finish - Home paints with artwork in the chosen style; **360** nothing scrolls sideways or clips a button; reopen - the welcome does not return and the style is kept.
2. *The six app styles (10 min):* start a song first. In Settings > Appearance > App style, for each of Lumen, Verdant, Monsoon, Harbour, Verse, Onyx: the tab bar is fully visible, labels readable, current tab marked; the mini player sits clear of the tab bar and its play/progress work; Now Playing artwork, title, seek bar and controls fit and **Open queue** is reachable (**360**: not off the edge); scroll a long page (Home, Settings) - page text does not show through the top bar. In any two styles: light theme is readable; the Black theme is true black and the top bar still has a fill when scrolled; A/B: note whether the system status-bar icons are readable against the top of the app, especially when the app theme differs from the phone's light/dark setting (nothing in code sets the native bar colour - write down phone, style, theme of any mismatch); change the accent away from **Style colour** and back - the style's own accent returns.
3. *A festival preview (3 min):* Settings > Appearance > Preview a festival - colours change, ribbon and backdrop appear, the style's layout stays; the greeting card shows emblem, greeting, **Play ... songs** (opens search for the festival) and **Continue**; Home shows the festival strip and dismissing removes it; reload - the preview is gone.
4. *Reduced motion (3 min):* turn on Reduce motion (then repeat with the system setting): style change is immediate with no cross-fade; no moving particles in a festival preview; Now Playing and queue do not slide or spring; Data saver with a festival preview shows no particles.
5. *Playback outside the app (4 min):* lock the phone - the lock screen shows artwork, title, artist, play/pause, next, previous and a seek bar; headset buttons work; switching output (wired <-> wireless) continues from the same position.

**Part 2 (full pass)**

6. *Boot and offline (A):* reopen three times (no freeze/crash); download three songs; airplane mode - the app opens on Downloads, each plays, seeking works, one runs into the next; Library, Settings, Help open offline without reload loops; downloading a new song says there is no internet; back online **Download all** on a 20+ song playlist finishes and failures name their reason; airplane mode, swipe closed and reopen twice - opens both times and downloads still play.
7. *Player and queue (A, B, C):* tap a song - Up Next fills in its language; Pin a mood rebuilds Up Next, tapping again unpins; Queue page > Tune this queue rebuilds (played and current songs stay); a song added from the menu sits ahead of automatic picks and stays after another Tune; double-tap the artwork edges - 10 s back/forward; with "Build every queue" more songs arrive before the last ends; take a phone call and hang up - note whether playback resumes by itself; A only: the player widget shows the current song and its buttons work.
8. *Notifications (A, B, C):* B, C: Home's notification card **Turn on**; in the console send a test notification targeting a song - it arrives and tapping opens that song; A: with the app swiped closed send another (needs [Android push setup](#android-push-setup)).
9. *Updates (A):* with an older package the update dialog appears; **Update later** keeps it away for that build while the Settings check still finds it; install - the app reopens on the new version with library, history, settings and style intact.
10. *Backup and restore (A, B):* export a backup; remove a favourite and switch style; Backup Center - choose the file, preview, restore with Merge then with Replace (data matches the preview; after Replace the backup's style is back); **Undo that restore** returns the earlier state; a damaged or unrelated file is reported and changes nothing.
11. *Listen Together (two devices):* start a room and join by code or link - both hear the same moment; the guest adds a song and it appears in both queues; the host pauses/skips and the guest follows within about a second; ending the room ends it for both; **360** both cards fit and Start is not clipped.
12. *Search and TV (B, C, D):* a misspelt artist still returns results; with the field empty trending searches appear and tapping one runs it; D: the remote's direction keys reach every control on Home, Search and the player.
13. *Maintenance switch (owner, last):* switch the site to maintenance with a message - within about a minute site and app show the maintenance screen and the console still works; switch back - everything returns within about a minute without a manual refresh.

## Listener guide

A condensed guide to the product as a listener sees it (the same material is in the app: **Help** has seven live tutorials on the real screens - Play your first song, Find any song, Listen Together, Change the app's look, Festival themes, Settings worth knowing, Save and organise - searchable how-tos, FAQs and the shortcut list; Help > **Replay the welcome tour** replays the welcome). VinaX is free: no subscription, no premium tier, no ads; sign in with Google.

### Getting started

The welcome shows "Step n of N"; the first two steps are required, then Skip / Skip the rest. Steps: **Your name** (>= 2 letters) and **Username** (3-20 letters, numbers, underscores; availability checked while typing, suggestions offered; other listeners find you by it); **Choose your languages** (More languages, All languages; a pre-ticked box offers anonymous usage sharing); **Pick your look** (six styles, applies as you choose, Use this look / Skip); **Tap songs you like** (saved to Favorites on this device); four slides (Four places to go, Tap one song, Change it any time, Yours to keep; last offers Live walkthrough). Links on step 1: **Move from old device** and **Import a file**. Everything can be changed in Settings. **Browse before you sign in** (web): Explore VinaX first -> Explore, Discover, Charts, Search and entity pages; play/like/save ask for sign-in right there. **Four destinations:** Home, Discover, Search, Library (bottom tab bar on phones, sidebar on wide screens; same order in every style); `Ctrl/Cmd + K` opens the command palette. **First song:** before anything has played Home shows **All the music you love. Free.** with **Start listening** and **Pick your languages**; afterwards press play on the mix card (named after your style, "Lumen Mix" to start), start Radio, or tap any song (five more are lined up, familiar first; songs you queue play before those). Heart saves to favourites. **iPhone/iPad:** no store app - Safari > Share > Add to Home Screen > Add (the bar says **How**); opens full-screen, keeps playing with the screen off, lock-screen controls; sound effects (equalizer, balance, mono, loudness) are not available in Safari there. **A Home built for you:** VinaX AI builds Home each time (which shelves, order, names, a one-line reason each; may add **Made for right now**); Home never rearranges while you look - it rebuilds on pull to refresh, **Refresh Home**, or after half an hour; **Not interested** on a shelf leaves it out next time (bring back in Settings > Home); Settings > Home > **Let AI build my Home** off returns to on-device arrangement, **Rebuild Home now**; **Customise Home** and owner-published layouts always win; the AI gets a short taste summary, never history. **Change the look** in Settings > Appearance: App style, Theme (Dark, Black, Light, System, Auto), Accent color (Style colour, preset, Custom, Dynamic), Festival themes / Preview a festival, Display size, Density, High contrast, Reduce motion; **App language** English/Telugu/Hindi/Tamil for menus (song names and catalogue stay). **Keep your music safe:** Settings > Your data > export a backup before clearing browser data.

### Player and queue

Tap a song: it starts and VinaX adds the next five (more as the queue runs low). *Why this song?* in the song menu. To follow the list you tapped: turn off Settings > Recommendations > Smart Queue > Build every queue (or Smart Queue on the Queue page). Queue languages: Settings > Recommendations > Languages. **Queue a song yourself:** ⋯ > **Play next** / **Add to queue**; right-click gives a short menu; swipe a row right = add to queue, left = Listen Later; your songs stay when VinaX rebuilds its picks. **Radio** (Home > Radio, or **Start radio** on an empty queue): pick a mood (Melody, Romantic, Dance, Chill, Sad, Devotional, DJ remix, Folk, Beats, Classics, New), a station, or a song/artist; every song menu and artist page has **Start radio**. **Queue page** (Queue button in mini player/Now Playing): groups Now playing / Your songs / Up next; marks **VinaX pick** (replaced by Refresh up next), **Added by you**, none (came from the list you tapped); drag handle (or focus + up/down arrows) reorders; ⋯ per row: Keep this song, Move up/down, Clear from here down, Remove from queue; sort chips Energy, Calm first, Newest, Classics, Mood arc; **Save as playlist**; **Build a queue**; Undo after an accidental remove. **Smart Queue** switch: on = VinaX builds what plays next around each song you start and songs you add play first; off = your order. **Tune this queue** (Queue page, or Now Playing > Player tools): More energetic, More chill, More romantic, More melody, More beats, Devotional, DJ remix, Folk, Heartbreak, More classics, More new, Same language, Switch language, Surprise me; added songs stay; the tune lasts until you start a fresh song. **Pin a mood:** Now Playing > Up next > Pin a mood (Romantic, Energetic, Chill, Melancholy, Devotional) for 45 minutes; tap again to unpin. **Never repeat** (Settings > Recommendations or the Queue chip): every song VinaX adds is one you have never heard in any version; your own songs and **Play again** always play; VinaX remembers every song played on this device even with the mode off; when new songs run out it looks further (related artists, deeper into the sound, popular in your languages), then says "You've heard everything we can find here. Try Discover or another language" and stops; the heard list is in your backup, **Reset app state** erases it. **AI fine-tunes Up Next** only reorders songs VinaX already picked (the AI gets a short summary, no titles; "AI pick" + reason in *Why this song?*; if slow, VinaX's own order plays; switch in Settings > Recommendations). **Generate a song like this** (where enabled): Now Playing > Generate; 1/2/3 min, Instrumental, a few words (naming an artist or song is refused), Generate (progress bar, keep listening), then Play now / Play next / Save / Make another; every generated song says **AI generated**, is kept a day unless saved/liked/added to a playlist, a few a day (5 unless changed), Kid mode instrumental only; **Add a generated song to my queues** in Settings > Recommendations. **Now Playing:** swipe artwork = next/previous; double-tap edges = +/-10 s; double-tap centre = like; tabs Up next / Lyrics / Credits; **Lyrics** full screen; **Player tools** (volume, Speed, Loop a passage, Marks, Tune this queue, More, Share this moment, Ambient mode after 45 s idle); ⋯ menu (Drive mode, Karaoke when synced lyrics exist, Listen together, Share now-playing card); **Artwork / Video** chip when the song has a music video; ⤢ full-screen video canvas (tap = controls, double-tap = like with a heart, quality chip e.g. "540p - Auto", ⤢ browser full screen, chevron/Esc/Android back to leave). **React to a song:** five reactions (fire, love, feels, dance, wow) under a song page and in Player tools > React; tap again to take back, another to change; one per song per device; counts public, who reacted is not. **Streaming quality** (Settings > Sound > Audio quality): Auto follows the connection (Very high 320 kbps on Wi-Fi, High 160 on 4G, Medium 96 on 3G, Low 48 on 2G or data saver; carries on from the same spot when the connection changes) or pin Low/Medium/High/Very high; the player's ⋯ > Quality...; downloads have their own **Download quality**. **Sleep timer:** 15m, 30m, 60m, End of song, or after 3/5/10 songs; last 30 s fade; Cancel stops it. **Resume where you left off** (songs > 60 s, stopped after 20 s and before the last 20 s; last 80 songs on this device; Settings > Playback > Resume playback); after a phone call in the Android app playback resumes by itself. **History:** Library > History (last 150 plays; search; filter Today/Yesterday/This week/Last 30 days and language; Clear last hour / today / all).

### Discovery modes

Settings > Recommendations opens with **What VinaX thinks you like** (Pick languages & artists; See the full taste profile = Library > Taste profile). **Discovery** (How far to roam): **Familiar** (about 5% of a queue someone new), **Balanced** (about 20%), **Discover** (about 45%, Home adds new languages); shares are approximate. **Trending vs. your taste** slider. **Languages:** Queue languages -> *Your languages* (playing song's language leads, others follow, never two switches in a row) or *One language*; **Pinned languages** (favoured everywhere including search); **Muted languages** (never recommended; muting unpins). **Smart Queue** > Build every queue. **Steer from a song menu:** More like this, Less like this... (7/14/30 days), Snooze this song... (7/14/30 days), Why this song?, Not interested (hides), Never play *artist* (blocks); each shows Undo. **Hearing less** lists Playing less of (end early, Unmute all), Never play, Kid mode. **Fewer repeats** next to Refresh Home rebuilds Home once without what you heard or were shown lately (memory of up to 600 songs, forgets after 45 days). **Start over:** Settings > Recommendations > Start over > Reset taste profile (also on the Taste profile page); everything on the device: Settings > Your data > Clear and reset > Reset app state (back up first).

### The personal engine (signed in)

Home opens with shelves built for you and the moment: **Made for you**, **Because you liked ... / played ...** (up to two), **More from <artist>**, **<Language> for you**, **Discover**, **Rediscover** (loved, not played for three weeks), **Morning / Afternoon / Evening / Late night picks**, **Listeners like you**, **Popular this week**, **New to you this week**; a line under each says why; VinaX AI orders shelves, writes titles, may merge two or add one for the hour/day/festival, always from songs the engine chose. Kept half an hour; **Refresh Home** (under "Explore more") asks for a new one; Kid mode pauses the engine. **Make me a playlist:** describe it ("Slow songs like the ones I liked last week", "Wedding dance songs in Telugu and Hindi", "Something new, nothing I have heard", "Late-night drive, 90s melodies"); **Play**, **Save**, or the circular arrow to rebuild; up to fifty songs; a few seconds to half a minute. **What it learns from:** what you play, finish, skip, like, un-like, mark not interested, save, queue or play from search (with how long you heard it, hour/day on your clock, which shelf); a like counts three plays; scores fade; Familiar/Balanced/Discover reach the engine too. **Switch off / erase:** Settings > Region & privacy > **Personal engine** (off stops reporting at once; on again resumes from the server's model) and **Erase my taste model** (removes events, model, built pages; device profile and account stay); deleting the account removes it all.

### Search and Discover

Search suggests as you type (↑/↓ move, Enter picks, Esc closes); tap a song to play, an artist/album to open, Enter or a suggested search for full results. Results: **Top result**, **Songs**, **Artists**, **Albums**, **Playlists** (See all); filters All/Songs/Albums/Artists/Playlists; Songs sort by relevance, popularity, newest, longest, shortest, A to Z; **Play all** / **Queue all**; *Did you mean ...?*; pinned languages sit a little higher. **Search by lyrics:** type a line (five words or more work best), **Search by lyrics** -> **Songs with those words**; **Search titles instead** goes back. **Voice search** button when speech recognition is supported. Before typing: **Recent searches** (pin up to five: pin button, or long-press on touch), **Trending searches**, **Try searching**, **Trending now**, **Browse all**. **Discover** shortcut grid (three large tiles then six smaller): Charts, Languages, Moods, Regions, Movies, Videos, Made for you, Your week, Podcasts; **Any mood, your language** below.

### App styles, themes, accents

An app style is a complete look (colours, type, shapes, navigation and mini player layout, Now Playing backdrop, motion); it never changes your music, settings or what controls do. Six styles - **Lumen** (default: clean, editorial, big titles, crimson-pink), **Verdant** (black panels, green), **Monsoon** (charcoal, teal, saffron), **Harbour** (deep navy, tall banners, cyan), **Verse** (lyrics first, coral, capsules), **Onyx** (true black, white play, red). Switch: Settings > Appearance > App style (cards are one radio group - arrow keys move; the welcome's **Pick your look** step offers the same; Help tutorial **Change the app's look**). Every style has its own dark and light look; **Black** is true black in every style; Light is frosted glass over three soft lights (style colour, second colour, playing artwork). Accent: **Style colour** (first swatch; follows the style), Marigold, Copper, Sunset, Gold, Emerald, Ocean, Azure, Violet, Rose, Mono (replace the accent in every style), **Custom accent**, **Use a preset**, **Dynamic theme** (from the playing artwork). On a festival day the festival's colours replace the style's; layout stays. With Reduce motion on (or the device asking) style changes are immediate. The choice is saved on the device and in backups. Troubleshooting: colours differ today = a festival theme (or preview) is on; the look VinaX used to have = old styles map to Lumen (Aura), Verdant (Pulse), Monsoon (Sangam), Harbour (Nocturne), Verse (Vibe), Onyx (Marquee), and the **Marigold** swatch gives the earliest look's accent; accent did not change with style = you chose an accent (pick **Style colour**, press **Use a preset** if custom); bars not see-through = Verdant, Harbour, Onyx have no glass and Monsoon keeps bars solid (in Lumen/Verse check **Glass effect** and **Background blur**; Black keeps bars solid); accent changing each song = **Dynamic theme** is on.

### Festival themes

Explore > **Festivals** (`/festivals`): today's festival as LIVE with "Day x of y" and a clock to its end, or the next one with a countdown; **Play ... songs**, **Light up the sky** (fireworks) and **Confetti**; **Share wishes**; the next eight festivals with dates and their effects (Preview, Songs); the festival switches; every look as a card (Preview, Pin, Songs). Settings > Appearance: **Festival themes**, **Festival animations**, **Festival sounds**, **Festival look** (Automatic or a pinned festival), **Preview a festival**. Tap the festival banner on Home for fireworks. See [Festival themes](#festival-themes) for the full calendar and behaviour.

### Library and backup

**Library** shortcuts: Liked songs, Listen later, Downloads, History, Your VinaX (listening in numbers, badges), Taste profile; then playlists, saved artists/albums, Smart collections (saved rules over your liked songs, playlists, Listen later, history), Listen Together, Recently deleted (deleted playlists stay 7 days), and a **Keep it with you** block with the Backup Center. Search the library; chips All/Playlists/Artists/Albums (+ tag filter); sort Recently added / A to Z; list/grid; **Create playlist**, **Import from text** (also Library > Import > Open a file for CSV/M3U/plain text); **Listen later** from the song menu (swipe left on touch); playlist menu **Remove duplicates**, **Shuffle play**; on Android the **Downloaded** chip. **Backup:** Settings > Your data > **Export a backup** (or Backup Center > Export a backup now); the file is not encrypted. **Restore:** Backup Center > Open > Choose a backup file... (nothing changes yet) > review each category vs the device > **How to apply** Merge or Replace > untick categories > optionally **Download a safety copy first** > press Merge/Replace; files over 8 MB or from a newer VinaX are refused; **Undo that restore** in the same tab; **Restore a backup (quick)** replaces without preview. Your username is re-confirmed after a restore. **Move to a new device:** Settings > Your data > Move to a new device > Create a transfer (QR code, 10-character code, six secret words); on the new device **Move from old device** on the welcome screen; encrypted on the old device, waits <= 10 minutes, destroyed on first read; replaces what is on the new device and carries identity. **Erase:** Clear history / Clear favorites (Undo), Clear queue, Reset app state; Clear cached metadata under Storage; Reset taste profile; downloads are removed from Library > Downloads.

### Flow

A full-screen feed of 30-second song previews: Home or Discover > **Flow** card > **Start** (also sidebar and command palette on wide screens; no phone tab). The settled card plays by itself starting just before a repeated lyric line (chorus) when synced lyrics exist, else about a third in; a thin line shows time left; unplayable songs are passed over; recently played/queued/skipped songs are left out. Move: swipe up/down, scroll, ↓/↑, Page Down/Up, `j`/`k`; tap or Space pauses; double-tap likes (never unlikes); Esc or the close button exits. Card actions: Like, Queue, **Play full song** (placed next; cards then stop auto-playing until you press play), **More like this** (starts a radio and opens the player), Share, ⋮ menu. Your queue is set aside while Flow is open (previews don't enter history or recommendations) and comes back paused on close. During Listen Together Flow does not change what plays (a notice links back).

### Listen Together

Open from Library > Listen Together, the player menu > Listen together, the command palette, or Home's first-visit tile. **Host:** Start a session -> 6-character code, QR code, invite link (**Share invite**, **Copy code**); play as usual from any page; only the host sees names, guests see a count; the room page shows the song, **Up next**, listener count. **Join:** open the invite link, or type the code under **Join a session** and press **Join**; your player follows the host (same song and position; drift over ~1 s catches up; VinaX adds no songs of its own while you follow); status **Live - in sync / syncing... / catching up...**. **Tap to start listening** appears when the browser wants a tap before sound (e.g. an invite link). The session survives navigation and a tab reload; a pill on every other page shows it - "Hosting - 3 listening", "Listening with Asha", "Asha went quiet" (nothing for 90 s; music keeps playing), "Reconnecting...", "Tap to start listening"; tap it to return. **Add songs and react:** guests **Add a song for everyone** (appears in both queues with "Added by <name>"; the host is told if unavailable); the host **Add to the queue**; emoji reactions under **React to the music**. **Leave or end:** guest **Leave session**; host **End for everyone** (guests told); a guest closing the tab leaves; a host closing the tab leaves the room open (guests see the host went quiet; within a day the host can type the code under Join a session to carry on). Rooms also show everyone's name, a **Chat** (last 40 lines) and **⏭** (host skips; guests vote - the song moves on once more than half the room has voted) and **Save this session as a playlist**.

### Friends and sharing

**Public profile** (Settings > Profile > Public profile): handle (3-20 letters/digits/underscores) and an optional line, **Create profile**; page at `/u/<handle>` shows your Google name and picture, line, top artists and languages, recent likes (worked out on your device and sent every half hour while the app is open); **Visible to everyone** on at creation (off = only mutual followers); **Share what I'm playing** shows friends the song for a few minutes after you play it (off by default); **Remove my profile** deletes the page and every follow both ways. **Following and Blend:** open a profile and **Follow**; followed people who share what they play appear in **Friends are listening** on Home; **Blend** builds a mix on your device from their recent likes and yours. **Shared playlists** (playlist ⋯ > Share...): *public page* (anyone with the link can play and save), *invite friends to add songs* (invite link, no account needed, their name shows beside what they added; only you remove songs), **Update the shared copy** (their additions come into your playlist first), **Stop sharing**. **Discover 5:** five unheard songs a day (Keep -> Listen Later, Skip, Play; swipe right/left on phones; a new five next day). **Songs like this** (⋯ or Player tools) queues ten similar songs; every automatic pick says why in Up next. **Release alerts:** Follow an artist and VinaX checks twice a day; new songs appear in **New from your artists** on Home and as an Android notification (a release shows after it picks up some plays); **Following** (`/following`) gathers followed artists, their new songs newest first (Dismiss each), current top songs, **Check for new songs**, **Play new songs**. **Weekly goals** (Settings > Playback > Your goal: Minutes a week, New artists a week; progress and streak on **Your VinaX**); **Your year in music > Play as a story**. **Badges** (17, worked out on your device: first song, 100/500/1,000 songs, 7/30/100-day streaks, 25 late-night/early-morning plays, three hours in a day, songs in 3 or 5 languages, 50 artists, 100 plays of one artist, 50 likes, 5 playlists, weekly goal met four weeks running): earned badges are announced, tappable with **Share**, never go away, travel in backups and sync, show on a public profile. **More:** Focus sounds (Player tools: rain, wind, deep hum, even hush with a timer), **Match the song** (Settings > Sound: EQ preset follows the song), Drive Mode voice ("play Srivalli", "next", "pause", "play something in Telugu"), playlist import, Smart downloads (Android: this week's Weekly Mix on Wi-Fi only).

### VinaX AI

Needs sign-in with Google; open from the side menu (computer), profile picture menu (phone) or `Ctrl/Cmd+K` > "VinaX AI"; music keeps playing (small player at the top; **Back to VinaX**). **Ask:** `Enter` sends, `Shift+Enter` new line; **Stop** ends a reply; four starters (Write, Learn, Code, Music) never send. A **Thinking...** line folds into **Thought for N s**. Under each reply: Copy, Retry (Auto or another model), Read aloud, Continue (when cut short), the model's name. **Edit** a question to send a new version (`< 2 / 3 >` moves between versions). **Choose a model:** the menu beside send - **Auto** (default: quick model for everyday questions, a seeing one for images, long memory for long documents/chats, a stronger one for hard problems; moves on if busy) or any model listed by group with badges (see images, web, thinking, code) and a search box (greyed = cannot answer now, with the reason); **More models** (specialists; "slow to start" can take up to a minute); **More from Groq / Gemini / OpenRouter / NVIDIA / Cloudflare** (found automatically, less tested); a model you pick is never swapped. **+ button:** Extended thinking, Web search (Auto/On/Off; numbered source chips and a Sources row), Add photos and files, Settings. **Files:** photos (PNG, JPEG, WebP, GIF; 10 per message, shrunk on your device), PDFs (30 MB, 500 pages), text/Markdown/CSV/JSON/code (2 MB); 20 files per message, 50 per chat (owner can change); if the model cannot see images a note offers one that can. **Make it yours:** the gear opens settings - General (theme, artifacts, live previews), Personalisation (what to call you, what to know about you, how to reply, reply style Normal/Concise/Explanatory/Formal/Learning; on your device, sent with each message, not saved with chats), Memory. **Memory:** short notes about lasting things across chats ("Is learning Carnatic vocals"); say "remember that..." / "forget that..."; never keeps passwords, codes, card/account numbers, emails, phone numbers, health details or things about others; Settings > Memory lists every note (**Learned from a chat** / **Added by you**), Delete, **Add a memory**, **Forget everything**; **Use memory** off = neither uses nor saves; **Learn from my chats** off = uses but doesn't save new; **Incognito chat** (hat-and-glasses on a new chat) neither uses nor adds; memory follows your account, shared links never include it, deleting a chat keeps notes learned from it. **Code, pages, charts, diagrams:** substantial output opens as a card and a panel (full screen on a phone): **Preview** (runs in a separate locked-down space), **Code**, Copy, Download, versions (`v2 of 2`, `< >`), drag the panel edge on a computer; pages/charts/diagrams also preview inline, **Fix it** asks for a correction. **Artifacts** (sidebar under New chat, or Settings > Your chats > Your artifacts): every artifact your chats made, newest first, filter chips (Pages, Components, Diagrams, Images, Documents, Code), search, **Open chat**. **Voice** (when enabled): *Dictate* (microphone in the message box, ✓ to finish, × to discard, up to two minutes; the words appear for you to check, never sent by themselves), *Read aloud* (code, links, source numbers skipped; tap again to stop), *Live voice* (with nothing typed, the sound-wave button where Send is; full-screen conversation with captions; talk over it to stop it; mic button mutes; **End**/`Esc` closes; about ten minutes a session; Model, Voice (30 voices), Language pickers work any time and keep one language unless you choose **Match how I speak**; tap the orb to stop mid-sentence; captions button; knows your typed chat, Personalisation and memory; **web search in Live voice** via the globe button / Settings; what was said is saved into the chat); Settings has the microphone with **Test microphone**, Read aloud voice, Live voice/model/language, Search the web in Live voice, Memory, Export all chats, Your artifacts, Shared links. Music pauses while the mic is open and plays on quietly during Read aloud. **Your chats:** sidebar (Starred first, then by day; ☰ on a phone); search by title and content; ⋯ Star, Rename, Move to project..., Delete (disappears at once, removed within a day); chats follow your account to every device; each has its own address; Export VinaX AI chats (Settings > Your data); deleting the account deletes everything. **Projects:** Projects in the sidebar > New project (name, short description); **Instructions** (<= 8,000 characters; every chat in the project follows them) and **Files** (<= 20 files and 200,000 characters of text) that every chat in it reads; start a chat from the project's page; move chats via ⋯ > Move to project...; Delete project removes instructions and files, chats stay unless **Delete them too**; a shared link to a project chat never shows the project's instructions/files. **Share a chat:** Share (arrow next to the gear) > **Create link** - anyone with it can read the chat as it was when made (files by name only; no reasoning or your name); **Update link** after new messages; **Copy link**, **Share...**; **Stop sharing** (Settings > Your chats > Shared links lists all); a signed-in reader can **Continue this chat** in a new chat of their own. **When something goes wrong:** a model "is busy" -> Try with Auto / another model / Retry; "VinaX AI is taking a break" = switched off for a while; "VinaX AI is unavailable right now" = no provider reachable; "Voice is busy right now" -> try later or type; "Preview needs the sandbox host" -> Code/Copy/Download still work; microphone does not start -> allow it in browser/phone settings (update the Android app if offered); "No sound is reaching VinaX AI" -> a silent/virtual microphone (e.g. BlackHole): Settings > Microphone, pick your real mic, Test microphone (in Live voice tap the mic's name). VinaX AI can make mistakes; what you send is passed to an AI provider (the privacy page names them).

### Keyboard shortcuts

Open the list with `?` (any page with the player) or Settings > Help & about > Keyboard shortcuts. Not available in the Android app. Press plain keys (no Shift).

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `→` / `←` | Forward / back 10 seconds |
| `↑` / `↓` | Volume up / down 5% |
| `n` / `p` | Next / previous song |
| `m` | Mute or unmute |
| `s` | Shuffle on or off |
| `r` | Cycle repeat |
| `f` | Like or unlike the current song |
| `?` | Show or hide the shortcut list |
| `Ctrl/Cmd + K` | Open or close the command palette (works while typing; ↑↓ move, Enter runs, Esc closes) |
| Search field: `↑` `↓`, `Enter`, `Esc` | Move through suggestions, pick/search, close |
| Now Playing: `Esc` | Leave (first press brings back hidden controls); `←`/`→`, `Home`/`End` on Up next/Lyrics/Credits tabs switch tabs; `↑`/`↓` on a queue row's handle moves it |
| Flow: `↓`/`Page Down`/`j`, `↑`/`Page Up`/`k`, `Space`, `Esc` | Next, previous, pause/play, close |
| Tours: `→`/`Enter`, `←`, `Esc` | Next step, previous, leave |
| Festival greeting / pop-up message: `Esc` | Close / dismiss newest (unless a sheet or menu is open) |
| Settings > Appearance > App style: arrow keys | Move between styles |

Keys are ignored while typing in a text field/area/drop-down and anywhere inside an open dialog; `Space`, `Enter`, arrows, `Home`, `End`, `Page Up/Down` belong to a focused button, link, slider, tab, switch, checkbox or menu item (Space on a button presses it without pausing); Ctrl/Cmd/Alt combinations are left to the browser except the palette. Mouse: right-click a song = short song menu; right-click elsewhere = app shortcuts; `Shift` + right-click = the browser's menu. Touch: swipe a song row right = add to queue, left = Listen Later; swipe Now Playing artwork = next/previous; double-tap artwork edges = +/-10 s, centre = like; pull down on Home = refresh; swipe a pop-up down = dismiss; long-press a recent search = pin.

### Android

Get the app: open VinaX in the phone browser > Home > **Get the VinaX app** (or **Take VinaX anywhere**) > **VinaX for Android** > **Download APK** > open the file and allow the install. Move your library with **Move to a new device** or export a backup in the browser and restore it in the app. The app adds background playback, media notification and lock-screen controls (play, pause, previous, next, seek), a Now Playing widget and a quick-play widget, offline downloads, lock-screen lyrics (setting), push notifications (new song picks, if turned on in Settings > Notifications > Push notifications), haptics (setting); it asks for notification permission at the end of the welcome; if a call or another app pauses the music it resumes when you return within half an hour. **Download songs:** song ⋯ > **Download** ("Saved for offline"); album/playlist **Download** (counts songs); **Remove download** from the menu or Library > Downloads; find offline music in Library > Downloads (Play all, Shuffle play), the **Downloaded** chip, or **Downloaded only** on a page; highest available quality is used; a stalled download gives up. Failure messages: No internet connection (connect and retry), This song isn't available to download (try another version), Couldn't save to your phone (free space), The download stalled (check connection), Download failed (retry). Downloaded audio stays on that phone and is never in a backup. **Updates:** checked at launch and on return; **Update available** sheet: **Update now** (downloads in-app, opens the installer, Android asks to confirm) or **Update later** (stops reminding about that version); manual: Settings > Help & about > App version > **Check for updates**; an unsupported version asks you to update; "One-time reinstall needed" walks you through saving your data file, uninstalling, installing, then Settings > Your data > Restore a backup (quick).

## Documentation conventions

This README is the only Markdown document in the repository. Write for a reader arriving today and describe what the code does now; a version number appears only where a maintainer needs it. If something cannot be checked, leave it out. Every command must exist in a `package.json`, in `frontend/scripts/`, in `backend/scripts/` or in a workflow. No third-party product, company or music-service names - describe the behaviour instead. Exceptions: host names and secret names a maintainer has to type (deployment, operations, secrets sections), package names where a developer must know them, and VinaX AI's narrow exception (AI model and provider names may appear in its model picker, the model label under each reply, the privacy page, the VinaX AI and deployment sections and nowhere else). Fix this document in the same change as the code it describes; when a section becomes a record of the past, shrink it to a line in [History](#history).

## History

Dated records (release write-ups, audits, QA reports, phase plans) that used to live in `docs/history/`, `docs/`, `frontend/docs/` and the repository root were retired in favour of this README; they described the product at the time and are available in git history. What they covered:

- **Rebuild phases (mid-2026, July-August):** a five-phase plan - Phase 1 foundation and audit (architecture decision record, catalogue/content audit, UX/flow audit phone and desktop, technical audit, privacy baseline, design-token foundation later replaced), Phase 2 core architecture and data, Phase 3 experience surfaces, Phase 4 discovery and personalisation (charts and trending pipeline notes), Phase 5 hardening, polish and launch (QA matrix, staged rollout and rollback runbook).
- **Audits and QA (2026-07 to 2026-10):** a pre-release audit of the whole repository at 1.2.0 (July 11), the August 2026 audit and UX programme with its delta audit, final report and production QA report for 4.3.0 (4.0.0-4.3.0), the 7.2 review (every finding with severity, evidence, fix, validation), and the 9.1 review (confirmed causes of repeated recommendations, live-discovery and location gaps, before/after measurements - it led to the exposure ledger).
- **Release write-ups (2026-09):** 5.31.0 verification; 6.0 "Astra" visual system; the search redesign and Operations Workspace (Discovery upgrade); 6.1 backup format, import review, lighter Home and Library tools; 6.2 AI DJ, DJ voice and AI-designed Home shelves; 6.3 arc sequencing, adaptive re-planning and Queue Builder; 6.4 personalisation pipeline audit, event weights and session state; 6.5 the DJ builds every queue, Tune this queue and Home rebuilt per open; 7.0 audit-first release (next-song pipeline, session intent, data-safe restore, a Worker security fix); the "Flow" visual redesign plan.
- **After that (summarised in the sections above):** 9.x/10.x Listen Together moved to an app-level session; 11.0 Worker pages moved to static files to protect the request quota; 13.x/14.0 the clean-sheet database, Google sign-in required, console rebuild, usage sharing on by default and advertising removed; 15.0 the six new app styles, friends/sharing/daily discovery and the 43 festival skins; the V2 line (1.x): VinaX AI, the personal engine, music AI, song reactions, app language, Following.
- Anything needed to operate the product today is kept in the sections above; the old files were not kept up to date and may name features, paths and versions that no longer exist.
