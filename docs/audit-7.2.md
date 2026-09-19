# Audit and change record — 7.2

This document records the 7.2 review of VinaX: every finding with its severity, the evidence, how it was reproduced, the fix and how the fix was validated. It separates three kinds of item: **reproduced defects** (a test failed on the review baseline and passes now), **source-level findings** (confirmed by reading the code, with a regression test where one is possible), and **product proposals** (improvements that were not defects). The baseline is commit `7c4e2f5` (frontend 7.1.0, API 5.14.0). Where something was not verified — live credentials, provider feeds, Android devices — it says so.

Severity: **S1** wrong data reaches the listener or the profile, or a safety rule is bypassed; **S2** wrong behaviour with a workaround, or an operator misled; **S3** quality, performance or maintainability.

## Baseline

| Check at `7c4e2f5` | Result |
| --- | --- |
| Frontend unit tests | 154 files, 1,005 tests, all passing |
| Backend unit tests | 33 files, 279 tests, all passing |
| First-load JavaScript | 183.4 KB gzip (budget 188 KB) |
| Service-worker precache per boot | 2,476 KB gzip |

The four review probes and the stale-refetch finding below were written as regression tests first and run against the untouched baseline: 22 of those 25 tests failed there. The three that passed pin behaviour that was already right (an empty table is still an empty table; "not configured" and "unauthorized" are distinct; a zero-width joiner never changed the Worker's key).

## Reproduced defects

| # | Sev | Finding | Reproduction (test) | Fix | Validation |
| --- | --- | --- | --- | --- | --- |
| R1 | S1 | Seeking counted as listening. A 200 s track seeked to 180 s recorded a PLAY; seeking to the end and letting it end recorded a COMPLETE; a manual skip was judged by position (`currentTime / duration`), so 10 s heard at 97 % was not a skip and 70 s heard after a scrub back was; transition memory judged the furthest position. | `store/playerStore.playbackSession.test.ts` — 7 cases failed at baseline | One playback-session contract (`services/playback/session.ts`): per-instance heard seconds with declared seeks, pause, buffering, rate and a wall-clock allowance; PLAY / SKIP / COMPLETE from heard time; one learning event of each kind per run; listen clock and transition memory consume the same events | The 7 cases pass; existing v7 player tests pass (two were rewritten from one playhead jump to real ticks, because a single jump is now correctly a seek) |
| R2 | S1 | Automatic tail replacement bypassed safety filters. `replaceAutoTail` only de-duplicated ids: an explicit song in Kid mode, a hidden song or artist, a muted language, another cut of the playing song, junk and malformed entries all got in. The two-skip adaptive re-plan brought favourites in without the hard filter. | `store/playerStore.admission.test.ts` — 3 cases, including the real two-skip path driven through `next(true)` | `services/recommendation/admission.ts`: one current-state gate at every automatic mutation (continuation, refinement, re-plan, reserve top-up), read after every await; the re-plan pre-filters its favourites through it | The 3 cases pass |
| R3 | S1 | The Worker's song identity dropped Indic vowel signs: `canonKey('కల', 'Singer') === canonKey('కాల', 'Singer')`; it also split artists on commas only and kept "cover" in the title. | `backend/worker/__tests__/songIdentity.test.ts` — 6 of 7 cases failed | `identityCore.ts`, byte-identical in both packages (a test fails on drift), plus shared vectors in `shared/identity-vectors.json` run by both suites: NFKC, invisible characters dropped, Latin accents folded, other marks kept, versions and featured credits stripped, primary artist by any separator; `recordingKey` for remix/live/cover | All vectors pass in both packages |
| R4 | S2 | Database failures looked like empty success. `/api/admin/query` answered `200` with no rows for an upstream `500`, because `sbSelect` swallows failures and returns `[]`. No database request had a deadline. | `backend/worker/__tests__/adminQuery.test.ts` — 4 of 6 cases failed (the hung-upstream case timed out) | `sbSelectResult` names the failure (`not_configured`, `unauthorized`, `bad_request`, `not_found`, `unavailable`); every request goes through `dbFetch` with an 8 s deadline covering the body; the query console answers `502` with the failure kind | The 6 cases pass |
| R5 | S1 | A stale song-detail refetch after a playback failure could skip the song the listener had chosen since, or reload sources over it (the same song id replayed by hand). | `playerStore.playbackSession.test.ts`, "failed playback and stale async work" — 2 cases | Every async result is checked against the playback instance that failed; the refetch is aborted when the track changes | Both pass |
| R6 | S2 | DJ reasons, segues and the surfaced-song memory were written inside `djSequence`, before the engine validated the order and before the queue accepted it; a rejected proposal still steered later rounds and what the DJ said. | `services/ai/dj.test.ts` (rewritten cases), `engine.plan.test.ts` | `djSequence` is a pure proposal; `commitDjSet(set, accepted)` publishes only for accepted songs; the Queue Builder commits on apply | Pass |
| R7 | S2 | A DJ answer whose picks were all rejected by validation was still "accepted", because local songs filled the order behind it. | `engine.plan.test.ts`, "a DJ proposal that fails validation is never committed" | Acceptance counts the DJ's own surviving picks | Pass |
| R8 | S2 | Hiding an artist credited in an Indic script was impossible: the hidden-artist key kept only `a-z` and digits, so the key was empty. | `store/libraryStore.test.ts`, "hiding an artist works in every script" | Unicode-safe key using the shared identity fold; Latin keys unchanged | Pass |

## Source-level findings (fixed)

| # | Sev | Finding | Evidence | Fix | Validation |
| --- | --- | --- | --- | --- | --- |
| F1 | S2 | Local next-song results waited for the DJ. The on-device order was built before the DJ request but returned only after it (30 s leash); candidate gathering waited for every source; `next()` paused at an exhausted queue for the whole wait. | `engine.ts` at baseline, `recommendNextSongs` | `planNextSongs`: one end-to-end deadline for the on-device order (8 s; 3.5 s when the listener is waiting), the DJ as a separate bounded refinement of entries that have not started, a validated reserve that plays at once when the queue runs dry, cancellation on queue change | `engine.plan.test.ts`: local order returned while the DJ is pending; a never-settling source cannot hold the plan past its deadline; a cancelled plan asks nothing; reserve top-up is re-validated |
| F2 | S3 | No listener switch turned off background AI: with the AI DJ off, songs were still sent for classification and re-ranking. The Queue Builder's DJ ignored the owner's `aiDj` kill switch. | `services/ai/recommendations.ts`, `queuePlanner.ts` at baseline | `aiAssist` setting gates every curate task, the DJ and the re-rank; the Queue Builder reads the owner flag | `services/ai/aiAssist.test.ts`, `engine.plan.test.ts` |
| F3 | S3 | The service worker precached 2,476 KB gzip on every boot, 1,852 KB of it diagram and maths engines (and three formats of one typeface) used only by VinaX AI replies that need the network anyway. | `precache-manifest.json` of a baseline build | The manifest is `{ precache, onDemand }` from the chunk graph; on-demand assets are cached on first use and never pruned | `src/__tests__/swPrecache.test.ts`; measured 624 KB gzip precached |
| F4 | S3 | The whole recommendation engine rode the first-load bundle through one static import in the player store. | Chunk analysis of a baseline build | The player loads the engine when a queue is first extended | First load 171.3 KB gzip (was 183.4) |
| F5 | S3 | Usage telemetry sent `play` when a new song started, so flip-pasts inflated the owner's play counts while taste ignored them. | `services/analytics/telemetry.ts` `initTelemetry` | A `counted` playback event marks the moment a play counts; telemetry sends `play` from it | See the telemetry section below |

## Verified, no change needed

| Item | Evidence |
| --- | --- |
| Playback ticks re-rendering whole screens | Every clock reader (`PlayerBar` progress, `CanvasProgress`, `BookmarkNowButton`, `Seekbar`, lyric lines) is a leaf component with a narrow selector since 7.0; no component subscribes to the whole player store. |

<!-- The sections below are completed as the parallel work lands: backend reliability and security, trends, owner console, Home safety and ranking, queue and listener controls, evaluation. -->
