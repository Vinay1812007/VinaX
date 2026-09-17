# Owner console

This document covers the owner console served at `/admin/`: what it is made of, how sign-in works and why the check is server-side only, the sections it offers, how published settings reach listeners, feature flags, and Home layout publishing. It describes the files in `frontend/public/admin/` and the Worker routes under `backend/worker/functions/api/admin/` as they are on disk for 7.1.

## What it is

The console is a standalone static page, not part of the main app bundle. It ships with the frontend build because it lives in `frontend/public/`.

| File | Role |
| --- | --- |
| `frontend/public/admin/index.html` | Markup, the embedded stylesheet, the icon sprite, the sidebar navigation |
| `frontend/public/admin/theme-boot.js` | Pre-paint script: applies the stored theme and sidebar state before first paint |
| `frontend/public/admin/app.js` | All panels, the API client, the command palette, auto-refresh |
| `frontend/public/admin/workspace.js`, `workspace.css` | The Operations Workspace section |
| `frontend/public/admin/festivals.js` | Generated festival data for the Festival Themes section (`npm run gen:festivals`) |
| `frontend/public/admin/studio.css` | Styles for the studio-style editors |
| `frontend/public/admin/leaflet/` | A vendored map library for the World Map section |

The page is marked `noindex, nofollow`. Its content security policy allows scripts only from its own origin, which is why `theme-boot.js` is an external file and why there are no inline scripts. `index.html` and `app.js` are served with `Cache-Control: no-cache` (`frontend/public/_headers`). A request to the root of an `admin.` host is redirected to `/admin/` by `backend/worker/functions/_middleware.ts`.

The console talks to the Worker with same-origin requests to `/api/admin/*`. It never imports app code or app CSS.

## Sign-in and authorisation

Authorisation happens on the server, on every request. The page has no secret in it and its sign-in form decides nothing.

1. The sign-in panel asks for the admin token. `app.js` stores what was typed in `sessionStorage` under `vinax_admin_token`, so it is gone when the tab closes.
2. Every API call sends it as the `x-admin-token` header. `Authorization: Bearer …` is accepted as well.
3. Every one of the 43 route files under `api/admin/` checks `isAdmin(request, env)` in its handlers and answers `unauthorized()` when it fails.
4. `isAdmin()` in `backend/worker/functions/_lib/admin.ts` compares the token with the Worker secret `ADMIN_LOGIN_PASSWORD`.
5. On a `401` the console deletes the stored token and shows the sign-in panel with "Invalid token."

Properties of `isAdmin()`:

| Property | Behaviour |
| --- | --- |
| Secret not set | Always refuses. An unconfigured Worker has no console access |
| Comparison | Constant-time (`_lib/safe-compare.ts`), so response timing does not leak the secret |
| Throttle | 15 wrong tokens from one source address inside a sliding 10 minutes locks that address out. While locked out the token is not compared at all, so a correct guess is refused too |
| Correct tokens | Never consume the failure budget |
| Scope | Counters live in the memory of one Worker isolate and are capped at 5,000 sources. A different isolate has its own counters |
| Refusal | `401`, JSON `{ "error": "unauthorized" }`, `cache-control: no-store` |

There is one shared token and no per-user accounts or roles. Rotating `ADMIN_LOGIN_PASSWORD` signs everyone out at their next request. How to set the secret is in [operations.md](operations.md).

### Audit trail

Mutating routes call `logAdminAudit()` (`_lib/adminAudit.ts`), which writes a row of type `admin-audit` with status `audit` into the feedback table; the Audit Trail section reads them back. The write is best effort and never fails the action it describes. On disk the helper is called by: config publishing, content control (block and unblock), experiments, push sends, the notification log and maintenance actions.

## Layout and theme

<!-- VERIFY-ADMIN -->
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
| Analytics | Music Analytics, Search Analytics, Location Analytics, World Map, Insights, A/B Experiments, SEO Corpus |
| AI & Engines | AI Monitoring, API Monitoring, Engine Probe, AI Starter Prompts, AI Quick Actions, AI House Rules, AI Tokens & Cost |
| Operations | Operations Center, Technical Monitoring, Feedback & Bugs, Live Rooms, Edge & Endpoint Health, Data Quality, Releases & CI, Database Overview, Audit Trail, Status Note, Cron Health, Status History, Environment Checklist, Query Console, Release Notes, Maintenance Scheduler, Minimum App Version |
| Settings | App Configuration, Feature Flags, Runbook, Config Backup, Pinned Tools |

Three kinds of state sit behind these sections. Knowing which is which matters before relying on one.

| Kind | Where it lives | Examples |
| --- | --- | --- |
| Read-only dashboards | Aggregated by an `/api/admin/*` route from the events and feedback tables | Overview, Real-Time, Retention Cohorts, Skip Report, AI Monitoring, Data Quality |
| Published settings | One row per key in the `vinax_config` table, written through `/api/admin/appconfig` | Banners, Festival override, Home Greeting, Broadcast, Home Layout Studio, Feature Flags, Search Synonyms, Catalog Sources, Language Order, AI Starter Prompts, AI Quick Actions, AI House Rules, Help Center FAQ, Minimum App Version, Maintenance Scheduler, Trending Pins, Status Note, Runbook, AI prices |
| Browser-local operator state | `localStorage` in the operator's browser only; not shared, not sent to listeners | App Configuration (`vinax_admin_appconfig`), Pinned Tools, Operations Workspace preferences (`vinax.admin.workspace.v1`), nav group state, refresh interval, density |

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

Write side (`api/admin/appconfig.ts`): the key must be in `ALLOWED_KEYS`, the serialised value must be under 900 KB, and the row is upserted with a timestamp. Without the database configured, reads answer `{ configured: false }` and writes answer `503`.

Read side (`api/appconfig.ts`, `_lib/clientConfig.ts`): public, no auth, and it never trusts the stored row. Unknown fields are dropped, strings are clipped, lists are capped, and scheduled items outside their window are withheld.

| Public key | Returns | Edge cache |
| --- | --- | --- |
| `client` | One bundle read at app boot: Home layout, greeting, broadcast, search synonyms, disabled catalogue sources, language order, AI starters, AI quick actions, FAQ, minimum build | 60 s, plus a 60 s per-isolate memo of the database read |
| `flags` | Boolean feature flags | 60 s |
| `festival` | The festival theme override | 60 s |
| `banners` | Banners inside their start/end dates, at most 10 | 300 s |

Runbook, AI house rules, AI prices, trending pins, status note and the maintenance window are not in the public bundle. They are read by the console or by other Worker routes. The app also holds each answer for one to five minutes in its query cache, so a published change is visible within a few minutes, not instantly.

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

## Limits

- One shared token; no per-operator identity in the audit trail.
- The failed-attempt throttle is per Worker isolate, not global.
- Browser-local sections do not follow the operator to another browser.
- The layout paragraph marked `VERIFY-ADMIN` describes a console that is being restyled; re-read `index.html` before relying on it.
- Browser end-to-end coverage for the console is in `frontend/e2e/admin-console.spec.ts`; see [testing.md](testing.md).
