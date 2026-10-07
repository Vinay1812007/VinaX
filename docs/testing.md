# Testing

This document covers how VinaX is tested: the gates CI runs, unit tests in both packages, the contract tests that lock the app-style, chat-style, festival and content-security rules, the browser end-to-end suite and how its harness serves the built app, the shapes test fixtures must use, the bundle budget and the `core` chunk group, and a recipe for verifying one commit in a throw-away git worktree.

## The gates

CI (`.github/workflows/ci.yml`) runs these on every pull request and on every push to `main`. Run them locally in the same order.

```sh
cd frontend
npm ci
npm run lint            # eslint src scripts --max-warnings 0
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run build           # clean, tsc, vite build, prerender, changelog.json
node scripts/check-bundle-size.mjs
```

```sh
cd backend
npm ci
npm run lint            # eslint worker --max-warnings 0
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/wrangler-dry
```

`npm run build` starts by deleting `dist/` and the build caches of the folder it runs in; do not run it in a checkout whose dev server someone else is using — use the worktree recipe below.

The browser suite has its own workflow (`.github/workflows/e2e.yml`): install the test browser, `npm run build`, `npm run e2e`. A separate workflow runs accessibility and search-engine checks against the prerendered routes on pushes to `main` (`lighthouse.yml`); its performance scores are advisory.

## Unit tests

Both packages use `vitest`.

- **Frontend.** Tests sit next to the code as `*.test.ts(x)`, with cross-cutting ones in `src/__tests__/`. The default environment is Node. A file that needs a DOM starts with `// @vitest-environment jsdom`. `vite.config.ts` excludes `e2e/`, `dist/` and `android/` from collection.
- **Backend.** Handler tests sit next to handlers (`functions/api/*.test.ts`), with wider ones in `worker/__tests__/`. Notable guards: `routerCoverage.test.ts` fails when a handler file is not routed in `worker/index.ts`; `chaos-failover.test.ts` drives the real chat handler with sabotaged upstreams (see [operations.md](operations.md#failover-tests)).

`frontend/src/__fixtures__/songs.ts` holds deterministic fixtures (`makeSong` and friends) for recommendation, player and Home tests. They use no randomness and no clock; a test that needs "now" passes its own timestamp.

## Contract tests

Some tests lock a rule rather than a behaviour. They read source files and stylesheets, so they fail on the change that breaks the rule, not later in a browser.

| Test | What each block guards |
| --- | --- |
| `frontend/src/constants/templates.test.ts` | **The list:** six app styles with unique ids and names, the default among them; unknown ids fall back to the default; no entry names another product. **Per style:** its file is imported by `templates/index.css` and styles only its own selector; its colour blocks stand down while a festival skin is on; its accent applies only while the listener has not chosen one; the canvas stamped before first paint equals its `--ink-900`. **Styles × accents:** every accent block is found and contrast-checked in every style and both themes. **The shared layer:** Black stays true black and high contrast stays above every style; the page entrance has a reduced-motion answer; the pre-paint script defaults to the same style as the app. |
| `frontend/src/utils/theme.test.ts`, `src/__tests__/contrast.test.ts` | `theme.test.ts`: the colour tokens (brand ramps, one radius scale of 10/14/20px, the adjustable glass alpha and blur dials, hero gradient following the accent, hairline borders and lyric tokens in both themes); theme resolution (`system` follows the OS scheme, `auto` is light 07:00–18:59); `applyThemeClasses` stamps the app style and its canvas and keeps a style the caller did not name; primary text on canvas at 7:1 or better. `contrast.test.ts`: the documented token pairs meet WCAG AA |
| `frontend/src/features/settings/TemplatePicker.test.tsx` | The picker offers the six styles as one radio group with the chosen one checked; click chooses; arrow keys move the choice and wrap; picking the chosen style again does nothing; the change cross-fades through a view transition where one exists and skips it under reduced motion; the detail line says what the style changes |
| `frontend/src/features/ai/chat/chatStyle.test.ts` | Real model slugs from every provider file under their maker family, with a per-provider fallback for unknown makers; Auto maps to the house style and a model to its maker's; the stored preference parses and anything unknown means Auto; every style has a table row and CSS blocks for the chat surface and its sheets; every style has a complete layout, every layout value a CSS rule, and no two model styles share every structural fact |
| `frontend/src/constants/festivals.test.ts`, `festivalVisuals.test.ts`, `src/components/FestiveSplash.test.tsx`, `src/features/home/festivalLookahead.test.ts`, `src/services/recommendation/festival.test.ts` | `festivals.test.ts`: unique ids, a theme for every festival, sane windows, a distinct look from each neighbour, light-mode accent steps readable on white, calendar resolution, and the generated artefacts (`styles/festivals.css`, the `index.html` pre-paint window table, `public/admin/festivals.js`) in sync with the data. `festivalVisuals.test.ts`: every festival has a theme, a drawn emblem, a blurb and a songs query; every emblem in the library is used and drawn with the five shared classes only; no remote URL in festival data or generated CSS; light accent steps at 4.5:1 on their own canvas; particles capped at 14 on phones and 24 on desktop. `FestiveSplash.test.tsx`: the national-day backdrops (the flag's nine strips and 24-spoke chakra, balls on one day only, the emblem watermark elsewhere) and that the greeting card waits a beat after boot, never opens over another dialog, steps back if one opens later, and opens immediately for a preview from Settings. Plus the look-ahead on Home and the festival signal in recommendations |
| `frontend/src/features/tutorials/tutorials.test.ts`, `src/components/TutorialRunner.test.tsx`, `src/components/OnboardingSheet.test.tsx` | `tutorials.test.ts`: the tour list covers the 11.0 additions and keeps the older tours, and every `data-tour` id, aria-label, id and class a tour points at exists in the source. `TutorialRunner.test.tsx`: the tour runner. `OnboardingSheet.test.tsx`: the welcome walks name → languages → look → slides, the look step persists the app style, Escape closes an optional step, and a replay starts at the look step |
| `frontend/src/__tests__/cspHashes.test.ts` | The inline-script hashes in `public/_headers` match `index.html`. After changing an inline script (the app-style canvas table and the festival window table are inside one), build and run `node scripts/csp-hashes.mjs` |
| `frontend/src/__tests__/swShell.test.ts`, `sessionInsights.test.ts` | The service-worker shell list; consent gating |
| `backend/worker/__tests__/routerCoverage.test.ts` | Every handler file is routed in `worker/index.ts` |
| `backend/worker/__tests__/aiChatAudit.test.ts`, `aiAuditSweep.test.ts` | `aiChatAudit.test.ts` (mocked upstreams): Auto answers on an OpenRouter-only setup and falls back to the OpenRouter lane when every NVIDIA engine fails; an image is read by Gemini when it is the only key; a single-image vision seat gets only the newest image and a multi-image turn goes to a multi-image engine first; `chat_template_kwargs` travels to the NVIDIA endpoint only; every engine rate-limited answers 429 with `Retry-After` while other failures keep the 500; the default speech request uses another provider without the Groq key; a 400 drops the usage option for that attempt only; long threads are trimmed to budget keeping the latest user turn whole; unclosed reasoning is never shown as the answer; reading stops when the listener disconnects. `aiAuditSweep.test.ts`: the reasoning switch is sent on the NVIDIA base only (not OpenRouter or Groq); every AI route surfaces an upstream 429 as 429 and keeps its 500 envelope otherwise; `/api/dj` still answers `503 ai_not_configured` with no key |

Run one file with `npx vitest run <path>` from the package folder.

## Browser end-to-end tests

`npm run e2e` does two things:

1. `node scripts/e2e-smoke.mjs` checks that no built `/assets/*.js` file is secretly HTML, then boots the built app in a real browser with every external request aborted and confirms the app mounts and client-side navigation works.
2. `vitest run --config e2e/vitest.config.ts` runs the specs in `frontend/e2e/`.

### How the harness works

- The specs are written against the usual browser-test API, but that runner is not a dependency. `e2e/vitest.config.ts` aliases its module name to `e2e/support/playwright-test.ts`, a small shim over `vitest` and `playwright-core`. It provides `test`, `test.describe`, `beforeEach`/`afterEach`, `test.use`, the `page`, `context`, `browser` and `baseURL` fixtures, and retrying locator matchers such as `toBeVisible`, `toHaveText` and `toHaveCount` (5-second default). Only that subset exists.
- `e2e/support/global-setup.ts` serves **`frontend/dist/`** on a random localhost port: static files, directory indexes (so `/admin/` works), a fallback to `index.html` for unknown routes, and a plain 404 for a missing `/assets/` file. It throws if `dist/index.html` is missing, so **build first**.
- One browser instance per spec file, a fresh context per test. Specs abort every request that is not to localhost and answer `/api/**` themselves with `page.route`. A red run means the app broke, not the network.
- Three files are excluded from the run: `smoke.spec.ts` (replaced by the smoke script), `a11y.spec.ts` (needs a package that is not installed) and `qa-sweep.spec.ts` (an on-demand harness).

### Feature specs

| Spec | What it proves | How |
| --- | --- | --- |
| `e2e/v100-together.spec.ts` | Listen Together across the app: a guest follows the host while both move to other pages, stays within the sync threshold, and a guest's request reaches the host as a **playable** song; a host who reloads the tab is still hosting | Two browser contexts (host and guest) talk through an in-memory stand-in for `/api/room` that keeps the server's contract (a `now` clock in every poll, guest requests as id/title stubs). The audio is a generated four-minute silent WAV served with byte ranges, so the guest can really seek. A spec clicks **Tap to start listening** when the browser asks for a gesture |
| `e2e/v101-search.spec.ts` | The typeahead opens as you type with completions (typed part in bold) and song, artist and album hits, and is a real combobox (↑/↓ move the active option, Enter picks, Escape closes); the results lead with the **Top result** card and its play button plays; **allotment**: when the first catalogue endpoint stalls, an interactive search is hedged to the next and answers long before the stall ends | Two catalogue hosts are mocked with route handlers (the primary remote catalogue and the same-origin one); everything else off localhost is aborted |
| `e2e/festivals.spec.ts` | A forced festival skins the app in both the dark and the light theme: the `fest-<id>` class is on `<html>`, the accent ramp changes, and the festival sky, card, title and watermark render | Seeds the stored settings (`vinax.settings.v1` with the theme, onboarding done), answers the app-config festival request with `{ mode: 'force', id }` as the owner console would, stubs the rest of `/api/**`, and reads the root classes, the accent token and the festival elements |
| `e2e/v101-flow.spec.ts` | Flow previews the card on screen, moves on to the next card, likes on a double tap and gives the queue back when it closes | Stubs `/api/cat` for the feed, seeds the stored settings, moves with `ArrowDown`, double-clicks the card, and compares the player queue before and after |

Unit tests that pin the same features: `services/api/allotment.test.ts` (ranking, hedge and abort, Retry-After, weighted spreading, the concurrency cap, de-duplication), `features/together/sync.test.ts` and `engine.test.ts`, `services/together/session.test.ts`, `features/ai/chat/Connectors.test.tsx`, `store/toastStore.test.ts` and `components/Toasts.test.tsx` (snackbars, keyed replacement), `__tests__/glass.test.ts` (the materials keep AA over any cover), and in the backend `__tests__/roomSync.test.ts`.

The guided tours (`features/tutorials/tutorials.ts`) have unit tests but no browser spec. After changing a tour, build, serve `dist/` (`npx vite preview`) and walk each tour in a real browser at a phone and a desktop size: every step with a `target` must spotlight a visible element, and its card must sit fully on screen. A target near the top of the screen needs `placement: 'bottom'`; a target further down a long page needs the step's `reveal` action, because the runner only accepts a match that is already in view.

The test browser comes from `npx playwright-core install chromium`. To use an installed binary, set `E2E_CHROMIUM_PATH`. `E2E_PRINT_REQUESTS=1` makes `e2e/home-requests.spec.ts` print how many requests each endpoint received while Home loads:

```sh
cd frontend
npx vitest run --config e2e/vitest.config.ts e2e/home-requests.spec.ts
```

### Fixture shapes

Two shapes exist for a song, and mixing them up produces tests that pass for the wrong reason or crash on rehydrate.

| Where the data comes from | Artists look like | Used when |
| --- | --- | --- |
| A mocked catalogue response (`/api/cat/**`) | `artists: { primary: [{ id, name }] }` | The app will normalise it (`services/api/normalize.ts`) |
| Anything seeded into `localStorage` (player queue, favourites, history) | `artists: [{ id, name }]` | The app reads it as its own `Song` type |

`e2e/v701.spec.ts` shows the pattern: build the pool in the API shape, then derive the stored copy with `artists: s.artists.primary` before writing `vinax.player.v1`, `vinax.library.v1` and `vinax.history.v1`. Persisted records use the persist envelope `{ state, version }`. Seed `vinax.onboarded.v1`, a name, and `vinax.last-seen-version` as well, or the welcome sheet and the What's New sheet cover the page under test.

Specs that quote interface copy (tour titles, help headings, button names) must change in the same commit as the copy.

The browser suite proves the built frontend against mocked APIs. It does not prove the live catalogue, AI lanes, credentials, Android playback or release signing.

## The bundle budget

`node scripts/check-bundle-size.mjs` reads `dist/index.html`, takes every `/assets/*.js` it references (the entry plus preloaded chunks) and sums their gzipped sizes.

| Limit | Value |
| --- | --- |
| First-load JavaScript, total | under 188 KB gzipped |
| Any single first-load chunk | under 80 KB gzipped |
| Any on-demand chunk | under 160 KB gzipped |

Diagram and maths engines that load only when VinaX AI renders them are exempt from the on-demand limit, but not if they ever land in the first load. A value equal to a limit fails.

The header of the script is the ledger. Every time the first-load limit moved, the entry records the date, the measured sizes, why the new code cannot be lazy and what was tried first. If a change grows the first load, measure it, try to make it lazy, and if the limit still has to move, add an entry in the same style. Do not raise the number without one.

### The `core` chunk group

`vite.config.ts` defines chunk groups: `router`, `vendor`, `data`, and `core`. `core` merges small app modules that are all already in the first-load graph; each used to ship as its own preloaded chunk and paid a module wrapper and a gzip header apiece. Its `test` pattern lists modules by explicit path. It never matches a folder, because a pattern wide enough to catch a module that only lazy code uses would drag that module into the first load. Before adding a path to `core`, confirm the module is imported by first-load code, then rebuild and run the budget script.

## Verify a commit in a throw-away worktree

Use this when the working tree has other people's uncommitted edits, or when a result has to be tied to one exact commit. A worktree is a second checkout of the same repository in another folder; nothing in the main checkout is touched.

```sh
# from the repository root
git worktree add /tmp/vinax-verify <commit-or-branch>

cd /tmp/vinax-verify/frontend
npm ci
npm run lint && npm run typecheck && npm test
npm run build && node scripts/check-bundle-size.mjs
npm run e2e

cd ../backend
npm ci
npm run lint && npm run typecheck && npm test

# when finished
cd -
git worktree remove --force /tmp/vinax-verify
```

Notes:

- `npm ci` is needed in the worktree; `node_modules` is not shared between checkouts.
- The frontend build starts by deleting `dist/` and the build caches of the folder it runs in (`prebuild:clean`), so building in a worktree cannot disturb a dev server or a `dist/` in the main checkout.
- Record the commit hash with the result. "Passes on my tree" and "passes at commit X" are different claims.

## What tests cannot tell you

| Question | How to answer it |
| --- | --- |
| Is the live catalogue or an AI lane up? | The status page, and the owner console's monitoring panels ([admin-console.md](admin-console.md)) |
| Did the deploy land? | `/api/status`, the served `/changelog.json`, and a route the change added ([operations.md](operations.md)). `/api/version` reports the Android release, not the Worker build |
| Do lock-screen controls, downloads and updates work on a phone? | A device run of [qa-device-script.md](qa-device-script.md); see [android.md](android.md) |
