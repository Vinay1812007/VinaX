# VinaX backend

This package is the `vinax-api` Worker. It serves everything dynamic on the VinaX domain: `/api/*`, edge-rendered song, album, artist, playlist and hub pages, the sitemaps, the image proxy (`/img`), the Android package download (`/apk`) and the host redirects. Any URL it does not claim is passed to the static frontend. This file covers the layout and the everyday commands; routes, AI lanes, secrets and deployment are in [../docs/](../docs/README.md).

## Layout

| Path | What it is |
| --- | --- |
| `worker/index.ts` | The router and the adapter that gives each handler `{ request, env, params, next, waitUntil, data }` |
| `worker/functions/api/` | Public, AI, cron, push and admin endpoints |
| `worker/functions/_lib/` | Shared code: AI lanes (`ai.ts`, `models.ts`, `laneHealth.ts`), admin auth (`admin.ts`), catalogue, rate limits, push, rendering |
| `worker/functions/_middleware.ts` | Host-level redirects |
| `worker/wrangler.toml` | Worker name, routes, `[vars]`, bindings |
| `worker/__tests__/` | Cross-cutting tests, including router coverage and AI failover |
| `index.html` | A snapshot of the app shell used only as a test fixture (`_lib/render.test.ts`). Refresh it from `../frontend/index.html` when the shell's meta tags change. |

A new handler under `worker/functions/api/` needs an import and an exact-path entry in `worker/index.ts`. `worker/__tests__/routerCoverage.test.ts` fails without them.

## Develop

Use Node.js 22 or newer.

```sh
npm ci
npm run dev          # the Worker on port 8787; reads worker/.dev.vars
npm run lint
npm run typecheck
npm test
```

Put local secrets in `worker/.dev.vars` (ignored by git), one `NAME=value` per line. Every name is documented in `.env.example`. The frontend dev server proxies `/api`, `/img` and `/apk` to port 8787.

## Deploy

```sh
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
npm run deploy
```

Secrets are set once with `npx wrangler secret put <NAME> --config worker/wrangler.toml`. The full procedure, the second deploy path and the runbooks are in [../DEPLOYMENT.md](../DEPLOYMENT.md) and [../docs/operations.md](../docs/operations.md). Route contracts for the AI endpoints are in [../docs/ai.md](../docs/ai.md); the admin endpoints are described in [../docs/admin-console.md](../docs/admin-console.md).
