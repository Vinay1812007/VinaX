# Operations

This is the runbook for keeping VinaX running: where secrets live, which scheduled jobs exist, how the service is monitored, the service-level objectives and how they are computed, the failover tests, what to do when the Worker is older than the app, how to roll back, and the owner's search-indexing checklist. Deploying is covered step by step in [../DEPLOYMENT.md](../DEPLOYMENT.md). This is one of the two documents where operational host names and secret names appear, because a maintainer has to type them.

## Production at a glance

| Piece | Where it runs | How it deploys |
| --- | --- | --- |
| Static frontend (`frontend/dist`) | The static-hosting project named `vinax` | The host's Git integration builds `frontend/` on every push to `main` |
| Worker `vinax-api` (`backend/worker`) | The edge, on the routes in `backend/worker/wrangler.toml` | The host's Git build for the Worker, and the **Deploy Worker** workflow as a second path |
| Android package | Built by workflow, published as a repository release | **Build Android APK** on every push to `main`; **Release APK** on a `v*` tag |
| Database | A hosted Postgres service reached with the service key | Schema lives in `frontend/supabase/` |

7.2 adds two migrations to paste into the database's SQL editor:
`frontend/supabase/migrations/2026-09-vinax-7.2-events-meta.sql` (the
`vinax_events.meta` column for recommendation telemetry) and
`…-7.2-ai-controls.sql` (`vinax_ai_usage_since`, which the AI spend caps
read). Both are idempotent, and both halves work before they are applied: an
event whose insert names the missing column is retried without it, and the
caps fall back to a bounded sample.

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
| Web search (8.3) | `SEARXNG_URL` (plain var or secret), `SEARXNG_TOKEN` (secret) — the owner's self-hosted SearXNG instance, see [Web search](#web-search-searxng) | Every feature keeps its pre-8.3 behaviour: the keyless search sources, no expert grounding, no web context for the DJ and playlists, no `web` trends source |

Non-secret Worker settings are in `[vars]` in `wrangler.toml`: `ASSETS_HOST` (the static site's host, used for fall-through and for the shell of edge-rendered pages) and `GITHUB_REPO`. The `HANDOFF` key-value binding holds device-transfer ciphertext for ten minutes.

Repository Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Worker deploy fallback), `CRON_SECRET`, and the four `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` signing secrets.

## Rate limiting

Two layers, both in `backend/worker/functions/_lib/ratelimit.ts`:

1. A per-isolate token bucket in module memory. It is the burst guard, and the
   whole limiter wherever no binding exists (`wrangler dev` without bindings,
   unit tests, a deploy that predates the bindings).
2. The platform's Rate Limiting bindings, declared in `worker/wrangler.toml`
   as four tiers named for their limit — `RATE_LIMIT_10`, `RATE_LIMIT_30`,
   `RATE_LIMIT_60`, `RATE_LIMIT_300` (requests per 60 s per key) — plus
   `ADMIN_AUTH_FAILS` (15 per 60 s) for wrong admin tokens.

```toml
[[ratelimits]]
name = "RATE_LIMIT_30"
namespace_id = "7202"
simple = { limit = 30, period = 60 }
```

`namespace_id` is a number chosen in the file, not provisioned anywhere; two
bindings that share one share counters. `period` may only be 10 or 60.

A route uses the smallest tier at or above its bucket's capacity plus one
minute of refill, so the binding never refuses a request the bucket alone
would have served; what it removes is one client multiplying the limit by
spreading requests across isolates. Keys are `route|hash(client address)`
(peppered with `TELEMETRY_PEPPER`, so no address is stored).

**What this does and does not guarantee.** Counters are shared by every
isolate in ONE edge location, not globally: a client that reaches
several locations gets a budget in each. They are cached on the machine and
synchronised in the background, so the limiter is permissive and eventually
consistent — a burst can overshoot a limit slightly. It is not an accounting
system. A binding call that throws fails open to layer 1 and logs once per
isolate. Because there are no accounts, the key is the client address, which
carrier networks share between many listeners; that is why the tiers sit at
the top of what one isolate already allowed.

The admin login throttle (`_lib/admin.ts`) keeps its per-isolate sliding
window (15 wrong tokens in 10 minutes locks a source out without comparing
the token) and additionally counts each wrong token in `ADMIN_AUTH_FAILS`.
The binding can only be consulted by counting, so it is asked after a failed
compare; once a location's budget is spent, the isolate locks that source for
the full 10 minutes, and every other isolate locks it on its next wrong
guess. Per location that is roughly 15 wrong guesses a minute plus one per
isolate, instead of 15 per isolate. Correct tokens never spend the budget.

## AI controls: emergency stop, feature switches and spend caps

The owner publishes one record — `vinax_config` key `ai-controls` — from the
console; `/api/admin/appconfig` validates it strictly and stamps `updatedAt`.
The Worker enforces it on every AI call (`_lib/ai.ts`), so it does not depend
on any client honouring a flag.

```json
{ "emergencyOff": false,
  "features": { "dj": true, "curate-metadata": true, "curate-ranking": true,
                "curate-home": true, "curate-shelves": true, "playlist": true,
                "vinaxai": true, "assistant": true, "tts": true,
                "lyrics": true, "image": true, "embed": true },
  "dailyTokenCap": null, "dailyCostCapUsd": null,
  "updatedAt": "…", "updatedBy": "…" }
```

A feature is on unless its value is exactly `false`. With the stop on, or a
feature off, or a cap reached, the route answers `503 { "error":
"ai_disabled" }` or `503 { "error": "ai_over_budget" }` before any provider
call, and the app falls back to its on-device path exactly as it does when a
provider is down. Each refusal is logged to `vinax_ai_events` with that error
so the console can count them; those rows are excluded from spend, from the
AI service objectives and from lane health.

- **Caching.** Each isolate refreshes the record every 30 s. A failed read is
  logged and **fails open** to today's behaviour — except that an
  `emergencyOff: true` read in the last 60 s keeps applying, so a flaky
  database cannot lift an emergency stop early (and cannot hold AI off for
  more than a minute after it was lifted).
- **Observed use** is today's (UTC) token sums from `vinax_ai_events` through
  the `vinax_ai_usage_since` function, cached 60 s per isolate; until that
  migration is applied it samples at most 10,000 of today's rows and says so.
  Cost is estimated with the operator's `ai-prices` table. Tokens on an
  unpriced model, calls whose provider reported no usage, and a full sample
  make the figures a LOWER BOUND — reported as `costKnown: false` /
  `tokensComplete: false`, never as zero. A cap blocks only when the known
  part alone reaches it, so caps are soft by up to one cache period plus
  in-flight calls.
- The scheduled jobs call the same helper, so the stop and the caps cover
  them too.
- `aiControlsStatus(env)` returns the whole picture (controls, effective
  feature states, observed use, each cap with used/remaining/reached, whether
  costs are known) for the console's AI operations panel.

## Audit trail

Every mutating admin action writes one row through `logAdminAudit()`
(`_lib/adminAudit.ts`): the actor, the action, an ISO timestamp, the edge
request id (`cf-ray`, else a random UUID), the target, and — for
configuration changes — the value before and after. Rows ride the existing
`vinax_feedback` channel (`type=admin-audit`, `status=audit`), so they stay
out of the feedback inbox and its KPI and survive "clear resolved feedback".
The write is registered with `waitUntil`, so it outlives the response; it is
best effort and never fails the action it describes.

Before/after values are redacted first: anything under a secret-looking key,
JWTs, bearer headers, long opaque tokens, secrets inside URLs, and user info
in URLs are replaced; data URLs shrink to their size; long strings are
clipped; wide or deep structures are bounded; a value still over 3 KB is
recorded as its size and a digest. Config publishing, content control,
experiments, push sends, notification retraction, maintenance actions and the
site-mode switch all supply before/after where they change configuration.

**Deferred: multi-operator identity, roles and revocable sessions.** Today
there is one shared token and every row records the actor as
`{ id: "owner", via: "shared-token" }`. The migration path, when it is
wanted: add an operators table (id, display name, a password or passkey
credential, role, disabled flag) and a sessions table (opaque token hash,
operator id, issued/expires, revoked flag); replace the token check in
`isAdminAsync()` with a session lookup that keeps the constant-time compare
and the existing failure throttle, and have it return the operator instead of
a boolean; pass that operator into `adminActor()`, which already returns
`{ id, via }` — `via` becomes `session` and nothing that reads older rows
changes. Roles then gate route groups (read-only analyst, publisher, owner),
and signing out or disabling an operator revokes the session row instead of
rotating one shared secret for everybody. Until then, rotating
`ADMIN_LOGIN_PASSWORD` remains the only way to revoke access, and the trail
cannot say WHICH person acted.

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

## Web search (SearXNG)

8.3: VinaX AI web search, the Search-page music expert, the AI DJ's and AI Playlist's fresh discoveries and the `web` trends source use a SearXNG instance the owner runs. Listeners only ever see "web search".

- **Setup.** `deploy/searxng/` is the kit: SearXNG on an internal network behind a reverse proxy that issues the HTTPS certificate and forwards only `GET /search` and `GET /healthz`, only with `Authorization: Bearer <SEARXNG_TOKEN>` (everything else is `401`/`404`, so the instance is not an open proxy). `deploy/searxng/README.md` has every step, the `curl` checks and token rotation.
- **Worker config.** `SEARXNG_URL` — https only (http for localhost in development), trailing slash fine, a URL with credentials or a query string is ignored. `SEARXNG_TOKEN` — `npx wrangler secret put SEARXNG_TOKEN --config worker/wrangler.toml`, the same value as on the instance. Trends: `TRENDS_WEB_LANGUAGES` (default `telugu,hindi,tamil`), `TRENDS_WEB_LABEL` (default "New on the web"); `TRENDS_DISABLED_SOURCES=web` switches the source off.
- **Health.** Owner console → Technical → System health, row "Web search engine": result count and latency, or the reason (`not configured`; `invalid address` when `SEARXNG_URL` is set but not https, or carries a user name, password or query; `token refused — check SEARXNG_TOKEN` for a 401; `forbidden — check that search.formats in settings.yml includes json` for a 403; `timed out`; `network error`; `resting after <the failure that started the rest> (retries in about N min)`). Worker logs: one `[searxng]` line per call.
- **Failure behaviour.** A failure that says the instance is unwell rests it per isolate — 60 s after a network error, 5xx, 429, 403, a non-JSON answer or a timeout of the full default leash; 10 minutes after a 401 — and every caller falls back without waiting: web search to the previous sources, the expert, DJ and playlist to their ungrounded prompts. A caller's own shorter leash rests nothing. The trends run records the failure as an error for the `web` source only: retried when a retry can help (timeout, network, 5xx, 429, or searches that returned nothing at all), not retried into a rest (`searxng_cooling`, naming the original failure), and `skipped` — keeping the last snapshot — when the searches worked but held no single-song upload.
- **Trends review.** Items from the `web` source are never shown until accepted: even a confident catalogue match is filed in the review queue (reason `needs_review_web_source`) with its proposal, so accepting is one click. `POST /api/cron/trends-ingest?source=web` runs it by hand.

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
