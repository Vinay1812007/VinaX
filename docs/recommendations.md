# Recommendations

This document covers how VinaX decides what to play and show as of 7.1: the ten-stage next-song pipeline, the scoring weights, the long-term taste profile and its event weights, the short-term session intent, the Familiar / Balanced / Discover modes, the 7.1 queue rules (the next five, same language, familiar first, tunes and pinned moods, hand-queued songs first), the "Trending for you" shelf, Home de-duplication, and the developer breakdown. Everything described here runs on the device. The optional AI steps are described in [ai.md](ai.md); what is stored and what leaves the device is in [data-and-privacy.md](data-and-privacy.md).

All paths below are relative to `frontend/src/`.

## The pieces

| Piece | Where | Lifetime |
| --- | --- | --- |
| Taste profile (languages, artists, songs, hours, weekdays, energy preference, dials, soft mutes) | `services/personalization/profile.ts`, `storage.ts`, `updater.ts` | Persisted on the device; decays over time |
| Event weights and decay clock | `services/personalization/eventWeights.ts` | Constants |
| Session window (last 10 songs of this tab: mood, energy, language) and the mood pin | `services/personalization/session.ts`, `features/player/moodPin.ts` | `sessionStorage`; ends with the tab |
| Session intent (skips, completions, likes, hand queue-adds, plays from search) | `services/personalization/sessionIntent.ts` | `sessionStorage`; ends with the tab or after 45 minutes of silence |
| Recommendation context (everything a ranking pass reads) | `services/recommendation/context.ts` | Built per call |
| Next-song engine and Home shelf builder | `services/recommendation/engine.ts` | — |
| Queue ownership (automatic tail vs. hand-queued songs) | `store/playerStore.ts` | In memory; a reload starts clean |

## The next-song pipeline

`recommendNextSongs(seed, ctx, options)` in `services/recommendation/engine.ts` is the single entry point for autoplay, radio (`startRadioRecommendations`) and playlist continuation (`continuePlaylist`). It runs the stages below in order. `limit` is clamped to 0–40 and defaults to 8; the player asks for 5 (see [The next five](#the-next-five)).

| # | Stage | Module | What it does |
| --- | --- | --- | --- |
| 1 | Candidate generation | `candidates.ts` | Gathers a pool from several sources in parallel. Every fetch is individually fault tolerant: a failed source shrinks the pool and nothing else. |
| 2 | Hard filtering | `filters.ts` | Applies rules, not preferences. Each rejection has a named reason. Versions of one song collapse onto the best cut. Runs before feature extraction so the classifier only sees songs that can play. |
| 3 | Feature extraction | `services/ai/recommendations.ts` (`enrichSongs`) | Adds classifier metadata (mood, vibe, genre, energy, tempo) when it is cached or arrives within 1.8 s. Optional. Results are cached for 30 days, at most 500 songs. |
| 4 | Context scoring | `scoring.ts` | Scores each candidate against the seed, the taste profile, the hour, the weekday and the session window. Every term is recorded as a reason. |
| 5 | Diversity and repeat penalties | `reranking.ts`, `scoring.ts` | A greedy diversity re-rank penalises repeated artists, genres and languages against the last four picks; artist fatigue and the recent-play demotion apply in the scorer. |
| 6 | Session adjustment | `sessionIntent.ts`, `scoring.ts` | This sitting's behaviour pulls artists and languages up or down, steers energy and sets the appetite for discovery. |
| 7 | Exploration tuning | `scoring.ts`, `engine.ts` | The discovery mode sets a signed novelty swing in the score and the share of a queue that may go to never-played artists. |
| 8 | Ranking | `scoring.ts`, `engine.ts` | Sorts, shuffles within 0.05-wide score bands using the session salt, re-ranks for diversity, then applies any active tune's per-song nudge. When the AI DJ is off, an optional AI re-rank of the top 30 adds up to +0.12 per song here. |
| 9 | Queue sequencing | `sequencer.ts` | Orders the top 40 into a stretch: energy arc, mood flow, transition memory, artist and album spacing, era, language lock, discovery budget, familiar first. |
| 9b | AI DJ (optional) | `services/ai/dj.ts` | May re-order a sample of the pool and propose a few catalogue-verified songs. See [ai.md](ai.md). |
| 10 | Validation | `validation.ts` | Re-checks the final order, whoever produced it, against every rule. |

The AI never writes to the queue. Whatever it returns goes through stage 10, and the DJ's order is accepted only if at least `min(3, limit)` songs survive validation and its arc error is no worse than the local order's plus 0.08 (plus 0.2 while a tune is active). Otherwise the local order, validated the same way, ships.

### Stage 1 — candidate sources

| Source tag | What is gathered |
| --- | --- |
| `related` | Catalogue suggestions for the seed (30), for up to 3 distinct recent listens (12 each) and for 3 salt-rotated favourites (10 each) |
| `favorite-artist` | A search for the seed's lead artist (20) and for 3 of the listener's top 8 artists (10 each) |
| `favorite-album` | The rest of up to 2 albums the listener has favourited songs from |
| `trending` | A search for the seed's language and genre (15), plus trending seeds for the listener's top 2 and first 3 pinned languages (15 each). With no language signal at all the pool falls back to two default languages. |
| `intent` | Two pages of a catalogue search for the active tune or pinned mood, in the queue's language (20 each). Only present when an intent is active. |
| `explore` | Discover mode only: trending picks in 2 languages the listener has never played, pinned or muted (10 each) |
| `history` | Familiar mode only: up to 12 favourites and 10 finished songs, in the seed's language, without a fetch |
| `rediscovery` | Up to 15 songs completed more than 14 days ago, without a fetch |

Before the pool leaves this stage it drops blocked songs, junk tracks, artists under an active "show fewer like this" soft mute, and explicit songs when kid mode is on.

### Stage 2 — hard filter reasons

`rejectReasonFor` checks, in this order: `invalid` (no id, title or artist list), `junk` (dialogue, background score, jukebox, trailer, promo, ringtone and similar titles), `too-short` (a known duration under 90 s), `explicit` (kid mode), `blocked`, `muted-language`, `seed` (the seed or another version of it), `already-queued` (by id or canonical identity), `recently-played` (the profile's recent ids, or the identity of any of the last 20 history entries), `skipped-this-session`. Survivors that share a canonical identity are collapsed with reason `duplicate-version`, keeping the original over a remaster over an alternate cut, then the more-played one.

Canonical identity (`songIdentity.ts`, `songKey`) is the normalised title plus the primary artist. Normalisation is Unicode-safe (NFKC, combining marks kept so Indic vowel signs survive), strips version decorations in brackets or after a dash (film credit, remix, remaster, live, lofi, a year, and so on) and strips featured-artist suffixes.

### Stage 9 — the sequencer

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
| Transition memory (−1..1: hand-offs finished before score positive, skipped ones negative) | − memory × 1.5 |
| `lift` shape and a "sure" song (favourite or in the last 60 plays) | − 1.2 |
| Familiar first: a "sure" song | − 0.9 × (1 − progress) |
| Familiar first: a discovery | + 1.1 × (1 − progress) |

Arc shapes are `steady`, `build`, `wind-down`, `wave` and `lift`. The engine chooses the shape in this order: the active tune's shape, then `lift` when the sitting has a skip streak of two or more, then the listener-energy read (`restless` or `wavering` → `lift`, late hours → `wind-down`, otherwise `steady`).

Transition memory (`transitions.ts`, `transitionTracker.ts`) records how each hand-off went: 70 % or more heard counts as completed, under 30 % as skipped.

### Stage 10 — validation

`validateSequence` receives the sequenced stretch followed by the rest of the ranked pool as a reserve, and applies:

1. The hard filter again, for every song.
2. One song per canonical identity.
3. The language lock. Songs whose language is known and differs from the lock are dropped. If that leaves fewer than three songs, languages the listener plays (pinned languages and the profile's top three) are let back in; only if that is still short is the rest allowed. The trace records `language-lock` as relaxed.
4. An artist cap of ⌈limit ÷ 4⌉ songs per lead artist (two in a stretch of five). Overflow returns only when the pool cannot otherwise fill the stretch; the trace records `artist-cap` as relaxed.
5. No lead artist back to back, counting the seed as the previous song. A later song is pulled forward to break a pair; the trace counts these repairs.

Order is otherwise preserved.

## Scoring weights

These are the values in `services/recommendation/weights.ts` (`SCORING_WEIGHTS_VERSION` is `1.2.0`). Feature values are normalised to 0–1 before they are multiplied.

| Key | Weight | Used for |
| --- | ---: | --- |
| `mood` | 0.16 | Mood match with the seed |
| `vibe` | 0.10 | Vibe overlap with the seed; listener's vibe affinity at × 0.6 |
| `language` | 0.12 | Same language as the seed |
| `dialect` | 0.08 | Exact dialect match; sub-language at × 0.65 |
| `genre` | 0.10 | Genre overlap with the seed; listener's genre affinity at × 0.6 |
| `energy` | 0.10 | Closeness to the seed's energy; to the listener's average at × 0.35 |
| `tempo` | 0.08 | Closeness to the seed's tempo (80 BPM span); to the listener's average at × 0.35 |
| `artistAffinity` | 0.14 | Declared for artist affinity (the scorer applies the profile's artist weight at 0.3 × the personal blend) |
| `history` | 0.10 | Subtracted when the song is in the recent set |
| `likes` | 0.10 | Added when the song is liked |
| `skips` | 0.12 | Subtracted when the song was skipped before |
| `session` | 0.12 | Declared for the session window (the scorer applies up to ±0.07 for energy and +0.03 for language momentum, ramping in over five plays) |
| `discovery` | 0.07 | Discovery floor for `explore` candidates in the diversity re-rank (× 0.2) |
| `popularity` | 0.05 | Log-scaled play count (× 3, capped); 0.04 when unknown |
| `freshness` | 0.04 | Released this year or last |
| `diversity` | 0.20 | Penalty multiplier in the diversity re-rank |
| `songAffinity` | 0.12 | A song the listener keeps finishing |
| `dayOfWeek` | 0.04 | Weekday rhythm |
| `novelty` | 0.16 | Swing between novelty and familiarity, signed by the lean: ±0.08 at the extremes, 0 when neutral |
| `artistFatigue` | 0.04 | Per recent play of one lead artist beyond two within the last ten plays, capped at four steps |
| `intentArtist` | 0.18 | This sitting's pull on the lead artist (−1..1) |
| `intentLanguage` | 0.08 | This sitting's pull on the language (−0.6..0.6) |
| `intentEnergy` | 0.30 | Energy steer (−0.3..0.3) × the candidate's distance from mid energy |
| `intentSkippedSong` | 0.40 | Subtracted for a song skipped in this sitting |

Terms that depend on the taste profile are multiplied by a personal blend of `(0.3 + 0.7 × profile confidence) × (0.4 + 0.6 × intensity)`, so a new profile leans on popularity and trending and a warm one leans on taste. Intensity is the recommendation-intensity setting.

Each candidate also receives a source boost:

| Source | Boost |
| --- | ---: |
| `intent` | 0.24 |
| `related` | 0.18 |
| `favorite-artist` | 0.14 |
| `favorite-album` | 0.12 |
| `rediscovery` | 0.10 |
| `history` | 0.10 |
| `explore` | 0.08 |
| `trending` | 0.06 |

Other fixed terms in the scorer: a song in the profile's recent list loses 0.5; an artist played in the last seven days gains 0.05 × blend; an active festival window adds 0.14 for its languages and 0.10 for its moods; the four taste dials (adventurous, recency, energy, vocal) add small signed nudges that are zero at the neutral default. A candidate in a muted language scores −1. Candidates scoring 0 or less are dropped with reason `low-score`.

## Taste profile and event weights

Every listening event bumps the language, the first three credited artists and the song by one delta from `services/personalization/eventWeights.ts` (`EVENT_WEIGHTS_VERSION` is `1.1.0`).

| Event | Weight | When |
| --- | ---: | --- |
| `PLAY` | 1.0 | A play that has been heard for 5 seconds |
| `COMPLETE` | 2.0 | A song finishes |
| `FAVORITE` | 3.0 | A like (the same amount is removed on unlike) |
| `QUEUE_ADD` | 0.5 | "Add to queue" or "Play next" |
| `SEARCH_PLAY` | 1.5 | A play started from the listener's own search, on top of the `PLAY` |
| `SKIP` | −0.75 | A manual skip before 30 % of the song. Because `SKIP_RETRACTS_PLAY` is on, the skip also takes back the `PLAY` bump, for a total of −1.75. |
| `SOFT_MUTE` | −3.75 | "Show fewer like this"; also mutes the lead artist for 14 days |

A song flipped past before the 5-second mark never earns its `PLAY` and is not recorded as a skip in the profile; it is still noted in the session intent. Positive affinity halves 14 days after the last signal; skips halve after 30 days. No single affinity score can exceed 60.

## Session intent

`sessionIntent.ts` keeps a ring of at most 40 events for the current tab. A sitting ends after 45 minutes without an event. An action 30 minutes old counts for half of a fresh one. Nothing here is written to the long-term profile.

| Event | Pull on the artist | Pull on the language |
| --- | ---: | --- |
| `skip` | −0.40 | 40 % of the artist pull, clamped to ±0.6 |
| `complete` | +0.15 | same rule |
| `like` | +0.50 | same rule |
| `unlike` | −0.30 | same rule |
| `queue_add` | +0.35 | same rule |
| `search_play` | +0.45 | same rule |

`deriveIntent` reduces the ring to:

- **Skip streak and completion streak** — consecutive verdicts ending at the most recent one. Likes and queue-adds do not break a streak.
- **Artist pull** (−1..1) and **language pull** (−0.6..0.6).
- **Skipped song ids** — a song skipped in this sitting is hard-filtered from next-song results until it is completed or the sitting ends.
- **Energy steer** (−0.3..0.3) — mean energy of completed songs minus mean energy of skipped songs, once there are at least two of each.
- **Discovery appetite** (−1..1) — +0.2 at four straight completions and +0.1 for each further one (up to four more); −0.3 at two straight skips and −0.15 for each further one (up to four more); −0.1 per search play or hand queue-add, down to −0.3.

The scorer fades the intent in over its first three events. The appetite also moves the lean by × 0.6 and the queue's discovery share by × 0.15.

## Familiar, Balanced, Discover

The mode is set in Settings under Recommendations → Discovery (`discoveryMode`). An older `exploreMode: true` setting resolves to Discover.

| | Familiar | Balanced | Discover |
| --- | --- | --- | --- |
| Lean (before the sitting's appetite) | −1 | 0 | +1 |
| Novelty swing on a never-played artist | −0.08 | 0 | +0.08 |
| Share of a stretch open to never-played artists | 5 % | 20 % | 45 % |
| Extra candidate source | Favourites and finished songs (`history`) | — | Trending picks in unheard languages (`explore`). They reach Home shelves; in a queue the language lock removes them. |
| Queue language | Seed's language | Seed's language | Seed's language |

The share is clamped to 0–50 % after the appetite is applied. A discovery is a song whose lead artist the listener has never played, or an `explore` candidate. Songs fetched for an active tune or pinned mood are never counted as discoveries: they are the request itself.

## The 7.1 queue rules

### The next five

One continuation adds five songs (`NEXT_BATCH = 5` in `store/playerStore.ts`). The player asks for a continuation when a song starts and two or fewer songs remain after it, provided autoplay (or radio) is on, follow mode is off and repeat is off. Only one request runs per queue version; a result that arrives after the listener started something else is discarded. Additions pass one more freshness, mute, block and explicit check before they are appended and marked as automatic.

With the "DJ builds every queue" setting on (`djTakeover`, the default), tapping a song makes that song the seed: the queue becomes that one song and the first continuation is requested at once. Callers that pass `keepList` (Queue Builder plans, explicit queues) keep their list.

### Same language

Every continuation is locked to the seed song's language in all three discovery modes. The sequencer drops candidates whose known language differs, the DJ is told the current language and its proposals are gated on it, and validation enforces the lock last. Songs with no language, or `unknown`, pass. The only way to move the lock is the "Switch language" tune, which moves it to another pinned language (or another language present in the pool); the queue still speaks one language. The lock relaxes only in validation, and only when fewer than three songs would remain.

### Familiar first, then gradual introduction

The sequencer's `familiarFirst` option is on by default. Discovery is held out of slot 1, and out of slot 2 as well when the stretch has four or more slots, as long as any non-discovery candidate remains. A "sure" song (a favourite, or one of the last 60 plays) earns a cost reduction that is largest in the first slot and fades to zero by the last; a discovery pays a cost that fades the same way. The first slot's reason reads "a familiar way in". The DJ prompt carries the same rule: the strongest, most familiar hand-off first, discoveries in the second half, never in slot 1. Pool entries sent to the DJ carry a `known` flag for songs or artists the listener has played.

### Tune this queue and Pin a mood

"Tune this queue" offers twelve intents (`tune.ts`): More energetic, More chill, More romantic, More melody, More beats, Devotional, Heartbreak, More classics, More new, Same language, Switch language, Surprise me. The chips appear on the Queue page, on the Now Playing page and in the command palette. "Surprise me" resolves to one of the other eleven at random.

"Pin a mood" on the Now Playing page offers Romantic, Energetic, Chill, Melancholy and Devotional. A pin is stored in `sessionStorage` for 45 minutes, overrides the session window's mood and energy at full weight, and calls the same rebuild as the matching tune. Tapping the active pin clears it and rebuilds without an intent.

`tuneQueue(intent)` keeps everything already played, the current song and every hand-queued song, removes the rest, and requests a new continuation seeded by the current song. An active intent changes four things:

| What | How |
| --- | --- |
| Candidates | Nine of the twelve intents have a catalogue query (`tuneSearchQuery`), prefixed with the queue's language; two pages of results enter the pool with source `intent`. "Same language", "Switch language" and "Surprise me" have none. A pinned mood with no active tune uses the same table. |
| Score | `tuneScoreAdjust` adds +0.35 when the song's mood is the asked-for mood, plus per-intent nudges: classics +0.5 / −0.4 by release year, new +0.5 / −0.3, same language +0.3 / −0.6, switch language +0.4 / −0.6, energetic and chill ±0.4 by energy, title cues for devotional (+0.6), beats and melody (+0.35). |
| Arc | Energetic and beats → `build`; chill, melody, romantic, heartbreak, devotional → `wind-down`; surprise → `wave`. |
| DJ brief | A one-sentence instruction is sent as the highest-priority adjustment, and the DJ's arc tolerance is relaxed to 0.2. |

The active tune is cleared when the listener starts a new queue. If the rebuild adds nothing, a toast says so and the queue keeps the songs it has.

### Hand-queued songs go first

The player tracks two id sets in memory: songs the recommender appended and songs the listener queued by hand.

- "Add to queue" inserts the song before the first automatic song after the current one, behind the listener's own list and earlier hand-queued songs.
- "Play next" inserts it directly after the current song and marks it as hand-queued.
- An adaptive re-plan and a tune replace only the automatic tail. Hand-queued songs keep their place and order.

### Adaptive re-plan

Two consecutive skips of automatic songs re-sequence the remaining automatic tail (three songs or more) with the `lift` shape, bringing in up to four favourites in the queue's language that are neither queued nor among the last 15 plays. A completed song or a skip of a hand-queued song resets the streak. A re-plan cannot run again for 90 seconds.

## Home shelves

`buildRecommendations(ctx)` gathers the same candidate sources without a seed, enriches, ranks, moves identities served in the last seven days behind fresh ones, and assembles shelves in `mixes.ts`. On a profile with at least five plays the optional AI re-rank may reorder the top 30. The result is memoised for ten minutes per profile state. Every song placed on a shelf gets a plain-language reason for the track menu's "Why this song?".

### Trending for you

`services/ai/trending.ts` and `features/home/useAiTrending.ts` build Home's trending shelf from the catalogue's trending results and nothing else. The pool passes the hard filter (mutes, blocks, explicit, junk) and is collapsed by canonical identity. The on-device scorer orders it; songs the scorer drops still appear after the ranked ones. When the listener's "AI-designed shelves on Home" setting and the owner's `aiHome` flag are both on, an AI re-order of the top 30 may replace that order if it arrives within 4 seconds and actually changes it. The AI answers with ids from the list it was given, so it can change the order and never the contents. The shelf reports whether the order is `ai` or `local`. One curation runs per trending pool and is kept for 15 minutes.

### De-duplication across shelves

Home is built from blocks that mount and re-render independently, so `features/home/shelfLedger.ts` keeps a shared ledger keyed by block and shelf position. A shelf filters out songs already claimed by any shelf earlier in display order, then records its own claim; claims are replaced on re-render, so the result is stable. Since 7.1 the ledger claims a song by catalogue id and by canonical identity (`songKey`), so another cut of a song shown on an earlier shelf is dropped too. Identity is also collapsed where the lists are built: in `mixes.ts` for the personal mixes, in the hard filter for queues and in `trending.ts` for the trending shelf. `features/home/dedupeShelves.ts` is an older identity-based helper that is exercised by unit tests and is not called by the Home page.

## Developer breakdown

The breakdown is on when the URL has `?debug=recs`, when `localStorage` has `vinax.debug.recs` set to `1`, or in a development build. The panel (`features/recommendation/RecsDebugPanel.tsx`) is a lazy chunk; the app layout decides whether to mount it once, at load. The engine checks the switch before every publish and publishes nothing when it is off.

The store keeps the last 12 continuations. Each shows:

- **Trace** — mode, arc shape, language lock and policy, discovery share, this sitting's intent, how many songs survived each stage (gathered → admitted → ranked → sequenced → queued), spacing repairs and relaxed rules.
- **Selected songs** — position, rank before sequencing, final score, candidate source, every scoring component, whether the local engine or the AI chose the order, and the DJ's confidence when it picked.
- **Passed over** — the best 15 ranked songs that were not chosen, with their components.
- **Rejected** — up to 80 candidates with the rule that turned each away and the stage (`filter`, `rank` or `validate`).

## Tests

The rules above are pinned by unit tests next to the modules: `nextFive.test.ts` (same language in every mode, familiar opening, intent candidates), `discoveryModes.test.ts`, `sequencer.test.ts`, `validation.test.ts`, `filters.test.ts`, `tune.test.ts`, `adaptive.test.ts`, `songIdentity.test.ts`, `sessionIntent.test.ts`, `eventWeights.test.ts` and `services/ai/trending.test.ts`. See [testing.md](testing.md) for how to run them.
