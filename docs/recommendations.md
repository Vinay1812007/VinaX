# Recommendations

This document covers how VinaX decides what to play and show as of 9.0: the ten-stage next-song pipeline (with 8.2's album, related-artist, genre and proven-pick sources, the `no-audio` rule, the taste fit and the served and seed memories, and 9.0's sitting-avoid rule, anchor sources and capped recent taste), the scoring weights, the long-term taste profile and its event weights, the short-term session intent, the Familiar / Balanced / Discover modes, the queue rules (the next five, queue languages, familiar first, tunes and pinned moods, hand-queued songs first, AI Radio and Smart Queue), the "Popular picks for you" shelf, Home's own order, Home de-duplication, and the developer breakdown. Everything described here runs on the device. The optional AI steps are described in [ai.md](ai.md); what is stored and what leaves the device is in [data-and-privacy.md](data-and-privacy.md).

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
| Playback-session measurement (what was heard; PLAY / SKIP / COMPLETE) | `services/playback/session.ts` | Per playback instance |
| Admission gate for every automatic queue change | `services/recommendation/admission.ts` | Reads the listener's current state on each call |
| On-device taste vectors (8.2) | `services/recommendation/vectors.ts` | Computed per scoring pass |
| The engine's memory of its own picks (8.2): outcomes of automatic picks, and each seed's last opening | `services/recommendation/recMemory.ts` | `localStorage`; 60 songs for 60 days, 40 seeds for 12 hours |
| Home usage signals and the session's Home order (8.2) | `features/home/homeSignals.ts`, `homeOrder.ts` | `localStorage` (decayed, 14-day half-life); the order in `sessionStorage` |
| Surface policy (9.0): how each surface treats songs just heard, skipped or shown elsewhere | `services/recommendation/surfacePolicy.ts` | Pure; read per Home visit |
| Exposure ledger (9.1): one memory of what was shown, queued, played, completed, skipped, liked, disliked or replayed | `services/recommendation/exposure.ts` | `localStorage`; 600 songs, 45-day TTL |
| Song snoozes (9.1): "not this song, for a while" | `services/recommendation/exposure.ts` | `localStorage`; 7/14/30 days, expires itself |
| Verified-trend signal (7.2) and live-web discovery signal (9.1), both read from a snapshot and never waited for | `services/trends/signal.ts`, `services/discovery/signal.ts` | In memory; refreshed in the background |
| Evidence behind an evidence-backed pick (9.1): the chart or page, and when it was observed | `store/evidenceStore.ts` | In memory only |
| Home refresh policy (9.0): when Home builds itself again | `features/home/homeRefresh.ts` | In memory; one generation per refresh or half hour |

## How listening becomes taste

Since 7.2 everything that learns from listening reads one measurement: the seconds of a playback instance that were actually heard (`services/playback/session.ts`). The playhead position is never used as a proxy for listening.

| Term | Meaning |
| --- | --- |
| Playback instance | One start of one track: a tap, an advance, a restore, or one repeat-one loop. It has an id, the song, and the song it was handed off from when the queue moved forward one step. |
| Run | Consecutive instances of one track through repeat-one. A run learns at most one PLAY, one SKIP and one COMPLETE, so looping a song cannot flood the profile. |
| Heard time | A time update credits the step since the last one only when no seek is pending, the player is not buffering, and the step is positive and no larger than 4 s × rate or the wall-clock time since the last update × rate × 1.25 + 1 s. The player declares its own seeks (the listener's, resume-from-position, A-B repeat, repeat-one's jump to 0), and the wall-clock allowance keeps throttled background updates creditable. Pauses produce no step. At 2× speed a 200-second song is fully heard after 100 seconds. |

| Verdict | Duration known | Duration unknown |
| --- | --- | --- |
| `PLAY` | Heard at least the smaller of 5 s and 70 % of the song | Heard 5 s |
| `COMPLETE` | The song ended naturally and at least 70 % of it was heard | Ended naturally after 30 s heard |
| `SKIP` | A manual skip after the PLAY counted, with under 30 % heard | … with under 30 s heard |
| Early leave | A manual skip before the PLAY counted: noted in this sitting's intent and flagged in history, never written to the long-term profile | same |
| Failed | Every source failed: no SKIP and no transition verdict | same |

Seeking to the last seconds and letting the song end is therefore neither a PLAY nor a COMPLETE, and ten seconds heard at the end of a song is still a skip. The player publishes `counted` (the moment a PLAY counts), `credit`, `end`, `served` and `refined` events on one bus; the listen clock, transition memory and opt-in usage analytics subscribe to it instead of measuring on their own. A stale song-detail refetch after a playback failure is tied to its instance and cancelled when the track changes, so it can never skip or reload the song the listener chose since.

## The next-song pipeline

`planNextSongs(seed, ctx, options)` in `services/recommendation/engine.ts` is the entry point for the live queue; `recommendNextSongs` wraps it for radio (`startRadioRecommendations`), playlist continuation (`continuePlaylist`) and tests. It runs the stages below in order. `limit` is clamped to 0–40 and defaults to 8; the player asks for 5 (see [The next five](#the-next-five)).

| # | Stage | Module | What it does |
| --- | --- | --- | --- |
| 1 | Candidate generation | `candidates.ts` | Gathers a pool from several sources in parallel. Every fetch is individually fault tolerant: a failed source shrinks the pool and nothing else. |
| 2 | Hard filtering | `filters.ts` | Applies rules, not preferences. Each rejection has a named reason. Versions of one song collapse onto the best cut. Runs before feature extraction so the classifier only sees songs that can play; since 8.2 that includes turning away songs the catalogue cannot stream (`no-audio`). Under the "Your languages" setting it also holds the allow-list of languages a stretch may draw from (`allowedLanguages`; rejection `off-language`). |
| 3 | Feature extraction | `services/ai/recommendations.ts` (`enrichSongs`) | Adds classifier metadata (mood, vibe, genre, energy, tempo) when it is cached or arrives within 1.8 s. Optional. Results are cached for 30 days, at most 500 songs. |
| 4 | Context scoring | `scoring.ts` | Scores each candidate against the seed, the taste profile, the hour, the weekday and the session window, and (8.2) its taste fit on the device's vectors. Every term is recorded as a reason. |
| 5 | Diversity and repeat penalties | `reranking.ts`, `scoring.ts` | A greedy diversity re-rank penalises repeated artists, genres and languages against the last four picks; artist fatigue and the recent-play demotion apply in the scorer, and (8.2) small penalties for songs another surface showed recently and for the last opening after the same seed. |
| 6 | Session adjustment | `sessionIntent.ts`, `scoring.ts` | This sitting's behaviour pulls artists and languages up or down, steers energy and sets the appetite for discovery. |
| 7 | Exploration tuning | `scoring.ts`, `engine.ts` | The discovery mode sets a signed novelty swing in the score and the share of a queue that may go to never-played artists. |
| 8 | Ranking | `scoring.ts`, `engine.ts` | Sorts, shuffles within 0.05-wide score bands using the session salt, re-ranks for diversity, then applies any active tune's per-song nudge. When the AI DJ is off, an optional AI re-rank of the top 30 adds up to +0.12 per song here. |
| 9 | Queue sequencing | `sequencer.ts` | Orders the top 40 into a stretch: energy arc, mood flow, transition memory, artist and album spacing, era, language policy, discovery budget, familiar first. |
| 9b | AI DJ (optional) | `services/ai/dj.ts` | May re-order a sample of the pool and propose a few catalogue-verified songs. See [ai.md](ai.md). |
| 10 | Validation | `validation.ts` | Re-checks the final order, whoever produced it, against every rule. |

The AI never writes to the queue. Whatever it returns goes through stage 10, and the DJ's order is accepted only if at least `min(3, limit)` of the DJ's own picks survive validation and its arc error is no worse than the local order's plus 0.08 (plus 0.2 while a tune is active). Otherwise the local order, validated the same way, stays.

### Deadlines, the plan and the refinement (7.2)

The result is a plan, local first:

| Part | What it is |
| --- | --- |
| `songs` | The validated on-device order, built inside one end-to-end deadline: 8 s normally, 3.5 s when the listener is waiting at the end of the queue (`deadlines.ts`). Candidate gathering is not waited for past the deadline; the AI re-rank (used when the DJ is off) waits only inside what is left of it. |
| `refinement` | The AI DJ's order for the same stretch, a separate promise with its own 24-second budget. The player applies it only to automatic entries that have not started: never the current song, never a committed next song (inside the last 30 s of the current song, or while a crossfade runs), never a song the listener queued or kept. |
| `commit(accepted)` | Publishes "why this song" lines, DJ segues and the DJ's surfaced-song memory for the songs the player actually accepted. A proposal that is rejected, cancelled or superseded publishes nothing. |
| `topUp(seedNow, n)` | The rest of the ranked pool, re-validated against the song now at the end of the queue with the same final policy. When the queue runs dry before a new plan is ready, the player plays from it at once instead of pausing. A reserve in another language is never used. |
| `fallback`, `latencyMs`, `alg` | Why the AI did not choose the order (`deadline`, `ai_timeout`, `ai_unavailable`, `ai_rejected`, `error`), how long the plan took, and the pipeline and weights version. |

The player cancels a plan and its DJ request when the queue changes (`AbortController`). The engine itself is loaded when a queue is first extended; it is not in the first-load bundle.

### The admission gate

Every automatic change to the queue — a continuation, an AI refinement, the adaptive re-plan, a reserve top-up — passes `admitSongs` in `admission.ts`, which reads the listener's restrictions at that moment, after any await: valid metadata, junk and too-short cuts, explicit songs in Kid mode, hidden songs and artists, muted languages, a soft-muted lead artist, another cut of the playing song, anything already queued (by id or identity), recent plays (by identity) and songs skipped in this sitting. A Queue Builder plan the listener installs keeps its order and passes only the explicit restrictions (invalid, explicit in Kid mode, hidden, muted language).

### Stage 1 — candidate sources

| Source tag | What is gathered |
| --- | --- |
| `related` | Catalogue suggestions for the seed (30), for up to 3 distinct recent listens (12 each) and for 3 salt-rotated favourites (10 each) |
| `favorite-artist` | A search for the seed's lead artist (20) and for 3 of the listener's top 8 artists (10 each) |
| `favorite-album` | The rest of up to 2 albums the listener has favourited songs from |
| `trending` | A search for the seed's language and genre (15), plus trending seeds for the listener's top 2 and first 3 pinned languages (**9.1: two pages each**, 15 per page, on a 6-page rotation). With no language signal at all the pool falls back to two default languages. **This is a catalogue search for popular-sounding words and carries no outside evidence** — since 9.1 its reason says "Popular in the catalogue for your languages", never "trending". |
| `verified-trend` | **9.1:** up to 6 songs an outside chart or editorial source actually named, matched to catalogue ids by the server (`/api/trends`) and fetched by exact id — no search, so there is no chance of resolving to a different song. Salt-rotated across the chart, cached 30 minutes, skipped entirely for a language the stretch could not play. Before 9.1 a chart entry could only add a bonus to a song some other source had already returned, so a current song the catalogue missed was unreachable. |
| `web-discovery` | **9.1:** up to 4 songs a current web page named, resolved to real recordings by the server (`/api/discover`, see [trends.md](trends.md)). Same exact-id lookup; weaker evidence than a measured chart, so a lower boost and a different reason. |
| `intent` | Two pages of a catalogue search for the active tune or pinned mood, in the queue's language (20 each). Only present when an intent is active. |
| `album` | 8.2: the rest of the seed's own album (the same film or record, usually the same composer), up to 12. 9.0: also the album of the song the stretch follows (the queue's last song, the *anchor*), when that is another song, up to 8 |
| `related-artist` | 8.2: popular songs by artists related to the seed's lead artist, up to 12 (9.0: and to the anchor's lead artist, up to 8): first the artists featured on the seed, then the lead artist's related artists — the catalogue's own similar artists when its artist page lists them, then everyone co-credited on the lead artist's top songs, most often first — salt-rotated among the first four. Two artists, six songs each, fetched one after another. The related list is cached per artist for 30 minutes (50 artists). |
| `genre` | 8.2: one catalogue search "<genre> <language> songs" for the seed's first genre not already searched, else its mood's word (party, chill, sad, romantic, devotional), in the seed's language (12). Skipped while an intent is active and for a muted or unknown language. |
| `proven` | 8.2: catalogue suggestions (10 each) for two salt-rotated automatic picks the listener finished or liked before, and, from the device, up to four of those picks themselves once they have not played for three days (see [The engine's memory](#the-engines-memory-of-its-own-picks-82)) |
| `explore` | Discover mode only: trending picks in 2 languages the listener has never played, pinned or muted (10 each) |
| `history` | Familiar mode only: up to 12 favourites and 10 finished songs, in the seed's language, without a fetch |
| `rediscovery` | Up to 15 songs completed more than 14 days ago, without a fetch |

Before the pool leaves this stage it drops blocked songs, junk tracks, artists under an active "show fewer like this" soft mute, and explicit songs when kid mode is on.

**Playable (8.2).** A response that carried stream URLs for some of its songs and none for another marks that one `unplayable`; a response with no stream URL at all is a catalogue that resolves audio at play time and marks nothing. When one id arrives from several sources, a copy that can stream replaces one that cannot. Since 9.0 a candidate marked `unplayable` stays so until a copy *with* a stream URL arrives: a copy from a response that carried no URLs at all says nothing either way. (In 8.x such a copy cleared the mark, so an unplayable song that a search on another catalogue base also returned could be queued; the evaluation's `unplayable` fixture counted one per sitting.)

**Bounded work (7.2).** At most six catalogue requests are in flight at once. Identical requests (same endpoint, query and page) share one fetch, and responses are reused for three minutes (sixty kept). After a soft deadline the gather resolves as soon as the pool holds enough songs and the required sources — the seed's suggestions and the intent search — have answered; at the hard deadline it resolves with whatever has settled and abandons the rest, passing its `AbortSignal` to the requests that accept one. The deadlines come from the plan's own budget.

**Provenance (7.2).** A song found by several sources arrives once, carrying every source (`sources`, primary chosen by the priority intent, related, favorite-artist, album, favorite-album, related-artist, proven, history, rediscovery, genre, explore, trending — the 8.2 order) and the seeds it came from, so intent and trend evidence is not lost when the same id appears twice.

**Cold start (7.2).** With no taste yet: pinned languages, then the languages of liked songs, then default languages that are not muted. With no artists in the profile, the artists of liked songs seed the artist searches.

### Stage 2 — hard filter reasons

`rejectReasonFor` checks, in this order: `invalid` (no id, title or artist list), `junk` (dialogue, background score, jukebox, trailer, promo, ringtone and similar titles), `too-short` (a known duration under 90 s), `explicit` (kid mode), `blocked`, `muted-language`, `soft-muted` (a lead artist the listener asked less of, until it expires), `seed` (the seed or another version of it), `already-queued` (by id or canonical identity), `recently-played` (the profile's recent ids, or the identity of any of the last 20 history entries), `skipped-this-session`, and (8.2) `no-audio`: a candidate marked `unplayable` that is not in the downloads index. Survivors that share a canonical identity are collapsed with reason `duplicate-version`, keeping the original over a remaster over an alternate cut, then the more-played one.

Canonical identity (`identityCore.ts`, `songKey`) is the normalised title plus the primary artist. Since 7.2 the same file, byte for byte, serves the Worker, and both test suites run the vectors in `shared/identity-vectors.json`. Normalisation is Unicode-safe: NFKC, invisible characters dropped, Latin accents folded ("Café" = "Cafe"), every other combining mark kept so Indic vowel signs survive ("కల" ≠ "కాల"). It strips version decorations in brackets or after a dash (film credit, remix, remaster, live, lofi, a year, and so on), bracketed or trailing featured credits, and uses the first credited artist whatever the separator (comma, ampersand, "feat."). `recordingKey` adds the version tag, so a remix or a live cut stays distinguishable from its work family; when the listener starts an alternate cut, de-duplication prefers that cut within a family.

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

One recording family (`songKey`) appears once per stretch, and a version of the seed or of a recent play is used only when nothing else fits. `languagePolicy` is `lock` or `prefer` (see [Queue languages](#queue-languages)). Under `lock` a candidate whose known language differs from the target never enters. Under `prefer` it stays in the pool at a cost: +0.6 for a language in `otherLanguages` (the listener's own), or −0.35 once three or more songs in the target language have run in a row ("a change of language after a long run"), +2.5 for any other known language, and +3 on top right after another off-target song. Three mix rules are hard under `prefer`, not priced: the target language fills slots 1 and 2, an off-target song never follows another, and off-target songs fill at most ⌊n ÷ 2⌋ of the stretch. They give way only when no candidate satisfies them, after every other soft rule, and the trace records `language-mix` with the reason (opening, two changes in a row, or more than half). Songs with no language, or `unknown`, pass under either policy. Every soft rule a small pool forced to give way is reported in `relaxed` and, per slot, in `relaxations`.

Arc shapes are `steady`, `build`, `wind-down`, `wave` and `lift`. The engine chooses the shape in this order: the active tune's shape, then `lift` when the sitting has a skip streak of two or more, then the listener-energy read (`restless` or `wavering` → `lift`, late hours → `wind-down`, otherwise `steady`).

Transition memory (`transitions.ts`, `transitionTracker.ts`) records how each hand-off went, from the playback instance's heard time: 70 % or more heard counts as completed, under 30 % as skipped, failed playback judges nothing. Since 8.2 the same subscription also feeds [the engine's memory of its own picks](#the-engines-memory-of-its-own-picks-82).

### Stage 10 — validation

`validateSequence` receives the sequenced stretch followed by the rest of the ranked pool as a reserve, and applies:

1. The hard filter again, for every song.
2. One song per canonical identity.
3. The language rule, in the form the engine chose (see [Queue languages](#queue-languages)). Under `lock` (`lockLanguage`): songs whose language is known and differs from the lock are dropped. If that leaves fewer than three songs, languages the listener plays (pinned languages and the profile's top three) are let back in; only if that is still short is the rest allowed. The trace records `language-lock` as relaxed. Under `prefer` (`leadLanguage`, 8.1): there is no lock — the allow-list already ran in the hard filter — and the three mix rules are applied as policy in the tier order below: the lead language fills slots 1 and 2, an off-lead song never follows another, and at most ⌊limit ÷ 2⌋ songs are off-lead. When one gives way the trace records `language-mix`.
4. An artist cap of ⌈limit ÷ 4⌉ songs per lead artist (two in a stretch of five). Overflow returns only when the pool cannot otherwise fill the stretch; the trace records `artist-cap` as relaxed.
5. No lead artist back to back, counting the seed as the previous song. A later song is pulled forward to break a pair; the trace counts these repairs.
6. The discovery allocation, ⌊share × limit + 0.5⌋ (7.2).
7. The familiar opening (7.2): no discovery in slot 1, nor in slot 2 when four or more songs ship, as long as a non-discovery song is available.
8. Sitting-avoid (9.0): a lead artist this sitting pushed away — the session intent's artist pull at −0.6 or below, which takes two skips of that artist or one "Not interested" — fills a slot only when nothing else fits. And it never costs the mix or back-to-back rules: when placing it would, the stretch ends short instead (from its second slot on), and the player asks for more before the queue runs out. Until 9.0 those artists were only scored down (−0.18 × pull), so after two skips a third and fourth song by the same artist still reached the next stretch whenever the discovery budget ran out; the evaluation's `skips` fixture shipped 48 of them where another artist was eligible, and ships none now.

When nothing else fits, soft rules give way in the order a listener minds least: the discovery allocation first, then the familiar opening, then the artist cap, then the style quota, then sitting-avoid (9.0), then the mix rules (8.1), and only last the rule against the same lead artist twice in a row. Each relaxation is reported with its slot, as is the language-lock step that was used. (Until 7.2 adjacency gave way first, so a Familiar-mode queue — whose discovery budget is nearly zero — shipped runs of three songs by one artist while other artists sat unused in the reserve. The offline evaluation counts it: 162 back-to-back repeats over 3,432 songs before the change, 24 after, against 59 for 7.1.) Hard rules (explicit, blocked, muted language, soft-muted artist, recently played, skipped this sitting, invalid, junk) never relax. Order is otherwise preserved.

This is the final policy for every order that ships: the on-device one, the AI DJ's, and a top-up from the reserve.

## Scoring weights

These are the values in `services/recommendation/weights.ts` (`SCORING_WEIGHTS_VERSION` is `1.3.0`: the 1.2.0 values, with `artistAffinity` and `session` read by the scorer since 9.0). Feature values are normalised to 0–1 before they are multiplied.

| Key | Weight | Used for |
| --- | ---: | --- |
| `mood` | 0.16 | Mood match with the seed |
| `vibe` | 0.10 | Vibe overlap with the seed; listener's vibe affinity at × 0.6 |
| `language` | 0.12 | Same language as the seed |
| `dialect` | 0.08 | Exact dialect match; sub-language at × 0.65 |
| `genre` | 0.10 | Genre overlap with the seed; listener's genre affinity at × 0.6 |
| `energy` | 0.10 | Closeness to the seed's energy; to the listener's average at × 0.35 |
| `tempo` | 0.08 | Closeness to the seed's tempo (80 BPM span); to the listener's average at × 0.35 |
| `artistAffinity` | 0.14 | Scales the artist terms: the profile's artist affinity (0.3 × the personal blend at the default) and the lift for an artist played in the last week (0.05 × blend) |
| `history` | 0.10 | Subtracted when the song is in the recent set |
| `likes` | 0.10 | Added when the song is liked |
| `skips` | 0.12 | Subtracted when the song was skipped before |
| `session` | 0.12 | Scales the session-window terms: energy (up to ±0.07) and language momentum (+0.03), ramping in over five plays, and mood continuity with the session's mood (0.12 × the mood match − 0.4) |
| `discovery` | 0.07 | Discovery floor for `explore` candidates in the diversity re-rank (× 0.2) |
| `popularity` | 0.05 | Log-scaled play count (× 3, capped); 0.04 when unknown |
| `freshness` | 0.04 | Released this year or last |
| `diversity` | 0.20 | Penalty multiplier in the diversity re-rank |
| `songAffinity` | 0.12 | A song the listener keeps finishing |
| `dayOfWeek` | 0.04 | Weekday lift of the candidate's language (7.2) |
| `novelty` | 0.16 | Swing between novelty and familiarity, signed by the lean: ±0.08 at the extremes, 0 when neutral |
| `artistFatigue` | 0.04 | Per recent play of one lead artist beyond two within the last ten plays, capped at four steps |
| `intentArtist` | 0.18 | This sitting's pull on the lead artist (−1..1) |
| `intentLanguage` | 0.08 | This sitting's pull on the language (−0.6..0.6) |
| `intentEnergy` | 0.30 | Energy steer (−0.3..0.3) × the candidate's distance from mid energy |
| `intentSkippedSong` | 0.40 | Subtracted for a song skipped in this sitting |

**Owner overrides (7.2).** The owner console's Recommendation Tuning can publish a versioned set of overrides for these keys (`rec-config`, see [admin-console.md](admin-console.md#recommendation-tuning)). Each value is clamped to between half and double its default. The public `client` bundle carries the overrides only while the rollout targets someone; the app applies them (`applyWeightOverrides` in `weights.ts`, loaded lazily by `remoteWeights.ts`) only when the rollout is `all`, or when this device's experiment variant matches. `activeWeightsVersion()` then reads, for example, `1.3.0+rc7`, and that string is part of every continuation's `alg` stamp, so opt-in outcomes can be compared per version. An override without an attached evaluation is labelled "unvalidated" in the console; no override is presented as proven.

**Every key moves its own terms (9.0).** Until 9.0 `artistAffinity` and `session` were declared in the table but the scorer used fixed numbers for their terms, so an override of either did nothing. The scorer now reads them through an explicit normalisation — each term is its 8.x base times (live weight ÷ default weight) — so on the defaults every score is exactly what 8.x computed, and an override scales exactly the terms it names. `services/recommendation/weightEffects.test.ts` doubles each of the 24 keys in turn and checks that its own terms move and no other term does; a key added to the table without saying what it moves fails that test. The Worker's description of each key (`REC_WEIGHT_TERMS` in `backend/worker/functions/api/admin/recconfig.ts`, shown in the console) says the same.

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

9.1 adds two evidence-backed sources: `verified-trend` 0.12 (above the catalogue's own `trending` search, which has no evidence; below the listener's stated intent and the seed's own neighbourhood — real evidence that a song is current is evidence about the world, not about this listener) and `web-discovery` 0.09. Their reasons are `popular-now` ("On a verified chart") and `web-evidence` ("Reported by …"); `store/evidenceStore.ts` carries the specific source and, for a web discovery, the page itself, which the track menu offers as "Open the source".

8.2 adds four sources and their boosts: `proven` 0.12, `album` 0.10, `related-artist` 0.10, `genre` 0.07. Their reasons are `proven`, `album`, `similar-artist` and `genre`; the first three name what they came from (the earlier pick, the seed's title, the seed's lead artist). When one of them, `taste` or `served` is a song's top reason, "Why this song?" (`explanations.ts`) reads: “Like “…”, which you enjoyed before”, “From the same album as “…””, “By an artist close to …”, “Close to the songs you love”, or “Held back a little — you were shown this recently”.

Every term is recorded as a reason and the reasons sum to the score. Unknown features score 0 rather than a guessed value; title-inferred and classifier-filled features are scaled by confidence (catalogue metadata 1, classifier 0.6, title inference 0.35), so a song with no metadata is not rewarded for a similarity nobody measured. A song found by several sources earns +0.02 per extra source, capped at +0.04. The weekday term (7.2) is the candidate's language share of this weekday's plays minus its share of all plays, so it can change the order between two candidates instead of adding the same amount to every one; it is zero below five plays on that weekday and for profiles recorded before 7.2.

**Taste fit and the served memories (8.2).** Three terms live in `TASTE_WEIGHTS` (`weights.ts`), kept out of the override table on purpose: that table is the owner console's contract, mirrored key for key by the Worker, so these are fixed defaults for now.

| Key | Weight | Used for |
| --- | ---: | --- |
| `tasteFit` | 0.15 | × the taste fit (0–1) × the personal blend; reason `taste` |
| `servedRecently` | 0.04 | Subtracted when another surface showed the song in the last week (`songIdentity`'s served memory, by canonical identity); reason `served` |
| `seedRepeat` | 0.10 | Subtracted when the song opened the last continuation the player accepted after this same seed; reason `served` |

The taste fit is the cosine of the candidate's vector and the listener's taste vector in the on-device space (`vectors.ts`): each song hashes its artists (lead 1, others 0.5), album 0.5, language 0.3, genres 0.5, mood 0.4 (only when something named it), vibes 0.35 and release decade 0.3 into 256 signed slots, scaled to unit length. The taste vector is the sum of up to 60 favourites at weight 1 and up to 200 history entries decayed with a 14-day half-life (finished +1, skipped −0.5, anything else +0.25), scaled to unit length; with nothing to go on it is null and the term is 0.

**Long-term and recent taste (9.0).** Plays of the last seven days are the *recent* taste; favourites and older plays are the *long-term* taste. Once the long-term taste weighs at least 3 (three favourites, say), recent listening may hold at most 40 % of the vector's weight (`RECENT_SHARE`, `MIN_LONG_TERM_MASS`): one unusual night — forty plays of an artist the listener never played before — moves the taste toward that artist without taking it over. Below the cap the vector is the 8.x sum, and a thin or very old long-term taste is not protected, so for a new listener recent listening is the taste. The learned-embedding taste is built the same way. When the engine has loaded the embedding module by the time the pool is gathered (the plan never waits for it), and the device already holds learned vectors for at least three taste songs and three candidates, the fit moves by how far the candidate's embedding cosine with the embedded taste sits above or below the pool's mean; the two spaces are never compared with each other, and the result is clamped to 0–1. After ranking, the engine warms the embedding cache for the top 60 of the pool in the background. The served penalties are never rules: a song that is clearly the best fit still wins.

Other fixed terms in the scorer: a song in the profile's recent list loses 0.5; an artist played in the last seven days gains 0.05 × blend; an active festival window adds 0.14 for its languages and 0.10 for its moods; the four taste dials (adventurous, recency, energy, vocal) add small signed nudges that are zero at the neutral default. A candidate in a muted language scores −1. Candidates scoring 0 or less are dropped with reason `low-score`.

## Taste profile and event weights

Every listening event bumps the language, the first three credited artists and the song by one delta from `services/personalization/eventWeights.ts` (`EVENT_WEIGHTS_VERSION` is `1.1.0`).

| Event | Weight | When |
| --- | ---: | --- |
| `PLAY` | 1.0 | A play heard for 5 seconds (see [How listening becomes taste](#how-listening-becomes-taste)) |
| `COMPLETE` | 2.0 | A song ends naturally with at least 70 % of it heard |
| `FAVORITE` | 3.0 | A like (the same amount is removed on unlike) |
| `QUEUE_ADD` | 0.5 | "Add to queue" or "Play next" |
| `SEARCH_PLAY` | 1.5 | A play started from the listener's own search, on top of the `PLAY` |
| `SKIP` | −0.75 | A manual skip with under 30 % of the song heard. Because `SKIP_RETRACTS_PLAY` is on, the skip also takes back the `PLAY` bump, for a total of −1.75. |
| `SOFT_MUTE` | −3.75 | "Less like this"; also mutes the lead artist for 7, 14 or 30 days as the listener chose (14 by default). Settings → Recommendations lists the active mutes with their end dates and takes any of them back |

A song flipped past before the 5-second mark never earns its `PLAY` and is not recorded as a skip in the profile; it is still noted in the session intent. Positive affinity halves 14 days after the last signal; skips halve after 30 days. No single affinity score can exceed 60.

**One sitting's share (9.0).** Passive listening teaches the long-term profile less as one sitting goes on (`updater.ts`): a `PLAY` and its `COMPLETE` count in full for the first 8 plays of one lead artist in a sitting, at half up to the 20th, and at a quarter after that; a language counts in full for 12 plays, at half up to 30, then at a quarter. A sitting ends after 45 minutes of silence. Forty songs by one artist at a party therefore add about as much artist affinity as nineteen ordinary plays, not forty. Likes, searches, queue and playlist adds, every negative signal and the song's own affinity always count in full.

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
| Extra candidate source | Favourites and finished songs (`history`) | — | Trending picks in unheard languages (`explore`). They reach Home shelves; in a queue the language rule removes them (the lock under "One language", the allow-list under "Your languages"). |
| Queue languages | The Queue languages setting, the same in every mode (see [Queue languages](#queue-languages)) | same | same |

The share is clamped to 0–50 % after the appetite is applied. A discovery is a song whose lead artist the listener has never played, or an `explore` candidate. Songs fetched for an active tune or pinned mood are never counted as discoveries: they are the request itself.

## The queue rules

### The next five

One continuation adds five songs (`NEXT_BATCH = 5` in `store/playerStore.ts`). Every plan carries `alg`, the pipeline version (`PIPELINE_VERSION`, `9.0.0` since 9.0) and the weights version. The player asks for a continuation when a song starts and two or fewer songs remain after it, provided autoplay (or radio) is on, follow mode is off and repeat is off. Only one request runs per queue version, and a queue change cancels it; a result that arrives after the listener started something else is discarded. Additions pass the [admission gate](#the-admission-gate) before they are appended and marked as automatic, and the DJ's order arrives later as a refinement of the entries that have not started.

With the "DJ builds every queue" setting on (`djTakeover`, the default) and Autoplay on, tapping a song makes that song the seed: the queue becomes that one song and the first continuation is requested at once. Callers that pass `keepList` (Queue Builder plans, explicit queues) keep their list.

**Smart Queue (8.2, `features/queue/SmartQueue.tsx`).** One switch on the Queue page over the two existing settings, never a third: it reads on when `autoplay && djTakeover`. Turning it on sets Autoplay (if off) and `djTakeover`; turning it off clears `djTakeover` only, so Autoplay keeps extending the listener's own list. The line beside it explains the current state, and says when the AI DJ is off that the picks are on-device.

### AI Radio (8.2)

`/radio` (`pages/AiRadioPage.tsx`, `features/radio/aiRadio.ts`) only finds the first songs; the player's radio mode and the pipeline do the rest. `startRadio(song, { seeds, tune })` puts the song and its seeds (distinct, valid, explicit ones removed in Kid mode, at most `RADIO_SEED_MAX = 5`) in the queue as the listener's list, sets radio mode (so continuations run even with Autoplay off), sets `tune` as the active tune intent for every continuation, and plans the first continuation from the last seed at once.

| Start | Seeds |
| --- | --- |
| A song (song menu **Start AI Radio**, the page's current and recent songs) | The song alone |
| An artist page's menu (**Start AI Radio**) | The artist's first top song, then the next four |
| One of the listener's artists on the page | A catalogue search for the name (25), kept to songs that credit that artist, rotated by a random offset of 0–7 so the same artist opens differently |
| A mood chip (Melody, Romantic, Dance, Chill, Sad, Devotional, Beats, Classics, New) | The tune's catalogue query in the listener's first language (pinned, else the profile's top), rotated likewise; the chip's tune steers every continuation |
| Free text (`seedsForPrompt`) | `parseRadioPrompt` reads a language (names and industry nicknames), a decade ("90s") and a mood family into a tune. Queries, most specific first: the tune's query, "<decade>s <language> songs", then the words themselves; the results are merged round-robin, one per title, language kept, the decade's songs first. With fewer than two seeds the playlist builder is asked instead (`generatePlaylist`), and its catalogue fallback applies. |

Seeds found by a search skip songs the listener hid. The DJ builds the rest under the same rules as any continuation.

### Staying in a style (8.3)

`services/recommendation/style.ts` reads three styles from a song: `dj` (DJ remixes), `folk` and `devotional`. Words are strong evidence — the title, album, subtitle and credited artists, on word boundaries (folk songs are usually marked only in the album name, e.g. "… Folk Songs Telangana Janapadalu Vol - 6"; an album counts as DJ only with a phrase such as "DJ Songs" or "Remix", so a film called "DJ …" is not a DJ set; a credited "DJ …" artist counts). Genre, genres and mood are weak evidence.

`sessionStyle` decides the style the listener is in: a style tune sets it and a mood tune clears it (except energetic or beats over DJ/folk, chill or melody over devotional); a seed whose words carry a style sets it; a metadata-only seed needs 2 of the last 3 plays to carry it in words; an ordinary song played by hand starts a fresh queue and clears it. "More like this" on a styled song tunes to its style (`features/queue/steer.ts`).

While a style is active:
- a required `style` candidate source searches the live-probed catalogue phrases `<language> dj remix`, `<language> remix songs`, `<language> folk songs`, `<language> devotional songs` (rotated by salt and page);
- scoring adds `STYLE_WEIGHTS` (weights.ts): +0.4 for a word match, +0.25 for a metadata-only match, −0.3 off-style, and a 0.1 source boost;
- validation keeps at least ⌈0.8 × limit⌉ songs in the style while the pool has them — it outranks the artist cap, gives way before the language-mix and back-to-back rules, relaxes as `style`, and never empties the list;
- style songs do not count against the discovery share, and only one remix of each song plays per sitting (`remixWorkKey`, also applied to the DJ's proposals);
- the DJ request carries `context.style`, and a DJ order with fewer style songs than the local order is rejected.

"Why this song?" reads "Keeps the DJ remix going", "More folk songs, like the one playing", or "Held back — not a DJ remix song". The eval has `dj-session` and `folk-session` fixtures and a style-continuity metric.

### Queue languages

Which languages a continuation may draw from is the setting **Settings → Recommendations → Queue languages** (`queueLanguages` in `store/settingsStore.ts`; `'mix'`, shown as "Your languages", is the default; `'one'` is "One language"). It applies in all three discovery modes. `engine.ts` decides per plan:

- The listener's languages are the pinned languages plus the profile's top three (`topLanguages`), minus muted ones and `unknown`.
- The mix applies only when the setting is `'mix'` **and** at least one of those languages differs from the seed's. A listener with one language, or a caller whose context does not set `queueLanguages` (tests, the offline evaluation), keeps the 7.1 rule.
- Under the mix the hard filter receives `allowedLanguages` — the seed's language plus the listener's — and rejects any other known language as `off-language`, so a language the listener never chose stays out. The sequencer runs with `languagePolicy: 'prefer'` and validation with `leadLanguage` (no lock): the seed's language opens the stretch (slots 1 and 2), fills at least half of it, and two changes of language never land back to back. See [Stage 9](#stage-9--the-sequencer) and [Stage 10](#stage-10--validation) for the costs and the relaxation order.
- "One language" (`'one'`) is the 7.1 rule: `languagePolicy: 'lock'` on the seed's language. The sequencer drops candidates whose known language differs and validation enforces the lock last, relaxing it only when fewer than three songs would remain.

Songs with no language, or `unknown`, pass under both settings. The AI DJ is told which rule is in force (`languagePolicy` and `queueLanguages` in the context, rule 4b of its prompt; see [ai.md](ai.md#post-apidj--the-ai-dj)); its proposals are gated on the lock under "One language" and on the allow-list under "Your languages", and its order passes the same validation as the local one. The "Switch language" tune moves a lock to another pinned language (or another language present in the pool) under either setting, so that stretch speaks one language. The "Same language" tune is a preference, not a policy change: it adds a score nudge and a DJ instruction and leaves the setting as it is.

### Familiar first, then gradual introduction

The sequencer's `familiarFirst` option is on by default. Discovery is held out of slot 1, and out of slot 2 as well when the stretch has four or more slots, as long as any non-discovery candidate remains. A "sure" song (a favourite, or one of the last 60 plays) earns a cost reduction that is largest in the first slot and fades to zero by the last; a discovery pays a cost that fades the same way. The first slot's reason reads "a familiar way in". The DJ prompt carries the same rule: the strongest, most familiar hand-off first, discoveries in the second half, never in slot 1. Pool entries sent to the DJ carry a `known` flag for songs or artists the listener has played.

### Tune this queue and Pin a mood

"Tune this queue" offers twelve intents (`tune.ts`): More energetic, More chill, More romantic, More melody, More beats, Devotional, Heartbreak, More classics, More new, Same language, Switch language, Surprise me. The chips appear on the Queue page, on the Now Playing page and in the command palette. "Surprise me" resolves to one of the other eleven at random.

"Pin a mood" on the Now Playing page offers Romantic, Energetic, Chill, Melancholy and Devotional. A pin is stored in `sessionStorage` for 45 minutes, overrides the session window's mood and energy at full weight, and calls the same rebuild as the matching tune. Tapping the active pin clears it and rebuilds without an intent.

`tuneQueue(intent)` keeps everything already played, the current song and every hand-queued song, removes the rest, and requests a new continuation seeded by the current song. An active intent changes four things:

| What | How |
| --- | --- |
| Candidates | Nine of the twelve intents have a catalogue query (`tuneSearchQuery`), a two-word phrasing prefixed with the queue's language: `dance songs` (energetic), `melody songs` (chill and melody), `romantic songs`, `mass songs` (beats), `devotional songs`, `sad songs` (heartbreak), `evergreen hits` (classics) and `latest <language> songs <year>` (new). Two pages of results enter the pool with source `intent`. "Same language", "Switch language" and "Surprise me" have none. A pinned mood with no active tune uses the same table (Melancholy maps to the heartbreak query). 8.1: the longer phrasings used before ("romantic love songs", "high energy dance hits", "chill soothing melodies", "sad heartbreak songs") returned nothing from the catalogue, so Pin a mood and four of the chips rebuilt the queue from an empty pool; the two-word forms were probed live in three languages and each returns a full page in that language. |
| Score | `tuneScoreAdjust` adds +0.35 when the song's mood is the asked-for mood, plus per-intent nudges: classics +0.5 / −0.4 by release year, new +0.5 / −0.3, same language +0.3 / −0.6, switch language +0.4 / −0.6, energetic and chill ±0.4 by energy, title cues for devotional (+0.6), beats and melody (+0.35). |
| Arc | Energetic and beats → `build`; chill, melody, romantic, heartbreak, devotional → `wind-down`; surprise → `wave`. |
| DJ brief | A one-sentence instruction is sent as the highest-priority adjustment, and the DJ's arc tolerance is relaxed to 0.2. |

The active tune is cleared when the listener starts a new queue. If the rebuild adds nothing, a toast says so and the queue keeps the songs it has.

### Hand-queued songs go first

The player tracks two id sets in memory: songs the recommender appended and songs the listener queued by hand.

- "Add to queue" inserts the song before the first automatic song after the current one, behind the listener's own list and earlier hand-queued songs.
- "Play next" inserts it directly after the current song and marks it as hand-queued.
- An adaptive re-plan and a tune replace only the automatic tail. Hand-queued songs keep their place and order.
- "Keep this song" turns an automatic entry into the listener's own; **Refresh up next** on the Queue page (called New DJ picks before 8.2; `regenerateAutoTail`, which re-runs the active tune) rebuilds every automatic entry after the current song on purpose. Removing an upcoming song offers Undo while the same song is playing.

### Adaptive re-plan

Two consecutive skips of automatic songs re-sequence the remaining automatic tail (three songs or more) with the `lift` shape, bringing in up to four favourites in the playing song's language; the re-plan sequences under the lock on that language whatever the Queue languages setting says. The favourites and the final order pass the admission gate, so a favourite is not exempt from Kid mode, hidden artists, muted languages, soft mutes or recent plays; if fewer than three songs survive, nothing changes. A completed song or a skip of a hand-queued song resets the streak. A re-plan cannot run again for 90 seconds.

## The exposure ledger (9.1)

`services/recommendation/exposure.ts` is the ONE memory of what the listener has
already met, shared by every surface. It replaced five memories that did not know
about each other — see [audit-9.1.md](audit-9.1.md) for what each of them was and
why the arrangement could not work.

One row per canonical identity, with a separate timestamp per KIND of event,
because the events mean different things:

| Event | Recorded by | Penalty at its freshest | Decays over | Cools a discovery surface for |
| --- | --- | --- | --- | --- |
| `shown` | a Home shelf when it renders (`features/home/blocks/shared.tsx`), the AI Playlist | 0.14 | 3 d | 12 h |
| `queued` | the queue engine's `commit`, the DJ's `commitDjSet` | 0.24 | 7 d | 2 d |
| `played` | the playback bus's `counted` event | 0.30 | 10 d | 3 d |
| `completed` | the playback bus's `end`, at the completion ratio | 0.22 | 14 d | 3 d |
| `skipped` | an early manual skip | 0.30 **per skip**, 3 max | 21 d | 14 d |
| `disliked` | hiding a song | 0.80 | 60 d | 45 d |
| `liked` | favouriting | — (pays ¼ of everything else, and is never cooled) | — | — |
| `replayed` | an explicit "play this again" | — (pays nothing for 7 d) | — | — |

Sizes are against the rest of the score: a candidate's total is typically
0.4–1.2 and the strongest source boost is 0.24. 8.2's single
`servedRecently: 0.04` was too small to change any order at all, which is why a
shared memory that *was* consulted still produced repeats.

What is deliberately NOT recorded: a cancelled request, a model suggestion that
was rejected, and a prefetched song nobody saw. A surface records `shown` when it
renders; the queue records `queued` when the player accepts the songs.

The penalty reaches the scorer as `ctx.exposurePenaltyOf` and is a penalty, never
a rule — nothing here can admit a song the hard filter rejects, and a song that
is clearly the best fit still wins. A plan takes ONE ledger snapshot so a long
stretch cannot reorder under its own feet.

Bounded: 600 rows, a 45-day row TTL, `localStorage` with an in-memory mirror used
only while storage refuses writes. "Clear personalization profile" and "Erase
everything" clear it (`resetExposure`). A 9.0 device's `vinax.flow.served.v1` is
imported once by `migrateLegacyExposure()`.

### Snooze (9.1)

`snoozeSong(song, days)` is the per-SONG counterpart to the per-artist soft mute
in `services/personalization/softMutes.ts`: 7, 14 or 30 days, keyed by canonical
identity so every release of the song goes quiet, with an exact `undo()`. It is a
HARD rule while it lasts (`filters.ts` returns `snoozed`), not a penalty — the
listener asked for the song to go away, and a nudge would keep handing it back.
It expires on its own.

### Refresh with fewer repeats (9.1)

One generation under a stricter rule, on Home (`homeRefresh.ts` `strict`, read by
`surfacePolicy.ts`) and on an AI playlist (`GenerateOptions.fewerRepeats`). A
discovery surface then REMOVES everything with any live exposure instead of
moving it to the back, and the AI Playlist's pool and the curator's own picks are
held to the same rule. A shelf or a list can come out shorter, and the app says
so: that is the honest outcome when the catalogue has little else to offer.
`personal` and `resume` surfaces are untouched — Made For You is meant to hold
your own music, and Recently Played *is* the repeats.

## The engine's memory of its own picks (8.2)

`recMemory.ts` keeps two small device-local memories, never uploaded:

- **Outcomes.** When a playback instance of an automatically queued song ends, `autoOutcomeFor` (`transitionTracker.ts`) judges it once per run: liked, or a natural end with the song completed, is a success; a manual skip before the play counted or inside its first 30 % is a miss; anything else, failed playback included, says nothing. One entry per canonical identity, 60 at most, forgotten after 60 days. `provenPicks` returns those with more successes than misses, strongest and most recent first; they feed the `proven` source.
- **Seed memory.** When the player accepts a continuation (`commit`), the first five songs are remembered against the seed's identity for 12 hours (40 seeds at most). The next plan from the same seed passes them to the scorer as `seedRepeatKeys`. The evaluation measures it: asked again from the same song, the opening repeats 3 of 3 songs without the memory and 1 of 3 with it (`warm` fixture). **9.1** stores CANONICAL KEYS rather than catalogue ids — with ids, the same opening could come back under a different release of each song, which is exactly the repeat this memory exists to prevent. A device written by 9.0 holds ids here; they never match a key, so that seed starts empty and refills on the next accepted continuation.

"Clear personalization profile" and "Erase everything" both clear these memories, and since 9.0 the served memory too (`resetServedMemory`). Before 9.0 a reset removed the served key but `servedKeySet` fell back to its in-memory copy whenever the key was missing, so the "shown recently" penalties survived a reset until the next reload; the copy is now used only while storage refuses writes.

## Home shelves

`buildRecommendations(ctx)` gathers the same candidate sources without a seed, enriches, ranks, moves identities the exposure ledger says are still cooling behind the rest, and assembles shelves in `mixes.ts`. **9.1** also puts the ledger's size and the trend/discovery snapshot sizes in the memo key: before, the ten-minute memo could hand back the very shelves whose songs had just been played, and a chart that arrived mid-window changed nothing. On a profile with at least five plays the optional AI re-rank may reorder the top 30. The result is memoised for ten minutes per profile state. Every song placed on a shelf gets a plain-language reason for the track menu's "Why this song?".

### When Home builds itself again (9.0)

Every Home query that designs or rotates content — the AI-designed shelves, Made For You, the trending / new / popular rotations — carries the Home **generation** in its key and is cached for 30 minutes (`features/home/homeRefresh.ts`). The generation moves only on an explicit refresh (pull to refresh, or **Refresh Home** under Explore more) and when Home opens more than 30 minutes after the generation started; never while the listener is on Home. So:

| Situation | What happens |
| --- | --- |
| Back on Home a few minutes later | The same shelves from the cache: no AI design call, no new rotation |
| Back on Home after half an hour | A new generation: new designs and rotations, with the previous shelves on screen until they land |
| Pull to refresh / Refresh Home | A new generation and a new discovery round now, with the previous shelves on screen; the day-rotated shelves are invalidated and refetched |
| Pinned or muted languages, discovery mode, intensity, AI-shelves switch change | The queries whose key holds that setting rebuild at once, the rest stay |
| Kid mode, a hide, "Not interested", "Never play", a muted language, "Less like this" | Nothing rebuilds: every Home list — the opening included — filters by the current safety settings when it renders, so the song leaves at once, cached lists too (`useShelfSafety`, applied through `useShelfLens` in `features/home/blocks/shared.tsx`) |
| A song plays while Home is open | Nothing moves; it counts at the next visit |

Made For You is also keyed on a coarse taste stamp read once per visit — five more plays, a new like or dislike, three more skips or a new "Less like this" (`tasteStamp`) — and on the hour the generation started, so crossing an hour while browsing changes nothing. A query that moves to a new key keeps showing the previous data (`keepPreviousData`) and cancels the request of the key it left, so an older answer can never replace newer preferences. Before 9.0 the AI-designed shelves drew a random nonce on every mount with no stale time (a new design call on every visit to Home), and Made For You froze the raw profile stamp per mount (the whole pipeline ran again on the first return after any play).

### Surfaces share one repetition rule (9.0)

`services/recommendation/surfacePolicy.ts` decides how a list treats songs the listener has just heard (the last 20 plays, by identity), skipped in this sitting, or been shown on another surface this week. Each surface keeps its purpose:

| Surface | Heard / skipped | Shown elsewhere |
| --- | --- | --- |
| `resume` — Continue listening, Recently played, On repeat, Most listened, On this day, Repeat rewind, Recently liked, Jump back in | Kept (they are the content) | Kept |
| `personal` — Made For You mixes, the Daily mix, Because you liked / listened to, For you this week, Your top genres | Moved to the back, never removed | Moved to the back |
| `discovery` — trending, new releases, popular picks, fresh finds, hidden gems, mood, AI-designed and day-part shelves, the feed | Removed | Moved to the back |
| the automatic queue | Hard rules (`filters.ts`) | A small score penalty |

Home reads the signals once per generation (`HomeSignalsProvider`), so nothing reorders while the listener scrolls, and applies safety first, then the surface rule, then the cross-shelf ledger. Before 9.0 each Home hook made up its own rule: the Daily mix removed every served song but kept recent plays, "Because you liked" applied no safety filter at all until the next fetch, the trending shelves kept both.

### Home's composition (9.0)

The page is composition only (`pages/HomePage.tsx`); the blocks live in `features/home/blocks/`. The opening is one listening action — the Aura Mix's play button — with AI Radio, Surprise me and Jump back in beside it. Then the first four visible blocks (by default the shortcuts, For you, Designed for you and Fresh discoveries); For you shows six personal sections and keeps the rest of the listener's own listening behind **More from your listening**, Fresh discoveries keeps four shelves and the rest behind **More trending**. The remaining blocks (charts, seasonal, moods, genres, artists, albums, day picks, recently liked, the endless feed) wait behind **Show more for you** under Explore more. A disclosure that is closed mounts nothing, so nothing in it fetches; its open state is remembered for the tab's session. Customise Home and the owner's layout still choose the order and the hidden set; the first four of whatever order results are the primary blocks.

### Popular picks for you

`services/ai/trending.ts` and `features/home/useAiTrending.ts` (still named for "Trending for you", the shelf's title before 7.2) build Home's "Popular picks for you" shelf from the catalogue's trending results and nothing else. The pool passes the hard filter (mutes, blocks, explicit, junk) and is collapsed by canonical identity. The on-device scorer orders it; songs the scorer drops still appear after the ranked ones. When the listener's "AI-designed shelves on Home" setting and the owner's `aiHome` flag are both on, an AI re-order of the top 30 may replace that order if it arrives within 4 seconds and actually changes it. The AI answers with ids from the list it was given, so it can change the order and never the contents. The shelf reports whether the order is `ai` or `local`. One curation runs per trending pool and is kept for 15 minutes.

### Home's own order (8.2)

When nobody chose an order — no listener layout from Customise Home, no owner-published order (`composeHomeLayout` reports `orderChosen`), and no running shelf-order experiment — `orderHomeBlocks` (`features/home/homeOrder.ts`) reorders the visible blocks. It is pure and deterministic; `sessionHomeOrder` computes it once per session (memory and `sessionStorage`) so nothing moves while the listener scrolls, and a changed set of blocks computes afresh. Customise Home then starts from the order the listener sees.

| Signal | Lift, in places (positive = earlier) |
| --- | --- |
| Time of day | Morning (5–12): day picks +2, moods +0.5, charts −0.5. Afternoon (12–17): discovery +1, charts +0.5. Evening (17–22): moods +1, day picks +0.5, loved +0.5. Night: moods +1, loved +1.5, discovery −0.5, charts −1 |
| Usage | Taps inside each block (`homeTaps.ts` finds the block from invisible markers around it), decayed with a 14-day half-life. From 3 taps on: (share − even share) × number of blocks, clamped to −1.5..+2.5 |
| Outcomes | Songs started from a block and heard through or skipped (`homeSignals.ts`). From 2 outcomes on: (done − skipped) ÷ (done + skipped + 2), × 2.5 for the discovery block |
| Genre affinity | The top genre's share of genre affinity (`genreAffinityStrength`); above 0.2 the genre block gains min(2, share × 3) |

Each block moves at most three places from its default slot; the shortcut row and the endless feed never move. Ties go to the stronger lift, then to the default order.

8.2 also adds, inside existing blocks: the **AI Radio** tile first in the shortcut row (which now always renders), **Your playlists** after Continue listening (the listener's own playlists, pinned first then newest, then saved playlists, 16 at most; hidden when there are none), and **Your top genres** in the genre block: one or two shelves for genres with an affinity of at least 2, each a catalogue search "<language> <genre word> songs" in the pinned (else top) language. The genre tiles are ordered by genre affinity (language affinity for the language tiles). The quick chips gain **Trending** (`/trending`) and **Lyrics** (the current song's lyrics page, shown only when a song is loaded), and the journey cards gain **AI Radio** in place of "Find a feeling".

### De-duplication across shelves

Home is built from blocks that mount and re-render independently, so `features/home/shelfLedger.ts` keeps a shared ledger keyed by block and shelf position. A shelf filters out songs already claimed by any shelf earlier in display order, then records its own claim; claims are replaced on re-render, so the result is stable. Since 9.0 a shelf that had at least six songs keeps at least six: when de-duplication would leave it shorter, it takes back songs an earlier shelf showed, in its own order, without claiming them (`SHELF_FLOOR`). Since 7.1 the ledger claims a song by catalogue id and by canonical identity (`songKey`), so another cut of a song shown on an earlier shelf is dropped too. Identity is also collapsed where the lists are built: in `mixes.ts` for the personal mixes, in the hard filter for queues and in `trending.ts` for the trending shelf. `features/home/dedupeShelves.ts` is an older identity-based helper that is exercised by unit tests and is not called by the Home page.

## Developer breakdown

The breakdown is on when the URL has `?debug=recs`, when `localStorage` has `vinax.debug.recs` set to `1`, or in a development build. The panel (`features/recommendation/RecsDebugPanel.tsx`) is a lazy chunk; the app layout decides whether to mount it once, at load. The engine checks the switch before every publish and publishes nothing when it is off.

The store keeps the last 12 continuations. Each shows:

- **Trace** — mode, arc shape, language lock and policy, discovery share, this sitting's intent, how many songs survived each stage (gathered → admitted → ranked → sequenced → queued), spacing repairs and relaxed rules.
- **Selected songs** — position, rank before sequencing, final score, candidate source, every scoring component, whether the local engine or the AI chose the order, and the DJ's confidence when it picked.
- **Passed over** — the best 15 ranked songs that were not chosen, with their components.
- **Rejected** — up to 80 candidates with the rule that turned each away and the stage (`filter`, `rank` or `validate`).

## Tests

The rules above are pinned by unit tests next to the modules. 8.2 adds `candidates.test.ts` cases for the album, related-artist, genre and proven sources and the `unplayable` mark, `filters.test.ts` for `no-audio`, `scoring.test.ts` and `engine.taste.test.ts` for the taste fit and the served penalties, `vectors.test.ts`, `recMemory.test.ts`, `transitionTracker.test.ts` for `autoOutcomeFor`, `features/home/homeOrder.test.ts`, `homeSignals.test.ts`, `homeTaps.test.ts`, `genreAffinity.test.ts`, `features/radio/aiRadio.test.ts`, `store/playerStore.radio.test.ts` and `features/queue/SmartQueue.test.tsx`. Earlier ones: `nextFive.test.ts` (one language in every mode under the lock, which a context without `queueLanguages` keeps; familiar opening; intent candidates), `engine.test.ts` (8.1: "Your languages" lets the listener's other languages in with the seed's language leading and never two switches in a row, never starves the queue, and changes nothing for a listener with one language), `filters.test.ts` (8.1: the allow-list rejects a known language outside it as `off-language` and passes unknown ones), `discoveryModes.test.ts`, `sequencer.test.ts`, `validation.test.ts`, `tune.test.ts`, `adaptive.test.ts`, `songIdentity.test.ts`, `sessionIntent.test.ts`, `eventWeights.test.ts` and `services/ai/trending.test.ts`. See [testing.md](testing.md) for how to run them.

The offline evaluation ([evaluation.md](evaluation.md)) has a mixed-language scenario since 8.1: the `mixed-queue` fixture (`frontend/eval/fixtures/index.ts`) is a Hindi seed for a listener who plays Hindi, Telugu and Tamil with `queueLanguages: 'mix'`, and its pool also holds a language the listener never chose. Its rules (`eval/lib/rules.ts`) count a song outside the listener's languages as `off-language`, an off-lead song in slot 1 or 2 as `language-opening`, and two off-lead songs back to back as `language-run`; all three count as hard violations, so the harness fails if the mix rules break. Run `node scripts/eval-recs.mjs` from `frontend/` to prove or disprove a change to any of this.
