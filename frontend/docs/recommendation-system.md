# Local recommendation system

VinaX recommendations use a local-first hybrid pipeline and share one flow across Home shelves, autoplay/next-song, radio, and playlist continuation:

1. **Profiles** build reusable song, user, and session vectors. Song vectors include mood, vibe, language, dialect/sub-language, genre, energy, tempo, and artist identity. User vectors combine decayed plays/completions, likes, skips, favorites, and history. Session vectors describe the current listening run.
2. **Candidate generation** combines seed-song suggestions, related songs, favorite artists/albums, history rediscovery, language trends, and optional unexplored-language discovery. Provider failures only shrink the pool.
3. **Scoring** adds explainable feature terms and stores reason components for the “Why this song?” menu action.
4. **Re-ranking** applies a greedy MMR-style diversity pass to avoid repeating artists, languages, or genres while preserving relevance. Discovery candidates receive a small floor in Discover mode.

## The next-song pipeline (7.0)

`recommendNextSongs` (`src/services/recommendation/engine.ts`) runs one explicit pipeline; every stage is code, and every stage is traced for the developer breakdown (`?debug=recs`):

| # | Stage | Where | What it does |
| --- | --- | --- | --- |
| 1 | Candidate generation | `candidates.ts` | Seed suggestions, seed artist, seed language, recent listens, favourites, favourite albums and artists, trending per language, rediscovery; Familiar mode adds favourites and finished songs, Discover adds unheard languages |
| 2 | Hard filtering | `filters.ts` | Rules with a named reason per rejection: invalid, junk, too short, explicit (kid mode), blocked, muted language, the seed or a version of it, already queued, recently played (by id and by canonical identity), skipped this sitting; versions of one song collapse onto the best cut |
| 3 | Feature extraction | `services/ai/recommendations.ts` | Classifier metadata (mood, genre, energy, tempo) with a bounded wait; cached 30 days; optional |
| 4 | Context scoring | `scoring.ts` | Taste, seed similarity, time of day, weekday, session vector, dials |
| 5 | Diversity and repeat penalties | `reranking.ts`, `scoring.ts` | MMR re-rank, artist fatigue (third and later recent play of one lead artist), recent-play demotion |
| 6 | Session adjustment | `services/personalization/sessionIntent.ts` | This sitting's skips, completions, likes, searches and hand queue-adds: artist and language pull, energy steer, discovery appetite. Never written to the long-term profile |
| 7 | Exploration / familiarity tuning | `scoring.ts`, `engine.ts` | Familiar / Balanced / Discover: a signed novelty swing in the score, the queue's discovery share (5 % / 20 % / 45 %), language policy (lock, lock, prefer) |
| 8 | Ranking | `scoring.ts` | The scored, re-ranked pool, plus any “Tune this queue” nudge |
| 9 | Queue sequencing | `sequencer.ts` | Energy arc, mood flow, transition memory, transition smoothness, lead and featured artist spacing, era, language policy |
| 9b | AI DJ (optional) | `services/ai/dj.ts` | May re-order the pool and propose catalogue-verified songs |
| 10 | Validation | `validation.ts` | The final order, whoever produced it, re-checked against every rule: hard filter again, one song per identity, language lock (relaxed only toward languages the listener plays, only when the queue would starve), artist cap, no lead artist back to back |

Manual actions outrank automation in the player (`store/playerStore.ts`): a hand-queued song is inserted ahead of the recommender's tail, survives an adaptive re-plan and “Tune this queue”, and a continuation that arrives after the listener started something else is dropped.

## Tunable scoring weights

All feature values are normalised to 0–1. The canonical values live in `src/services/recommendation/weights.ts` (version `1.2.0`).

| Signal | Weight | Notes |
| --- | ---: | --- |
| Mood | 0.16 | Seed/session mood continuity |
| Artist affinity | 0.14 | Decayed artist plays/completions |
| Language | 0.12 | Long-term and seed language |
| Session context | 0.12 | Current energy/language momentum |
| Genre | 0.10 | Metadata or conservative title inference |
| Vibe | 0.10 | Metadata or title inference |
| Energy | 0.10 | Closeness to seed/user energy |
| Likes | 0.10 | Explicit favorites and liked-song memory |
| History | 0.10 | Recent-song repetition penalty |
| Tempo | 0.08 | BPM closeness to seed/user tempo |
| Dialect/sub-language | 0.08 | Exact metadata match |
| Discovery | 0.07 | Explore/trending discovery floor |
| Popularity | 0.05 | Cold-start fallback |
| Freshness | 0.04 | Recent-release nudge |
| Diversity | 0.20 | Re-ranking penalty for repeated facets |
| Skips | 0.12 | Signed penalty; song-level skips are remembered |
| Novelty | 0.16 | Signed by the discovery mode and the sitting's appetite: ±0.08 at the extremes, 0 in a neutral Balanced |
| Artist fatigue | 0.04 | Per recent play of the same lead artist beyond two, capped at four steps |
| Intent: artist | 0.18 | This sitting's pull on an artist (−1..1) |
| Intent: language | 0.08 | The same for a language (−0.6..0.6) |
| Intent: energy | 0.30 | Energy steer (−0.3..0.3) × the candidate's distance from mid energy |
| Intent: skipped song | 0.40 | A song skipped in this sitting (also a hard filter for next-song) |

`recommendNextSongs`, `startRadioRecommendations`, and `continuePlaylist` are the shared service entry points. Playback automatically fetches a small recommendation tail when autoplay is enabled and the current queue is nearly exhausted; existing queue and playback APIs remain unchanged.

## AI routing and fallback

`src/services/ai/recommendations.ts` calls the first-party `/api/curate` adapter. The worker keeps provider credentials and concrete model IDs server-owned, and routes each task through the existing lane abstraction. Metadata classification prefers low-latency lanes (`fast`, `chat`, `search`, `scholar`); final continuation ranking prefers stronger lanes (`dj`, `scholar`, `home`, `chat`). The worker health ledger orders lanes by observed latency and recent failures, while the lane ladder automatically falls back when a provider is unavailable or slow. Structured metadata is cached for 30 days (bounded to 500 songs). If every model is unavailable or returns invalid JSON, the deterministic profile/scoring/re-ranking path remains fully functional.
