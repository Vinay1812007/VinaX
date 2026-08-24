# VinaX

Music tuned to you. No login. Private by design.

One repo, two deployables side by side:

| Folder | What | Deploys to |
|---|---|---|
| [`frontend/`](frontend/) | React + Vite SPA (`src/` + `public/` → `dist/`) | **Cloudflare Pages** (project `vinax`) |
| [`backend/`](backend/) | `vinax-api` Cloudflare Worker (`worker/`) — API, SEO pages, sitemaps, image proxy | **Cloudflare Workers** |

Both serve the same domain (`www.sirimillavinay.online`): the Worker's routes
own `/api/*`, `/img`, `/apk`, `/song|album|artist|playlist/*`, `/sitemap*`
plus the `update.` / `admin.` host redirects; every other URL falls through
to Pages. Same-origin, no CORS.

## Quick start

```sh
# terminal 1 — backend (wrangler dev on :8787)
cd backend && npm ci && npm run dev

# terminal 2 — frontend (vite on :5173, proxies /api /img /apk → :8787)
cd frontend && npm ci && npm run dev
```

## Deploy

- **Frontend → Cloudflare Pages**: root directory `frontend`, build command
  `npm run build`, output `dist`. See `frontend/DEPLOYMENT.md`.
- **Backend → Cloudflare Workers**: `cd backend && npm run deploy`.
  See `backend/README.md` (secrets are listed in `backend/.env.example`).

Each folder is self-contained (own `package.json`, lockfile, tsconfig,
tests). See `frontend/README.md` for the app documentation.
