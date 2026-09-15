# Local recommendation system

VinaX recommendations use a local-first hybrid pipeline and share one flow across Home shelves, autoplay/next-song, radio, and playlist continuation:

1. **Profiles** build reusable song, user, and session vectors. Song vectors include mood, vibe, language, dialect/sub-language, genre, energy, tempo, and artist identity. User vectors combine decayed plays/completions, likes, skips, favorites, and history. Session vectors describe the current listening run.
2. **Candidate generation** combines seed-song suggestions, related songs, favorite artists/albums, history rediscovery, language trends, and optional unexplored-language discovery. Provider failures only shrink the pool.
3. **Scoring** adds explainable feature terms and stores reason components for the “Why this song?” menu action.
4. **Re-ranking** applies a greedy MMR-style diversity pass to avoid repeating artists, languages, or genres while preserving relevance. Discovery candidates receive a small floor when Explore mode is enabled.

## Tunable scoring weights

All feature values are normalised to 0–1. The canonical values live in `src/services/recommendation/weights.ts` (version `1.0.0`).

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

`recommendNextSongs`, `startRadioRecommendations`, and `continuePlaylist` are the shared service entry points. Playback automatically fetches a small recommendation tail when autoplay is enabled and the current queue is nearly exhausted; existing queue and playback APIs remain unchanged.

## AI routing and fallback

`src/services/ai/recommendations.ts` calls the first-party `/api/curate` adapter. The worker keeps provider credentials and concrete model IDs server-owned, and routes each task through the existing lane abstraction. Metadata classification prefers low-latency lanes (`fast`, `chat`, `search`, `scholar`); final continuation ranking prefers stronger lanes (`dj`, `scholar`, `home`, `chat`). The worker health ledger orders lanes by observed latency and recent failures, while the lane ladder automatically falls back when a provider is unavailable or slow. Structured metadata is cached for 30 days (bounded to 500 songs). If every model is unavailable or returns invalid JSON, the deterministic profile/scoring/re-ranking path remains fully functional.
