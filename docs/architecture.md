# Architecture

This document is a map of VinaX: the two deployed services, the app shell and its routes, how the look is applied (app style, theme, accent, festival skin, and the chat styles of VinaX AI), the stores and how they persist, the catalogue client, the audio engine with its media session and native bridge, Listen Together, the service worker, the Worker's routes and the owner console. Each section names the files to open.

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
│  hub pages (/<lang>-<mood>-songs)  edge-rendered for crawlers        │
│  /sitemap*  /img  /apk                                               │
└──────────────────────────────────────────────────────────────────────┘
```

VinaX deploys as two services: the static site and the Worker. The frontend is a static build. The Worker owns every dynamic URL on the same domain, so the app calls same-origin paths and needs no cross-origin setup on the web. The Android app runs the same bundle from a local origin, so its clients call the production origin by absolute URL (see `isNativePlatform()` checks in `src/services/ai/*.ts` and `src/services/analytics/telemetry.ts`).

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
2. Renders `<App />` and loads the five global style sheets in this order: `index.css` (tokens and base primitives), `shell.css` (the frame and shared primitives), `features.css` (a few global feature surfaces), `templates/index.css` (the app styles) and `festivals.css` (generated festival skins). Page styles in `styles/pages/` ship with their lazy page.
3. Removes the `boot-still` class after the first painted frame, and clears the boot-recovery counters in `sessionStorage`.
4. Listens for `vite:preloadError`. When a lazy chunk fails to load after a deploy, the page reloads once per session. It does not reload when offline.
5. Sets `device-phone|tablet|desktop|tv` and `pointer-coarse|pointer-fine` classes on `<html>`, so styles can key on capability instead of width alone.
6. Registers `/sw.js` in production builds on the web, and asks it to precache the full asset graph on every boot and whenever the network returns.

`src/layouts/AppLayout.tsx` is the frame for every route except VinaX AI. It renders the sidebar (from 768px; always the 80px rail below 1100px), the top bar, the routed page inside an error boundary (the workspace is a rounded sheet inside the chrome), the player (a compact card above the five-destination tab bar on phones and tablets, the floating deck from 1024px), the Now Playing panel on wide workspaces, snackbars (`components/Toasts.tsx`), the welcome sheet, the command palette and — only while a Listen Together session is live — the lazily loaded `TogetherController` (see [Listen Together](#listen-together)). It also runs the one-time bootstrap: storage migrations, `initEngine()` on the player store, downloads, telemetry (consent-gated), lock-screen lyrics, TV spatial navigation, the alarm, the output watcher, the DJ voice and cast. A module-level flag keeps that bootstrap from running again when the layout remounts after a visit to `/VinaXAI`.

The layout also owns scroll memory per history entry, hardware-back handling for overlays, and the wheel rescue described in [design-system.md](design-system.md#overlays).

## The look: app style, theme, accent, festival

Four settings and the calendar decide how the app is painted. The rules are in [design-system.md](design-system.md); this is the path the data takes.

```text
settingsStore (vinax.settings.v1): template, theme, accent, accentCustom, dynamicTheme, highContrast
      │
      ├─ before first paint: inline script in frontend/index.html
      │     reads the stored settings ─► html[data-template], theme classes, canvas colour,
      │     and html.fest-<id> from the inlined festival window table
      │
      └─ at run time: an effect in src/layouts/AppLayout.tsx
            resolveTheme(pref) ─► applyThemeClasses(resolved, root, template)   (src/utils/theme.ts)
                 .light / .dark / .amoled, data-template, <html> background, theme-color meta
            data-accent, or a custom ramp from src/utils/accentRamp.ts
            ▼
      CSS: styles/index.css ─► shell.css ─► features.css ─► templates/ ─► festivals.css ─► lazy pages/*.css
```

- **App style.** `src/constants/templates.ts` lists the six styles; `TEMPLATE_CANVAS` in `utils/theme.ts` and the table in the pre-paint script hold each style's canvas and must agree. `src/features/settings/TemplatePicker.tsx` writes the setting; the welcome sheet's "Pick your look" step writes the same one. The setting is part of a backup.
- **Festival.** `src/constants/festivals.ts` holds the dates, `festivalThemes.ts` the palettes, `festivalVisuals.ts` and `festivalEmblems.ts` the emblem, particles, blurb and search query. `npm run gen:festivals` turns them into `src/styles/festivals.css`, `public/admin/festivals.js` and the window table in `index.html`. At run time `components/FestiveSplash.tsx` shows the greeting card, `features/home/FestivalBanner.tsx` the Home strip, `features/festival/festivalPreview.ts` the session-only preview, and `services/recommendation/festival.ts` lets the date inform picks.
- **VinaX AI chat styles.** The chat page is outside `AppLayout` and has a second, scoped layer: `src/features/ai/chat/chatStyle.ts` maps the selected model's maker family to one of nine styles, `ChatStyleScope.tsx` writes `data-chat-style` and the `data-cs-*` layout attributes on `.ai-root` and `.ai-scope`, and `src/styles/ai-styles.css` styles only those. The preference is stored under `vinax.ai.chatStyle`.

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

1. **Allots** the request across the bases with the in-memory health registry (`services/api/health.ts`). Each base is ranked by its **expected time to success**: its latency average (an exponentially weighted mean of answer times), plus the odds of failing — a recency-weighted success rate, smoothed so a fresh base counts as 50/50 — times what a failure costs (at least 2 s, or the base's own latency), stretched by half again for each consecutive failure. A fast base that fails half the time therefore ranks behind a slower one that always answers. Bases with a free slot come first, full ones next, cooling ones last. Three failures in a row cool a base for 60 seconds; all bases are still tried when every one is cooling.
2. Picks the order by **priority** (`RequestPriority`, set by the caller):
   - `interactive` — the Search page, the typeahead and song lookups (`getSong`): best base first, **hedged**. If that base has not answered within its own p75 answer time (the latency average plus 0.675 of its deviation, bounded to 350–900 ms), the same request starts on the next base; the first valid answer wins and the other is aborted. An aborted loser counts as slow, never as failed. One hedge per pass.
   - `background` — shelves, recommendations and prefetch (the default for catalogue searches): the first base is **drawn at random, weighted by health** (1 / expected time) among the ready ones, so prefetch traffic spreads instead of queueing on the top base; the rest follow in rank order. Never hedged.
   - `standard` — everything else: best base first, no hedge.
3. Honours **back-off**. A 429 or 503 cools that base for its `Retry-After` (seconds or an HTTP date; 30 s when missing, clamped to 1 s–10 min), counts as a failure, and moves the call on; a base that asked to back off gets no new calls until then, unless it is the only one left.
4. Caps **concurrency**: at most six requests in flight per base. When a base is full a caller waits for a slot, and interactive callers are queued ahead of background ones; a cancelled caller leaves the queue.
5. Walks each allotted base, trying each path dialect the caller listed, and runs the caller's validator on the payload. A payload the validator rejects is a soft miss: the next dialect is tried and the base takes no health strike. An HTTP 404 is treated the same way — the route is missing there, the base is not down. Any other failure records a health strike and moves to the next base.
6. Makes up to two full passes, pausing 600 ms before the second.

**Sharing identical calls.** A caller can pass `cacheMs`. Catalogue searches and song lookups use 5 seconds (`SEARCH_MEMO_MS`): identical requests in flight at the same time share one network call (each caller can still cancel its own share; the call is aborted only when every sharer has left), and an answer is reused for 5 seconds (at most 40 kept). This is what lets the Search page's typeahead and its All tab ask the same combined search once.

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

## Listen Together

Before 10.0 a session lived in the Listen Together page's component state: a host who opened Search to pick the next song, or a guest who opened the lyrics, unmounted the page, and the host stopped broadcasting or the guest stopped following, with nothing on screen saying so. A reload lost the room. 10.0 moves the session to the app.

| Piece | File | Role |
| --- | --- | --- |
| Session store | `services/together/session.ts` (`useTogether`) | Tiny and first-load: mode (`idle`, `host`, `guest`), room code, status (`connecting`, `live`, `reconnecting`, `host-away`), host name, member names (host only), listener count, the shared queue, the host's song, the guest's measured drift, `needsTap` and floating reactions. Mode and code are kept in `sessionStorage` (`vinax.together.session.v1`), so a reload of the tab rejoins; closing the tab forgets the session on that device (a guest's tab sends a leave beacon; a host's closed tab does not end the room, and guests are told the host went quiet after 90 seconds) |
| Controller | `features/together/TogetherController.tsx` | Mounted lazily by `AppLayout` whenever the mode is not `idle`. Starts the engine for the whole app and, on every page except `/together`, shows the **Live pill**: "Hosting · N listening", "Listening with <host>", "<host> went quiet" or "Reconnecting…", with the room code, linking back to the room. When `needsTap` is set it becomes a **Tap to start listening** button |
| Engine | `features/together/engine.ts` | `runSession(mode, code)` returns a stop function. `startHosting`, `joinSession`, `leaveSession`, `addSong`, `react`, `tapToListen` are what the page calls |
| Sync arithmetic | `features/together/sync.ts` | Pure and unit-tested: `HostClock`, `decideCorrection`, `hostIsAway`, `ReactionFeed` |
| Room API | `services/together/index.ts` → `GET`/`POST /api/room` | Create, update, request, heartbeat, react, leave (also as a `sendBeacon` on tab close), end. `updateRoom` now reports `gone` (404) and `forbidden` (403) instead of swallowing them, and `requestSong` resolves true only when the server stored the request |

**Host.** The engine subscribes to the player store and pushes the playing song, its position, play state and the next eight songs (`updateRoom`) whenever the song, play state, queue length or index changes, or the position jumps by more than two seconds against natural progress (a seek). One push is in flight at a time; a change during it schedules exactly one more. Every four seconds it polls the room (members, reactions, guest requests) and pushes again as a keep-alive. A guest's request arrives as an id, title and picture only; the host looks the full song up (`getSong`, cached) before queueing it, so the request is playable, and says so in a snackbar when a song is not available. A `gone` or `forbidden` push ends the session on that device with a message.

**Guest.** The engine turns on the player's follow mode (no automatic queue building), polls every two seconds and heartbeats on every third poll. `GET /api/room` returns the server's clock as `now`; the host's `updated_at` is stamped by the same clock, so `HostClock` projects the host's playhead as `position + (now − updated_at) + half the measured round trip`, without comparing two devices' clocks (a Worker older than 10.0 sends no `now`, and the old anchor is used). `decideCorrection` then loads the host's song if it differs, matches play or pause, and seeks only when the drift exceeds 1.0 s while playing (2.0 s while paused), never while buffering, never within 3 s of the last correction or 1.5 s of a track start, and never past the end of the song. If the host is playing and two play attempts have not started audio (the browser wants a gesture, typically after an invite link), `needsTap` is raised and the pill and the room show **Tap to start listening**; `tapToListen()` runs inside that tap. No host push for 90 seconds by the server's clock marks the host as away; it is a note, not a disconnect. A room that no longer exists ends the session with "The host ended the session".

**Reactions.** Each poll returns the last few seconds of reactions; `ReactionFeed` identifies them by stamp and emoji instead of comparing server time with the device clock, primes on the first poll so nothing from before you arrived floats, and skips the echo of your own tap.

**Server.** `functions/api/room.ts` keeps rooms and members in the database. It sizes its per-address rate limits for a room on one Wi-Fi (about six devices behind one address: 200 GETs, 90 heartbeats, 60 updates, 30 requests and 30 reactions a minute), and when the database lacks the atomic request-append function it falls back to a read-modify-write instead of failing every guest request.

## Service worker

`frontend/public/sw.js` is hand-written and conservative:

| Request | Strategy |
| --- | --- |
| Page navigations the app answers | Network first; the cached shell when offline |
| Hashed build assets under `/assets/` | Cache first (they never change) |
| `/offline-audio/<id>` | Served from the `vinax-audio-v1` cache with Range support, so downloaded songs can seek |
| Catalogue APIs, artwork, audio streams, `/api/*`, `/admin/`, the status page | Passed through, never cached |

The build emits `/precache-manifest.json` (a small plugin in `vite.config.ts`) with two lists. `precache` is everything reachable from the entry without passing through the diagram and maths engines behind VinaX AI replies; `onDemand` is those engines, what only they reach, and the maths typeface. On install, and on every `PRECACHE` message from the app, the worker downloads the `precache` list, refreshes the shell entries and prunes assets that are in neither list. On-demand assets are cached by the `/assets/` handler the first time a reply needs them. Measured on the 7.2 build: 624 KB gzip precached instead of 2,476 KB. The audio cache is never cleared on activate. The worker also shows push notifications and routes their clicks.

## Worker routes

`backend/worker/index.ts` is a router plus an adapter that gives each handler the context shape `{ request, env, params, next, waitUntil, data }`. Resolution order:

1. Host middleware (`functions/_middleware.ts`): the apex host redirects to `www` (a fallback only: since 11.0.3 the apex is not a Worker route and the static site's `_redirects` does that redirect), the `update.` host redirects to the APK download, the `admin.` host redirects to `/admin/`.
2. An exact-path table for every `/api/**` handler, `/apk`, `/img` and the sitemaps. A test (`worker/__tests__/routerCoverage.test.ts`) fails when a handler file has no entry.
3. Dynamic entity routes: `/song/:id`, `/album/:id`, `/artist/:id`, `/playlist/:id`, `/sitemaps/:map`. Since 11.0.2 the first four are not Worker routes in `wrangler.toml`, so production never sends them here: the static site serves them as the ordinary app. The handlers remain for the day the routes come back.
4. `/api/cat/*`, the self-hosted catalogue. It speaks the same route dialect as the other catalogue bases. Stream URLs are resolved at play time and answered with a redirect, so audio bytes do not pass through the Worker.
5. Single-segment paths go to the hub allow-list (`functions/[hub].ts`).
6. Anything else is fetched from the static site named by `ASSETS_HOST` in `wrangler.toml`.

A matched module with no handler for the request method answers `405`.

| Route family | Purpose |
| --- | --- |
| `/api/dj`, `/api/curate`, `/api/playlist`, `/api/vinaxai`, `/api/aimodels`, `/api/assistant`, `/api/tts`, `/api/voices`, `/api/lyrics-tools`, `/api/image`, `/api/embed` (8.2) | AI features — see [ai.md](ai.md) |
| `/api/cat/*`, `/api/preview`, `/api/trending-searches`, `/api/blocklist` | Catalogue and content |
| `/api/events`, `/api/feedback`, `/api/geo`, `/api/username`, `/api/handoff`, `/api/room` | Consent-gated telemetry, feedback, coarse region, username claims, device transfer relay, Listen Together rooms |
| `/api/appconfig`, `/api/experiments`, `/api/announcements`, `/api/site-mode`, `/api/version`, `/api/status`, `/api/apk` | Published client configuration, flags, announcements, maintenance mode, version, status probes, Android update source |
| `/api/push/*`, `/api/cron/*` | Push subscription and the scheduled jobs the workflows call with `x-cron-secret` |
| `/api/admin/*` | Owner console data and actions, all behind server-side admin auth — see [admin-console.md](admin-console.md). A failed database read answers `502` with its kind (unavailable, unauthorized, schema missing, bad request), never an empty `200`; every database request has a deadline (`_lib/supabase.ts`). |

## Owner console

`frontend/public/admin/` is a separate static page (plain scripts, no build step) that ships inside the frontend build and is served at `/admin/`. It holds no secrets. `index.html` carries the frame (a `<header id="topbar">` and the section workspace), `console.css` the styling, and `app.js` publishes shared helpers on `window.VXA` (`stateLoading`, `stateEmpty`, `stateError`, `toast`, `esc`, `html`) that the section scripts in `sections/` use for their loading, empty and error states and their notices. Every read and write goes to `/api/admin/*`, where the Worker checks the admin session on each request. What the owner publishes there — feature flags, the Home layout, banners, search synonyms, disabled catalogue bases, announcements — reaches the app through `/api/appconfig` and related public routes, which the app reads with a 5-minute stale time (`features/home/useAppConfig.ts`). [admin-console.md](admin-console.md) has the details.

## How a play flows

1. The listener taps a song. The page calls `playQueue()` on the player store.
2. The store runs the intake gates (Kid mode drops explicit songs, duplicates of the same song collapse into one slot), starts a playback instance, loads the song into the audio engine and publishes it to the media session.
3. With "DJ builds every queue" on, the store loads the recommendation engine (a lazy chunk) and asks it for a plan: the next five songs, in the seed song's language, familiar first, built on the device inside one deadline. The songs pass the admission gate and are appended; the AI DJ's order may later refine the automatic entries that have not started. See [recommendations.md](recommendations.md).
4. The playback instance measures what is heard. A play counts toward the taste profile once five seconds of it have been heard; seeks, pauses and buffering add nothing. A song left before that is marked skipped in history and in the session signals, and the long-term profile is left alone.
5. Persisted player fields change (queue, index), so the de-duplicated storage writes once. Progress ticks do not write.

## Three data flows

**Listening events become taste.**

```text
<audio> time updates ─► playback instance (heard seconds; declared seeks, pauses, buffering excluded)
   ├─ PLAY / SKIP / COMPLETE (one each per run) ─► personalization/updater ─► vinax.profile.v1
   ├─ early leave / skip / complete ─► session intent (this sitting only)
   └─ playback events: counted · credit · end · served · refined
        ├─ listen clock ─► history entry listenedSec
        ├─ transition memory (hand-off verdict from heard time)
        └─ opt-in usage analytics (only with consent)
```

**Candidates become the next five.**

```text
seed song ─► candidates (inside the plan's deadline) ─► hard filter ─► classifier metadata (bounded)
  ─► scoring and ranking ─► sequencer (arc, familiar first, one language) ─► validation
  ─► plan.songs ─► admission gate (current state) ─► queue ─► plan.commit(accepted)
                 └─ plan.refinement (AI DJ, bounded) ─► validation ─► gate ─► automatic entries not yet started
```

**Owner settings reach clients.** The console writes one row per key through `/api/admin/*` (server-side auth on every request, an audit row per change); the app reads them through `/api/appconfig` and related public routes, sanitised again on the way out and cached for up to a few minutes. [admin-console.md](admin-console.md) has the table of keys.
