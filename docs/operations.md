# Operations

This is the runbook for keeping VinaX running: how each piece deploys and how to tell when the Worker is behind the app, the one check that is always red, rollback, the request quota, secrets, scheduled jobs, monitoring, and the server-side controls an operator can reach (rate limits, AI switches and caps, the audit trail, maintenance mode). It ends with the short checklist for the 11.0 release. First-time setup is in [../DEPLOYMENT.md](../DEPLOYMENT.md). This is one of the documents where host names and secret names appear, because a maintainer has to type them.

## Production at a glance

| Piece | Where it runs | How it deploys |
| --- | --- | --- |
| Static frontend (`frontend/dist`) | The static-hosting project `vinax` (`vinax.pages.dev`, the `ASSETS_HOST` in `wrangler.toml`) | The host's Git integration builds `frontend/` on every push to `main` |
| Worker `vinax-api` (`backend/worker`) | The edge, on the routes in `backend/worker/wrangler.toml`: `/api/*`, the apex, `/song/*`, `/album/*`, `/artist/*`, `/playlist/*`, the language-and-mood landing pages, `/sitemap*`, `/img`, `/apk`, and the `update.` and `admin.` hosts | The **Deploy Worker** workflow (the path that works), and the host's own Git build (currently broken, see below) |
| Android package | Built by workflow, published as a repository release | **Build Android APK** on every push to `main`; **Release APK** on a pushed tag ([android.md](android.md)) |
| Database | A hosted Postgres service reached with the service key | SQL files in `frontend/supabase/migrations/`, pasted into the database's SQL editor by the owner |

Production host: `www.sirimillavinay.online`. The Worker owns the apex (it redirects to `www`), `admin.` (to `/admin/`) and `update.` (to the package download). `status.` is redirected to `/status/` by `frontend/public/_redirects`.

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

**Symptom.** The web app is current (`/changelog.json` shows the latest version) but AI features are silent: no DJ ordering, no AI shelves. Both deploy paths have been down at once before (September 2026), which is how this happens.

**Probe.**

1. `POST https://www.sirimillavinay.online/api/curate` and `POST …/api/dj` with an empty JSON body. A `404`, a `405` or the app's HTML shell means the deployed Worker does not have the route: it is stale. Any JSON answer, including an error, means the route exists.
2. `GET …/api/aimodels`. It always lists the four providers with `configured: true|false`; an HTML answer means the same thing as step 1.
3. Do **not** use `GET /api/version` for this. It reports the newest published Android release (`build`, `version`, `apkUrl`, `sha256`, `minBuild`), not the Worker build.
4. Compare the Worker's version history in the hosting dashboard with the last backend commit on `main`.

The app notices a `404`/`405` from the DJ route and stays quiet for ten minutes before trying again (`frontend/src/services/ai/dj.ts`), so listeners see on-device ordering, not errors.

**Fix, in order of preference.**

1. **Rotate the workflow's token.** Hosting dashboard → My Profile → API Tokens → Create Token → the "Edit Cloudflare Workers" template, scoped to this account. Store it as the Actions secret `CLOUDFLARE_API_TOKEN`, confirm `CLOUDFLARE_ACCOUNT_ID`, then run **Deploy Worker** by hand. It names the secret when the token is rejected.
2. **Repair the host's Git build** (the steps under "The known-red check").
3. **Deploy by hand** from a machine where `npx wrangler whoami` shows the account: `cd backend && npm run deploy`.

## Rollback

| Piece | How |
| --- | --- |
| Frontend | In the static-hosting project's deployment history, promote the previous successful deployment |
| Worker | Roll back in the Worker's version history, separately |
| Published configuration (flags, Home layout, banners) | Restore the previous value in the console, or publish the built-in defaults. Export a config backup from the console before large edits. |
| Android | A published package cannot be recalled. Publish a fixed build; `min-version` in the published config can force the update dialog. |

Keep the two deployed halves compatible. A frontend that calls a route the rolled-back Worker does not have falls back to its on-device paths; check that this is acceptable before rolling back only one half.

If a cached bad asset is the problem (an HTML body served under a hashed script URL), purge the edge cache. If browsers already cached it as immutable, bump the URL epoch in `frontend/vite.config.ts` (`-b3` in the file-name patterns) so every asset URL changes.

## The daily request quota

This section records platform behaviour seen in production (most recently on 2026-10-06). Nothing in the repository enforces or reports it.

- The Worker runs on the platform's free plan, which allows a fixed number of requests a day across every route in `wrangler.toml`. That includes the edge-rendered song, album, artist, playlist and landing pages, not only `/api/*`.
- When the allowance is spent, the platform stops running the Worker until its daily reset and answers those routes with its own error page (error **1027**). The static app shell still loads; every `/api/*` call fails, so search, Home shelves and AI features fail or fall back to on-device paths, and shared song links show the error page.
- It is not a code failure and a redeploy does not help.

Diagnosis and fix:

1. In the hosting dashboard, open the Worker's request analytics and group the day's requests by path and by client network. The dashboard's analytics API gives the same breakdown with the operator's own `wrangler` login.
2. Look for one path family or one client range taking most of the day. On 2026-10-06 it was a crawler rotating through addresses on the edge-rendered entity pages.
3. Fix it at the firewall (a challenge rule for that traffic on those paths), not in code. The in-code rate limiter below runs inside the Worker, so a request it refuses has already been counted.

## Secrets

The frontend has none. Every secret is a Worker secret:

```sh
cd backend
npx wrangler secret put <NAME> --config worker/wrangler.toml
```

The value is typed at the prompt, never pasted into a file or a chat. `npx wrangler secret list --config worker/wrangler.toml` shows what is set. For local development put `NAME=value` lines in `backend/worker/.dev.vars` (ignored by git). `backend/.env.example` describes the names.

| Group | Names | If missing |
| --- | --- | --- |
| AI providers | `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | That provider's models are skipped and its section of the model menu is empty. With none set, AI routes answer `503 ai_not_configured` and the app uses its on-device paths ([ai.md](ai.md)) |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Events, config, rooms, push and the console have no storage |
| Owner console | `ADMIN_LOGIN_PASSWORD` | Nobody can sign in to `/admin/` |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Browser notifications cannot be sent |
| Android background push | `FCM_SERVICE_ACCOUNT` | Tokens are stored, nothing is sent ([fcm-push-setup.md](fcm-push-setup.md)) |
| Identity signing | `TELEMETRY_PEPPER`, `DEVICE_ID_SECRET` | Fallbacks are described in `backend/.env.example` |
| Scheduled jobs | `CRON_SECRET` (also a repository Actions secret with the same value) | `/api/cron/*` rejects every call |
| Trends | `YOUTUBE_API_KEY` and the optional `TRENDS_*` settings | See [trends.md](trends.md) |
| Optional | `GITHUB_TOKEN` (Android update source), `NVIDIA_BASE_URL`, `VINAX_MAESTRO_MODEL`, `NOTIFY_MIN_GAP_HOURS` | Defaults apply; the update lookup is rate-limited without the token |

Non-secret settings are in `[vars]` in `wrangler.toml`: `ASSETS_HOST` (the static site's host, used for fall-through and for the shell of edge-rendered pages) and `GITHUB_REPO`. The `HANDOFF` key-value binding holds device-transfer ciphertext.

Repository Actions secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Deploy Worker), `CRON_SECRET`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (package signing), and `LHCI_GITHUB_APP_TOKEN` (the Lighthouse workflow).

### AI keys: one per provider

Four keys, one per provider; every free model and tool that provider offers runs on its key. `providerKey()` in `backend/worker/functions/_lib/ai.ts` is the only code that reads them. It takes the current name and, while that is unset, the older one.

| Provider | Secret | Where the owner creates the key | Older name still read |
| --- | --- | --- | --- |
| NVIDIA | `NVIDIA_API_KEY` | build.nvidia.com → Settings → API keys | `VINAX_NVIDIA_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai → Workspace → Keys | `VINAX_OPENROUTER_API_KEY` |
| Gemini | `GEMINI_API_KEY` | aistudio.google.com → API keys | `VINAX_GGL_GEMINI_API_KEY` |
| Groq | `GROQ_API_KEY` | console.groq.com → Keys | `VINAX_GROQ_API_KEY` |

- `GET /api/aimodels` shows which providers are configured (`configured: true|false` for each of the four). The console's env checklist shows which name each provider is using.
- Once a provider is on its current name, its older name can be deleted with `npx wrangler secret delete <NAME> --config worker/wrangler.toml`. Nothing reads any other secret beginning `VINAX_` except `VINAX_MAESTRO_MODEL`; per-model keys left from before 10.3 can be deleted the same way.

## Scheduled jobs

All schedules are workflows in `.github/workflows/`, plus one Cron Trigger on the Worker. They call the Worker; none of them carries listener data. Scheduled workflows on the code host often start late.

| Workflow (file) | When (UTC) | What it does |
| --- | --- | --- |
| **Synthetic uptime** (`synthetic-uptime.yml`) | Every 30 minutes | Probes the app shell, `/api/geo` and `/api/handoff`, then runs `frontend/scripts/edge-integrity.mjs`, which checks that every asset the live shell references answers with JavaScript. A failure opens one issue titled "Synthetic uptime probe failed" (de-duplicated by title). |
| **Status tick** (`status-tick.yml`) | Minutes 7 and 37 of every hour | `POST /api/status`: the Worker runs its component probes and records one tick per component for the status page. This is the outside check. |
| Worker Cron Trigger (`[triggers]` in `wrangler.toml`) | `7,37 * * * *` | The Worker's `scheduled` handler records the same status round itself, so the page does not read "API down" when the workflow runs late. Applied by `wrangler deploy`; visible under the Worker's Settings → Triggers. |
| **AI daily push** (`ai-daily-push.yml`) | 02:30, 07:30, 10:30, 15:30, 18:30 | Calls `/api/cron/ai-daily-push` with the `x-cron-secret` header. The endpoint refuses to send again within 150 minutes. |
| **AI song push** (`song-push.yml`) | Daily 13:30 | Calls `/api/cron/song-push`. |
| **Trends ingest** (`trends-ingest.yml`) | Minute 17 of every sixth hour | Calls `/api/cron/trends-ingest`: reads the configured trend sources, stores a snapshot, matches items to catalogue songs and deletes expired data ([trends.md](trends.md)). |
| **Weekly digest** (`weekly-digest.yml`) | Monday 03:30 | Calls `/api/cron/weekly-digest`; the result is the digest card on the console's Overview. |

Each scheduled workflow can also be run by hand. `/api/cron/seo-crawl` exists on the Worker, but no workflow calls it.

Workflows that are checks rather than jobs:

| Workflow | Trigger | What it is for |
| --- | --- | --- |
| **CI** | Push to `main`, pull requests | The repository's gates |
| **E2E** | Push to `main`, pull requests, on demand | Browser tests |
| **Lighthouse** | Push to `main`, on demand | Accessibility and search checks are hard failures; performance scores are advisory |
| **diagnose** | On demand (and when its own file changes) | Fetches the live page, checks its assets, loads it in a headless browser and reports whether the app mounted; also probes the catalogue route |

## Monitoring

- **Status page.** `frontend/public/status/` reads the ticks recorded by `/api/status`.
- **Owner console.** Technical Monitoring, AI Lab and Data quality panels ([admin-console.md](admin-console.md)). A panel with no data means "unknown", not "healthy".
- **Uptime issue.** The "Synthetic uptime probe failed" issue is the alert.

### Service-level objectives

`/api/admin/dataquality` computes two objectives over the newest AI events it samples; the console shows them on the Data quality panel.

| Objective | Target | Counts as good |
| --- | --- | --- |
| AI success | 98 % | The call completed (`ok = true`) |
| AI content delivery | 99 % | The call completed and carries no error marker |

Error budget burned = observed failure ÷ allowed failure, capped at 999 %. Over 100 % means the objective is breached for the window. When it burns, open the AI Lab lane-health table to find the lane that is failing.

### Failover tests

`backend/worker/__tests__/chaos-failover.test.ts` drives the real `/api/vinaxai` handler with sabotaged upstreams on every CI run: a dead primary, a primary answering `400`, an empty stream, every engine dead (the client gets an honest error, never a hang), and streams that stall or break part-way (the reply is flagged `truncated`).

## Rate limiting

Two layers, both in `backend/worker/functions/_lib/ratelimit.ts`:

1. A per-isolate token bucket in memory. It is the burst guard, and the whole limiter wherever no binding exists (local development, unit tests).
2. The platform's Rate Limiting bindings declared in `wrangler.toml`: `RATE_LIMIT_10`, `RATE_LIMIT_30`, `RATE_LIMIT_60`, `RATE_LIMIT_300` (requests per 60 s per key), plus `ADMIN_AUTH_FAILS` (15 per 60 s) for wrong admin tokens.

A route uses the smallest tier at or above its bucket's capacity plus one minute of refill, so the binding never refuses a request the bucket alone would have served. Keys are `route|hash(client address)`, peppered with `TELEMETRY_PEPPER`, so no address is stored.

What this does not guarantee: counters are shared within one edge location, not globally, and are synchronised in the background, so a burst can overshoot slightly. A binding call that throws fails open to layer 1. `namespace_id` is a number chosen in the file; two bindings that share one share counters, and `period` may only be 10 or 60.

The admin login throttle (`_lib/admin.ts`) locks a source out for 10 minutes after 15 wrong tokens, and also counts each wrong token in `ADMIN_AUTH_FAILS` so the lock holds across isolates. Correct tokens never spend the budget.

## AI controls: emergency stop, feature switches and spend caps

The owner publishes one record, `vinax_config` key `ai-controls`, from the console. The Worker enforces it on every AI call (`_lib/ai.ts`), including the scheduled jobs, so it does not depend on any client.

| Control | Effect |
| --- | --- |
| `emergencyOff: true` | Every AI route answers `503 { "error": "ai_disabled" }` before any provider call |
| `features.<name>: false` | That feature answers `503 ai_disabled`. A feature is on unless its value is exactly `false` |
| `dailyTokenCap`, `dailyCostCapUsd` | Once today's (UTC) known use reaches the cap, AI routes answer `503 { "error": "ai_over_budget" }` |

- The app treats these exactly as it treats a provider outage and falls back to its on-device paths. Each refusal is logged to `vinax_ai_events` and is excluded from spend, the objectives and lane health.
- Each isolate refreshes the record every 30 s. A failed read fails open, except that an `emergencyOff: true` read in the last 60 s keeps applying, so a flaky database cannot lift a stop early.
- Observed use comes from `vinax_ai_events` (cached 60 s per isolate) and is priced with the operator's `ai-prices` table. Unpriced models and calls with no reported usage make the figure a lower bound, shown as `costKnown: false` / `tokensComplete: false`, never as zero. Caps are therefore soft by about one cache period plus in-flight calls.

## Audit trail

Every mutating admin action writes one row through `logAdminAudit()` (`_lib/adminAudit.ts`): actor, action, time, the edge request id, the target and, for configuration changes, the value before and after with secrets redacted and large values reduced to a size and digest. Rows are stored as `vinax_feedback` rows of `type=admin-audit`, so they stay out of the feedback inbox and survive "clear resolved feedback". The write is best effort and never fails the action it describes.

There is one shared console password, so every row records the actor as the owner. Rotating `ADMIN_LOGIN_PASSWORD` is the only way to revoke access, and the trail cannot say which person acted.

## Maintenance mode

The console's Site mode switch writes a `site-mode` record; `/api/site-mode` serves it and also honours a scheduled `maintenance-window`. The app shows the maintenance screen within about a minute and returns on its own when the mode goes live again. The console keeps working during maintenance.

## Images

Artwork is served straight from the catalogue's CDN in pre-sized variants. `/img` exists only so share cards can draw artwork on a canvas from the same origin; it is not a transform layer, and every proxied image costs a Worker request and edge egress.

## After deploying 11.0

Nothing new to configure: 11.0 adds no secret, no binding, no schedule and no database migration.

1. Confirm **Deploy Worker** is green for the release commit and that its log shows a deploy, then run the probe in "The app is newer than the API".
2. `GET /api/aimodels` lists the four providers; each one whose key is set shows `configured: true`.
3. Send one message in VinaX AI on Auto, and one with a model picked from a second provider.
4. Expect different numbers on dashboards: when every engine is rate-limited, `/api/vinaxai` now answers `429` with a `retry-after` of 5 to 60 seconds, where it used to answer `500`. `/api/assistant`, `/api/dj`, `/api/playlist` and `/api/lyrics-tools` also answer `429` for an upstream rate limit. Other upstream failures are still `500`. An alert keyed on `500`s will fire less; add `429` to anything that tracks AI availability.
5. Open the status page and the console's Overview once.

## Search indexing checklist

Owner actions that code cannot do. The site serves prerendered routes, edge-rendered song, album, artist and playlist pages with titles, share tags and structured data, and a sitemap index at `/sitemap.xml`.

- [ ] Verify the domain in each search engine's webmaster console and submit `https://www.sirimillavinay.online/sitemap.xml`. After a few days, review which URLs are not indexed and why.
- [ ] Paste a song link and the Home link into the messaging apps your listeners use. Each should show a title and artwork card.
- [ ] Weekly: read the digest on the console's Overview; review zero-result searches in Search Analytics; watch skip rate per language in Engagement.
