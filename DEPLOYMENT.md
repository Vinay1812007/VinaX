# Deploying VinaX

This document covers how the two halves of VinaX reach production: the static frontend in `frontend/` and the `vinax-api` Worker in `backend/`, plus the one-time database setup the Worker needs. It lists the hosting settings, the manual deploy commands, how a release flows from pull request to production, the pre-release checks and where to look when a deploy does not land. Day-two topics — secrets, monitoring, the stale-Worker runbook, the known-red dashboard check and rollback — are in [docs/operations.md](docs/operations.md); the database itself is in [docs/database.md](docs/database.md). Host and secret names appear here because a maintainer has to type them.

Both applications live on `main`. There are no separate frontend and backend branches.

## How a release flows

```text
branch ─► pull request ─► CI + E2E green ─► merge to main
                                              ├─► Auto release ─► "release: x.y.z" commit on main
                                              │        ├─► static host builds frontend/  ─► site
                                              │        └─► Build Android APK ─► repository release (when signing secrets are set)
                                              └─► Deploy Worker (backend/** changed) ─► vinax-api
```

1. Open a pull request. `ci.yml` runs lint, typecheck, unit tests, build and the bundle budget for `frontend/`, and lint, typecheck, tests and a Worker dry-run for `backend/`. `e2e.yml` builds the app and runs the browser suite.
2. Merge to `main`.
3. The static host's Git integration builds and publishes the frontend. No workflow in this repository deploys the frontend.
4. When the merge touched `backend/**`, `worker-deploy.yml` runs the backend gates again, verifies the deploy token, runs `wrangler deploy`, and polls `/api/status` until it answers `200`. The host's own Git build for the Worker may deploy the same commit as well; that is harmless.
5. `auto-release.yml` bumps the version and the What's New card from the merge (unless the merge did it by hand) and pushes the release commit; it then dispatches `buildapk.yml`, which builds the Android package and publishes a signed release when the signing secrets are present. Pushing a `v*` tag runs `release.yml`, which refuses to publish without the release keystore.

A pushed commit, green checks and a verified production are three separate milestones. Record which ones have actually happened.

## Frontend — static hosting

Project `vinax`, connected to this repository:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22 or newer |

`npm run build` cleans `dist/` and the build caches, typechecks, builds, prerenders the static routes (`scripts/prerender.mjs`), prerenders the song, album and artist pages (`scripts/prerender-entities.mjs`) and writes `dist/changelog.json` (`scripts/changelog-json.mjs`).

The song, album and artist step runs only on the static host's own build, which sets `CF_PAGES=1`; elsewhere it writes an empty `dist/entity-pages.xml` and stops (set `PRERENDER_ENTITIES=1` to run it locally). It picks the most-played songs of each hub language from the public catalogue mirrors, never from this site's `/api`, plus their albums and lead artists (about 750 pages, about a minute), and renders them with the Worker's own `entityPage()` as flat files such as `dist/song/<slug>-<id>.html`, served at `/song/<slug>-<id>`. A dead mirror or the six-minute budget means fewer pages, never a failed build. `dist/entity-pages.xml` lists what was built, and the sitemap index points to it. Limits: `ENTITY_SONGS_PER_LANG`, `ENTITY_MAX_ALBUMS`, `ENTITY_MAX_ARTISTS`, `ENTITY_CONCURRENCY`, `ENTITY_BUDGET_MS`.

Keep the custom domains (`www.vinaxmusic.online`, the apex, `admin.`, `update.`, `status.`) attached to the static project. It is the origin the Worker passes every unmatched URL to. The static project needs no environment variables and no secrets.

Manual deploy, from `frontend/`:

```sh
npm ci
npm run deploy:pages     # npm run build && wrangler pages deploy dist --project-name vinax
```

`frontend/public/_headers` carries the content-security policy, including hashes of the inline scripts in `index.html`. The pre-paint script holds the app-style canvas table and the generated festival window table, so adding an app style or running `npm run gen:festivals` changes it. If you change an inline script, build, then run `node scripts/csp-hashes.mjs`, which recomputes the hashes from `dist/index.html` and writes them to `dist/_headers` and back to `public/_headers`; `src/__tests__/cspHashes.test.ts` fails when they drift.

## Backend — the Worker

Configuration is `backend/worker/wrangler.toml`: the Worker name, every route pattern it claims on the production domain, `[vars]` (`ASSETS_HOST` must point at the static project's host so fall-through and edge-rendered pages can fetch the shell) and the `HANDOFF` key-value binding. Secrets are never in that file; see [docs/operations.md](docs/operations.md#secrets).

From `backend/`:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
npm run deploy           # wrangler deploy --config worker/wrangler.toml
```

`npx wrangler login` is needed once on a new machine. Adding a handler under `worker/functions/api/` requires an import and an exact-path entry in `worker/index.ts`; `worker/__tests__/routerCoverage.test.ts` fails otherwise. A handler without a route falls through to the static site and answers `405`, which a dry-run cannot detect.

The **Deploy Worker** workflow is the second deploy path. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without the token it reports that it is not configured and succeeds without deploying. It can be run by hand with `dry_run` to exercise every gate and stop before deploying.

Deploying the Worker also registers its **Cron Trigger** (`[triggers]` in `wrangler.toml`, every 30 minutes). Nothing has to be scheduled on the code host for the status history or the housekeeping jobs; they run inside the Worker and record themselves in the database ([docs/operations.md](docs/operations.md#scheduled-jobs)).

## Database — once per project

The Worker keeps its data in one hosted database. Setting it up is a one-time step; redeploying the Worker never touches it.

1. Create the hosted project.
2. In its SQL editor, paste `backend/supabase/schema.sql` and run it. It creates every table, the `directory` view, the `stats_*` functions and the deny-all row-level security, and writes schema version 6 into `meta` (versions 4–6 added the VinaX AI tables, its search allowances and its files; pasting it again over an older version is the whole upgrade). On Supabase it also creates the private Storage bucket `ai-attachments` that VinaX AI's files live in: no dashboard step is needed. It is idempotent: re-running it is safe and deletes nothing. A database that ran an older version still holds the old AI tables; `backend/supabase/remove-ai.sql`, run once by hand, removes them (it deletes that data). To start over, run `backend/supabase/reset.sql` first (it deletes all data), then `schema.sql` again. The **Schema** workflow can do the apply from CI once a `SUPABASE_DB_URL` secret is set ([docs/database.md](docs/database.md#from-ci-instead-of-the-sql-editor)); it also proves every change to `backend/supabase/**` on a scratch Postgres in pull requests.
3. Set the two Worker secrets from `backend/`:

```sh
npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
```

4. Open the owner console's **Database** page. It shows the schema version the paste wrote, every table with its size, and the job runs once the Cron Trigger has fired.

Only the Worker holds the service-role key. The frontend and the console never talk to the database; the public anon key can read nothing because every table has row-level security forced with no policy. Everything else about the schema, the Worker's data layer and the admin API is in [docs/database.md](docs/database.md).

## VinaX AI

The chat at `/vinaxai` ([docs/ai.md](docs/ai.md)) runs on free tiers of five providers, all called from the Worker. Any one is enough.

1. Apply schema version 6 (above) before the Worker that uses it, or the chat answers `503 unavailable` for lack of its tables, and web search stays off (its daily allowance lives there).
2. Set the keys you have, from `backend/`. Each is optional:

```sh
npx wrangler secret put GROQ_API_KEY --config worker/wrangler.toml        # Groq: the fast default models
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml      # Google AI Studio: images, PDFs, long threads
npx wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.toml  # OpenRouter: the :free models
npx wrangler secret put NVIDIA_API_KEY --config worker/wrangler.toml      # NVIDIA NIM (build.nvidia.com)
```

   Web search needs nothing more when Gemini is set: free Google Search grounding on Gemini 2.5 Flash covers up to 450 searches a day. For models without grounding, add a search API key ([Tavily](https://tavily.com) by default):

```sh
npx wrangler secret put SEARCH_API_KEY --config worker/wrangler.toml
```

   Two optional plain vars (dashboard → the Worker → Settings → Variables, or `[vars]` in `wrangler.toml`): `SEARCH_API_PROVIDER` = `tavily` (default) or `serper`, and `SEARCH_DAILY_LIMIT` = search API calls per day for everyone (default 100; `0` switches the search API off).

   Workers AI needs no secret: `[ai] binding = "AI"` in `wrangler.toml` binds it on deploy. Its free pool is about 10,000 neurons a day for the whole account.
3. Check the keys with the console's environment checklist (group **VinaX AI**). Before switching the chat on, run `npm run ai:probe` locally with the same keys in `backend/worker/.dev.vars` (gitignored). Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` there to probe Workers AI too.
4. VinaX AI stays **off** until the `vinax-ai` setting says otherwise (console → Publish → App → VinaX AI):
   - `{ "enabled": false, "testers": ["<your account id>"] }` lets only your account in;
   - `{ "enabled": true }` opens it to every signed-in listener;
   - `{ "enabled": false }` is the kill switch.

   The account id is the `accounts.id` column, which is also the `account=` part of the console's listener profile address. A change reaches every isolate within a minute.

`/vinaxai` is an ordinary app page served by the static host. The old `/VinaXAI` spelling is redirected by the app's router, not by `_redirects` (a rule there could match `/vinaxai` too and loop). AI Playlist and shared-chat links from the old build still 301 to Home from the Worker.

## Android

`buildapk.yml` and `release.yml` generate the Android project in CI (`npx cap add android`, `npx cap sync android`, `node scripts/patch-android.js`), set `versionCode` and `versionName`, and build with the keystore from the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. The release body carries a `VersionCode:` line; `/api/version` reads it, and the in-app update check compares it with the installed build. Details are in [docs/android.md](docs/android.md).

## Release checks

1. Run the frontend and backend gates in [docs/testing.md](docs/testing.md#the-gates), including the bundle budget and the browser suite against `dist/`.
2. Confirm CI and E2E are green for the exact commit.
3. After merging, confirm the static host's build succeeded, and read the **Deploy Worker** log when `backend/` changed. Publishing one half does not update the other.
4. On production, check `/api/status`, Home, Search, album and playlist playback, a queue running to its end, lyrics, Radio and `/admin/`. On the console, open **Overview** (the tiles answer from the database) and **Database** (schema version 3, every table listed, the latest job run not overdue). Use a new browser profile and a returning one, a phone width and a desktop width, light and dark themes.
5. Confirm the app shows the new version (Settings, the About page, or `/changelog.json`). Confirm a route the backend change added answers as expected; `/api/version` reports the Android release, not the Worker build.
6. For Android, run [docs/qa-device-script.md](docs/qa-device-script.md) on a device before pushing a `v*` tag.

## When a deploy does not land

| What you see | Where to look |
| --- | --- |
| The app is new and a new `/api/*` route answers `405` | [The stale-Worker runbook](docs/operations.md#runbook-the-app-is-newer-than-the-api) |
| "Workers Builds: vinax-api" is red on every commit | [The known-red dashboard build check](docs/operations.md#the-known-red-check) — harmless while **Deploy Worker** is green |
| **Deploy Worker** fails at "Verify the Cloudflare token" | Rotate `CLOUDFLARE_API_TOKEN` (same runbook, fix 1) |
| Visitors are stuck on the boot splash after a deploy | [Rollback](docs/operations.md#rollback): purge the edge cache, or bump the asset URL epoch |
| Something must be undone now | [Rollback](docs/operations.md#rollback) |
| Console pages show "the database is not set up"; sign-in sync, rooms and feedback answer `503` | The two database secrets are missing or wrong, or `schema.sql` was not run: [docs/database.md](docs/database.md#setting-it-up). The console's **Database** page names which |
