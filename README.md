# VinaX

**Free music streaming for India. No login. Private by design.**

Live at **https://www.sirimillavinay.online** — Telugu, Hindi, Tamil and 9 more languages, with a clean formal visual system (v5.8.1), smart mixes, live charts, an AI DJ, synced lyrics, music videos with a full-screen Now Playing video canvas on every device, and an Android app.

> **For AI agents / new contributors — read this first.** This file is the single source of truth for how the repo is laid out, how it deploys, and which commands are safe to run. Everything below is intentionally explicit: exact paths, exact commands, exact env-var names.

---

## 1. What this repo is

One repository, two independently deployed applications that serve **the same domain**:

| Folder | What it is | Tech | Deploys to | Trigger |
|---|---|---|---|---|
| [`frontend/`](frontend/) | Single-page web app (and the Android app via Capacitor) | React 19 + Vite + TypeScript + Tailwind + Zustand + TanStack Query | **Cloudflare Pages** (project `vinax`) | push to `main` touching `frontend/**` |
| [`backend/`](backend/) | `vinax-api` edge Worker: JSON API, server-rendered SEO pages, sitemaps, image proxy, APK download, admin API, cron endpoints | Cloudflare Workers + TypeScript (no framework, no runtime npm deps) | **Cloudflare Workers** | push to `main` touching `backend/**` |

There is **no CORS anywhere**: the Worker's routes claim specific paths on `www.sirimillavinay.online` (`/api/*`, `/img`, `/apk`, `/song|album|artist|playlist/*`, `/sitemap*`, plus the `update.` and `admin.` subdomain redirects) and **every other URL falls through to Pages**, which serves the static app. The frontend always calls same-origin paths.

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
        /song/* /album/* │                 │  ( / , /search, /assets/*, …)
        /sitemap* …      ▼                 ▼
                 ┌───────────────┐  ┌─────────────────┐
                 │  vinax-api    │  │ Cloudflare Pages│
                 │  (Worker,     │  │ (static dist/   │
                 │  backend/)    │  │ from frontend/) │
                 └──────┬────────┘  └─────────────────┘
                        │
         ┌──────────────┼───────────────────┐
         ▼              ▼                   ▼
     Supabase      AI providers        HANDOFF KV
     (Postgres)    (7 model lanes)     (one-time links)
```

---

## 2. Repository map

```
.
├── README.md                  ← you are here
├── .github/workflows/         ← CI + cron jobs (see §7)
├── frontend/                  ← EVERYTHING the browser downloads
│   ├── src/                   ← React app (components, pages, store, services)
│   │   └── services/api/      ← API client incl. boot-prefetch consumption
│   ├── public/                ← static assets, _redirects, _headers, robots.txt
│   ├── index.html             ← SPA shell (inline boot-prefetch script, meta tags)
│   ├── vite.config.ts         ← build + dev proxy (/api,/img,/apk → :8787)
│   ├── capacitor.config.ts    ← Android app wrapper config
│   ├── android-res/, native-android/, ci/  ← Android build inputs
│   ├── scripts/               ← prerender, bundle-size gate, e2e smoke
│   ├── e2e/                   ← Playwright specs (run via npm run e2e)
│   └── DEPLOYMENT.md          ← Pages deployment details
└── backend/                   ← EVERYTHING that runs at the edge
    ├── worker/
    │   ├── index.ts           ← entry: router + Pages-Functions-style adapter
    │   ├── wrangler.toml      ← name, routes, [vars], KV binding, observability
    │   ├── functions/         ← one module per endpoint (api/, song/, sitemaps…)
    │   │   └── _lib/          ← shared: ai lanes, render, seo, rate-limit, …
    │   └── __tests__/         ← endpoint tests
    ├── index.html             ← TEST FIXTURE ONLY (snapshot of the SPA shell
    │                             for render.test.ts; runtime fetches the live
    │                             shell from ASSETS_HOST — refresh when
    │                             frontend/index.html meta tags change)
    ├── README.md              ← Worker deployment details
    └── .env.example           ← documents every secret NAME (values live in
                                  Cloudflare, never in git)
```

Each folder is fully self-contained: own `package.json`, own lockfile, own `tsconfig.json`, own eslint config, own tests. **Never** run npm commands at the repo root — there is no root `package.json`.

---

## 3. Local development

Prereqs: Node ≥ 22, npm.

```sh
# terminal 1 — backend (wrangler dev on http://127.0.0.1:8787)
cd backend
npm ci
npm run dev

# terminal 2 — frontend (vite on http://localhost:5173)
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` (including the self-hosted catalog at `/api/cat`), `/img` and `/apk` to `:8787`, so the full stack works locally. Local secrets go in `backend/worker/.dev.vars` (gitignored, `NAME=value` per line); the names are documented in `backend/.env.example`.

### Command reference

| Where | Command | What it does |
|---|---|---|
| `frontend/` | `npm run dev` | Vite dev server on :5173 |
| `frontend/` | `npm run build` | typecheck + Vite build + prerender (31 routes) → `dist/` |
| `frontend/` | `npm test` | Vitest (322 tests) |
| `frontend/` | `npm run lint` / `typecheck` | eslint / tsc gates (CI runs both) |
| `frontend/` | `npm run e2e` | Playwright smoke tests |
| `frontend/` | `npm run android:debug` | Capacitor sync + Gradle debug APK |
| `backend/` | `npm run dev` | wrangler dev on :8787 (reads `.dev.vars`) |
| `backend/` | `npm run deploy` | manual `wrangler deploy` (normally not needed — git auto-deploys) |
| `backend/` | `npm test` | Vitest (119 tests) |
| `backend/` | `npm run lint` / `typecheck` | eslint / tsc gates (CI runs both) |

---

## 4. Deployment (fully automatic)

**Push to `main`. That's the whole deployment process.**

| Piece | Watches | Pipeline |
|---|---|---|
| Frontend | `frontend/*` | Cloudflare Pages git integration → root directory `frontend`, build `npm run build`, output `dist` → live on all domains |
| Backend | `backend/*` | Cloudflare Workers Builds → root directory `/backend`, deploy command `npx wrangler deploy --config worker/wrangler.toml` |

Manual fallbacks (rarely needed):

```sh
cd frontend && npm ci && npm run build && npx wrangler pages deploy dist --project-name vinax
cd backend  && npm ci && npm run deploy
```

**Domains** (`www.sirimillavinay.online`, apex, `admin.`, `update.`) stay attached to the **Pages** project — Pages is the fall-through origin the Worker passes unmatched URLs to. The Worker's route list lives in [`backend/worker/wrangler.toml`](backend/worker/wrangler.toml); after changing routes, verify them under *Cloudflare → Workers & Pages → vinax-api → Settings → Domains & Routes*.

### Configuration & secrets

- Non-secret Worker config lives in `wrangler.toml` under `[vars]`: `ASSETS_HOST` (the Pages host serving the SPA shell, `vinax.pages.dev`) and `GITHUB_REPO` (used by the APK release endpoint).
- **Secrets never live in git.** Every name is documented in [`backend/.env.example`](backend/.env.example); values are set on the Worker via `npx wrangler secret put <NAME> --config worker/wrangler.toml` or the dashboard. Currently configured: Supabase pair (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), `ADMIN_LOGIN_PASSWORD`, VAPID keypair + subject (web push), `TELEMETRY_PEPPER`, `DEVICE_ID_SECRET`, `CRON_SECRET`, `GITHUB_TOKEN`, `FCM_SERVICE_ACCOUNT`, and the 7 AI lane keys (`VINAX_DEEPSEEK_V4_FLASH`, `VINAX_CHATGPT_20_B`, `VINAX_CHATGPT_120_B`, `VINAX_NEMOTRON_SUPER`, `VINAX_NEMOTRON_ULTRA`, `VINAX_GROQ_API_KEY`, `VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B`). Optional/unset: `BRAVE_API_KEY` (enables web search inside VinaX AI), `NVIDIA_BASE_URL`.
- **Bindings:** `HANDOFF` → KV namespace `vinax-handoff` (one-time encrypted device-handoff links, burn-on-read). Declared in `wrangler.toml`; the code degrades to `not_configured` if absent.
- The frontend needs **no** env vars or secrets on Pages. `VITE_*` variables are optional public overrides only.

---

## 5. Key architecture contracts (do not break these)

1. **Same-origin API.** The app calls relative paths (`/api/...`). Never introduce an absolute API base or CORS.
2. **Worker routes vs Pages fall-through.** Adding a dynamic route = add the pattern in `wrangler.toml` *and* the module under `backend/worker/functions/`. `worker/index.ts` maps paths → modules with a Pages-Functions-style context (`{request, env, params, next, waitUntil}`).
3. **SEO pages are edge-rendered.** `/song/*`, `/album/*`, `/artist/*`, `/playlist/*` and the 72 language-mood hub pages (12 languages × 6 moods, allow-list in `functions/[hub].ts`) are rendered by the Worker by injecting content into the SPA shell fetched from `ASSETS_HOST`. `backend/index.html` is only a test fixture of that shell.
4. **Boot prefetch.** `frontend/index.html` inline-fires the cold-load trending request and parks it on `window.__vxBoot`; `src/services/api/client.ts` consumes it by **normalized path+query match**, single-use. Keep query shape (`top {lang} songs {year}`) in sync between the two files.
5. **Cache-busting epoch.** Asset filenames carry an epoch marker (`-b3` in `vite.config.ts`). Bump it (b3 → b4) only to invalidate poisoned browser caches — it changes every asset URL at once.
6. **Secrets discipline.** New server-side config = a Worker secret + a line in `.env.example` documenting the name. Nothing secret in `VITE_*`, nothing secret in git.
7. **Cron auth.** `/api/cron/*` requires the `x-cron-secret` header (matched against `CRON_SECRET`). Query-string auth is intentionally not accepted.

---

## 6. Testing

| Suite | Where | Count | Runs in CI |
|---|---|---|---|
| Frontend unit/component | `frontend/src/**/*.test.ts(x)` | 322 tests / 48 files | ✅ |
| Backend endpoint/lib | `backend/worker/**/*.test.ts` | 119 tests / 18 files | ✅ |
| E2E smoke | `frontend/e2e/` (Playwright) | — | separate workflow |
| Lighthouse budget | `frontend/lighthouserc.json` | — | separate workflow |

---

## 7. CI / automation (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to `main`, PRs | Two parallel jobs: **frontend** (lint, typecheck, test, build, bundle-size gate) and **backend** (lint, typecheck, test, `wrangler deploy --dry-run`) |
| `e2e.yml`, `lighthouse.yml` | push/PR | Playwright smoke / performance budget |
| `buildapk.yml`, `release.yml` | manual / tags | Android APK builds (debug + signed release), published to GitHub Releases (`/apk` on the site serves the latest) |
| `ai-daily-push.yml`, `song-push.yml`, `weekly-digest.yml`, `synthetic-uptime.yml` | cron | POST to `https://www.sirimillavinay.online/api/cron/*` with the `x-cron-secret` header |

Deployment is **not** done by GitHub Actions — Cloudflare's own git integrations handle it (see §4). CI is the quality gate; Cloudflare is the deploy pipeline.

---

## 8. Operations & troubleshooting

- **Logs:** Cloudflare → Workers & Pages → `vinax-api` → **Observability** (invocation logs are enabled and persisted; config lives in `wrangler.toml [observability]` so deploys don't reset it).
- **Health checks:** `GET /api/version` (Worker alive; returns `no_release` until a GitHub Release exists), `GET /sitemap.xml` (sitemap index), `GET /` (Pages serving the app).
- **A Pages build failed:** check the deployment log (Workers & Pages → vinax → Deployments). Most common cause: build ran outside `frontend/` — root directory must be `frontend`.
- **A Worker build failed:** check Workers & Pages → vinax-api → latest build log. If it says the build token is invalid, assign a new one under Settings → Build → API token (these tokens are auto-managed; don't delete them during token cleanups).
- **Rollback:** Workers & Pages → vinax-api → Deployments → Version History → rollback; Pages keeps every previous deployment addressable and re-promotable.
- **Pre-restructure history:** the original single-folder repo is preserved on the [`main-backup`](../../tree/main-backup) branch.

---

## 9. Admin & extras

- **Admin console:** `https://admin.sirimillavinay.online` (SPA served from `frontend/public/admin`, API at `/api/admin/*`, gated by `ADMIN_LOGIN_PASSWORD`); 26 tools organized under eight formal categories with collapsible sidebar groups (v5.7.5), redesigned in v5.8.0 as a formal flat token-driven console (dark + light) with no blur/glow/gradient effects; the listener sidebar carries an Ads page whose sponsored placement loads its ad script ONLY on that page, with /ads.txt and an inert head meta tag proving site ownership (v5.7.8).
- **Android app:** Capacitor wrapper of the same frontend; `update.sirimillavinay.online` redirects to the latest APK; push via FCM when `FCM_SERVICE_ACCOUNT` is set; downloads save into the app's own folder on device storage and play fully offline (v5.7.3); the service worker keeps the offline app shell in lockstep with each deploy so no-internet launches always boot (v5.7.4).
- **AI features:** nineteen model "lanes" (chat, quick answers, deep thinking, music Q&A, DJ/mixes, home-screen builder, search expert, and more) across the 18 owner-named engines, each pinned to its own provider + key in `backend/worker/functions/_lib/ai.ts`. Synced lyrics resolve LRCLIB-first with strict title matching (v5.7.2), falling back to catalog lyrics.
- **Privacy posture:** no accounts, no login; telemetry device-ids are HMAC-peppered (`TELEMETRY_PEPPER`/`DEVICE_ID_SECRET`); device-to-device handoff uses one-time burn-on-read encrypted blobs in KV.

---

*Music tuned to you. No login. Private by design.*
