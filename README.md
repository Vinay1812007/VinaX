# VinaX

VinaX is a free music web app and Android app built from one codebase. It plays from a public catalogue and builds what plays next on the device. There are no ads and no payments. The frontend is served by Cloudflare Pages (project `vinax`). The API runs as a Node server on an Oracle Cloud VM at `https://api.vinaxmusic.online`, and the Cloudflare Worker `vinax-api` stays deployed as its fallback.

This README is the only document in the repository. Version source of truth: `frontend/src/constants/version.ts` (`LATEST_VERSION`, `DISPLAY_VERSION`). The current line is **VinaX V2**, which restarted at 1.0.0 after 15.0.1; listeners see "VinaX V2 <major>.<minor>". The Worker has its own number in `backend/package.json`.

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
- [Recommendations on the device](#recommendations-on-the-device)
- [Offline evaluation of next-song selection](#offline-evaluation-of-next-song-selection)
- [Design system](#design-system)
- [App styles](#app-styles)
- [Charts, trends and canvas clips](#charts-trends-and-canvas-clips)
- [Data and privacy](#data-and-privacy)
- [SEO and indexing](#seo-and-indexing)
- [Legal and copyright](#legal-and-copyright)
- [Real-device QA script](#real-device-qa-script)
- [Listener guide](#listener-guide)
- [Documentation conventions](#documentation-conventions)
- [History](#history)

## What a listener gets

- **Account.** Google or email and password sign-in. Library, history, taste and settings live on the device and sync to the account. Discover, Charts, Search and entity pages work signed out.
- **Spotify-style queue.** Now playing, then Next in queue (songs you added, each plays once and stays through a new album), then Next from: <the list you played>, then Autoplay (similar songs once the list ends; off with repeat on or the Autoplay switch off). Rules in `store/queueRules.ts`, Autoplay in `services/autoplay/`. Shuffle reorders only the list and keeps one artist's songs apart; Repeat all plays the list again.
- **Player.** Synced lyrics, sleep timer, crossfade (off by default since 1.19: on, it handed every song over five seconds early), loudness normalisation, casting, drive mode, disco lights, karaoke, video clips, and **Flow** (music videos one per screen, in the listener's languages, with a quality picker: Auto or any rendition the clip CDN has, 4K down to 360p).
- **Library.** Favourites, playlists, Listen Later, smart collections, Your VinaX stats, and one-file backup with merge, replace and Undo.
- **VinaX AI** at `/vinaxai`: an opt-in chat assistant, and the only place with AI ([VinaX AI](#vinax-ai)). Autoplay, Radio, Home, playlists and lyrics run on the device or through plain catalogue lookups; no listening data goes to an AI service.
- **Friends.** Public profiles `/u/<handle>`, follows, Blend, shared playlists, and **Listen Together** jam rooms (a shared queue; mutual followers can **Join**).
- **Discovery.** Discover 5, Your Week, the weekly VinaX chart, podcasts, release alerts, focus sounds, playlist import.
- **Removed.** Badges, streaks, quiz, recap and song reactions. Old routes redirect, and old API calls answer empty or 410.
- **Look and comfort.** Black-and-green look with System / Light / Dark theme; Light is clear liquid glass over a meadow in the logo's colours, or the playing song's. Ideas & bugs (lands in the console Feedback inbox), shortcuts, accessibility options, Kid mode, tours. App language: English, Telugu, Hindi, Tamil, Kannada, Malayalam.
- **Android app.** Background playback, widgets, downloads, push, in-app updates. iPhone users install from Safari with Add to Home Screen.
- **Privacy.** Works offline through the service worker. Anonymous usage statistics are on by default and can be switched off.

## Architecture

```text
 Browser / Android app: frontend/ static SPA (device stores, recommendation
   and audio engines, service worker)
        | /api/*  (real site: frontend/src/apiHost.ts)
        v
 API = backend/worker/index.ts
   Node server (backend/server/) on the VM: https://api.vinaxmusic.online
   Worker "vinax-api": fallback, admin./update. hosts, /img, /apk, Cron (5 min)
        | service-role key
        v
 one hosted Postgres (backend/supabase/)
```

| Piece | What it is | Deploys by |
| --- | --- | --- |
| Frontend | `frontend/` → `dist/`: lazy-chunk SPA, prerendered pages, console `/admin/`, `/status/` | Cloudflare Pages Git build on push to `main` |
| API server | `backend/server/` runs the Worker code under Node behind a Cloudflare Tunnel, with no daily request limit | [Operations](#operations) › Running the API on a server |
| Worker `vinax-api` | `backend/worker/`; routes in `wrangler.toml`, the rest falls to `ASSETS_HOST`; free plan, 100,000 requests/day | **Deploy Worker** (push touching `backend/**`) |
| Database | `backend/supabase/schema.sql`, with deny-all row-level security; the API is its only client | **Schema** workflow |
| Android | the same bundle in a Capacitor wrapper | **Build Android APK**, **Release APK** |
| AI sandbox | `sandbox/`, its own origin | static project `vinax-sandbox` |

**API routing.** `frontend/src/apiHost.ts` is imported first by `main.tsx`. On the real site it sends every `/api/*` call to the API host, except `/api/apk` and `/api/push/unsubscribe`. If that host is unreachable, calls go to the Worker for one minute.

Frontend and API deploy separately, and either can fail alone. The frontend holds no secrets: every `VITE_*` variable is public. Only the service-role key reaches the database, over REST with `fetch`.

Stack: React 19, react-router 6, zustand 4, React Query 5, Tailwind 3, Vite 8, TypeScript 5, Capacitor 8, wrangler 4, vitest 4, Playwright, axe-core.

### Frontend

- **Boot.** `src/main.tsx` runs `services/storage/earlyMigrations` first, then the global CSS in this order: `index.css`, `shell.css`, `features.css`, `templates/index.css`. It then registers `/sw.js`; Data saver or a metered connection gets the light precache.
- **Frame and routes.** `src/layouts/AppLayout.tsx` holds the frame and the bootstrap; routes are in `src/router/index.tsx`, every page `lazy()`. Retired paths redirect in the router, and also in `public/_redirects` if they were prerendered. `/VinaXAI` redirects in the router only, because a `_redirects` rule could loop.
- **Stores.** State persists under `vinax.*` keys (registry `src/constants/storage-keys.ts`), writing through `services/storage/local.ts`. Its reads never throw, and `freezeLocalWrites()` guards restores. The taste profile is `vinax.profile.v1`; the listen log is in IndexedDB.
- **Catalogue client.** `services/api/client.ts` `orchestratedRequest()` ranks the bases (`constants/endpoints.ts`, `VITE_API_BASES`) by health and hedges interactive calls. Timeouts: 8 s per attempt, 20 s overall. React Query uses `retry: 0`.
- **Audio.** `services/audio/engine.ts` owns one `<audio>` element; `effects.ts` is the lazy Web Audio chain (vocals, EQ, loudness about -14 LUFS, limiter). Casting lives in `services/cast/`; Android casting is unverified on a device.
- **Listen Together.** `services/together/`, `features/together/`, served by `/api/room`. Phones poll, and Supabase Realtime (`REALTIME_URL`, `REALTIME_KEY`) gives an instant line, but the server stays the truth. A guest looks up and starts buffering the room's next song as soon as the queue names it, so a song change lands together. Measure sync with `node scripts/together-measure.mjs` after a build.
- **Service worker.** `public/sw.js` never caches `/api/*`, the catalogue or audio streams. Downloads are served from `vinax-audio-v1`.

### API routes

Requests in `backend/worker/index.ts` resolve in order: host middleware (`functions/_middleware.ts`: apex to `www`, `update.`, `admin.`), the exact-path table, `/api/cat/*` (stream 302s, no audio bytes), hubs (`functions/[hub].ts`), then `ASSETS_HOST`. **Every new handler in `worker/functions/api/` needs an import and an exact-path entry in `worker/index.ts`**, or `routerCoverage.test.ts` fails (an unrouted handler answers 405). `/api/admin/*` checks admin auth on every request. `_lib/db.ts` is the only database code: 8 s deadline, and it returns `{ ok, ... }` instead of throwing.

## Repository layout

```text
frontend/
  index.html                  shell markup and the pre-paint script
  src/main.tsx                boot: migrations, styles, render, service worker
  src/apiHost.ts              sends /api/* to the API server, Worker fallback
  src/router/                 routes; every page is a lazy chunk
  src/layouts/AppLayout.tsx   the frame
  src/pages/, src/components/ routed pages, shared UI
  src/features/               feature folders (home, search, player, together, vinaxai, ...)
  src/store/, src/services/   state stores; recommendation, api, audio, storage, ...
  src/constants/              version.ts, changelog.ts (What's New), storage-keys.ts
  src/styles/                 index.css, shell.css, templates/, pages/
  src/i18n.ts, src/i18n/      app-language dictionaries
  public/                     sw.js, admin/, status/, fonts/, _headers, _redirects, robots.txt
  scripts/                    prerender, bundle budget, CSP hashes, e2e smoke, Android patch, auto-release
  e2e/, eval/                 browser specs; offline next-song evaluation
  native-android/, android-res/   copied into the generated Android project
  ci/debug-keystore.b64       public CI debug keystore (never signs a release)
backend/
  worker/index.ts             router and scheduled handler
  worker/functions/api/, _lib/  endpoints; db.ts, auth, rate limits, ...
  worker/__tests__/           Worker tests
  worker/wrangler.toml        name, routes, vars, bindings, Cron Trigger
  server/                     the API as a Node server: app.ts, bindings.ts, http.ts, build.mjs
  server/deploy/              VM setup script, systemd unit, deploy script
  supabase/schema.sql         the whole database (idempotent); reset.sql; check.sql, ci.sh
  scripts/                    ai-probe.mjs, cf-edge-rules.mjs
  .env.example                every secret/var name
shared/identity-vectors.json  song-identity vectors tested by both packages
sandbox/                      VinaX AI artifact preview site
.github/workflows/            checks, deploys, Android, uptime, SEO
```

Never commit secrets, build folders (`dist/`, `frontend/android/`) or personal exports.

## Running locally

You need Node.js 22+. Start the Worker first:

```sh
cd backend && npm ci && npm run dev     # Worker on 8787
cd frontend && npm ci && npm run dev    # app on 5173, proxies /api /img /apk
```

The app runs without secrets: the catalogue works and data features answer "not configured". Local secrets go in `backend/worker/.dev.vars` (git-ignored); the names are in `backend/.env.example`. **Never put a secret in a `VITE_*` variable.**

| Command | Does |
| --- | --- |
| `npm run preview` (frontend) | serves `dist/` |
| `npm run cap:sync`, `android:debug` (frontend) | Android build (Java 21 + SDK) |
| `npm run deploy:pages` (frontend) | `wrangler pages deploy dist --project-name vinax` |
| `npm run deploy` (backend) | `wrangler deploy --config worker/wrangler.toml` |
| `npm run ai:probe` (backend) | AI provider probe |

**Where to change things.** Styles: `src/styles/`. Shell: `AppLayout.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `BottomNav.tsx`. What plays next: `src/services/recommendation/`, `src/store/playerStore.ts`. Help and tours: `features/help/helpContent.ts`, `features/tutorials/tutorials.ts`. Console: `public/admin/`. Android native: `native-android/`, `scripts/patch-android.js`.

**App language.** English strings are the keys. In components use `const t = useT(); t('Hi {name}', { name })`; outside React use `tr()` at call time. A new string needs the same key, with identical `{slots}`, in all five `src/i18n/{te,hi,ta,kn,ml}.ts` (Help text is in `src/i18n/help/`). `i18n.test.ts` and `helpI18n.test.ts` enforce this.

## Checks and testing

Run all of this locally before merging:

```sh
cd frontend && npm ci
npm run lint && npm run typecheck && npm test
npm run build && node scripts/check-bundle-size.mjs
npx playwright-core install chromium   # once
npm run e2e

cd backend && npm ci && npm run lint && npm run typecheck && npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/wrangler-dry
```

`npm run build` deletes `dist/` first, so never run it where someone else's dev server is running. Verify in a worktree instead: `git worktree add /tmp/vinax-verify <commit>`, run the gates, then `git worktree remove --force /tmp/vinax-verify`.

**Bundle budget** (`frontend/scripts/check-bundle-size.mjs`): first-load JS must be under **195 KB** gzipped, each first-load chunk under **80 KB**, each lazy chunk under **160 KB**; hitting a limit exactly fails. Raise the budget only with a dated ledger entry in the script.

**Contract tests** lock rules:

- `release.test.ts`: the version and the top changelog card agree.
- `cspHashes.test.ts`: inline scripts match their CSP hashes. After editing one, build and run `node scripts/csp-hashes.mjs`.
- `routerCoverage.test.ts`: every handler is routed.
- `schemaUsage.test.ts`: Worker code matches `schema.sql`.
- `templates.test.ts`, `contrast.test.ts`: app style and contrast rules hold.
- `i18n.test.ts`, `helpI18n.test.ts`: translations stay complete.
- `tutorials.test.ts`: every tour target exists.

**Browser tests.** `npm run e2e` serves `dist/` on port 4173 (`E2E_PORT`), aborts every non-localhost request and mocks `/api/**` (`page.route`). Specs import from `e2e/support/test.ts` and start signed in (`?e2e-signed-out` opts out). Seed `vinax.onboarded.v1` and `vinax.last-seen-version`, or the welcome and What's New sheets cover the page. `e2e/a11y.spec.ts` fails on WCAG A/AA violations. The full sweep runs with `QA_SWEEP=1 npx playwright test e2e/qa-sweep.spec.ts`. Specs that quote interface text change in the same commit.

**Tests cannot tell you** whether a deploy landed (check `/api/status` and `/changelog.json`) or whether phone features work ([Real-device QA script](#real-device-qa-script)).

**Rules:** no lint warnings or type errors. No third-party product or vendor names in interface text, code comments or docs ([Documentation conventions](#documentation-conventions)). Fix this README in the same change as the code.

## Releases

Every merge to `main` is a release. **Auto release** (`auto-release.yml`, `frontend/scripts/auto-release.mjs`) bumps the patch version and writes the What's New card from the merged PR's title and body (or the commit message if there is no PR). It pushes a `release: <version> — <title>` commit and dispatches **Build Android APK**. Write PR text for listeners.

- **Bigger bumps.** `#minor` / `#major` in the title, or a body line exactly `release: minor` / `release: major`.
- **No release.** `[skip release]` in the title, or a body line exactly `release: skip`.
- **Tour button.** A body line `tour: <id>` adds a **Take the tour** button to the card. These words do nothing inside a sentence.
- **Merging.** Use `--squash`, with the subject and body set to the PR title and body.
- **Manual release.** Change these together: `frontend/package.json` and the root of `package-lock.json`; `LATEST_VERSION` and `DISPLAY_VERSION`; a new top card in `CHANGELOG_V2` (`frontend/src/constants/changelog.ts`); and `backend/package.json` if the Worker changed. `release.test.ts` fails if they disagree; a merge that already moved the version is released as is.

**Verify production:** the Pages build passed; the Deploy Worker log shows a real deploy (it passes when the token is missing); Settings > About shows the new version; for Android, `/api/version` shows the new `build`. The "Workers Builds: vinax-api" check always fails because of an expired token; ignore it.

## Workflows

All are in `.github/workflows/`. Times are UTC.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml`, `e2e.yml` | push to `main`, PRs | gates, browser suite |
| `lighthouse.yml` | push to `main` | audits pages; accessibility and SEO checks fail the run |
| `worker-deploy.yml` | push touching `backend/**`; manual `dry_run` | gates, deploy, poll `/api/status` |
| `schema.yml` | changes in `backend/supabase/**`; manual `apply` | proves `schema.sql`; on `main` applies it when `SUPABASE_DB_URL` is set |
| `auto-release.yml` | push to `main` | version, card, APK dispatch |
| `buildapk.yml` / `release.yml` | dispatch (manual `strict`) / `v*` tag | debug APK, signed when secrets exist / signed release, refuses without the keystore |
| `seo-pages.yml` | daily 20:30 | grows pages ([SEO and indexing](#seo-and-indexing)) |
| `diagnose.yml` | manual | live assets load, app mounts, catalogue probe |
| `synthetic-uptime.yml` | every 30 min | probes the shell and `/api/geo` (must be JSON), runs `edge-integrity.mjs`; opens one de-duplicated issue |

Data jobs run on the Worker's Cron Trigger ([Operations](#operations)).

## Deployment

Both applications live on `main`; there are no separate frontend/backend branches.

### Frontend - static hosting

Static project `vinax` (`vinax.pages.dev`), Git-connected: branch `main`, root `frontend`, build `npm run build`, output `dist`, Node 22+, no variables or secrets. Manual deploy from `frontend/`: `npm ci && npm run deploy:pages`. Keep the custom domains (`www.vinaxmusic.online`, apex, `admin.`, `update.`, `status.`) on this project: the Worker passes every unmatched URL to it.

- `npm run build` runs `tsc`, `vite build`, then `scripts/prerender.mjs` (static routes, hubs, `404.html` shells), `prerender-entities.mjs`, `changelog-json.mjs`, `admin-stamp.mjs`, `robots-from-api.mjs`.
- Entity pages (`dist/song/<slug>-<id>.html`) are built only on the host (`CF_PAGES=1`; locally `PRERENDER_ENTITIES=1`) from VinaX's catalogue API and mirrors, never this site's `/api`. Limits are `ENTITY_*` vars; `ENTITY_MIN_PAGES` (300) fails a thin build so Pages keeps the last good one.
- CSP hashes: after changing an inline script in `index.html` or an app style, build, then `node scripts/csp-hashes.mjs` (updates `public/_headers`); `cspHashes.test.ts` fails on drift. `_headers` also sets console files `no-cache`, `noindex` on `status.` and `vinax.pages.dev`, and serves `/.well-known/assetlinks.json` as JSON; `_routes.json` and `_redirects` must never touch `/.well-known/*`.

### Backend - the Worker

`backend/worker/wrangler.toml`: name `vinax-api`, routes, `[vars]` (`ASSETS_HOST` = the static host), cron, KV `HANDOFF`, `[ai]`, rate-limit bindings. Never secrets.

**Routes:** `www.vinaxmusic.online/api/*`, `/img`, `/apk`, `update.vinaxmusic.online/*`, `admin.vinaxmusic.online/` and `admin.vinaxmusic.online/api/*`.

**Must NOT be Worker routes** (every routed request costs [daily quota](#the-daily-request-quota)): song/album/artist/playlist pages, the 72 hubs, `/vinaxai`, sitemaps (all static), the apex (`_redirects` 301s to `www`), retired `/ai-playlist*` and `/ai/shared/*` (301 Home; `hostRouting.test.ts`). Never route a page family to the Worker again.

```sh
cd backend
npm ci && npm run lint && npm run typecheck && npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
npm run deploy           # wrangler deploy --config worker/wrangler.toml
```

`npx wrangler login` once per machine. The **Deploy Worker** workflow also deploys (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; without the token it passes without deploying). Deploying registers the Cron Trigger.

### Database - once per project

Create the Supabase project; run `backend/supabase/schema.sql` in the SQL editor (also creates buckets `ai-attachments` and `console-media`); set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; check the console's **Database** page. Apply schema changes **before** the code that needs them ([Database](#database)).

### VinaX AI keys

Any one is enough: `GROQ_API_KEY` (default models, dictation, Read aloud), `GEMINI_API_KEY` (images, PDFs, Live voice), `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY` (paid, owner-only via `claudeAccess.ts`), `SEARCH_API_KEY` (required for web search; vars `SEARCH_API_PROVIDER` `tavily`/`serper`, `SEARCH_DAILY_LIMIT` 100, `0` = off). Workers AI needs no secret. Probe before switching on: `npm run ai:probe` with keys in `backend/worker/.dev.vars` (`-- --voice-only` for voice).

The chat is **off** until the `vinax-ai` setting (App Settings > Features & AI): `{ "enabled": false, "testers": ["<account id>"] }` = you only; `{ "enabled": true }` = everyone signed in; `{ "enabled": false }` = kill switch. Applies within a minute.

### VinaX AI sandbox host

Artifact previews run from `sandbox/` on `https://sandbox.vinaxmusic.online`: Pages project `vinax-sandbox`, branch `main`, no build, output `sandbox`, watch `sandbox/*`, custom domain added after the first deploy. Manual: `npx wrangler pages deploy sandbox --project-name vinax-sandbox`. Check `curl -sI` shows `default-src 'none'` and `frame-ancestors https://www.vinaxmusic.online`. Renaming the host means changing `VITE_AI_SANDBOX_ORIGIN`, `frame-src` in `_headers`, and the runner's `ALLOWED`/`frame-ancestors` together. Since 2026-11-18 the policy allows scripts from cdnjs, jsDelivr and unpkg and fetches from jsDelivr and unpkg only (three.js r160 ES modules and addons from `npm/three@0.160.0`, its example models, textures and HDR sky from the `gh/mrdoob/three.js@r160` mirror, Draco decoders, plus `blob:` and `data:` URLs the page makes itself, which three's model loader needs for a `.glb`'s embedded textures); the app, its API and everything else stay unreachable. A failed preview's **Fix it** asks the model that wrote the artifact, not Auto.

### Release checks

1. All gates pass locally, including the bundle budget and E2E against `dist/`; CI green for the exact commit.
2. After merge: the static build, and the Deploy Worker log if `backend/` changed.
3. Production: `/api/status`, Home, Search, playback to a queue's end, lyrics, Radio, `/admin/` Dashboard and Database Tables; phone and desktop, light and dark, new and returning profile.
4. Android: [Real-device QA script](#real-device-qa-script) before a `v*` tag. After an `assetlinks.json` change: 200 `application/json`, no redirect; `adb shell pm get-app-links app.Vinax.music` shows www verified.

### When a deploy does not land

| Symptom | Go to |
| --- | --- |
| New `/api/*` route answers `405` | [Runbook](#runbook-the-app-is-newer-than-the-api) |
| "Workers Builds: vinax-api" red | [The known-red check](#the-known-red-check) |
| Deploy Worker fails "Verify the Cloudflare token" | Rotate `CLOUDFLARE_API_TOKEN` |
| Stuck on boot splash | [Rollback](#rollback) |
| Console "database is not set up" | Database secrets or `schema.sql` missing |

## Secrets and environment variables

The frontend has none. Set each Worker secret with `cd backend && npx wrangler secret put <NAME> --config worker/wrangler.toml` (type at the prompt, never paste into files or chat); `npx wrangler secret list ...` shows them. Locally: `backend/worker/.dev.vars`; all names in `backend/.env.example`. The API server reads the same names from `/etc/vinax-api/env`.

### Worker secrets

| Names | Without them |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (never the anon key) | Rooms, feedback, push registration `503 not_configured`; sync `503 unavailable`; events dropped; config defaults; console setup cards |
| `ADMIN_LOGIN_PASSWORD`, `ADMIN_OWNER_EMAILS` | No recovery-password sign-in (delete it for Google only); no always-Owner emails |
| `AUTH_SECRET` (fallback `DEVICE_ID_SECRET`) | Signs app (30 d) and console (12 h) sessions; changing it signs everyone out |
| `DEVICE_ID_SECRET` (fallback `TELEMETRY_PEPPER`) | Devices cannot be told apart |
| `TELEMETRY_PEPPER` | Rate-limit keys use a built-in pepper |
| `CRON_SECRET` (optional) | `/api/cron/run` accepts only the owner token |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | No web push |
| `FCM_SERVICE_ACCOUNT` | No Android push ([setup](#android-push-setup)) |
| `CATALOG_UPSTREAMS`, `CATALOG_DIRECT_URL` (optional) | Catalogue wrapper list (6 s each, benched a minute on failure); changes without a release |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `SEARCH_API_KEY` | None: `/api/ai/*` `503 ai_not_configured` |
| `TURNSTILE_SECRET_KEY` | No sign-in check |
| `RESEND_API_KEY` | No emails; email sign-in `503` |
| `PAGES_DEPLOY_HOOK` | robots.txt changes wait for the next build |
| `GITHUB_TOKEN` (optional) | Update lookup rate-limited; `/api/version`, `/api/apk` `503` without release access |
| `CF_ANALYTICS_TOKEN`, `CF_ACCOUNT_ID` (both or neither) | No request meter or `quotaHigh`. Token: Account Analytics > Read only, never the deploy token |

Deletable leftovers: old `VINAX_..._API_KEY` names, `NVIDIA_BASE_URL`, `VINAX_MAESTRO_MODEL`, `SERPER_API_KEY`, `SERPER_DAILY_LIMIT`, `RESEARCH_DAILY_LIMIT`, the `CRON_SECRET` Actions secret.

### Worker plain vars, bindings

- Vars: `ASSETS_HOST` (`vinax.pages.dev`), `GITHUB_REPO`, `GOOGLE_CLIENT_ID` (sign-in `503` without it), `SEARCH_API_PROVIDER`, `SEARCH_DAILY_LIMIT`, `TURNSTILE_SITE_KEY`, `REALTIME_URL` + `REALTIME_KEY` (Listen Together live line; rooms poll without), `CF_ACCOUNT_ID`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
- Bindings: KV `HANDOFF` (IndexNow list, Android push reports), Workers AI `AI`, `RATE_LIMIT_10/30/60/300`, `ADMIN_AUTH_FAILS` (15 wrong tokens per 60 s).
- Frontend build (public): `VITE_API_BASES`, `VITE_APP_NAME`, `VITE_AI_SANDBOX_ORIGIN`, `VITE_BUILD_NUMBER`; `VINAX_PLAY_STORE_BUILD=1` drops `REQUEST_INSTALL_PACKAGES`; tests `E2E_*`, `QA_SWEEP`, `EVAL_*`; operator `CLOUDFLARE_ZONE_TOKEN` (Zone > Firewall Services > Edit; revoke after use).

### Repository Actions secrets

`CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers; plus Pages > Edit for the SEO workflow), `CLOUDFLARE_ACCOUNT_ID`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `SUPABASE_DB_URL` (Schema workflow), `LHCI_GITHUB_APP_TOKEN`.

### Google sign-in

Google project **VinaX Music** (`vinax-music`); the Worker verifies the ID token (`_lib/googleAuth.ts`) and issues its own session. Authorised JavaScript origins: `https://www.vinaxmusic.online`, `https://vinaxmusic.online`, `https://vinax.pages.dev`, `http://localhost:5173`, `https://admin.vinaxmusic.online`; a new domain must be added or the button will not load. Android needs the app's SHA-1 in the project.

### Email and password sign-in

Pages `/login`, `/signup`, `/forgot-password`; `?next=` must be a same-site path (`safeNext`). `POST /api/auth/email/code` mails a 6-digit code (15 min, 5 tries, 1/min); `/verify` creates an `em…` account or sets the password; `/login`; `GET/POST /api/auth/password`. bcrypt runs in Postgres because the free Worker has ~10 ms CPU. Needs the database and `RESEND_API_KEY`.

### Cloudflare Turnstile (sign-in security check)

Off until both keys exist. Dashboard > Turnstile > Add widget, hostname `vinaxmusic.online`, Managed; site key -> `TURNSTILE_SITE_KEY`, secret -> `TURNSTILE_SECRET_KEY`. Siteverify down: Google sign-in proceeds, recovery password refused. Android needs the WebView settings from `patch-android.js` (older APKs fail). Failures log `turnstile failed`.

### Account emails (Resend)

Welcome, sign-in alert (time, browser, IP, place), admin invite, Monday weekly summary (`_lib/email.ts`: one glass card in the app's black-and-green look with the mark and the VinaX Music wordmark; every colour has a solid fallback); console sign-ins send nothing. The weekly numbers come from `weekly_summary()` (two weeks of listening) and `stats_at_risk()` separately (schema 26), and the job stops after three failed reads in a week instead of failing every hour. Setup: Resend > Domains > `vinaxmusic.online`; add DKIM TXT `resend._domainkey`, `send` MX + SPF TXT as **DNS only** (plus `_dmarc` `v=DMARC1; p=none;`); Verify; Sending-access key -> `RESEND_API_KEY`. Test: Notification Rules > Account emails > Send me a test email (`validation_error` = domain not verified). Kinds switch off in the owner-only `email` setting. Free plan 100/day, 3,000/month.

## Operations

### Production at a glance

| Piece | Runs on | Deploys by |
| --- | --- | --- |
| Frontend | Static project `vinax` | Git, every push to `main` |
| API server | Oracle VM, `api.vinaxmusic.online` | `backend/server/deploy/deploy.sh` |
| Worker `vinax-api` | Edge routes | **Deploy Worker** workflow or `npm run deploy` |
| Android | GitHub release | Build Android APK / Release APK |
| Database | One Supabase project | `schema.sql` (Schema workflow) |

- The Worker owns `admin.` (to `/admin/`) and `update.` (package download).
- The apex is redirected to `www` by `_redirects` and zone rule "Apex to www", **never** the Worker. Lesson: an over-quota Worker on the apex answered 429 for `robots.txt` and Google stopped crawling. Keep robots.txt on every host off Worker routes.
- `status.vinaxmusic.online` uses zone rules: URL Rewrite "Status host serves the status page", Redirect "Status host to status page" (except `/icons/*`), Redirect "www status path to status host".
- Host-based `_redirects` lines never fire; host redirects are Cloudflare Redirect Rules.

### The known-red check

"Workers Builds: vinax-api" fails on every commit because the host's Git build token expired. Harmless while **Deploy Worker** is green. To clear: Workers & Pages > `vinax-api` > Settings > Build > reconnect or regenerate the token.

### Runbook: the app is newer than the API

Probe a route the newest backend added, e.g. `GET https://www.vinaxmusic.online/api/recommendations/similar/<real song id>?limit=5`: `404`/`405`/HTML shell = stale, JSON = fine. **Not** `/api/version` (that is the Android release). Fix in order: (1) rotate `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template), confirm `CLOUDFLARE_ACCOUNT_ID`, run Deploy Worker; (2) repair the host Git build; (3) `cd backend && npm run deploy`.

### Rollback

| Piece | How |
| --- | --- |
| Frontend | Promote the previous deployment |
| Worker | Its version history, separately |
| Settings | Console **Restore this version** (`settings_history`) or reset to built-in |
| Database | Nothing to roll back; re-run `schema.sql` after a partial paste |
| Android | Cannot recall; publish a fix; `min-version` can force it |

A cached bad asset: purge the edge cache; if cached immutable, bump the epoch (`-b3`) in `frontend/vite.config.ts`.

### The daily request quota

The Worker free plan allows **100,000 requests a day for the whole account**. When spent, Cloudflare answers error **1027** until 00:00 UTC (05:30 IST); a redeploy does not help. Since 2026-11-18 the app's `/api/*` traffic goes to the API server (no daily limit), so the Worker quota is used only by fallback traffic, admin/update hosts, `/img` and `/apk`.

The request meter (`_lib/cfAnalytics.ts`) reads Cloudflare's GraphQL Analytics (`workersInvocationsAdaptive`) with `CF_ANALYTICS_TOKEN` + `CF_ACCOUNT_ID`: totals by Worker and outcome, cached 10 minutes, **no request path** (use the dashboard's Worker Metrics). Warns at 80%, urgent at 95%; shown on Server Checks (`GET /api/admin/quota`), the Dashboard and Smart Alert `quotaHigh`.

**Scraper traffic on entity pages.** A 2026-10-06 scraper (fake browser agents, thousands of IPv6 addresses) took ~98% of requests on edge-rendered entity pages; they are now static files. To serve them from the Worker again, first add zone rules: `CLOUDFLARE_ZONE_TOKEN=... node backend/scripts/cf-edge-rules.mjs --dry-run` (then without the flag; `--challenge` adds the managed challenge) creates "VinaX entity pages: browser impostors" and "... unverified automation". A routed request is counted before any code runs, so `_lib/pageGuard.ts` protects CPU but not the quota.

### Running the API on a server

`backend/server/` runs the **same** `worker/index.ts` on Node: no daily request limit and no 10 ms CPU cap. Stand-ins in `server/bindings.ts`:

| Worker | Node server |
| --- | --- |
| `[vars]` | Baked into the bundle (`server/build.mjs`) |
| Secrets | `/etc/vinax-api/env` (`NAME=value`) |
| KV `HANDOFF` | `fileKv`, a JSON file in `VINAX_DATA_DIR` |
| Rate Limiting | `fixedWindowLimiter` in memory (global limits) |
| Workers AI | `workersAiRest` with `CF_ACCOUNT_ID` + `CF_AI_TOKEN`; skipped without the token |
| `request.cf` | Cloudflare headers; city/region/timezone need Managed Transform **Add visitor location headers** |
| `caches.default` | None; instance memory |
| Cron Trigger | `startCron`, only with `VINAX_CRON=on` |
| `ctx.waitUntil` | Tracked; stop waits up to 10 s |

`server/http.ts` converts Node requests to web `Request`s: drops hop-by-hop headers, streams bodies chunk by chunk (AI SSE), cancels the body when the client closes, keeps every `set-cookie`, and sends a `content-encoding: gzip|br|deflate|zstd` response plain without that header (Cloudflare compresses on the way out). `GET /__health` answers `ok` without touching the Worker code. Local: `cd backend && npm run server:build && VINAX_PROTO=http npm run server:start` (127.0.0.1:8787, reads `./.env`); tests `server/server.test.ts`.

**VM setup:**

1. `scp backend/server/deploy/{setup-vm.sh,vinax-api.service} ubuntu@<vm>:` then `ssh ubuntu@<vm> 'sudo bash setup-vm.sh'` (Node 22, `cloudflared`, security updates, user `vinax`, `/opt/vinax-api`, env file, systemd unit; opens **no** ports).
2. Fill `/etc/vinax-api/env` with every Worker secret plus `CF_AI_TOKEN` (Account > Workers AI).
3. Deploy from the Mac: `VINAX_VM=ubuntu@<vm> backend/server/deploy/deploy.sh` (builds, copies, restarts, checks `/__health`). It uses plain `ssh`/`scp`, so load the key first (`ssh-add ~/.ssh/vinax_oracle`).
4. Cloudflare Tunnel (locally managed, free), on the VM: `cloudflared tunnel login` (the owner authorizes the zone in the browser), `cloudflared tunnel create vinax-api`, `cloudflared tunnel route dns vinax-api api.vinaxmusic.online`, then `/etc/cloudflared/config.yml` (ingress `api.vinaxmusic.online` -> `http://127.0.0.1:8787`, else `http_status:404`, credentials file copied to `/etc/cloudflared/`) and `sudo cloudflared service install`. Delete `~/.cloudflared/cert.pem` afterwards; run `tunnel login` again to manage tunnels. Listening on localhost means client IP/country headers can only come from Cloudflare.
5. Jobs: turn the Worker cron off, then `VINAX_CRON=on` and restart. **Never both**, or jobs run twice.

**Production:** Oracle Cloud Free Tier, Hyderabad, VM.Standard.E2.1.Micro (1 GB RAM + 2 GB swap), Ubuntu 24.04, public IP `129.225.84.151`, user `ubuntu`, key `~/.ssh/vinax_oracle` on the owner's Mac. Tunnel `vinax-api` (id `e943750d-b2a2-42e1-843f-0284c9c6106c`, config `/etc/cloudflared/config.yml`). systemd services `vinax-api` and `cloudflared`; logs `journalctl -u vinax-api -f`. The env file was filled from the Worker's own secrets by a one-off encrypted transfer (a temporary Worker version, rolled straight back), so the values match. **Never upgrade the account to Pay As You Go** (owner wants free only).

**How the app reaches it:** `frontend/src/apiHost.ts`, imported by `main.tsx` right after `apexRedirect`, wraps `fetch` and `navigator.sendBeacon` on www and apex only (not local dev, previews or e2e) and sends every `/api/*` call, relative or `https://www.vinaxmusic.online/api/...`, to the API host. The Android app loads the same page from www, so it switches with the web. `/api/apk` and `/api/push/unsubscribe` (same-origin by design) stay on the Worker. If the API host cannot be reached (network error, or Cloudflare's own 5xx page instead of JSON), the call is repeated on the site's origin and calls go there for the next minute: a stopped VM degrades to the Worker and its quota, never to errors. Calls are cross-origin, so `backend/server/cors.ts` answers preflights from the app's origins (the asked-for methods and headers, cached a day) and adds `Access-Control-Allow-Origin`, `Vary: Origin`, `Access-Control-Expose-Headers: *`; Bearer tokens, no cookies, no credentials mode. The Worker stays deployed as the fallback and for `admin.`, `update.`, `/img`, `/apk`.

**To undo:** delete the `import './apiHost';` line in `main.tsx` and release: every call is back on the Worker at once.

### The database, operationally

- **New database:** run `reset.sql` if not empty, then `schema.sql`; set the two secrets (no deploy); check Database Tables. Data does not move; sessions survive and the first sync re-uploads from the device.
- **Retention:** hourly housekeeping purges events older than `retention.eventsDays` (180) and retires push devices silent 180 days; Database Maintenance runs the same by hand.
- **Delete a listener:** Settings > Delete account, or console profile > Delete user's data (reason + typed CONFIRM).
- **Old AI tables** (schema 2 databases): run `backend/supabase/remove-ai.sql` once.

### Scheduled jobs

Every 5 minutes (Worker cron `*/5 * * * *`, or `VINAX_CRON=on` on the server; never both) `_lib/jobs.ts` runs due jobs and records them in `job_runs`. Owner-only `jobs` setting `{ "<job>": { enabled, every } }`. "Running late" = no run for `max(2 x every + 15, 45)` minutes.

| Job | Default | Does |
| --- | --- | --- |
| `status-tick` | 30 min | Probes site, catalogue, console |
| `housekeeping` | hourly | Rooms, old events, push devices, deleted AI chats, 90-day `sign_ins`, 30-day `job_runs` |
| `alerts` | 5 min | Smart Alerts |
| `scheduled-notifications` | 5 min | Due pushes |
| `outreach` | hourly | Automatic notifications |
| `indexnow` | 6 h | New sitemap URLs to IndexNow |
| `weekly-summary` | Monday | Owner email |

By hand: Scheduled Jobs, or `POST /api/cron/run { "job": "status-tick" }` with `x-cron-secret` or the owner token.

### Monitoring

Status page `frontend/public/status/` reads `/api/status`; console Dashboard, Server Checks, Scheduled Jobs, Smart Alerts (no data = unknown, not healthy); the Synthetic uptime issue is the outside alert. Rate limiting (`_lib/ratelimit.ts`): in-memory bucket plus bindings, keys hashed with `TELEMETRY_PEPPER`; admin login locks out 10 minutes after 15 wrong tokens. `/img` exists only for share cards; each image costs a Worker request.

## Database

One file, `backend/supabase/schema.sql`, **schema version 25** (in `meta.schema`). RLS enabled **and forced** on every table with no policy, so the anon key gets nothing; functions are service-role only. Only server code talks to the database.

- **Upgrade = paste `schema.sql` again.** Idempotent; never deletes data (except 25 dropping `song_reactions`). `reset.sql` wipes everything.
- Apply **before or with** the code that needs it; until then the console shows "database update needed" (`502 db_update_needed`).
- **A schema bump must also update `SCHEMA_WANTED` in the Worker and the version assert in `check.sql`.**
- **Schema workflow:** with `SUPABASE_DB_URL` (session pooler URI `aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`, password URL-encoded; not the IPv6-only direct host), **every push to `main` touching `backend/supabase/**` applies to production**. PRs test it on fresh Postgres 16 (`schema.sql` twice, `check.sql`, `reset.sql`, again). Locally: `backend/supabase/ci.sh check <scratch url>` or `ci.sh apply "$SUPABASE_DB_URL"`. Never run `reset.sql`/`check.sql` on production.
- One-off scripts by hand: `remove-personal.sql`, `remove-ai.sql`.

### Rules every route follows

- Public route without the database: the shape the app handles (`503 not_configured`, empty lists, defaults).
- Admin GET without it: `200 { configured: false }`; failure: `502 { error: 'db_<reason>' }` (never a zero); admin POST: `503 db_not_configured`.
- Admin writes are POST `{ action }` through `audit()`. Geo comes from the edge; device ids from `identity.ts`, never the body. `?days=` is 1..90.

### Public routes that read or write it

`/api/events` (consent header), `/api/feedback`, `/api/room`, `/api/push/*`, `/api/auth/*`, `/api/account/data` (`409` on version conflict), `/api/profile*`, `/api/follow`, `/api/shared-playlist*`, `/api/charts/vinax` (`stats_trending`, >= 5 listeners, cached 3 h), `/api/ai/*` data, `/api/username`, plus reads of settings and status. Only `sign_ins` stores an IP (90 days); see [Data and privacy](#data-and-privacy).

## Owner console

At https://admin.vinaxmusic.online/admin/; plain scripts in `frontend/public/admin/`, no build step. Counts signed-in people only (app errors count every report).

- **55 pages** in eight sections (`GROUPS` in `app.js`), one job per page, no tabs, unique `group` + `order`; profile `#/user?id=<account id>`.
- **Old addresses:** `REDIRECTS` in `app.js`. **Server-side links (Smart Alerts, Dashboard) must use today's page ids.**
- **Colours** only in `css/theme.css` (`adminStyle.test.ts` enforces it); `innerHTML` is banned by a test.
- **Every page handles three answers:** `{ configured: false }` = setup card; `502 db_...` = "Could not load", never a zero; data.

### Sign-in and roles

Google sign-in for emails on **Admins & Roles** (`admins` table, schema 10+). Setup: add `https://admin.vinaxmusic.online` to the OAuth client's origins (else "The given origin is not allowed"); set `ADMIN_OWNER_EMAILS` (always Owners); `ADMIN_LOGIN_PASSWORD` = recovery Owner sign-in (delete for Google only).

| Role | Can |
| --- | --- |
| Viewer | See everything; writes `403 forbidden` |
| Editor | App Settings, notifications, feedback/error status, block music and users, A/B tests, sign devices out |
| Owner | All, incl. database upkeep, Admins & Roles, clearing errors, deleting user data, `retention`/`jobs`/`alert-rules`/`email` settings |

The Worker checks the role on every request (re-read from `admins` each minute). Sessions `adm1.<payload>.<hmac>`, 12 h, signed with `AUTH_SECRET`, header `x-admin-token`. `adminGet` = any admin; `adminPost` = editor unless the route asks for owner; `409 last_owner` protects the last Owner. Every write leaves an `audit_log` row (Change Log). In the app, `GET /api/auth/me` returns `user.admin: true` to show the **Admin dashboard** link.

### Adding a console page

1. `frontend/public/admin/pages/<area>.js` calling `VX.page({ id, title, group, icon, order, desc, render })`; old addresses into `REDIRECTS`.
2. Its `<script>` in `index.html` before `app.js`.
3. Route under `backend/worker/functions/api/admin/` with `adminGet`/`adminPost`, registered in `backend/worker/index.ts`; mocks in `frontend/e2e/support/console-mocks/`.

### Pages and their routes (key facts)

- **Dashboard** `GET /api/admin/overview`; **Users** `/api/admin/listeners`; **Notifications** `/api/admin/push` (signed-in devices only); **Smart Alerts** owner-only `alert-rules` (quiet hours hold all but `siteDown` and `quotaHigh`).
- **Server Checks** `GET /api/admin/quota` (meter); **API Keys Status** `/api/admin/envcheck` (Set/Missing, never values); push check `/api/admin/fcmcheck`.
- **Dashboard attention items** link to `db-maintenance`, `app-errors`, `feedback` (`status: new`), `notification-setup`, `listen-together`, `server-checks`; it waits at most 4 s for the meter.
- **Database pages:** `/api/admin/database`, Scheduled Jobs (`job_setting`, `run_job`), Change Log `/api/admin/audit`, Maintenance (typed CONFIRM).
- **App Settings** pages (`#/app-settings/<page>`, `VX.settingsPage`) write one `settings` key each via `POST /api/admin/settings { key, value }` (null = built-in; live within a minute; last 20 kept, **Restore this version**). Maintenance mode and forced updates need typed CONFIRM. Keys are `SETTING_KEYS` in `_lib/settings.ts`: Home Screen (`banners`, `greeting`, `broadcast`, `announcement`, `home-layout`), Features & AI (`flags`, `vinax-ai`), App Updates (`min-version`, which feeds `/api/version`'s `minVersion`/`updateMode`), Maintenance (`site-mode` `readonly`/`maintenance`, `maintenance-window`, `status-note`), Search & Music Sources, Help Center (`support-faq`), Data & Privacy (`retention`), and `push`, `push-audiences`, `outreach`, `email`, `alert-rules`, `jobs`, `robots`.
- **SEO:** robots.txt stays a **static file** (`robots-from-api.mjs`); saving bots calls `POST /api/admin/seo { action: 'publish_robots' }`, which fires `PAGES_DEPLOY_HOOK`. Page Check reads 40 pages per request to stay under the 50-subrequest limit.
- **Tests:** `frontend/src/__tests__/adminConsole.test.ts` (every page renders, unique ids, every old address redirects), `adminStyle.test.ts`, `frontend/e2e/console-*.spec.ts`, `backend/worker/__tests__/console*.test.ts`, `requestMeter.test.ts`.

## Android

Capacitor shell (`frontend/capacitor.config.ts`: `app.Vinax.music`, `server.url` = production site, `androidScheme` `https`, `allowMixedContent` `false`; **do not relax these**). Whoever controls the origin controls every installed app.

### How a package is built and released

| | Build Android APK (`buildapk.yml`) | Release APK (`release.yml`) |
| --- | --- | --- |
| Trigger | Every merge to `main`, or manual | Tag `v*` |
| `versionCode` | `1000 + run` | `1000000 + run` |
| Signed | Only with keystore secrets | Always (fails without) |
| Publishes | `v<version>-build<code>` with `vinax.apk` + `.sha256` | Release on the tag |

Steps (in `frontend/`): `npm run build` with `VITE_BUILD_NUMBER`; Java 21 + Android SDK; `npx cap add android`, `npx cap sync android`, `node scripts/patch-android.js`; write `versionCode`/`versionName` (from `package.json`) into `android/app/build.gradle`; sign from the decoded keystore; publish `vinax.apk` + SHA-256. Build Android APK also uploads artifact `vinax-debug-apk` (2 days).

- **Do not remove the release body's `VersionCode:` line**; `/api/version` reads it.
- A debug-signed package is never published; never sign a release with the public `frontend/ci/debug-keystore.b64`.
- Without a keystore a push skips the release (green); a manual run or a `[release]` commit fails.
- The update check compares build numbers only, so a phone on a tag build (> 1,000,000) is never offered `main` builds; once listeners have one, ship them from tags.
- No workflow sets `VINAX_PLAY_STORE_BUILD`: every CI package is the sideload variant.

### Building locally

`frontend/android/` is generated; never edit it. Node 22+, Java 21, Android SDK: `npm run cap:add:android`, `npm run cap:sync`, `npm run android:debug` (-> `android/app/build/outputs/apk/debug/app-debug.apk`; `versionCode` stays 1, so the update check offers the published build). `scripts/patch-android.js` (idempotent, after every sync) copies `native-android/` code and resources, writes `MainActivity`, and patches the manifest and Gradle; run it once after upgrading `@capacitor/android`.

### Native layer

`frontend/native-android/`: `VinaxMediaService` (media session, lock screen), widgets, `AudioRoutePlugin`, `DiscoPlugin`, `VinaxCastPlugin` (not yet run on a device), `VinaxPushService`. Audio plays in the web view; playback does not survive process death. The www link filter is verified by `assetlinks.json` (release key only). Updates (`services/update.ts`) compare build numbers, verify SHA-256, and honour `min-version`.

### What cannot be verified without a device

The Java is never compiled by tests. Use the [Real-device QA script](#real-device-qa-script) for playback controls, widgets, links, downloads, updates, push and casting.

## Android push setup

Closed-app notifications start once `FCM_SERVICE_ACCOUNT` is set; until then tokens are stored but nothing is sent (`fcmConfigured()` in `_lib/fcm.ts`).

1. Firebase project from `frontend/native-android/google-services.json` (**VinaX Music**, `vinax-music`, number `152181244509`, free plan; also runs Google sign-in) > Project settings > Service accounts > generate a new private key.
2. `cd backend && npx wrangler secret put FCM_SERVICE_ACCOUNT --config worker/wrangler.toml`, paste the whole JSON (and put it in `/etc/vinax-api/env`). No app rebuild needed.
3. Fingerprints: the app is registered under the CI key SHA-1 `71:27:BB:E2:25:1F:9E:A4:89:61:EC:9B:76:A5:07:5F:94:DE:A2:CC`; **published APKs use the release key**:
   - SHA-1 `D9:55:85:C3:D4:4F:52:92:47:39:7C:95:A0:E5:F9:D1:11:BA:62:BE`
   - SHA-256 `8C:AF:24:E7:AA:83:B7:EA:12:E1:2C:E3:FF:C1:14:DD:8C:EB:57:38:25:AB:EB:82:3E:FE:AE:E4:F2:6B:7C:CE`

   Add both in Firebase (Your apps > `app.Vinax.music` > Add fingerprint), the SHA-1 to an Android OAuth client (Google Cloud > APIs & Services > Credentials) and to the API key's Android restriction. Without them apps get no push token and cannot sign in with Google. Then replace `frontend/native-android/google-services.json` with the new download. Read any APK's fingerprint with `apksigner verify --print-certs vinax.apk`.
4. The release SHA-256 is also in `frontend/public/.well-known/assetlinks.json`; update it there if the key changes. **Never list the public debug key there** (anyone's APK could take over VinaX links).

The API key inside `google-services.json` is public: keep it restricted to Android apps (`app.Vinax.music` + release SHA-1) and to the Firebase Installations, FCM Registration and Firebase Cloud Messaging APIs. Rotating it cuts push until apps update.

**How it works:** `VinaxPushService.java` (a `FirebaseMessagingService`) posts the token to `/api/push/fcm-register` on `onNewToken` and every start, with the session when the page provides one; `services/push/nativePush.ts` uploads it linked to the account and routes taps. Tokens are stored in `push_devices` (channel `fcm`) and sent by `_lib/fcm.ts` with `android.priority: high`, `ttl: 86400s`, channel `vinax_picks`, title and body also in `data`. If pushes arrive only when the app opens, check console Notifications > Setup Check (`/api/admin/fcmcheck`). The old project `apptarangmusic` (`app.tarang.music`) is retired; delete its keys.

**Test delivery:** install the newest package, allow notifications, swipe the app closed, send a push from the console; it should arrive and open the target.

## VinaX AI

The chat assistant at `/vinaxai` (page `frontend/src/pages/VinaXAIPage.tsx`, code in `frontend/src/features/vinaxai/`, a lazy chunk). Server code: `backend/worker/functions/_lib/ai/` (below `_lib/ai/`), routes in `functions/api/ai/`. How listeners use it: [Listener guide](#listener-guide).

### How a message travels

```text
features/vinaxai/store.ts --POST /api/ai/chat--> api/ai/chat.ts
  session, rate limit, kill switch; conversation, daily count, memory, account read in parallel
  prompt.ts -> router.ts (Auto ladder or picked model) -> adapters/* -> provider
<-- event-stream: meta, title, [provider's own data: lines], sources, error, done
  reply saved in ctx.waitUntil; a reply only the page holds goes to POST /api/ai/keep
```

No key, upstream host or raw provider error reaches the browser; logs never carry message text. Since 2026-11-18 the API also runs as a Node server (`backend/server/`, no 10 ms CPU limit) at api.vinaxmusic.online, where Workers AI is reached through Cloudflare's REST API (`CF_ACCOUNT_ID` + `CF_AI_TOKEN`) instead of the `AI` binding.

### Providers and secrets

| Secret / binding | Provider | Used for |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq | GPT-OSS 120B (heads most ladders), Whisper dictation, Orpheus Read aloud |
| `GEMINI_API_KEY` | Gemini | Flash Lite (long ladder, titles), hand-picked Gemini/Gemma, Live voice, voice fallbacks |
| `OPENROUTER_API_KEY` | OpenRouter | `:free` models |
| `NVIDIA_API_KEY` | NVIDIA NIM | Nemotron 3.5 Bolt/Lightning/Super VL, Mistral Large 4 |
| `AI` binding | Workers AI | Hand-picked chat models only (shared ~10,000 neurons/day), Create image |
| `ANTHROPIC_API_KEY` | Anthropic | Claude Haiku 5.5 and 4.5, owner-only, paid |
| `SEARCH_API_KEY` + vars `SEARCH_API_PROVIDER`, `SEARCH_DAILY_LIMIT` | Tavily or Serper | Web search |

Any one key is enough; with none, `/api/ai/*` answers `503 ai_not_configured`.

### Models and the allowlist

`_lib/ai/models.ts` is the only file that names a model: id `<provider>:<upstream id>`, name, picker group, tier, flags (`vision`, `pdf`, `grounding`, `reasoning`, `artifacts`, `systemRole`), context and output sizes, `params`/`highParams`.

- **`APPROVED_MODELS`** (in `models.ts`) is the allowlist. `registryFor`/`pickerRegistryFor` (`config.ts`) drop everything else; a picked id outside it gets `400 unknown_model`. Model discovery is gone: add a model by adding its id, after a live test.
- **`PAUSED_MODELS`**: approved ids that failed a live test; offered nowhere. The daily `ai-model-check` job (`modelCheck.ts`, result in the `ai-model-check` setting) re-tests them; one that passed within two days returns to the menu, hand-picked only. Move it back into `APPROVED_MODELS` to restore it. A test asserts `MODELS` = approved + paused.
- OpenRouter's `:free` list rotates; `openRouterList.ts` hides a curated model OpenRouter no longer lists.

### Auto routing and failover (`router.ts`)

`pickLadder` uses cheap text checks, never a model call:

| Signal | Ladder starts with |
| --- | --- |
| Image in the last three questions | vision: Nemotron 3.5 Super VL |
| PDF, > 150,000 characters, or long project knowledge | long: Gemini 3.1 Flash Lite |
| Extended/Maximum, or judged hard | deep: GPT-OSS 120B, high reasoning |
| Code cues | code: GPT-OSS 120B, North Mini Code |
| Small talk | fast: Nemotron 3.5 Bolt |
| Anything else | default: GPT-OSS 120B, Bolt, Flash Lite, Nemotron 3 Ultra, Lightning, Mistral Large 4 |

No ladder uses Workers AI, Claude or Gemini 3.6/3.8 Flash. `preferFit` puts models that can see the images and hold the thread first; `preferLevel` (`thinking.ts`) favours real thinking switches at Extended/Maximum.

- **Failover** only before the first answer token (pass-through: before the provider's first `data:` line): no first event in 12 s (25 s deep/picked), network error, 4xx/5xx, empty stream. After that, an `error` event keeps the partial text. A picked model is never swapped; its error offers two `alternatives`.
- **Cooldowns** (`cooldown.ts`, per-isolate memory): 429 per `retry-after`, spent daily quota until reset, Workers AI 4006 until 00:00 UTC, 404/410 1 h, 401/402 whole provider 10 min, 5xx 30 s.
- `complete.ts` (`completeText`/`completeJson`) gives one non-streamed answer (used for live-voice call summaries, `callSummary.ts`); failure returns null.

### Thinking levels (`thinking.ts`)

The page sends `thinking: auto | fast | standard | extended | max`; each maps to a provider switch, falling back to the nearest lower level (`meta.thinking`).

| Model | Fast | Standard | Extended | Maximum |
| --- | --- | --- | --- | --- |
| Gemini 3 `thinkingLevel` | `minimal` | `low` | `high` | `high` + more output |
| Groq GPT-OSS `reasoning_effort` | `low` | `medium` | `high` | - |
| OpenRouter `reasoning.effort` | `low` | default | `high` | - |
| Claude Haiku 5.5 `effort` | `low` | `medium` | `high` | `max` |
| Claude Haiku 4.5 `budget_tokens` | none | 4,096 | 16,384 | 32,768 |

Extended/Maximum add `THINKING_BLOCKS` to the prompt. Auto thinking (`assessTask`) picks Fast, Standard or Extended from text cues. `ThinkSplitter` (`think.ts`) sends reasoning and `<think>` text to the thinking fold.

### Streaming: pass-through

The free Worker plan allows 10 ms CPU per request; relaying a long reply chunk by chunk cost about a second and the platform cut replies (`exceededCpu`). So `passthrough.ts` (`openModel`) waits for the first `data:` line, then `tee`s the body: one copy is piped untouched (`IdentityTransformStream`) to the page, the other is read only after that (`opened.whole()`, else the page gets the reply in one lump) and parsed once by the adapter's `parse` to save it. The page decodes provider lines itself (`features/vinaxai/wire.ts`, by `meta.wire`: `openai`, `gemini`, `workers-ai`, `anthropic`). **Never add per-chunk work in the Worker.**

- Output caps: NVIDIA/OpenRouter 16,384 (`LONG_OUT`), Gemini 32,768, Groq 8,192. A reply cut inside an open artifact is continued by the page up to three times (`AUTO_CONTINUES`).
- Replies over 1 MB raw (`PARSE_MAX_CHARS`) are not parsed: `done.saved: false`, and the page saves via `/api/ai/keep`.
- Stop, a broken stream or a closed page (`keepOnLeave.ts`, `keepalive` fetch plus a device draft `vinax.vxai.keep.v1`) also save through `/api/ai/keep`; `replaceKeptPart` only lengthens an `aborted` row.

### The chat endpoint and stream

`POST /api/ai/chat`: session, `RATE_LIMIT_30` per IP and per account, body <= 2 MB, text <= 400,000 characters. `research: true` runs [Research](#research-researchts); `personal.language` (a `LIVE_LANGUAGES` code) holds every reply to that language. `DELETE /api/ai/conversations { ids } | { all: true }` deletes several chats at once (the Chats page's selection, Settings → Delete all chats; 500 a request, shared links removed). `parentMessageId` places the turn (edits make siblings, `"root"`), empty content retries, `continueFrom` continues. Events: `meta` (ids, model, wire, thinking, route), `progress`, `title`, the provider's lines, `status`/`sources`, `error` (`{ code, retryable, alternatives? }`), `done` (`{ stopReason, usage?, saved }`). Refusals include `403 model_locked`, `409 conversation_full` (2,000 messages), `429 daily_limit`, `503 ai_disabled`.

### Claude (owner-only)

`adapters/anthropic.ts` calls the Messages API by plain fetch (the SDK would parse the stream in the Worker). Adaptive summarised thinking, no `temperature`, history capped at 340,000 characters to stay under Haiku 5.5's 100K-token price step, 65,536 output tokens (thinking counts against them). A reply that ends at `max_tokens` with thinking and no text is a `spent` error; the chat sends a `note` event and asks the same model once more at Fast (effort low) on the same stream (seen 2026-11-18: 32,768 tokens of thinking on a long "build a 3D store" request). `claudeAccess.ts` holds `CLAUDE_EMAILS`, matched against the account's Google-verified email; everyone else sees Claude locked and gets `403 model_locked`. No ladder or fallback ever calls Claude.

### Research (`research.ts`)

The composer's **Research** switch (the + menu, or the chip on the welcome) is Claude's Research scaled to a free search allowance: `planQueries` asks the `title` ladder for two to four different searches (`PLAN_PROMPT`; the question is material), the plain query is added when the planner left it out, `researchWeb` runs them all at once through `searchWeb` (each counted as one search), and `mergeSources` makes one numbered list (round-robin, duplicates out, at most 12). The prompt gets `<search_results>`, the citation rules and `RESEARCH_RULES` (answer first, short headings, cite everything, "What's still unclear"). Stream: `status` `planning` → `researching { queries, done }` → `searched`, `sources` with `via: "research"` and the queries, `meta.research: true`. Per person `limits.researchPerDay` (default 10, `ai_take_daily` kind `research:<account>`); past it the reply sends `status research_limit` and searches once like any turn. A planner that fails in 9 s means one plain search. Never grounding. `GET /api/ai/models` says `research: true` when it is offered.

### Web search (`search.ts`)

At most one search per turn (Auto, On or Off in the composer; Auto on recency cues), off when `vinax-ai.search` is `false`. Google grounding code stays but no approved model offers it, so every search uses the search API: Tavily, or Serper via `SEARCH_API_PROVIDER`; <= 6 results, cached 15-60 min, each call counted by `ai_take_daily` against `SEARCH_DAILY_LIMIT` or the owner's `limits.searchesPerDay` (default 100). Results go into the prompt as `<search_results>`; sources are saved in `ai_messages.sources`. The console's Web search card has **Test search** (`POST /api/admin/ai-search`).

### Prompt, files, artifacts, images

- **Prompt** (`prompt.ts`, snapshot test `__tests__/aiPrompt.test.ts`): base prompt, `<owner_instructions>`, `ARTIFACTS_BLOCK`, `<memory>`, project block, `<user_preferences>`, `<search_results>`. Never listening history.
- **Files** (`attachments.ts`, `materialize.ts`, `geminiFiles.ts`): images, PDFs (text read on the device by pdf.js; Gemini gets the file via its Files API) and text, streamed into the **private** bucket `ai-attachments` with an `ai_attachments` row; no public URLs.
- **Artifacts:** fenced `html`/`svg`/`mermaid` blocks plus `questions`/`quiz` cards, parsed by `splitFenced` in both Worker and page, saved in `ai_messages.artifacts`, gallery `/vinaxai/artifacts`. Previews run in `sandbox/index.html` at `sandbox.vinaxmusic.online`: `sandbox="allow-scripts allow-modals"`, no `allow-same-origin`, CSP in `sandbox/_headers` (scripts from cdnjs, jsDelivr and unpkg; fetches from jsDelivr and unpkg only), pinned React/Mermaid/chart libraries. `VISUALS_RULES` (prompt.ts) tells every model to build 3D with three.js r160 ES modules through an import map, with RoomEnvironment lighting, the example models, textures and HDR sky listed there, and to write a "What you're seeing" walkthrough under every visual.
- **Create image** (`images.ts`): FLUX.1 schnell on Workers AI, off by default (`vinax-ai.images`), per person `perDay` (default 10) and 50/day overall via `ai_take_daily`. Not yet tested against the real model.

### Voice (`voice.ts`, `voiceGate.ts`; page `mic.ts`, `readAloud.ts`, `live/`)

Each voice route is rate limited (`RATE_LIMIT_10`), needs a key and an owner switch, and answers `voice_busy`/`voice_unavailable`.

- **Dictation** (`/api/ai/transcribe`): Groq Whisper, then Gemini; text is never auto-sent.
- **Read aloud** (`/api/ai/speak`): Orpheus for short English replies, Gemini TTS for long ones and for Indian scripts (`isMostlyIndic`).
- **Live voice:** `/api/ai/live-token` mints a one-use Gemini ephemeral token; the page talks to the Gemini Live socket directly (models from `gemini-3.8-live` down). Setup: `VOICE_PROMPT`, voice, language rule, project instructions (2,000 characters), read-only memory, recent chat. Mic via `micTap.worklet.js` (must stay a same-origin file); `EchoGuard`/`NoiseGate` in `liveProtocol.ts`. It can control music (`live/musicTools.ts`), see camera/screen (`live/liveVideo.ts`) and run in a background bar (`live/liveCall.ts`). The transcript is saved via `/api/ai/live-transcript`, with a `callSummary.ts` summary. Audio is never stored.

### Live voice in the Android app

The web view sends call audio to the earpiece. `AudioRoutePlugin.java` (`VinaxAudioRoute`) picks the speaker or earpiece; `live/audioRoute.ts` wraps it (no-op on web/old APKs). Not verified on a phone.

### Projects, memory, sharing, feedback

- **Projects** (`projects.ts`): instructions <= 8,000 characters and up to 20 knowledge files (200,000 characters) in `<project_knowledge>`; max 100.
- **Memory**: <= 50 notes (`ai_memories`, switches `ai_memory_prefs`), learned in `waitUntil` every third message or on "remember" cues; `looksSensitive` rejects personal data. Incognito chats skip it. Settings → Memory has **Import** (`POST /api/ai/memories { texts }`, one note per line, repeats and secrets skipped, up to the room left) and **Export** (a text file).
- <a id="sharing"></a>**Sharing**: snapshot of the active branch in `ai_shares` (one link per chat, random 22-character id, `noindex`, no attachments or account info).
- **Thumbs up/down** (`feedback.ts`): one rating per reply in `ai_feedback`; the console shows 30-day totals (`ai_feedback_stats`).

### Owner switches (`vinax-ai` setting)

`enabled` (kill switch; anything but `true` = off), `testers` (account ids), `search`, `models` (per-model off/order), `instructions` (<= 4,000), `dailyLimit` (messages per person per UTC day), `memory`, `images`, and `limits` clamped by `LIMIT_RANGES` in `config.ts` (`messagesPerMinute`, `imagesPerMessage`, `filesPerMessage`, `filesPerChat`, `pdfMB`, `pdfPages`, `textMB`, `researchPerDay` (0 = Research off), `searchesPerDay`).

### The console's providers card

Console > App Health > AI Assistant (`GET /api/admin/ai`, owner only): keys set/missing, resting models, approved and paused models, today's usage (`ai_daily_usage`), Thumbs up, Web search card. **Probe** (`POST /api/admin/ai { model }`) tests one model.

### Data stored

`ai_conversations`, `ai_messages` (`sources`, `artifacts`), `ai_attachments` + bucket `ai-attachments`, `ai_memories`, `ai_memory_prefs`, `ai_shares`, `ai_feedback`, `ai_daily_usage`; functions `ai_take_daily`, `ai_conversation_search`, `ai_artifact_list`, `ai_export`, `ai_feedback_stats`. Page settings live on the device (`vinax.vxai.prefs.v1`: model, thinking, web search, voices, personalisation, reply language, chat font and text size, the finished-reply notification).

### The page, the way Claude's is (2026-11-18)

`features/vinaxai/`: the welcome shows the recent chats (`RecentChats.tsx`); `/vinaxai/chats` lists every chat with a selection and delete (`AllChats.tsx`, lazy); keyboard shortcuts in `shortcuts.ts` (⌘⇧O new chat, ⌘⇧K search chats, ⌘⇧S sidebar, ⇧Esc to the box, ⌘⇧C copy the last reply, ⌘, settings, ⌘/ the list; Esc in the box stops a reply; the app's palette keeps ⌘K) with `ShortcutsDialog.tsx`; selecting text in a reply shows **Ask about this**, which quotes it above the composer (`useSelectionAsk.ts`, `withQuote` puts it in the message as a `>` quote); tables carry **Copy as CSV** (`tableCsv.ts`); Settings → General has the chat font, Larger text, a finished-reply notification (`Notification` API, background tab only) and the shortcuts; Personalisation has the reply language (`languages.ts`).

## Recommendations on the device

Everything runs on the device, so listening history never goes to a server. Paths under `frontend/src/`.

### The pipeline

`planNextSongs(seed, ctx)` in `services/recommendation/engine.ts` (lazy chunk) plans mixes; `buildRecommendations(ctx)` runs it without a seed for Home. Since 1.20 the live queue does not use it: the queue follows Spotify's rules (`store/queueRules.ts`) and its Autoplay (`services/autoplay/`) asks `/api/recommendations?seeds=` for songs like the last five played (falling back to the catalogue's suggestions), dropping anything queued, played in the last 50 plays, hidden, in a muted language, or explicit under Kid mode. Hard rules never relax.

| # | Stage | Module | What |
| --- | --- | --- | --- |
| 1 | Candidates | `candidates.ts` | Related, favourites, album, related-artist, genre, style, proven, trending, intent, explore, history, rediscovery |
| 2 | Filter | `filters.ts` | Junk, too short, blocked, muted, snoozed, recent, heard-before, off-language; versions collapse |
| 3 | Score | `scoring.ts`, `weights.ts`, `vectors.ts` | Weighted terms, each kept as a reason |
| 4 | Rank | `reranking.ts` | Salted shuffle in close bands, diversity re-rank |
| 5 | Sequence | `sequencer.ts` | Energy arc, mood flow, artist spacing, language policy |
| 6 | Validate | `validation.ts` | Re-checks rules; soft rules relax, back-to-back artist last |
| 7 | Admit | `admission.ts` | The player re-checks each automatic addition |


Candidate gathering keeps at most six catalogue requests in flight, reuses answers for three minutes and stops waiting after `GATHER_STALL_MS` (900 ms) once the pool is big enough; a failed source only shrinks the pool. `trending` is a catalogue search, not a chart; `verified-trend` is empty today. **Canonical identity** (`identityCore.ts`, `songKey`: normalised title + primary artist) is shared with the Worker; both suites run `shared/identity-vectors.json`. A plan must finish within `NEXT_DEADLINE_MS` 8 s (3.5 s when the listener is waiting) and carries an `alg` stamp (`PIPELINE_VERSION` + weights version).

### Signals

- **Measurement:** seconds actually heard (`services/playback/session.ts`). PLAY = heard >= min(5 s, 70%); COMPLETE = natural end with >= 70%; SKIP = manual skip under 30% after PLAY counted (an earlier skip only moves this sitting's intent).
- **Taste profile** (`services/personalization/profile.ts`, `storage.ts`, `updater.ts`; persisted, decays). Weights (`eventWeights.ts`): PLAY 1.0, COMPLETE 2.0, FAVORITE 3.0, SEARCH_PLAY 1.5, PLAYLIST_ADD 1.0, QUEUE_ADD 0.5, SKIP -0.75, DISLIKE -1.5, SOFT_MUTE -3.75. Affinity halves 14 days after the last signal (skips 30). Passive plays of one artist or language count less as a sitting goes on.
- **Session intent** (`sessionIntent.ts`; 40-event ring, 45 min of silence ends a sitting): artist and language pull, songs skipped this sitting (hard-filtered), energy steer, discovery appetite.
- **Exposure ledger** (`exposure.ts`), **outcome and seed memory** (`recMemory.ts`), **heard-set** (`heardSet.ts`). Podcast episodes teach nothing (`learnsNothing`) and are never seeds.

### Tuning knobs

| Knob | Where |
| --- | --- |
| Scoring weights, source boosts, `TASTE_WEIGHTS` (hashed 256-slot taste vector) | `weights.ts` (`SCORING_WEIGHTS_VERSION`); no remote overrides, `applyWeightOverrides` is for tests |
| Sequencer costs, arcs `steady`/`build`/`wind-down`/`wave`/`lift`, transition memory | `sequencer.ts`, `transitions.ts` |
| Relaxation order: discovery allocation, familiar opening, artist cap, style quota, sitting-avoid, language mix, back-to-back last | `validation.ts` (do not reorder without the evaluation) |
| Familiar / Balanced / Discover: lean -1/0/+1, `DISCOVERY_SHARE` 5/20/45% | `discoveryMode` setting |
| Mix languages `'mix'` (seed + listener's languages, spacing rules) or `'one'` (lock); no longer in Settings since 1.20 | `queueLanguages` setting |
| Tunes and styles (`dj`, `folk`, devotional; `STYLE_MIN_SHARE` 0.8) | `tune.ts`, `style.ts` |
| `NEXT_BATCH` 5 (asked at <= 2 left), adaptive re-plan after two auto skips (`REPLAN_COOLDOWN_MS` 90 s), radio <= 5 seeds | `store/playerStore.ts`, `adaptive.ts`, `features/radio/radioSeeds.ts` |

### What is stored where

| Data | Where |
| --- | --- |
| Taste profile | device storage (`personalization/storage.ts`) |
| Session window | `sessionStorage` |
| Exposure ledger + snoozes | `localStorage` `vinax.recs.exposure.v1` (600 rows, 45 days) |
| Lifetime heard-set | IndexedDB `vinax-heard`, Bloom filter in memory (`bloom.ts`); in the backup, never account sync |
| Outcomes, seed memory | `recMemory.ts` (60 days; seeds 12 h) |
| Your Week | `localStorage` `vinax.weekly.v1` |

The ledger records shown, queued, played, completed, skipped and disliked (penalties 0.14-0.80, decaying over 3-60 days) and reaches the scorer as `ctx.exposurePenaltyOf`; it never admits a song the filter rejects. **Never repeat** (`neverRepeat`) makes `heard-before` a hard rule in `filters.ts` and `admission.ts` (mixes; the queue's Autoplay does not read it); a thin pool widens the sources (`RecommendationContext.widen`, `planWideLookups`), then the plan says `exhausted`.

### Home and catalogue routes

`buildRecommendations` builds shelves in `mixes.ts` (memoised 10 min). `surfacePolicy.ts` sets repetition per surface (resume, personal, discovery), `shelfLedger.ts` de-duplicates shelves, `homeOrder.ts` orders blocks, `useShelfSafety` filters at render. Your Week (`features/weekly/useWeeklyMix.ts`) builds 30 unheard songs with `widen: 2`. Separate from the engine, `backend/worker/functions/_lib/recs.ts` serves anonymous `GET /api/recommendations/similar/:songId` and `GET /api/recommendations?seeds=…` from the catalogue (`services/recs/similar.ts`).

### Debugging and evaluation

`?debug=recs` or `localStorage` `vinax.debug.recs` = `1` opens `features/recommendation/RecsDebugPanel.tsx` (trace, components, rejections); listeners see "Why this song?" (`explanations.ts`). Any rule or weight change must pass the tests beside the modules and `node scripts/eval-recs.mjs --no-baseline` ([Offline evaluation](#offline-evaluation-of-next-song-selection)). Never repeat must keep zero repeats in the 500-song sitting of `repetition.accept.test.ts`; identity changes need `identityContract.test.ts` plus the Worker suite.

## Offline evaluation of next-song selection

`frontend/eval/` runs the real recommendation engine against synthetic listeners, with the catalogue mocked. It measures rule compliance, diversity, fallbacks and latency, but not enjoyment. Run it by hand from `frontend/`:

```sh
node scripts/eval-recs.mjs --no-baseline        # working tree only (~3 min)
node scripts/eval-recs.mjs --baseline <commit>  # side by side; the commit must contain services/recommendation/recMemory.ts
```

- **The gate** (`recs.eval.ts`) fails if a run is not deterministic or breaks a hard rule. Hard rules cover Kid mode, muted languages, hidden songs or artists, recent repeats, skipped songs and unplayable songs. Everything else is a reading. Bump `EVAL_FIXTURES_VERSION` when a fixture changes.
- **Before you change the engine:** run `npx vitest run src/services/recommendation`, which includes `repetition.accept.test.ts`. Then run the evaluation before and after the change and read every line.
- **Real outcomes** come only from the consent-gated `rec_served` and `rec_outcome` events (`services/analytics/recTelemetry.ts`). Neither carries a song. A/B arms (`REC_TASTE_ARMS` in `engine.ts`) are created in the console. For an A/B test:
  - Fix one metric and the reading date in advance.
  - Compare rates per device.
  - Plan on roughly 1,500 outcomes per arm to see a 5-point change.

## Design system

- **Tokens** (`frontend/src/styles/tokens.css`) are semantic: `--surface-*`, `--text-*`, `--accent*`, `--line-*`, `--radius-*`, `--space-*`, `--elev-*`, `--z-*`, `--dur-*`, `--ease-*`. They are built on the palette channels (`--ink-*`, `--ember-*`, `--tide-*`), which the app style sets. Colours hold RGB channels (`rgb(var(--ink-900))`). Older names (`--vx-*`, `.btn-*`) still work.
- **Style guard** (`src/__tests__/styleGuard.test.ts`):
  - There are no raw `999px`/`9999px` pills.
  - `ui.css` is token-only.
  - Other stylesheets may only *lose* raw hex colours and raw `ms` durations against their baseline. Never raise a baseline. Add a token instead.
- **Primitives** are in `src/components/ui/` (styled in `styles/ui.css`), motion helpers in `src/utils/motion.ts`, and `/design` is the living style guide.
- **Layers:**

  | Layer | Switch on `<html>` | Lives in |
  | --- | --- | --- |
  | Base | - | `index.css`, `shell.css`, `features.css`, `pages/*.css` |
  | App style | `data-template` | `styles/templates/` |
  | Accessibility | `.hc`, `.reduce-motion`, `.light`/`.dark` | `index.css`, `tokens.css` |

- **Style contract** (`templates.test.ts`):
  - A style file styles only `html[data-template='<id>']`.
  - Colour blocks put `:root` on that selector.
  - Rules win by specificity, not load order.
  - High contrast outranks every style.
  - Text and accent clear WCAG AA in both light and dark.
  - The canvas equals `--ink-900`.
  - A style may change looks, but not behaviour, settings, hit areas or focus visibility.
- **Paint path:** an inline script in `index.html` reads `vinax.settings.v1` before first paint and sets the theme class, `data-template` and the canvas. `applyThemeClasses` in `utils/theme.ts` keeps them current. Settings offers the theme as three preview cards (`ThemePicker`), and a change of look cross-fades inside a View Transition (`.vx-theme-vt` in `shell.css`, from `layouts/AppLayout.tsx`).
- **Glass:** the window is a mesh of the artwork colour. Panels are translucent but do not blur. Bars, sheets and menus use `.vx-mat-*` materials. Text fills keep their opacity floors (`glass.test.ts`). **Never put a material on a row in a scrolling list.**
- **Type:** Figtree only. Never set a font on `#root` (`typography.test.ts`).
- **Overlays:** use `<Sheet>`. Anything else portalled to `<body>` needs a dialog/menu role or `data-vx-overlay`.
- **Hard rules:**
  - No raw hex in components. Chart and canvas palettes are the exception.
  - No arbitrary radii.
  - Icon-only controls use `IconButton` with a `label`.
  - Touch targets are at least 44px.
  - Scripted scrolls use `scrollBehavior()`.
  - Sticky elements read `--vx-topbar-h`.
  - Safe areas are read through `--safe-top` / `--safe-bottom` / `--safe-left` / `--safe-right` (index.css), never `env(safe-area-inset-*)` directly: the Android app (Capacitor 8, edge to edge) answers 0 for `env()` and publishes the real insets as `--safe-area-inset-*` on `<html>`, which those tokens read first. The status bar icons follow the theme (`setSystemBarsStyle`).
  - Every animation obeys both reduced-motion switches (OS and in-app).
  - The owner console gets its tokens from `npm run gen:admin-tokens`.

## App styles

VinaX has one look, `vinax`: black and green with glass, in System, Light or Dark (`templates/vinax.css`). Light is "meadow glass" (`templates/vinax-light.css`, every rule starts with `html.light`): a blurred meadow (`public/bg/meadow.svg`, drawn for VinaX) fixed behind the window, always coloured: the logo's orange into pink (#ffa42e → #ff6384) when nothing plays or the cover is grey, the playing song's colour (`--art`) while one plays, laid over it in the `color` blend through the registered `--vx-song-a`/`--vx-song-b` so only the hue changes and it fades, liquid glass panels (26% white at the default Glass level, floored there, with a diagonal sheen and edge lighting: bright top, softer sides and foot, an inner glow; no backdrop filter on panels, the meadow is already soft and kept light enough instead — `glass.test.ts` checks text AA over the meadow's darkest green in every song hue, so keep the SVG no darker), bars, mini player and sheets that float over the page blurred with a floor that holds AA on black (66%, sheets 74%), larger corners, and a floating glass player bar. Light's colours are the logo's: warm neutral inks; accent orange `226 100 22` for fills and rings (black labels), burnt orange `168 58 16` for accent text, pink `226 74 112` / `176 40 84` as the second colour; play, Start listening and the Free forever badge wear the logo gradient (#ffa42e → #ff6384, black labels); main buttons are apricot glass with burnt-orange type. Reduced transparency thickens all of it. Older style ids map to it through `LEGACY_TEMPLATES` in `utils/theme.ts`. The `template` setting stays, so a second look can be added. From 768px the layout is a window bar plus three panels: Your Library, the page, and (from 1280px) Now playing. Phones get a tab bar (`DOCK_NAV`). User-facing copy never names another product.

### Adding an app style

1. In `utils/theme.ts`, add the id to `TemplateId` and to `TEMPLATE_CANVAS`.
2. Add the same canvas to the pre-paint table in `frontend/index.html`.
3. Add a `TemplateOption` to `constants/templates.ts`, and update the count in `templates.test.ts`.
4. Create `styles/templates/<id>.css`: the colour block, then the dials, then layout rules.
5. Import it from `styles/templates/index.css`.
6. Add a way to choose it. The picker was removed.
7. Run `npx vitest run src/constants/templates.test.ts src/utils/theme.test.ts src/constants/typography.test.ts src/__tests__/contrast.test.ts`.
8. Build, then run `node scripts/csp-hashes.mjs`.
9. Check every page at phone and desktop widths, with high contrast and reduced motion.

## Charts, trends and canvas clips

- **Labels:** every list says what it is: a chart (from a cited outside source), editorial (with evidence, and it expires) or a catalogue list.
- **Trends are off.** `GET /api/trends` always returns empty items. The app calls it only if `TRENDS_CONNECTED` in `backend/worker/functions/_lib/clientConfig.ts` is true. To turn trends back on, you need a source/region/time store, providers whose terms allow rank data, and a quota-capped ingest. The kept code is in `api/trends.ts`, `_lib/trends/` and `frontend/src/services/trends/`.
- **What Charts shows:**
  - **Most played on VinaX this week** comes from `/api/charts/vinax` (`features/charts/vinaxChart.ts`). It shows only when at least 10 songs pass `useShelfSafety`. `/top-songs` uses it too.
  - Below that come the catalogue's chart playlists (`/charts`) and trending feeds.
- **Feed limit:** catalogue feeds ask for at most 24 items (`MAX_FEED_LIMIT` in `services/api/catalog.ts`). Above that the catalogue fails.
- **Canvas clips** (`components/SongCanvas.tsx`):
  - A clip fills the screen when it is close to the screen's shape. Otherwise it plays whole over a blurred copy.
  - Today only 540p and 360p exist. `services/canvas/quality.ts` probes higher sizes daily and uses them once they appear.
  - Clips made for VinaX should be 9:16 at 1080x1920 (or 16:9), a 3-8 s loop, H.264, no audio, under ~4 MB, with `+faststart`.

## Data and privacy

This section is written from the code. Any change to what is collected (or adding advertising) must update `frontend/src/pages/PrivacyPage.tsx` and this section in the same change. Consent is enforced in `services/analytics/telemetry.ts`, `recTelemetry.ts` and `sessionInsights.ts`.

**Commitments**

- Library, history, settings and the taste profile live on the device. A signed-in listener's data also syncs to the account as one copy.
- The heard-set never leaves the device, except in an exported backup.
- Nothing about listening goes to an AI service. Voice search uses the device's own speech recognition.
- Usage statistics are on by default and off with one switch (Settings > Region & privacy). The welcome checkbox starts ticked and says so. While it is off, nothing is sent.
- Session insights (third-party masked replays) are opt-in.
- There is no advertising, and the CSP allows no advertising hosts.
- The server keeps no precise location. An IP is kept only in the 90-day `sign_ins` history. Rate limiting uses a peppered hash of the address.

**Accounts**

- Personal pages need an account. Privacy, Terms, Contact, browse pages and shared Flow links work signed out.
- **Google:** `accounts` stores the Google id, email, name, picture URL, linked device, and coarse geo, platform and version (no IP).
- **Email and password:** only a bcrypt hash of the password is kept (`account_passwords`). A 6-digit code is stored as a keyed SHA-256 hash (`email_codes`). The code dies once used, after 5 wrong tries or after 15 minutes, and is then deleted.
- **Sign-in history (`sign_ins`):** time, IP, browser, platform, version and geo. Rows are deleted after 90 days and with the account.
- **Emails** go through Resend, which receives the address, first name and text: a welcome email and sign-in alerts showing IP and location. There are no marketing emails.
- **Sync (`account_backups`):** one copy, at most 2 MB, in the backup format. It never includes the heard-set, searches or device identity.
- The session goes only to the `/api/auth|account|personal|ai/*`, `/api/profile`, `/api/follow` and `/api/shared-playlist` routes. **Delete account** (Settings > Profile) removes everything that cascades from the account.

**On the device**

| Where | What |
| --- | --- |
| `localStorage` `vinax.*` (`constants/storage-keys.ts`) | Settings, player and queue, library, history (last 150), searches, taste profile, region, name, playlist share links and invite tokens, blends, recommendation memories, VinaX AI prefs, loudness (last 500 songs), podcast places, install id `vinax.device-id`, usage choice `vinax.analytics-consent` |
| `sessionStorage` | Boot counters, the restore Undo snapshot, the live Listen Together session |
| IndexedDB `tarang-db`, `vinax-heard` | Listen-event log; lifetime heard-set |
| Cache `vinax-shell-*`, `vinax-audio-v1`; Android storage | App shell; downloaded songs |

**What leaves the device**

- **Always, to make features work:**
  - Catalogue: search words, ids and language.
  - Audio and artwork hosts: the URLs.
  - Lyrics database: title, artist and duration.
  - Worker config, `/api/charts/vinax` and `/api/geo` (at most every 12 h): nothing personal.
  - `/api/username`, `/api/feedback` and `/api/push/*`: what they need, plus edge geo.
  - Listen Together (`/api/room`): room state and display names. Only the host key unlocks names. Idle rooms are swept after 6 h. The Supabase Realtime line relays chat and position but stores nothing.
- **VinaX AI (signed-in use only):**
  - Messages go to the answering provider, which the privacy page names.
  - Chats are stored (`ai_conversations`, `ai_messages`). A deleted chat is removed within a day.
  - Files are kept in a private bucket and deleted with their chat or account.
  - Web search sends the search words to Google, Tavily or Serper. Create image sends the description to Cloudflare Workers AI.
  - Voice goes to Groq or Google only on a button press. Audio and Live voice video frames are not stored.
  - Memory holds at most 50 notes of 200 characters. Learning sends a small model the notes and the last 3 messages. Sensitive categories are refused, and notes are kept until deleted.
  - Shared links are made only on Create link. They are snapshots without reasoning or identity, use 128-bit ids, and are `noindex`.
  - Logs hold only route, model, provider, latency, status and tokens.
  - Export everything with `GET /api/ai/export`.
- **Only with usage sharing on:**
  - `/api/events` gets the event type, platform and version, plus the song (id, title, artist, language) or the search words (at most 80 characters).
  - A `play` is sent at 5 s heard, or at 70% of a shorter song.
  - The Worker stores a server-derived device id instead of the install id, and drops events without the `x-vinax-consent` header.
  - The weekly chart counts a song only after 5 different accounts play it, and never shows who played it.
- **The choice** is enforced on every send by `consented()` and the header. Turning usage sharing off takes effect at once, and session insights stop after the next reload. Backups do not carry the choice. Rows already sent stay until the retention purge.

**On the server**

| Table | Removed when |
| --- | --- |
| `listeners` (server device id, name, device, geo) | Owner deletes the person |
| `accounts`, `account_backups`, `sign_ins` | Delete account or owner delete; `sign_ins` also after 90 days |
| `ai_*`, `ai_feedback` | Their delete actions, or with the account |
| `events` | `retention.eventsDays` (default 180), owner purge, or with the person |
| `feedback` | Owner deletes; detached from a deleted person |
| `profiles`, `follows`, `shared_playlists` | Remove my profile or account deletion; a hosted room code clears when the room ends |
| `push_devices` | Marked inactive on unsubscribe or after 180 days |
| `rooms`, `room_members` | Host ends, member leaves, or idle 6 h / 1 day |
| `outreach` | After 180 days |
| `HANDOFF` KV push reports | After 30 days |

The owner's console delete removes a person's device row, events, memberships, account and backup, and records the reason in the audit trail. Database Maintenance can purge old events for everyone. A local erase removes nothing on the server.

**Backup file** (Settings > Your data; `features/settings/backup.ts`)

- The file is unencrypted JSON (`"format": "vinax-backup"`, `schemaVersion` 2), with categories for settings, library, history, taste, searches, Home layout and the heard-set.
- It never includes downloads, device ids, room host keys, the usage choice or VinaX AI chats (`BACKUP_EXCLUSIONS`).
- Files over 8 MB, foreign files and newer versions are refused.
- Restore offers Merge or Replace per category, all or nothing, with **Undo that restore** until the tab closes.
- Reset app state erases the listen log, the heard-set and every `vinax*` key.

## SEO and indexing

- **Static only.** The build writes the prerendered routes, the mood x language hubs, entity pages and every sitemap as static files. **Do not route page families or sitemaps to the Worker**, because that spends the daily request quota.
- **Unbuilt entity URLs return 404.** Under `/song/`, `/album/`, `/artist/`, `/playlist/` and `/lyrics/`, an unbuilt id gets that folder's `noindex` `404.html` app shell, written by `scripts/prerender.mjs`. Built pages link only to built pages.
- **robots.txt stays static on every host.** A Worker-served copy once answered 429 and Google stopped crawling. `vinax.pages.dev` and `status.` are `noindex`.
- **Builds never shrink the site.**
  - A build with fewer than 300 entity pages (`ENTITY_MIN_PAGES`) fails.
  - A build that would drop more than 20% of live pages fails.
  - The build reads `musicapi.vinaxmusic.online` first.
- **Nightly growth:** `seo-pages.yml` adds up to 3,000 pages a night, up to 18,800. The Pages Free plan allows 20,000 files. Refresh `scripts/seo-wanted.txt` by hand.
- **Redirects:** host redirects are Cloudflare Redirect Rules, not `_redirects`. IndexNow runs every 6 h. Song ids are dashed (`<slug>-<id>`).
- **Owner checklist:** submit `https://www.vinaxmusic.online/sitemap.xml` and review the URLs that are not indexed.

## Legal and copyright

This is a summary, not legal advice. The pages are `/terms`, `/privacy`, `/dmca` and `/contact`. The repository has no licence file.

- **Service:** VinaX is a free player. It hosts no media, charges nothing and sells no data.
- **Copyright:** songs, recordings, artwork and lyrics belong to their owners, and attribution is shown as the catalogue gives it.
- **Takedowns** come through `/dmca` or `/contact`. A verified request goes on the server blocklist (`/api/blocklist`), which every client reads.
- **Ads:** none.
- **Listener data:** see [Data and privacy](#data-and-privacy).
- **Disclaimer:** the service is provided "as is". The catalogue can change without notice.

## Real-device QA script

Run Part 1 (one phone, about 22 min) before every release. Run Part 2 before an Android release, and after any change to the audio engine, media session, native files or service worker. Devices are **A** the Android app, **B** a phone browser, **C** a desktop browser and **D** a TV. For a fail, record the device, step and exactly what you saw.

**Part 1**

1. **Welcome:** the steps, Skip and the ticked usage box all work. Home paints, and nothing scrolls sideways at 360px.
2. **Layout:**
   - Panels appear at 1440 and 1280px, and a rail at 1024 and 768px.
   - At 390 and 360px the tab bar and mini player fit, and **Open queue** is reachable.
   - High contrast is readable.
3. **Reduced motion:** nothing slides.
4. **Lock screen:** controls and headset buttons work, and switching output keeps the position.

**Part 2**

5. **Offline:**
   - Downloads play in airplane mode.
   - **Download all** finishes, and failures give their reason.
   - The iPhone Home Screen app opens offline.
6. **Queue:**
   - Added songs play next and survive starting another album.
   - Clear queue empties only Next in queue.
   - Autoplay follows when the list ends, and stops with repeat on.
   - Check whether playback resumes after a call.
7. **Notifications:**
   - A console test notification opens its song.
   - On Android it arrives with the app closed ([Android push setup](#android-push-setup)).
8. **Updates** (A): Update later holds, and data survives the install.
9. **Backup:**
   - Merge and Replace match the preview.
   - Undo works.
   - A bad file changes nothing.
10. **Listen Together:**
    - Two phones stay in sync.
    - Guest songs, pause or play for everyone, remove, Vote to skip and the old-app warning work.
    - Follower **Join** works.
11. **Search and TV:** misspellings work, and the TV remote reaches every control.
12. **Casting:**
    - Playback continues on the TV, and the TV remote is followed.
    - Stop restores phone audio.
    - With no Play services, nothing breaks.
13. **Karaoke vocals:** Low, Off and Full each work.
14. **Links** (A): app links open in VinaX, and shared text opens the right place.
15. **Maintenance** (owner, last): the screen shows within about a minute, and it clears without a refresh.

## Listener guide

VinaX is free, with no ads. Sign in with Google or with email and a password. **Help** has tutorials, FAQs and **Replay the welcome tour**.

- **Start:**
  - Pick your languages and tap songs you like.
  - On the web, **Explore VinaX first** lets you browse signed out.
  - On iPhone: Share > Add to Home Screen.
- **Play:**
  - Tap a song in an album or playlist, and the rest of it plays after; then Autoplay plays similar songs.
  - ⋯ > **Add to queue**. Your songs play next, in the order you added them.
- **Queue page:** Now playing, Next in queue (**Clear queue**), Next from and Autoplay, with shuffle, repeat and the Autoplay switch; **Recently played** is the second tab.
- **Now Playing:**
  - Swipe the artwork to change songs. Double-tap the edges for ±10 s, or the centre to like.
  - It also has Lyrics, Karaoke, Disco lights and the Sleep timer.
- **Discovery:** Settings > Recommendations offers Familiar, Balanced or Discover, plus pinned and muted languages. Song menus have More/Less like this, Snooze and Never play.
- **Search** by name, lyric line or voice.
- **Flow:** swipe through music videos. Double-tap to like, and use **Play the song** or **Share**.
- **Listen Together:**
  - Library > Listen Together > Start a session, then share the code or link.
  - Rooms have chat, reactions and **Fine-tune this phone** for Bluetooth delay.
- **Friends:** a public profile at `/u/<handle>`, Follow, **Blend**, shared playlists and artist release alerts.
- **Library and backup:**
  - Your library follows your account.
  - Settings > Your data > Back up and restore exports a file, and restores it with Merge or Replace.
- **Look:** Settings > Appearance.
- **VinaX AI:** a chat assistant (sign-in needed). It has models, web search, **Research** (several searches and a cited report), files, memory (import and export), projects, Live voice, recent chats on the welcome, a **Chats** page, a reply language, and keyboard shortcuts (`Ctrl/Cmd + /`). Select text in a reply for **Ask about this**.
- **Android:** Home > **Get the VinaX app**. It adds downloads, lock-screen controls, widgets, push and casting.
- **Keys:**

  | Key | Action |
  | --- | --- |
  | `Space` | Play or pause |
  | `←` / `→` | Seek ±10 s |
  | `n` / `p` | Next or previous song |
  | `f` | Like |
  | `?` | All shortcuts |
  | `Ctrl/Cmd + K` | Command palette |

## Documentation conventions

- `README.md` is the only Markdown file in the repository. `VINAXAI_BRIEF.md` is git-excluded.
- Update the matching section instead of adding new docs, and do it in the same change as the code.
- Keep internal links as `#anchors`.
- Code comments cite sections as `README.md (<Section>)`. If you rename a heading, update those comments.
- Describe what the code does now. Every command must exist in a `package.json`, a scripts folder or a workflow.
- Name third parties only where a maintainer must type them, or in the VinaX AI and privacy exceptions.

## History

- Release notes are in `frontend/src/constants/changelog.ts` / `changelog.json` and appear in the What's New card.
- Versions restarted at 1.0.0 after 15.0.1. Older audits and write-ups are in git history.
- 1.14 removed all AI from the music side.
- 2026-11-18: release 1.17.3 moved the app's API calls to its own server at `api.vinaxmusic.online` (Oracle Cloud Always Free VM), with the Worker as fallback.
