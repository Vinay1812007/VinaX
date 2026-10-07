# VinaX

VinaX is a free music app with no sign-up: it plays from a public catalogue, learns a listener's taste on their own device, and builds what plays next from that. It ships as a web app and an Android app from one codebase, backed by one edge Worker. This README says what is in the repository, what a listener can do, how to run and verify it, how a release is made, and where the rest of the documentation is.

[Documentation index](docs/README.md) · [User guide](docs/user-guide/README.md) · [Deployment](DEPLOYMENT.md)

## What is in the box

| Part | Where | What it is |
| --- | --- | --- |
| Listener app | `frontend/` | A static single-page app (Vite, React 19, Tailwind, zustand). Every page is a lazy chunk; a service worker keeps the shell and saved audio available offline. |
| Android wrapper | `frontend/native-android/`, `frontend/scripts/patch-android.js` | The same bundle in a generated Capacitor project, with a native media service, widgets, downloads and in-app updates. |
| Worker | `backend/worker/` | `vinax-api`: `/api/*`, edge-rendered song, album, artist and playlist pages, sitemaps, the image proxy and the Android package download. Anything it does not match goes to the static site. |
| Owner console | `frontend/public/admin/` | A separate static page for the owner: monitoring, feature flags, Home layout, trend review. Sign-in is checked by the Worker. |

## What a listener can do

- **Press play without an account.** Pick a name and languages; there is nothing to pay and no email or password. The website shows one labelled ad at the end of song, artist, album, language and mood pages, and nowhere else.
- **Find music.** Home, Discover, Search, Library and VinaX AI are the five destinations. Search suggests as you type and leads its results with a Top result; Discover has charts, languages, moods, regions and films.
- **Let the queue build itself.** Tap a song and the next five follow from it, led by that song's language. AI Radio plays endlessly from a song, an artist, a mood or a few words. Pin a mood or Tune this queue rebuilds Up Next at once. Familiar, Balanced and Discover change how adventurous the picks are.
- **Use a full player.** Reorderable queue, synced lyrics where available, sleep timer, crossfade, sound settings, lock-screen and headset controls, casting, drive mode and karaoke. Flow is a full-screen feed of song previews.
- **Keep a library.** Favourites, playlists, Listen Later, smart collections, history, listening stats, and one-file backup with preview, merge or replace, and Undo.
- **Listen Together.** A room with a code, a QR and an invite link; the session follows the listener across the app and guests stay in time with the host.
- **Choose an app style.** Settings → Appearance → App style offers six complete looks — Aura (the default), Pulse, Sangam, Nocturne, Marquee and Vibe. A style changes colours, type, shapes, the navigation and mini-player layout, cards and motion; it never changes music, library, queue or settings. Each has a dark, a light and a true-black look, and works with every accent.
- **See festival themes.** On a festival's days the app wears that festival's colours, a ribbon, an emblem and a quiet backdrop over whichever style is chosen, and offers a greeting card once. Any of the 43 skins can be previewed from Settings → Appearance.
- **Talk to VinaX AI.** A chat that knows the listener's taste summary, can play music from the conversation, accepts attachments and offers a choice of models. The chat restyles itself to match the family of the selected model — nine original chat styles — or stays on one style the listener picks.
- **Stay comfortable.** Keyboard shortcuts, reduced motion, high contrast, display size, Kid mode, app language, guided tours.

Music and AI results depend on the catalogue and the AI providers configured for the deployment. When AI is slow, down or not configured, features that use it fall back to an on-device path.

## Quick start

You need Node.js 22 or newer and npm. Start the Worker first, then the app.

```sh
# Terminal 1 — the Worker on port 8787
cd backend
npm ci
npm run dev
```

```sh
# Terminal 2 — the app on port 5173
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api`, `/img` and `/apk` to port 8787. Secrets are optional for a first run: without them the catalogue works, AI routes answer "not configured", and the owner console cannot sign in. Local secrets go in `backend/worker/.dev.vars`; the names are listed in `backend/.env.example`.

Verify a change with the same commands CI runs:

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e          # needs the build above and a test browser
```

```sh
cd backend
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/wrangler-dry
```

`npm run build` deletes `dist/` and the build caches first, so stop a dev server that shares the folder or build in a worktree. [docs/testing.md](docs/testing.md) explains the browser suite, the fixtures and the worktree recipe.

## Repository layout

```text
frontend/
  index.html                    shell markup and the pre-paint script (theme, app style, festival)
  src/main.tsx                  boot: migrations, global styles, render, service worker
  src/router/                   routes; every page is a lazy chunk
  src/layouts/AppLayout.tsx     the frame: sidebar, top bar, dock, player, overlays; applies the look
  src/pages/  src/components/   routed pages and shared UI
  src/features/                 feature folders (home, settings, ai, together, tutorials, festival, …)
  src/store/                    zustand stores (player, settings, library, history, …)
  src/services/                 recommendation, personalization, api, ai, audio, media-session, storage
  src/constants/                app styles, festivals, version, the What's New card
  src/styles/                   tokens (index.css), frame (shell.css), templates/, festivals.css, pages/
  public/sw.js  public/admin/   service worker; owner console
  native-android/  scripts/  e2e/
backend/
  worker/index.ts               router
  worker/functions/api/         public, AI, cron and admin endpoints
  worker/functions/_lib/        AI lanes, admin auth, catalogue, rate limits, push
  worker/wrangler.toml          Worker name, routes, vars, bindings, cron triggers
docs/                           current documentation; docs/history/ holds dated records
.github/workflows/              CI, browser suite, Worker deploy, Android builds, scheduled jobs
```

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/README.md](docs/README.md) | The full index |
| [docs/architecture.md](docs/architecture.md) | The pieces and how data flows, including the look pipeline |
| [docs/design-system.md](docs/design-system.md) | Tokens, app styles, themes, accents, festival skins, chat styles, shared components |
| [docs/recommendations.md](docs/recommendations.md) | How the next song is chosen |
| [docs/ai.md](docs/ai.md) | AI lanes, failover, route contracts |
| [docs/data-and-privacy.md](docs/data-and-privacy.md) | What is stored where and what leaves the device |
| [docs/testing.md](docs/testing.md) | Gates, contract tests, the browser suite, the bundle budget |
| [docs/android.md](docs/android.md) | The Android project and what needs a device |
| [DEPLOYMENT.md](DEPLOYMENT.md), [docs/operations.md](docs/operations.md) | Deploying, secrets, scheduled jobs, runbooks |
| [docs/admin-console.md](docs/admin-console.md) | The owner console |
| [docs/user-guide/README.md](docs/user-guide/README.md) | The guide for listeners |
| [frontend/README.md](frontend/README.md), [backend/README.md](backend/README.md) | Per-package notes |

## How releases work

1. Work on a branch. A release changes these together: `version` in `frontend/package.json` (and the root entry of its `package-lock.json`), `version` in `backend/package.json` when the Worker changed, `LATEST_VERSION` and `DISPLAY_VERSION` in `frontend/src/constants/version.ts`, and a new What's New card at the top of `frontend/src/constants/changelog.ts`.
2. Open a pull request. `ci.yml` runs lint, typecheck, unit tests, the build and the bundle budget for the frontend, and lint, typecheck, tests and a Worker dry-run for the backend. `e2e.yml` builds the app and runs the browser suite.
3. Merge to `main`. The static host builds `frontend/` and publishes the site. When `backend/**` changed, the Deploy Worker workflow deploys the Worker. Another workflow builds the Android package.
4. Verify production. The two halves deploy separately and either can fail alone; a merged commit is not proof of a deploy. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Contributing rules that are enforced

| Rule | Enforced by |
| --- | --- |
| No lint warnings, no type errors | `npm run lint` (`--max-warnings 0`) and `npm run typecheck` in both packages, in CI |
| Tests pass | `npm test` in both packages; `npm run e2e` in its own workflow |
| First-load JavaScript stays under 188 KB gzipped (80 KB per first-load chunk, 160 KB per on-demand chunk) | `node scripts/check-bundle-size.mjs` in CI |
| Inline scripts in `index.html` match the content-security policy | `frontend/src/__tests__/cspHashes.test.ts`; after changing an inline script, build and run `node scripts/csp-hashes.mjs` |
| Every app style keeps its contract (contrast, festival stand-down, pre-paint canvas, no other product's name) | `frontend/src/constants/templates.test.ts` |
| Every Worker handler is routed | `backend/worker/__tests__/routerCoverage.test.ts` |
| No third-party product or company names in interface text, comments, tests or documents | Review; the style and chat-style tests check their own lists. The documentation conventions in [docs/README.md](docs/README.md) state the exceptions |

Do not commit secrets, generated build folders or personal exports.

## Privacy and legal

There is no account. Library, history, settings, the taste profile and AI chats stay on the device; searching and AI features send only what [docs/data-and-privacy.md](docs/data-and-privacy.md) lists, and usage statistics are sent only when the listener opts in. The repository carries no licence file; the legal position on content, takedowns and listener data is in [docs/legal-copyright.md](docs/legal-copyright.md).
