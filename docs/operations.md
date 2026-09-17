# Operations

This is the runbook for keeping VinaX running: where secrets live, which scheduled jobs exist, how the service is monitored, the service-level objectives and how they are computed, the failover tests, what to do when the Worker is older than the app, how to roll back, and the owner's search-indexing checklist. Deploying is covered step by step in [../DEPLOYMENT.md](../DEPLOYMENT.md). This is one of the two documents where operational host names and secret names appear, because a maintainer has to type them.

## Production at a glance

| Piece | Where it runs | How it deploys |
| --- | --- | --- |
| Static frontend (`frontend/dist`) | The static-hosting project named `vinax` | The host's Git integration builds `frontend/` on every push to `main` |
| Worker `vinax-api` (`backend/worker`) | The edge, on the routes in `backend/worker/wrangler.toml` | The host's Git build for the Worker, and the **Deploy Worker** workflow as a second path |
| Android package | Built by workflow, published as a repository release | **Build Android APK** on every push to `main`; **Release APK** on a `v*` tag |
| Database | A hosted Postgres service reached with the service key | Schema lives in `frontend/supabase/` |

Production host: `www.sirimillavinay.online`. The apex redirects to `www`; `admin.` redirects to `/admin/`; `update.` redirects to the APK download; `status.` serves the status page.

## Secrets

The frontend has none. Every secret is a Worker secret, set once:

```sh
cd backend
npx wrangler secret put <NAME> --config worker/wrangler.toml
```

For local development put `NAME=value` lines in `backend/worker/.dev.vars` (ignored by git). `backend/.env.example` documents every name. The groups:

| Group | Names | If missing |
| --- | --- | --- |
| AI lanes | One key per lane; names are listed in `backend/.env.example` | That lane is skipped. With none set, AI routes answer `503` and the app uses its on-device paths ([ai.md](ai.md#when-every-provider-is-down)) |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Events, config, rooms, push and the console have no storage |
| Owner console | `ADMIN_LOGIN_PASSWORD` | Nobody can sign in to `/admin/` |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Browser notifications cannot be sent |
| Android background push | `FCM_SERVICE_ACCOUNT` | Tokens are stored, nothing is sent ([fcm-push-setup.md](fcm-push-setup.md)) |
| Identity signing | `TELEMETRY_PEPPER`, `DEVICE_ID_SECRET` | Signed install ids fall back as described in `.env.example` |
| Scheduled jobs | `CRON_SECRET` (also a repository Actions secret with the same value) | `/api/cron/*` rejects every call |
| Optional | `BRAVE_API_KEY` (web search in VinaX AI), `GITHUB_REPO`, `GITHUB_TOKEN` (Android update source) | The feature is off or rate-limited |

Non-secret Worker settings are in `[vars]` in `wrangler.toml`: `ASSETS_HOST` (the static site's host, used for fall-through and for the shell of edge-rendered pages) and `GITHUB_REPO`. The `HANDOFF` key-value binding holds device-transfer ciphertext for ten minutes.

Repository Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Worker deploy fallback), `CRON_SECRET`, and the four `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` signing secrets.

## Scheduled jobs

All schedules are workflows in `.github/workflows/`. They call the Worker; none of them carries listener data.

| Workflow | When | What it does |
| --- | --- | --- |
| `synthetic-uptime.yml` | Every 30 minutes | Probes the app shell, `/api/geo` and `/api/handoff` with three attempts each, then runs `frontend/scripts/edge-integrity.mjs`, which fetches the live shell and checks that every asset it references answers with JavaScript. A failure opens one issue titled "Synthetic uptime probe failed" (de-duplicated). |
| `status-tick.yml` | Every 30 minutes | `POST /api/status`. The Worker runs its component probes itself and records one tick per component for the status page. |
| `ai-daily-push.yml` | Five times a day | Calls `/api/cron/ai-daily-push` with `x-cron-secret`. The endpoint refuses to fire more than once per 2 h 30 min. |
| `song-push.yml` | Daily at 13:30 UTC | Calls `/api/cron/song-push`. |
| `weekly-digest.yml` | Monday 03:30 UTC | Calls `/api/cron/weekly-digest`; the result is the digest card on the console's Overview. |
| `diagnose.yml` | On demand and on push | Loads the live page in a headless browser and reports whether the app mounted. |
| `lighthouse.yml` | Push to `main`, on demand | Accessibility and search checks are hard failures; performance scores are advisory. |

## Monitoring

- **Status page.** `frontend/public/status/` reads the ticks recorded by `/api/status`.
- **Owner console.** Technical Monitoring, AI Lab and Data quality panels ([admin-console.md](admin-console.md)). A panel with no data means "unknown", not "healthy".
- **Uptime issue.** The synthetic-uptime issue is the alert. Its implicit objective is no more than one missed probe cycle.

### Service-level objectives

`/api/admin/dataquality` computes two objectives over the newest AI events it samples, and the console shows them on the Data quality panel.

| Objective | Target | Counts as good |
| --- | --- | --- |
| AI success | 98 % | The call completed (`ok = true`) |
| AI content delivery | 99 % | The call completed and carries no error marker |

Error budget burned = observed failure ÷ allowed failure, capped at 999 %. Over 100 % means the objective is breached for the window. When it burns, open the AI Lab lane-health table (per-lane latency percentiles, hops, auth and quota badges) to find the lane that is failing.

### Failover tests

`backend/worker/__tests__/chaos-failover.test.ts` drives the real `/api/vinaxai` handler with sabotaged upstreams on every CI run:

- healthy primary lane; primary dead at the network level; primary answering `400`; an empty `200` stream; every lane dead (the client gets an honest `engine_unreachable`, never a hang); a model-requested web search with every search provider down;
- stream handling: a body that outlives the header leash is not cut; a stream stuck past the overall budget is cut and flagged `truncated`; an upstream error after partial output is flagged `truncated`.

## Runbook: the app is newer than the API

**Symptom.** The web app is current (its `/changelog.json` shows the latest version) but AI features are silent: no DJ ordering, no AI shelves, no "Trending for you" re-order. `POST /api/curate` or `POST /api/dj` answers `404` or `405`, or returns the app's HTML shell.

**Cause.** No Worker deploy has landed, so the routes the app calls do not exist on the deployed Worker and fall through to the static site. The frontend deploys on its own path, so it keeps shipping. The app notices a `404`/`405` from the DJ route and stays quiet for ten minutes before trying again (`frontend/src/services/ai/dj.ts`).

Note that `GET /api/version` is **not** a Worker build stamp. It reports the newest published Android release (`build`, `version`, `apkUrl`, `sha256`, `minBuild`). To tell whether the Worker is current, call a route that the newest backend change added or changed, and check the Worker's version history in the hosting dashboard.

**History.** From 2026-09-10 the host's Git build for the Worker failed in about a second with "The build token selected for this build has been deleted or rolled". From 2026-09-11 the fallback workflow's `CLOUDFLARE_API_TOKEN` was also rejected (`Invalid access token [code: 9109]`). With both paths down, backend changes stayed undeployed while the app kept shipping.

**Fix, in order of preference.**

1. **Rotate the fallback token.** Hosting dashboard → My Profile → API Tokens → Create Token → the "Edit Cloudflare Workers" template, scoped to this account. Put it in the repository's Actions secret `CLOUDFLARE_API_TOKEN` and confirm `CLOUDFLARE_ACCOUNT_ID`. Then run the **Deploy Worker** workflow by hand. The workflow verifies the token first (`wrangler whoami`) and names the secret when it is rejected. After deploying it polls `/api/status` until it answers `200`.
2. **Repair the host's Git build.** Hosting dashboard → Workers & Pages → `vinax-api` → Settings → Build → reconnect the repository or regenerate the build token.
3. **Deploy by hand** from a machine where `npx wrangler whoami` shows the account: `cd backend && npm run deploy`.

### The known-red dashboard build check

Every commit shows a check named "Workers Builds: vinax-api". It comes from the host's Git build, not from this repository's workflows, and it is red whenever the dashboard build token is broken. It cannot be fixed from the repository. It is harmless as long as the **Deploy Worker** workflow is green for the same commit, because that workflow runs the same lint, typecheck, test and dry-run gates and the same `wrangler deploy`. Deploying the same commit twice is harmless, so both paths can be healthy at once. Treat the red check as a reminder to do fix 2, not as a failed release.

**Deploy Worker** reports success without deploying when `CLOUDFLARE_API_TOKEN` is not set. Read its log, not only its colour.

## Rollback

| Piece | How |
| --- | --- |
| Frontend | In the static-hosting project's deployment history, promote the previous successful deployment |
| Worker | Roll back in the Worker's version history, separately |
| Published configuration (flags, Home layout, banners) | Restore the previous value in the console, or publish the built-in defaults. Export a config backup from the console before large edits. |
| Android | A published package cannot be recalled. Publish a fixed build; `min-version` in the published config can force the update dialog. |

Keep the two deployed halves compatible. A frontend that calls a route the rolled-back Worker does not have degrades to its on-device paths; check that this is acceptable before rolling back only one half.

If a cached bad asset is the problem (an HTML body served under a hashed script URL), purge the edge cache. If browsers already cached it as immutable, bump the URL epoch in `frontend/vite.config.ts` (`-b3` in the file-name patterns) so every asset URL changes.

## Maintenance mode

The console's Site mode switch writes a `site-mode` record; `/api/site-mode` serves it and also honours a scheduled `maintenance-window`. The app's `SiteGate` shows the maintenance screen within about a minute and returns on its own when the mode goes live again. The console keeps working during maintenance.

## Images

Artwork is served straight from the catalogue's CDN in pre-sized variants, picked with `bestImage` and `srcset`. `/img` exists only so share cards can draw artwork on a canvas from the same origin; it is not a transform layer, and every proxied image costs edge egress. A real image-transform layer is a paid zone feature and therefore a billing decision. Do not add one unless the accessibility-and-performance workflow shows artwork causing a largest-paint regression on song or album pages.

## Search indexing and growth checklist

Owner actions that code cannot do. The site already serves prerendered routes, edge-rendered song, album, artist and playlist pages with titles, share tags and structured data, and a sitemap index at `/sitemap.xml`.

- [ ] Verify the domain in each search engine's webmaster console (DNS record) and submit `https://www.sirimillavinay.online/sitemap.xml`. After a few days, review which URLs are not indexed and why.
- [ ] Paste a song link and the Home link into the messaging and social apps your listeners use. Each should show a title and artwork card. Note the app and URL of any that do not.
- [ ] Weekly: read the digest on the console's Overview; review zero-result searches in Search Analytics and add synonyms for recurring ones; watch skip rate per language in Engagement.
