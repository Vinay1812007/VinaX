# Owner console

The owner console is served at `/admin/`. It was rebuilt from scratch in 13.8 for the freshly wiped database: 16 pages in six groups replace the 70 sections of the old console, and every page was verified against a full database, an empty one and a database outage.

This document covers sign-in, the files, the framework every page uses (`VX` in `core.js`), how to add a page, every page with the routes it calls, how published settings reach listeners, and the tests.

## Sign-in and authorisation

Authorisation happens on the server, on every request. The page holds no secret and its sign-in form decides nothing.

1. The sign-in screen asks for the owner password (the Worker secret `ADMIN_LOGIN_PASSWORD`). The console keeps it in `sessionStorage` under `vinax_admin_token`, so it is gone when the tab closes.
2. Sign-in proves the password with one cheap call (`GET /api/admin/envcheck`) before the console opens. A wrong password, a lockout (429) and an unreachable server each get their own message.
3. Every API call sends the password as the `x-admin-token` header (`Authorization: Bearer …` is also accepted).
4. Every route file under `backend/worker/functions/api/admin/` checks `isAdminAsync(request, env)` before any other work and answers `401 {"error":"unauthorized"}` when it fails. Hiding a button is never the check.
5. A `401` on any later call signs the console out ("Your session ended — sign in again").

| Property | Behaviour |
| --- | --- |
| Secret not set | Always refuses. An unconfigured Worker has no console access |
| Comparison | Constant-time (`_lib/safe-compare.ts`) |
| Throttle | 15 wrong passwords from one address inside 10 minutes locks that address out; while locked out even the right password is refused |
| Shared counter | Wrong passwords are also counted in the `ADMIN_AUTH_FAILS` rate-limit binding, shared per edge location |
| Sessions | None on the server. Rotating `ADMIN_LOGIN_PASSWORD` signs everyone out at their next request |

### Audit trail

Mutating routes call `logAdminAudit()` (`_lib/adminAudit.ts`), which writes an `admin-audit` row into the feedback table with the action, target and redacted before/after values. **Database → Audit trail** reads up to 200 recent entries back.

## Files

The console is standalone static files in `frontend/public/admin/`, copied into the build unchanged. It never imports app code or app CSS.

| File | Role |
| --- | --- |
| `index.html` | Content security policy, icon sprite, sign-in screen, sidebar, top bar, and one `<script>` per file |
| `theme-boot.js` | Pre-paint: applies the stored theme before first paint |
| `console.css` | The only stylesheet: tokens (dark default, `html.light`), layout, components |
| `core.js` | The framework, global `VX`: DOM builder, API client, formatting, components, charts, config helpers, page registry |
| `pages/*.js` | One file per page; each calls `VX.page({...})` |
| `app.js` | The shell: sign-in, sidebar, hash router, top bar, Ctrl+K quick jump, auto-refresh. Loaded last |
| `festivals.js` | Generated festival calendar for **Home & promotion → Festival themes** (`npm run gen:festivals`) |
| `leaflet/` | Vendored map library for **Places → World map** |

Every script is a classic script with its own tag in `index.html`, not an ES module: `scripts/admin-stamp.mjs` adds `?v=<content hash>` to each listed URL at build time, and module imports would not be stamped (the custom domain's browser cache would serve stale files). `public/_headers` also marks every console file `no-cache`.

### Content security policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self' https://*.supabase.co https://nominatim.openstreetmap.org
```

- No inline scripts and no third-party script hosts.
- Pages build DOM only through `VX.h`, which makes text nodes; `innerHTML` and friends are banned (a unit test enforces it), so listener names, song titles and feedback text can never become markup.
- `style-src 'unsafe-inline'` covers `style` properties on chart bars and swatches.
- The only third-party request is the World map's city geocoder, through `VX.api.external()`, which never sends the owner password, cookies or a referrer.

## The framework (`core.js`)

| API | What it does |
| --- | --- |
| `VX.h('div.card#id', attrs, ...children)` | DOM builder. Strings are text. `onclick` etc. become listeners |
| `VX.api.get(path, params)` / `.post(path, body)` / `.blob()` | Same-origin calls with the owner token and a 25 s timeout. Always resolves to `{ ok, status, data, error, message }`; `message` is a plain-language explanation of the server's error code (`db_schema_missing` → "run vinax-13.sql", …). There is no PUT/DELETE: every admin write, including deletes, is a POST action |
| `VX.api.external(url)` | HTTPS GET to a third-party JSON service without credentials |
| `VX.config.get(key)` / `.all()` / `.set(key, value)` | Published settings through `/api/admin/appconfig` (one key per GET). `set(key, null)` clears a key so the app uses its default |
| `VX.ui.load(host, fetcher, render)` | Loading → render, or an error with **Try again** |
| `VX.ui.table({ columns, rows, ... })` | Sort, filter, paging and CSV export |
| `VX.ui.chart` / `hbars` / `share` / `spark` / `meter` / `kpis` | Dependency-free SVG charts and KPI tiles |
| `VX.ui.card`, `grid`, `tabs`, `field`, `input`, `select`, `toggle`, `segmented`, `button`, `pill`, `notice`, `empty`, `error` | Components |
| `VX.modal`, `VX.confirm({ danger, typed })`, `VX.drawer`, `VX.toast` | Dialogs (focus-trapped, Escape closes) and toasts |
| `VX.fmt.*` | Numbers, percentages, money, durations, dates, "x ago", country names. Never prints `NaN` or `undefined` |
| `VX.fillDays(rows, days, key, valueKeys)` | Fills missing days in a daily series with 0 |
| `VX.download.csv/json` | Downloads; CSV cells are protected against spreadsheet formula injection |

Every page must handle three states: data, an **empty database** (explain what will appear and when — never look broken) and a **failed request** (the reason and **Try again**).

## The shell (`app.js`)

- Routes are `#/<page>/<tab>?<params>`, so every page and tab has a link, and browser Back works. Pages keep filters such as the time range in the URL through `ctx.setParam`.
- **Ctrl K** (⌘K) opens quick jump over every page and tab. **R** refreshes the page.
- **Auto** in the top bar refreshes the current page every 30 s, except while a dialog is open, while the owner is typing, or on pages with forms (`noAuto: true`). Live panels poll on their own through `ctx.every(ms, fn)`, which stops when you leave the page.
- Below 960 px the sidebar becomes a menu.

## Adding a page

1. Create `frontend/public/admin/pages/<id>.js`:

   ```js
   (function () {
     'use strict';
     var VX = window.VX, h = VX.h, ui = VX.ui;
     VX.page({
       id: 'example', title: 'Example', group: 'System', icon: 'grid',
       desc: 'One sentence under the title.',
       tabs: [{ id: 'main', label: 'Main', render: function (host, ctx) {
         return ui.load(host, function () { return VX.api.get('/api/admin/example'); }, function (d) {
           return ui.card({ title: 'Rows', body: ui.table({ columns: [{ key: 'name', label: 'Name' }], rows: d.rows || [], empty: 'Nothing yet' }) });
         });
       } }]
     });
   })();
   ```

2. Add `<script src="/admin/pages/<id>.js"></script>` to `index.html` after `core.js` and before `app.js`. Groups: Dashboards, Audience, Music, Content, Intelligence, System. Icons are the sprite ids in `index.html` without `i-`.
3. Add the Worker route under `backend/worker/functions/api/admin/`, starting with the `isAdminAsync` check, and answer `{ configured: false }` when the database is not set.
4. `src/__tests__/adminConsole.test.ts` then checks the page loads, registers correctly and survives an empty and a failing database. Add a Playwright spec for its writes.

## Pages

| Page | Tabs | Routes |
| --- | --- | --- |
| **Overview** | — | `realtime` (polled every 15 s), `overview` (now includes signed-in `accounts`), `envcheck` (Needs attention) |
| **Live** | Now listening · Activity feed · Listen Together · Pulse | `live`, `activity`, `rooms` (end one room / close all), `realtime` |
| **Listeners** | All listeners · Top listeners | `users` (accounts and devices merged, search, filters, CSV of everyone), `user` (profile drawer: report, JSON and activity downloads), `maintenance` `delete_user` (reason + typed DELETE), `insights` |
| **Growth & engagement** | Growth · Engagement · Retention · Funnel · Segments · Feature usage · Heatmap · Insights | `growth`, `engagement`, `retention` (percentages computed from cohort counts), `funnel`, `insights`, `usage`, `digest` |
| **Places** | Countries & cities · World map | `location`, `live`; city geocoding cached in this browser |
| **Music** | Top charts · Search · Skips · Song drilldown | `music`, `insights`, `search-analytics`, `skips` (rate = skips ÷ plays), `songstats`, `content` (block) |
| **Trends** | Sources · Review queue · Editorial picks · Trending pins | `trends` (run, review, validate-import, import, withdraw), config `trending-pins` |
| **Catalog** | Blocked content · Catalog lookup · Search synonyms · Catalog sources · Language order · Import / export · SEO pages | `content`, `catalog-search`, config `search-synonyms`, `catalog-sources`, `language-order`, `seo` |
| **Home & promotion** | Banners & offers · Festival themes · Home greeting · Home layout · Help center FAQ · Announcement | config `banners`, `festival`, `greeting`, `home-layout`, `support-faq`, `broadcast` |
| **Notifications** | Send · History · Audience | `push` (dry-run count, then send; everyone needs a confirm), `notifylog` (retract also removes its delivery receipt), `fcmcheck`, `envcheck` |
| **VinaX AI** | Usage & health · Controls · Cost & tokens · API lab · Engine probe · Assistant content | `ai`, `aiops`, config `ai-controls` (full object, all 17 switches), `aicost`, config `ai-prices`, `ailab`, `enginetest`, `musicapi`, config `ai-starters`, `ai-quick`, `ai-rules` |
| **Recommendations** | Quality · Tuning · Experiments | `recquality`, `recconfig` (publish with `expectedVersion`, history, rollback), `experiments` |
| **Health** | System status · App errors · Endpoints · Scheduled jobs · Data quality · Releases · Server secrets · Status note | `health` (spends a few model tokens: once per visit, then on demand), `technical` (`clear_errors`), `edge`, `cron` ("Not run yet" on a fresh database), `dataquality`, `releases` (names a rejected `GITHUB_TOKEN`), `envcheck`, config `status-note`, `/api/status` |
| **Feedback** | — | `feedback` (status/type filters, mark read/resolved, delete resolved) |
| **Database** | Tables · Browse data · Audit trail · Fresh database | `tables`, `maintenance` (`purge_events`, `trim_ai` behind a typed DELETE), `query`, `audit`, a checklist for a reset database |
| **Settings** | Feature switches · Maintenance · App versions · Backup & restore · Runbook | config `flags`, `maintenance` `site_mode` + `/api/site-mode`, config `maintenance-window`, `min-version`, `/changelog.json`, every config key, `runbook` |

Removed in 13.8: the browser-only Operations Workspace, App Configuration and Pinned Tools, and the Songs / Playlists / Categories screens, which were read-only mock-ups over routes that never existed.

## Fresh database

The console expects the schema from `frontend/supabase/vinax-13.sql` (tables, row-level security and the analytics functions). On a new or wiped database:

1. In the database SQL editor run `frontend/supabase/vinax-13.sql` (idempotent). To start over, run `vinax-wipe.sql` first.
2. Set the Worker secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see [operations.md](operations.md)).
3. Open **Database → Fresh database**: every table should read OK or Empty. A missing table or function shows as `db_schema_missing` with the file to run.

Empty pages are expected until listeners use the app: each one says what will appear.

## How a published setting reaches listeners

```
console page ──POST /api/admin/appconfig {key, value}──▶ Worker
                                                            │ isAdmin · key allow-list · size cap · upsert · audit row
                                                            ▼
                                                     vinax_config (key → JSON)
                                                            │
listener app ◀──GET /api/appconfig?key=…── Worker ◀─────────┘
                  sanitised again on the way out, edge-cached
```

Write side (`api/admin/appconfig.ts`): the key must be in `ALLOWED_KEYS`, the serialised value must be under 900 KB, and the row is upserted with a timestamp. Without the database configured, reads answer `{ configured: false }` and writes answer `503`. A read that fails answers `502` with its kind (`db_unavailable`, `db_unauthorized`, `db_schema_missing`, `db_bad_request`) instead of an empty value an editor could publish over the stored config. The same rule holds for the dashboard routes, and the console shows an error state instead of zeros.

Read side (`api/appconfig.ts`, `_lib/clientConfig.ts`): public, no auth, and it never trusts the stored row. Unknown fields are dropped, strings are clipped, lists are capped, and scheduled items outside their window are withheld.

| Public key | Returns | Edge cache |
| --- | --- | --- |
| `client` | One bundle read at app boot: Home layout, greeting, broadcast, search synonyms, disabled catalogue sources, language order, AI starters, AI quick actions, FAQ, minimum build, and the recommendation weight override `recConfig` while one targets someone | 60 s, plus a 60 s per-isolate memo of the database read |
| `flags` | Boolean feature flags | 60 s |
| `festival` | The festival theme override | 60 s |
| `banners` | Banners inside their start/end dates, at most 10 | 300 s |

Runbook, AI house rules, AI prices, AI emergency controls, trending pins, status note and the maintenance window are not in the public bundle; the console or other Worker routes read them. The app also holds each answer for one to five minutes in its query cache, so a published change is visible within a few minutes, not instantly.

**Settings → Backup & restore** downloads every published key as one JSON file and restores from one with a per-key diff, publishing the keys you tick one at a time.

### Who the Listeners page lists

Two sources, merged by last seen, newest first:

- **Usage rows** (`vinax_users`): written by `/api/events`, so a listener appears only after ticking "share usage" (unticked by default) and playing. These carry the location, the platform and the plays. A row whose device is linked to a signed-in account shows the account's name and username when the device has none, and an "account" mark.
- **Every row (13.7)** shows the account's profile photo (or initial), name, @username and Gmail. The search box searches name, @username and Gmail as you type (250 ms after the last key); an older, slower answer never replaces a newer one. A Gmail search also finds a usage row whose device is linked to that account. Console scripts and styles load with a content stamp (`scripts/admin-stamp.mjs`), so a deploy is never hidden behind the custom domain's four-hour browser cache.
- **Account rows** (`vinax_accounts` with no linked device): everyone who signed in with Google and has no usage row yet. The *Device* column shows the platform they last signed in on and "not sharing usage"; the *Location* is the city and country of that sign-in (13.7). There are no plays. The row's id is `account:<Google account id>`. The drill-down shows the name, email, photo and dates; **Delete** removes the account (its synced library goes with it) and signs the listener out.

A device is linked to an account when it proves its signed id: at sign-in, or on the app's once-per-load session check (`GET /api/auth/me` with the `x-vinax-device` header), which also refreshes the account's last seen at most every 10 minutes. The welcome and its usage tick come after sign-in, so a new listener is linked on their next app load; until then they can show as both an account row and a usage row. Deleting a usage row unlinks its account, which then shows as an account row again.

The cards add the two together: *Total users*, *Active (24h)* and *New (24h)* count usage rows plus unlinked accounts; *Signed in* counts every account. If the account read fails the usage list still shows, the answer names `unavailable: ["accounts"]`, and *Signed in* shows a dash. The list is merged up to 10,100 rows deep (the CSV export's 100 pages of 100).

### Listener downloads (Listeners page)

| Control | File | Contents |
| --- | --- | --- |
| **Download** in a row's *Profile download* column, **Download profile** in the drill-down | `vinax-profile-<name>-<date>.html` | the drill-down as a page: the header line, the counts, top songs with their play bars, languages, and the 300 most recent events. One self-contained file — no styles, scripts or images are loaded when it is opened — so it can be kept, sent, or printed to PDF |
| **JSON** in the drill-down | `vinax-listener-<name>-<date>.json` | the raw record for data work: the latest-state row and every event the endpoint returns |
| **Activity (CSV)** in the drill-down | `vinax-activity-<name>-<date>.csv` | the same event window as a spreadsheet |
| **Download listeners (CSV)** | `vinax-listeners[-<search>]-<date>.csv` | every row of the current list, walked 100 at a time to the end (not just the page on screen), honouring the search box; it stops after 100 pages |

All four read `/api/admin/user?full=1` or `/api/admin/users`. `profileFacts()` derives the counts, top songs and languages the panel shows, and both the panel and the downloaded page read it, so the two cannot disagree.

The taste profile that drives recommendations is built and kept on the listener's own device and is never uploaded, so it is not in these files — the exported JSON says so in a `note` field. Downloads carry personal data: treat them as such (see [data-and-privacy.md](data-and-privacy.md)).

### Feature flags

Flags are kill switches. A flag is on unless the published value is exactly `false`, so a missing row, an unreachable Worker or an unknown flag all mean "on".

| Flag | Off means |
| --- | --- |
| `aiDj` | Stored but not read by the app (the AI DJ is a per-listener setting). The Feature switches tab lists it as unused |
| `aiHome` | The "Designed for you" block on Home is hidden for everyone |
| `listenTogether` | The Listen Together entries are hidden |
| `codeRun` | The Run and Open buttons under code blocks in VinaX AI are hidden. See [ai.md](ai.md) |

The page also keeps custom flags. Names must match `^[a-zA-Z][a-zA-Z0-9_-]{0,39}$`; the public route enforces the same pattern, ships booleans only and stops at 50 flags. The app reads flags through `useFeatureFlags()` / `useFeatureEnabled()` in `frontend/src/features/home/useAppConfig.ts`. A toggle changes nothing until **Publish** is pressed.

Flags are not experiments. **Recommendations → Experiments** has its own route: a device's variant is a pure hash of its device id and the experiment key, computed identically in the app and in the Worker.

### Home layout

**Home & promotion → Home layout** sets the production default for the listener Home and stores it under the `home-layout` key.

| Field | Rule |
| --- | --- |
| Headline | Up to 60 characters |
| Description | Up to 160 characters |
| Order | The 13 shelf keys: `quick`, `personal`, `aihome`, `discovery`, `charts`, `seasonal`, `moods`, `genres`, `artists`, `albums`, `daypicks`, `loved`, `feed`. Unknown keys are dropped on the way out |
| Hidden | Shelves turned off for every listener; at most 12, so one shelf always stays on. The console also refuses to untick the last shelf |

- The up and down arrows publish the new order immediately. Headline, description and the visibility ticks are published by **Publish layout**. **Reset** publishes the defaults.
- A listener who has arranged their own Home keeps their order, but shelves the owner turned off stay off. A combination that would hide everything is ignored, so Home is never empty (`frontend/src/features/home/`, tested in `homeLayout.test.ts`).

## Recommendation Quality

How the automatic continuations are doing, from opt-in telemetry only (see [data-and-privacy.md](data-and-privacy.md)). The numbers describe listeners who turned usage sharing on, not all listeners.

`GET /api/admin/recquality?days=1..90` (default 7) reads up to 20,000 of the newest `vinax_events` rows of type `rec_served` and `rec_outcome` and aggregates them in `aggregateRecQuality()` (tested in `backend/worker/__tests__/recQuality.test.ts`).

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

Breakdowns are by `meta.alg` (the weights version), `meta.picker` (`local` or `ai`) and each `experiment: variant` pair in `meta.exp`; at most 20 keys each, the rest folded into "(other)".

- Aggregates only. No device id, song id or timestamp of any listener is returned.
- A group with fewer than 3 distinct devices (`minDevices`) keeps its counts but withholds every rate.
- Every rate carries its sample count and interval. A rate from fewer than 30 samples is written as "k of n (likely a–b %)".
- `meta` is written by clients and treated as untrusted: out-of-range numbers, unknown pickers and malformed experiment maps are dropped.
- A failed read answers `502 { configured: true, error }`. When the table has no `meta` column yet the route answers `200 { configured: true, provisioned: false, error: 'meta_not_provisioned', note }` and the panel says "Not provisioned".

## AI Operations and emergency controls

`GET /api/admin/aiops?days=1..90` reads up to 20,000 `vinax_ai_events` rows and the `ai-controls` and `ai-prices` config rows. It reports, per feature, per provider lane and in total: calls, failure rate with its interval, latency p50 / p95, fallback hops, calls refused by the controls, prompt and completion tokens, and a cost estimate.

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

- Prices come from the same `ai-prices` row and helpers as AI Tokens & Cost (`api/admin/aicost.ts`). A call with no price or no token counts makes the cost unknown: `usd` is the known part and `complete` says whether it is all of it. The console never shows an unknown cost as $0.
- `budget.state` is one of `no_caps`, `within`, `over_tokens`, `over_cost`, `cost_unknown` or `controls_unknown`. The day is the UTC day.
- A failed events read answers `502`; a failed config read keeps the numbers and marks controls and prices unknown.

The controls editor publishes the `ai-controls` key through `POST /api/admin/appconfig`: `{ emergencyOff, features, dailyTokenCap, dailyCostCapUsd, updatedAt, updatedBy? }`, where `features` holds one boolean per name in `AI_FEATURES` (`_lib/ai.ts`), which the route returns as `controlFeatures`.

**Web search (11.8).** The chat's web search through the search service is the `web-search` feature. Its switch is in the controls editor, and the emergency stop stops it too. Switched off, the chat still answers, without search results. Each search that spent a credit is one `byFeature` row under `web-search` (model `serper`, which lands in `byLane` as `(none)` because it has no `@lane`). Cache hits are not logged, so today's `web-search` calls are the credits spent today, and the same rows feed the daily cap (`SERPER_DAILY_LIMIT`, default 80). Those rows add calls but never tokens or unknown cost. The Environment Checklist shows `SERPER_API_KEY` and `SERPER_DAILY_LIMIT` under **Web search**. Setting the key and the cap: [operations.md](operations.md#web-search-in-vinax-ai-118).

- A feature is on unless it is exactly `false`. Empty cap fields mean no cap.
- Switching all AI off asks for confirmation before anything is sent.
- Before publishing, the panel re-reads the stored value. If someone published after the panel loaded (a different `updatedAt`), it refuses and asks the operator to look first.
- "By" is an optional name the publisher types (`updatedBy`); it is not a verified identity.
- Enforcement is the Worker's AI router: a switched-off feature answers `503 ai_disabled`, a spent cap `503 ai_over_budget`.

## Recommendation Tuning

A versioned, bounded override of the on-device scorer's weights (`frontend/src/services/recommendation/weights.ts`, `SCORING_WEIGHTS_VERSION` 1.3.0), staged to nobody, to one variant of an A/B experiment, or to every device.

`vinax_config` key `rec-config` holds the current record; `rec-config-history` holds the last 20 records, newest first. Neither key is in the appconfig allow-list, so only the route below can write them.

```
{ version, overrides: { <weight>: number }, rollout: { mode: 'off'|'experiment'|'all', experimentKey?, variant? },
  note, evaluation: null | { summary, url, at }, updatedAt, updatedBy }
```

`GET /api/admin/recconfig` answers `{ configured, version, current, live, history, weights, range, baseVersion, evalCommand, experiments, experimentsRead }`. `weights` lists every key with its default, safe range and the scoring terms it moves; `live` says whether the current record changes any device now.

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

The write is conditional on the version the operator edited from, so two operators can never silently overwrite each other. The history row is updated after the record and is best effort (`historySaved`).

Every override is clamped to half … double its default. The same rule runs in the Worker (`REC_WEIGHT_DEFAULTS` in `_lib/clientConfig.ts`, pinned to `weights.ts` by `backend/worker/__tests__/recConfig.test.ts`) and again on the device.

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

How a published version reaches a device:

1. The public `client` bundle carries `recConfig: { version, overrides, rollout }` while a record targets someone: rollout `all`, or `experiment` with the experiment active and the variant present. Overrides are sanitised again on the way out; notes, evaluations and names never leave the console.
2. `useClientConfig()` (`features/home/useAppConfig.ts`) hands `recConfig` to `syncRecConfig()`, which lazily loads `services/recommendation/remoteWeights.ts`. With no `recConfig` it restores the defaults.
3. `decideRecRollout()` targets the device: `all` applies everywhere; `experiment` applies only when `pickVariant(installId, experimentKey, variants)` equals the configured variant.
4. `applyWeightOverrides()` in `weights.ts` rewrites the live weights from the defaults, clamping again. `activeWeightsVersion()` returns `1.3.0` on the defaults and `1.3.0+rc<version>` while a version is applied.

The console never presents a weight change as proven. A version without an evaluation is labelled "unvalidated — no evaluation attached". **Preview scenario** shows a before / after table of every changed weight and the offline evaluation to run first: `node frontend/scripts/eval-recs.mjs` with the proposed overrides (see [evaluation.md](evaluation.md) and [recommendations.md](recommendations.md)). Target a treatment variant, not `control`.

## Tests

- `frontend/src/__tests__/adminConsole.test.ts` (`npm test`) loads the real `core.js` and every page into a DOM. It checks `index.html` loads every page file in order under the strict CSP, every page registers a unique id, a known group and an existing icon, no console script assigns HTML strings or calls `fetch` directly, and **every page and tab renders from an empty database and from a database outage** without throwing or printing `undefined`, `NaN` or `[object Object]`.
- `frontend/e2e/console-shell.spec.ts`: sign-in (wrong and right password, sign out), Overview with data, empty and outage, every sidebar page, Ctrl+K, the phone menu.
- `frontend/e2e/console-audience.spec.ts`, `console-content.spec.ts`, `console-intelligence.spec.ts`, `console-system.spec.ts`: every tab of every page with data, empty and failing, and the exact POST body of every write. All mock `/api/**` and block non-local network.
- `backend/worker/__tests__/console138.test.ts`: the server fixes made for the rebuild (clearing a config key, cron on an empty database, table counts, SEO columns, account counts, paged reads past 1,000 rows, delete order, notification receipts, AI switches).
- The console was also checked with axe (WCAG 2.1 A/AA) on every tab in both themes.

## Limits

- One shared password; the audit trail records the actor as `owner`, not a person.
- The failed-attempt throttle counts per edge location, not globally.
- Push has no single-device test target: use **Count recipients** with a narrow segment.
- Reads past 1,000 rows are paged in 1,000-row pages, up to 20 pages (20,000 rows) per read; `truncated` says when a window held more.
- Several settings (`flags`, `min-version`, `maintenance-window`, `banners`) are validated in the console, not on the server.
