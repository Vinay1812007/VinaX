# VinaX 6.1 — reliability, data safety, Home performance and Library tools

This release was built in three verified phases against `main` at 97e44c9 (VinaX 6.0.0 / API 5.7.0). Every review finding below was checked against the code before it was changed; none were already fixed.

## Phase 1 — reliability and data safety

### 1. Android download link loop (fixed)
`backend/worker/functions/_middleware.ts` redirected every request on the `update.` host to `/api/apk` on the same origin — including `/api/apk` itself — so browsers saw an endless redirect. The download routes (`/api/apk`, `/apk`) now pass through to their handler; everything else on the host still bounces. Regression: `backend/worker/__tests__/hostRouting.test.ts` drives the middleware and the full Worker entry point and proves the chain ends in one hop.

### 2. Backups (rewritten)
The old export dumped every storage key — including the service-issued device token, Listen Together host keys and Android download paths — and imported anything back unvalidated, silently, with no rollback. It also missed bookmarks, saved searches, the Home layout and several preferences.

`frontend/src/features/settings/backup.ts` defines the **`vinax-backup` schema 2**: eleven documented categories (settings, library, smart collections, history, taste profile, searches, bookmarks, Home layout, name & username, alarm/lyrics/streak/app preferences, AI chats), each with a validator/sanitiser, a human summary and (where it makes sense) a merge rule. Excluded on purpose, with reasons shown in the app: downloaded audio and paths, device identity and token, host keys, usage-sharing consent, queue/position/caches, update reminders.

- Legacy exports (`app: "vinax"` / `"tarang"`) are migrated on read; their device-bound keys are dropped with a warning.
- Nested values are validated before anything is written; junk songs are dropped individually, a malformed category is rejected with a reason.
- Writes go through `writeLocalBatch` (`services/storage/local.ts`): all-or-nothing with rollback, and quota/unavailable errors are **reported**, never shown as success.
- The username in a backup is restored as a *pending claim* and re-confirmed with the service (see 5).
- **Move to a new device** (QR handoff) uses a separate transfer payload that deliberately carries the device token and confirmed username.

Tests: `features/settings/backup.test.ts` (round trip, legacy migration, malformed input leaves data intact, quota rollback, merge, handoff).

### 3. Song matching (fixed)
`SongPick.tsx` normalised titles by deleting everything outside `a-z0-9`, so Telugu/Hindi titles became empty (matching anything) and then fell back to the first search result unconditionally. `components/ai/songMatch.ts` keeps Unicode letters, digits and combining marks (only Latin diacritics are stripped), scores title and artist separately, rejects empty normalised titles, and returns `matched` / `uncertain` / `missing` with ranked alternatives. Chips show "closest match" or "not found" explicitly; `fetchPick` only ever returns a confirmed match. The AI song card is now two sibling buttons (no button nested inside a `role="button"`), so Enter and Space both work.

### 4. Import cancellation (fixed)
Cancel, backdrop tap, Android back, navigation and unmount abort the in-flight lookups and invalidate the run; a late result can no longer create a collection or replace the queue. Inputs are labelled and progress is announced (`role="status"`). Tests: `components/ImportPlaylistSheet.test.tsx`.

### 5. Username claims and device identity (fixed)
- **Client**: a failed claim used to be saved as confirmed. `features/identity/handleClaim.ts` keeps it **pending** (offline / server error) or **taken** (409), retries on reconnect and at boot, and Settings → Your Data shows the true status with a "Confirm now" button.
- **Server**: `_lib/identity.ts` resolves identity as signed id → HMAC of the client's install uuid → fresh random id. The ip+user-agent derivation is kept only as a legacy fallback for telemetry from pre-uuid builds, and `/api/username` never uses it. A claim can no longer overwrite a row that carries a handle the client does not own (a fresh identity is minted instead); the store being unreachable is a 503, not a silent success. Existing signed ids — including legacy `s_` ids — keep verifying. Tests: `backend/worker/__tests__/username.test.ts` (two clients sharing ip + UA, install-id isolation, re-claim/rename with a token, legacy shared token split, store outage).

## Phase 2 — performance and consistency

### 6. Home request load (measured)
Every Home block is now a component that owns its queries; blocks beyond the first two mount only when scrolled near, and hidden blocks never mount. Measured with `e2e/home-requests.spec.ts` (built bundle, mocked-empty catalogue, two pinned languages, 30 plays):

| Scenario | HEAD 97e44c9 | 6.1 |
| --- | --- | --- |
| First paint, unscrolled — logical searches (HTTP calls) | 45 (226) | 18–21 (124) |
| After scrolling to the bottom | 46 | 46 |
| Owner hid 6 shelves, scrolled to bottom | 46 (hidden shelves still fetched) | 22, no mood/artist/album/discovery queries |

HTTP counts include the API client's fallback ladder (several paths per logical search when a provider answers an unsupported shape). Query de-duplication is preserved; cross-shelf de-duplication moved to a shared ledger (`features/home/shelfLedger.ts`). Pull-to-refresh and "Refresh discovery" invalidate the same keys; unmounted blocks fetch fresh data when they mount.

### 7. Home layout precedence (fixed)
`features/home/homeLayout.ts`: listener order and headline win when a Home Studio layout exists, otherwise the owner's published layout, otherwise the default (experiment-aware). Hidden shelves are the **union** of owner and listener choices, so an owner disable is enforced even over an older local layout and cannot be re-enabled (locked in Home Studio). The owner console's Home Layout Studio now has a visibility checkbox per shelf and publishes `hidden` (it always sent `[]` before). Tests cover local overrides, missing configuration and newly published owner settings.

### 8. Listening statistics (unified)
`features/stats/listening.ts` is the single rule for Home, Stats, weekly report, calendar, daily goal ring and the AI daily brief. New plays carry a **measured** `listenedSec` from `services/analytics/listenClock.ts` (pauses and seeks excluded, replays counted, flushed every 30 s and on pause/song change/hide). Older plays are estimated (full track if completed, a third otherwise, 30 s floor; unknown length 180 s / 45 s) and shown with ≈. Weekly and 12-week views say when the 150-play cap cuts the window short. Nothing is back-filled.

### 9. Accessibility
Labelled inputs and announced progress in the import sheet; sibling controls and native buttons in AI song cards; 36–44 px touch targets on new controls; focus restoration through the shared focus trap; no new motion. Screens were captured at 390 px (light, AMOLED) and 1440 px (dark) — see `frontend/test-results/v61-*.png` after running the browser suite.

## Phase 3 — features

10. **Import review** — every line is shown as Matched / Closest match / Not found before saving; swap alternatives, retry with an edited line, skip, or view the original text; save commits only the chosen songs.
11. **Backup Center** (Settings → Your Data) — live category summaries, exclusions with reasons, last export/restore, file preview against the device, Merge or Replace with duplicate handling explained, a safety copy, and Undo that survives the reload (kept in the tab).
12. **Collection management** — in-playlist search, multi-select with copy / move / remove, Undo for removals and moves; sorting, tags, dedupe and stored order respected.
13. **Smart collections** — versioned rule definitions (language, artist, length, favourites, played-within, never played, year, text) evaluated live over the local library with a preview; stored under `vinax.smart-collections.v1`, migrated/sanitised on load and included in backups.

## Verification (run on 2026-09-16)

- Frontend: `npm run lint` ✓, `npm run typecheck` ✓, `npm test` ✓ (89 files, 565 tests; baseline was 79/486), `npm run build` ✓.
- `node scripts/check-bundle-size.mjs`: **FAIL — pre-existing.** The untouched HEAD builds to 179.6 KB gz against the 170 KB budget (measured in a clean worktree); 6.1 is 181.7 KB. See "Limitations".
- Backend: `npm run lint` ✓, `npm run typecheck` ✓, `npm test` ✓ (28 files, 201 tests; baseline 26/187), `wrangler deploy --dry-run` ✓.
- Browser (mocked APIs, real Chromium 1140, `npm run e2e`): **34 tests in 8 files pass** — the existing six suites (AI, admin console, v5.17 features, studio, discovery workspace, festivals) plus `e2e/home-requests.spec.ts` (2) and `e2e/v61-features.spec.ts` (15: collections, smart collections, import review, Backup Center merge + undo, Stats labels, at 390 px light, 1440 px dark and 390 px AMOLED). Screenshots land in `frontend/test-results/v61-*.png`.

Browser tests mock every `/api` call; they do not prove live catalogue behaviour, the production Supabase store, or native Android (the listen clock, downloads and the APK route were not exercised on a device).

## Limitations and follow-ups

- **Bundle budget** is red on `main` before and after this change. Re-basing the budget needs the dated justification the script's history uses; that is a release decision, not made here.
- Songs already merged under one legacy ip+ua device id cannot be split retroactively; new issuance never merges.
- Smart collections only see metadata the library already holds (language/year can be missing on some catalogue songs).
- The Backup Center's Undo lives in `sessionStorage` for the tab; very large libraries may exceed it, in which case the app says so and the downloaded safety copy is the fallback.
- Measured listening starts with 6.1; earlier plays remain estimates forever.

## Migration and configuration

- No database migration. `vinax_users` rows keyed by legacy `s_` ids stay valid; new rows use `c_`/`r_` ids.
- No new secrets. `DEVICE_ID_SECRET` (falling back to `TELEMETRY_PEPPER`) still signs device ids.
- Client storage: `vinax.user-handle-pending.v1`, `vinax.smart-collections.v1`, `vinax.backup.meta.v1` are new keys; `listenedSec` is an optional field on history entries. Old exports import through the migration path.
- Owner console: republish the Home layout once to take advantage of per-shelf visibility (older published layouts continue to work with `hidden: []`).
- Not deployed: no build was published and no release was tagged as part of this work.
