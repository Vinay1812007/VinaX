# Architecture

This document names the pieces of VinaX and shows how data moves between them: the app shell and its routes, the stores and how they persist, the catalogue client, the audio engine with its media session and native bridge, the service worker, the Worker's routes and the owner console. It describes the code as it is on the `upgrade/7.1` branch. Deep dives live in [recommendations.md](recommendations.md), [ai.md](ai.md), [data-and-privacy.md](data-and-privacy.md), [design-system.md](design-system.md), [android.md](android.md) and [admin-console.md](admin-console.md).

## The pieces

```text
 Browser or Android shell
┌──────────────────────────────────────────────────────────────────────┐
│ frontend/  (static single-page app)                                  │
│                                                                      │
│  main.tsx ─ App ─ router ─ AppLayout ─ lazy page chunks              │
│                              │                                       │
│        stores (src/store) ───┼── guarded localStorage ("vinax.*")    │
│                              │   IndexedDB event log                 │
│        recommendation engine ┤                                       │
│        catalogue client ─────┼──► catalogue bases (fallback ladder)  │
│        AI clients ───────────┼──► /api/dj  /api/curate  /api/playlist│
│        audio engine ─────────┼──► one <audio> element ─► audio CDN   │
│        media session ────────┼──► browser media session              │
│                              └──► native media plugin (Android)      │
│  public/sw.js   shell cache, asset precache, offline audio           │
│  public/admin/  owner console (separate static page)                 │
└──────────────────────────────────────────────────────────────────────┘
                │ same origin                         
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ backend/worker  (edge Worker "vinax-api")                            │
│  host middleware ─ exact routes ─ dynamic routes ─ /api/cat/* ─ hubs │
│  anything unmatched ─► the static site                               │
│  /api/*  AI lanes, catalogue proxy, events, push, rooms, admin       │
│  /song /album /artist /playlist  edge-rendered pages for crawlers    │
│  /sitemap*  /img  /apk                                               │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend is a static build. The Worker owns every dynamic URL on the same domain, so the app calls same-origin paths and needs no cross-origin setup on the web. The Android app runs the same bundle from a local origin, so its clients call the production origin by absolute URL (see `isNativePlatform()` checks in `src/services/ai/*.ts` and `src/services/analytics/telemetry.ts`).

| Layer | Packages (from `frontend/package.json` and `backend/package.json`) |
| --- | --- |
| UI | `react` 19, `react-router-dom` 6, `tailwindcss` 3 plus hand-written token CSS |
| State | `zustand` 4 with its `persist` middleware; `@tanstack/react-query` 5 for catalogue reads |
| Build | `vite` 8, `typescript` 5; `vitest` 4 for unit tests; `playwright-core` for browser tests |
| Android | `@capacitor/*` 8 plus four Java files in `frontend/native-android/` |
| Backend | One Worker deployed with `wrangler` 4; no framework |

## App shell

`src/main.tsx` runs in this order:

1. Imports `services/storage/earlyMigrations` first, so renamed storage keys are in place before any store rehydrates.
2. Renders `<App />` and loads the four style sheets: `index.css`, `flow.css`, `discovery.css`, `festivals.css`.
3. Removes the `boot-still` class after the first painted frame, and clears the boot-recovery counters in `sessionStorage`.
4. Listens for `vite:preloadError`. When a lazy chunk fails to load after a deploy, the page reloads once per session. It does not reload when offline.
5. Sets `device-phone|tablet|desktop|tv` and `pointer-coarse|pointer-fine` classes on `<html>`, so styles can key on capability instead of width alone.
6. Registers `/sw.js` in production builds on the web, and asks it to precache the full asset graph on every boot and whenever the network returns.

`src/layouts/AppLayout.tsx` is the frame for every route except VinaX AI. It renders the sidebar (wide screens), the top bar, the routed page inside an error boundary, the player bar and the five-destination dock (phones), the now-playing rail on wide workspaces, toasts, the welcome sheet and the command palette. It also runs the one-time bootstrap: storage migrations, `initEngine()` on the player store, downloads, telemetry (consent-gated), lock-screen lyrics, TV spatial navigation, the alarm, the output watcher, the DJ voice and cast. A module-level flag keeps that bootstrap from running again when the layout remounts after a visit to `/VinaXAI`.

The layout also owns scroll memory per history entry, hardware-back handling for overlays, and the wheel rescue described in [design-system.md](design-system.md#overlays).

## Routing and lazy chunks

`src/router/index.tsx` builds one browser router with two top-level entries:

- `/VinaXAI` renders the VinaX AI page on its own, outside `AppLayout`.
- `/` renders `AppLayout` with every other page as a child.

Every page is imported with `lazy()`, so each page is its own chunk. Language hub pages (`/<language>-songs`) and mood hub pages (`/<language>-<mood>-songs`) are generated from `constants/languages.ts` and `constants/hubs.ts`. Two redirects run before the router is created: an offline Android boot with saved downloads opens `/offline`, and the "Startup page" setting can open Search, Library or the last main route.

Heavy shell parts are lazy too: the welcome sheet, the now-playing rail, the next-up card, the What's New sheet, the festival splash, the command palette and the recommendation debug panel.

`vite.config.ts` groups first-load code into named chunks (`router`, `vendor`, `data`, `core`). The `core` group lists small modules that are already in the first-load graph, by explicit path. See [testing.md](testing.md#the-bundle-budget) before adding to it.

## Stores and persistence

State lives in `zustand` stores under `src/store/`. The persisted ones and their keys:

| Store | Key | Holds |
| --- | --- | --- |
| `playerStore` | `vinax.player.v1` | queue, index, repeat, shuffle, volume, muted, rate |
| `settingsStore` | `vinax.settings.v1` | every preference |
| `libraryStore` | `vinax.library.v1` | favourites, playlists, Listen Later, saved albums and artists, hidden songs |
| `historyStore` | `vinax.history.v1` | the last 150 plays |
| `searchStore`, `searchWorkspaceStore` | `vinax.search.v1`, `vinax.search.workspace.v1` | recent, pinned and saved searches |
| `smartCollectionStore`, `bookmarkStore`, `downloadsStore`, `alarmStore`, `outputStore`, `lyricsOffsetStore` | their own `vinax.*` keys | what their names say |

The taste profile is not a store. `src/services/personalization/` reads and writes `vinax.profile.v1` (and `vinax.profile.kid.v1` in Kid mode) directly. `src/constants/storage-keys.ts` is the registry of key names. A listen-event log lives in IndexedDB (`services/storage/idb.ts`).

All persisted stores write through `src/services/storage/local.ts`. Three rules live there:

**Guarded storage.** `guardedLocalStorage` wraps `window.localStorage`. Reads never throw. A write that fails because the device is full shows one toast per session ("Storage is full — recent changes may not be saved") instead of throwing into a store's `set`.

**Write freeze.** A restore writes the listener's data straight into `localStorage` and then reloads. Until the reload, every live store still holds the old state and would persist it over the restored keys on its next `set`. `freezeLocalWrites()` flips a page-lifetime flag; after it, every store-driven write and remove is dropped. Only `writeLocalBatch()` — the restore itself — still writes. The reload clears the flag.

**De-duplicated player persistence.** The persist middleware writes on every `set`, and playback progress calls `set` several times a second. `createDedupedStorage()` compares each persisted field by reference against the last state that was actually written and skips the write when nothing changed. A refused write is not remembered, so it is retried on the next change. Only the player store uses it.

`writeLocalBatch()` is the all-or-nothing writer used by restore, undo and device transfer. It writes entries in order, and if any write throws it puts every touched key back and reports the failure.

On rehydrate, the player store treats its record as untrusted input: malformed songs are dropped and scalar fields are clamped (`merge` in `playerStore.ts`).

## Catalogue client

Catalogue reads go through `orchestratedRequest()` in `src/services/api/client.ts`. Callers (the domain modules next to it in `src/services/api/`) pass path candidates and a validator; pages call them through `@tanstack/react-query` with `retry: 0`, a 5-minute stale time and a 30-minute cache time (`services/queryClient.ts`), because retrying is the orchestrator's job.

**The fallback ladder.** `constants/endpoints.ts` lists the catalogue bases: a dedicated catalogue API host, the same-origin Worker catalogue at `/api/cat` (web only), and the production origin's `/api/cat`. `VITE_API_BASES` replaces the list at build time, and the owner console can switch individual bases off (`setDisabledSources`). For each request the client:

1. Ranks the bases with the in-memory health registry (`services/api/health.ts`): a smoothed success rate, minus a latency penalty, minus a penalty per consecutive failure. Three failures in a row put a base in a 60-second cooldown; cooling bases go to the back, and are still tried when every base is cooling.
2. Walks each base, trying each path dialect the caller listed.
3. Runs the caller's validator on the payload. A payload the validator rejects is a soft miss: the next dialect is tried and the base takes no health strike. An HTTP 404 is treated the same way — the route is missing there, the base is not down.
4. On any other failure records a health strike and moves to the next base.
5. Makes up to two full passes, pausing 600 ms before the second.

**Deadlines.** Each attempt has an 8-second timeout (`REQUEST_TIMEOUT_MS`). The whole ladder has a 20-second budget (`REQUEST_DEADLINE_MS`, overridable per request). The last attempt before the deadline only gets the time that is left, and an attempt cut short by the deadline does not count against the base's health.

**Cancellation.** Callers pass the query's `AbortSignal`. A cancel aborts the in-flight fetch, ends a backoff pause early, stops the ladder and is never recorded as a failure. `fetchWithTimeout()` gives the same guarantees to same-origin helpers outside the ladder.

**Boot prefetch.** `index.html` starts the first trending request from an inline script and parks the promise on `window.__vxBoot`. The first matching `fetchJson` call consumes it; any mismatch or failure falls through to the network.

Payloads are normalised in `services/api/normalize.ts`. The catalogue API describes artists as `artists: { primary: [...] }`; the app's own `Song` type, and everything it persists, uses a flat `artists: [...]`.

## Audio engine, media session and native bridge

`src/services/audio/engine.ts` exports one `audioEngine` that owns a single `<audio>` element. The player store is its only consumer and receives time, play state, buffering, ended, fatal-error, source and autoplay-blocked callbacks.

- Sources are ordered by numeric bitrate against the listener's quality preference (`orderedSources`). A downloaded copy is tried first (`getOfflineSources`).
- A source that fails advances to the next variant. A source that had been playing gets one same-position retry before stepping down (`recoveryAction`), which covers output hand-offs such as a wireless headset reconnecting.
- A stall timer, fades (sleep timer, alarm), playback rate, output-device selection (`setSinkId`) and next-track preloading live here. Effects (equaliser and related) are wired through `effects.ts` and can be bypassed.

`src/services/media-session/index.ts` publishes metadata, playback state and position, and receives play, pause, next, previous and seek actions. On the web it uses the browser's media session. On Android it talks to the app's own plugin, registered as `VinaxMedia` and implemented in `frontend/native-android/VinaxMediaPlugin.java`, which drives a foreground media service (`VinaxMediaService.java`) for the notification, lock screen, headset buttons and car browsing. It keeps a 12-entry call log for the diagnostics screen. `lockscreenLyrics.ts` can put the current lyric line into the metadata.

`src/services/native/index.ts` is the small bridge for everything else native: platform checks, notification permission, and helpers used by downloads and updates. [android.md](android.md) covers the native side.

## Service worker

`frontend/public/sw.js` is hand-written and conservative:

| Request | Strategy |
| --- | --- |
| Page navigations the app answers | Network first; the cached shell when offline |
| Hashed build assets under `/assets/` | Cache first (they never change) |
| `/offline-audio/<id>` | Served from the `vinax-audio-v1` cache with Range support, so downloaded songs can seek |
| Catalogue APIs, artwork, audio streams, `/api/*`, `/admin/`, the status page | Passed through, never cached |

The build emits `/precache-manifest.json` (a small plugin in `vite.config.ts`). On install, and on every `PRECACHE` message from the app, the worker downloads every listed asset, refreshes the shell entries and prunes assets that left the manifest. The audio cache is never cleared on activate. The worker also shows push notifications and routes their clicks.

## Worker routes

`backend/worker/index.ts` is a router plus an adapter that gives each handler the context shape `{ request, env, params, next, waitUntil, data }`. Resolution order:

1. Host middleware (`functions/_middleware.ts`): the apex host redirects to `www`, the `update.` host redirects to the APK download, the `admin.` host redirects to `/admin/`.
2. An exact-path table for every `/api/**` handler, `/apk`, `/img` and the sitemaps. A test (`worker/__tests__/routerCoverage.test.ts`) fails when a handler file has no entry.
3. Dynamic entity routes: `/song/:id`, `/album/:id`, `/artist/:id`, `/playlist/:id`, `/sitemaps/:map`.
4. `/api/cat/*`, the self-hosted catalogue. It speaks the same route dialect as the other catalogue bases. Stream URLs are resolved at play time and answered with a redirect, so audio bytes do not pass through the Worker.
5. Single-segment paths go to the hub allow-list (`functions/[hub].ts`).
6. Anything else is fetched from the static site named by `ASSETS_HOST` in `wrangler.toml`.

A matched module with no handler for the request method answers `405`.

| Route family | Purpose |
| --- | --- |
| `/api/dj`, `/api/curate`, `/api/playlist`, `/api/vinaxai`, `/api/aimodels`, `/api/assistant`, `/api/tts`, `/api/voices`, `/api/lyrics-tools`, `/api/image` | AI features — see [ai.md](ai.md) |
| `/api/cat/*`, `/api/preview`, `/api/trending-searches`, `/api/blocklist` | Catalogue and content |
| `/api/events`, `/api/feedback`, `/api/geo`, `/api/username`, `/api/handoff`, `/api/room` | Consent-gated telemetry, feedback, coarse region, username claims, device transfer relay, Listen Together rooms |
| `/api/appconfig`, `/api/experiments`, `/api/announcements`, `/api/site-mode`, `/api/version`, `/api/status`, `/api/apk` | Published client configuration, flags, announcements, maintenance mode, version, status probes, Android update source |
| `/api/push/*`, `/api/cron/*` | Push subscription and the scheduled jobs the workflows call with `x-cron-secret` |
| `/api/admin/*` | Owner console data and actions, all behind server-side admin auth — see [admin-console.md](admin-console.md) |

## Owner console

`frontend/public/admin/` is a separate static page (plain scripts, no build step) that ships inside the frontend build and is served at `/admin/`. It holds no secrets. Every read and write goes to `/api/admin/*`, where the Worker checks the admin session on each request. What the owner publishes there — feature flags, the Home layout, banners, search synonyms, disabled catalogue bases, announcements — reaches the app through `/api/appconfig` and related public routes, which the app reads with a 5-minute stale time (`features/home/useAppConfig.ts`). [admin-console.md](admin-console.md) has the details.

## How a play flows

1. The listener taps a song. The page calls `playQueue()` on the player store.
2. The store runs the intake gates (Kid mode drops explicit songs, duplicates of the same song collapse into one slot), loads the song into the audio engine and publishes it to the media session.
3. With "DJ builds every queue" on, the store asks the recommendation engine for a continuation: the next five songs, in the seed song's language, familiar first. The on-device order is ready at once; the AI DJ may re-order or propose within a bounded wait and the result passes the same final validation. See [recommendations.md](recommendations.md).
4. A play counts toward the taste profile once five seconds of it have been heard (`COUNTED_PLAY_SEC`). A song flipped past before that is marked skipped in history and in the session signals, and the long-term profile is left alone.
5. Persisted player fields change (queue, index), so the de-duplicated storage writes once. Progress ticks do not write.
