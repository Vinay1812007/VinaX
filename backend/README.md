# VinaX — backend (`backend/`)

Standalone **Cloudflare Worker** (`vinax-api`) serving everything dynamic for
VinaX: `/api/*`, edge-rendered SEO pages (`/song|album|artist|playlist/*`,
hub pages), `/sitemap*`, the image proxy (`/img`), the APK download (`/apk`),
and the `update.` / `admin.` host redirects.

The static frontend lives in the **`frontend/` folder** and deploys to
Cloudflare Pages; that Pages deployment is also the fallthrough origin for
every URL the Worker's routes don't claim.

## Layout

| Path | What |
|---|---|
| `worker/index.ts` | Entry — router + Pages-Functions-style adapter |
| `worker/functions/` | All handlers (unchanged from the original monorepo) |
| `worker/wrangler.toml` | Worker config: name, routes, `[vars]` |
| `worker/__tests__/` | Endpoint tests (moved from `src/__tests__`) |
| `index.html` | Snapshot of the SPA shell — **test fixture only** (render.test.ts). At runtime the Worker fetches the live shell from `ASSETS_HOST`. Refresh it from `../frontend/index.html` if the shell's meta tags change. |

## Develop

```sh
npm ci
npm run dev        # wrangler dev on :8787 (reads worker/.dev.vars)
npm test           # vitest
npm run typecheck
```

Put local secrets in `worker/.dev.vars` (gitignored), one `NAME=value` per line.
The frontend's Vite dev server proxies `/api`, `/img`, `/apk` to :8787.

## Deploy

```sh
npx wrangler login                 # once
npm run deploy                     # = wrangler deploy --config worker/wrangler.toml
```

Secrets (every name documented in `.env.example`) are set once on the Worker:

```sh
npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
# ...repeat for the rest (AI lane keys, ADMIN_LOGIN_PASSWORD, VAPID_*,
#    TELEMETRY_PEPPER, DEVICE_ID_SECRET, CRON_SECRET, BRAVE_API_KEY,
#    GITHUB_*, FCM_SERVICE_ACCOUNT)
```

`[vars] ASSETS_HOST` in `worker/wrangler.toml` must point at the Pages host
(`vinax.pages.dev`) so the edge-rendered SEO pages can fetch the SPA shell.
