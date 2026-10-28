# VinaX

VinaX is a free music app with no sign-up. It plays from a public catalogue, learns a listener's taste on their own device, and builds what plays next from that. It ships as a web app and an Android app from one codebase, backed by one edge Worker, and includes VinaX AI, a chat assistant that can play music, search the web and cite its sources. The version number moves with every merge to `main` (`frontend/src/constants/version.ts` is the source of truth). The current line is **VinaX V2**, which restarted at 1.0.0 after 15.0.1; listeners see "VinaX V2 1.0" (major and minor). This README covers what a listener gets, how the code is put together, how to run and check it, how a release is made, and where the rest of the documentation is.

[Documentation index](docs/README.md) · [User guide](docs/user-guide/README.md) · [Deployment](DEPLOYMENT.md) · [Operations](docs/operations.md) · [Database](docs/database.md)

## What a listener gets

- **Sign in with Google.** One tap; the Google photo is the profile picture, and the library, playlists, history, taste and settings follow the account to every device. There is no password or payment. Home, Discover, Search, Library and VinaX AI are the five destinations. Search suggests as you type; Discover has charts, languages, moods, regions and films. On the website, Explore, Discover, Charts, Search and every song, album and artist page can be browsed before signing in; play, like and save ask for the account right there (13.9).
- **A queue that builds itself.** Tap a song and the queue fills five songs at a time. AI Radio plays endlessly from a song, an artist, a mood or a few words. Pin a mood or Tune this queue rebuilds Up Next at once; Familiar, Balanced and Discover set how adventurous the picks are.
- **A full player.** Reorderable queue, synced lyrics where available, sleep timer, crossfade, sound settings, lock-screen and headset controls, casting, drive mode and karaoke. A video canvas plays the song's clip behind the player, with a full-screen view (double-tap to like, a quality chip that plays the best rendition the source has). Flow is a full-screen feed of song previews.
- **A library on the device.** Favourites, playlists, Listen Later, smart collections, history and listening stats. One-file backup with preview, merge or replace, and Undo; an encrypted one-time link moves everything to another device.
- **VinaX AI.** A chat that knows a summary of the listener's taste and can play or queue the songs it mentions.
  - **Models.** Auto picks a model for each question and moves on by itself when one is busy, or the listener picks any free model from the providers configured for the deployment, listed under its real name. The chat restyles itself to match the selected model's family, or stays on one of its own styles.
  - **Web search with sources.** When a question needs current information, it searches the web, shows what it is searching for, and links each fact to a source chip that shows the site's logo. Answers that use the web can show pictures from the search.
  - **Deep research.** A switch in the + menu: it plans several searches, runs them together and writes a longer report with every fact linked to its source.
  - **Visible reasoning.** When a model thinks before answering, its reasoning shows while it works, then folds away as "Thought for Ns".
  - Also: attachments (pictures, text and code files, PDF, and since 15.0 Word, Excel, PowerPoint and EPUB), dictation, live voice and read-aloud, image creation, running code, projects, an opt-in memory, temporary chats, short automatic chat titles and instant replies to small talk.
- **Friends and sharing (15.0).** An opt-in public profile at `/u/<handle>` (top artists, languages, recent likes, what is playing when shared); follow listeners and see "Friends are listening" on Home; Blend a mix from your likes and a friend's; share a playlist as a public page or an invite link that lets friends add songs; Listen Together rooms with names, a chat, vote-to-skip and "save this session"; share a VinaX AI chat as a read-only link.
- **New every day (15.0).** Discover 5 (five unheard songs a day, keep or skip), "Songs like this" with a reason on every pick, release alerts for saved artists, weekly goals with streaks, a Wrapped-style story of the year, focus sounds (rain, wind, noise) with a timer, Auto EQ that follows the song, drive-mode voice commands, playlist import from CSV/M3U files, and on Android smart downloads that keep the Weekly Mix offline on Wi-Fi.
- **Looks.** Six app styles (Lumen is the default; each is modelled on the design language of a music app listeners already know, in VinaX's own names and colours — see [docs/app-styles.md](docs/app-styles.md)), each with dark, light and true-black themes and every accent. On a festival's days the app takes that festival's colours and backdrop and offers a greeting card once; any of the 43 festival skins can be previewed in Settings → Appearance.
- **Comfort.** Keyboard shortcuts, reduced motion, high contrast, display size, Kid mode, app language and guided tours.
- **Android app.** The same app with background playback, notification and lock-screen controls, home-screen widgets, offline downloads, push notifications and in-app updates.
- **Device-first data.** Library, history, settings, the taste profile and AI chats stay on the device. A service worker keeps the app shell and downloaded songs available offline. Anonymous usage statistics (which song is playing, city-level location, no account) are shared by default and can be switched off in Settings; third-party session insights are off unless turned on.

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
 │  /api/*: catalogue proxy, AI, sign-in and     │
 │          sync, usage events, rooms, push,     │
 │          status, the owner console's API      │
 │  language-and-mood pages, /sitemap*, /img,    │
 │  /apk; anything unmatched → the static site   │
 │  Cron Trigger every 30 min: status tick,      │
 │  housekeeping                                 │
 └───────────────────────┬───────────────────────┘
                         │ service-role key (Worker secret)
 ┌───────────────────────▼───────────────────────┐
 │ one hosted database  (backend/supabase/)      │
 │  listeners, accounts + backups, events,       │
 │  ai_calls, feedback, blocked content, rooms,  │
 │  push devices, notifications, settings,       │
 │  experiments, audit log, uptime, job runs     │
 └───────────────────────────────────────────────┘
```

Since 14.0 the Worker has one hosted database, designed from a clean sheet: the whole schema is one file, `backend/supabase/schema.sql`, and the Worker reaches it with two secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Row-level security is forced on every table with no policy, so only the Worker's key can read or write; the app and the owner console never hold a database key. A listener's library, history and settings still live on the device; a signed-in listener's copy syncs to the account. [docs/database.md](docs/database.md) is the reference.

| Piece | What it is | How it deploys |
| --- | --- | --- |
| Static frontend | `frontend/` built to `dist/`: a single-page app in which every page is a lazy chunk, plus the prerendered static routes, the owner console (`/admin/`) and the status page (`/status/`) | The static host's Git integration builds `frontend/` on every push to `main`. No workflow in this repository deploys it. |
| Worker `vinax-api` | `backend/worker/`: one Worker, no framework. It answers only the routes listed in `backend/worker/wrangler.toml`; everything else falls through to the static site. It also has a key-value store for device-transfer links, rate-limit bindings, a built-in AI binding and a Cron Trigger. | The **Deploy Worker** workflow on a push to `main` that touches `backend/**`. |
| Database | One hosted project; the schema is `backend/supabase/schema.sql` (tables, the `directory` view, the `stats_*` functions, deny-all row-level security). The Worker is its only client. | Paste `schema.sql` into the project's SQL editor once (it is idempotent); set the two Worker secrets ([docs/database.md](docs/database.md#setting-it-up)). |
| Android package | The same bundle in a generated wrapper project with a native media service | **Build Android APK**, dispatched by **Auto release** on every merge to `main`; **Release APK** on a `v*` tag. |

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
backend/
  worker/index.ts             the router and the scheduled handler
  worker/functions/api/       public, AI (ai/), auth (auth/), account, push, cron and admin (admin/) endpoints
  worker/functions/_lib/      shared code: the database client (db.ts) and its companions, AI lanes, catalogue, admin auth, rate limits, web search
  worker/__tests__/           Worker tests
  worker/wrangler.toml        Worker name, routes, vars, bindings, the Cron Trigger
  supabase/schema.sql         the whole database: tables, view, functions, security (idempotent)
  supabase/reset.sql          drops everything so schema.sql can start over
  scripts/                    an operator script for the zone's edge rules (see docs/operations.md)
shared/identity-vectors.json  song-identity test vectors run by both packages
docs/                         current documentation; docs/history/ holds dated records
.github/workflows/            checks, deploys, Android builds and the uptime probe
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

Secrets are optional for a first run. Without them the catalogue works, AI routes answer "not configured" and the app uses its on-device paths, and the owner console cannot sign in. Without the two database secrets the data features answer their "not configured" shapes (no sync, no rooms, no feedback, no push registration) and every console page that reads data shows its setup card. Local secrets go in `backend/worker/.dev.vars`, one `NAME=value` per line; the file is git-ignored. The names are documented in `backend/.env.example`. Never put a secret in a `VITE_*` variable.

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

Every merge to `main` is a release. The **Auto release** workflow bumps the version, writes the What's New card from the merge's title and body, pushes a `release: <version> — <title>` commit, and dispatches the Android build on it; the static host and Deploy Worker publish from the same code. Nothing has to be done by hand: a pull request's title becomes the card's title and its bullet points become the changes, so write them for listeners. `#minor` or `#major` in the pull request **title** bumps more than the patch number; `[skip release]` in the title leaves the version alone (or a line of the description that is exactly `release: minor`, `release: major` or `release: skip`). Mentioning these words in a sentence of the description does nothing. A pull request that bumps the version itself (the manual route below) is released as is.

1. **Work on a branch.** A manual release (the automatic one does the same) changes these together:
   - `version` in `frontend/package.json` and the root entry of `frontend/package-lock.json`;
   - `LATEST_VERSION` (semver) and `DISPLAY_VERSION` (what listeners see, e.g. "VinaX V2 1.0") in `frontend/src/constants/version.ts`;
   - a new What's New card at the top of `CHANGELOG_V2` (the VinaX V2 line) in `frontend/src/constants/changelog.ts`, with a title and at least one change. Releases before V2 live in `CHANGELOG_CLASSIC`; their version numbers may repeat on the V2 line, which is fine because nothing compares version names (Android updates compare build numbers, which keep rising);
   - `version` in `backend/package.json` when the Worker changed. The Worker has its own numbering (6.0.0 at frontend 12.0.0).

   `frontend/src/constants/release.test.ts` fails when `LATEST_VERSION`, `package.json` and the top changelog entry disagree. If you changed an inline script in `index.html`, build and run `node scripts/csp-hashes.mjs`.
2. **Open a pull request.** CI runs lint, typecheck, unit tests, the build and the bundle budget for the frontend, and lint, typecheck, tests and a Worker dry-run for the backend. E2E builds the app and runs the browser suite.
3. **Merge to `main`.** **Auto release** pushes the version bump (unless the merge made one). The static host builds and publishes the frontend from it. When `backend/**` changed, **Deploy Worker** runs the backend gates again, verifies its deploy token, deploys and polls `/api/status` until it answers `200`. **Build Android APK**, dispatched by Auto release, builds the Android package and publishes a release when the signing secrets are set.
4. **Verify production.** A merged commit, green checks and a verified production are three separate milestones. Confirm the static host's build succeeded and read the Deploy Worker log: it succeeds without deploying when its token is not configured. Check that the app shows the new version (Settings, About or `/changelog.json`) and that any route the change added answers. `/api/version` reports the Android release, not the Worker build. The hosting provider's own Git build check for the Worker fails on every commit because of an expired dashboard token, never because of the code; it is harmless while Deploy Worker is green ([docs/operations.md](docs/operations.md#the-known-red-check)).

Full steps, release checks and what to do when a deploy does not land: [DEPLOYMENT.md](DEPLOYMENT.md). Rollback: [docs/operations.md](docs/operations.md#rollback).

## Workflows

All in `.github/workflows/`. Times are UTC; scheduled workflows often start late. Every workflow with a schedule can also be run by hand.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | Push to `main`, pull requests | Frontend and backend gates (see [Checks](#checks)) |
| `e2e.yml` | Push to `main`, pull requests, by hand | Builds the app and runs the browser suite |
| `lighthouse.yml` | Push to `main`, by hand | Audits the prerendered routes: accessibility and search checks fail the run, performance is advisory |
| `worker-deploy.yml` | Push to `main` touching `backend/**` or the workflow file; by hand, with an optional `dry_run` | Gates, then deploys the Worker and polls `/api/status` |
| `schema.yml` | Pull requests and pushes touching `backend/supabase/**`; by hand, with an optional `apply` | Proves `schema.sql` on a fresh Postgres (apply twice, `check.sql`, reset, apply, check); on `main`, applies it to the production database when `SUPABASE_DB_URL` is set ([docs/database.md](docs/database.md#from-ci-instead-of-the-sql-editor)) |
| `auto-release.yml` | Push to `main`; by hand, with an optional `dry_run` | Bumps the version, writes the What's New card from the merge, pushes the release commit and dispatches the Android build |
| `buildapk.yml` | Dispatched by Auto release on every merge; by hand, with an optional `strict` | Builds the Android package; publishes a release when signing secrets are set (`strict` fails without them) |
| `release.yml` | Push of a `v*` tag | Builds and publishes a signed Android release; refuses without the release keystore |
| `diagnose.yml` | By hand, and when its own file changes | Checks that the live page's assets load and the app mounts in a headless browser; probes the catalogue route |
| `synthetic-uptime.yml` | Every 30 minutes | Probes the live app shell and two Worker routes, runs `frontend/scripts/edge-integrity.mjs`, and opens one de-duplicated issue on failure. It is an outside check; the status page's own history comes from the Worker's Cron Trigger |

The data jobs do not run on the code host. The Worker's own Cron Trigger (`[triggers]` in `backend/worker/wrangler.toml`) fires every 30 minutes: the **status tick** probes the website, the catalogue and the console and records the result for the status page, and once an hour **housekeeping** sweeps idle rooms, purges usage events past the retention setting and retires push devices that stopped checking in. Every run is recorded in `job_runs` and shown on the console's Database page. Details: [docs/operations.md](docs/operations.md#scheduled-jobs).

## Configuration

- **Worker secrets** are set on the Worker, never in `wrangler.toml` or in the frontend. `backend/.env.example` lists every name with what it does. [docs/operations.md](docs/operations.md#secrets) has the table of what each secret turns on and what happens without it, and covers the AI keys and web search with its daily caps.
- **The database** is set up once with `backend/supabase/schema.sql` and the two secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: [docs/database.md](docs/database.md). Everything the owner publishes (banners, flags, Home layout, site mode, the announcement) is a row in its `settings` table, written from the console.
- **Non-secret Worker settings** are the `[vars]` in `backend/worker/wrangler.toml`.
- **Repository secrets** for deploying and signing the Android package are listed in [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/operations.md](docs/operations.md#secrets).
- **Android background notifications** need extra setup: [docs/fcm-push-setup.md](docs/fcm-push-setup.md).
- **AI behaviour** (providers, Auto, failover, web search, deep research): [docs/ai.md](docs/ai.md).

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
| [docs/database.md](docs/database.md) | The database: setup, every table and function, the Worker's data layer, the admin API contract, scheduled jobs |
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

Listeners sign in with a Google account. The account row holds the Google ID, email, name and picture, the linked device and coarse sign-in facts, and one synced copy of the library, history, taste profile and settings; AI chats stay on the device ([docs/data-and-privacy.md](docs/data-and-privacy.md#your-google-account)). Searching, AI features, Listen Together, notifications and device transfer send only the fields listed in [docs/data-and-privacy.md](docs/data-and-privacy.md); AI calls are logged as counts and timings, without prompts or replies. Anonymous usage statistics are shared by default (a pre-ticked box at the welcome, a switch in Settings → Region & privacy) and are purged after the retention period (180 days by default); third-party session insights have their own switch, off by default. A listener can delete their account and data from Settings; the owner can delete one person from the console. The advertisement on the website's browsing pages is not covered by the usage choice and is described in the same document.

The repository carries no licence file. The legal position on content, takedowns and listener data is in [docs/legal-copyright.md](docs/legal-copyright.md).
