# Recommendations

This document covers how VinaX decides what to play next and what to show on Home: the next-song pipeline, its scoring weights, the taste profile and the session intent that feed it, the exposure ledger that keeps surfaces from repeating each other, the queue rules in the player, and the Home shelves. Everything described here runs on the device; the engine exists so that a free app with no account requirement can still continue a queue sensibly, in the listener's languages, without sending listening history to a server. The optional AI steps are described in [ai.md](ai.md), the outside chart signal in [trends.md](trends.md), the offline evaluation in [evaluation.md](evaluation.md), and what is stored or leaves the device in [data-and-privacy.md](data-and-privacy.md).

All paths are relative to `frontend/src/` unless they start with `backend/` or `frontend/`.

## The model in one page

A continuation is one call to `planNextSongs(seed, ctx, options)` in `services/recommendation/engine.ts`. The seed is the song the stretch follows. The call runs these stages in order and returns a plan.

| # | Stage | Module (`services/recommendation/`) | What it does |
| --- | --- | --- | --- |
| 1 | Candidate generation | `candidates.ts` | Gathers a pool from several sources in parallel. A failed source shrinks the pool and nothing else. |
| 2 | Hard filtering | `filters.ts` | Applies rules, not preferences. Every rejection has a named reason. Versions of one song collapse onto the best cut. |
| 3 | Feature extraction | `services/ai/recommendations.ts` (`enrichSongs`) | Adds classifier metadata (mood, vibe, genre, energy, tempo) when it is cached or arrives within 1.8 s. Optional. |
| 4 | Scoring | `scoring.ts`, `weights.ts`, `vectors.ts` | Scores each candidate against the seed, the taste profile, the hour, the weekday, the session window, this sitting's intent, the discovery mode and the exposure ledger. Every term is recorded as a reason, and the reasons sum to the score. |
| 5 | Ranking | `scoring.ts`, `reranking.ts`, `engine.ts` | Sorts, shuffles within 0.05-wide score bands using the session salt, re-ranks greedily for diversity (artist, genre and language against the last four picks), then applies an active tune's per-song nudge. With the AI DJ off, an optional AI re-rank of the top 30 adds up to +0.12 per song. |
| 6 | Sequencing | `sequencer.ts` | Orders the top 40 into a stretch: energy arc, mood flow, transition memory, artist and album spacing, era, language policy, familiar first. |
| 7 | AI DJ (optional) | `services/ai/dj.ts` | May re-order a sample of the pool and propose a few catalogue-verified songs. Arrives later, as a refinement. |
| 8 | Validation | `validation.ts` | Re-checks the final order, whoever produced it, against every rule. This is the final policy for the on-device order, the DJ's order and a top-up from the reserve. |
| 9 | Admission | `admission.ts` | The player re-checks every automatic queue change against the listener's state at that moment. |

Three things hold everywhere: hard rules never relax; the AI never writes to the queue (its output passes stages 8 and 9); and a penalty is never a rule (a song that is clearly the best fit still wins).

`limit` is clamped to 0–40 and defaults to 8; the player asks for 5. `recommendNextSongs` wraps `planNextSongs` for radio, playlist continuation and tests. `buildRecommendations(ctx)` runs the same sources, filter and scorer without a seed for Home. The engine is loaded when a queue is first extended; it is not in the first-load bundle.

### What feeds the pipeline

| Piece | Where | Lifetime |
| --- | --- | --- |
| Taste profile (languages, artists, songs, hours, weekdays, energy, dials, soft mutes) | `services/personalization/profile.ts`, `storage.ts`, `updater.ts` | Persisted on the device; decays |
| Event weights | `services/personalization/eventWeights.ts` | Constants |
| Session window (recent songs of this tab: mood, energy, language) and the mood pin | `services/personalization/session.ts`, `features/player/moodPin.ts` | `sessionStorage` |
| Session intent (skips, completions, likes, hand queue-adds, plays from search) | `services/personalization/sessionIntent.ts` | `sessionStorage`; ends after 45 minutes of silence |
| Playback measurement (what was actually heard) | `services/playback/session.ts` | Per playback instance |
| Recommendation context (everything one pass reads) | `services/recommendation/context.ts` | Built per call |
| Exposure ledger and song snoozes | `services/recommendation/exposure.ts` | `localStorage` |
| The engine's memory of its own picks | `services/recommendation/recMemory.ts` | `localStorage` |
| Verified-trend signal, read from a snapshot and never waited for | `services/trends/signal.ts`; evidence in `store/evidenceStore.ts` | In memory |
| Queue ownership (automatic tail vs. hand-queued songs) | `store/playerStore.ts` | In memory; a reload starts clean |
| Surface policy and Home refresh policy | `services/recommendation/surfacePolicy.ts`, `features/home/homeRefresh.ts` | Pure / in memory |

## How listening becomes taste

Everything that learns from listening reads one measurement: the seconds of a playback instance that were actually heard (`services/playback/session.ts`). The playhead position is never used as a proxy.

A playback instance is one start of one track (a tap, an advance, a restore, or one repeat-one loop). Consecutive instances of one track through repeat-one form a run, and a run learns at most one PLAY, one SKIP and one COMPLETE, so looping a song cannot flood the profile. A time update credits the step since the last one only when no seek is pending, the player is not buffering, and the step is positive and plausible against the wall clock. Pauses produce no step. Playback speed counts: at 2× a 200-second song is fully heard after 100 seconds.

| Verdict | Duration known | Duration unknown |
| --- | --- | --- |
| `PLAY` | Heard at least the smaller of 5 s and 70 % of the song | Heard 5 s |
| `COMPLETE` | Ended naturally with at least 70 % heard | Ended naturally after 30 s heard |
| `SKIP` | A manual skip after the PLAY counted, with under 30 % heard | … with under 30 s heard |
| Early leave | A manual skip before the PLAY counted: noted in this sitting's intent, never written to the long-term profile | same |
| Failed | Every source failed: no SKIP and no transition verdict | same |

Seeking to the last seconds and letting the song end is therefore neither a PLAY nor a COMPLETE. The player publishes `counted`, `credit`, `end`, `served` and `refined` events on one bus; the listen clock, transition memory, exposure ledger and opt-in analytics subscribe to it instead of measuring on their own.

### Taste profile and event weights

Every event bumps the language, the first three credited artists and the song by a delta from `eventWeights.ts` (`EVENT_WEIGHTS_VERSION` is `1.2.0`).

| Event | Weight | When |
| --- | ---: | --- |
| `PLAY` | 1.0 | A play that counted |
| `COMPLETE` | 2.0 | A natural end with at least 70 % heard |
| `FAVORITE` | 3.0 | A like (removed again on unlike) |
| `QUEUE_ADD` | 0.5 | "Add to queue" or "Play next" |
| `PLAYLIST_ADD` | 1.0 | Adding the song to a playlist |
| `SEARCH_PLAY` | 1.5 | A play started from the listener's own search, on top of the `PLAY` |
| `SKIP` | −0.75 | A manual skip with under 30 % heard. `SKIP_RETRACTS_PLAY` is on, so the skip also takes back the `PLAY`, for −1.75 in total. |
| `DISLIKE` | −1.5 | A dislike |
| `SOFT_MUTE` | −3.75 | "Less like this"; also mutes the lead artist for 7, 14 or 30 days (14 by default). Settings → Recommendations lists active mutes and takes any of them back. |

Positive affinity halves 14 days after the last signal; skips halve after 30 days. No affinity can exceed `MAX_AFFINITY` (60).

Passive listening teaches less as one sitting goes on (`updater.ts`). A `PLAY` and its `COMPLETE` count in full for the first 8 plays of one lead artist in a sitting (`SITTING_ARTIST_FULL`), at half up to the 20th (`SITTING_ARTIST_HALF`) and at a quarter after that; a language counts in full for 12 plays, at half up to 30, then at a quarter. Likes, searches, queue and playlist adds, every negative signal and the song's own affinity always count in full. One party night therefore moves the profile without taking it over.

### Session intent

`sessionIntent.ts` keeps a ring of at most 40 events for the current tab. A sitting ends after 45 minutes without an event, and an action 30 minutes old counts for half of a fresh one. Nothing here is written to the long-term profile.

| Event | Pull on the artist | Pull on the language |
| --- | ---: | --- |
| `skip` | −0.40 | 40 % of the artist pull, clamped to ±0.6 |
| `complete` | +0.15 | same rule |
| `like` | +0.50 | same rule |
| `unlike` | −0.30 | same rule |
| `queue_add` | +0.35 | same rule |
| `search_play` | +0.45 | same rule |

`deriveIntent` reduces the ring to: the skip streak and completion streak (likes and queue-adds do not break one); the artist pull (−1..1) and language pull (−0.6..0.6); the ids skipped in this sitting, which are hard-filtered until the song is completed or the sitting ends; an energy steer (−0.3..0.3, mean energy of completed minus skipped songs, once there are two of each); and a discovery appetite (−1..1: +0.2 at four straight completions and +0.1 for each further one up to four more; −0.3 at two straight skips and −0.15 for each further one up to four more; −0.1 per search play or hand queue-add, down to −0.3). The scorer fades the intent in over its first three events. The appetite moves the discovery lean by × 0.6 and the queue's discovery share by × 0.15.

## The stages

### 1. Candidate sources (`candidates.ts`)

| Source tag | What is gathered |
| --- | --- |
| `related` | Catalogue suggestions for the seed (30), for a few distinct recent listens and for salt-rotated favourites |
| `favorite-artist` | A search for the seed's lead artist and for some of the listener's top artists |
| `favorite-album` | The rest of albums the listener has favourited songs from |
| `album` | The rest of the seed's own album, and of the album of the song the stretch follows (the anchor) when that is another song |
| `related-artist` | Popular songs by artists close to the seed's (and the anchor's) lead artist: featured artists first, then the catalogue's similar artists, then frequent co-credits. Two artists, six songs each (`RELATED_ARTISTS`, `SONGS_PER_RELATED_ARTIST`); the related list is cached per artist for 30 minutes (50 artists). |
| `genre` | One catalogue search for the seed's genre (else its mood word) in the seed's language. Skipped while an intent is active and for a muted or unknown language. |
| `style` | Only while a style is active (see [Staying in a style](#staying-in-a-style)). |
| `proven` | Suggestions for automatic picks the listener finished or liked before, and some of those picks themselves once they have rested (see [The engine's memory of its own picks](#the-engines-memory-of-its-own-picks)) |
| `verified-trend` | Up to 6 songs (`TREND_RESOLVE`) that an outside chart actually named, matched to catalogue ids by the server (see [trends.md](trends.md)) and fetched by exact id, so no search can resolve to a different song. Cached 30 minutes. |
| `trending` | A catalogue search for the seed's language and genre, plus trending seeds for the listener's languages: two pages of 15 on a 6-page rotation (`BROAD_PAGES`). This is a search for popular-sounding words and carries no outside evidence; its reason says "Popular in the catalogue for your languages", never "trending". |
| `intent` | Two pages of a catalogue search for the active tune or pinned mood, in the queue's language. Only while an intent is active. |
| `explore` | Discover mode only: trending picks in languages the listener has never played, pinned or muted |
| `history` | Familiar mode only: favourites and finished songs in the seed's language, without a fetch |
| `rediscovery` | Songs completed more than 14 days ago, without a fetch |

- **Bounded work.** At most six catalogue requests are in flight (`CANDIDATE_FETCH_CONCURRENCY`). Identical requests share one fetch, and responses are reused for three minutes (sixty kept). After a soft deadline the gather resolves once the pool holds enough songs and the required sources (the seed's suggestions, the intent search, the style search) have answered; at the hard deadline it resolves with whatever has settled and aborts the rest.
- **Provenance.** A song found by several sources arrives once, carrying every source. Its primary source is the first in `SOURCE_PRIORITY` (`types.ts`): intent, related, favorite-artist, album, favorite-album, related-artist, style, proven, verified-trend, history, rediscovery, genre, explore, trending.
- **Playable.** A response that carried stream URLs for some songs and none for another marks that one `unplayable`; a response with no stream URL at all says nothing either way. A candidate marked `unplayable` stays so until a copy with a stream URL arrives.
- **Cold start.** With no taste yet the languages are the pinned ones, then the languages of liked songs, then unmuted defaults; the artists of liked songs seed the artist searches.
- Before the pool leaves this stage it drops blocked songs, junk tracks, soft-muted artists and, in Kid mode, explicit songs.

### 2. Hard filter (`filters.ts`)

`rejectReasonFor` checks, in this order: `invalid` (no id, title or artist list), `junk` (dialogue, background score, jukebox, trailer, promo, ringtone and similar titles), `too-short` (a known duration under 90 s), then the safety rules of `safetyReasonFor` — `explicit` (Kid mode), `blocked`, `muted-language`, `soft-muted`, `snoozed` — then `seed` (the seed or another version of it), `already-queued` (by id or identity), `recently-played`, `skipped-this-session` and `off-language` (a known language outside `allowedLanguages`, see [Queue languages](#queue-languages)). A survivor marked `unplayable` that is not downloaded is rejected as `no-audio`. Survivors that share a canonical identity collapse with reason `duplicate-version`, keeping the original over a remaster over an alternate cut, then the more-played one.

Canonical identity (`identityCore.ts`, `songKey`) is the normalised title plus the primary artist. The Worker uses the same file, and both test suites run the vectors in `shared/identity-vectors.json` (`identityContract.test.ts`). Normalisation is Unicode-safe: NFKC, invisible characters dropped, Latin accents folded, every other combining mark kept so Indic vowel signs survive. It strips version decorations (film credit, remix, remaster, live, a year and so on) and featured credits. `recordingKey` adds the version tag, so a remix stays distinguishable from its work family.

### 3–5. Scoring and ranking (`scoring.ts`, `weights.ts`)

`SCORING_WEIGHTS_VERSION` is `1.3.0`. Feature values are normalised to 0–1 before they are multiplied.

| Key | Weight | Used for |
| --- | ---: | --- |
| `mood` | 0.16 | Mood match with the seed |
| `vibe` | 0.10 | Vibe overlap with the seed; the listener's vibe affinity at × 0.6 |
| `language` | 0.12 | Same language as the seed |
| `dialect` | 0.08 | Exact dialect match; sub-language at × 0.65 |
| `genre` | 0.10 | Genre overlap with the seed; the listener's genre affinity at × 0.6 |
| `energy` | 0.10 | Closeness to the seed's energy; to the listener's average at × 0.35 |
| `tempo` | 0.08 | Closeness to the seed's tempo; to the listener's average at × 0.35 |
| `artistAffinity` | 0.14 | Scales the artist terms: profile affinity and the lift for an artist played in the last week |
| `history` | 0.10 | Subtracted when the song is in the recent set |
| `likes` | 0.10 | Added when the song is liked |
| `skips` | 0.12 | Subtracted when the song was skipped before |
| `session` | 0.12 | Scales the session-window terms: energy, language momentum and mood continuity |
| `discovery` | 0.07 | Discovery floor for `explore` candidates in the diversity re-rank |
| `popularity` | 0.05 | Log-scaled play count |
| `freshness` | 0.04 | Released this year or last |
| `diversity` | 0.20 | Penalty multiplier in the diversity re-rank |
| `songAffinity` | 0.12 | A song the listener keeps finishing |
| `dayOfWeek` | 0.04 | The candidate's language share of this weekday's plays minus its share of all plays |
| `novelty` | 0.16 | Swing between novelty and familiarity, signed by the lean: ±0.08 at the extremes |
| `artistFatigue` | 0.04 | Per recent play of one lead artist beyond two within the last ten plays |
| `intentArtist` | 0.18 | This sitting's pull on the lead artist |
| `intentLanguage` | 0.08 | This sitting's pull on the language |
| `intentEnergy` | 0.30 | Energy steer × the candidate's distance from mid energy |
| `intentSkippedSong` | 0.40 | Subtracted for a song skipped in this sitting |

Terms that depend on the taste profile are multiplied by a personal blend of `(0.3 + 0.7 × profile confidence) × (0.4 + 0.6 × intensity)`, where intensity is the recommendation-intensity setting. A new profile therefore leans on popularity and a warm one on taste. Unknown features score 0 rather than a guessed value, and classifier-filled or title-inferred features are scaled by confidence. A candidate in a muted language scores −1, and candidates scoring 0 or less are dropped with reason `low-score`.

Each candidate also receives a boost for its primary source:

| Source | Boost | Source | Boost |
| --- | ---: | --- | ---: |
| `intent` | 0.24 | `history` | 0.10 |
| `related` | 0.18 | `album` | 0.10 |
| `favorite-artist` | 0.14 | `related-artist` | 0.10 |
| `favorite-album` | 0.12 | `style` | 0.10 |
| `proven` | 0.12 | `explore` | 0.08 |
| `verified-trend` | 0.12 | `genre` | 0.07 |
| `rediscovery` | 0.10 | `trending` | 0.06 |

`verified-trend` sits above the catalogue's own `trending` search, which has no evidence, and below the listener's intent and the seed's neighbourhood: evidence that a song is current is evidence about the world, not about this listener.

Three further terms live in `TASTE_WEIGHTS`, outside the override table:

| Key | Weight | Used for |
| --- | ---: | --- |
| `tasteFit` | 0.15 | × the taste fit (0–1) × the personal blend; reason `taste` |
| `seedRepeat` | 0.10 | Subtracted when the song opened the last continuation accepted after this same seed; reason `served` |
| `servedRecently` | 0.04 | A fallback only: subtracted when the caller passes `servedKeys` and no exposure penalty applies. The live plan passes `exposurePenaltyOf` instead (see [The exposure ledger](#the-exposure-ledger)). |

The taste fit is the cosine of the candidate's vector and the listener's taste vector (`vectors.ts`). Each song hashes its artists, album, language, genres, mood, vibes and release decade into 256 signed slots. The taste vector sums favourites and decayed history (finished positive, skipped negative). Plays of the last seven days are the recent taste; once the long-term taste weighs at least 3 (`MIN_LONG_TERM_MASS`), recent listening may hold at most 40 % of the vector (`RECENT_SHARE`), so one unusual night moves the taste without taking it over. With nothing to go on the vector is null and the term is 0. When learned embeddings are already on the device the fit is adjusted by them; the plan never waits for that module.

**Owner overrides.** The owner console's Recommendation Tuning can publish a versioned set of overrides for the 24 keys in the first table (config key `rec-config`, see [admin-console.md](admin-console.md)). Each value is clamped to between half and double its default (`WEIGHT_OVERRIDE_MIN_FACTOR`, `WEIGHT_OVERRIDE_MAX_FACTOR`). The app applies them (`applyWeightOverrides`, loaded lazily by `remoteWeights.ts`) only when the rollout targets this device. `activeWeightsVersion()` then reads, for example, `1.3.0+rc7`, and that string is part of every continuation's `alg` stamp. The Worker mirrors the table key for key (`REC_WEIGHT_TERMS` in `backend/worker/functions/api/admin/recconfig.ts`).

### 6. The sequencer (`sequencer.ts`)

`sequenceSongs` is greedy and deterministic. For each slot it computes a target energy from the arc shape and picks the candidate with the lowest cost.

| Cost term | Value |
| --- | --- |
| Distance from the slot's target energy | × 3 |
| Mood mismatch with the previous song | × 1.2 |
| Same lead artist as the previous song | + 4 |
| Same lead artist within the last three | + 1.5 |
| Previous lead artist appears as a featured credit | + 1 |
| Same album as the previous song | + 1 |
| Energy step beyond 0.35 from the previous song | excess × 2.5 |
| Decade distance from the previous song (capped at 3) | × 0.25 |
| Rank in the scored pool (the taste prior) | up to + 1.0 |
| Transition memory (−1..1) | − memory × 1.5 |
| `lift` shape and a "sure" song (favourite or a recent play) | − 1.2 |
| Familiar first: a "sure" song | − 0.9 × (1 − progress) |
| Familiar first: a discovery | + 1.1 × (1 − progress) |

Arc shapes are `steady`, `build`, `wind-down`, `wave` and `lift`. The engine picks the active tune's shape, else `lift` when the sitting has a skip streak of two or more, else a read of the listener's energy (restless → `lift`, late hours → `wind-down`, otherwise `steady`). One recording family appears once per stretch. Transition memory (`transitions.ts`, `transitionTracker.ts`) records how each hand-off went from heard time: 70 % or more heard counts as completed, under 30 % as skipped, failed playback judges nothing. Every soft rule a small pool forced to give way is reported in `relaxed`.

### 8. Validation (`validation.ts`)

`validateSequence` receives the sequenced stretch followed by the rest of the ranked pool as a reserve, and applies:

1. The hard filter again, for every song, and one song per canonical identity.
2. The language rule in the form the engine chose (see [Queue languages](#queue-languages)).
3. An artist cap of ⌈limit ÷ 4⌉ songs per lead artist (two in a stretch of five).
4. No lead artist back to back, counting the seed as the previous song.
5. The discovery allocation, ⌊share × limit + 0.5⌋.
6. The familiar opening: no discovery in slot 1, nor in slot 2 when four or more songs ship.
7. The style quota while a style is active.
8. Sitting-avoid: a lead artist this sitting pushed away — an artist pull at or below `SITTING_AVOID_PULL` (−0.6), which takes two skips of that artist or one "Not interested" — fills a slot only when nothing else fits. It never costs the mix or back-to-back rules: when placing it would, the stretch ends short and the player asks for more.

When nothing else fits, soft rules give way in the order a listener minds least: the discovery allocation, then the familiar opening, then the artist cap, then the style quota, then sitting-avoid, then the language-mix rules, and only last the rule against the same lead artist twice in a row. Each relaxation is reported with its slot. Hard rules never relax.

### The plan and its deadlines

| Part | What it is |
| --- | --- |
| `songs` | The validated on-device order, built inside one deadline: 8 s normally (`NEXT_DEADLINE_MS`), 3.5 s when the listener is waiting at the end of the queue (`NEXT_URGENT_DEADLINE_MS`, `deadlines.ts`). |
| `refinement` | The AI DJ's order for the same stretch, a separate promise with a 24-second budget (`AI_BUDGET_MS`). The player applies it only to automatic entries that have not started: never the current song, a committed next song, or a song the listener queued or kept. |
| `commit(accepted)` | Publishes "why this song" lines, DJ segues, the `queued` exposure and the seed memory for the songs the player actually accepted. A rejected or cancelled proposal publishes nothing. |
| `topUp(seedNow, n)` | The rest of the ranked pool, re-validated against the song now at the end of the queue. When the queue runs dry before a new plan is ready, the player plays from it instead of pausing. A reserve in another language is never used. |
| `fallback`, `latencyMs`, `alg` | Why the AI did not choose the order, how long the plan took, and the pipeline version (`PIPELINE_VERSION`, `9.0.0`) with the weights version. |

The DJ's order is accepted only if at least `min(3, limit)` of its own picks survive validation and its arc error is no worse than the local order's plus 0.08 (plus 0.2 while a tune is active). Otherwise the local order stays. The player cancels a plan and its DJ request when the queue changes.

### 9. The admission gate (`admission.ts`)

Every automatic change to the queue — a continuation, a refinement, the adaptive re-plan, a reserve top-up — passes `admitSongs`, which reads the listener's restrictions at that moment, after any await: valid metadata, junk and too-short cuts, explicit songs in Kid mode, hidden songs and artists, muted languages, a soft-muted lead artist, another cut of the playing song, anything already queued, recent plays and songs skipped in this sitting. A Queue Builder plan the listener installs keeps its order and passes only the explicit restrictions.

## The exposure ledger

`services/recommendation/exposure.ts` is the one memory of what the listener has already met, shared by every surface. `songIdentity.ts`'s `servedKeySet`, `recordServed` and `resetServedMemory` are thin wrappers over it. There is one row per canonical identity with a timestamp per kind of event (`EXPOSURE_WEIGHTS`):

| Event | Recorded by | Penalty at its freshest | Decays linearly over | Cools a discovery surface for |
| --- | --- | ---: | --- | --- |
| `shown` | A Home shelf when it renders, the AI Playlist | 0.14 | 3 d | 12 h |
| `queued` | The plan's `commit`, the DJ's set | 0.24 | 7 d | 2 d |
| `played` | The playback bus's `counted` event | 0.30 | 10 d | 3 d |
| `completed` | The playback bus's `end`, at the completion ratio | 0.22 | 14 d | 3 d |
| `skipped` | An early manual skip | 0.30 per skip, 3 at most | 21 d | 14 d |
| `disliked` | Hiding a song | 0.80 | 60 d | 45 d |
| `liked` | Favouriting | Pays a quarter of everything else (`LIKED_FORGIVENESS`); never cooled | — | — |
| `replayed` | An explicit "play this again" | Lifts the cooling for 7 d | — | — |

- A cancelled request, a rejected model suggestion and a prefetched song nobody saw are not recorded.
- The penalty reaches the scorer as `ctx.exposurePenaltyOf` with reason `served`. It can never admit a song the hard filter rejects. A plan takes one ledger snapshot so a long stretch cannot reorder under its own feet.
- The ledger holds 600 rows (`EXPOSURE_CAP`) with a 45-day row TTL under the `localStorage` key `vinax.recs.exposure.v1`, with an in-memory mirror used only while storage refuses writes. "Clear personalization profile" and "Erase everything" clear it (`resetExposure`).

**Snooze.** `snoozeSong(song, days)` is the per-song counterpart of the per-artist soft mute: 7, 14 or 30 days (`SNOOZE_DAYS`, 14 by default), keyed by canonical identity so every release of the song goes quiet, with an undo. It is a hard rule while it lasts (`snoozed` in `filters.ts`) and expires on its own.

**Refresh with fewer repeats.** One generation under a stricter rule, on Home (`strict` in `homeRefresh.ts`, read by `surfacePolicy.ts`) and on an AI playlist (`fewerRepeats`). A discovery surface then removes everything with any live exposure instead of moving it to the back. A shelf can come out shorter, and the app says so.

### The engine's memory of its own picks

`recMemory.ts` keeps two device-local memories, cleared by the same two reset actions.

- **Outcomes.** When a playback instance of an automatically queued song ends, `autoOutcomeFor` (`transitionTracker.ts`) judges it once per run: liked, or a natural end with the song completed, is a success; a manual skip before the play counted or inside its first 30 % is a miss; anything else says nothing. Entries are forgotten after 60 days. `provenPicks` returns those with more successes than misses; they feed the `proven` source.
- **Seed memory.** When the player accepts a continuation, its opening songs are remembered against the seed's identity for 12 hours, as canonical keys. The next plan from the same seed passes them to the scorer as `seedRepeatKeys`, so the same song does not open the same way twice.

## Settings and switches

### Familiar, Balanced, Discover

Settings → Recommendations → Discovery (`discoveryMode`). An older `exploreMode: true` setting resolves to Discover.

| | Familiar | Balanced | Discover |
| --- | --- | --- | --- |
| Lean (before the sitting's appetite) | −1 | 0 | +1 |
| Novelty swing on a never-played artist | −0.08 | 0 | +0.08 |
| Share of a stretch open to never-played artists (`DISCOVERY_SHARE`) | 5 % | 20 % | 45 % |
| Extra candidate source | `history` | — | `explore` (reaches Home shelves; in a queue the language rule removes it) |

The share is clamped to 0–50 % after the appetite is applied. A discovery is a song whose lead artist the listener has never played, or an `explore` candidate. Songs fetched for an active tune, pinned mood or style are never counted as discoveries.

### Queue languages

Settings → Recommendations → Queue languages (`queueLanguages` in `store/settingsStore.ts`): `'mix'` ("Your languages", the default) or `'one'` ("One language"). It applies in all three modes. `engine.ts` decides per plan:

- The listener's languages are the pinned languages plus the profile's top three, minus muted ones and `unknown`.
- The mix applies only when the setting is `'mix'` and at least one of those languages differs from the seed's. A listener with one language, or a caller whose context does not set `queueLanguages` (tests, the offline evaluation's default), gets the lock.
- **Mix.** The hard filter receives `allowedLanguages` (the seed's language plus the listener's) and rejects any other known language as `off-language`. The sequencer runs with `languagePolicy: 'prefer'` and validation with `leadLanguage`. Three mix rules are hard under `prefer`: the seed's language fills slots 1 and 2, an off-lead song never follows another, and off-lead songs fill at most ⌊limit ÷ 2⌋ of the stretch. They give way only when no candidate satisfies them, and the trace records `language-mix`. In the sequencer an off-target song in one of the listener's languages costs +0.6 (or −0.35 once three or more target-language songs have run in a row); any other known language costs +2.5.
- **Lock.** `languagePolicy: 'lock'` on the seed's language. Candidates whose known language differs never enter. Validation relaxes the lock only when fewer than three songs would remain: first the listener's own languages are let back in, then the rest. The trace records `language-lock`.

Songs with no language, or `unknown`, pass under both settings. The AI DJ is told which rule is in force and its proposals are gated the same way. The "Switch language" tune moves a lock to another language for that stretch; "Same language" is a score nudge and a DJ instruction, not a policy change.

### Tunes, pinned moods and styles

`tune.ts` defines the tune intents (`TuneIntent`): energetic, chill, romantic, melody, beats (`mass`), devotional, heartbreak, classics, new (`fresh`), same language, switch language, surprise, and the two style intents `dj` and `folk`. "Surprise me" resolves to one of the others at random. "Pin a mood" on the Now Playing page is stored in `sessionStorage` for 45 minutes, overrides the session window's mood and energy, and calls the same rebuild as the matching tune.

`tuneQueue(intent)` keeps everything already played, the current song and every hand-queued song, removes the rest, and requests a new continuation seeded by the current song. An active intent changes four things: it adds the `intent` candidate source (`tuneSearchQuery`, a two-word phrase prefixed with the queue's language — the catalogue returns nothing for longer phrasings); it adjusts scores (`tuneScoreAdjust`: +0.35 for the asked-for mood plus per-intent nudges); it sets the arc (energetic and beats → `build`; chill, melody, romantic, heartbreak, devotional → `wind-down`; surprise → `wave`); and it briefs the DJ, whose arc tolerance is relaxed to 0.2. The tune is cleared when the listener starts a new queue.

#### Staying in a style

`style.ts` reads three styles from a song: `dj` (DJ remixes), `folk` and `devotional`. Words in the title, album, subtitle and credited artists are strong evidence; genre and mood are weak evidence. `sessionStyle` decides the style the listener is in: a style tune sets it, a seed whose words carry a style sets it, a metadata-only seed needs 2 of the last 3 plays to agree, and an ordinary song played by hand clears it. While a style is active: the required `style` source searches catalogue phrases for it; scoring adds `STYLE_WEIGHTS` (+0.4 for a word match, +0.25 for a metadata-only match, −0.3 off-style, 0.1 source boost); validation keeps at least ⌈0.8 × limit⌉ songs in the style while the pool has them (`STYLE_MIN_SHARE`); only one remix of each song plays per sitting (`remixWorkKey`); and a DJ order with fewer style songs than the local order is rejected.

## The queue rules in the player (`store/playerStore.ts`)

- **The next five.** One continuation adds five songs (`NEXT_BATCH`). The player asks for one when a song starts and two or fewer songs remain after it, provided autoplay (or radio) is on, follow mode is off and repeat is off. One request runs per queue version; a queue change cancels it, and a late result is discarded. Additions pass the admission gate and are marked automatic.
- **The DJ builds every queue.** With `djTakeover` (the default) and Autoplay on, tapping a song makes it the seed: the queue becomes that one song and the first continuation is requested at once. Callers that pass `keepList` keep their list. Smart Queue (`features/queue/SmartQueue.tsx`) is one switch over these two settings: it reads on when `autoplay && djTakeover`, and turning it off clears `djTakeover` only.
- **Hand-queued songs go first.** The player tracks which ids the recommender appended and which the listener queued. "Add to queue" inserts before the first automatic song; "Play next" inserts directly after the current song. A re-plan or a tune replaces only the automatic tail. "Keep this song" turns an automatic entry into the listener's own; `regenerateAutoTail` rebuilds every automatic entry after the current song on purpose.
- **Familiar first.** Discovery is held out of slot 1, and out of slot 2 in a stretch of four or more, while any non-discovery candidate remains.
- **Adaptive re-plan (`adaptive.ts`).** Two consecutive skips of automatic songs re-sequence the remaining automatic tail (three songs or more) with the `lift` shape, bringing in a few favourites in the playing song's language, under a lock on that language. Everything passes the admission gate; if fewer than three songs survive, nothing changes. It cannot run again for 90 seconds (`REPLAN_COOLDOWN_MS`).
- **AI Radio (`features/radio/aiRadio.ts`, `pages/AiRadioPage.tsx`).** The page only finds the first songs. `startRadio` puts at most `RADIO_SEED_MAX` (5) seeds in the queue as the listener's list, sets radio mode (so continuations run even with Autoplay off) and an optional tune, and plans the first continuation from the last seed. Seeds come from a song, an artist's top songs, a mood chip's tune query, or free text parsed by `parseRadioPrompt` into a language, decade and mood.

## Home shelves

`buildRecommendations(ctx)` gathers, filters, enriches and ranks without a seed, moves identities the ledger says are still cooling behind the rest, and assembles shelves in `mixes.ts`. The result is memoised for ten minutes per profile state, ledger size and trend-snapshot size. `features/recommendations/useRecommendations.ts` is the hook Home reads it through.

**Refresh (`features/home/homeRefresh.ts`).** Every Home query that designs or rotates content carries the Home generation in its key and is cached for 30 minutes (`HOME_TTL_MS`). The generation moves only on an explicit refresh and when Home opens more than 30 minutes after it started; never while the listener is on Home. Safety changes (Kid mode, a hide, a muted language, "Less like this") rebuild nothing: every list filters by the current safety settings when it renders (`features/home/blocks/shared.tsx`). Made For You is also keyed on a coarse taste stamp (`tasteStamp`).

**One repetition rule (`surfacePolicy.ts`).**

| Surface | Heard / skipped | Shown elsewhere |
| --- | --- | --- |
| `resume` — Continue listening, Recently played and the like | Kept (they are the content) | Kept |
| `personal` — Made For You, the Daily mix, Because you liked | Moved to the back, never removed | Moved to the back |
| `discovery` — trending, new releases, popular picks, mood and AI-designed shelves, the feed | Removed | Moved to the back (removed under "fewer repeats") |
| The automatic queue | Hard rules (`filters.ts`) | The exposure penalty |

**Popular picks for you (`services/ai/trending.ts`, `features/home/useAiTrending.ts`).** Built from the catalogue's trending results and nothing else. The pool passes the hard filter and is collapsed by identity; the on-device scorer orders it. An optional AI re-order of the top 30 may replace that order; it answers with ids from the list it was given, so it can change the order and never the contents.

**Home's own order (`features/home/homeOrder.ts`).** When neither the listener nor the owner chose an order, `orderHomeBlocks` reorders the visible blocks from the time of day, taps inside each block (`homeTaps.ts`, 14-day half-life), outcomes of songs started from a block (`homeSignals.ts`) and genre affinity. Each block moves at most three places; `sessionHomeOrder` computes the order once per session so nothing moves while the listener scrolls.

**De-duplication (`features/home/shelfLedger.ts`).** A shelf filters out songs already claimed by any shelf earlier in display order, by catalogue id and by canonical identity, then records its own claim. A shelf that had at least six songs keeps at least six (`SHELF_FLOOR`).

## Observing and debugging

The developer breakdown is on when the URL has `?debug=recs`, when `localStorage` has `vinax.debug.recs` set to `1`, or in a development build (`store/recsDebugStore.ts`). The panel (`features/recommendation/RecsDebugPanel.tsx`) is a lazy chunk, and the engine publishes nothing while the switch is off. For each recent continuation it shows:

- **Trace** — mode, arc shape, language policy, discovery share, this sitting's intent, how many songs survived each stage, spacing repairs and relaxed rules.
- **Selected songs** — position, rank before sequencing, score, source, every scoring component, and whether the local engine or the AI chose the order.
- **Passed over** — the best ranked songs that were not chosen.
- **Rejected** — up to 80 candidates with the rule that turned each away and the stage (`filter`, `rank` or `validate`).

For a listener, the track menu's "Why this song?" (`explanations.ts`) turns the top reason into a sentence. A `served` reason there means the exposure ledger or the seed memory held the song back.

## Changing it safely

| If you change | This must pass |
| --- | --- |
| Any weight, source, filter, sequencer or validation rule | The unit tests beside the modules (`services/recommendation/*.test.ts`), and the offline evaluation: `node scripts/eval-recs.mjs --no-baseline` from `frontend/` ([evaluation.md](evaluation.md)) |
| A key in the weight table | `weightEffects.test.ts` (each key moves its own terms and no others) and `weightOverrides.test.ts`; update `REC_WEIGHT_TERMS` in the Worker to match |
| Anything about repetition (the ledger, seed memory, surface policy) | `repetition.accept.test.ts` and `exposure.test.ts`. The evaluation's metrics cannot see repetition across sessions; see [evaluation.md](evaluation.md). |
| Canonical identity | `identityContract.test.ts` and the Worker's suite, which read the same `shared/identity-vectors.json` |
| Queue languages or the next five | `nextFive.test.ts`, `engine.test.ts`, `validation.test.ts`, `sequencerPolicy.test.ts`; the evaluation's `mixed-queue` fixture counts mix violations as hard failures |
| Styles | `style.test.ts`, `engine.style.test.ts` |

## History that still matters

- **`servedRecently` (0.04) is a leftover.** It was the only cross-surface penalty before the exposure ledger and was too small to change any order. The scorer keeps it as a fallback for callers that pass `servedKeys`; the ledger's penalties (0.14–0.80) are what act in the app. [history/audit-9.1.md](history/audit-9.1.md) records the five separate memories the ledger replaced.
- **Adjacency relaxes last.** An earlier order gave the back-to-back rule away first, so a Familiar-mode queue (almost no discovery budget) shipped runs of one artist. The relaxation order above is the fix; do not reorder the tiers without the evaluation.
- **`trending` is not a chart.** The source tag predates the verified chart signal. It is a catalogue search, which is why its listener-facing reason avoids the word.
- **File names.** `services/ai/trending.ts` and `useAiTrending.ts` are named for the shelf's earlier title; the shelf is "Popular picks for you". `features/home/dedupeShelves.ts` is an older identity-based de-duplicator: Home de-duplicates through `shelfLedger.ts` and imports only `resetShelfDeduper` from the older file.
- **A server endpoint with a similar name.** `backend/worker/functions/api/recommendations.ts` serves "songs like these" from the catalogue for a list of seed ids. It is not part of this engine and nothing in `frontend/src` calls it.
