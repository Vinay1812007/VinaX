# Operations

This is the runbook for keeping VinaX running: how each piece deploys and how to tell when the Worker is behind the app, the one check that is always red, rollback, the request quota, secrets, the database (moving to a new one, retention, deleting a listener), scheduled jobs, monitoring, and the server-side controls an operator can reach (rate limits). It ends with the short checklist for the 11.0 release. First-time setup is in [../DEPLOYMENT.md](../DEPLOYMENT.md); the schema and the admin API are in [database.md](database.md). This is one of the documents where host names and secret names appear, because a maintainer has to type them.

## Production at a glance

| Piece | Where it runs | How it deploys |
| --- | --- | --- |
| Static frontend (`frontend/dist`) | The static-hosting project `vinax` (`vinax.pages.dev`, the `ASSETS_HOST` in `wrangler.toml`) | The host's Git integration builds `frontend/` on every push to `main` |
| Worker `vinax-api` (`backend/worker`) | The edge, on the routes in `backend/worker/wrangler.toml`: `/api/*`, the language-and-mood landing pages, `/sitemap*`, `/img`, `/apk`, and the `update.` and `admin.` hosts | The **Deploy Worker** workflow (the path that works), and the host's own Git build (currently broken, see below) |
| Android package | Built by workflow, published as a repository release | **Build Android APK**, dispatched by **Auto release** on every merge to `main`; **Release APK** on a pushed tag ([android.md](android.md)) |
| Database | One hosted project; the Worker is its only client, with the service-role key | `backend/supabase/schema.sql` pasted into the SQL editor once; never redeployed with the code ([database.md](database.md#setting-it-up)) |

The database holds what the Worker needs between requests: listeners and accounts (with the synced copy), consented usage events, feedback, blocked content, Listen Together rooms, push devices and sent notifications, the owner's published settings, experiments, the audit trail, the status history and the job runs. A listener's library, history and settings still live on the device; the account's synced copy is a mirror of them. The Worker also keeps per-isolate memory (rate-limit buckets, one-minute caches of settings) and the `HANDOFF` key-value binding for device transfer.

Production host: `www.vinaxmusic.online`. The Worker owns `admin.` (to `/admin/`) and `update.` (to the package download). The apex is redirected to `www` by the static site (`frontend/public/_redirects`), not the Worker: when the apex was a Worker route, a Worker over its daily quota answered 429 for `https://vinaxmusic.online/robots.txt`, and Search Console reported "Robots.txt unreachable" and stopped crawling the whole domain (fixed in 11.0.3). Keep anything a crawler needs before it can crawl — robots.txt on every host — off Worker routes. `status.` is redirected to `/status/` by `frontend/public/_redirects`.

## Deploying, and telling whether the Worker is current

The two halves deploy separately, so one can be ahead of the other.

| Half | Trigger | What to read |
| --- | --- | --- |
| Frontend | Any push to `main` | The static-hosting project's deployment list |
| Worker | **Deploy Worker** runs on a push to `main` that touches `backend/**` or the workflow file, and on demand | The workflow's log, then the Worker's version history in the hosting dashboard |

**Deploy Worker** runs lint, typecheck, tests and a dry-run build, verifies the token with `wrangler whoami`, deploys, then polls `/api/status` until it answers `200`. Two things to know:

- It **reports success without deploying** when the `CLOUDFLARE_API_TOKEN` Actions secret is not set. Read its log, not only its colour.
- A push that changes only `frontend/` does not run it. That is correct, but it means a green frontend deploy says nothing about the Worker.

### The known-red check

Every commit shows a check named "Workers Builds: vinax-api". It comes from the host's Git build, not from this repository's workflows, and it fails in about a second because the dashboard's build token has expired. It is never a code failure and cannot be fixed from the repository. It is harmless while **Deploy Worker** is green for the same commit: that workflow runs the same gates and the same `wrangler deploy`, and deploying one commit twice is harmless. To clear it: hosting dashboard → Workers & Pages → `vinax-api` → Settings → Build → reconnect the repository or regenerate the build token.

### Runbook: the app is newer than the API

**Symptom.** The web app is current (`/changelog.json` shows the latest version) but a feature that needs the server is missing or falls back to its on-device path. Both deploy paths have been down at once before (September 2026), which is how this happens.

**Probe.**

1. Request a route the newest backend added, for example `GET https://www.vinaxmusic.online/api/recommendations/similar/<a real song id>?limit=5`. A `404`, a `405` or the app's HTML shell means the deployed Worker does not have the route: it is stale. Any JSON answer, including an error, means the route exists.
2. Do **not** use `GET /api/version` for this. It reports the newest published Android release (`build`, `version`, `apkUrl`, `sha256`, `minBuild`), not the Worker build.
3. Compare the Worker's version history in the hosting dashboard with the last backend commit on `main`.

**Fix, in order of preference.**

1. **Rotate the workflow's token.** Hosting dashboard → My Profile → API Tokens → Create Token → the "Edit Cloudflare Workers" template, scoped to this account. Store it as the Actions secret `CLOUDFLARE_API_TOKEN`, confirm `CLOUDFLARE_ACCOUNT_ID`, then run **Deploy Worker** by hand. It names the secret when the token is rejected.
2. **Repair the host's Git build** (the steps under "The known-red check").
3. **Deploy by hand** from a machine where `npx wrangler whoami` shows the account: `cd backend && npm run deploy`.

## Rollback

| Piece | How |
| --- | --- |
| Frontend | In the static-hosting project's deployment history, promote the previous successful deployment |
| Worker | Roll back in the Worker's version history, separately |
| Published configuration (flags, Home layout, banners, site mode) | Every change is kept in `settings_history`: on the console's **Publish** page open the key and restore an earlier value, or clear the key so the app uses its built-in default. |
| Database | There is no code to roll back; the schema is versioned in `meta.schema`. A table or function missing after a partial paste is fixed by running `schema.sql` again (idempotent). |
| Android | A published package cannot be recalled. Publish a fixed build; `min-version` in the published config can force the update dialog. |

Keep the two deployed halves compatible. A frontend that calls a route the rolled-back Worker does not have falls back to its on-device paths; check that this is acceptable before rolling back only one half.

If a cached bad asset is the problem (an HTML body served under a hashed script URL), purge the edge cache. If browsers already cached it as immutable, bump the URL epoch in `frontend/vite.config.ts` (`-b3` in the file-name patterns) so every asset URL changes.

## The daily request quota

This section records platform behaviour seen in production (most recently on 2026-10-06). Nothing in the repository enforces or reports it.

- The Worker runs on the platform's free plan, which allows a fixed number of requests a day across every route in `wrangler.toml`. That includes the edge-rendered song, album, artist, playlist and landing pages, not only `/api/*`.
- When the allowance is spent, the platform stops running the Worker until its daily reset and answers those routes with its own error page (error **1027**). The static app shell still loads; every `/api/*` call fails, so search and Home shelves fail or fall back to on-device paths, and shared song links show the error page.
- It is not a code failure and a redeploy does not help.
- Since V2 1.0 no page a crawler reads is a Worker route. The song, album and artist pages, the 72 mood × language hubs and every sitemap (`sitemap.xml`, `sitemap-static.xml`, `sitemap-hubs.xml`, `entity-pages.xml`) are static files the frontend build writes (`frontend/scripts/prerender-entities.mjs`, using the Worker's own renderer). The routes left in `wrangler.toml` are `/api/*`, `/img`, `/apk`, `update.*` and `admin.*`, so search engines can crawl the whole site without spending the daily allowance; it is left for listeners. Do not route a page family to the Worker again; build it statically instead.

Diagnosis:

1. In the hosting dashboard, open the Worker's request analytics and group the day's requests by path and by client network. The dashboard's analytics API gives the same breakdown with the operator's own `wrangler` login (the login expires; sign in again if the API answers 401).
2. Look for one path family or one client range taking most of the day. On 2026-10-06 it was a scraper rotating fake desktop-browser user agents through thousands of IPv6 addresses on the edge-rendered entity pages: about ten requests per address, a handful of /32 prefixes, half a million requests in a week, a spike every day at the quota reset (00:00 UTC, 05:30 IST).

### Scraper traffic on entity pages

**Current state (11.0.2): the entity pages are not Worker routes.** `/song/*`, `/album/*`, `/artist/*` and `/playlist/*` were removed from `routes` in `backend/worker/wrangler.toml`, so those URLs are served by the static site as the ordinary app (`/*  /index.html  200` in `frontend/public/_redirects`). Static requests are free and unlimited, so a scraper on those paths costs the Worker nothing, and no challenge is shown to anyone. What it costs: crawlers, the ad crawler and link previewers get the app shell, not the pre-rendered song text, track list and share card; ranking for individual songs may fall over time, shared links show the generic VinaX card, and the 8.4.0 ad-review content depth no longer applies to those pages. The hub pages (`/<lang>-<mood>-songs`) and the sitemaps are still Worker routes.

To bring server rendering back, put the four patterns into `routes` again **and** put a zone rule in front of them first, or the quota drain returns. The rest of this section describes those rules and the in-Worker guard for that case.

Two layers, and only the first one saves quota:

**1. Zone edge rules (the fix).** A request on a Worker route is counted the moment it arrives, before any cache or code runs, so only a rule in front of the Worker stops the count. `backend/scripts/cf-edge-rules.mjs` creates two WAF custom rules and keeps them in step (it matches by description, so it is safe to run again):

| Rule | Action | Matches |
| --- | --- | --- |
| VinaX entity pages: browser impostors | block | `/song/`, `/album/`, `/artist/`, `/playlist/` requests whose user agent claims a Chromium browser but carry no `sec-ch-ua` header (every real Chromium has sent it since 2020; Safari, Firefox and Chrome on iOS never say "Chrome/"), and that are not a verified bot |
| VinaX entity pages: unverified automation | managed challenge (opt-in, `--challenge`) | the same paths for anything that is not a verified bot or a link previewer — a person sees one interstitial per browser |

```sh
# needs a token with Zone → Firewall Services → Edit for the production zone
# (the Worker deploy token does not have it; create one in the dashboard, use it, revoke it)
CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs --dry-run   # prints the expressions
CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs             # creates / updates the block rule
CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs --challenge # also enables the challenge rule
```

The free plan allows five custom rules and no regular expressions; the script uses two rules and `starts_with()`. Verified search engines (`cf.client.bot`) are never matched, so indexing is unaffected. After running it, the Workers request graph should flatten within the hour; if a new scraper signature appears, extend the expressions in the script rather than editing the rule in the dashboard, so the repository stays the record.

**2. The in-Worker guard (`backend/worker/functions/_lib/pageGuard.ts`, 11.0).** For every entity-page and hub request the Worker still receives, it decides in a few microseconds whether to render at all. A browser impostor (the same header test as the rule above), or a network reading entity pages faster than people do (30 pages a minute per address, 200 then 100 a minute per IPv6 /32 or IPv4 /24, counted with the rate-limit bindings in `wrangler.toml`), is answered with the plain app shell: one asset fetch, no catalogue subrequests, no rendered text, `cache-control: private, no-store`, header `x-vinax-page: impostor|address|network`. The request still counts against the quota — this layer protects the catalogue mirrors and the Worker's CPU, and makes the scrape worthless. Search engines and link previewers are exempt by user agent and by the platform's verified-bot flag, so a person who ever trips the budget simply gets the ordinary app for that load.

## Secrets

The frontend has none. Every secret is a Worker secret:

```sh
cd backend
npx wrangler secret put <NAME> --config worker/wrangler.toml
```

The value is typed at the prompt, never pasted into a file or a chat. `npx wrangler secret list --config worker/wrangler.toml` shows what is set. For local development put `NAME=value` lines in `backend/worker/.dev.vars` (ignored by git). `backend/.env.example` describes the names.

| Group | Names | If missing |
| --- | --- | --- |
| Catalogue (14.0.4) | `CATALOG_UPSTREAMS`, `CATALOG_DIRECT_URL` (both optional) | `CATALOG_UPSTREAMS` is the ordered, comma-separated list of wrapper base URLs `/api/cat` tries first (6 s each, benched a minute after a failure); without it the Worker uses only its built-in translation against JioSaavn's web API, which `CATALOG_DIRECT_URL` can point elsewhere. The app's bundle holds no provider URL — it only ever calls `/api/cat` — so the list can change in Cloudflare without a release and nobody can read it out of the app. The console's Catalog → Lookup page shows each configured upstream's health by host |
| Owner console | `ADMIN_LOGIN_PASSWORD` | Nobody can sign in to `/admin/` |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Every data feature answers its "not configured" shape: `/api/room`, `/api/feedback`, `/api/push/subscribe` and `/api/push/fcm-register` answer `503 not_configured`; `/api/account/data` answers `503 unavailable`; `/api/events` accepts and drops; the blocklist, experiments and announcement answer empty; `/api/appconfig` answers the built-in defaults; `/api/status` has no history. Every console page that reads data shows its setup card (`configured: false`) |
| Scheduled jobs by hand | `CRON_SECRET` (optional) | `POST /api/cron/run` accepts only the owner token. The Cron Trigger itself needs no secret |
| Device identity | `DEVICE_ID_SECRET` (`TELEMETRY_PEPPER` is the fallback name) | Signed device ids cannot be issued, so `/api/events` and `/api/username` cannot tell devices apart; set it |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `/api/push/vapid` answers `key: null`; browser registrations are still stored but nothing can be sent to them |
| Android background push | `FCM_SERVICE_ACCOUNT` | The console's push self-test has nothing to test; Android registrations are stored but nothing is sent to them ([fcm-push-setup.md](fcm-push-setup.md)) |
| Request hashing | `TELEMETRY_PEPPER` | Rate-limit keys fall back to a built-in pepper |
| VinaX AI | `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` (each optional; any one is enough), plus the `[ai]` Workers AI binding in `wrangler.toml` | Without any of them `/api/ai/*` answers `503 ai_not_configured` and `/vinaxai` says VinaX AI is unavailable. A missing key just leaves that provider's models out of the picker and of Auto ([ai.md](ai.md)) |
| Optional | `GITHUB_TOKEN` (Android update source) | Defaults apply; the update lookup is rate-limited without the token |

Non-secret settings are in `[vars]` in `wrangler.toml`: `ASSETS_HOST` (the static site's host, used for fall-through and for the shell of edge-rendered pages) and `GITHUB_REPO`. The `HANDOFF` key-value binding holds device-transfer ciphertext.

`TURNSTILE_SECRET_KEY` is read by nothing and can be deleted. So are the old AI build's names that VinaX AI does not use: the older `VINAX_…_API_KEY` key names, `NVIDIA_BASE_URL`, `VINAX_MAESTRO_MODEL` and `SERPER_API_KEY` (`npx wrangler secret delete <NAME> --config worker/wrangler.toml`), and the `SERPER_DAILY_LIMIT` and `RESEARCH_DAILY_LIMIT` vars. Keep `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` and `NVIDIA_API_KEY`: VinaX AI reads them. The `CRON_SECRET` Actions secret is read by no workflow and can be deleted too.

## The database

The schema, the Worker's data layer and the admin API are in [database.md](database.md). This section is what an operator does with it.

### Moving to a new database

1. Create the new hosted project.
2. If the project is not empty, run `backend/supabase/reset.sql` in its SQL editor (it deletes every VinaX table).
3. Run `backend/supabase/schema.sql`. The last line of its output names the schema version and the table count.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the Worker with `npx wrangler secret put`. The change applies on the next request; no deploy.
5. Open the console's **Database** page: schema version 3, every table present, `reachable: true`. Then **Overview**: the tiles read zero, not an error.
6. Old data does not move. Signed-in listeners keep their session (it is a signed token), their first sync after the move writes a fresh copy from the device, and their device row is created again on the next consented event.

### Retention and purges

Usage events are the only table that grows without bound. **Housekeeping** (below) purges events older than the `retention` setting's `eventsDays` (default 180) once an hour, sweeps idle rooms and switches off push devices that have not checked in for 180 days. The Database page's **Maintenance** tab runs the same actions now (`purge_events` with a chosen number of days, `sweep_rooms`, `retire_push`), each behind a confirmation and each written to the audit trail. `feedback`, `notifications`, `audit_log` and `job_runs` are kept until the owner deletes them.

### Removing the old AI tables

A database that ran schema version 2 still holds the AI tables `ai_calls` and `shared_chats` and the functions `stats_ai` and `ai_usage_since`; version 3 no longer creates them but never deletes data. Run `backend/supabase/remove-ai.sql` once, by hand, in the SQL editor after applying version 3. It deletes the AI call log and every shared AI chat, and nothing else ([database.md](database.md#moving-from-version-2)).

### Deleting one listener's data

- **The listener:** Settings → Profile → **Delete account** calls `POST /api/auth/me { delete: true }`, which removes the `accounts` row and, with it, the synced copy in `account_backups`.
- **The owner:** on the **Listeners** page, open the person and choose **Delete**; the console asks for a reason and a typed confirmation, then calls `delete_listener`, which removes the device row, every usage event, room memberships, the account and its backup, and detaches their feedback. The audit trail keeps the reason.

Repository Actions secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Deploy Worker), `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (package signing), and `LHCI_GITHUB_APP_TOKEN` (the Lighthouse workflow).

### Google sign-in (12.2; required since 13.0)

Optional sign-in runs on the push project **VinaX Music** (`vinax-music`). The Worker checks Google's ID token itself (`_lib/googleAuth.ts`) and issues its own 30-day session.

| Setting | Where |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Plain var in `backend/worker/wrangler.toml`: the project's public web OAuth client id. Sign-in answers `503 not_configured` without it. |
| `AUTH_SECRET` | Worker secret that signs sessions: `npx wrangler secret put AUTH_SECRET --config worker/wrangler.toml` (any long random value). Falls back to `DEVICE_ID_SECRET`. Changing it signs everyone out. |
| Storage | The `accounts` row (Google id, email, name, picture, linked device, coarse sign-in facts) is written at sign-in and refreshed on the session check at most every 10 minutes; `/api/account/data` keeps the synced copy in `account_backups` with optimistic versions ([database.md](database.md#public-routes-that-read-or-write-it)). Without the database secrets sign-in still works (`stored: false`) and sync answers `503 unavailable`. |
| Allowed web origins | Cloud console → Google Auth Platform → Clients → the web client: `https://www.vinaxmusic.online`, `https://vinaxmusic.online`, `https://vinax.pages.dev`, `http://localhost:5173`. A new domain needs adding here, or the button refuses to load. |
| Android | The app's SHA-1 must be on the Android app in the push project (see [fcm-push-setup.md](fcm-push-setup.md)); a release keystore needs its own SHA-1 added. |

## Scheduled jobs

The data jobs run inside the Worker. `[triggers] crons` in `backend/worker/wrangler.toml` fires the scheduled handler every 30 minutes (deploying the Worker registers it; there is nothing to schedule on the code host), `_lib/jobs.ts` decides what runs, and every run is written to `job_runs` with its outcome and a summary.

| Job | When | What it does |
| --- | --- | --- |
| `status-tick` | Every run (30 min) | Probes the website, the catalogue and the console from the Worker and records one `uptime_tick` per component. This is the status page's history (`uptime_report`) |
| `housekeeping` | Once an hour | `room_sweep` (rooms idle 6 h, members unseen 1 day), `purge_events` (older than `retention.eventsDays`, default 180), `retire_push_devices` (no check-in for 180 days) |

- The console's **Database → Jobs** tab lists each job with its last run, outcome and summary, and flags a job as overdue when its last run is older than twice its interval. "Not run yet" on a fresh database is not a failure.
- **Run a job now:** the same tab has a button per job, or `POST /api/cron/run` with the body `{ "job": "status-tick" }` and either the header `x-cron-secret: $CRON_SECRET` or the owner token.
- A job that fails leaves `ok: false` and the error in its summary; the next tick runs it again. Nothing retries inside a run.

The one scheduled workflow left on the code host is an outside check, not a data job:

| Workflow (file) | When (UTC) | What it does |
| --- | --- | --- |
| **Synthetic uptime** (`synthetic-uptime.yml`) | Every 30 minutes | Probes the app shell, `/api/geo` and `/api/handoff`, then runs `frontend/scripts/edge-integrity.mjs`, which checks that every asset the live shell references answers with JavaScript. A failure opens one issue titled "Synthetic uptime probe failed" (de-duplicated by title). Scheduled workflows on the code host often start late. |

It can also be run by hand.

Workflows that are checks rather than jobs:

| Workflow | Trigger | What it is for |
| --- | --- | --- |
| **CI** | Push to `main`, pull requests | The repository's gates |
| **E2E** | Push to `main`, pull requests, on demand | Browser tests |
| **Lighthouse** | Push to `main`, on demand | Accessibility and search checks are hard failures; performance scores are advisory |
| **diagnose** | On demand (and when its own file changes) | Fetches the live page, checks its assets, loads it in a headless browser and reports whether the app mounted; also probes the catalogue route |

## Monitoring

- **Status page.** `frontend/public/status/` reads `/api/status`, which probes the website, the catalogue and the console live (memoised 60 s per isolate) and adds the 90-day history the `status-tick` job recorded (`uptime_report`) and the owner's note (the `status-note` setting, edited on the console's Publish page). Without the database `days` is empty and `uptime90` is `null`.
- **Owner console.** **Overview** is the first look (tiles, the 14-day timeline, an "attention" list naming anything that needs the owner), **Health** the live checks, **Database → Jobs** whether the scheduled jobs are running ([admin-console.md](admin-console.md)). A panel with no data means "unknown", not "healthy".
- **Uptime issue.** The "Synthetic uptime probe failed" issue is the alert from outside.

## Rate limiting

Two layers, both in `backend/worker/functions/_lib/ratelimit.ts`:

1. A per-isolate token bucket in memory. It is the burst guard, and the whole limiter wherever no binding exists (local development, unit tests).
2. The platform's Rate Limiting bindings declared in `wrangler.toml`: `RATE_LIMIT_10`, `RATE_LIMIT_30`, `RATE_LIMIT_60`, `RATE_LIMIT_300` (requests per 60 s per key), plus `ADMIN_AUTH_FAILS` (15 per 60 s) for wrong admin tokens.

A route uses the smallest tier at or above its bucket's capacity plus one minute of refill, so the binding never refuses a request the bucket alone would have served. Keys are `route|hash(client address)`, peppered with `TELEMETRY_PEPPER`, so no address is stored.

What this does not guarantee: counters are shared within one edge location, not globally, and are synchronised in the background, so a burst can overshoot slightly. A binding call that throws fails open to layer 1. `namespace_id` is a number chosen in the file; two bindings that share one share counters, and `period` may only be 10 or 60.

The admin login throttle (`_lib/admin.ts`) locks a source out for 10 minutes after 15 wrong tokens, and also counts each wrong token in `ADMIN_AUTH_FAILS` so the lock holds across isolates. Correct tokens never spend the budget.

## Images

Artwork is served straight from the catalogue's CDN in pre-sized variants. `/img` exists only so share cards can draw artwork on a canvas from the same origin; it is not a transform layer, and every proxied image costs a Worker request and edge egress.

## After deploying 11.0

Nothing new to configure: 11.0 adds no secret, no binding and no schedule.

1. Confirm **Deploy Worker** is green for the release commit and that its log shows a deploy, then run the probe in "The app is newer than the API".
2. Open the status page and the console's Overview once.
3. **Run the edge rules once** — this is what stops the daily quota drain from the entity-page scraper: create a token with Zone → Firewall Services → Edit for the production zone, run `CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs`, then revoke the token. See [Scraper traffic on entity pages](#scraper-traffic-on-entity-pages). Over the next day the Worker request graph should lose its spike at the 00:00 UTC reset.
4. Check the page guard: `curl -sI -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36" https://www.vinaxmusic.online/song/x-1 | grep -i x-vinax-page` should print `x-vinax-page: impostor` (with the block rule from step 3 live, the edge blocks it before that). A real browser, or Googlebot's user agent, gets the rendered page and no such header.

## Search indexing checklist

Owner actions that code cannot do. The site serves prerendered routes, edge-rendered song, album, artist and playlist pages with titles, share tags and structured data, and a sitemap index at `/sitemap.xml`.

- [ ] Verify the domain in each search engine's webmaster console and submit `https://www.vinaxmusic.online/sitemap.xml`. After a few days, review which URLs are not indexed and why.
- [ ] Paste a song link and the Home link into the messaging apps your listeners use. Each should show a title and artwork card.
- [ ] Weekly: read the console's Overview; review the Analytics page (music, places, engagement, retention, funnel, skips, errors) and the Feedback inbox.
