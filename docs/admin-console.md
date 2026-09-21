# Owner console

This document covers the owner console served at `/admin/`: what it is made of, how sign-in works and why the check is server-side only, the sections it offers, how published settings reach listeners, feature flags, Home layout publishing, and the 7.2 panels for recommendation quality, AI operations and recommendation tuning. It describes the files in `frontend/public/admin/` and the Worker routes under `backend/worker/functions/api/admin/` as they are on disk for 7.2.

## What it is

The console is a standalone static page, not part of the main app bundle. It ships with the frontend build because it lives in `frontend/public/`.

| File | Role |
| --- | --- |
| `frontend/public/admin/index.html` | Markup, the embedded stylesheet, the icon sprite, the sidebar navigation |
| `frontend/public/admin/theme-boot.js` | Pre-paint script: applies the stored theme and sidebar state before first paint |
| `frontend/public/admin/app.js` | The older panels, the API client, the command palette, auto-refresh |
| `frontend/public/admin/sections/` | 7.2 section modules: `registry.js`, then one file per panel (`recquality.js`, `aiops.js`, `recconfig.js`). Each registers itself and receives escaping helpers from `app.js`; see [Section modules](#section-modules) |
| `frontend/public/admin/workspace.js`, `workspace.css` | The Operations Workspace section |
| `frontend/public/admin/festivals.js` | Generated festival data for the Festival Themes section (`npm run gen:festivals`) |
| `frontend/public/admin/studio.css` | Styles for the studio-style editors |
| `frontend/public/admin/leaflet/` | A vendored map library for the World Map section |

The page is marked `noindex, nofollow`. Its content security policy allows scripts only from its own origin, which is why `theme-boot.js` is an external file and why there are no inline scripts. Every un-hashed console file (`index.html`, `app.js`, `workspace.js`, `theme-boot.js`, `studio.css`, `workspace.css`) is served with `Cache-Control: no-cache` (`frontend/public/_headers`), so a returning owner never gets a new page with a stale stylesheet or boot script. A request to the root of an `admin.` host is redirected to `/admin/` by `backend/worker/functions/_middleware.ts`.

The console talks to the Worker with same-origin requests to `/api/admin/*`. It never imports app code or app CSS.

## Sign-in and authorisation

Authorisation happens on the server, on every request. The page has no secret in it and its sign-in form decides nothing.

1. The sign-in panel asks for the admin token. `app.js` stores what was typed in `sessionStorage` under `vinax_admin_token`, so it is gone when the tab closes.
2. Every API call sends it as the `x-admin-token` header. `Authorization: Bearer …` is accepted as well.
3. Every one of the 46 route files under `api/admin/` checks `isAdmin(request, env)` in its handlers, before any other work, and answers `unauthorized()` when it fails. Hiding a button in the console is never the check.
4. `isAdmin()` in `backend/worker/functions/_lib/admin.ts` compares the token with the Worker secret `ADMIN_LOGIN_PASSWORD`.
5. On a `401` the console deletes the stored token and shows the sign-in panel with "Invalid token."

Properties of `isAdmin()`:

| Property | Behaviour |
| --- | --- |
| Secret not set | Always refuses. An unconfigured Worker has no console access |
| Comparison | Constant-time (`_lib/safe-compare.ts`), so response timing does not leak the secret |
| Throttle | 15 wrong tokens from one source address inside a sliding 10 minutes locks that address out. While locked out the token is not compared at all, so a correct guess is refused too. Since 7.2 the count is shared by every isolate in one edge location through a rate-limit binding, so a lockout is no longer per isolate |
| Correct tokens | Never consume the failure budget |
| Scope | Counters live in the memory of one Worker isolate and are capped at 5,000 sources. A different isolate has its own counters |
| Refusal | `401`, JSON `{ "error": "unauthorized" }`, `cache-control: no-store` |

There is one shared token and no per-user accounts or roles. Rotating `ADMIN_LOGIN_PASSWORD` signs everyone out at their next request. How to set the secret is in [operations.md](operations.md).

### Audit trail

Mutating routes call `logAdminAudit()` (`_lib/adminAudit.ts`), which writes a row of type `admin-audit` with status `audit` into the feedback table; the Audit Trail section reads them back. The write is best effort and never fails the action it describes. On disk the helper is called by: config publishing, content control (block and unblock), experiments, push sends, the notification log, maintenance actions including the site-mode switch, recommendation tuning (every published version) and trend operations.

Since 7.2 each row records the actor (`owner` via the shared token today, in a shape ready for per-operator identities), the action and a summary, the target, an ISO timestamp, the edge request id (`cf-ray`, else a fresh UUID) and — for configuration changes — the safe before and after values, with secrets, tokens and credential-looking strings redacted and an oversized value reduced to its size and a digest. The write is registered with the Worker's `waitUntil`, so it survives the response without delaying the action.

## Layout and theme

On disk at the time of writing, the console has no top bar. The shell is one grid: a left sidebar spanning the full height, and on the right a stale-data banner, the main panel and a footer. The sidebar holds, top to bottom: the brand link and a collapse button; a Live group with three counters (listening now, plays today, errors) refreshed every minute; the section navigation with a filter field; a View group (date range where a section uses one, the auto-refresh switch and interval, row density, compact layout, theme); an Actions group (refresh, error alerts, copy a day report, download the panel as JSON, download a table as CSV where there is one); and Sign out. From 1024px up the sidebar can collapse to an icon rail, remembered in `localStorage` as `vinax_admin_sidebar`. Below 1024px it is an off-canvas drawer opened by a floating menu button. The main panel starts with a toolbar showing the section's category, its title and the last-updated time. The embedded stylesheet copies the listener app's token values (ink surfaces, hairline borders, the violet accent ramp, 8px controls, 12px cards, 16px panels, 40px buttons and 36px small controls, the same self-hosted typeface). Dark is the default; `html.light` re-maps the tokens. The theme button stores the choice as `vinax_admin_theme`; with no stored choice the console follows the system colour scheme, and `theme-boot.js` applies the result before first paint so there is no flash.

Keyboard: `Ctrl`/`Cmd` + `K` opens a command palette listing every section. Outside form fields, `1`–`9` jump to Overview, Live Listening, Activity Feed, Location Analytics, Music Analytics, Insights, User Management, Technical Monitoring and AI Monitoring, and `R` refreshes the current section. The current section is mirrored in the URL hash (for example `/admin/#flags`) and remembered for the next visit.

Auto-refresh pauses when the tab is hidden and after 10 minutes without input; any input resumes it and refreshes at once. Sections that are editors rather than dashboards are not re-rendered by the refresh tick, so an edit in progress is not wiped.

## Sections

Navigation groups collapse, and their state is remembered per browser.

| Group | Sections |
| --- | --- |
| Dashboards | Operations Workspace, Overview, Real-Time |
| Audience | Live Listening, Activity Feed, Engagement, User Management, Retention Cohorts, Feature Usage, Listening Heatmap, Onboarding Funnel, Audience Segments |
| Catalog | Song Management, Playlist Management, Categories & Genres, Content Control, Catalog Lookup, Trending Pins, Song Drilldown, Skip Report, Search Synonyms, Catalog Sources, Language Order, Blocklist Import/Export |
| Promotion | Banners & Offers, Festival Themes, Broadcast Message, Home Greeting, Home Layout Studio, Help Center FAQ, Announcement Composer, Notifications |
| Analytics | Music Analytics, Search Analytics, Location Analytics, World Map, Insights, A/B Experiments, Recommendation Quality, Recommendation Tuning, SEO Corpus |
| AI & Engines | AI Monitoring, AI Operations, API Monitoring, Engine Probe, AI Starter Prompts, AI Quick Actions, AI House Rules, AI Tokens & Cost |
| Operations | Operations Center, Technical Monitoring, Feedback & Bugs, Live Rooms, Edge & Endpoint Health, Data Quality, Releases & CI, Database Overview, Audit Trail, Status Note, Cron Health, Status History, Environment Checklist, Query Console, Release Notes, Maintenance Scheduler, Minimum App Version |
| Settings | App Configuration, Feature Flags, Runbook, Config Backup, Pinned Tools |

Three kinds of state sit behind these sections. Knowing which is which matters before relying on one.

| Kind | Where it lives | Examples |
| --- | --- | --- |
| Read-only dashboards | Aggregated by an `/api/admin/*` route from the events and feedback tables | Overview, Real-Time, Retention Cohorts, Skip Report, AI Monitoring, Data Quality, Recommendation Quality, AI Operations (its tables) |
| Published settings | One row per key in the `vinax_config` table, written through `/api/admin/appconfig` | Banners, Festival override, Home Greeting, Broadcast, Home Layout Studio, Feature Flags, Search Synonyms, Catalog Sources, Language Order, AI Starter Prompts, AI Quick Actions, AI House Rules, Help Center FAQ, Minimum App Version, Maintenance Scheduler, Trending Pins, Status Note, Runbook, AI prices, AI emergency controls (`ai-controls`) |
| Versioned published settings | `vinax_config` keys `rec-config` and `rec-config-history`, written only through `/api/admin/recconfig` (validated, version-checked) | Recommendation Tuning |
| Browser-local operator state | `localStorage` in the operator's browser only; not shared, not sent to listeners | App Configuration (`vinax_admin_appconfig`), Pinned Tools, Operations Workspace preferences (`vinax.admin.workspace.v1`), nav group state, refresh interval, density |

Since 7.2 the browser-local sections say so where the operator looks: their nav entries (`data-local` in `index.html`) carry a "this browser only" caption, and their panel opens with a line saying the state is kept in this browser and not published (for Operations Workspace: that only its layout and preferences are local). Both come from one CSS rule in the embedded stylesheet; the panel line uses `:has()`, so a browser without it still shows the nav caption.

Site maintenance mode is separate from the config store. The switch in Technical Monitoring writes a `site-mode` row through the token-gated maintenance route; the public `/api/site-mode` route honours only rows stored under the console's own identity and reads the newest one, and a scheduled Maintenance Scheduler window overrides it while active. The app checks that route every minute.

## How a published setting reaches listeners

```
console section ──POST /api/admin/appconfig {key, value}──▶ Worker
                                                            │ isAdmin · key allow-list · size cap · upsert · audit row
                                                            ▼
                                                     vinax_config (key → JSON)
                                                            │
listener app ◀──GET /api/appconfig?key=…── Worker ◀─────────┘
                  sanitised again on the way out, edge-cached
```

Write side (`api/admin/appconfig.ts`): the key must be in `ALLOWED_KEYS`, the serialised value must be under 900 KB, and the row is upserted with a timestamp. Without the database configured, reads answer `{ configured: false }` and writes answer `503`. Since 7.2 a read that FAILS answers `502` with its kind (`db_unavailable`, `db_unauthorized`, `db_schema_missing`, `db_bad_request`) instead of an empty value an editor could publish over the stored config — the same rule holds for every dashboard route, and the console shows "Unavailable" rather than zeros.

Read side (`api/appconfig.ts`, `_lib/clientConfig.ts`): public, no auth, and it never trusts the stored row. Unknown fields are dropped, strings are clipped, lists are capped, and scheduled items outside their window are withheld.

| Public key | Returns | Edge cache |
| --- | --- | --- |
| `client` | One bundle read at app boot: Home layout, greeting, broadcast, search synonyms, disabled catalogue sources, language order, AI starters, AI quick actions, FAQ, minimum build, and (7.2) the recommendation weight override `recConfig` while one targets someone | 60 s, plus a 60 s per-isolate memo of the database read |
| `flags` | Boolean feature flags | 60 s |
| `festival` | The festival theme override | 60 s |
| `banners` | Banners inside their start/end dates, at most 10 | 300 s |

Runbook, AI house rules, AI prices, AI emergency controls, trending pins, status note and the maintenance window are not in the public bundle. They are read by the console or by other Worker routes. The app also holds each answer for one to five minutes in its query cache, so a published change is visible within a few minutes, not instantly.

Config Backup exports and restores six keys as one JSON file: banners, festival, status note, flags, runbook and trending pins. It does not include the Home layout or the other keys.

## Feature flags

Flags are kill switches. A flag is on unless the published value is exactly `false`, so a missing row, an unreachable Worker or an unknown flag all mean "on".

| Flag | Off means |
| --- | --- |
| `aiDj` | The queue stops asking the AI DJ to order what plays next. The on-device recommender keeps building the queue. See [recommendations.md](recommendations.md) |
| `aiHome` | The "Designed for you" block on Home is hidden for everyone |
| `listenTogether` | The Listen Together entries are hidden |
| `codeRun` | The Run and Open buttons under code blocks in VinaX AI are hidden. See [ai.md](ai.md) |

The section also accepts custom flags. Names must match `^[a-zA-Z][a-zA-Z0-9_-]{0,39}$`; the public route enforces the same pattern, ships booleans only and stops at 50 flags. The app reads flags through `useFeatureFlags()` / `useFeatureEnabled()` in `frontend/src/features/home/useAppConfig.ts`. A toggle changes nothing until **Publish** is pressed. A published flag reaches listeners in about a minute.

Flags are not experiments. A/B Experiments has its own routes: a device's variant is a pure hash of its device id and the experiment key, computed identically in the app and in the Worker, so metrics are joined per variant without tagging events.

## Home layout publishing

Home Layout Studio sets the production default for the listener Home and stores it under the `home-layout` key.

| Field | Rule |
| --- | --- |
| Headline | Up to 60 characters |
| Description | Up to 160 characters |
| Order | The 13 shelf keys: `quick`, `personal`, `aihome`, `discovery`, `charts`, `seasonal`, `moods`, `genres`, `artists`, `albums`, `daypicks`, `loved`, `feed`. Unknown keys are dropped on the way out |
| Hidden | Shelves turned off for every listener; at most 12, so one shelf always stays on. The console also refuses to untick the last shelf |

What to know when using it:

- The up and down arrows publish the new order immediately. Headline, description and the visibility ticks are published by **Publish layout**. **Reset** publishes the defaults.
- The layout travels in the `client` bundle. The console reports "within about five minutes"; the caches involved are one minute each.
- On the listener's side (`frontend/src/features/home/`, tested in `homeLayout.test.ts`): with no local customisation the owner's order, text and hidden shelves apply. A listener who has arranged their own Home keeps their order, but shelves the owner turned off stay off, including ones turned off after the listener customised. The listener's Home Studio shows those shelves greyed and locked. A combination that would hide everything is ignored, so Home is never empty.
- The listener's own Home Studio is private to their device and publishes nothing.

## Section modules

New panels (7.2 onwards) are separate files under `frontend/public/admin/sections/`. `registry.js` loads before `app.js` and exposes `window.VinaXAdminSections.register(key, { local, load(h) })`; each panel file loads after `app.js` (script tags after the "section modules" comment in `index.html`) and registers itself. `app.js` dispatches to a registered module before its own panels and hands it helpers: `api`, `apiMemo`, `postApi`, `esc`, `html` (a tagged template that escapes every interpolation), `view`, `fail`, `stamp`, `setExport`, `days`, `isActive`, `navigate`.

Rules every module follows:

- Every value written into the page goes through `h.html` or `h.esc`. Fragments are joined as strings; data is never concatenated in raw.
- A failed read goes to `h.fail`, which renders "Unavailable" with the reason. Nothing is shown as zero while a read is failing.
- `local: true` marks an editor: the auto-refresh tick leaves it alone. Dashboards keep edits (if any) in module state so a refresh cannot wipe them.
- `frontend/src/__tests__/adminSections.test.ts` loads the real registry and panel files into a DOM with the console's own `esc` / `html` (cut out of `app.js`), feeds them answers whose labels contain markup, and fails if any element, event handler or `javascript:` link is created from data.

`app.js` still keeps its own tables of section titles, categories and which sections use the sidebar date range, and those do not list the modules. Until it reads them from the registry (each module passes a `title`), the 7.2 panels fill an empty toolbar heading themselves, bring their own 24h / 7d / 30d / 90d selector, and are missing from the command palette.

| Key | Panel | File | Route |
| --- | --- | --- | --- |
| `recquality` | Recommendation Quality (Analytics) | `sections/recquality.js` | `GET /api/admin/recquality` |
| `aiops` | AI Operations (AI & Engines) | `sections/aiops.js` | `GET /api/admin/aiops`, `POST /api/admin/appconfig` (`ai-controls`) |
| `recconfig` | Recommendation Tuning (Analytics), `local: true` | `sections/recconfig.js` | `GET` / `POST /api/admin/recconfig` |

## Recommendation Quality

How the automatic continuations are doing, from opt-in telemetry only. The panel opens with "Opt-in telemetry only — N devices": these rows come only from listeners who turned usage sharing on (see [data-and-privacy.md](data-and-privacy.md)), so the numbers describe that group and not all listeners.

`GET /api/admin/recquality?days=1..90` (default 7) reads up to 20,000 of the newest `vinax_events` rows of type `rec_served` (one automatic continuation appended) and `rec_outcome` (one automatic song started), with their `meta` column, and aggregates them in `aggregateRecQuality()` (pure, tested with fixtures in `backend/worker/__tests__/recQuality.test.ts`).

```
{ configured, provisioned, scope: 'opt-in', days, sampled, truncated, devices, minDevices, earlySkipSec,
  overall: Group, byAlg: Group[], byPicker: Group[], byVariant: Group[] }
Group = { key, devices, continuations, exposures, withheld,
  served:   { songs, latencyMs: Dist, fallback: Rate & { byReason }, languageViolations: { songs, rate: Rate },
              discovery: Rate, diversity: { n, mean }, relaxed: { rule: count } } | null,
  outcomes: { heardSec: Dist, completion: Rate, skip: Rate, earlySkip: Rate, likes: Rate, repeats: Rate } | null }
Rate = { k, n, rate, low, high }          (95 % Wilson interval, rates as 0..1)
Dist = { n, p50, p50Low, p50High, p95 }   (median with a distribution-free interval; p95 only from 20 samples)
```

| Measure | Definition |
| --- | --- |
| Served continuations | `rec_served` rows |
| Exposures | `rec_outcome` rows: automatic songs that started |
| Median listened | Median `heardSec` per exposure |
| Completion / skip rate | `outcome` = `complete` / `skip` or `early_skip`, over exposures with a known outcome |
| Early-skip rate | `early_skip`, or `skip` with under 30 s heard |
| Likes | `liked: true` over exposures |
| Repeats | Exposures of a song the same device was already served earlier in the window. Only the count leaves the route |
| Fallback rate | Continuations with a `fallback` reason, broken down by reason; an unknown reason counts as `other` |
| Language violations | `languageViolations` over songs served |
| Discovery share | `discovery` over songs served |
| Diversity | Mean distinct lead artists per continuation, from an optional `distinctArtists` field. The current telemetry contract does not send it, so the panel says "Not reported by this app version" |
| Latency | `latencyMs` p50 / p95 |

Breakdowns are by `meta.alg` (the weights version, for example `1.2.0` or `1.2.0+rc7`), by `meta.picker` (`local` or `ai`) and by each `experiment: variant` pair in `meta.exp`; at most 20 keys each, the rest folded into "(other)".

Privacy and honesty rules:

- Aggregates only. No device id, song id or timestamp of any listener is returned (the tests check the serialised report).
- A group with fewer than 3 distinct devices (`minDevices`) keeps its counts but withholds every rate. This includes "all devices" while fewer than 3 have reported.
- Every rate carries its sample count and interval. The console writes a rate from fewer than 30 samples as "k of n (likely a–b %)", never as a bare percentage.
- `meta` is written by clients and treated as untrusted: out-of-range numbers, unknown pickers and malformed experiment maps are dropped, not guessed.

Failure behaviour: a failed read answers `502 { configured: true, error }` (`db_unavailable`, `db_unauthorized`, …). If the read is refused with `400` and the same table reads fine without `meta`, the column does not exist yet: the route answers `200 { configured: true, provisioned: false, error: 'meta_not_provisioned', note }` and the panel says "Not provisioned" instead of showing zeros.

## AI Operations and emergency controls

`GET /api/admin/aiops?days=1..90` reads up to 20,000 `vinax_ai_events` rows and the `ai-controls` and `ai-prices` config rows, and reports, per feature and per provider lane (the `@lane` suffix of the model label) and in total: calls, failure rate with its interval, latency p50 / p95, fallback hops (`engine_fallback_*` and `engine_timeout` errors), calls refused by the controls (`ai_disabled`, `ai_over_budget`, when routes log them), prompt and completion tokens, and a cost estimate.

```
{ configured, days, sampled, truncated, tokenColumns,
  totals: Ops, byFeature: Ops[], byLane: Ops[], today: { day, calls, tokens, cost: Cost },
  controls: { read: 'ok'|'failed', error?, published, value: AiControls | null, rowUpdatedAt },
  budget: { day, tokenCap, tokensToday, tokenPct, costCapUsd, costTodayUsd, costComplete, costPct, state },
  prices: { read, configured }, controlFeatures }
Ops  = { key, calls, failures, failureRate: Rate, latencyMs: { n, p50, p95 }, hops,
         blocked: { disabled, overBudget }, tokens: { prompt, completion, reportedCalls }, cost: Cost }
Cost = { usd, pricedCalls, unpricedCalls, unreportedCalls, complete }
```

- Prices come from the same `ai-prices` table and helpers as AI Tokens & Cost (`parsePrices`, `modelSlug`, `matchPrice`, `costUsd` in `api/admin/aicost.ts`). A call whose model has no price, or whose provider reported no token counts, makes the cost unknown: `usd` is the known part (null when nothing could be priced) and `complete` says whether it is all of it. The console never shows an unknown cost as $0.
- Without the token columns (an older table) the route reads the other columns and sets `tokenColumns: false`.
- `budget.state` is one of `no_caps`, `within`, `over_tokens`, `over_cost`, `cost_unknown` (a cost cap is set but today's cost is only partly known) or `controls_unknown` (the config read failed). The day is the UTC day.
- A failed events read answers `502`; a failed config read keeps the numbers and marks controls and prices unknown.

The controls editor publishes the `ai-controls` key through `POST /api/admin/appconfig`:

```
{ emergencyOff: boolean,
  features: { dj, curate-metadata, curate-ranking, curate-home, curate-shelves, playlist, vinaxai, assistant, tts, lyrics, image: boolean },
  dailyTokenCap: number | null, dailyCostCapUsd: number | null, updatedAt, updatedBy? }
```

- A feature is on unless it is exactly `false`. Empty cap fields mean no cap.
- Switching all AI off asks for confirmation in the panel before anything is sent. Cancelling sends nothing.
- Before publishing, the panel re-reads the stored value. If someone published after the panel loaded (a different `updatedAt`), it refuses and asks the operator to discard their edits and look first.
- The panel shows when the controls were last published and by whom. "By" is an optional name the publisher types (`updatedBy`); with one shared token there is no verified operator identity.
- Enforcement is the Worker's AI router: a switched-off feature answers `503 ai_disabled`, a spent cap `503 ai_over_budget`. The `ai-controls` key must be in the appconfig allow-list for the publish to be accepted; until then the panel says "This Worker does not accept ai-controls yet" and nothing is published.

## Recommendation Tuning

A versioned, bounded override of the on-device scorer's weights (`frontend/src/services/recommendation/weights.ts`, `SCORING_WEIGHTS_VERSION` 1.2.0), staged to nobody, to one variant of an A/B experiment, or to every device.

`vinax_config` key `rec-config` holds the current record; `rec-config-history` holds the last 20 records, newest first. Neither key is in the appconfig allow-list, so only the validated route below can write them.

```
{ version, overrides: { <weight>: number }, rollout: { mode: 'off'|'experiment'|'all', experimentKey?, variant? },
  note, evaluation: null | { summary, url, at }, updatedAt, updatedBy }
```

`GET /api/admin/recconfig` answers `{ configured, version, current, live, history, weights, range, baseVersion, evalCommand, experiments, experimentsRead }`, where `weights` lists every key with its default, safe range and the scoring terms it moves, and `live` says whether the current record changes any device now.

`POST /api/admin/recconfig`:

| Body | Effect |
| --- | --- |
| `{ expectedVersion, overrides, rollout, note?, evaluation?, by? }` | Publish version `expectedVersion + 1` |
| `{ action: 'rollback', toVersion, expectedVersion, note?, by? }` | Publish that older version's overrides, rollout and evaluation as a new version |

| Answer | When |
| --- | --- |
| `200 { ok, record, clamped, historySaved }` | Published. `clamped` lists every value moved into its range |
| `400 { error: 'expected_version_required' }` | No `expectedVersion` |
| `400 { error: 'invalid', problems: [{ field, problem }] }` | Unknown weight key, a value that is not a number, bad rollout (unknown experiment or variant, a rollout with no override), an evaluation without a summary or with a non-`https` link |
| `404 { error: 'version_not_found' }` | Rollback to a version no longer in history |
| `409 { error: 'version_conflict', version, current }` | `expectedVersion` is not the stored version, or another publish won the race. Nothing is written |
| `502 { error }` | A database read or write failed |

Concurrency: the write is conditional on the version the operator edited from (an insert-if-absent for the first version, otherwise an update filtered on the stored `version`), so two operators can never silently overwrite each other. The history row is updated after the record and is best effort (`historySaved`).

Validation ranges: every override is clamped to half … double its default. The same rule runs in the Worker (`_lib/clientConfig.ts`, `REC_WEIGHT_DEFAULTS`, pinned to `weights.ts` by `backend/worker/__tests__/recConfig.test.ts`) and again on the device.

| Weight | Default | Min | Max |
| --- | ---: | ---: | ---: |
| `mood` | 0.16 | 0.08 | 0.32 |
| `vibe` | 0.1 | 0.05 | 0.2 |
| `language` | 0.12 | 0.06 | 0.24 |
| `dialect` | 0.08 | 0.04 | 0.16 |
| `genre` | 0.1 | 0.05 | 0.2 |
| `energy` | 0.1 | 0.05 | 0.2 |
| `tempo` | 0.08 | 0.04 | 0.16 |
| `artistAffinity` | 0.14 | 0.07 | 0.28 |
| `history` | 0.1 | 0.05 | 0.2 |
| `likes` | 0.1 | 0.05 | 0.2 |
| `skips` | 0.12 | 0.06 | 0.24 |
| `session` | 0.12 | 0.06 | 0.24 |
| `discovery` | 0.07 | 0.035 | 0.14 |
| `popularity` | 0.05 | 0.025 | 0.1 |
| `freshness` | 0.04 | 0.02 | 0.08 |
| `diversity` | 0.2 | 0.1 | 0.4 |
| `songAffinity` | 0.12 | 0.06 | 0.24 |
| `dayOfWeek` | 0.04 | 0.02 | 0.08 |
| `novelty` | 0.16 | 0.08 | 0.32 |
| `artistFatigue` | 0.04 | 0.02 | 0.08 |
| `intentArtist` | 0.18 | 0.09 | 0.36 |
| `intentLanguage` | 0.08 | 0.04 | 0.16 |
| `intentEnergy` | 0.3 | 0.15 | 0.6 |
| `intentSkippedSong` | 0.4 | 0.2 | 0.8 |

`artistAffinity` and `session` are declared but not read by the scorer; an override of either changes nothing, and the panel says so.

How a published version reaches a device:

1. The public `client` bundle (`GET /api/appconfig?key=client`) carries `recConfig: { version, overrides, rollout }` while a record targets someone: rollout `all`, or `experiment` with the experiment active and the variant present. Overrides are sanitised again on the way out (known keys, clamped); notes, evaluations and names never leave the console. For an experiment rollout the bundle also carries the experiment's live split (`rollout.variants`).
2. `useClientConfig()` (`features/home/useAppConfig.ts`) hands `recConfig` to `syncRecConfig()`. With no `recConfig` it restores the defaults and loads nothing; otherwise it lazily loads `services/recommendation/remoteWeights.ts` (not part of first load). A failed fetch changes nothing, and when two answers race the newer one wins.
3. `decideRecRollout()` targets the device: `all` applies everywhere; `experiment` applies only when `pickVariant(installId, experimentKey, variants)` — the same pure hash as `useExperiment()` and the Worker's experiment metrics — equals the configured variant. Anything else means the defaults.
4. `weights.ts` applies it: `applyWeightOverrides(overrides, { version, variant })` rewrites the live `RECOMMENDATION_WEIGHTS` object in place from the defaults (never stacking), clamping again; `resetWeightOverrides()` restores the defaults; `activeWeightsVersion()` returns `1.2.0` on the defaults and `1.2.0+rc<version>` while a version is applied, and `activeWeightOverride()` returns `{ version, variant, keys }` or null. The scorer and re-ranker read `RECOMMENDATION_WEIGHTS` on every call, so the next ranking pass uses the new weights.

The console never presents a weight change as proven. A version without an evaluation is labelled "unvalidated — no evaluation attached" wherever it appears; an evaluated one is described as evidence, not proof. **Preview scenario** shows, before publishing, a before / after table of every changed weight with its change, any clamp and the reason terms it moves, plus the offline evaluation to run first: `node frontend/scripts/eval-recs.mjs` with the proposed overrides. Target a treatment variant, not `control`: devices outside the experiment's traffic are reported as `control` by `useExperiment()` but are not in any variant.

## Limits

- One shared token; no per-operator identity in the audit trail. The optional "by" names in AI Operations and Recommendation Tuning are what the publisher typed.
- The failed-attempt throttle, and every rate limit, counts per edge location rather than globally: counters are shared by the isolates in one location and are permissive by design, so a client spread across locations gets a budget in each.
- The audit trail records the actor as `owner`, not a person. The migration path to operator identities, roles and revocable sessions is in [operations.md](operations.md).
- Browser-local sections do not follow the operator to another browser.
- Recommendation Quality and AI Operations read at most 20,000 rows per request; `truncated` says when a window held more.
- Browser end-to-end coverage for the console is in `frontend/e2e/admin-console.spec.ts`; see [testing.md](testing.md). The section modules are also covered by the DOM contract test above.
