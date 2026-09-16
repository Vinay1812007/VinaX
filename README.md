# VinaX

**A personal listening space, built around what you love.**

VinaX combines music discovery, playback, lyrics, playlists and AI assistance in a React web app and a Capacitor Android app. A Cloudflare Worker powers the catalog gateway, AI features and the owner console.

[Listen](https://www.sirimillavinay.online) · [Deployment guide](DEPLOYMENT.md) · [User guide](frontend/docs/user-guide/README.md)

## What's new in 6.4 — the personalization pipeline, audited end to end

A full audit of the recommendation system against a 32-point brief (AI DJ, AI Home builder, next-song engine, taste profile, language-aware personalization, session context, anti-repeat and diversity, AI fallback). Most points were already met; 6.4 closes the gaps: configurable **event weights** with a per-affinity cap (`services/personalization/eventWeights.ts`), exported **decay helpers** (`applyTimeDecay`, `getDecayedAffinity`), **song-level and weekday affinity** plus a persisted **energy preference** in the taste profile and scorer, a named **session state** (`CALM`, `FOCUSED`, `ENERGETIC`, `RESTLESS`, `WAVERING`, `LOCKED_IN`, `LATE_NIGHT`, `MORNING`, `PARTY`, `WIND_DOWN`) with skip/completion counters, an **id-based DJ contract** with per-pick confidence and a 12-second bound, **language drift** in Explore mode, the AI Home builder split into `services/ai/home.ts` + `features/home/useAiHome.ts` with typed shelves and song-level anti-repeat, and a **development-only recs debug view** (`?debug=recs`). See [UPGRADE_6_4.md](UPGRADE_6_4.md) for the audit table and the runtime flow.

## What's new in 6.3 — arc sequencing, adaptive re-planning, Queue Builder

Queue continuation is now an **arc**, not a top-N list: `services/recommendation/sequencer.ts` orders the admitted pool from per-song signals (classifier or mood-derived energy with a tempo nudge, mood continuity, artist spacing, era proximity, language lock) toward a target shape (steady, build, wind-down, wave, lift) chosen from the live listener-energy read, and prefers hand-offs the listener completed before over ones they skipped (`transitions.ts`, device-local memory fed by real playback). The AI DJ still writes reasons and segues, but its order is accepted only when it keeps the arc at least as tight as the local one. Two skips inside the recommender's tail re-plan the remaining tail with sure favourites first (`adaptive.ts`); hand-queued songs are never moved. The **Queue Builder** on the Queue page plans a whole stretch from a brief (length, mood, shape, discovery, language, optional note to the DJ) and previews it, with an energy-arc chart and a reason per song, before touching the queue.

## What's new in 6.2 — AI DJ, talking DJ voice, AI-designed Home shelves

The AI DJ returns on the lane router: when autoplay or radio continues the queue, the DJ engine sequences the next stretch **from candidates the on-device recommender already gathered and filtered** (language lock, blocklists, canonical de-dup) — an energy arc, no artist twice in a row, a one-line reason per pick and a spoken segue. It never invents a song; a pick outside the pool is discarded, and when the service is slow, down or unconfigured the deterministic order ships. **DJ voice** speaks those segues in the listener's chosen studio voice (device voice offline), ducking the music while it talks. **Designed for you** is a Home block of AI-titled shelves resolved against the catalogue, refreshed per half-day with anti-repeat memory. Listener switches: Settings → Recommendations; owner kill-switches: feature flags `aiDj` and `aiHome`; the block is `aihome` in Home layouts. See [frontend/docs/ai-engine.md](frontend/docs/ai-engine.md).

## What's new in 6.1

Reliability and data safety first: a versioned backup format with a Backup Center (preview, merge or replace, undo), an import review step for text playlists, Unicode-safe song matching, cancellable imports, truthful username claims, and a fix for the looping Android download link. Home now loads only the shelves in view and respects owner-disabled shelves; listening minutes follow one shared rule. New in the Library: in-playlist search, multi-select edits with Undo, and smart collections. See [UPGRADE_6_1.md](UPGRADE_6_1.md) for details, verification and limitations.

## Discovery Room upgrade

Search now has a new discovery layout, 15 listener additions, and improved matching and pagination. The owner console gains an Operations Workspace with 13 capabilities for metrics, search recovery, task tracking, and handovers. See [the feature and validation guide](DISCOVERY_UPGRADE.md) for scope and local-storage limitations.

## What's new in Astra 6.0

Astra refreshes the customer workspace, VinaX AI and the owner console with a space-inspired design, clearer typography, loading states and reduced-motion-aware interactions. Home now includes an explicit **Refresh discovery** action.

Playback follows the selected album, playlist or manual queue; with autoplay or radio on, the queue is extended by the on-device recommender and, since 6.2, sequenced by the AI DJ (see above). Home Studio (the listener-side layout editor, with optional AI-suggested arrangements) remains available on Home; see **Home customization** below for how it combines with the owner's published layout. AI playlists exclude recent generations while resolving catalog searches in parallel. Chat regeneration uses the correct conversation context and asks for a different approach.

See [the complete Astra upgrade and checking guide](ASTRA_UPGRADE.md) for changes, limitations and the post-deployment walkthrough.

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

Music and AI results depend on the configured providers. Catalog shelves use local recommendations; playing uncached music still requires a working catalog and network.

## How personalization works

VinaX builds a taste profile from listening activity on the device. Its ranking combines language and artist affinity, popularity, listening context, skips and discovery preferences. Queue construction filters candidates, deduplicates song identities and sequences artists for variety. When a small catalog makes the artist cap impossible, it relaxes that cap before allowing consecutive songs by the same artist.

Home combines catalog-backed shelves with locally generated queries, plus the optional AI-designed "Designed for you" block (`aihome`). Each Home block owns its catalog requests: the Aura Mix hero and the first two blocks load immediately, every later block loads only when it scrolls near the viewport, and a hidden block never requests anything. Songs are de-duplicated across shelves in display order, and selected-language shelves do not fill shortages with known off-language songs. New listeners can receive personalized shelves after choosing languages, before building history.

**Familiar** increases the influence of established taste. **Balanced** blends taste with broader picks. **Discover** enables exploration slots. These controls guide recommendations; they do not promise a particular song or change tracks already queued.

### Home customization

Three inputs decide the Home layout, in this order:

1. **Listener layout** — saved from Home Studio on this device (shelf order, hidden shelves, headline). When present, its order and headline win.
2. **Owner layout** — published from the owner console (`home-layout`). Used when the listener has not saved one. Shelves the owner turns off are removed for everyone and cannot be re-enabled from Home Studio; they show as locked there.
3. **Default order** — the built-in order, possibly swapped by the shelf-order experiment.

Hidden shelves are the union of the owner's and the listener's choices. A newly published owner change reaches the app on the next config refresh (about a minute) and is enforced even over an older saved listener layout. If a layout would hide everything, the listener's hides are ignored and only the owner's rules apply.

### Listening statistics

Home, Stats, the weekly report, the listening calendar, the daily goal ring and the AI daily brief share one rule (`features/stats/listening.ts`). Plays recorded since 6.1 carry a measured duration (pauses and seeks excluded, replays included). Older plays are estimated — a completed play counts the full track, an unfinished one a third — and every estimate is shown with ≈. History keeps the last 150 plays, so weekly and 12-week figures say when that limit cuts the window short. Nothing is back-filled.

## Privacy and data

The library, history, settings and taste profile are stored locally. Clearing browser/app data can remove them: export a backup in **Settings → Your Data** first. The backup is a versioned JSON file (`vinax-backup`, schema 2) holding settings, library, smart collections, history, taste profile, saved and recent searches, bookmarks, Home layout, name and username, alarm and app preferences, and AI chats. It never holds downloaded audio or download paths, the device identity or service token, Listen Together host keys, usage-sharing consent, the queue, or caches. Older exports are migrated on restore; a damaged file or a full device changes nothing. The **Backup Center** previews a file against the device and restores by merge or replace, with undo. Device-to-device transfer (**Move to a new device**) is the one path that also carries the device token and confirmed username.

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
  src/services/recommendation/ Catalog ranking, filtering and song identity
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

In **Home Layout Studio**, set the headline, reorder shelves and untick any shelf to turn it off for everyone. Order changes save as you go; the headline and visibility are published with **Publish layout**. Published defaults reach clients within about a minute (the app's config cache) and are enforced even over a listener's saved layout: listener ordering takes precedence locally, shelves disabled by the owner remain disabled. At least one shelf must stay on. The Worker rejects malformed, unknown or duplicate home block IDs.

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
# Home request-load guard (prints per-endpoint tallies with E2E_PRINT_REQUESTS=1)
npx vitest run --config e2e/vitest.config.ts e2e/home-requests.spec.ts
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
