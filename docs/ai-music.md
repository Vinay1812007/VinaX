# AI music experience

This file covers the music features that use personal taste or an AI model: the catalogue recommendation routes (`/api/recommendations`), the three routes under `/api/ai/` (described search, playlist, DJ), the taste data the app keeps on the device and what it sends with a request, and the rules that stop a model from inventing songs or facts. For each route it gives the method, request and response fields, limits, status codes and caching. The provider keys, lanes, failover, cooldowns and owner switches underneath are in [ai.md](ai.md); the on-device recommender is in [recommendations.md](recommendations.md); what is stored where is in [data-and-privacy.md](data-and-privacy.md).

Backend paths are relative to `backend/worker/functions/`; frontend paths to `frontend/src/`.

## Routes at a glance

| Route | Uses a model | Called by the app today | When the model cannot answer |
| --- | --- | --- | --- |
| `GET /api/recommendations/similar/:songId` | No | No (public API only) | Not applicable |
| `GET /api/recommendations?seeds=…` | No | No (public API only) | Not applicable |
| `POST /api/ai/search` | Yes, to fill filters | Yes — `services/ai/searchReading.ts` | `200` with the rules reading (`source: "rules"`) |
| `POST /api/ai/playlist` | Yes | No — the app calls `/api/playlist` (`services/ai/playlist.ts`) and resolves titles itself | `200` with a catalogue playlist (`source: "catalogue"`) |
| `POST /api/ai/dj` | Yes | No — the app calls `/api/dj` (`services/ai/dj.ts`); both paths run the same handler | `503`, `429` or `500`; the app keeps its on-device order |

The app reaches the same generation through `/api/playlist` and `/api/dj`, which are described in [ai.md](ai.md). The `/api/ai/playlist` and `/api/recommendations` routes return catalogue song ids directly, so a caller needs no matching code of its own.

## Rules every feature follows

- **Listening history and the taste profile stay on the device.** There are no accounts and no per-listener tables on the server. A route personalises only from what one request carries (a bounded taste snapshot, a listening context, or seed song ids) and stores none of it.
- **The catalogue is the music database.** VinaX proxies an upstream catalogue (`api/cat/[[path]].ts`). "Only songs that exist" means every id a route returns was served by the catalogue in that same request, or is one the app already holds.
- **The model proposes; code decides.** In search the model only fills a filter object from fixed vocabularies and never names songs. In the playlist and the DJ every proposal is matched to a catalogue song by title and credited artist, or dropped. A missing song is never replaced by a different one.
- **Track fields come from the catalogue**, never from the model. The only model-written text that reaches a listener is a playlist title and description, a per-track reason, and the DJ's intro and segues.
- **Every feature has an answer without a model**: the rules reading for search, a catalogue playlist, the on-device queue for the DJ. The recommendation routes use no model at all.
- **No cross-listener collaborative filtering.** "Co-play" is item-to-item inside one listener's own history (`services/recommendation/coplay.ts`).

## Behaviour shared by all five routes

- **Auth:** none. CORS allows any origin (`access-control-allow-origin: *`).
- **Per-client rate limit:** `_lib/ratelimit.ts`, keyed by client address. Each route has a token bucket (the "burst" and "per minute" figures below) plus a platform rate-limit binding tier (`RATE_LIMIT_10`, `_30`, `_60`, `_300`). Over the limit: `429 { "error": "rate_limited", "retryAfter": <seconds> }` with a `retry-after` header.
- **Wrong method:** `405 { "error": "method_not_allowed" }` with an `allow` header.
- **Unexpected failure:** `500 { "error": "internal" }`.
- **Caching:** `cache-control: no-store` on everything except the two successful recommendation answers, noted below.
- **Oversized body** (POST routes): `413 { "error": "too_large" }`; unreadable or invalid body: `400 { "error": "bad_request" }`.

## When the AI is busy: 429 or 500

Since 11.0, a route that finds every engine rate-limited or cooling down answers `429` instead of `500`, so a client can say "busy" rather than "something went wrong". Other upstream failures keep `500`. How this applies to the routes in this file:

| Route | Every engine rate-limited | Notes |
| --- | --- | --- |
| `/api/ai/dj` and `/api/dj` | `429 { "error": …, "status": 429 }` | `api/dj.ts`. The body is not the rate limiter's body and **no `retry-after` header is set**. The app backs off 60 s on any non-OK answer, so it treats this 429 and a 500 alike. |
| `/api/playlist` | `429 { "error": …, "status": 429 }` | `api/playlist.ts` `runPlaylist()`. Also without a `retry-after` header. The app maps any 429 to "busy" (`failureReason` in `services/ai/playlist.ts`). |
| `/api/ai/playlist` | `200` catalogue playlist | It calls `runPlaylist()` and treats "busy" like any unavailable AI, so this 429 never reaches the caller. Its only 429 is the per-client rate limit. |
| `/api/ai/search` | `200` with `source: "rules"` | Never fails because of the model. Its only 429 is the per-client rate limit. |
| `/api/recommendations*` | Not applicable | No model. Their only 429 is the per-client rate limit. |

A caller that needs to tell the two 429s apart can read the body: the per-client limit answers `error: "rate_limited"` with `retryAfter`; the busy answer carries a `status` field and no `retryAfter`. A `retry-after` header on the busy answer exists only on the chat route, described in [ai.md](ai.md).

## Recommendations from the catalogue

Both routes are anonymous and use no model. Logic lives in `_lib/recs.ts`. Candidates come from two pools, in this order: the catalogue's similar-songs list for the seed (`reason: "similar"`), then songs the catalogue **credits** to the seed's lead artist (`reason: "same_artist"`; a text match on the name is not enough). At most `max(2, ⌈limit / 5⌉)` songs per artist.

### `GET /api/recommendations/similar/:songId`

- **Path:** `songId` must match `^[A-Za-z0-9_-]{2,40}$`, otherwise `400 invalid_song_id`.
- **Query:** `limit` 1–30 (default 20); `languages`, a comma list of at most 6 lower-case names (letters only, 2–20 characters each). A value outside these gives `400 bad_request`.
- **Rate limit:** 30 burst, 30 per minute.
- **200**, cached `public, max-age=600, s-maxage=3600`:

  ```json
  {
    "seed": { "id": "a1B2c3D4", "title": "Evening Song", "artist": "Lead Singer", "language": "telugu" },
    "tracks": [
      { "id": "x9Y8z7W6", "title": "Night Road", "artist": "Artist A", "artists": ["Artist A"], "album": "Night Road", "language": "telugu", "year": 2021, "durationSec": 243, "reason": "similar", "reasonText": "Similar to “Evening Song”", "seedId": "a1B2c3D4" }
    ],
    "source": "catalogue"
  }
  ```

  `artists` holds at most four names. `reasonText` is "Similar to “<seed title>”" or "More by <seed artist>".
- **Errors:** `400 invalid_song_id` / `bad_request`; `404 song_not_found`; `429 rate_limited`; `502 catalogue_unavailable`; `405` for POST.

### `GET /api/recommendations?seeds=…`

Songs like a few songs the caller names, for example a listener's most-played ids chosen on the device.

- **Query:** `seeds`, 1–5 song ids (required); `limit` and `languages` as above; `exclude`, up to 100 ids never to return. A missing `seeds`, a malformed id or an over-long list gives `400 bad_request`.
- **Rate limit:** 10 burst, 10 per minute.
- **200**, cached `private, max-age=600`: `{ "seeds": [ { id, title, artist, language } ], "tracks": [ … ], "source": "catalogue" }` with the same track shape. Seeds take turns (round robin) so one seed cannot fill the list. Seeds and `exclude` ids never come back. Unknown seeds are skipped.
- **Errors:** as above, except there is no `invalid_song_id` (a bad id is `bad_request`), and `404 song_not_found` only when none of the seeds exist.

## Described search

Two readers produce one `SearchFilters` object (`_lib/searchFilters.ts`):

```ts
{ languages: string[]; moods: ('romantic'|'energetic'|'chill'|'melancholy'|'devotional')[];
  activity: 'workout'|'party'|'wedding'|'drive'|'focus'|'sleep'|'rain'|'travel'|null;
  energy: 'high'|'low'|null; tempo: 'slow'|'fast'|null;
  yearFrom: number|null; yearTo: number|null;      // inclusive; "the 2000s" → 2000–2009
  seed: { text: string; kind: 'song'|'artist'|'unknown' }|null;   // "songs like <name>"
  instrumental: boolean; style: 'dj'|'folk'|'devotional'|null;
  keywords: string[] }                              // at most five
```

- **Rules** (`rulesFilters`) are deterministic and always available.
- **Model**: reads the same shape on the `fast` lane with a 4.5 s budget. Its JSON is untrusted: `sanitizeFilters` keeps only vocabulary values (at most three languages and three moods) and drops a year range wider than 30 years. `mergeFilters` lets what the rules read literally win; the model fills gaps.
- **Catalogue phrasings** (`catalogueQueries`) turn filters into search phrases the catalogue is known to answer well, such as `<language> instrumental` or `<language> romantic songs`.

### `POST /api/ai/search`

- **Request** (body ≤ 4 KB): `{ "query": string (2–200 characters), "languages"?: string[] (used only when the query names none; at most 3 kept), "limit"?: integer 1–30 (default 20), "withTracks"?: boolean (default true) }`.
- **Rate limit:** 20 burst, 10 per minute. Model calls are logged under feature `search`, which is also the name of its owner switch (see [ai.md](ai.md)).
- **200:**

  ```json
  {
    "filters": { "languages": [], "moods": ["melancholy"], "activity": null, "energy": null, "tempo": null, "yearFrom": 2000, "yearTo": 2009, "seed": null, "instrumental": false, "style": null, "keywords": [] },
    "summary": "sad · 2000–2009",
    "source": "ai",
    "checked": ["year"],
    "seed": null,
    "tracks": [ { "id": "k3J4h5G6", "title": "Rain Again", "artist": "Singer B", "artists": ["Singer B"], "album": "Rain Again", "language": "hindi", "year": 2004, "durationSec": 280, "reason": "match", "reasonText": "Matches sad · 2000–2009" } ]
  }
  ```

  - `source` is `"ai"` when the model's reading was used, `"rules"` when the model was off, over budget, not configured, slow or unusable.
  - `checked` lists the filters verified on the catalogue's own fields: `language`, `year`, `seed`. Mood, energy and tempo choose the phrasings but cannot be verified, because the catalogue exposes no audio features.
  - `seed` is `{ id, title, artist, kind: "song" | "artist" }` when the named song or artist was found in the catalogue, else `null`.
  - Track `reason` is `similar`, `by_artist` or `match`.
  - With `withTracks: false` the answer has `checked: []`, `seed: null`, no `tracks`, and no catalogue call is made.
- **Errors:** `400 bad_request`; `413 too_large`; `429 rate_limited`; `502 catalogue_unavailable` (only when tracks were asked for); `405` for GET.

### How the app uses it

`features/search/semanticSearch.ts` runs the on-device reading and asks the server for its reading in parallel. `services/ai/searchReading.ts` sends `withTracks: false`, waits at most 2.5 s, and does nothing when the listener's AI switch is off. After a failure it backs off: 30 minutes for 404 or 405 (the deployed Worker has no such route), 60 s for 429, otherwise 30 s doubling up to 15 minutes. When the server's reading adds something, the app runs at most two more catalogue searches. A seed resolves to the catalogue's similar songs (`features/search/seedSearch.ts`).

## Playlist from a description

Generation is `runPlaylist()` in `api/playlist.ts`: a gather pass and a curate pass inside a 31 s budget. The curator writes a per-track `reason` (at most 120 characters). `avoidTitles` ride the prompt and are also enforced in code (`filterAvoided`), unless the listener's own prompt names the song.

### `POST /api/ai/playlist`

- **Request** (body ≤ 32 KB): `{ "prompt": string (1–500 characters, trimmed), "languages"?: string[] (at most 5 kept), "taste"?: <taste snapshot, below>, "avoidTitles"?: string[] (first 60 kept, 90 characters each), "limit"?: integer 10–30 (default 25) }`. A `limit` outside 10–30 gives `400`.
- **Rate limit:** shares one bucket with `/api/playlist` (6 burst, 3 per minute), so alternating the two routes does not double the budget.
- **200:**

  ```json
  {
    "title": "Late Night Drive",
    "description": "A selection of atmospheric tracks for a nighttime drive.",
    "tracks": [
      { "id": "n8M7b6V5", "reason": "Matches the requested nighttime, atmospheric mood", "title": "Night Road", "artist": "Singer One", "album": "Night Road", "language": "telugu", "year": 2019, "source": "ai" },
      { "id": "g5F4d3S2", "reason": "Matches Telugu · calm", "title": "Slow Lights", "artist": "Singer Two", "album": null, "language": "telugu", "year": 2016, "source": "catalogue" }
    ],
    "source": "ai",
    "dropped": 3
  }
  ```

- **No substitution:** every suggestion is looked up in the catalogue on the server (`_lib/playlistResolve.ts`, `matchesSuggestion`, inside a 9 s budget). A suggestion with no matching song is dropped and counted in `dropped`. A language the request names is enforced.
- **Top-up:** fewer than 12 resolved picks (or fewer than `limit` when that is smaller) are topped up with catalogue songs for the request's own filters; those tracks carry `source: "catalogue"`. The top-level `source` is `"ai"` when at least one track came from the model.
- **Fallback:** when the AI is not configured, switched off, over budget, busy or unusable, the answer is still `200`: a catalogue playlist with `source: "catalogue"`, `dropped: 0`, a plain title built from the request's filters and the description "Songs from the VinaX catalogue that match your request."
- **Errors:** `400 bad_request`; `413 too_large`; `429 rate_limited`; `502 catalogue_unavailable`; `405` for GET.

### How the app builds a playlist

The app calls `/api/playlist`, which answers `{ name, description, songs: [{ title, artist, reason? }], reading, model }`, and resolves each title in the catalogue itself (`services/ai/playlist.ts`, using `matchesProposal` from `services/ai/dj.ts`). The same rule applies: an unmatched suggestion is dropped and the catalogue pool, ranked against the request, fills the gap. The app waits at most 34 s. It remembers up to 100 recently used titles under the localStorage key `vinax.aiplaylist.avoid.v1` and sends them as `avoidTitles`.

## AI DJ

The queue is built by the on-device engine. The DJ refines its order and, when asked, proposes a few songs from outside the pool. The handler is `api/dj.ts`; `api/ai/dj.ts` only re-exports it, so `/api/ai/dj` and `/api/dj` behave identically. The prompt, sequencing rules and lanes are in [ai.md](ai.md).

### `POST /api/ai/dj`

POST, not GET, because the listening context lives on the device and is sent with each request.

- **Request** (body ≤ 48 KB): `{ "context": object (must be non-empty: recentlyPlayed, recentlyCompleted, skippedSongs, likedSongs, topSongs, preferredArtists, avoidArtists, …), "pool": [ { "id"?, "title", "artist", "language"?, "album"?, "year"?, "known"?, "mood"?, "energy"?, "tempo"? } ], "count"?: 1–20 (default 8), "discover"?: boolean, "maxDiscover"?: 0–6 (default 4, forced to 0 without `discover`), "wantSegues"?: boolean (default true) }`. Pool entries without a title and artist are ignored, the first 60 are kept, and at least 3 must remain. Out-of-range numbers are clamped, not rejected.
- **Rate limit:** 15 burst, 8 per minute. Owner switch and log feature: `dj`.
- **200:** `{ "intro": string, "songs": [ { "songId": string | null, "title", "artist", "reason", "segue", "confidence", "fromPool": boolean } ], "model": string | null }`. A pool pick is matched back to the pool by id or by canonical title and artist. A discovery has `songId: null` and `fromPool: false`; the app must find it in the catalogue before it can play.
- **Errors:** `400 bad_request` / `empty_context` / `pool_too_small`; `413 too_large`; `429 rate_limited`; `503 ai_not_configured` / `ai_disabled` / `ai_over_budget`; `429` or `500` with `{ error, status }` when no engine produced a usable set (see "When the AI is busy"); `405` for GET.
- **Budget:** 26 s on the server.

### Grounding of spoken lines

`_lib/grounding.ts` (`buildFacts`, `groundedLine`) checks the intro (at most 200 characters), every reason (120) and every segue (160). A line is replaced by an empty string when it makes a claim that needs a source (awards, charts, sales, stream or view counts, box office, births, debuts), holds a number the pool does not carry, or names someone or something mid-sentence that is not a pool title, artist, album or language. Dropping a line is always safe: the set plays without it.

### How the app uses it

`services/ai/dj.ts` sends at most 40 pool songs and `maxDiscover: 4`, sets `wantSegues` from the DJ voice setting, and waits at most 30 s. On `503` with `ai_not_configured` or `ai_disabled` it stops asking for the session; `ai_over_budget` backs off 15 minutes; 404 or 405 backs off 10 minutes; any other failure, including 429, backs off 60 s. In every case the on-device order plays. Two skips in the automatic tail re-plan it, and a like on the playing song rebuilds the tail (`services/recommendation/adaptive.ts`, `noteLikeAndMaybeReplan`); both share a 90 s cooldown.

## Taste on the device

### Signals

`services/personalization/updater.ts` turns player and library actions into profile updates. The weights are one table in `services/personalization/eventWeights.ts` (`EVENT_WEIGHTS_VERSION` 1.2.0):

| Signal | Weight |
| --- | --- |
| Play | +1.0 |
| Complete | +2.0 |
| Skip | −0.75, and the play's +1.0 is taken back |
| Favourite | +3.0 |
| Queue add | +0.5 |
| Search, then play | +1.5 |
| "Less like this" | −3.75 and a 14-day soft mute of the artist |
| "Not interested" (hide a song) | −1.5 |
| Add to your own playlist | +1.0 |

Positive scores halve every 14 days, skips every 30. Hiding and playlist adds are raised by `store/libraryStore.ts` (`toggleHidden`, `recordDislike`, `recordPlaylistAdd`).

### Where it is stored

The key names are the `KEYS` table in `constants/storage-keys.ts`.

| Data | Place |
| --- | --- |
| Taste profile (`TasteProfile` in `services/personalization/profile.ts`) | localStorage `vinax.profile.v1`; Kid mode uses `vinax.profile.kid.v1` |
| Listening history (150 entries, `store/historyStore.ts`) | localStorage `vinax.history.v1` |
| Favourites, playlists, hidden songs (`store/libraryStore.ts`) | localStorage `vinax.library.v1` |
| Device id and its signed form | localStorage `vinax.device-id`, `vinax.signed-device-id` |

With analytics consent only, the same actions are also sent to `POST /api/events` (header `x-vinax-consent: analytics`; 60 per minute; a written or ignored event answers `204`). That route is described in [data-and-privacy.md](data-and-privacy.md).

### What a request carries

`services/ai/taste.ts` `buildTasteSnapshot()` builds the snapshot sent as `taste`; the server reads it with `_lib/taste.ts` `tasteBlock()` and keeps only these fields, each string clipped to 90 characters:

| Field | Most entries kept |
| --- | --- |
| `preferredLanguages`, `avoidLanguages` | 5 each |
| `topArtists` | 10 |
| `topSongs`, `likedSongs` | 8 each |
| `recentlyPlayed` | 10 |
| `alreadyRecommendedThisChat` | 32 |
| `tasteDials` | 4 |
| `timeOfDay`, `sessionVibe` | one string each, 30 characters |

Anything else in the object is ignored, and nothing is stored.

### Taste profile page and Home

`features/taste-profile/useTasteInsights.ts` shows the skip rate, the top moods and the new-to-you share: the share of the last 30 days' plays whose lead artist has at most 3 counted plays, shown only from 10 plays. `features/home/useSimilarArtists.ts` builds the Similar artists shelf from the catalogue's similar-artist lists for the 3 most-played artists.

## Tests

| Area | Files |
| --- | --- |
| Signals and taste | `frontend/src/services/personalization/updater.test.ts`, `store/libraryStore.test.ts`, `features/taste-profile/useTasteInsights.test.ts` |
| Recommendation routes | `backend/worker/functions/api/recommendations.test.ts`; `frontend/src/features/home/useSimilarArtists.test.ts` |
| Search | `backend/worker/functions/api/ai/search.test.ts`; `frontend/src/services/ai/musicIntent.test.ts`, `features/search/semanticSearch.test.ts` |
| Playlist, no substitution, catalogue fallback | `backend/worker/functions/api/ai/playlist.test.ts`; `frontend/src/services/ai/playlist.test.ts` |
| DJ and grounding | `backend/worker/functions/api/dj.test.ts`, `api/styleLock.test.ts`, `_lib/grounding.test.ts`; `frontend/src/services/ai/dj.test.ts`, `services/recommendation/adaptive.test.ts` |
| Busy is 429, other failures stay 500 (`/api/dj`, `/api/playlist`) | `backend/worker/__tests__/aiAuditSweep.test.ts` |
| Every handler is routed | `backend/worker/__tests__/routerCoverage.test.ts` |

To measure a ranking change, run `node frontend/scripts/eval-recs.mjs` ([evaluation.md](evaluation.md)). How to run the test suites is in [testing.md](testing.md).

## Checking a deployment

After a Worker deploy, request `GET /api/recommendations/similar/<a real song id>?limit=5` and `POST /api/ai/search` with `{"query":"upbeat telugu songs","withTracks":false}` on the live site. A `404`, or a `405` on the POST, means the deployed Worker predates these routes. The owner console lists the `search`, `playlist` and `dj` switches ([admin-console.md](admin-console.md)); secrets and bindings are in [operations.md](operations.md).

## Known gaps

- The busy `429` from `/api/dj`, `/api/ai/dj` and `/api/playlist` has no `retry-after` header, so a client has to choose its own wait.
- The app can send up to 140 `avoidTitles` to `/api/playlist`, but the server keeps the first 60. Titles the app adds at the end of the list (locked and excluded songs) can be cut off when the remembered list is long.
- No app code calls `/api/recommendations`, `/api/recommendations/similar/:songId`, `/api/ai/playlist` or `/api/ai/dj`. They are covered by backend tests only.
