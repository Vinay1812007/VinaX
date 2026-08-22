# Deploying VinaX — Pages (frontend) + Worker (backend)

The repo is one project with two deployables:

| Piece | What | Where |
|---|---|---|
| Frontend | `dist/` (Vite build of `src/` + `public/`) | **Cloudflare Pages** |
| Backend | `worker/` (entry `worker/index.ts`, all edge modules in `worker/functions/`) | **Cloudflare Workers**, bound to the domain via routes |

Both run on the same domain. The Worker owns `/api/*`, `/img`, `/apk`,
`/song|album|artist|playlist/*`, `/sitemap*`, plus the `update.` and `admin.`
host redirects; every other URL is served by Pages. No CORS, no frontend
changes — the app keeps calling same-origin paths.

## 1 · Deploy the frontend (Pages)

```sh
npm ci
npm run build          # tsc + vite build + prerender
npx wrangler pages deploy dist --project-name vinax
```

(or keep the existing Pages Git integration — build command `npm run build`,
output `dist`. There is no `functions/` dir at the repo root anymore, so Pages
deploys static files only.)

Keep the custom domains (`www.sirimillavinay.online`, apex, `admin.`,
`update.`) attached to the Pages project — Pages remains the origin the
Worker falls through to.

## 2 · Deploy the backend (Worker)

```sh
# one-time: point the Worker at your Pages host (SPA shell for SEO pages)
#   edit worker/wrangler.toml -> [vars] ASSETS_HOST = "<project>.pages.dev"

# one-time: move every secret from the Pages project to the Worker
npx wrangler secret put SUPABASE_URL --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
# ...repeat for every name documented in .env.example
#    (AI lane keys, ADMIN_LOGIN_PASSWORD, VAPID_*, TELEMETRY_PEPPER,
#     DEVICE_ID_SECRET, CRON_SECRET, BRAVE_API_KEY, GITHUB_*, FCM_SERVICE_ACCOUNT)

npm run deploy:worker
```

The routes in `worker/wrangler.toml` bind the Worker to the production zone.
After the first deploy, verify in the dashboard (Workers & Pages → vinax-api →
Settings → Domains & Routes) that all routes attached.

Once the Worker answers `/api/version`, remove the old env vars from the
Pages project (they are unused there now).

## 3 · Local development

```sh
npm run dev:worker     # wrangler dev on :8787 (reads worker/.dev.vars)
npm run dev            # vite on :5173, proxies /api /img /apk to :8787
```

Put local secrets in `worker/.dev.vars` (gitignored), one `NAME=value` per line.

## 4 · What did NOT change

- All backend code in `worker/functions/` is byte-identical to the old
  `functions/` — same handlers, same env var names, same URLs.
- GitHub Actions cron jobs still POST to
  `https://www.sirimillavinay.online/api/cron/*` — those paths now route to
  the Worker automatically.
- `public/_redirects` / `public/_headers` still ship with Pages and apply to
  everything Pages serves.

## How the split works

`worker/index.ts` is a small router + adapter. It maps each path to the same
module Pages used to invoke, builds the Pages-style context
(`request/env/params/next/waitUntil`), and shims `env.ASSETS.fetch` to fetch
the SPA shell from `ASSETS_HOST` — that keeps the edge-rendered song/album/
artist/playlist SEO pages working. Unmatched paths (and the SPA fallback in
`_lib/render.ts`) pass through to Pages.
