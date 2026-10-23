# VinaX

VinaX is a free music app with no sign-up. It plays from a public catalogue, learns a listener's taste on their own device, and builds what plays next from that. It ships as a web app and an Android app from one codebase, backed by one edge Worker, and includes VinaX AI, a chat assistant that can play music, search the web and cite its sources. The current release is 12.0.0, shown to listeners as "VinaX 12". This README covers what a listener gets, how the code is put together, how to run and check it, how a release is made, and where the rest of the documentation is.

[Documentation index](docs/README.md) · [User guide](docs/user-guide/README.md) · [Deployment](DEPLOYMENT.md) · [Operations](docs/operations.md)

## What a listener gets

- **Sign in with Google.** One tap; the Google photo is the profile picture, and the library, playlists, history, taste and settings follow the account to every device. There is no password or payment. Home, Discover, Search, Library and VinaX AI are the five destinations. Search suggests as you type; Discover has charts, languages, moods, regions and films. On the website, Explore, Discover, Charts, Search and every song, album and artist page can be browsed before signing in; play, like and save ask for the account right there (13.9).
- **A queue that builds itself.** Tap a song and the queue fills five songs at a time. AI Radio plays endlessly from a song, an artist, a mood or a few words. Pin a mood or Tune this queue rebuilds Up Next at once; Familiar, Balanced and Discover set how adventurous the picks are.
- **A full player.** Reorderable queue, synced lyrics where available, sleep timer, crossfade, sound settings, lock-screen and headset controls, casting, drive mode and karaoke. A video canvas plays the song's clip behind the player, with a full-screen view (double-tap to like, a quality chip that plays the best rendition the source has). Flow is a full-screen feed of song previews.
- **A library on the device.** Favourites, playlists, Listen Later, smart collections, history and listening stats. One-file backup with preview, merge or replace, and Undo; an encrypted one-time link moves everything to another device.
- **Listen Together.** A room with a code, a QR and an invite link. The session follows the listener across the app and guests stay in time with the host.
- **VinaX AI.** A chat that knows a summary of the listener's taste and can play or queue the songs it mentions.
  - **Models.** Auto picks a model for each question and moves on by itself when one is busy, or the listener picks any free model from the providers configured for the deployment, listed under its real name. The chat restyles itself to match the selected model's family, or stays on one of its own styles.
  - **Web search with sources.** When a question needs current information, it searches the web, shows what it is searching for, and links each fact to a source chip that shows the site's logo. Answers that use the web can show pictures from the search.
  - **Deep research.** A switch in the + menu: it plans several searches, runs them together and writes a longer report with every fact linked to its source.
  - **Visible reasoning.** When a model thinks before answering, its reasoning shows while it works, then folds away as "Thought for Ns".
  - **Trending now.** An empty chat shows current news and tech headlines; tapping one asks VinaX AI for the latest on that story.
  - Also: attachments (pictures, text and code files, PDF), dictation, live voice and read-aloud, image creation, running code, projects, an opt-in memory, temporary chats, short automatic chat titles and instant replies to small talk.
- **Notifications.** Opt-in push notifications on the web and in the Android app: song picks sent on a schedule, and messages from the owner.
- **Looks.** Six app styles (Aura is the default), each with dark, light and true-black themes and every accent. On a festival's days the app takes that festival's colours and backdrop and offers a greeting card once; any of the 43 festival skins can be previewed in Settings → Appearance.
- **Comfort.** Keyboard shortcuts, reduced motion, high contrast, display size, Kid mode, app language and guided tours.
- **Android app.** The same app with background playback, notification and lock-screen controls, home-screen widgets, offline downloads, push notifications and in-app updates.
- **Device-first data.** Library, history, settings, the taste profile and AI chats stay on the device. A service worker keeps the app shell and downloaded songs available offline. Usage statistics are sent only when the listener opts in.

The website shows one labelled advertisement at the end of song, artist, album, language and mood pages, and nowhere else; none in the Android app or in Kid mode. Music and AI results depend on the catalogue and on the AI providers configured for the deployment. When AI is slow, switched off or not configured, the features that use it fall back to an on-device path.

## Architecture

```text
 Browser or Android app
 ┌───────────────────────────────────────────────┐
 │ frontend/  static single-page app             │
 │  stores ── device storage (local, IndexedDB)  │
 │  recommendation engine, audio engine          │
 │  service worker: shell + offline audio        │
 └───────────────────────┬───────────────────────┘
                         │ same origin (/api, /img, /apk)
 ┌───────────────────────▼───────────────────────┐
 │ backend/worker  edge Worker "vinax-api"       │
 │  /api/*: catalogue proxy, AI, push, rooms,    │
 │          events, cron jobs, owner console     │
 │  language-and-mood pages, /sitemap*, /img,    │
 │  /apk; anything unmatched → the static site   │
 └───────────────────────┬───────────────────────┘
                         │ service key (Worker only)
                  hosted database: configuration, events,
                  rooms, push registrations, AI call log
```

| Piece | What it is | How it deploys |
| --- | --- | --- |
| Static frontend | `frontend/` built to `dist/`: a single-page app in which every page is a lazy chunk, plus the prerendered static routes, the owner console (`/admin/`) and the status page (`/status/`) | The static host's Git integration builds `frontend/` on every push to `main`. No workflow in this repository deploys it. |
| Worker `vinax-api` | `backend/worker/`: one Worker, no framework. It answers only the routes listed in `backend/worker/wrangler.toml`; everything else falls through to the static site. It also has a key-value store for device-transfer links, rate-limit bindings and a built-in AI binding. | The **Deploy Worker** workflow on a push to `main` that touches `backend/**`. |
| Database | Configuration, usage events (only with usage sharing on), feedback, usernames, Listen Together rooms, push registrations and the AI call log. Reached only by the Worker, with a service key. SQL lives in `frontend/supabase/`. | Migrations are applied by the owner by hand ([docs/operations.md](docs/operations.md)). |
| Android package | The same bundle in a generated wrapper project with a native media service | **Build Android APK** on every push to `main`; **Release APK** on a `v*` tag. |

The two halves deploy separately and either can fail alone. The frontend holds no secrets: `VITE_*` variables are visible to every visitor. Main packages, for orientation: `react`, `react-router-dom`, `zustand`, `@tanstack/react-query` and `tailwindcss`, built with `vite`; `@capacitor/*` for Android; `wrangler` for the Worker; `vitest` and `playwright-core` for tests. The full map is in [docs/architecture.md](docs/architecture.md).

## Repository layout

```text
frontend/
  index.html                  shell markup and the pre-paint script (theme, app style, festival)
  src/main.tsx                boot: migrations, global styles, render, service worker
  src/router/                 routes; every page is a lazy chunk
  src/layouts/AppLayout.tsx   the frame: sidebar, top bar, dock, player, overlays
  src/pages/                  routed pages
  src/components/             shared UI
  src/features/               feature folders (ai, home, search, player, together, settings, festival, …)
  src/store/                  state stores (player, settings, library, history, …)
  src/services/               recommendation, personalization, ai, api, audio, media-session, push, storage, …
  src/constants/              app styles, festivals, version.ts, changelog.ts (the What's New card)
  src/styles/                 tokens (index.css), frame (shell.css), templates/, pages/, festivals.css, ai-styles.css
  public/                     sw.js (service worker), admin/ (owner console), status/ (status page), _headers, _redirects
  scripts/                    prerender, changelog.json, bundle budget, CSP hashes, browser smoke test, edge integrity, Android patch, festivals, evaluation
  e2e/                        browser test specs and their harness
  eval/                       offline evaluation of next-song selection
  native-android/, android-res/   native code and resources copied into the generated Android project
  supabase/                   database schema and migrations
backend/
  worker/index.ts             the router
  worker/functions/api/       public, AI (ai/), cron (cron/), push and admin (admin/) endpoints
  worker/functions/_lib/      shared code: AI lanes, catalogue, admin auth, rate limits, push, web search, headlines
  worker/__tests__/           Worker tests
  worker/wrangler.toml        Worker name, routes, vars, bindings, cron trigger
  scripts/                    an operator script for the zone's edge rules (see docs/operations.md)
shared/identity-vectors.json  song-identity test vectors run by both packages
docs/                         current documentation; docs/history/ holds dated records
.github/workflows/            checks, deploys, Android builds and scheduled jobs
```

[frontend/README.md](frontend/README.md) has a "where to change things" table; [backend/README.md](backend/README.md) describes the Worker's layout.

## Getting started locally

You need Node.js 22 or newer (`engines` in both `package.json` files) and npm. Start the Worker first, then the app.

```sh
# Terminal 1 — the Worker on port 8787 (wrangler dev)
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

Open `http://localhost:5173`. The dev server proxies `/api`, `/img` and `/apk` to the Worker on `127.0.0.1:8787` (`frontend/vite.config.ts`).

Secrets are optional for a first run. Without them the catalogue works, AI routes answer "not configured" and the app uses its on-device paths, and the owner console cannot sign in. Local secrets go in `backend/worker/.dev.vars`, one `NAME=value` per line; the file is git-ignored. The names are documented in `backend/.env.example`. Never put a secret in a `VITE_*` variable.

Other scripts:

| Where | Command | What it does |
| --- | --- | --- |
| `frontend/` | `npm run preview` | Serves the built `dist/` |
| `frontend/` | `npm run format` | Formats `src/` |
| `frontend/` | `npm run gen:festivals` | Regenerates the festival CSS and tables after editing the festival constants |
| `frontend/` | `node scripts/eval-recs.mjs` | Offline evaluation of next-song selection ([docs/evaluation.md](docs/evaluation.md)) |
| `frontend/` | `npm run cap:add:android`, `npm run cap:sync`, `npm run android:debug` | Generate, sync and build the Android project locally (needs a Java 21 JDK and the Android SDK; see [docs/android.md](docs/android.md)) |
| `backend/` | `npm run format` | Formats `worker/` |

## Checks

These are the commands CI runs (`.github/workflows/ci.yml` and `e2e.yml`).

```sh
cd frontend
npm run lint                         # eslint, --max-warnings 0
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs   # needs the build above
npx playwright-core install chromium # once: the test browser
npm run e2e                          # needs the build above
```

```sh
cd backend
npm run lint                         # eslint, --max-warnings 0
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/wrangler-dry
```

- `npm run build` first deletes `dist/` and the build caches, then typechecks, builds, prerenders the static routes and writes `dist/changelog.json`. Stop a dev server that shares the folder, or build in a separate worktree ([docs/testing.md](docs/testing.md#verify-a-commit-in-a-throw-away-worktree)).
- **Bundle budget** (`frontend/scripts/check-bundle-size.mjs`): first-load JavaScript must stay under 188 KB gzipped in total, each first-load chunk under 80 KB, and each on-demand chunk under 160 KB. A few large diagram and maths libraries are exempt only while they stay out of the first load.
- **Browser suite**: `npm run e2e` checks that no built `/assets/*.js` file is secretly HTML, boots the built app in a real browser with every outside request aborted, then runs the specs in `frontend/e2e/`. A red run means the app broke, not the network.
- A Worker handler that is not routed in `worker/index.ts` falls through to the static site and answers `405`; the dry-run cannot see that, `routerCoverage.test.ts` can.

[docs/testing.md](docs/testing.md) covers the unit and contract tests, the browser harness and its fixtures.

## How releases work

1. **Work on a branch.** A release changes these together:
   - `version` in `frontend/package.json` and the root entry of `frontend/package-lock.json`;
   - `LATEST_VERSION` (semver) and `DISPLAY_VERSION` (what listeners see, e.g. "VinaX 12") in `frontend/src/constants/version.ts`;
   - a new What's New card at the top of `CHANGELOG_V2` in `frontend/src/constants/changelog.ts`, with a title and at least one change;
   - `version` in `backend/package.json` when the Worker changed. The Worker has its own numbering (6.0.0 at frontend 12.0.0).

   `frontend/src/constants/release.test.ts` fails when `LATEST_VERSION`, `package.json` and the top changelog entry disagree. If you changed an inline script in `index.html`, build and run `node scripts/csp-hashes.mjs`.
2. **Open a pull request.** CI runs lint, typecheck, unit tests, the build and the bundle budget for the frontend, and lint, typecheck, tests and a Worker dry-run for the backend. E2E builds the app and runs the browser suite.
3. **Merge to `main`.** The static host builds and publishes the frontend. When `backend/**` changed, **Deploy Worker** runs the backend gates again, verifies its deploy token, deploys and polls `/api/status` until it answers `200`. **Build Android APK** builds the Android package and publishes a release when the signing secrets are set.
4. **Verify production.** A merged commit, green checks and a verified production are three separate milestones. Confirm the static host's build succeeded and read the Deploy Worker log: it succeeds without deploying when its token is not configured. Check that the app shows the new version (Settings, About or `/changelog.json`) and that any route the change added answers. `/api/version` reports the Android release, not the Worker build. The hosting provider's own Git build check for the Worker fails on every commit because of an expired dashboard token, never because of the code; it is harmless while Deploy Worker is green ([docs/operations.md](docs/operations.md#the-known-red-check)).

Full steps, release checks and what to do when a deploy does not land: [DEPLOYMENT.md](DEPLOYMENT.md). Rollback: [docs/operations.md](docs/operations.md#rollback).

## Workflows and scheduled jobs

All in `.github/workflows/`. Times are UTC; scheduled workflows often start late. Every workflow with a schedule can also be run by hand.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | Push to `main`, pull requests | Frontend and backend gates (see [Checks](#checks)) |
| `e2e.yml` | Push to `main`, pull requests, by hand | Builds the app and runs the browser suite |
| `lighthouse.yml` | Push to `main`, by hand | Audits the prerendered routes: accessibility and search checks fail the run, performance is advisory |
| `worker-deploy.yml` | Push to `main` touching `backend/**` or the workflow file; by hand, with an optional `dry_run` | Gates, then deploys the Worker and polls `/api/status` |
| `buildapk.yml` | Push to `main`, by hand | Builds the Android package; publishes a release when signing secrets are set |
| `release.yml` | Push of a `v*` tag | Builds and publishes a signed Android release; refuses without the release keystore |
| `diagnose.yml` | By hand, and when its own file changes | Checks that the live page's assets load and the app mounts in a headless browser; probes the catalogue route |
| `synthetic-uptime.yml` | Every 30 minutes | Probes the live app shell and two Worker routes, runs `frontend/scripts/edge-integrity.mjs`, and opens one de-duplicated issue on failure |
| `status-tick.yml` | Minutes 7 and 37 of every hour | `POST /api/status`: one round of status probes for the status page |
| `ai-daily-push.yml` | 02:30, 07:30, 10:30, 15:30, 18:30 daily | Calls `/api/cron/ai-daily-push`, which composes and sends a song notification; the endpoint refuses to send again within 150 minutes |
| `song-push.yml` | 13:30 daily | Calls `/api/cron/song-push`, which picks a song and notifies subscribed devices |
| `trends-ingest.yml` | Minute 17 of every sixth hour | Calls `/api/cron/trends-ingest`: reads trend sources, matches them to catalogue songs, deletes expired data ([docs/trends.md](docs/trends.md)) |
| `headlines.yml` | Minute 23 of every third hour | Calls `/api/cron/headlines` once to refresh the "Trending now" headlines; skips when web search is off or near its daily cap |
| `weekly-digest.yml` | Monday 03:30 | Calls `/api/cron/weekly-digest` for the owner console's digest card |

The Worker also has its own Cron Trigger (`[triggers]` in `wrangler.toml`, `7,37 * * * *`) that records the same status round, so the status page does not read "down" when the workflow runs late. The cron endpoints require a shared secret. Details: [docs/operations.md](docs/operations.md#scheduled-jobs).

## Configuration

- **Worker secrets** are set on the Worker, never in `wrangler.toml` or in the frontend. `backend/.env.example` lists every name with what it does. [docs/operations.md](docs/operations.md#secrets) has the table of what each secret turns on and what happens without it, and covers the AI keys, web search and its daily caps, and the username human check.
- **Non-secret Worker settings** are the `[vars]` in `backend/worker/wrangler.toml`.
- **Repository secrets** for deploying, signing the Android package and calling the cron endpoints are listed in [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/operations.md](docs/operations.md#secrets).
- **Android background notifications** need extra setup: [docs/fcm-push-setup.md](docs/fcm-push-setup.md).
- **AI behaviour** (providers, Auto, failover, web search, deep research, owner switches and spend caps): [docs/ai.md](docs/ai.md).

## Contributing rules that are enforced

| Rule | Enforced by |
| --- | --- |
| No lint warnings, no type errors | `npm run lint` (`--max-warnings 0`) and `npm run typecheck` in both packages, in CI |
| Tests pass | `npm test` in both packages in CI; `npm run e2e` in the E2E workflow |
| Version, `package.json` and the top What's New card agree | `frontend/src/constants/release.test.ts` |
| First-load JavaScript under 188 KB gzipped (80 KB per first-load chunk, 160 KB per on-demand chunk) | `node scripts/check-bundle-size.mjs` in CI |
| Inline scripts in `index.html` match the content-security policy | `frontend/src/__tests__/cspHashes.test.ts`; after changing an inline script, build and run `node scripts/csp-hashes.mjs` |
| Every app style keeps its contract (contrast, festival stand-down, pre-paint canvas, names no other product) | `frontend/src/constants/templates.test.ts` |
| Every Worker handler is routed | `backend/worker/__tests__/routerCoverage.test.ts` |
| No third-party product, company, music-service or AI-vendor names in interface text, comments, tests or documents | Review. `templates.test.ts` checks the app styles' own text. The exceptions are stated in [docs/README.md](docs/README.md#conventions-for-these-documents) |
| Documents stay true | Fix a document in the same change as the code it describes ([docs/README.md](docs/README.md#conventions-for-these-documents)) |

Do not commit secrets, generated build folders (`dist/`, `frontend/android/`) or personal exports.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/README.md](docs/README.md) | The full index and the documentation conventions |
| [docs/architecture.md](docs/architecture.md) | The pieces and how data flows |
| [docs/design-system.md](docs/design-system.md) | Tokens, app styles, themes, accents, festival skins, chat styles |
| [docs/recommendations.md](docs/recommendations.md) | How the next song is chosen |
| [docs/ai.md](docs/ai.md), [docs/ai-music.md](docs/ai-music.md), [docs/ai-assistant-matrix.md](docs/ai-assistant-matrix.md) | AI lanes and route contracts, the AI music experience, VinaX AI feature by feature |
| [docs/data-and-privacy.md](docs/data-and-privacy.md) | What is stored where and what leaves the device |
| [docs/testing.md](docs/testing.md) | Gates, contract tests, the browser suite, the bundle budget |
| [docs/android.md](docs/android.md) | The Android project and what needs a device |
| [DEPLOYMENT.md](DEPLOYMENT.md), [docs/operations.md](docs/operations.md) | Deploying, secrets, scheduled jobs, monitoring, runbooks, rollback |
| [docs/admin-console.md](docs/admin-console.md) | The owner console |
| [docs/user-guide/README.md](docs/user-guide/README.md) | The guide for listeners |
| [docs/history/README.md](docs/history/README.md) | Dated records: release write-ups and audits |

## Privacy and legal

Listeners sign in with a Google account. The account row holds the Google ID, email, name, picture and VinaX username, and one synced copy of the library, history, taste profile and settings; AI chats stay on the device ([docs/data-and-privacy.md](docs/data-and-privacy.md#your-google-account-130)). Searching, AI features, Listen Together, notifications and device transfer send only the fields listed in [docs/data-and-privacy.md](docs/data-and-privacy.md); AI calls are logged as counts and timings, without prompts or replies. Usage statistics are sent only when the listener opts in. The advertisement on the website's browsing pages is not covered by that choice and is described in the same document.

The repository carries no licence file. The legal position on content, takedowns and listener data is in [docs/legal-copyright.md](docs/legal-copyright.md).
