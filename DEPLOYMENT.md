# Deploying VinaX

This document covers how the two halves of VinaX reach production: the static frontend in `frontend/` and the `vinax-api` Worker in `backend/`. It lists the hosting settings, the manual deploy commands, how a release flows from pull request to production, the pre-release checks and where to look when a deploy does not land. Day-two topics — secrets, monitoring, the stale-Worker runbook, the known-red dashboard check and rollback — are in [docs/operations.md](docs/operations.md). Host and secret names appear here because a maintainer has to type them.

Both applications live on `main`. There are no separate frontend and backend branches.

## How a release flows

```text
branch ─► pull request ─► CI + E2E green ─► merge to main
                                              ├─► static host builds frontend/  ─► site
                                              ├─► Deploy Worker (backend/** changed) ─► vinax-api
                                              └─► Build Android APK ─► repository release (when signing secrets are set)
```

1. Open a pull request. `ci.yml` runs lint, typecheck, unit tests, build and the bundle budget for `frontend/`, and lint, typecheck, tests and a Worker dry-run for `backend/`. `e2e.yml` builds the app and runs the browser suite.
2. Merge to `main`.
3. The static host's Git integration builds and publishes the frontend. No workflow in this repository deploys the frontend.
4. When the merge touched `backend/**`, `worker-deploy.yml` runs the backend gates again, verifies the deploy token, runs `wrangler deploy`, and polls `/api/status` until it answers `200`. The host's own Git build for the Worker may deploy the same commit as well; that is harmless.
5. `buildapk.yml` builds the Android package on every push to `main` and publishes a signed release when the signing secrets are present. Pushing a `v*` tag runs `release.yml`, which refuses to publish without the release keystore.

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

`npm run build` cleans `dist/` and the build caches, typechecks, builds, prerenders the static routes (`scripts/prerender.mjs`) and writes `dist/changelog.json` (`scripts/changelog-json.mjs`).

Keep the custom domains (`www.sirimillavinay.online`, the apex, `admin.`, `update.`, `status.`) attached to the static project. It is the origin the Worker passes every unmatched URL to. The static project needs no environment variables and no secrets.

Manual deploy, from `frontend/`:

```sh
npm ci
npm run deploy:pages     # npm run build && wrangler pages deploy dist --project-name vinax
```

`frontend/public/_headers` carries the content-security policy, including hashes of the inline scripts in `index.html`. If you change an inline script, build, then run `node scripts/csp-hashes.mjs`, which recomputes the hashes from `dist/index.html` and writes them to `dist/_headers` and back to `public/_headers`; `src/__tests__/cspHashes.test.ts` fails when they drift.

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

## Android

`buildapk.yml` and `release.yml` generate the Android project in CI (`npx cap add android`, `npx cap sync android`, `node scripts/patch-android.js`), set `versionCode` and `versionName`, and build with the keystore from the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. The release body carries a `VersionCode:` line; `/api/version` reads it, and the in-app update check compares it with the installed build. Details are in [docs/android.md](docs/android.md).

## Release checks

1. Run the frontend and backend gates in [docs/testing.md](docs/testing.md#the-gates), including the bundle budget and the browser suite against `dist/`.
2. Confirm CI and E2E are green for the exact commit.
3. After merging, confirm the static host's build succeeded, and read the **Deploy Worker** log when `backend/` changed. Publishing one half does not update the other.
4. On production, check `/api/status`, Home, Search, album and playlist playback, a queue running to its end, lyrics, VinaX AI and `/admin/`. Use a new browser profile and a returning one, a phone width and a desktop width, light and dark themes.
5. Confirm the app shows the new version (Settings, the About page, or `/changelog.json`). Confirm a route the backend change added answers as expected; `/api/version` reports the Android release, not the Worker build.
6. For Android, run [docs/qa-device-script.md](docs/qa-device-script.md) on a device before pushing a `v*` tag.

## When a deploy does not land

| What you see | Where to look |
| --- | --- |
| The app is new, AI features are silent, `/api/curate` answers `405` | [The stale-Worker runbook](docs/operations.md#runbook-the-app-is-newer-than-the-api) |
| "Workers Builds: vinax-api" is red on every commit | [The known-red dashboard build check](docs/operations.md#the-known-red-dashboard-build-check) — harmless while **Deploy Worker** is green |
| **Deploy Worker** fails at "Verify the Cloudflare token" | Rotate `CLOUDFLARE_API_TOKEN` (same runbook, fix 1) |
| Visitors are stuck on the boot splash after a deploy | [Rollback](docs/operations.md#rollback): purge the edge cache, or bump the asset URL epoch |
| Something must be undone now | [Rollback](docs/operations.md#rollback) |
