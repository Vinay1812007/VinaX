# Audit — 9.1.0

What was found before the 9.1 work, how it was confirmed, and what changed.
Every claim below was checked against the code at `616f8e6`
(`feat/9.0.3-expert-grounding`); a claim that could not be checked is marked
**unverified** and says what would be needed to settle it.

Baselines were captured before any edit:

| check | baseline | after 9.1 |
| --- | --- | --- |
| frontend `tsc --noEmit` | pass | pass |
| frontend `eslint src scripts` | pass (0 warnings) | pass (0 warnings) |
| frontend `vitest run` | 212 files / 1644 tests | 221 files / 1800 tests |
| frontend `vite build` | pass | pass |
| frontend first-load bundle | — | 181.1 KB of 188 KB budget |
| frontend `e2e-smoke.mjs` | — | pass |
| frontend browser E2E | — | 20 files / 77 tests |
| backend `tsc --noEmit` | pass | pass |
| backend `eslint worker` | pass (0 warnings) | pass (0 warnings) |
| backend `vitest run` | 66 files / 930 tests | 71 files / 1031 tests |
| `scripts/eval-recs.mjs` | current leg passes; baseline leg fails (pre-existing) | unchanged |

The eval's `baseline` leg fails on both runs for a reason that predates this
work: the frozen source at `7c4e2f5` has no
`services/recommendation/recMemory`, which `eval/recs.eval.ts` imports. Only the
`current` leg is meaningful today.

---

## 1. Repetition — confirmed root causes

### R1 · The shared "already shown" memory had two writers and ten readers

`vinax.flow.served.v1` was read by Home (`useDailyMix`, `useAiHome`,
`blocks/shared.tsx` via `surfacePolicy`), by the AI Playlist
(`services/ai/playlist.ts`) and by the queue engine
(`services/recommendation/engine.ts:125,320`). It was **written** by only two
places: `pages/HomePage.tsx:189` (the Home hero) and `services/ai/playlist.ts`.

`planNextSongs` read `servedKeySet()` into its context and never recorded
anything in `commit()` — so every song the automatic queue, the AI DJ or Radio
put in front of a listener was invisible to every surface that consulted the
memory. The discovery shelves, the Daily mix and the AI Playlist were filtering
against a list that was nearly always empty.

**Fixed:** one ledger (`services/recommendation/exposure.ts`) written by the
queue (`engine.ts` `commit`), playback (`transitionTracker.ts`), Home
(`features/home/blocks/shared.tsx`, when a shelf renders), the DJ
(`services/ai/dj.ts` `commitDjSet`), the AI Playlist and the library's
like/dislike actions.

### R2 · The penalty was too small to change an order

`weights.ts` `TASTE_WEIGHTS.servedRecently = 0.04`, against candidate totals of
0.4–1.2 and a strongest source boost of 0.24. Even when the memory *was*
populated, it could not move a song's position.

**Fixed:** `EXPOSURE_WEIGHTS` in `exposure.ts`, sized against the rest of the
score, with a separate magnitude and horizon per event kind — shown 0.14/3 d,
queued 0.24/7 d, played 0.30/10 d, completed 0.22/14 d, skipped 0.30 per skip
(×3 max)/21 d, disliked 0.80/60 d — decaying linearly, with favourites paying a
quarter and an explicit replay request paying nothing for a week.

### R3 · Five memories that did not know about each other

| key | shape | lifetime | used as |
| --- | --- | --- | --- |
| `vinax.flow.served.v1` | canonical keys + timestamps, cap 300 | 7 d | a filter |
| `vinax.recs.seedmemo.v1` | raw catalogue **ids**, 5 per seed | 12 h | a penalty |
| `vinax.dj.surfaced.v1` | raw ids + a description, cap 300 | none | prompt text only |
| `vinax.aiplaylist.avoid.v1` | bare title strings, cap 100 | none | prompt text + a title filter |
| `vinax.home.ai-shelves.songs.v1` | raw ids, cap 200 | none | prompt text only |

Three of the five were never a filter at all, two were keyed by catalogue id (so
an alternate release walked straight past them), and none shared a horizon.

**Fixed:** `exposure.ts` is the source of truth. `vinax.flow.served.v1` is
imported once per device by `migrateLegacyExposure()` (it already held canonical
keys with timestamps). The DJ's and Home's id-keyed lists are **not** imported —
an id cannot become a canonical key without the song — and are left on disk;
the DJ still reads its own list to build the model's avoid text, which the
ledger's keys cannot do.

### R4 · Seed memory was keyed by catalogue id

`recMemory.ts` `rememberSeedContinuation` stored `s.id`. Asking again from the
same song could return the same opening under a different release of each song.

**Fixed:** canonical keys. A device written by 9.0 holds ids there; they simply
never match, so that seed's memory is empty until the next continuation — no
migration needed.

### R5 · The AI Playlist's pool was identical every time

`services/ai/playlist.ts` `gatherCataloguePool` ran
`catalogQueries(intent, languages, 3)` — deterministic, no salt — and
`searchSongs(q, 25)`, i.e. three fixed phrasings at page 1. `semanticRank` over
a fixed pool is deterministic, so the catalogue fallback could only ever return
the same list minus whatever the avoid list removed. No amount of prompt
temperature on the server could fix this, because that path asks no model.

**Fixed:** a persisted per-prompt round (`playlistRound`) drives
`poolPlan(queries, round)` — `POOL_SEARCHES` 6 requests spread over the
available phrasings and `POOL_PAGES` 5 pages, with the window shifted a whole
round's worth of laps each time. Depth rather than width, because
`catalogQueries` often yields only two phrasings and inventing more would ask
for something the listener did not.

### R6 · The broad candidate sources stayed shallow

`candidates.ts` read one page per language for `trending` (`1 + salt % 4`) and
`1 + salt % 3` for `favorite-artist`.

**Fixed:** `BROAD_PAGES = 6` and two pages per language for the trending source.

### Measured, same fixture, before and after

`src/services/recommendation/repetition.accept.test.ts` — 120 songs, 24
artists, all playable, all in-language. Five consecutive 20-song continuations
from one seed:

| | new per generation | repeated |
| --- | --- | --- |
| 9.0 behaviour | 6.6 / 20 | 67 % |
| 9.1 | 19.0 / 20 | 5 % |

The acceptance target (≥ 12 new of 20) fails on 9.0 behaviour (8 new on the
first pair) and passes after. Verified by reverting the three 9.1 changes in
`engine.ts` and re-running.

**The offline evaluation (`scripts/eval-recs.mjs`) shows no improvement**, and
that is expected: its repeat metrics were already saturated
(`repeatedIdentity: 0`, `sameIdentityBackToBack: 0`) because the hard
`queuedKeys` rule already covered within-session identity repeats. It does not
measure "ask again from the same seed and compare generations", which is the
case 9.1 fixes. What it does confirm is **no regression**: hard violations stay
0, artist coverage 3.941 → 3.944 per batch, discovery share 0.361 → 0.358,
latency p50 1.23 → 1.36 ms. `sameLeadWithinThree` moved 1764 → 1806 (+2.4 %), a
soft spacing statistic, and per fixture it moves both ways (warm −12, prefs −18,
soft-muted −12 against familiar +12, malayalam +12, sparse-history +18) — i.e.
reordering noise, not a systematic loss.

---

## 2. Live web discovery — confirmed gap

`_lib/websearch.ts` `liveSearch` had exactly two callers:
`api/vinaxai.ts` (the chat) and `api/admin/health.ts`. **No music-generation
path used it** — not `/api/dj`, `/api/playlist`, `/api/curate`,
`/api/ai/playlist`, `/api/recommendations` or `_lib/homeShelves.ts`.

`_lib/trends/*` ingests public charts properly, but `services/trends/signal.ts`
turned the result into `bonus: Map<catalogId, number>` only. A chart entry could
add a small score bonus to a song the catalogue had already returned; a current
song the catalogue searches missed was **unreachable**.

Two further bugs in that signal:

- staleness compared `signal.region !== region` but not the language, so a
  listener who changed language kept being served the previous language's chart
  **and the mismatch started no refresh** (the snapshot is fetched with
  `ctx.pinnedLanguages[0]`);
- the catalogue-search source is named `trending` and its explanation said
  "Trending in your languages" — a claim with no outside evidence behind it.

**Fixed:**

- `_lib/discovery.ts` — one bounded path: date/region/language/intent queries →
  the metasearch instance → the retrieved text read into song names by an AI
  lane **inside `fenceWebContext`** → every extraction resolved against the real
  catalogue by `playlistResolve` → only what resolved is returned, with its
  evidence. An extraction citing a source index we did not supply is dropped, so
  a model cannot smuggle a song in with an invented citation. A rank survives
  only from a chart-shaped source that stated one. `MAX_SEARCHES` 3,
  `RUN_BUDGET_MS` 14 000, per-isolate coalescing, a one-day cache window, a
  12/hour quota and a 3-strike breaker.
- `api/discover.ts` — `wait=0` (the default) answers from the cache and warms it
  behind the caller, so playback never waits; `wait=1` runs and waits, for paths
  where the listener already is.
- `services/discovery/{client,signal}.ts` — strict re-validation, and a signal
  that never waits, keyed by region **and** language.
- `candidates.ts` — `verified-trend` and `web-discovery` are real candidate
  sources now, resolved by exact catalogue id.
- `explanations.ts` — the catalogue-search source says "Popular in the catalogue
  for your languages"; only `chart` may say a chart.

**Unverified:** no part of the discovery path has been run against the live
services. It needs `SEARXNG_URL` (+ `SEARXNG_TOKEN`) and an AI lane key; the
trends half needs `YOUTUBE_API_KEY` and the Supabase tables. Everything above is
tested against mocks.

---

## 3. Location — confirmed defects

| id | finding | fix |
| --- | --- | --- |
| L1 | `services/location/cloudflare.ts` returned `null` on Capacitor, so Android never had edge context and fell back to a 9-entry time-zone table. The stated reason ("a relative fetch runs against capacitor://localhost") does not hold: `capacitor.config.ts` sets `server.url`, so the WebView origin IS the deployed origin — and every other native client in this codebase already uses an absolute URL. | absolute URL on native, same as the trends/DJ/playlist clients |
| L2 | `/api/geo` returned country + region only. No timezone, no city, no CORS. | country, region, approximate city, IANA timezone, `unknown`, CORS; `private, no-store` |
| L3 | `RegionInfo` had no timezone, city or resolution time, so nothing could show or refresh it. | all three added |
| L4 | `resolveRegion` asked the edge on every cold start and had no refresh. | 12 h TTL, explicit `refresh`, stale value kept rather than wiped on a later failure |
| L5 | The AI context opened with `istNowLine()` for everyone — the Indian time, whoever was asking — and carried no place at all. | `_lib/place.ts` + `place` on the chat body |
| L6 | Settings showed only `Now: IN (edge)`, with no way to see the detail or ask again. | `features/location/LocationRow.tsx` |

The inference setting is respected at the boundary:
`services/location/assistantPlace.ts` returns `undefined` when inference is off
and no manual override is set, so nothing is sent and the server falls back to
the IST line. `_lib/place.ts` `readCoarsePlace` keeps only four fields, so an IP
or coordinates cannot ride along even if a future caller passed them, and the
prompt states that the value is coarse, that a city is approximate, and that the
listener's language must never be inferred from it.

---

## 4. Prompts that worked against discovery

`api/playlist.ts` asked for "a real, **well-known** song", "a real, **famous**,
findable song"; `api/dj.ts` asked for "**recognizable hits over obscure deep
cuts**". These fight the stated goal of finding listeners something new, while
the part that actually prevents hallucination is only the *real* requirement.

**Fixed:** every one now demands reality and explicitly does not demand fame.

---

## 5. Still open

Everything listed here is a deliberate limit with a stated reason, except the
first, which is an external blocker.

- **`/api/discover` has never run against the live services.** `SEARXNG_URL` is
  already set in `worker/wrangler.toml`, so what remains is an AI lane key and one
  call: `/api/discover?wait=1&region=IN&language=telugu`. Everything in that path
  is tested against mocks (`_lib/discovery.test.ts`, `api/discover.test.ts`).
  `/api/trends` (needs `YOUTUBE_API_KEY` + the Supabase tables) and the maestro
  lane are unverified live for the same reason.
- **No DOCX / XLSX / PPTX / EPUB / ODT / RTF extraction.** The 9.1 PDF reader
  (`features/ai/pdfText.ts`) is dependency-free because a PDF's content streams
  are zlib and the browser can inflate them; none of the other container formats
  generalises from that. A listener can paste the text or attach it as a project
  reference file.
- **Memory is written by the listener, not by the model.** A "shall I remember
  that?" proposal flow is the obvious next step and is not built — see
  `docs/ai-assistant-matrix.md`.
- **Artifacts are collected, not authored.** The panel gathers what replies
  wrote, with versions and a sandboxed preview; there is no canvas for editing a
  document in place.
- **Context limits are bounded but global.** The long-thread trim, the attachment
  budget, the memory budget and the project budget each have a cap, but none is
  per-model, so a very long single turn could still overrun a small-context
  engine.
- **A duration in a playlist request is approximate.** Catalogue durations are
  not known until a song is resolved, so "about an hour" becomes a song count at
  four minutes a song — and the app says "about" rather than implying it measured.
- **The automated axe gate does not run here.** `e2e/a11y.spec.ts` needs
  `@axe-core/playwright`, which is not installed, so `e2e/vitest.config.ts`
  excludes it. 9.1 added `e2e/v91-features.spec.ts` instead: accessible names,
  hit areas, keyboard operation and narrow-viewport overflow on exactly the
  surfaces this release changed, in a real browser. That is narrower than axe.
- **The eval harness's `baseline` leg is broken** (pre-existing: the frozen
  `7c4e2f5` source has no `recMemory`), and its fixtures do not measure
  cross-generation repeats, which is why
  `src/services/recommendation/repetition.accept.test.ts` exists. Home/DJ/playlist
  overlap and the evidence-backed sources are covered by unit tests rather than by
  the eval's own fixtures.
