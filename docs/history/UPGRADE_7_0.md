# VinaX 7.0 — smarter, safer, steadier

Builds on 6.5.2 (API 5.12.1). App **7.0.0**, API **5.13.0**. Nothing was removed: every 6.x feature, setting, route and stored key still works, and persisted data is migrated in place.

The work was done audit-first. Six read-only audits (recommendation and player core, Worker security, storage and backup, audio engine and Android, search, UI/accessibility/performance) produced a list of **confirmed** defects — each traced through the real code path, several reproduced in a throw-away test — and only then were fixes written, each with a regression test. This document lists what changed, why, how to verify it, and what is still open.

---

## 1. Architecture changes

| Area | Before | 7.0 |
|---|---|---|
| Next-song engine | One long function: gather → enrich → filter → rank → sequence → optional DJ. The DJ's order was only checked for arc tightness; the short-pool top-up ignored the language lock. | An explicit, traced **10-stage pipeline** (`services/recommendation/engine.ts`) with two new pure modules: `filters.ts` (hard rules, a named reason per rejection) and `validation.ts` (the final order re-checked, whoever produced it). |
| Short-term vs long-term | Session vector (mood/energy/language of the last plays) only. Skips were inferred from `completed: false`, which also matched the song playing right now and any paused song. | New **session intent** layer (`services/personalization/sessionIntent.ts`): skips, completions, likes, hand queue-adds and search plays of *this sitting*, reduced to bounded pulls. Lives in `sessionStorage`; never written to the taste profile. History entries carry an explicit `skipped` flag (`utils/plays.ts` → `isSkippedPlay`). |
| Discovery control | A boolean `exploreMode`; README and onboarding promised Familiar / Balanced / Discover, but no such mode existed. | `discoveryMode: 'familiar' \| 'balanced' \| 'discover'` (settings v4, migrated from `exploreMode`, kept in step with it). Changes candidates, scoring, the queue's discovery share and the language policy. |
| Song identity | `canonicalKey` stripped bracketed version tags; combining marks were stripped too, so different Indic titles could collide; the first version seen won. | NFKC + invisible-character folding, combining marks kept, dashed suffixes (“ - Lofi Flip”), `versionKind()`, and `dedupeByIdentity()` which keeps the **original** over a remaster over an alternate. Used by the pipeline, Home shelves and mixes. |
| Persistence | Every store wrote straight to `localStorage`; a full device threw inside `set()`; a restore could be overwritten by live stores before the reload; the player re-serialised the whole queue ~4×/s. | One guarded storage (`services/storage/local.ts`): `guardedLocalStorage` (never throws, one “storage is full” toast), `freezeLocalWrites()` after a restore, `createDedupedStorage()` for the player. |
| Player provenance | `autoIds` only. | `autoIds` + `manualIds`: hand-queued songs outrank automation everywhere. |
| UI primitives | Every sheet re-typed the same overlay markup. | Shared `components/Sheet.tsx` (seven sheets migrated), `utils/motion.ts`, `hooks/useMediaQuery.ts`, `components/VirtualChunks.tsx`, `utils/favIndex.ts`. |

---

## 2. Recommendation and next-song logic

### 2.1 The pipeline

`recommendNextSongs(seed, ctx, options)`:

| # | Stage | Module | Notes |
|---|---|---|---|
| 1 | Candidate generation | `candidates.ts` | Seed suggestions / artist / language, recent listens, favourites, favourite albums and artists, trending per language, rediscovery. **Familiar** adds favourites and finished songs (source `history`); **Discover** adds trending in unheard languages. |
| 2 | Hard filtering | `filters.ts` | `invalid`, `junk`, `too-short`, `explicit`, `blocked`, `muted-language`, `seed` (incl. another version of it), `already-queued`, `recently-played` (by id **and** canonical identity), `skipped-this-session`; then `dedupeByIdentity` → `duplicate-version`. Runs **before** enrichment, so the classifier only sees songs that can play. |
| 3 | Feature extraction | `services/ai/recommendations.ts` | Optional classifier metadata, 1.8 s bounded wait, 30-day cache. |
| 4 | Context scoring | `scoring.ts` | Unchanged terms, now computed against a per-pass `ScoringFrame` (seed profile, affinity maxima, played songs, known artists, recent artist counts) instead of once per candidate. |
| 5 | Diversity / repeat penalties | `reranking.ts`, `scoring.ts` | MMR re-rank; new **artist fatigue** (−0.04 per recent play of the same lead artist beyond two, capped at −0.16); recent-play demotion. |
| 6 | Session adjustment | `sessionIntent.ts` → `scoring.ts` | Artist pull ×0.18, language pull ×0.08 (bounded to ±0.6), energy steer ×0.30, skipped-this-sitting −0.40; ramped in over the first three events. A skip streak ≥ 2 also forces the `lift` arc. |
| 7 | Exploration tuning | `scoring.ts`, `engine.ts` | `lean = mode (−1/0/+1) + 0.6 × appetite`. Novelty swing `lean × (novelty − 0.5) × 0.16` where novelty = 0 (played song), 0.5 (known artist), 1 (never-played artist). Discovery share of the queue 5 % / 20 % / 45 %, ±15 % by appetite. Language policy: lock / lock / prefer. |
| 8 | Ranking | `scoring.ts` | Plus any “Tune this queue” nudge. |
| 9 | Sequencing | `sequencer.ts` | Energy arc, mood flow, transition memory; new **transition smoothness** (energy steps beyond 0.35 pay for the excess) and **featured-artist spacing**. |
| 9b | AI DJ (optional) | `services/ai/dj.ts` | May re-order the pool and propose catalogue-verified songs; the discovery gate is now literally the hard filter (`rejectReasonFor`). |
| 10 | Validation | `validation.ts` | Hard filter again; one song per identity; language lock (relaxed first toward languages the listener plays, and only when fewer than three songs would remain); artist cap ⌈limit/4⌉ (relaxed before shipping a short queue); no lead artist back to back, the seed counting as the previous song. Applied to the local order **and** to the DJ's. |

Balanced with a neutral sitting adds exactly 0 to every score, so existing listeners keep their ranking until they change the mode or their behaviour tips it.

### 2.2 Manual actions outrank automation (`store/playerStore.ts`)

- “Add to queue” inserts **ahead of the recommender's tail** (after the listener's list and earlier hand-queued songs); “Play next” marks the song manual.
- “Tune this queue” and the adaptive re-plan rebuild only the automatic tail; hand-queued songs stay, in order.
- A continuation that resolves after the listener started something else is dropped (queue versioning — already present, now tested).

### 2.3 Events and weighting

- A play counts toward taste after **5 s** of playback (or when a shorter song ends). Flipping through songs records session skips only.
- `SKIP_RETRACTS_PLAY`: a skip takes back the PLAY bump (a skipped song used to net **+0.25**).
- New `SEARCH_PLAY` (+1.5) and the `'signal'` affinity kind: likes, queue-adds and search plays move the score without inflating `plays`.
- `EVENT_WEIGHTS_VERSION` 1.1.0, `SCORING_WEIGHTS_VERSION` 1.2.0.

### 2.4 Home

- Shelves and mixes are de-duplicated by catalogue id **and** canonical identity (`features/home/dedupeShelves.ts`, `mixes.ts`).
- The profile stamp left the Home query keys: it changed on every play / skip / like, and each change blanked the shelves, re-ran the pipeline and spent a fresh AI shelf-design call while Home was merely open. The stamp is frozen per mount; key changes keep the previous shelves on screen.
- Queue Builder uses the same “discovery = never-played artist” definition and the same final validation.

### 2.5 Developer score breakdown

`?debug=recs` (or `localStorage['vinax.debug.recs'] = '1'`, or a dev build): per batch — mode, arc, language policy, discovery share, session intent, **stage counts** (gathered → admitted → ranked → sequenced → queued), spacing repairs, relaxed rules; per selected song — rank before sequencing, score, source, every component; **passed over** (scored, not queued); **rejected** with the rule and the stage. Never mounted for ordinary listeners.

---

## 3. AI

- **Never a direct path to playback.** DJ picks and catalogue discoveries pass stage 10; a DJ answer that fails it is discarded and the validated local order ships. Verified by test with muted, off-language, already-queued and duplicate-version picks.
- **AI playlist**: suggestions are typed, trimmed and clipped before searching; the catalogue song whose title **and** credited artist match wins over the first search hit; a malformed entry (`null`, non-string) no longer throws after the playlist resolved (a crash the new test found); generation is cancellable.
- **Chat**: the service flags a reply cut mid-stream (`truncated: true`); the client says so instead of presenting it as complete.
- **Worker** (section 6): the time-to-first-byte leash no longer kills long answers mid-body; `chat()` keeps its leash through the body read; `/api/curate` output is rebuilt from contract fields only; playlist strings are capped.
- With every provider unavailable: playback, the on-device pipeline, Home mixes and search are unaffected (engine tests run with the DJ off, returning `null`, and returning nothing usable).

---

## 4. Search

Indic-safe tokenising (`\p{M}` kept) in lyric search, did-you-mean and the lyrics matcher; NFKC and invisible-character folding in `normalizeQuery`; punctuation-insensitive tiers; **credit-aware ranking** (“kesariya arijit singh”, “arijit singh - kesariya”); original > remaster > alternate and popularity inside the exact tier; typo rescue on the Songs tab; artist pagination no longer serves page 1 forever; admin synonyms applied to every search endpoint (and no longer looked up through the object prototype); suggestions never show the previous query's titles; quick results clear after a failed fetch; command palette cancels stale requests, respects muted languages and keeps “Next track” on Enter; recents de-duplicated case-insensitively with prefix collapse; an overall 20 s request deadline with abortable back-off; failed lyric searches are no longer cached as “no results”, and the lyrics cache key includes duration; loading / error / empty states on the Albums, Artists and Playlists tabs; voice search reports denied / failed / empty.

Plays started from a typed search call `recordSearchPlay` (taste + session intent).

---

## 5. Playback, audio engine and Android

- **Fade listener leak** (reproduced): a cancelled sleep fade or crossfade tail left a `visibilitychange` listener that, the next time the app was backgrounded, muted the track or paused playback with a “Sleep timer” toast.
- **Sleep timer**: “after N songs” now disarms a minutes timer; one stop per deadline; cancelling inside the final fade restores the volume; mute rides on the element's own flag.
- `wantAutoplay` follows `play()`/`pause()` (recovery no longer resumes a paused track or leaves a playing one silent); a track that failed while offline re-applies its sources on Play; stale `play()` promises are ignored; position survives a second recovery hop; a deliberate pause cancels the pending auto-resume.
- **Casting**: pause / seek / volume reach the receiver *and* keep the silent local clock in step (it used to run on, “end” a paused song and start the next one on the TV); the local element can no longer become audible over the receiver.
- DJ voice ducking has a watchdog; no-voice devices un-duck at once.
- Media Session artwork cannot land on the wrong song.
- **Android** (`native-android/`, not compiled here — see limitations): `onTaskRemoved` clears the notification, widget and service when the app is swiped away; `ACTION_POSITION` updates only the playback state instead of rebuilding notification + widget + bitmap every second; the plugin's static reference is cleared on destroy. Back button: the mandatory update dialog no longer falls through to `history.back()`; the live-voice overlay closes on back. A failed / offline update check no longer dismisses a mandatory update. Downloads share one in-flight promise per song and clean up partial files. Alarm uses the local day and no longer overwrites the saved volume.
- **Service worker**: `/admin/` and `/status/` no longer overwrite the cached app shell.
- Keyboard shortcuts no longer hijack Space / arrows on focused buttons, links, selects, sliders or inside dialogs.

---

## 6. Security (Worker, API 5.13.0)

| Severity | Finding | Fix |
|---|---|---|
| **Critical** | `/api/events` accepted any client-chosen `type`; public readers trusted privileged types. One request could put the whole app into maintenance mode, broadcast a spoofed announcement / notification, or suppress the daily push. | Reserved-type set dropped silently (same 204); every privileged reader now also requires `device_id = 'admin'`; a forged `admin` device id is dropped. |
| High | Chat stream leash also aborted the response body; partial text was returned as complete. | Per-attempt controller cleared on headers, separate 90 s stream budget, `truncated: true`. |
| Medium | Admin push link check was a prefix match (`…online.evil.example` passed). | Exact-origin or single-slash path only. |
| Medium | `assistant`, `playlist`, `vinaxai` parsed unbounded bodies; `curate`/`dj` buffered a chunked body before checking its size. | Shared `_lib/body.ts` (`readCapped`, `readJsonCapped`), 413 on oversize. |
| Low/Med | `img` and GitHub fetches had no timeout. | 8 s / 10 s leashes, cleared on headers so bodies still stream; 504 on a hang. |
| — | `/api/curate` returned raw model JSON for three tasks; `chat()` could hang on a stalled body. | `sanitizeCurated`; leash held through the body read. |

Checked and found solid: every `/api/admin/*` route self-guards with a constant-time comparison and a lockout; cron routes use a header secret; rate limiting keys on `cf-connecting-ip`; server-rendered HTML is escaped; the image proxy and push subscribe endpoints are allow-listed; model choice is validated server-side; no secret is logged or shipped to the client.

Frontend: imported backups can no longer inject wrong types, non-http(s) media URLs, function-named settings keys or a malformed taste profile (section 7).

---

## 7. Storage, backup and migrations

**Migrations (all automatic, none destructive)**

| Data | Change | Handling |
|---|---|---|
| Settings | v3 → **v4**: `discoveryMode` | `migrate` derives it from `exploreMode`; backups from before 7.0 resolve the same way (`resolveDiscoveryMode`). |
| History entries | optional `skipped` | Absent on old plays; `isSkippedPlay` falls back to measured listening (< 30 s, unfinished). Carried by backup export / import / merge. |
| Taste profile | unchanged shape (v1) | `normalizeProfile` repairs a damaged or partial profile on load instead of crashing Home. |
| Session intent | new `sessionStorage` key `vinax.session.intent.v1` | Ephemeral. |
| Canonical keys | stricter | Served-songs memory (7-day TTL) and transition memory are keyed by identity; entries for the few titles whose key changed simply age out. |
| Legacy key migration | per-key, copy-then-remove with rollback | A large legacy library can no longer be deleted un-migrated. |

**Backup / restore**: writes frozen between restore and reload; `listenedSec` and `skipped` survive; envelope versions come from the running store, not the file; merge mode really merges taste, streak, lyric offsets, karaoke, prompts, alarm and Home layout; device data is never trimmed by caps in a merge, and a truncating cap is reported; Undo survives a later failed restore, is cleared when stale, covers the pending username claim, and the quick restore takes a snapshot too; device handoff is one atomic batch; file size is checked before reading. **Destructive actions**: Clear history / favourites offer Undo; clearing the taste profile asks first. **Stats**: calendar grid and streak step by calendar days (DST-safe). IndexedDB recovers from a failed open.

---

## 8. UI / UX

> Read limitation 1 first: a concurrent redesign by another tool rewrote parts of the shell while these fixes were landing. What follows is what was fixed; items marked † were superseded or re-applied on top of that redesign.

- Finished `both`-fill animations left a transform on the page wrapper, which made it a containing block: every non-portalled overlay was positioned against the page (the erase dialog could centre off-screen), menus painted under following rows, swipe and press feedback were overridden. Fill modes are now `backwards`; overlays are portalled; the track menu is portalled and positioned from its trigger.
- Safe areas: bottom inset applied once†; top inset on every page†; sheets respect the home indicator; toasts sit above the mini-player.
- Accessibility: visible focus on sliders, checkboxes and radios; `aria-valuetext` on seek and volume; 44 px touch targets on player, row and queue controls; song rows no longer start playback when Enter is pressed on the nested heart or menu, support Space, and expose `aria-current`; track menu has arrow-key navigation and returns focus; toasts are a persistent live region and pause on hover / focus; queue reordering by keyboard keeps focus and announces the new position; Karaoke and Drive mode are real dialogs; secondary text meets AA contrast; scripted scrolling honours reduced motion.
- Layout: card grids size from the available width (sidebar and rail aware); shelves have previous / next controls for mouse users; skeletons match the real hero; page headers wrap; one page-title size†. (The planned theme-colour fix for the Astra canvas was skipped†.)
- States: error + Retry on Language hub, Languages, Regions, Videos, Video, Quiz, Mood hub, Made for you, Mixes, Weekly mix, and the search grid tabs.

## 9. Performance

Home refetch storm removed (2.4). Player persistence writes only when a persisted field changes. Now Playing, Karaoke, Next-up card and the desktop rail no longer re-render on every progress tick (the rail is not mounted below 1280 px, so phones stop fetching its lyrics and 500 px artwork). Song rows dropped from ~17 store subscriptions to a few, the track menu mounts only while open, long lists are windowed, favourite lookups are O(1) (and the store now rebuilds its index *before* notifying subscribers). Seek commits on release; progress bars animate `transform`, not `width`; lyric animation loops stop while paused; queue drag reads layout once per drag. AppLayout's bootstrap no longer re-runs (stacking listeners) on every return from the AI page, and the Auto theme no longer leaks an interval per dependency change. Scoring computes per-pass invariants once.

---

## 10. Tests

New deterministic fixtures in `frontend/src/__fixtures__/songs.ts` (no randomness, no wall clock).

| Suite | Covers |
|---|---|
| `recommendation/engine.test.ts` | language lock, muted languages, seed / queued / recent / skipped exclusion by id and identity, artist spacing and cap, determinism, Familiar vs Discover on one pool, debug breakdown, AI off / `null` / empty answer, DJ output through validation, discovery gate |
| `recommendation/discoveryModes.test.ts` | Balanced is neutral; symmetric swing; order changes; reasons; skip streak tips Balanced familiar without touching the profile; artist pull / search pull / skipped song; fatigue |
| `recommendation/filters.test.ts`, `validation.test.ts`, `songIdentity.test.ts` | every rejection reason; identity (incl. Indic, width forms, dashed suffixes); lock relaxation; spacing repair; cap relaxation |
| `personalization/sessionIntent.test.ts` | sittings, streaks, pulls, energy steer, bounds, corrupt storage |
| `store/playerStore.v7.test.ts` | manual-before-auto, album order, tune and re-plan keep manual songs, stale continuation dropped, counted plays, skip flags, sleep timer (replace / cancel / single stop), no writes on ticks, quota does not break playback |
| `features/home/dedupeShelves.test.ts`, `services/ai/playlist.test.ts`, `store/settingsStore.test.ts` | identity-aware Home de-dup; verified playlist picks, malformed model output, cancellation; settings v3 → v4 |
| Storage, search, audio, Android, UI suites | one regression test per fix (see sections 4–9); Worker: `events-reserved-types`, `hardening`, `curate`, extended `admin-endpoints`, `chaos-failover`, `dj`, `playlist` |

Results: see **Validation** below.

---

## 11. Validation

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-bundle-size.mjs
npm run e2e

cd ../backend
npm run lint
npm run typecheck
npm test
npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
```

**Actually run on 2026-09-17 (results observed, not assumed):**

| Check | Result |
|---|---|
| Baseline before any change (6.5.2) | frontend 102 files / 624 tests, backend 30 files / 215 tests — all green |
| Backend `npm run lint` | clean |
| Backend `npm run typecheck` | clean |
| Backend `npm test` | **33 files, 268 tests passed** |
| Worker `wrangler deploy --dry-run` | builds (“--dry-run: exiting now”); nothing was deployed |
| Frontend `tsc --noEmit` | clean |
| Frontend `npm test` | **141 files, 924 tests passed** |
| Frontend `eslint src` | clean |
| Frontend `eslint src scripts` (the CI command) | **1 error**, in `scripts/flow-visual-check.mjs` — a file that is not part of this work (see limitation 1) |
| Production build (`vite build`, into a scratch directory) | succeeds |
| `check-bundle-size.mjs` on that build | **OK — first-load 187.7 KB gz of 188.0 KB** (was 188.0 = fail until the hard-filter module was made lazy) |
| `npm run e2e` (browser) | **NOT RUN** — see limitation 1 |
| Android build / on-device check | **NOT RUN** — no Android toolchain in this environment; the Java edits are uncompiled |
| Live AI engines, live catalogue | **NOT VERIFIED** — all AI and catalogue behaviour is tested against mocks |


---

## 12. Remaining limitations

1. **A second coding tool was editing this working tree at the same time.** From about 13:00 on 2026-09-17 a separate session ran a visual redesign (“VinaX Flow”, plan in `docs/vinax-flow-migration.md`): it deleted `src/styles/astra.css` and `studio.css`, added `src/styles/flow.css`, `components/TopBar.tsx`, `DestinationGrid.tsx`, `features/home/HomeOpening.tsx`, `scripts/flow-visual-check.mjs`, and rewrote the shell, navigation, song rows, chips and entity heroes. None of that is part of 7.0 as described here, none of it was reverted, and the 7.0 UI fixes were layered on whatever was on disk. Consequences:
   - Section 8 describes fixes made against the 6.x “Astra” shell. Several were superseded by the redesign (top safe-area inset now comes from its top bar; the bottom inset moved back to the wrapper; the Astra theme-colour fix was skipped because the navy canvas no longer exists; the `--ink-500` contrast fix was re-applied to the new tokens).
   - The unit results above are a snapshot of a moving tree. Re-run them once the other work settles.
   - Browser E2E was **not run**: the harness serves the repo's `dist/`, which the other tool rebuilds and serves from, and the existing specs drive markup it is rewriting. `e2e/v70.spec.ts` (settings migration to Discover, hand-queued song ahead of the automatic tail, developer breakdown) and the updated `smoke.spec.ts` are written but unexecuted.
   - The CI lint failure is in that tool's script.
   - A read-only snapshot of all uncommitted work at 13:21 (patch + untracked files) was saved outside the repo.
2. **Nothing is committed, pushed or deployed.** The production Worker is still the stale 6.0 build (expired Cloudflare tokens — see DEPLOYMENT.md), so none of the security fixes are live, including the critical one. After deploying, run in Supabase: `select count(*) from vinax_events where type in ('site-mode','announcement','song-push','ai-push') and device_id is distinct from 'admin'` and delete any forged rows; the readers now ignore them, the admin panels still list them.
3. **Android changes are uncompiled** (`VinaxMediaService.java`, `VinaxMediaPlugin.java`). They use only symbols that exist in those files and a string-level test guards them, but they need a Gradle build and a device check (swipe the app away while playing → the notification must disappear). Headphone-unplug handling still relies on the WebView's `devicechange`; not verified on a device.
4. **Needs a human eye**: the Karaoke seek bar is now the standard slider; queue sort chips are larger; the track menu is portalled (check near screen edges and while scrolling); windowed lists use paint containment (check focus rings, shadows and the drag glow at chunk edges); toasts' position above the mini-player; the brighter secondary text.
5. `autoIds` / `manualIds` (which queued songs are automatic vs hand-queued) are not persisted: after a reload every restored song counts as the listener's own, which is the safe side — nothing is reordered — but a hand-queued song added after a reload goes to the end.
6. About 29 call sites outside the stores still write `localStorage` directly (streak, saved prompts, nav groups, AI chats) and do not honour the restore write-freeze; the exposure is the ~400 ms before the reload.
7. Trending-search poisoning through the legitimate `search` event type is still limited only by the per-IP rate limit. The rate limiter remains per-isolate. The chat stream budget (90 s) is absolute, not idle-based.
8. Share-sheet labels in the track menu name two third-party messaging apps. They are functional share targets, so they were left for a product decision rather than renamed.
9. Energy is still inferred from title keywords and optional classifier metadata; there is no audio analysis. `utils/streak.ts` still uses UTC day keys by design, so for IST listeners the streak day rolls at 05:30.
10. First-load JS is 0.3 KB under its budget. Any growth needs either an optimisation (the audit's chunk-merging suggestion for the ~17 sub-1.3 KB preload chunks was not attempted) or a justified re-base in `scripts/check-bundle-size.mjs`.

