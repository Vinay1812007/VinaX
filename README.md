# VinaX

VinaX is a music app with no login: it plays from a public catalogue, learns a listener's taste on their own device, and builds what plays next from that. It ships as a web app and an Android app from one codebase, with an edge Worker behind it for the catalogue gateway, AI features and the owner console.

This README covers what the product does as of 7.1, how to run it locally in five minutes, where things are in the repository, how personalisation and privacy work in brief, the validation commands, how a release reaches production, and links to every other document.

[Documentation index](docs/README.md) · [User guide](docs/user-guide/README.md) · [Deployment](DEPLOYMENT.md)

## Features

| Area | What a listener can do |
| --- | --- |
| Five destinations | Home, Discover, Search, Library and VinaX AI sit in the dock on phones and in the sidebar on wide screens. The top bar shows where you are on the left and the page's actions on the right; it has no search box. |
| Home | A greeting, an Aura Mix, shelves built from taste and the catalogue, "Trending for you" (real trending songs put in the listener's order), optional AI-designed shelves, and Home Studio to reorder or hide shelves. |
| Discover | A shortcut grid — Charts, Languages, Moods, Regions, Movies, Videos, Made For You, Your Week, AI Playlist, Ads — then trending, mood, new-release and film shelves for a chosen language. |
| Search | Its own page and field. Understands "song + singer" and Indic scripts, tolerates misspellings, and offers trending, recent, pinned and saved searches. |
| The next five | Tap any song and the DJ builds the next five songs in that song's language, the most familiar hand-off first and newer artists later. More arrive as the queue runs down. |
| Steering the queue | **Pin a mood** (full-screen player) and **Tune this queue** (Queue page and player) fetch songs for that choice and rebuild Up Next at once. Songs queued by hand always go ahead of automatic picks and survive a rebuild. |
| Discovery modes | Familiar, Balanced or Discover in Settings → Recommendations changes ranking and how many never-played artists a queue admits. |
| Player | Queue with reorder and Queue Builder, synced lyrics where available, sleep timer, crossfade, sound settings, DJ voice, lock-screen and headset controls, casting, a drive mode and karaoke. |
| Library | Favourites, playlists with search and multi-select edits, Listen Later, smart collections, history, listening stats and recap, downloads (Android). |
| Backup | Export one file from Settings → Your Data. The Backup Center previews a file, restores by merge or replace, and offers Undo. "Move to a new device" transfers everything through an encrypted one-use hand-off. |
| VinaX AI | A chat that knows the listener's taste summary, can play music from the conversation, accepts attachments and offers a choice of models. AI Playlist turns a description into a playlist of catalogue-verified songs. |
| Together | Listening rooms with a shared queue and a room code. |
| Android | The same app with a native media service, home-screen widgets, downloads, background notifications and in-app updates. |
| Accessibility and comfort | Keyboard shortcuts, reduced motion, themes, display size, high contrast, Kid mode, app language. |

Music and AI results depend on the catalogue and the AI lanes configured for the deployment. When AI is slow, down or not configured, every feature that uses it falls back to an on-device path.

## Run it locally

You need **Node.js 22 or newer** and npm. Start the backend first, then the frontend.

```sh
# Terminal 1 — the Worker on port 8787
cd backend
npm ci
npm run dev
```

```sh
# Terminal 2 — the app on port 5173
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api`, `/img` and `/apk` to the Worker on port 8787.

Secrets are optional for a first run. Without them the catalogue still works, AI routes answer "not configured" and the app uses its on-device paths, and the owner console cannot sign in. To add them, create `backend/worker/.dev.vars` with `NAME=value` lines using the names in [backend/.env.example](backend/.env.example). Keep that file untracked, and never put a key in a `VITE_*` variable — those are visible to every visitor.

## Project map

```text
frontend/                       the app (web and Android share this bundle)
  src/main.tsx                  boot: migrations, render, device classes, service worker
  src/router/                   routes; every page is a lazy chunk
  src/layouts/AppLayout.tsx     shell: sidebar, top bar, dock, player bar, overlays
  src/pages/                    routed pages
  src/components/               shared UI (Sheet, TopBar, SongRow, welcome sheet, tour runner)
  src/features/                 feature folders (home, queue, settings/backup, tutorials, ai, nav, …)
  src/store/                    zustand stores (player, settings, library, history, …)
  src/services/recommendation/  the next-song pipeline
  src/services/personalization/ taste profile, event weights, session intent
  src/services/api/             catalogue client with the fallback ladder
  src/services/ai/              DJ, curation, playlist and taste-snapshot clients
  src/services/audio/           the audio engine and effects
  src/services/media-session/   lock-screen and headset controls, native plugin bridge
  src/services/storage/         guarded localStorage, IndexedDB event log, migrations
  src/styles/                   design tokens (index.css, flow.css)
  public/sw.js                  service worker
  public/admin/                 owner console (static page)
  native-android/               Java sources copied into the generated Android project
  scripts/                      build, prerender, bundle budget, e2e smoke, Android patch
  e2e/                          browser test specs and their harness
backend/
  worker/index.ts               router
  worker/functions/api/         public, AI, cron and admin endpoints
  worker/functions/_lib/        AI lanes, admin auth, catalogue, rate limits, push
  worker/wrangler.toml          Worker name, routes, vars
docs/                           current documentation; docs/history/ holds dated records
.github/workflows/              CI, E2E, Worker deploy, Android builds, scheduled jobs
```

## How personalisation works

VinaX builds a taste profile on the device from what is played, finished, skipped, liked and queued. A play counts after five seconds of listening. The profile is stored only on the device; AI features receive a bounded summary of it with each request.

The next-song engine is one ten-stage pipeline: candidate generation, hard filtering, feature extraction, context scoring, diversity and repeat penalties, session adjustment, exploration tuning, ranking, sequencing and validation. A continuation is the next five songs, in the seed song's language, with the most familiar hand-off first. A session-intent layer follows the current sitting — skips, finishes, likes, searches, hand queue-adds — without writing it into long-term taste. The AI DJ may re-order the pool or propose a few catalogue-verified songs, but its output passes the same final validation, and the on-device order plays whenever AI is slow or unavailable.

On Home, "Trending for you" only re-orders real trending songs, and a song shown on one shelf is not repeated on a later one.

The full description, with the real weights, is in [docs/recommendations.md](docs/recommendations.md). The AI side is in [docs/ai.md](docs/ai.md). Add `?debug=recs` to any URL (it is always on in a development build) to see why each song was selected, passed over or rejected.

## Privacy in plain words

- No account. Library, history, settings, taste profile and AI chats stay on the device. Clearing site or app data removes them, so export a backup first (Settings → Your Data).
- "On the device" does not mean "no network". Searching sends search words to the catalogue. AI features send a bounded summary of taste and recent listening — song titles and artist names, no identity. Choosing a username checks it with the service.
- Usage statistics and session insights are sent only when the usage-sharing box on the welcome sheet is ticked. The box is ticked by default; unticking it means nothing is sent.
- A backup file never contains credentials, the device identity, downloads or the queue.

Details, including the backup format and a table of every request that leaves the device: [docs/data-and-privacy.md](docs/data-and-privacy.md).

## Validation

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e
```

```sh
cd backend
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
```

The browser suite needs its test browser (`npx playwright-core install chromium`, or set `E2E_CHROMIUM_PATH` to an installed binary) and a fresh `npm run build`, because it serves `frontend/dist/`. It runs against mocked APIs: it does not prove the live catalogue, credentials, Android playback or release signing. [docs/testing.md](docs/testing.md) explains the harness, fixture shapes, the bundle budget and how to verify a single commit in a throw-away worktree.

## How releases work

1. Work on a branch and open a pull request.
2. CI runs lint, typecheck, unit tests, the build and the bundle budget for the frontend, and lint, typecheck, tests and a Worker dry-run for the backend. A second workflow builds the app and runs the browser suite.
3. Merge to `main`.
4. The static host builds `frontend/` from `main` and publishes the site. When `backend/**` changed, the **Deploy Worker** workflow runs the backend gates again and deploys the Worker. A third workflow builds the Android package.
5. Verify production. A merged commit is not proof of a deploy: the two halves deploy separately, and either can fail on its own.

Settings, manual commands, release checks and what to do when a deploy does not land are in [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/operations.md](docs/operations.md). Do not commit secrets, generated build folders or personal exports.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/README.md](docs/README.md) | The index |
| [docs/architecture.md](docs/architecture.md) | The pieces and how data flows between them |
| [docs/recommendations.md](docs/recommendations.md) | The next-song pipeline, weights, session intent, discovery modes, the 7.1 queue rules |
| [docs/ai.md](docs/ai.md) | AI lanes and failover, each AI route's contract, budgets, behaviour with every provider down |
| [docs/design-system.md](docs/design-system.md) | The Flow tokens, control scale, overlays, motion, the top bar actions slot |
| [docs/data-and-privacy.md](docs/data-and-privacy.md) | What is stored where, the backup format, restore rules, what leaves the device |
| [docs/testing.md](docs/testing.md) | Unit and browser tests, fixtures, the bundle budget, verifying a commit in a worktree |
| [docs/admin-console.md](docs/admin-console.md) | The owner console: sections, server-side auth, flags, Home layout publishing |
| [docs/android.md](docs/android.md) | The Android project, native media service, downloads, updates, device-only checks |
| [docs/operations.md](docs/operations.md) | Secrets, scheduled jobs, monitoring, runbooks, rollback |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Hosting settings, deploy commands, release checks |
| [docs/fcm-push-setup.md](docs/fcm-push-setup.md) | Setting up Android background notifications |
| [docs/qa-device-script.md](docs/qa-device-script.md) | The real-device checklist |
| [docs/legal-copyright.md](docs/legal-copyright.md) | Legal and copyright notes |
| [docs/user-guide/README.md](docs/user-guide/README.md) | The guide for listeners |
| [frontend/README.md](frontend/README.md), [backend/README.md](backend/README.md) | Short per-package notes |
| [docs/history/README.md](docs/history/README.md) | Dated release write-ups, audits and phase plans, kept as written |
