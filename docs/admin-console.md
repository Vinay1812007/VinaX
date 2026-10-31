# Owner console

The owner console is served at `/admin/`. Since 14.0 it reads and writes the database described in [database.md](database.md): twelve pages in four groups cover what is happening now, who is listening, what they play and report, what the owner publishes to every app, notifications, the catalogue, the database itself and the health of the deployment. Every page is verified against a full database, an empty one and a database outage.

This document covers sign-in, the audit trail, the files, the framework every page uses (`VX` in `core.js`), how to add a page, every page with the routes it calls, the settings vocabulary and how a published setting reaches listeners, the fresh-database checklist, and the tests.

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

Every owner action that changes something leaves a row in `audit_log` through `_lib/audit.ts`: who (`owner`; there is one shared password), the action (`settings`, `feedback-status`, `push-send`, `listener-delete`, …), the target, a one-line summary, the value before and after for setting changes, and the edge request id. Secret-looking keys and strings are redacted before the row is written, and oversized values are reduced to their size and a digest. The **Database → Audit trail** tab lists the rows (`GET /api/admin/audit`). A failed audit write never fails the action it describes.

## The three answers every page handles

| The server says | The page shows |
| --- | --- |
| `{ configured: false }` | A setup card: the database secrets are not set on the Worker, with the two names and a link to the steps in [database.md](database.md#setting-it-up). Never an empty chart |
| `502 { error: 'db_…' }` | "Could not load" with the reason (`db_unavailable`, `db_not_found` = `schema.sql` not applied, `db_unauthorized` = wrong key) and **Try again**. Never a zero |
| Data, or an empty answer | The data; for an empty answer, an empty state that says what will appear and when |

## Files

The console is standalone static files in `frontend/public/admin/`, copied into the build unchanged. It never imports app code or app CSS.

| File | Role |
| --- | --- |
| `index.html` | Content security policy, icon sprite, sign-in screen, sidebar, top bar, and one `<script>` per file |
| `theme-boot.js` | Pre-paint: applies the stored theme before first paint |
| `console.css` | The only stylesheet: tokens (dark default, `html.light`), layout, components |
| `core.js` | The framework, global `VX`: DOM builder, API client, formatting, components, charts, page registry |
| `pages/*.js` | One file per page; each calls `VX.page({...})` |
| `app.js` | The shell: sign-in, sidebar, hash router, top bar, Ctrl+K quick jump, auto-refresh. Loaded last |
| `festivals.js` | Generated festival calendar (`npm run gen:festivals`) for the Festival theme editor on **Publish** |

Every script is a classic script with its own tag in `index.html`, not an ES module: `scripts/admin-stamp.mjs` adds `?v=<content hash>` to each listed URL at build time, and module imports would not be stamped (the custom domain's browser cache would serve stale files). `public/_headers` also marks every console file `no-cache`.

### Content security policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self'
```

- No inline scripts, no third-party script hosts and no third-party requests.
- Pages build DOM only through `VX.h`, which makes text nodes; `innerHTML` and friends are banned (a unit test enforces it), so listener names, song titles, feedback text and provider answers can never become markup.
- `style-src 'unsafe-inline'` covers `style` properties on chart bars and swatches.

## The framework (`core.js`)

| API | What it does |
| --- | --- |
| `VX.h('div.card#id', attrs, ...children)` | DOM builder. Strings are text. `onclick` etc. become listeners |
| `VX.api.get(path, params)` / `.post(path, body)` / `.blob()` | Same-origin calls with the owner token and a 25 s timeout. Always resolves to `{ ok, status, data, error, message }`; `message` is a plain-language explanation of the server's error code. There is no PUT/DELETE: every admin write, including deletes, is a POST `{ action, … }` |
| `VX.api.external(url)` | HTTPS GET to a third-party JSON service without credentials |
| `VX.ui.load(host, fetcher, render)` | Loading → render, or an error with **Try again** |
| `VX.ui.table({ columns, rows, ... })` | Sort, filter, paging and CSV export |
| `VX.ui.chart` / `hbars` / `share` / `spark` / `meter` / `kpis` | Dependency-free SVG charts and KPI tiles |
| `VX.ui.card`, `grid`, `tabs`, `field`, `input`, `select`, `toggle`, `segmented`, `button`, `pill`, `notice`, `empty`, `error`, `daysPicker` | Components |
| `VX.modal`, `VX.confirm({ danger, typed })`, `VX.drawer`, `VX.toast` | Dialogs (focus-trapped, Escape closes) and toasts |
| `VX.fmt.*` | Numbers, percentages, money, durations, dates, "x ago", country names. Never prints `NaN` or `undefined` |
| `VX.download.csv/json` | Downloads; CSV cells are protected against spreadsheet formula injection |

Every page must handle the three answers above. Destructive actions (`delete`, `purge_events`, `end_all_rooms`, sending to everyone) go through `VX.confirm` with `danger`, and the ones that cannot be undone require a typed word.

## The shell (`app.js`)

- Routes are `#/<page>/<tab>?<params>`, so every page and tab has a link, and browser Back works. The console opens on **Overview**.
- Sidebar groups, in order: System, Audience, Intelligence, Content.
- **Ctrl K** (⌘K) opens quick jump over every page and tab. **R** refreshes the page.
- **Auto** in the top bar refreshes the current page every 30 s, except while a dialog is open, while the owner is typing, or on pages with forms (`noAuto: true`). Live polls on its own (every 15 s) regardless.
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
           if (d.configured === false) return VX.ui.setupCard();
           return ui.card({ title: 'Rows', body: ui.table({ columns: [{ key: 'name', label: 'Name' }], rows: d.rows || [], empty: 'Nothing yet' }) });
         });
       } }]
     });
   })();
   ```

2. Add `<script src="/admin/pages/<id>.js"></script>` to `index.html` after `core.js` and before `app.js`. Groups: System, Audience, Intelligence, Content (a new group goes into `GROUPS` in `app.js` and in the unit test). Icons are the sprite ids in `index.html` without `i-`.
3. Add the Worker route under `backend/worker/functions/api/admin/`, starting with the `isAdminAsync` check, answering `notConfigured()` when `dbConfigured(env)` is false and `dbFailure(r)` for a failed read, and register it in `backend/worker/index.ts` (`routerCoverage.test.ts` enforces it). Document its shape in [database.md](database.md#admin-api).
4. `src/__tests__/adminConsole.test.ts` then checks the page loads, registers correctly and survives empty and failing answers. Add it to `e2e/console-pages.spec.ts`.

## Pages

The admin API each page calls is specified route by route in [database.md](database.md#admin-api); `?days=` is 1..90, default 7.

| Group · Page | Tabs | Routes |
| --- | --- | --- |
| **System · Overview** (landing) | — | `overview`: the tiles (`stats_overview`), the 14-day timeline, platforms, and an **attention** list naming anything the owner should look at (missing secrets, new feedback, failing jobs, errors rising) with a link to the page that fixes it |
| **System · Live** | Now listening · Activity feed · Listen Together | `live` (polled every 15 s): who is listening now with the song, the newest events, open rooms with member counts; `end_room` and `end_all_rooms` behind a confirm |
| **System · Database** | Tables · Jobs · Audit trail · Maintenance | `database` (schema version, every table with rows and size, exact counts, the scheduled jobs with last run and overdue flag), `audit`; `purge_events { days }`, `sweep_rooms`, `retire_push { days }` and `run_job { job }` behind confirms; a fresh-database checklist when `configured` is false or the schema is missing |
| **System · Health** | App errors · Endpoints · Catalogue sources · VinaX AI · Personal engine · Releases · Server secrets | `analytics?view=errors` with `clear_errors`, `edge`, `musicapi` (each music catalogue source checked with a one-song search, on a button press), `ai` (VinaX AI's providers: keys set or missing, rests, last errors, the owner's model switches, today's search allowances and voice; `POST ai { model }` probes one model, and **Probe enabled models** runs them one after another, on a button press only; [ai.md](ai.md#the-consoles-providers-card)), `personal` (the personal engine: accounts with a taste model, events, the song pool and its embedding backlog, pages composed, the weights after clamping; `POST personal { action: 'embed' | 'colisten' }` runs the embed backlog or the co-listening rebuild now; [personalisation.md](personalisation.md#owner-console)), `releases` (names a rejected `GITHUB_TOKEN`), `envcheck` (now includes the two database secrets as required and `CRON_SECRET` as optional) |
| **Audience · Listeners** | All listeners · Profile (drawer) | `listeners` (the `directory` view: devices with their accounts and account-only rows, search on name, handle and email, platform and activity filters, counts by platform, CSV); `listeners?id=` / `?account=` for the profile drawer (`listener_profile`: facts, counts, top songs, languages, the last 300 events; JSON and CSV downloads); `delete { id, account, reason }` behind a typed confirm |
| **Audience · Analytics** | Music · Places · Engagement · Retention · Funnel · Skips · Errors | `analytics?view=…&days=`: top songs, artists, languages and what is rising; countries and cities; the event mix, hour-of-week heat map (IST), platforms and app versions, segments; weekly cohorts; the onboarding funnel; skip rates; app errors |
| **Audience · Feedback** | Inbox | `feedback` with status and kind filters; `status { id, status, note }` (new → read → resolved, with an owner note), `delete { id }`, `delete_resolved` |
| **Intelligence · Experiments** | — | `experiments`; `save { key, name, variants, active }` (variants sum to at most 100), `delete { key }`. Assignment stays on the device; the server never learns who is in which variant |
| **Content · Catalog** | Catalog lookup · Blocked content | `catalog-search`; `content` (blocked songs, artists and keywords, plus the most-played songs as block suggestions), `block { kind, value, label, reason }`, `unblock { id }` |
| **Content · Publish** | One tab per group: Home & promotion · App · Catalog · Operations | `settings` (every key with its current value, who changed it and when), `settings?key=` (the value and its history), `POST settings { key, value }` (null clears). Editors per key: banners, festival theme (from `festivals.js`), greeting, broadcast, Home layout, announcement, FAQ, feature switches, VinaX AI (on or off, testers, web search, each model's switch and picker order; the model list comes from `GET ai`), minimum build, site mode and status note, maintenance window, retention, push rules, synonyms, catalogue sources, language order |
| **Content · Notifications** | Send · History · Audience · Push setup | `push` (what is configured, active devices per channel, audience counts by country, region, city and language); `POST push` with `dryRun: true` first, then the send (a `dedupeKey` refuses a double-click; everyone needs a confirm); `notifications` with `retract { id }`; `envcheck` (the Push group) and `fcmcheck` |

The admin routes that read no storage are `catalog-search`, `edge`, `envcheck`, `fcmcheck`, `musicapi` and `releases`.

### Fresh database

When the database secrets are set but `schema.sql` has not been run, every data route answers `502 db_not_found` and the **Database** page shows the checklist: paste `backend/supabase/schema.sql`, confirm the schema version, set the secrets if they are missing, run the status tick once. When the secrets are missing, every data page shows the setup card instead of its content; Health and the catalogue lookup keep working.

## Published settings

Everything the owner publishes to every app is a row in `settings`: one key, one JSON value, written only through `POST /api/admin/settings` from the **Publish** page, with the change appended to `settings_history` and an audit row. The vocabulary is `SETTING_KEYS` in `backend/worker/functions/_lib/settings.ts`; a key outside it is refused (`400 unknown_key`), and a value over 60 KB is refused (`413 too_large`).

| Group | Key | What it holds |
| --- | --- | --- |
| Home & promotion | `banners` | Cards on Home: title, subtitle, link, start/end dates, image. At most 10 live |
| | `festival` | Force a festival skin on or off: `{ id, mode: "on" \| "off", start, end }` |
| | `greeting` | A line under the Home title: `{ text, start?, end? }` |
| | `broadcast` | A dismissible message in the app: `{ id, text, link?, start?, end? }` |
| | `home-layout` | Shelf order and hidden shelves: `{ title, description, order, hidden }` (at most 12 hidden, so one shelf always stays) |
| | `announcement` | What the Android app shows on open: `{ title, body, link?, ts }`. The push sender writes it too |
| App | `support-faq` | Help center questions and answers: `[{ q, a }]` |
| | `flags` | Boolean feature switches the app reads: `listenTogether`, … |
| | `min-version` | Older Android builds must update: `{ build }` |
| Catalog | `search-synonyms` | `{ "typed": "meant" }` pairs applied to searches |
| | `catalog-sources` | `{ sourceId: false }` disables a catalogue source for everyone |
| | `language-order` | Languages in the order Home offers them |
| Operations | `site-mode` | `{ mode: "live" \| "maintenance", note? }`: maintenance shows the gate to everyone |
| | `maintenance-window` | A planned window `{ start, end, note }`; the gate shows inside it |
| | `status-note` | An owner note at the top of the status page: `{ text }` |
| | `retention` | How long usage events are kept: `{ eventsDays }` (default 180) |
| | `push` | `{ minGapHours, quietStart, quietEnd }`: frequency cap and quiet hours for pushes |

### How a published setting reaches listeners

```text
Publish page ──POST /api/admin/settings { key, value }──▶ Worker
   isAdminAsync · known key · size cap · writeSetting (settings + settings_history) · audit row
                                                          │
   app ──GET /api/appconfig?key=client|flags|festival|banners──▶ Worker reads settings (memoised 60 s per isolate)
         · sanitised on the way out by _lib/clientConfig.ts, cached at the edge
```

| Public key | Returns | Edge cache |
| --- | --- | --- |
| `client` | One bundle read at app boot: Home layout, greeting, broadcast, synonyms, disabled catalogue sources, language order, FAQ, minimum build | 60 s |
| `flags` | Boolean feature flags | 60 s |
| `festival` | The festival theme override | 60 s |
| `banners` | Banners inside their start/end dates, at most 10 | 300 s |

`/api/site-mode` reads `site-mode` and `maintenance-window`; `/api/announcements` reads `announcement` (and answers none when the matching notification was retracted); `/api/status` reads `status-note`; housekeeping reads `retention`; the push sender reads `push`. A listener sees a change within the edge cache time plus the Worker's one-minute memo, at most about six minutes for banners.

Feature flags the app reads and what "off" means:

| Flag | Off means |
| --- | --- |
| `listenTogether` | The Listen Together entries are hidden |

## Tests

- `frontend/src/__tests__/adminConsole.test.ts` (`npm test`) loads the real `core.js` and every page into a DOM. It checks `index.html` loads every page file in order under the strict CSP, every page registers a unique id, a known group and an existing icon, the shell lands on Overview, no console script assigns HTML strings or calls `fetch` directly, and **every page and tab renders from empty answers, from `configured: false` and from failing ones** without throwing or printing `undefined`, `NaN` or `[object Object]`.
- `frontend/e2e/console-shell.spec.ts`: sign-in (wrong and right password, sign out, landing on Overview), every sidebar page, Ctrl+K, a slow tab left behind, the phone menu.
- `frontend/e2e/console-pages.spec.ts`: every tab with data, with empty answers and with a failing server, the exact bodies the settings editor and the push sender post. All mock `/api/**` and block non-local network.
- `backend/worker/__tests__/`: one test file per admin route against a mocked database (the `configured: false`, failed-read and data answers), plus `admin-endpoints.test.ts` (the brute-force lockout), `fcmcheck.test.ts` and `functions/api/admin/musicapi.test.ts` (the catalogue sources check).

## Limits

- One shared password: the audit trail records `owner` for every action.
- The failed-attempt throttle counts per edge location, not globally.
- Counts on the Database page's Tables tab are the planner's estimates for the large `events` table; the small tables are exact.
- Analytics read at most 90 days; longer trends need the data exported.
