# VinaX

**A personal listening space, built around what you love.**

VinaX combines music discovery, playback, lyrics, playlists and AI assistance in a React web app and a Capacitor Android app. A Cloudflare Worker powers the catalog gateway, AI features and the owner console.

[Listen](https://www.sirimillavinay.online) · [Deployment guide](DEPLOYMENT.md) · [User guide](frontend/docs/user-guide/README.md)

## What's new in 5.31

- A refreshed listening workspace with a larger Aura Mix hero, consistent surfaces and clearer navigation.
- **Home Studio:** Familiar, Balanced and Discover recommendation controls; Balanced, Discovery and Focused layouts; shelf visibility and ordering directly on Home.
- **Playlist Studio:** mood-based starting points adapted to your first selected language, an editable prompt and clear generation feedback.
- **A shorter welcome:** four practical steps, an optional live walkthrough and a Home checklist that reflects real listening progress.
- **Control Room:** an operational overview, actionable shortcuts, home layout presets, a structure preview and draft/published status.
- Reliability fixes for disappearing shelves, duplicate layout keys, slow AI shelf requests and repetitive next-song sequencing in small catalogs.

## Listening features

| Experience | What you can do |
| --- | --- |
| Home and discovery | Play an Aura Mix, revisit favourites, browse charts, artists, languages, moods and fresh releases |
| Your library | Save favourites, build collections, keep a listen-later list and revisit listening history |
| Player | Manage the queue, read synced lyrics where available, use a sleep timer and adjust supported sound settings |
| Personalization | Choose languages, mute languages, adjust taste dials and choose how strongly listening taste affects recommendations |
| AI | Describe a playlist idea or use VinaX AI; available engines and features depend on server configuration |
| Together | Create listening rooms and share a room code when the feature is enabled |
| Android | Native playback integrations and downloads; availability differs from the browser |
| Accessibility | Keyboard shortcuts, reduced motion, theme choices, text sizing and contrast settings |

Music and AI results depend on the configured providers. Local recommendations and shelf design provide fallbacks when AI is unavailable; playing uncached music still requires a working catalog and network.

## How personalization works

VinaX builds a taste profile from listening activity on the device. Its ranking combines language and artist affinity, popularity, listening context, skips and discovery preferences. Queue construction filters candidates, deduplicates song identities and sequences artists for variety. When a small catalog makes the artist cap impossible, it relaxes that cap before allowing consecutive songs by the same artist.

Home combines catalog-backed shelves with AI-designed queries. The AI request has a six-second client deadline; local templates can take over when it fails. Parallel catalog requests are deduplicated in shelf order, and selected-language shelves do not fill shortages with known off-language songs. New listeners can receive personalized shelves after choosing languages, before building history.

**Familiar** increases the influence of established taste. **Balanced** blends taste with broader picks. **Discover** enables exploration slots. These controls guide recommendations; they do not promise a particular song or change tracks already queued.

## Privacy and data

The library, history, settings and taste profile are stored locally. Clearing browser/app data can remove them: export a backup in **Settings → Your Data** first. Device transfer and import are available from Settings and onboarding.

“Local profile” does not mean no network data is sent. AI requests include relevant taste/session context; catalog requests include search terms; usernames are checked with the service; optional telemetry follows the usage-sharing setting. Review the in-app privacy page and server configuration for your deployment. Never put API keys or service-role credentials in frontend environment variables.

## Run locally

Use **Node.js 22 or newer** and npm. The repository contains both applications on `main`.

```sh
# Terminal 1: API on port 8787
cd backend
npm ci
npm run dev
```

```sh
# Terminal 2: frontend on port 5173
cd frontend
npm ci
npm run dev
```

For local backend secrets, create `backend/worker/.dev.vars` using the names documented in [backend/.env.example](backend/.env.example). Keep that file untracked. The Vite development server proxies API, image and APK requests to the Worker. Without configured services, some screens show empty or unavailable states.

## Project map

```text
frontend/
  src/components/             Shared player, navigation and welcome UI
  src/features/home/          Home shelves, Studio and personalization hooks
  src/pages/                  Routed music and AI experiences
  src/services/recommendation/ Ranking, filtering and next-song sequencing
  src/services/personalization/ Device-local taste and session signals
  src/styles/                 Theme tokens and Studio presentation
  public/admin/               Standalone owner console
  e2e/                        Browser regression suites
backend/
  worker/index.ts             Worker routing
  worker/functions/api/       Public and authenticated admin endpoints
  worker/functions/_lib/      Shared validation and service adapters
  worker/wrangler.toml        Worker bindings and routes
.github/workflows/            CI, deployment, release and monitoring
```

## Owner console

Open `/admin/` and authenticate with the configured owner credentials. The console includes audience and music analytics, feedback, AI monitoring, content controls, feature flags, release information and operational tools.

In **Home Screen Management**, choose a preset, inspect the structure preview, then refine shelf order and visibility. Edits are drafts until **Publish layout** succeeds. Published defaults can take up to five minutes to reach clients. Listener ordering takes precedence locally; shelves disabled by the owner remain disabled. The Worker rejects malformed, unknown or duplicate home block IDs.

The preview shows structure, not actual personalized music or final device rendering. Missing telemetry is shown as unavailable, rather than evidence that the system is healthy.

## Validation

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e
```

```sh
cd backend
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
```

Browser tests require Chromium (`npx playwright-core install chromium`), or `E2E_CHROMIUM_PATH` pointing to a compatible installed binary. They exercise the built frontend with mocked APIs; they do not prove live catalog, credentials, Android signing or provider availability.

## Deploy and release

See [DEPLOYMENT.md](DEPLOYMENT.md) for the monorepo build roots, Cloudflare settings, release checks and rollback procedure. CI runs on pushes to `main` and pull requests. A Git push is not proof of deployment: inspect the hosting build and verify the served version afterward.

Tagged Android releases require the configured release keystore; the release workflow refuses to publish a debug-signed release. Do not commit secrets, generated build folders or personal exports.
