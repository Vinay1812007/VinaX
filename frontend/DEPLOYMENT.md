# Deploying VinaX frontend (`frontend/`) — Cloudflare Pages

This branch is the static frontend only: `src/` + `public/` built by Vite
into `dist/`. The backend (API, SEO pages, sitemaps, image proxy) lives in
the **`backend/` folder** and deploys as the `vinax-api` Cloudflare Worker.

Both run on the same domain: the Worker's routes own `/api/*`, `/img`,
`/apk`, `/song|album|artist|playlist/*`, `/sitemap*` and the `update.` /
`admin.` host redirects; every other URL is served by Pages. No CORS, no
frontend changes — the app calls same-origin paths.

## Deploy via Git integration (recommended)

Cloudflare dashboard → Workers & Pages → the `vinax` Pages project →
Settings → Builds & deployments:

- Production branch: **main**
- Root directory: **frontend**
- Build command: `npm run build`
- Build output directory: `dist`

Every push to `main` that touches `frontend/` then deploys automatically.

## Deploy from the CLI

```sh
npm ci
npm run build          # tsc + vite build + prerender
npx wrangler pages deploy dist --project-name vinax
```

Keep the custom domains (`www.sirimillavinay.online`, apex, `admin.`,
`update.`) attached to the Pages project — Pages is the fallthrough origin
the Worker passes unmatched URLs to.

No env vars or secrets are needed on Pages; they all live on the Worker.

## Local development

```sh
npm run dev            # vite on :5173
```

Run `npm run dev` in `../backend` (wrangler on :8787) alongside — vite proxies `/api` (incl. `/api/cat`), `/img`, `/apk`
to it.
