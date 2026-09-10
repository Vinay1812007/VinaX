# VinaX

**Free music streaming for India. No login. Private by design.**

Live at **https://www.sirimillavinay.online** — Telugu, Hindi, Tamil and nine more languages, with an AI DJ, a full assistant (VinaX AI), synced lyrics, music videos, festival themes for the whole Indian calendar, live in-app tutorials, an Android app, and a 65-tool admin console. Everything personal stays on the listener's device; the server sees anonymous, coarse telemetry only.

> **For AI agents and new contributors — read this first.** This file is the single source of truth for what VinaX is, how the repo is laid out, how it deploys, and which commands are safe to run. Everything is intentionally explicit: exact paths, exact commands, exact env-var *names* (never values).

---

## Contents

1. [What VinaX is](#1-what-vinax-is)
2. [Feature catalogue](#2-feature-catalogue) — listener app · VinaX AI · admin console · VinaX CLI
3. [Architecture](#3-architecture)
4. [Repository map](#4-repository-map)
5. [Local development](#5-local-development)
6. [Deployment](#6-deployment) — Pages · Worker · secrets · Supabase · Android
7. [Configuration published from the console](#7-configuration-published-from-the-console)
8. [Architecture contracts (do not break)](#8-architecture-contracts-do-not-break)
9. [Testing and quality gates](#9-testing-and-quality-gates)
10. [CI and scheduled automation](#10-ci-and-scheduled-automation)
11. [Operations and troubleshooting](#11-operations-and-troubleshooting)
12. [Release process](#12-release-process)
13. [Privacy posture](#13-privacy-posture)

---

## 1. What VinaX is

One repository, two independently deployed applications on **the same domain**:

| Folder | What it is | Tech | Deploys to | Trigger |
|---|---|---|---|---|
| [`frontend/`](frontend/) | The web app (and the Android app via Capacitor) plus the static admin console | React 19 · Vite 8 · TypeScript · Tailwind · Zustand · TanStack Query | **Cloudflare Pages** (project `vinax`) | push to `main` touching `frontend/**` |
| [`backend/`](backend/) | `vinax-api` edge Worker: JSON API, VinaX AI, edge-rendered SEO pages, sitemaps, image proxy, APK proxy, admin API, cron endpoints | Cloudflare Workers · TypeScript (no framework, no runtime npm deps) | **Cloudflare Workers** | push to `main` touching `backend/**` |
| [`cli/`](cli/) | **VinaX CLI** — the terminal coding agent (`vinax`): reads, edits, runs, tests, commits and pushes on the user's own machine | Node.js ≥ 22 · TypeScript · ESM · zero runtime deps | published as an npm package (not auto-deployed) | manual |

There is **no CORS anywhere**. The Worker's routes claim specific paths on `www.sirimillavinay.online` (`/api/*`, `/img`, `/apk`, `/song|album|artist|playlist/*`, `/sitemap*`, the 72 language-mood hub pages, plus the `update.` and `admin.` hosts) and **every other URL falls through to Pages**, which serves the static app.

```
                       www.sirimillavinay.online
                                  │
                 ┌────────────────┴─────────────────┐
                 │        Cloudflare edge            │
                 │  (routes in backend/worker/       │
                 │   wrangler.toml decide who        │
                 │   answers each path)              │
                 └───────┬─────────────────┬────────┘
        /api/* /img /apk │                 │  everything else
        /song/* /album/* │                 │  ( / , /search, /assets/*, /admin …)
        /sitemap* hubs   ▼                 ▼
                 ┌───────────────┐  ┌─────────────────┐
                 │  vinax-api    │  │ Cloudflare Pages│
                 │  (Worker,     │  │ (static dist/   │
                 │  backend/)    │  │ from frontend/) │
                 └──────┬────────┘  └─────────────────┘
                        │
     ┌──────────┬───────┴────────┬──────────────┬─────────────┐
     ▼          ▼                ▼              ▼             ▼
  Supabase   AI providers    HANDOFF KV     GitHub        Push (Web Push
  (Postgres) (19 model       (one-time      Releases      + FCM v1)
             lanes)          handoff links) (APK)
```

---

## 2. Feature catalogue

### 2.1 Listener app

**Listening**
- Search across songs, albums, artists and playlists: results as you type, exact-title-first ranking, “Did you mean …?” for typos, language chips, sort (relevance · popular · newest · longest · A→Z), filter-within-results, Play all / Queue all, voice search, keyboard-first autocomplete, trending chips (community + admin-pinned), pinned recent searches, 10-minute result cache, and **search by lyrics** (paste any line you remember; falls back to title matches when the lyrics service has no hit).
- Player: queue with drag reorder, smart shuffle, repeat, crossfade, playback speed, A-B repeat, song **bookmarks**, an on-device **equaliser** (presets + five bands), balance, mono audio and loudness normalisation (Settings → Sound; bypasses itself on sources that cannot be processed), sleep timer (minutes with a 30-second fade-out, end of song, or after N songs), device output picker, Cast, lock-screen controls and lyrics, resume-where-you-left, kid mode (explicit filter), and **Ambient mode** in Now Playing.
- Now Playing: full-screen player with fling gestures, immersive video canvas, synced lyrics with per-song offset, film chip, "Share this moment" links that start at a timestamp, Drive mode, Karaoke, and a live lyric line under the desktop seekbar.
- Music videos: 16:9 browse, cinematic player, picture-in-picture, full-song hand-off.
- Charts (Top 50 global/country, Viral 50), Discover, Moods, Regions, Movies, Explore (decade radio, pick-a-year, language × mood grid, Surprise album), Languages hubs.

**Personal**
- Home: personal greeting, **Aura Mix** (AI DJ entry), quick-access grid, Continue Listening, On this day, For You This Week, On Repeat, Repeat Rewind, Daily Mixes, VinaX Daily, Because you liked "…", listening-streak card, Song of the day, a “Coming up” festival card one to three days ahead, seasonal/festival shelf, endless "More for you" feed. Every block can be hidden or reordered in Settings → Home layout.
- Library (device-only): Liked Songs, **Listen Later**, playlists with pins, tags (filter the library by tag), emoji + description, collage covers, sort, shuffle play, duplicate finder, Copy/Share as text, **Import from text** ("Title — Artist" per line), a 7-day Recently deleted with Restore, and a Downloaded-only filter in the app.
- History with search, day filters, per-entry removal and scoped clears; "Your history with this song" from any song menu.
- Stats ("Your VinaX"): weekly report versus last week, 12-week listening calendar with streaks, daily listening goal ring, Year recap with a shareable image.
- Taste Profile: what VinaX has learned, with fine-tune dials; "Show fewer like…" and "Never play…" from any song menu, Not interested, all with Undo.
- Listen Together rooms (host/guest sync, song requests). Device handoff (encrypted, one-time QR / 10-character code). Wake-up alarm with a playlist choice and gentle 30-second fade-in.

**Look and feel**
- Themes: Dark, Light, Black (AMOLED), System, Auto (day/night); ten accents plus a **custom accent** (any hex, with a readable light-theme variant); glass level and blur sliders; Dynamic theme from artwork; Display size; High contrast; Reduce motion; density.
- **Festival themes**: 43 festivals from Sankranti to New Year, each a distinct theme — accent ramp, tinted canvas, ribbon, glow, motif, badge, splash and living backdrop — driven by one calendar (`frontend/src/constants/festivals.ts` + `festivalThemes.ts`, `npm run gen:festivals`). Switchable in Settings.
- Swipe a song row right to queue, left to save for later. Toasts with Undo. Command palette (⌘/Ctrl+K), keyboard shortcuts, PWA shortcuts (Search, Liked, Listen Later, VinaX AI), Data saver, Startup page, and a search box inside Settings.

**Help and learning**
- Welcome tour on first open (languages, name, an eight-slide tour that ends with a live walkthrough).
- **Live tutorials** (Help → Live tutorials): five guided walkthroughs that run inside the real app, navigate to the right page, spotlight the actual control and can start playback — Play your first song, Find any song, Ask VinaX AI, Make it yours, Save and organise. Progress is remembered on the device.
- Help & Feedback: searchable guides for every feature, FAQ (plus questions the console publishes), the latest update card, keyboard and gesture reference, legal links, and a feedback form that can attach app version, platform, screen size, language and theme.

**Android**
- Capacitor wrapper of the same app: background playback, media notification, offline downloads that play with no network, FCM push, in-app updater fed by `/api/version` (with an admin-set minimum build), `update.sirimillavinay.online` → latest APK.

### 2.2 VinaX AI (`/VinaXAI`)

A full assistant with its own layout — writing, code, maths, data, research, translation and music, no login.

- 19 engines (6 core: Auto, Balanced, Fast, Deep, Creative, Translator; 13 advanced), two of which open a live menu of every free model their key serves, with honest per-reply engine chips; **Think** and **Research** toggles; live web search with numbered citations; model-initiated search when the engine decides it needs the web.
- Streaming markdown with tables, task lists, code blocks (copy, download, run JS/TS, live HTML/SVG preview in a sandbox), Mermaid diagrams, charts, CSV tables, KaTeX maths.
- Music built in: any "Title — Artist" line becomes a playable card; Play all / Queue all / **Save as playlist**; instant music commands ("play …", "queue …", "next"); a live mini-player card with singing lyrics.
- **Slash commands** (`/playlist <vibe>`, `/now`, `/lyrics`, `/mood`, `/summary`, `/think`, `/web`, `/prompts`, `/export`, `/clear`), **now-playing context** (the assistant can see the song that is playing, or a pasted VinaX song link), **follow-up chips** after every substantial reply, reply language (Telugu, Hindi, Tamil, Tenglish, Hinglish …) and reply style (Brief, Detailed, Simple, Steps, Table).
- Reply actions: Copy, rate, Regenerate, Continue, Shorten, Expand, Simplify, Listen (read aloud with the device voice), Pin, Branch (continue from any point in a new chat), edit-and-resend.
- Attachments (images, text files), mic dictation and hands-free **live voice** with server TTS, multi-chat sidebar (search, pin, rename, date groups, 50 local chats), export (txt/md/pdf/json), "About you" memory, **Today for you** brief, saved prompts, admin-published starter prompts, quick actions and house notes.

Elsewhere in the app the same engines power the AI DJ and smart queue, the AI Playlist page ("describe a vibe"), personalised Home shelves, Search's expert picks, lyrics romanise/translate/meaning, and the location-targeted AI daily push.

### 2.3 VinaX CLI (`cli/`, the `vinax` command)

The VinaX coding agent as a terminal program — the same engines, working on a developer's own machine instead of in a browser.

- **It does the work.** Reads and searches the project, edits files, runs the tests and the build, reads the real output, iterates when something fails, checks the diff, stages, commits and pushes. It does not tell the user which commands to type.
- **Permissions, not trust.** Three modes — `ask` (default), `auto-edit`, `full-auto`. Every prompt shows the exact action: the real command and directory, the real diff, the real remote and branch and commit count. Privilege escalation, destructive system commands, credential stores, remote repository writes and anything outside the approved workspace are confirmed in **every** mode, including `full-auto`.
- **Local device access, bounded.** The workspace is the git root (or the working directory); `--add-dir` adds more. Every path is resolved through its symlinks and compared by path segments, so no traversal, link or device path escapes it.
- **Secrets.** `.env`, private keys, service accounts and credential directories are never read without explicit approval, and every tool result is scrubbed for key blocks, authorization headers, tokens and passwords before it leaves the machine.
- **Git as a first-class tool**, using the user's own git and credential helper. There is no `reset --hard`, no `clean`, no force push and no history rewriting in the tool set at all.
- **Local sessions** (JSONL in `~/.vinax`, crash-resistant, resumable), structured context compaction, `/undo` for VinaX's own edits, live task status, `@file` references, 19 slash commands, `--json` JSONL output with stable exit codes, and local stdio MCP servers that go through the same permission policy as the built-ins.
- **No AI provider keys on the user's machine.** The CLI talks to the VinaX Worker; the Worker talks to the engines.

Public documentation: **`/VinaXAI/cli/docs`**. Developer notes: [`cli/README.md`](cli/README.md).

### 2.3 Admin console (`https://admin.sirimillavinay.online`)

A static page (`frontend/public/admin/`) talking to `/api/admin/*`, gated by `ADMIN_LOGIN_PASSWORD`, with a token in session storage, auto-refresh, ⌘K search, dark and light themes, pinned tools, CSV and JSON export on every data panel. **65 tools** in eight groups:

| Group | Tools |
|---|---|
| Dashboards | Overview, Real-Time |
| Audience | Live Listening, Activity Feed, Engagement, User Management, Retention Cohorts, Feature Usage, Listening Heatmap, Onboarding Funnel |
| Catalog | Song Management, Playlist Management, Home Screen, Categories & Genres, Content Control, Catalog Lookup, Trending Pins, Song Drilldown, Skip Report, Search Synonyms, Catalog Sources, Language Order, Blocklist Import/Export |
| Promotion | Banners & Offers, Festival Themes, Notifications, Broadcast Message, Home Greeting, Help Center FAQ, Announcement Composer |
| Analytics | Music Analytics, Search Analytics, Location Analytics, World Listening, Insights, A/B Experiments, SEO Corpus |
| AI & Engines | AI Monitoring, API Monitoring (lane bench), Engine Probe, AI Starter Prompts, AI Quick Actions, AI House Rules, AI Tokens & Cost (per model and per day, priced by your own table) |
| Operations | Technical Monitoring, Feedback & Bugs, Live Rooms, Edge & Endpoint Health, Data Quality, Releases & CI, Database Overview, Audit Trail, Status Note, Cron Health, Status History, Environment Checklist, Query Console (read-only, whitelisted), Release Notes, Maintenance Scheduler, Minimum App Version |
| Settings | App Configuration, Feature Flags, Runbook, Config Backup, Pinned Tools |

Everything the console publishes reaches listeners through cached public reads (`/api/appconfig?key=…`) within about a minute — no app release needed (see §7). Broadcast Message can also go out as a push notification to closed apps and subscribed browsers.

---

## 3. Architecture

- **Frontend** — a Vite SPA with route-level code splitting (53 routes + 12 language hubs + 72 mood×language hubs, all lazy). State is Zustand with `persist` (`vinax.*.v1` keys, see `frontend/src/constants/storage-keys.ts`); server data is TanStack Query. Personalisation (taste profile, scoring, mixes) runs **on the device** under `src/services/personalization` and `src/services/recommendation`. The audio engine is a plain `HTMLAudioElement` with source failover, crossfade and Cast intercepts (`src/services/audio/engine.ts`). A strict **first-load bundle budget** (`frontend/scripts/check-bundle-size.mjs`) fails CI when the shell grows; new features must be lazy unless they run in the player clock or a store.
- **Backend** — `backend/worker/index.ts` reproduces the Pages-Functions contract (`{request, env, params, next, waitUntil}`) over a hand-maintained `EXACT` route map (`worker/__tests__/routerCoverage.test.ts` enforces import ↔ route parity) plus regex `DYNAMIC` routes for SEO pages. Every endpoint is one module under `worker/functions/`. Shared code lives in `worker/functions/_lib/` (AI lanes, Supabase REST helpers, rate limiting, render, SEO, web push, FCM, client config).
- **VinaX CLI** — a Node process, so it may call the VinaX HTTPS API directly (the same-origin rule governs the *browser* app only; no CORS is involved and `VINAX_API_BASE` exists for this package alone). It speaks a versioned protocol, `vinax-cli/1`, to its own Worker route family (`/api/vinaxcli/{meta,agent,search}`): the CLI sends the conversation, the tool results and the project context; the Worker owns the agent system prompt, the tool vocabulary, argument validation and every key. The model cannot execute anything, the Worker cannot touch a device, and only the local CLI can — after its permission policy agrees. Tool calls are normalized on the Worker (native `tool_calls` where an engine supports them, a strict server-controlled text form otherwise), so the CLI never sees provider-specific syntax.
- **Catalogue** — songs come from the owner-hosted catalogue wrapper (`VinaX Music API` on Render) with the Worker's own `/api/cat` as a same-origin fallback; the client orchestrates sources with health ranking (`frontend/src/services/api/client.ts`, `constants/endpoints.ts`) and the console can switch a source off for everyone.
- **AI** — 19 lanes over 18 keys across three OpenAI-compatible hosts (the default inference base, a fast external base, and a free-model marketplace), each pinned to its own key with a failover ladder (`_lib/ai.ts`, `_lib/models.ts`). The two aggregator keys don't pin a model: their free catalogs are discovered live (`_lib/catalog.ts`, served by `/api/aimodels`) and the listener picks the exact engine. Chat streams as SSE (`data: {delta|meta|done}`); prompts wrap user turns in a data fence; nothing is stored beyond anonymous per-call telemetry.
- **Data** — Supabase Postgres via REST (service-role key on the Worker only): `vinax_events`, `vinax_users`, `vinax_feedback`, `vinax_ai_events`, `vinax_rooms`, `vinax_push_subscriptions`, `vinax_fcm_tokens`, `vinax_config`, `vinax_experiments`, `vinax_blocklist`, `vinax_seo_urls`, plus RPCs/views for analytics. One KV namespace (`HANDOFF`) holds burn-on-read device-handoff blobs.
- **Tutorials** — `src/store/tutorialStore.ts` (tiny, first-load) holds the active walkthrough; `components/TutorialHost.tsx` lazy-mounts `TutorialRunner.tsx` at the app root, which navigates via the router, runs each step's action (for example starting a song), finds the step's target by CSS selector and spotlights it. Definitions live in `src/features/tutorials/tutorials.ts`; targets rely on stable `aria-label`s and `data-tour` anchors (`player`, `search-input`, `sound`, `import-text`).
- **SEO** — `/song|album|artist|playlist/:id` and the hub pages are rendered at the edge by injecting content into the live SPA shell fetched from `ASSETS_HOST`; sitemaps are generated from `vinax_seo_urls`, which an hourly crawler grows. `npm run build` also prerenders 31 static routes.

---

## 4. Repository map

```
.
├── README.md                       ← you are here
├── DEPLOYMENT.md                   ← Pages deployment notes
├── .github/workflows/              ← CI + cron jobs (§10)
├── frontend/                       ← EVERYTHING the browser downloads
│   ├── src/
│   │   ├── pages/                  ← one lazy chunk per route (HomePage, VinaXAIPage, SettingsPage …)
│   │   ├── components/             ← shared UI (PlayerBar, TrackMenu, SongRow, MediaCard, ai/*)
│   │   ├── features/               ← feature modules (home, ai, library, search, stats, lyrics, voice, tutorials …)
│   │   ├── services/               ← api client, audio engine, personalization, recommendation, analytics
│   │   ├── store/                  ← zustand stores (player, settings, library, history, search, …)
│   │   ├── constants/              ← festivals + themes, changelog, version, nav, endpoints, storage keys
│   │   ├── styles/index.css        ← design tokens (dark/light/black), components
│   │   └── styles/festivals.css    ← GENERATED festival skins (npm run gen:festivals)
│   ├── public/                     ← static assets, _headers (CSP), _redirects, manifest, admin/ console
│   │   └── admin/                  ← index.html (shell + CSS), app.js (all panels), festivals.js (GENERATED)
│   ├── scripts/                    ← prerender, bundle budget, CSP hashes, festival generator, changelog export, e2e smoke
│   ├── supabase/migrations/        ← idempotent SQL for the tables/RPCs the console needs
│   ├── docs/                       ← design system, AI engine notes, operations, user guide
│   ├── e2e/                        ← end-to-end specs (+ support/ runner shim, vitest.config.ts)
│   ├── index.html                  ← SPA shell: pre-paint theme/festival/accent script, boot prefetch
│   ├── vite.config.ts              ← build + dev proxy (/api, /img, /apk → :8787)
│   └── capacitor.config.ts, native-android/, android-res/, ci/   ← Android
├── backend/                        ← EVERYTHING that runs at the edge
│   ├── worker/
│   │   ├── index.ts                ← entry: router + adapter (EXACT + DYNAMIC maps)
│   │   ├── wrangler.toml           ← name, routes, [vars], KV binding, observability
│   │   ├── functions/api/          ← public endpoints, api/vinaxcli/*, api/admin/*, api/cron/*, api/cat/[[path]]
│   │   ├── functions/_lib/         ← ai, models, catalog, cliprotocol, cliprompt, clistream, cliengines, websearch, supabase, ratelimit …
│   │   └── __tests__/              ← endpoint + reducer tests
│   ├── index.html                  ← TEST FIXTURE of the SPA shell (render tests only)
│   ├── README.md                   ← Worker notes
│   └── .env.example                ← documents every secret NAME (values live in Cloudflare)
└── cli/                            ← VinaX CLI — the `vinax` terminal agent
    ├── src/
    │   ├── cli.ts                  ← the binary: parse, dispatch, exit code
    │   ├── agent/                  ← the tool loop, task ledger, context compaction
    │   ├── tools/                  ← filesystem, process, git, mcp
    │   ├── permissions/            ← ask / auto-edit / full-auto
    │   ├── security/               ← workspace boundaries, secrets, command risk
    │   ├── session/                ← local JSONL sessions, run journal, undo
    │   └── terminal/               ← rendering, approval prompts, slash commands
    ├── tests/                      ← 13 suites incl. a compiled-binary end-to-end run
    └── README.md                   ← CLI developer notes
```

Each folder is self-contained: own `package.json`, lockfile, `tsconfig`, eslint config and tests. **Never** run npm at the repo root — there is no root `package.json`.

---

## 5. Local development

Prerequisites: Node ≥ 22, npm.

```sh
# terminal 1 — backend (wrangler dev on http://127.0.0.1:8787)
cd backend && npm ci && npm run dev

# terminal 2 — frontend (vite on http://localhost:5173)
cd frontend && npm ci && npm run dev

# terminal 3 — VinaX CLI, pointed at the local Worker (only when working on cli/)
cd cli && npm ci
VINAX_API_BASE=http://127.0.0.1:8787 npm run dev
```

Vite proxies `/api` (including the catalogue at `/api/cat`), `/img` and `/apk` to `:8787`, so the whole stack works locally. Local secrets go in `backend/worker/.dev.vars` (gitignored, `NAME=value` per line). The admin console is at `http://localhost:5173/admin/` (log in with the `ADMIN_LOGIN_PASSWORD` you set in `.dev.vars`).

### Command reference

| Where | Command | What it does |
|---|---|---|
| `frontend/` | `npm run dev` | Vite dev server on :5173 |
| `frontend/` | `npm run build` | typecheck → Vite build → prerender 32 routes → `dist/changelog.json` |
| `frontend/` | `npm test` | Vitest (501 tests / 72 files) |
| `frontend/` | `npm run lint` · `npm run typecheck` | eslint (`src` + `scripts`, zero warnings) · tsc — CI runs both |
| `frontend/` | `npm run gen:festivals` | regenerate `src/styles/festivals.css`, the pre-paint window table in `index.html`, and `public/admin/festivals.js` from the festival calendar (a test fails on drift) |
| `frontend/` | `node scripts/csp-hashes.mjs` | after `npm run build`, refresh the inline-script hashes in `public/_headers` (a test fails on drift) |
| `frontend/` | `node scripts/check-bundle-size.mjs` | the first-load budget gate (CI runs it after build) |
| `frontend/` | `npm run e2e` | build checks + the end-to-end specs (needs `dist/` — run `npm run build` first) |
| `frontend/` | `npm run android:debug` | Capacitor sync + Gradle debug APK |
| `backend/` | `npm run dev` | wrangler dev on :8787 (reads `worker/.dev.vars`) |
| `backend/` | `npm test` · `npm run lint` · `npm run typecheck` | Vitest (262 tests / 29 files) · eslint · tsc — **run from `backend/`, not `backend/worker/`** |
| `backend/` | `npm run deploy` | manual `wrangler deploy` (normally unnecessary — git auto-deploys) |
| `cli/` | `npm run dev` | run `src/cli.ts` directly (Node type-stripping, no build step) |
| `cli/` | `npm run build` | tsc → `dist/`, then the shebang check that keeps the binary runnable |
| `cli/` | `npm test` · `npm run lint` · `npm run typecheck` | Vitest (299 tests / 13 files) · eslint · tsc — **`npm run build` first**, the e2e suite drives `dist/cli.js` |
| `cli/` | `npm pack --dry-run` | what would actually ship (a test asserts tests/sources/configs are excluded) |

---

## 6. Deployment

**Push to `main`. That is the whole deployment process.**

| Piece | Watches | Pipeline |
|---|---|---|
| Frontend + admin console | `frontend/**` | Cloudflare Pages git integration → root directory `frontend`, build `npm run build`, output `dist` |
| Worker | `backend/**` | Cloudflare Workers Builds → root directory `/backend`, deploy `npx wrangler deploy --config worker/wrangler.toml` |

Manual fallbacks:

```sh
cd frontend && npm ci && npm run build && npx wrangler pages deploy dist --project-name vinax
cd backend  && npm ci && npm run deploy
```

**Domains** (`www.sirimillavinay.online`, apex, `admin.`, `update.`) stay attached to the **Pages** project — Pages is the fall-through origin. The Worker's route list lives in `backend/worker/wrangler.toml`; after changing routes, verify under *Cloudflare → Workers & Pages → vinax-api → Settings → Domains & Routes*.

### 6.1 Worker configuration and secrets

Non-secret config lives in `wrangler.toml [vars]`: `ASSETS_HOST` (the Pages host serving the SPA shell, `vinax.pages.dev`) and `GITHUB_REPO` (APK release source). The `HANDOFF` KV binding is declared there too.

**Secrets never live in git.** Set each with `npx wrangler secret put <NAME> --config worker/wrangler.toml` (or the dashboard). The console's **Environment Checklist** panel shows which names are set. Groups:

| Group | Names | Required |
|---|---|---|
| Admin | `ADMIN_LOGIN_PASSWORD` | yes |
| Data | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEVICE_ID_SECRET`, `TELEMETRY_PEPPER` (optional) | yes |
| Cron | `CRON_SECRET` | yes (for scheduled jobs) |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FCM_SERVICE_ACCOUNT`, `NOTIFY_MIN_GAP_HOURS` (var) | for push |
| Releases | `GITHUB_TOKEN` (+ `GITHUB_REPO` var) | for the APK proxy, updater and Releases & CI panel |
| AI | 18 lane keys — `VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B`, `VINAX_OAI_GPT_OSS_20B`, `VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B`, `VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B`, `VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING`, `VINAX_DEEPSEEK_V4_PRO_0813`, `VINAX_MISTRAL_NEMOTRON`, `VINAX_KIMI_K3`, `VINAX_GROQ_API_KEY`, `VINAX_OPENROUTER_API_KEY`, `VINAX_MTA_LMA_3_2_11B_VSN_INT`, `VINAX_MTA_LMA_3_2_90B_VSN_INT`, `VINAX_DEEPSEEK_V4_FLASH_0731`, `VINAX_MTA_MUSE_GLIMMER_30B`, `VINAX_NVD_ISING_CALIBRATION_1_5_31B`, `VINAX_POOLSIDE_LAGUNA_XS_2_1`, `VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT`, `VINAX_GGL_GEMMA_4_31B_IT`; optional `BRAVE_API_KEY` (better web search), `NVIDIA_BASE_URL`. Full lane map: `frontend/docs/ai-engine.md` | for AI features |

Every endpoint degrades honestly when a secret is missing (`not_configured` responses, panels that say what to set). The frontend needs **no** env vars on Pages; `VITE_API_BASES` / `VITE_APP_NAME` are optional public overrides.

### 6.2 Supabase

Create a project, set the two `SUPABASE_*` secrets, then paste the idempotent SQL from `frontend/supabase/migrations/*.sql` into the SQL editor (any order). They create the tables and RPCs the analytics panels, experiments, retention cohorts, rooms, SEO corpus and username claims need. `2026-09-vinax-rollups-and-tokens.sql` adds the exact-count RPCs (`vinax_usage`, `vinax_funnel`, `vinax_skips`) behind Feature Usage, Onboarding Funnel and Skip Report — until it is applied those panels fall back to a newest-10,000-event sample and say so — plus the `prompt_tokens`/`completion_tokens` columns that feed AI Tokens & Cost. The console's **Database Overview** and **Query Console** confirm what exists.

### 6.3 Android

`frontend/` builds the APK through Capacitor (`npm run android:debug` locally; `buildapk.yml` / `release.yml` in CI sign and publish releases). `/api/version` serves the update manifest (build, version, SHA-256, proxied APK URL, and `minBuild` from the console's Minimum App Version tool); `/apk` streams the latest release asset. Push to the closed app uses FCM v1 with `FCM_SERVICE_ACCOUNT`; see `frontend/docs/fcm-push-setup.md`.

---

## 7. Configuration published from the console

The console writes JSON values into `vinax_config` (`POST /api/admin/appconfig`, whitelisted keys in `backend/worker/functions/api/admin/appconfig.ts`). Listeners read them through edge-cached public endpoints, so a change lands within about a minute:

| Key | Console tool | Read by |
|---|---|---|
| `banners`, `home-config` | Banners & Offers, Home Screen | `/api/appconfig?key=banners|home-config` |
| `festival` | Festival Themes (auto · off · force) | `/api/appconfig?key=festival` |
| `flags` | Feature Flags (kill-switches; on unless `false`) | `/api/appconfig?key=flags` |
| `trending-pins` | Trending Pins | `/api/trending-searches` |
| `status-note` | Status Note | `/api/status` |
| `runbook` | Runbook | console only |
| `greeting`, `broadcast`, `search-synonyms`, `catalog-sources`, `language-order`, `ai-starters`, `ai-quick`, `support-faq`, `min-version` | their panels | the single client bundle `/api/appconfig?key=client` (sanitised in `_lib/clientConfig.ts`) |
| `maintenance-window` | Maintenance Scheduler | `/api/site-mode` (flips to maintenance and back on its own) |
| `ai-rules` | AI House Rules | appended to the VinaX AI system prompt |
| `ai-prices` | AI Tokens & Cost | USD per 1M tokens per model prefix; no built-in defaults |

---

## 8. Architecture contracts (do not break)

1. **Same-origin API.** The app calls relative paths. Never introduce an absolute API base or CORS.
2. **Worker routes vs Pages fall-through.** A new endpoint = a module under `backend/worker/functions/` **and** an `import` + `EXACT`/`DYNAMIC` entry in `worker/index.ts` (the router-coverage test enforces parity); a new *path family* also needs a pattern in `wrangler.toml`.
3. **SEO pages are edge-rendered** from the live shell at `ASSETS_HOST`; `backend/index.html` is only a test fixture.
4. **Boot prefetch.** `frontend/index.html` fires the cold-load trending request and parks it on `window.__vxBoot`; the API client consumes it by normalised path match. Keep the query shape in sync.
5. **First-load budget.** Anything added to the shell, stores, `PlayerBar`, `Sidebar`, `TrackMenu` or `SongRow` ships on first load. Lazy-load features; re-base the budget only with a written justification in `check-bundle-size.mjs`.
6. **Generated files.** `src/styles/festivals.css`, the `FW` table in `index.html`, `public/admin/festivals.js` and `dist/changelog.json` are generated. Edit the sources (`festivals.ts`, `festivalThemes.ts`, `changelog.ts`) and run the generator; tests fail on drift.
7. **CSP hashes.** Inline scripts in `index.html` are hash-allow-listed in `public/_headers`. After changing `index.html`, run `npm run build && node scripts/csp-hashes.mjs`.
8. **Every change ships an update card.** Bump `frontend/package.json` + `package-lock.json` + `src/constants/version.ts` (`LATEST_VERSION`, `DISPLAY_VERSION`) and add the newest entry at the top of `CHANGELOG_V2` in `src/constants/changelog.ts` — the app shows it once after each update and the console's Release Notes panel reads it.
9. **Secrets discipline.** New server-side config = a Worker secret + its name in `.env.example` + a row in the Environment Checklist. Nothing secret in `VITE_*`, nothing secret in git.
10. **Cron auth.** `/api/cron/*` requires the `x-cron-secret` header. Query-string auth is intentionally rejected.
11. **No third-party brand names** in product copy, comments or docs (the assistant is "VinaX AI", engines have owner-chosen names).
12. **VinaX CLI owns no keys, and no client owns the agent prompt.** The CLI never holds an AI provider credential — it calls `/api/vinaxcli/*` and the Worker calls the engines. The coding-agent system prompt lives server-side in `backend/worker/functions/_lib/cliprompt.ts`; a client-supplied `system` field is rejected outright and a `system` role inside `messages` is dropped. `VINAX_API_BASE` is for `cli/` and development tooling only and must never reach the browser frontend (contract 1 still stands).
13. **A repository may never widen VinaX's access.** A project `.vinax/config.json` can make VinaX stricter — a tighter approval mode, web off, lower ceilings — and is honoured; anything more permissive is ignored and the user is told. Project instruction files (`VINAX.md`, `.vinax/instructions.md`, `AGENTS.md`) are conventions, not privileges, and tool output — files, logs, compiler errors, READMEs, web pages — is data, never instructions. `cli/tests/config.test.ts` and the backend `vinaxcli` suite hold this.
14. **Tutorial anchors.** The live tutorials find controls by `aria-label` and `data-tour` attributes (`player`, `search-input`, `sound`, `import-text`, `Play your Aura Mix`, `Message VinaX AI`, `Search settings`, `Festival themes`, `Custom accent colour`, `Listen Later`, `More options`). Renaming one breaks a step — update `src/features/tutorials/tutorials.ts` in the same change; the e2e Help spec is the place to add a check.

---

## 9. Testing and quality gates

| Suite | Where | Count | Runs in CI |
|---|---|---|---|
| Frontend unit/component | `frontend/src/**/*.test.ts(x)` | 501 tests / 72 files | ✅ |
| Backend endpoint/lib | `backend/worker/**/*.test.ts` | 262 tests / 29 files | ✅ |
| Contracts | contrast + theme tokens, CSP hashes, festival artefact sync, router coverage, bundle budget | — | ✅ |
| VinaX CLI | `cli/tests/*.test.ts` | 299 tests / 13 files | ✅ (`cli.yml`, Linux · macOS · Windows) |
| E2E | `frontend/e2e/*.spec.ts` against the built bundle (external network aborted): admin console (every panel), VinaX AI, festival skins, the 5.17 feature set, the CLI documentation route — 16 tests | `npm run e2e` | `e2e.yml` |
| Lighthouse | `frontend/lighthouserc.json` (SEO + a11y hard-fail) | — | `lighthouse.yml` |

How e2e runs: `npm run e2e` first executes `scripts/e2e-smoke.mjs` (asset and hydration checks), then `vitest run --config e2e/vitest.config.ts`, which serves `dist/` on a local port and drives the same Chromium (`playwright-core`, `E2E_CHROMIUM_PATH` honoured) through a small `@playwright/test`-compatible layer in `e2e/support/`. The three older specs (`smoke`, `a11y`, `qa-sweep`) are excluded: they were written for a runner that is not installed and have drifted; enable them only after updating.

Before pushing: `cd frontend && npm run lint && npm run typecheck && npm test && npm run build && node scripts/csp-hashes.mjs && node scripts/check-bundle-size.mjs`, and `cd backend && npm run lint && npm run typecheck && npm test`, and — when `cli/` changed — `cd cli && npm run lint && npm run typecheck && npm run build && npm test`.

---

## 10. CI and scheduled automation

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push, PR | **frontend**: lint, typecheck, test, build, bundle budget · **backend**: lint, typecheck, test |
| `cli.yml` | push, PR touching `cli/**` or `backend/**` | **VinaX CLI** on Linux, macOS and Windows with Node 22: lint, typecheck, build, full suite (incl. the compiled-binary end-to-end run) |
| `e2e.yml` · `lighthouse.yml` | push, PR | Playwright smoke · performance/SEO/a11y budgets |
| `diagnose.yml` | manual, push | Production hydration check: fetch live HTML, assert every asset, confirm React mounted |
| `buildapk.yml` · `release.yml` | push, manual, tags | Android APK build · signed release published to GitHub Releases |
| `ai-daily-push.yml` | 5× daily (IST 08:00 · 13:00 · 16:00 · 21:00 · 00:00) | `/api/cron/ai-daily-push` — AI-composed, location-targeted song push |
| `song-push.yml` | daily 19:00 IST | `/api/cron/song-push` — per-language song push |
| `weekly-digest.yml` | Monday 09:00 IST | `/api/cron/weekly-digest` — admin overview row |
| `status-tick.yml` · `synthetic-uptime.yml` | every 30 min | status-page probes · external uptime with a deduped issue on outage |

Deployment is **not** done by GitHub Actions — Cloudflare's git integrations deploy; CI is the quality gate. The console's **Cron Health** panel shows the last footprint of every scheduled job.

---

## 11. Operations and troubleshooting

- **Health**: `GET /api/status` (components + 90-day uptime; also the public status page), `GET /api/version`, `GET /sitemap.xml`, `GET /`. In the console: Edge & Endpoint Health, Status History, Cron Health, Environment Checklist, Data Quality, Database Overview.
- **Logs**: Cloudflare → Workers & Pages → `vinax-api` → Observability (persisted; configured in `wrangler.toml [observability]`).
- **Maintenance**: Status Note for a one-line notice; Maintenance Scheduler to flip the site to maintenance for a window automatically; App Configuration for an immediate manual switch.
- **Incidents**: Feature Flags switch parts of the app off for everyone within a minute; Catalog Sources disables a failing music source; Broadcast Message tells listeners something once; Runbook holds the team's own notes.
- **A Pages build failed**: check Workers & Pages → vinax → Deployments; the root directory must be `frontend`.
- **A Worker build failed**: check vinax-api → latest build; if the build token is invalid, assign a new one under Settings → Build.
- **Rollback**: Workers → Deployments → Version History; Pages keeps every deployment re-promotable.
- **Bundle budget failed in CI**: lazy-load the new code; if it is genuinely shell/store code, re-base with a dated justification in `frontend/scripts/check-bundle-size.mjs`.
- **CSP or festival-sync test failed**: run the generator / hash script named in the failure and commit the output.
- **Pre-restructure history**: the original single-folder repo is on the `main-backup` branch.

---

## 12. Release process

1. Make the change (frontend, backend, CLI, or any combination).
2. Bump the version and add the update card (§8.8). Patch for fixes, minor for features.
3. Run the gates (§9). If `index.html` changed, refresh CSP hashes; if festivals changed, run the generator.
4. Commit and push to `main`. Pages and the Worker deploy themselves; watch the CI run.
5. For Android, `release.yml` publishes a signed APK; `/api/version` picks it up. Use Minimum App Version only for security fixes or breaking API changes.
6. **VinaX CLI** has its own version (`cli/package.json` + `cli/src/version.ts`, kept in step by a test) and is *not* auto-deployed — publishing it is a separate, deliberate step, and only with credentials and package ownership already configured. A protocol change keeps the old id in `SUPPORTED_PROTOCOLS` on the Worker until installed clients have had time to update; `vinax doctor` reports a mismatch plainly. See [`cli/README.md`](cli/README.md) §9.

---

## 13. Privacy posture

No accounts, no login. Taste, history, playlists, bookmarks, stats and AI chats live in the browser or the app on the device. Telemetry is opt-in, anonymous and coarse (country/city from the edge, never raw IP; device ids are HMAC-signed and peppered). VinaX AI sends the current message thread and an on-device taste snapshot to answer, stores nothing beyond per-call ok/latency telemetry, and never names a vendor. Device handoff uses one-time, burn-on-read encrypted blobs in KV. The admin console sees aggregates and anonymous rows only.

---

*Music tuned to you. No login. Private by design.*
