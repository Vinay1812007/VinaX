# Testing

This document covers how VinaX is tested: unit tests in both packages, the browser end-to-end suite and how its harness serves the built app, the shapes test fixtures must use, the bundle budget and the `core` chunk group, and a recipe for verifying one commit in a throw-away git worktree when other people are editing the same checkout. Every command here exists in `frontend/package.json`, `backend/package.json`, `frontend/scripts/` or `.github/workflows/`.

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

The browser suite has its own workflow (`.github/workflows/e2e.yml`): install the test browser, `npm run build`, `npm run e2e`. A separate workflow runs accessibility and search-engine checks against the prerendered routes on pushes to `main` (`lighthouse.yml`); its performance scores are advisory.

## Unit tests

Both packages use `vitest`.

- **Frontend.** Tests sit next to the code as `*.test.ts(x)`, with cross-cutting ones in `src/__tests__/`. The default environment is Node. A file that needs a DOM starts with `// @vitest-environment jsdom`. `vite.config.ts` excludes `e2e/`, `dist/` and `android/` from collection.
- **Backend.** Handler tests sit next to handlers (`functions/api/*.test.ts`), with wider ones in `worker/__tests__/`. Notable guards: `routerCoverage.test.ts` fails when a handler file is not routed in `worker/index.ts`; `chaos-failover.test.ts` drives the real chat handler with sabotaged upstreams (see [operations.md](operations.md#failover-tests)).

`frontend/src/__fixtures__/songs.ts` holds deterministic fixtures (`makeSong` and friends) for recommendation, player and Home tests. They use no randomness and no clock; a test that needs "now" passes its own timestamp.

Some tests lock rules rather than behaviour: `cspHashes.test.ts` (inline-script hashes in `public/_headers`), `contrast.test.ts` (token contrast), `swShell.test.ts` (service-worker shell list), `sessionInsights.test.ts` (consent gating).

## Browser end-to-end tests

`npm run e2e` does two things:

1. `node scripts/e2e-smoke.mjs` checks that no built `/assets/*.js` file is secretly HTML, then boots the built app in a real browser with every external request aborted and confirms the app mounts and client-side navigation works.
2. `vitest run --config e2e/vitest.config.ts` runs the specs in `frontend/e2e/`.

### How the harness works

- The specs are written against the usual browser-test API, but that runner is not a dependency. `e2e/vitest.config.ts` aliases its module name to `e2e/support/playwright-test.ts`, a small shim over `vitest` and `playwright-core`. It provides `test`, `test.describe`, `beforeEach`/`afterEach`, `test.use`, the `page`, `context`, `browser` and `baseURL` fixtures, and retrying locator matchers such as `toBeVisible`, `toHaveText` and `toHaveCount` (5-second default). Only that subset exists.
- `e2e/support/global-setup.ts` serves **`frontend/dist/`** on a random localhost port: static files, directory indexes (so `/admin/` works), a fallback to `index.html` for unknown routes, and a plain 404 for a missing `/assets/` file. It throws if `dist/index.html` is missing, so **build first**.
- One browser instance per spec file, a fresh context per test. Specs abort every request that is not to localhost and answer `/api/**` themselves with `page.route`. A red run means the app broke, not the network.
- Three files are excluded from the run: `smoke.spec.ts` (replaced by the smoke script), `a11y.spec.ts` (needs a package that is not installed) and `qa-sweep.spec.ts` (an on-demand harness).

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
| Did the deploy land? | `GET /api/version` and the served `changelog.json` ([operations.md](operations.md)) |
| Do lock-screen controls, downloads and updates work on a phone? | A device run of [qa-device-script.md](qa-device-script.md); see [android.md](android.md) |
