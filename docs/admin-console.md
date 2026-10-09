# Owner console

This document covers the owner console served at `/admin/`: how to sign in and why the check is server-side, the files it is made of, its stylesheet and design tokens, the frame and shared components, how to add a section, every section with the routes it calls, how published settings reach listeners, and the contracts behind the recommendation and AI panels. It describes `frontend/public/admin/` and the Worker routes under `backend/worker/functions/api/admin/` as they are on disk.

## Sign-in and authorisation

Authorisation happens on the server, on every request. The page holds no secret and its sign-in form decides nothing.

1. The sign-in panel asks for the admin token. `app.js` stores what was typed in `sessionStorage` under `vinax_admin_token`, so it is gone when the tab closes. The panel says so: "Kept for this tab only and cleared when you close it."
2. Every API call sends it as the `x-admin-token` header. `Authorization: Bearer …` is accepted as well.
3. Every one of the 47 route files under `api/admin/` checks `isAdminAsync(request, env)` before any other work and answers `unauthorized()` when it fails. Hiding a button in the console is never the check.
4. `backend/worker/functions/_lib/admin.ts` compares the token with the Worker secret `ADMIN_LOGIN_PASSWORD`.
5. On a `401` the console deletes the stored token and shows the sign-in panel with "Invalid token."

| Property | Behaviour |
| --- | --- |
| Secret not set | Always refuses. An unconfigured Worker has no console access |
| Comparison | Constant-time (`_lib/safe-compare.ts`) |
| Throttle | 15 wrong tokens from one source address inside a sliding 10 minutes locks that address out of the isolate. While locked out the token is not compared, so a correct guess is refused too |
| Shared counter | Each wrong token is also counted in the `ADMIN_AUTH_FAILS` rate-limit binding, shared by the isolates in one edge location. When it reports the budget spent, the isolate locks the source for the full 10 minutes. The limit is per location, not global |
| Correct tokens | Never consume the failure budget |
| Memory cap | 5,000 tracked sources per isolate |
| Refusal | `401`, JSON `{ "error": "unauthorized" }`, `cache-control: no-store` |

There is one shared token and no per-user accounts or roles. Rotating `ADMIN_LOGIN_PASSWORD` signs everyone out at their next request. How to set the secret is in [operations.md](operations.md).

### Audit trail

Mutating routes call `logAdminAudit()` (`_lib/adminAudit.ts`), which writes a row of type `admin-audit` with status `audit` into the feedback table; the Audit Trail section reads them back. The write is best effort, is registered with the Worker's `waitUntil`, and never fails or delays the action it describes. Each row records the actor (`owner`, because there is one shared token), the action and a summary, the target, an ISO timestamp, the edge request id and, for configuration changes, the before and after values with secrets and credential-looking strings redacted and oversized values reduced to a size and a digest.

## Files

The console is a standalone static page, not part of the app bundle. It ships with the frontend build because it lives in `frontend/public/`. It talks to the Worker with same-origin requests and never imports app code or app CSS.

| File | Role |
| --- | --- |
| `frontend/public/admin/index.html` | Markup: the content security policy, the icon sprite, the sign-in panel, the sidebar navigation, the top bar |
| `frontend/public/admin/console.css` | The only console stylesheet. It replaced the stylesheet that used to be embedded in `index.html` and the separate `studio.css` and `workspace.css`, which no longer exist |
| `frontend/public/admin/theme-boot.js` | Pre-paint script: applies the stored theme and the sidebar rail state before first paint |
| `frontend/public/admin/app.js` | The API client, the shared state components, most sections, the command palette, auto-refresh |
| `frontend/public/admin/workspace.js` | The Operations Workspace section (`window.VinaXWorkspace.mount`) |
| `frontend/public/admin/sections/` | Section modules: `registry.js`, then `recquality.js`, `aiops.js`, `recconfig.js`, `trends.js` |
| `frontend/public/admin/festivals.js` | Generated festival data for the Festival Themes section (`npm run gen:festivals`) |
| `frontend/public/admin/leaflet/` | A vendored map library for the World Map section |

Script order in `index.html`: `theme-boot.js` in the head; then the map library, `festivals.js`, `workspace.js`, `sections/registry.js`, `app.js`, and the four section modules after `app.js`.

### Content security policy

The page is marked `noindex, nofollow` and carries its policy in a `<meta http-equiv="Content-Security-Policy">` tag. The parts that shape how the console is written:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob:
```

- `script-src 'self'` forbids inline scripts. That is why `theme-boot.js` is an external file and why icons come from a same-document sprite.
- `style-src` still needs `'unsafe-inline'`: all CSS rules live in `console.css`, but the console scripts write `style=""` attributes into the markup they build (bar widths, chart heights, swatches).
- `connect-src` is `'self'` plus the hosted database and the geocoder used by the World Map.

### Caching

The console files are not content-hashed, so `frontend/public/_headers` sets `Cache-Control: no-cache` on `/admin/index.html`, `/admin/app.js`, `/admin/theme-boot.js`, `/admin/console.css`, `/admin/workspace.js` and `/admin/sections/*`. A returning owner never gets a new page with a stale stylesheet or script. `festivals.js` and the map library have no entry there. A request to the root of an `admin.` host is redirected to `/admin/` by `backend/worker/functions/_middleware.ts`.

## Stylesheet and tokens

`console.css` is one file in numbered parts, in the order things appear on screen: 1 fonts and tokens, 2 base, 3 utilities, 4 app frame (sidebar, top bar, stale banner, icon rail), 5 buttons, 6 forms, 7 segmented controls, tabs, chips and toggles, 8 cards and KPIs, 9 tables, 10 pills and banners, 11 states, 12 data rows, bars and media, 13 dialogs and floating layers (including toasts), 14 sign-in, 15 motion, 16 small screens, 17 AI console, 18 Operations Center and Broadcast composer, 19 Operations Workspace. Class names are the contract between this file and the scripts.

There is one token block. `:root` is the dark theme; `html.light` overrides the colours and the float shadow. The fonts are the two self-hosted variable fonts under `/fonts/`.

| Group | Custom properties |
| --- | --- |
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--surface-3` |
| Borders | `--border`, `--border-strong` |
| Text | `--text`, `--text-2`, `--text-3` |
| Accent | `--accent` (a cobalt blue: `rgb(96 132 255)` dark, `rgb(42 78 214)` light), `--accent-hover`, `--accent-soft`, `--on-accent` |
| Status | `--ok`, `--warn`, `--bad`, `--info`, each with a `-soft` background |
| Focus | `--focus` |
| Radius | `--r-sm` 8px, `--r-md` 12px, `--r-lg` 16px |
| Spacing | `--s-1` … `--s-8`: 4, 8, 12, 16, 24, 32, 48, 64px |
| Controls and motion | `--ctl-h` 36px (44px under 900px), `--ease`, `--dur-1` 120ms, `--dur-2` 200ms, `--shadow-float` |
| Type | `--font-ui`, `--font-display`, `--font-mono` |
| Sidebar | `--sb-w` 264px, `--sb-rail-w` 64px, `--sb-cur` |

The theme is the stored choice in `localStorage` (`vinax_admin_theme`, `light` or `dark`), else the system preference. `theme-boot.js` and `applyTheme()` in `app.js` must agree on that key. `@media (prefers-reduced-motion: reduce)` zeroes every animation and transition.

## Frame

- **Top bar** (`header#topbar`): the menu button (`#menuBtn`, drawer only), the section's category and title (`#secCrumb`, `#secTitle`), the last-updated time (`#updated`), the environment chip (`#envChip`), Refresh (`#hdrRefresh`), the theme toggle (`#theme`) and Sign out (`#logout`). The chip reads "Local" on a loopback host, "Preview" on a preview deployment host and "Production" otherwise, and adds "· stale" while the stale-data banner is showing.
- **Sidebar** (`#sidebar`): the brand link and a collapse button; a Live group of counters; the section navigation with a filter field; a View group (date range where a section uses one, the Auto-refresh switch and interval, row density, Compact); an Actions group (Refresh, Alerts, Report, JSON, and CSV where the section has a table).
- **Main**: a stale-data banner, the section description (`#secDesc`), the panel (`#view`) and a footer.

From 900px up the sidebar can collapse to an icon rail (`html.sb-rail`, remembered in `localStorage` as `vinax_admin_sidebar`). Under 900px (`@media (max-width: 899px)`, and the matching `matchMedia` query in `app.js`) it is an off-canvas drawer opened by the menu button and closed by Escape, the scrim or picking a section; controls grow to 44px touch targets. Under 480px the environment chip shrinks to a status dot and keeps its text for screen readers.

Keyboard: `Ctrl`/`Cmd` + `K` opens a command palette listing every section. Outside form fields, `1`–`9` jump to Overview, Live Listening, Activity Feed, Location Analytics, Music Analytics, Insights, User Management, Technical Monitoring and AI Monitoring, and `R` refreshes the current section. The current section is mirrored in the URL hash (for example `/admin/#flags`) and remembered in `localStorage` (`vinax_admin_sec`). Navigation groups collapse; their state is kept under `vinax_admin_navgroups`.

Auto-refresh pauses when the tab is hidden and after 10 minutes without input; any input resumes it. Sections listed in `LOCAL_SECTIONS` in `app.js`, and modules registered with `local: true`, are editors: the refresh tick leaves them alone so an edit in progress is not wiped.

## Shared components

`app.js` publishes its helpers as `window.VXA` for the other console scripts: `stateLoading`, `stateEmpty`, `stateError`, `toast`, `esc`, `html`.

| Helper | Returns or does |
| --- | --- |
| `stateLoading(kind, label)` | Markup for skeleton bars (`.state.state-loading`). `kind` is `'kpi'`, `'table'`, `'panel'` or anything else for three lines; `label` replaces the hidden "Loading…" text |
| `stateEmpty(title, hint)` | Markup for `.state.state-empty`; the title defaults to "Nothing here yet" |
| `stateError(message, onRetry)` | Markup for `.state.state-error` with the heading "Could not load this" and a "Try again" button. `onRetry` runs when it is pressed; without one the active section's loader runs again |
| `toast(message, kind)` | Shows a toast in `#toasts`. `kind` is `'ok'`, `'bad'` or `'info'`; at most three on screen, 4 seconds each (6 for `'bad'`), paused while hovered or focused. Messages lead with a status word so meaning never rests on colour |
| `esc(value)` | Escapes `&`, `<`, `>` and `"` |
| `html` | A tagged template that escapes every interpolation |

Buttons use explicit classes: `.btn` (secondary), `.btn-primary`, `.btn-danger`, `.btn-sm`, `.ghost` (quiet) and `.icon-btn` (square, icon only, needs an `aria-label`). A button that is `disabled` or has `aria-busy="true"` is dimmed and ignores the pointer; a busy `.btn` or `.ghost` shows a spinner. `postApi()` sets that busy state on the button that started a write and clears it when the request settles, so a write cannot be sent twice by a second press. A write whose answer carries `{ error }` or `{ ok: false }` is reported as a failure even on HTTP 200.

Dialogs trap the Tab key (`trapTab()` in `app.js`).

## Adding a section

1. Add a nav button to the right group in `index.html`: `<button type="button" data-sec="<key>" data-cat="<Group>">Label</button>`. Add `data-local="all"` when the section keeps its state only in this browser, or `data-local="prefs"` when only its layout is local; `console.css` then adds the "this browser only" caption and a notice at the top of the panel.
2. Add the key to `TITLES`, `DESCS` and `CATS` in `app.js`. The title feeds the top bar, the command palette and the hash router.
3. Write the section as a module in `frontend/public/admin/sections/<key>.js` and add its script tag after `app.js` in `index.html`:

   ```js
   window.VinaXAdminSections.register('<key>', { local: false, title: 'Label', load: function (h) { /* … */ } });
   ```

   Keys must match `^[a-z][a-z0-9-]{0,39}$`. `app.js` dispatches to a registered module before its own chain in `refreshActive()` and passes the helpers: `api`, `apiMemo`, `postApi`, `esc`, `html`, `$`, `stateLoading`, `stateEmpty`, `stateError`, `toast`, `view`, `stamp`, `setExport`, `days`, `isActive`, `navigate`, `fail`.
4. Add the Worker route under `backend/worker/functions/api/admin/` and start its handler with the `isAdminAsync` check. New files under `sections/` are already covered by the `/admin/sections/*` caching rule.

Rules every section follows:

- Every value written into the page goes through `h.html` or `h.esc`. Data is never concatenated in raw.
- A failed read goes to `h.fail` or `stateError`. Nothing is shown as zero while a read is failing.
- `local: true` marks an editor. Dashboards keep any edits in module state so a refresh cannot wipe them.

## Sections

There are 72 sections in eight groups. The descriptions are the console's own (`DESCS` in `app.js`). The routes were collected from each section's loader and the helpers it calls, so a write route appears where the section has an action; routes outside `/api/admin/` are public routes the console also reads.

**Dashboards**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Operations Workspace (`workspace`) | Audience pulse, search recovery, your task board and shift handover. | `/api/admin/overview`, `/api/admin/search-analytics` |
| Overview (`overview`) | Listening, growth and errors for today, with the top songs and countries. | `/api/admin/overview`, `/api/admin/digest`, `/api/admin/growth` |
| Real-Time (`realtime`) | What is happening across VinaX in the last few minutes. | `/api/admin/realtime` |

**Audience**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Live Listening (`live`) | Who is listening right now, what they play and where. | `/api/admin/live` |
| Activity Feed (`activity`) | The latest plays, searches and AI calls as they arrive. | `/api/admin/activity` |
| Engagement (`engagement`) | How often listeners come back and how long they stay. | `/api/admin/engagement`, `/api/cat` |
| User Management (`users`) | Find a listener, see their devices and recent activity, and download records. | `/api/admin/users`, `/api/admin/maintenance`, `/api/admin/user` |
| Retention Cohorts (`retention`) | Weekly cohorts and how many come back on day 1, 7 and 30. | `/api/admin/retention` |
| Feature Usage (`usage`) | Which parts of the app listeners actually use. | `/api/admin/usage` |
| Listening Heatmap (`heatmap`) | When listening peaks, by weekday and hour. | `/api/admin/usage` |
| Onboarding Funnel (`funnel`) | How new listeners move from first open to a finished song. | `/api/admin/funnel` |
| Audience Segments (`segments`) | New, returning, power and inactive listeners at a glance. | `/api/admin/insights` |

**Catalog**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Song Management (`songs`) | Songs the catalog is surfacing and how they perform. | `/api/admin/overview`, `/api/admin/music` |
| Playlist Management (`playlists`) | Curated playlists and what listeners do with them. | `/api/admin/music` |
| Categories & Genres (`categories`) | The genres, moods and languages that shape browsing. | none |
| Content Control (`content`) | Block or restore songs across the whole app. | `/api/admin/content` |
| Catalog Lookup (`catalog`) | Look up any song, album or artist in the catalog. | `/api/admin/catalog-search` |
| Trending Pins (`trendpins`) | Pin searches to the top of the trending list. | `/api/trending-searches`, `/api/admin/appconfig` |
| Trend Operations (`trends`) | Review, publish and retire what shows as trending. | `/api/admin/trends` |
| Song Drilldown (`songstats`) | Plays, skips and listeners for a single song. | `/api/admin/songstats` |
| Skip Report (`skips`) | Songs listeners skip most, so discovery can be fixed. | `/api/admin/skips`, `/api/admin/content` |
| Search Synonyms (`synonyms`) | Map shorthand and misspellings to what listeners mean. | `/api/admin/appconfig` |
| Catalog Sources (`sources`) | Turn catalog sources on or off for every listener. | `/api/cat`, `/api/admin/appconfig` |
| Language Order (`langorder`) | The order languages appear in across the app. | `/api/admin/appconfig` |
| Blocklist Import/Export (`blocklistio`) | Export the blocklist, or import one from a file. | `/api/admin/content` |

**Promotion**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Banners & Offers (`banners`) | Promotional banners with schedules and links. | `/api/admin/appconfig` |
| Festival Themes (`festivals`) | Seasonal themes, applied from the calendar or forced. | `/api/admin/appconfig` |
| Broadcast Message (`broadcast`) | A one-line message shown to every listener. | `/api/admin/push`, `/api/admin/appconfig` |
| Home Greeting (`greeting`) | The greeting line at the top of Home. | `/api/admin/appconfig` |
| Home Layout Studio (`homebuilder`) | The default order and visibility of Home shelves. | `/api/admin/appconfig` |
| Help Center FAQ (`faq`) | Questions and answers in the in-app help centre. | `/api/admin/appconfig` |
| Announcement Composer (`announce`) | Compose an announcement and preview it before it goes out. | `/api/admin/push` |
| Notifications (`notify2`) | Send push notifications and review what went out. | `/api/admin/push`, `/api/admin/notifylog` |

**Analytics**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Music Analytics (`music`) | Top songs, artists and languages over the selected range. | `/api/admin/music`, `/api/admin/experiments` |
| Search Analytics (`search`) | What listeners search for, and which queries find nothing. | `/api/admin/search-analytics` |
| Location Analytics (`location`) | Listeners and plays by country, platform and city. | `/api/admin/location`, `/api/admin/live` |
| World Map (`world`) | Where listeners are, on a live map. | `/api/admin/location`, `/api/admin/live` |
| Insights (`insights`) | Audience segments and the most active listeners. | `/api/admin/insights`, `/api/admin/user` |
| A/B Experiments (`experiments`) | A/B experiments and how each variant performs. | `/api/admin/experiments` |
| Recommendation Quality (`recquality`) | How automatic continuations perform, from opt-in telemetry. | `/api/admin/recquality` |
| Recommendation Tuning (`recconfig`) | Tune and publish recommendation weights, with version history. | `/api/admin/recconfig` |
| SEO Corpus (`seo`) | Pages in the search corpus and the health of the sitemap. | `/api/admin/seo` |

**AI & Engines**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| AI Monitoring (`ai`) | AI request volume, latency, errors and the models in use. | `/api/admin/ai` |
| AI Operations (`aiops`) | AI spend, failures and emergency switches per feature. | `/api/admin/aiops`, `/api/admin/appconfig` |
| API Monitoring (`ailab`) | Ping every AI lane, model and music API, and chat with a lane. | `/api/aimodels`, `/api/admin/musicapi` |
| Engine Probe (`engineprobe`) | Check which engines answer, and how fast. | `/api/admin/enginetest`, `/api/aimodels` |
| AI Starter Prompts (`aistarters`) | Starter prompts suggested in VinaX AI. | `/api/admin/appconfig` |
| AI Quick Actions (`aiquick`) | Quick-action chips shown in VinaX AI. | `/api/admin/appconfig` |
| AI House Rules (`airules`) | House rules added to every VinaX AI conversation. | `/api/admin/appconfig` |
| AI Tokens & Cost (`aicost`) | Tokens used and estimated cost by model and feature. | `/api/admin/aicost`, `/api/admin/appconfig`, `/api/admin/overview` |

**Operations**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| Operations Center (`opscenter`) | Service pulse, scheduled work and open issues in one place. | `/api/admin/cron`, `/api/admin/envcheck`, `/api/status` |
| Technical Monitoring (`technical`) | Errors, app versions, web vitals and site mode. | `/api/admin/technical`, `/api/admin/health`, `/api/admin/maintenance`, `/api/site-mode`, `/api/admin/audit` |
| Feedback & Bugs (`feedback`) | Bug reports and ideas sent by listeners. | `/api/admin/feedback` |
| Live Rooms (`rooms`) | Listen Together rooms that are open right now. | `/api/admin/rooms` |
| Edge & Endpoint Health (`edge`) | The site shell, assets and API endpoints, checked live. | `/api/admin/edge` |
| Data Quality (`dataquality`) | How complete and trustworthy the telemetry is. | `/api/admin/dataquality` |
| Releases & CI (`releases`) | The latest release, deploy runs and recent commits. | `/api/admin/releases` |
| Database Overview (`tables`) | Row counts and freshness for every database table. | `/api/admin/tables` |
| Audit Trail (`audit`) | Every change made from this console, newest first. | `/api/admin/audit` |
| Status Note (`statusnote`) | The note shown on the public status page. | `/api/status`, `/api/admin/appconfig` |
| Cron Health (`cron`) | Scheduled jobs and whether each one ran on time. | `/api/admin/cron` |
| Status History (`statushist`) | 90-day uptime for each public component. | `/api/status` |
| Environment Checklist (`envcheck`) | Which Worker settings and secrets are present. | `/api/admin/envcheck` |
| Query Console (`query`) | Read-only queries against the event tables. | `/api/admin/query` |
| Release Notes (`relnotes`) | Release notes and the cards that ship with them. | none |
| Maintenance Scheduler (`maintwin`) | Schedule a maintenance window listeners will see. | `/api/admin/appconfig` |
| Minimum App Version (`minver`) | The oldest app build that may keep running. | `/api/admin/appconfig` |

**Settings**

| Section (key) | What it shows or does | Routes |
| --- | --- | --- |
| App Configuration (`config`) | App settings drafted in this browser. | `/api/admin/maintenance`, `/api/admin/overview`, `/api/site-mode` |
| Feature Flags (`flags`) | Kill switches for features, published to every listener. | `/api/admin/appconfig` |
| Runbook (`runbook`) | Step-by-step fixes for known incidents. | `/api/admin/appconfig` |
| Config Backup (`backup`) | Download or restore the published settings as one file. | `/api/admin/appconfig` |
| Pinned Tools (`pins`) | Pin the tools you use most to the top of the sidebar. | none |

Notes on this list:

- Song Management, Playlist Management and Categories & Genres are read-only views. Their edit buttons are disabled and name routes that do not exist (`/api/admin/songs`, `/api/admin/playlists`, `/api/admin/categories`); the same is true of "Change logo" in App Configuration.
- The World Map nav entry opens a panel headed "World Listening".
- Release Notes and Pinned Tools call no route.

Four kinds of state sit behind these sections.

| Kind | Where it lives | Examples |
| --- | --- | --- |
| Read-only dashboards | Aggregated by an `/api/admin/*` route from the events and feedback tables | Overview, Real-Time, Retention Cohorts, Skip Report, AI Monitoring, Data Quality, Recommendation Quality |
| Published settings | One row per key in the `vinax_config` table, written through `/api/admin/appconfig` | Banners, Festival Themes, Home Greeting, Broadcast, Home Layout Studio, Feature Flags, Search Synonyms, Catalog Sources, Language Order, AI Starter Prompts, AI Quick Actions, AI House Rules, Help Center FAQ, Minimum App Version, Maintenance Scheduler, Trending Pins, Status Note, Runbook, AI prices, AI emergency controls |
| Versioned published settings | `vinax_config` keys `rec-config` and `rec-config-history`, written only through `/api/admin/recconfig` | Recommendation Tuning |
| Browser-local operator state | `localStorage` in the operator's browser; not shared, not sent to listeners | App Configuration (`vinax_admin_appconfig`), Pinned Tools (`vinax_admin_pins`), Operations Workspace preferences (`vinax.admin.workspace.v1`), nav group state, refresh interval, density |

Site maintenance mode is separate from the config store. The switch in Technical Monitoring writes a `site-mode` row through `/api/admin/maintenance`; the public `/api/site-mode` route reads the newest row stored under the console's own identity, and an active Maintenance Scheduler window overrides it. Trend Operations is described in [trends.md](trends.md).

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

Write side (`api/admin/appconfig.ts`): the key must be in `ALLOWED_KEYS`, the serialised value must be under 900 KB, and the row is upserted with a timestamp. Without the database configured, reads answer `{ configured: false }` and writes answer `503`. A read that fails answers `502` with its kind (`db_unavailable`, `db_unauthorized`, `db_schema_missing`, `db_bad_request`) instead of an empty value an editor could publish over the stored config. The same rule holds for the dashboard routes, and the console shows an error state instead of zeros.

Read side (`api/appconfig.ts`, `_lib/clientConfig.ts`): public, no auth, and it never trusts the stored row. Unknown fields are dropped, strings are clipped, lists are capped, and scheduled items outside their window are withheld.

| Public key | Returns | Edge cache |
| --- | --- | --- |
| `client` | One bundle read at app boot: Home layout, greeting, broadcast, search synonyms, disabled catalogue sources, language order, AI starters, AI quick actions, FAQ, minimum build, and the recommendation weight override `recConfig` while one targets someone | 60 s, plus a 60 s per-isolate memo of the database read |
| `flags` | Boolean feature flags | 60 s |
| `festival` | The festival theme override | 60 s |
| `banners` | Banners inside their start/end dates, at most 10 | 300 s |

Runbook, AI house rules, AI prices, AI emergency controls, trending pins, status note and the maintenance window are not in the public bundle; the console or other Worker routes read them. The app also holds each answer for one to five minutes in its query cache, so a published change is visible within a few minutes, not instantly.

Config Backup exports and restores six keys as one JSON file: `banners`, `festival`, `status-note`, `flags`, `runbook` and `trending-pins`. It does not include the Home layout or the other keys.

### Listener downloads (User Management)

| Control | File | Contents |
| --- | --- | --- |
| **Profile** on a row, **Download profile** in the drill-down | `vinax-profile-<name>-<date>.html` | the drill-down as a page: the header line, the counts, top songs with their play bars, languages, and the 300 most recent events. One self-contained file — no styles, scripts or images are loaded when it is opened — so it can be kept, sent, or printed to PDF |
| **JSON** in the drill-down | `vinax-listener-<name>-<date>.json` | the raw record for data work: the latest-state row and every event the endpoint returns |
| **Activity (CSV)** in the drill-down | `vinax-activity-<name>-<date>.csv` | the same event window as a spreadsheet |
| **Download listeners (CSV)** | `vinax-listeners[-<search>]-<date>.csv` | every row of the current list, walked 100 at a time to the end (not just the page on screen), honouring the search box; it stops after 100 pages |

All four read `/api/admin/user?full=1` or `/api/admin/users`. `profileFacts()` derives the counts, top songs and languages the panel shows, and both the panel and the downloaded page read it, so the two cannot disagree.

The taste profile that drives recommendations is built and kept on the listener's own device and is never uploaded, so it is not in these files — the exported JSON says so in a `note` field. Downloads carry personal data: treat them as such (see [data-and-privacy.md](data-and-privacy.md)).

### Feature flags

Flags are kill switches. A flag is on unless the published value is exactly `false`, so a missing row, an unreachable Worker or an unknown flag all mean "on".

| Flag | Off means |
| --- | --- |
| `aiDj` | The queue stops asking the AI DJ to order what plays next. The on-device recommender keeps building the queue. See [recommendations.md](recommendations.md) |
| `aiHome` | The "Designed for you" block on Home is hidden for everyone |
| `listenTogether` | The Listen Together entries are hidden |
| `codeRun` | The Run and Open buttons under code blocks in VinaX AI are hidden. See [ai.md](ai.md) |

The section also accepts custom flags. Names must match `^[a-zA-Z][a-zA-Z0-9_-]{0,39}$`; the public route enforces the same pattern, ships booleans only and stops at 50 flags. The app reads flags through `useFeatureFlags()` / `useFeatureEnabled()` in `frontend/src/features/home/useAppConfig.ts`. A toggle changes nothing until **Publish** is pressed.

Flags are not experiments. A/B Experiments has its own route: a device's variant is a pure hash of its device id and the experiment key, computed identically in the app and in the Worker.

### Home layout

Home Layout Studio sets the production default for the listener Home and stores it under the `home-layout` key.

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

- `frontend/e2e/admin-console.spec.ts` drives the real page in a browser with every backend answer mocked. It opens every `#nav button[data-sec]` and requires a non-empty panel with no page or console errors, then exercises catalog search, song drilldown, the query console, synonyms and broadcast publishing, pinning a tool, the Operations Center, the AI bench, the top bar and sidebar, and the phone drawer. It runs with the rest of the browser suite: `npm run e2e` in `frontend/` (see [testing.md](testing.md)).
- `frontend/src/__tests__/adminSections.test.ts` runs under `npm test`. It loads the real registry and the `recquality`, `aiops` and `recconfig` modules into a DOM with the console's own `esc` and `html`, feeds them answers whose labels contain markup, and fails if any element is created from data. It also checks the nav markup, the browser-local markers, the confirmation and conflict rules of the AI controls, and the publish, 409 and rollback rules of Recommendation Tuning. The `trends` module is not in this test.

## Limits

- One shared token; the audit trail records the actor as `owner`, not a person. The migration path to operator identities is in [operations.md](operations.md).
- The failed-attempt throttle counts per edge location, not globally.
- Browser-local sections do not follow the operator to another browser.
- Recommendation Quality and AI Operations read at most 20,000 rows per request; `truncated` says when a window held more.
