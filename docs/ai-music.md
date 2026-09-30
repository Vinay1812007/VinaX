# AI music experience (8.5)

This document describes the personalization and AI music features as of 8.5.0 (API 5.20.0): what each one does, where its data lives, and the contract of every endpoint — request and response schemas, authentication, validation, errors and an example. The lane / failover layer underneath is in [ai.md](ai.md); the on-device recommender in [recommendations.md](recommendations.md); what is stored where in [data-and-privacy.md](data-and-privacy.md).

Backend paths are relative to `backend/worker/functions/`; frontend paths to `frontend/src/`.

## Architecture decisions

| Decision | Why |
| --- | --- |
| **Listening history and the taste profile stay on the device.** No new server tables. | VinaX has no accounts: an install is a random device id. History, likes, playlists and the taste profile were already local, and the recommender already runs on the device. Moving them to the server would need accounts or device-keyed personal data, sync, row-level security and a deletion flow — and would store more personal data, which the spec asks to minimise. The owner chose on-device (2026-09-30). |
| **The server personalises only from what a request carries.** | The AI routes receive a bounded taste snapshot (`_lib/taste.ts`) or seed song ids per request and keep none of it. `/api/recommendations` takes seeds chosen on the device. |
| **The catalogue is the music database.** | VinaX proxies an upstream catalogue (`api/cat/[[path]].ts`); there is no songs / artists / albums table. "Only songs that exist" therefore means: every id returned is one the catalogue served in the same request, or one the app already holds. |
| **AI fills filters or proposes; code decides.** | Search: the model only fills a filter object from fixed vocabularies. Playlist and DJ: every proposal is matched to a catalogue song by title and credited artist, or dropped — never swapped for a different song. |
| **Every AI feature has a non-AI answer.** | Search falls back to the rules reading, the playlist to a catalogue playlist, the DJ to the on-device queue, recommendations are catalogue-only. |
| **No cross-user collaborative filtering (yet).** | "Co-play" is item-to-item within one listener's own history (`services/recommendation/coplay.ts`). Anonymous cross-user pairs from consented events were considered and deferred by the owner. |
| **Installed app builds keep working.** | `/api/playlist` and `/api/dj` answer exactly as before; the `/api/ai/*` routes are additions. |

### Where the spec's data model lives

| Spec entity | In VinaX |
| --- | --- |
| Users | No accounts. `services/identity/installId.ts` (random id); a signed id for `/api/events` and `/api/username`. |
| Songs, artists, albums, genres | The upstream catalogue via `/api/cat/*`. Genre and mood are inferred (`services/recommendation/profiles.ts`, `mood.ts`) or classified by `/api/curate`. |
| Playlists | `store/libraryStore.ts` `collections` (device). |
| User likes | `libraryStore.favorites` + `TasteProfile.likedSongIds` (device). |
| Listening history | `store/historyStore.ts` (150 entries) + the IndexedDB event log (`services/storage/idb.ts`) (device). With analytics consent only, events are also sent to `vinax_events` (see `/api/events`). |
| Skips | `TasteProfile.skippedSongIds`, per-artist/language skip counts, the session intent (device). |
| User taste profile | `services/personalization/profile.ts` `TasteProfile` (device, localStorage). |

## 1. Listening-event tracking

`services/personalization/updater.ts` turns player and library actions into profile updates, one weight table in `eventWeights.ts` (`EVENT_WEIGHTS_VERSION` 1.2.0):

| Event | Weight | Source |
| --- | --- | --- |
| play (≥ 5 s) | +1.0 | player |
| complete (≥ 70 %) | +2.0 | player |
| skip (< 30 %) | −0.75, and the play bump is taken back | player |
| favourite / unfavourite | ±3.0 | library |
| queue add | +0.5 | queue |
| search → play | +1.5 | search |
| "Less like this" | −3.75 and a 14-day soft mute | track menu |
| **8.5 — "Not interested"** (hide a song) | −1.5 for the song and its artists; **language untouched**; not counted as a skip; undo only forgets the song (scores are floored at zero, so handing points back would net a gain) | track menu → `libraryStore.toggleHidden(id, song)` → `recordDislike` |
| **8.5 — add to your own playlist** | +1.0 for song, artists, language (a signal, not a play). Bulk imports are not counted. | `libraryStore.addToCollection` → `recordPlaylistAdd` |

Listening duration (`services/analytics/listenClock.ts`), hour and weekday histograms and per-language hour buckets are recorded with every play. Decay: positive scores halve every 14 days, skips every 30.

With analytics consent, the same actions are sent as events (`dislike` and `playlist_add` are new types; the endpoint accepts any non-reserved type):

### `POST /api/events` (existing — the listening-event API)

- **Auth:** none (no accounts). Written only with the header `x-vinax-consent: analytics`; without it the route answers 204 and writes nothing. Identity is the signed device id (`_lib/identity.ts`). CORS: the app's own origins.
- **Rate limit:** 60 / minute per client address.
- **Request:** `{ type (≤ 24 chars), song?: { id, title, artist, language, image }, platform?, name?, appVersion?, errorKind?, message?, meta? }` — every string clipped; `meta` only for `rec_served` / `rec_outcome`, whitelisted keys, ≤ 1 KB. Reserved admin types are dropped with the same 204.
- **Response:** 204.
- A duplicate `/api/listening-event` was not added: this route already is that API, and a second one would split the log.

## 2. Taste profile

`TasteProfile` (device) holds languages, artists and songs with decayed affinity; hour / weekday histograms; energy preference; recent, skipped, liked and (8.5) disliked song ids; soft mutes; the four taste dials; totals (8.5 adds `dislikes`, `playlistAdds`). `normalizeProfile` keeps every field through a reload.

8.5 surfaces on the Taste profile page (`features/taste-profile/useTasteInsights.ts`): **skip rate** (skips per counted play), **new-to-you share** (share of the last 30 days' plays whose lead artist has ≤ 3 counted plays; null under 10 plays), the **discovery mode**, **top moods** and **genres / vibes**.

## 3. Recommendations

The engine (`services/recommendation/*`, unchanged in 8.5) is hybrid: content features (language, mood, energy, era, hashed text vectors), catalogue-side similarity (the catalogue's similar songs and similar artists), within-listener co-play, session intent and time of day, followed by diversity re-ranking, hard filters and validation. Shelves: **Made For You** (the spec's "Recommended for you"), **Because you listened to / liked**, **Daily Mix N**, **Fresh Picks**, the weekly discovery mix, **Similar tracks** on song pages, and (8.5) **Similar artists** on Home (`features/home/useSimilarArtists.ts`: the catalogue's similar-artist lists for the three most-played artists, minus artists already played, blocked or muted).

Measure any ranking change with `node frontend/scripts/eval-recs.mjs` ([evaluation.md](evaluation.md)).

### `GET /api/recommendations/similar/:songId`

- **Auth:** none; anonymous and stateless — nothing about the caller is read or kept. **Cache:** `public, max-age=600, s-maxage=3600`.
- **Rate limit:** 30 / minute per client address.
- **Query:** `limit` 1–30 (default 20), `languages` comma list (letters, ≤ 6).
- **Validation:** `songId` must match `^[A-Za-z0-9_-]{2,40}$`.
- **Response 200:**

  ```json
  {
    "seed": { "id": "a1B2c3D4", "title": "Evening Song", "artist": "Lead Singer", "language": "telugu" },
    "tracks": [
      { "id": "x9Y8z7W6", "title": "Night Road", "artist": "Artist A", "artists": ["Artist A"], "album": "Night Road", "language": "telugu", "year": 2021, "durationSec": 243, "reason": "similar", "reasonText": "Similar to “Evening Song”", "seedId": "a1B2c3D4" },
      { "id": "q1W2e3R4", "title": "Morning Song", "artist": "Lead Singer", "artists": ["Lead Singer"], "album": null, "language": "telugu", "year": 2019, "durationSec": 201, "reason": "same_artist", "reasonText": "More by Lead Singer", "seedId": "a1B2c3D4" }
    ],
    "source": "catalogue"
  }
  ```

- **Sources:** the catalogue's similar-songs list, then songs the catalogue **credits** to the seed's lead artist (a text match is not enough). The seed's other releases are folded away; at most `max(2, ⌈limit/5⌉)` songs per artist.
- **Errors:** 400 `invalid_song_id` / `bad_request`; 404 `song_not_found`; 429 `rate_limited` (+ `retryAfter`); 502 `catalogue_unavailable`; 405 for other methods.

### `GET /api/recommendations?seeds=…`

- Songs like a few songs **the app names** (for example the listener's most-played ids, chosen on the device). Same auth, track shape and errors as above; **cache** `private, max-age=600`; **rate limit** 10 / minute.
- **Query:** `seeds` 1–5 ids (required), `limit` 1–30, `languages`, `exclude` ≤ 100 ids never to return.
- **Response 200:** `{ "seeds": [ {id, title, artist, language} ], "tracks": [ … ], "source": "catalogue" }`. Seeds take turns (round robin) so one seed never fills the list; seeds themselves and `exclude` never come back; unknown seeds are skipped (404 only when none exist).

## 4. AI music search

Two readers produce one `SearchFilters` object (`_lib/searchFilters.ts`):

```ts
{ languages: string[]; moods: ('romantic'|'energetic'|'chill'|'melancholy'|'devotional')[];
  activity: 'workout'|'party'|'wedding'|'drive'|'focus'|'sleep'|'rain'|'travel'|null;
  energy: 'high'|'low'|null; tempo: 'slow'|'fast'|null;
  yearFrom: number|null; yearTo: number|null;             // "the 2000s" → 2000–2009
  seed: { text: string; kind: 'song'|'artist'|'unknown' }|null;   // "songs like <name>"
  instrumental: boolean; style: 'dj'|'folk'|'devotional'|null; keywords: string[] }
```

- **Rules** (`rulesFilters`) — deterministic, always available. Words inside a seed name are not cues ("songs like Love Story" is not a romance request); "but more upbeat" is a modifier, not part of the name; pronouns ("more like this") are never a seed.
- **Model** — reads the same shape. Its JSON is untrusted: `sanitizeFilters` keeps only vocabulary values, clips strings (seed 80, keyword 30 chars), drops year ranges over 30 years and anything else (a `songs` array it adds is ignored). `mergeFilters`: what the rules read literally wins; the model fills gaps.
- **Catalogue phrasings** (`catalogueQueries`) — only phrasings probed live: `<lang> instrumental`, `<lang> acoustic songs`, `<lang> unplugged` (probed 2026-09-30, 20/20 in-language) and the existing `dance / mass / sad / romantic / devotional / melody songs`, `evergreen hits` (pre-2000 only). `<lang> slow songs` is deliberately not used: the catalogue matches it to titles such as "Slow Motion".

In the app (`features/search/semanticSearch.ts`), a described search runs the on-device reading and asks the server for its reading in parallel (`services/ai/searchReading.ts`: `withTracks: false`, 2.5 s leash, off with the listener's AI switch, backs off after failures). What the server adds is fetched too (≤ 2 more searches). A seed resolves to the catalogue's similar songs (`seedSearch.ts`); a named decade filters by year whenever ≥ 5 candidates carry one. "Songs that match" says whose similar songs are shown, or that the named song is not in the catalogue.

### `POST /api/ai/search`

- **Auth:** none. **Rate limit:** 20 / minute burst, 10 / minute refill. **Owner switch:** `search` (AI controls).
- **Request:** `{ "query": string (2–200 chars), "languages"?: string[] (fallback when the query names none, ≤ 3), "limit"?: 1–30 (default 20), "withTracks"?: boolean (default true) }` — body ≤ 4 KB.
- **Response 200:**

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

  `source` is `rules` when the model was off, over budget, slow (4.5 s budget) or unusable — the reading never fails with a 5xx. `checked` lists what was verified on catalogue fields (`language`, `year`, `seed`); mood, energy and tempo choose the phrasings but cannot be verified (the catalogue exposes no audio features). A year filter keeps only songs whose catalogue year is inside it. `seed` is `{ id, title, artist, kind }` when the name matched a song whose title IS the name ("<title> by <artist>" also checks the artist) or an artist credited under exactly that name; otherwise the name is searched as words, never guessed. With `withTracks: false`, `tracks` is absent and no catalogue call is made.
- **Errors:** 400 `bad_request`; 413 `too_large`; 429 `rate_limited`; 502 `catalogue_unavailable` (only with tracks); 405 for GET.

## 5. AI playlist

`api/playlist.ts` `runPlaylist()` generates (gather + curate on the playlist lanes, 31 s budget) — unchanged except that the curator now writes a per-track `reason` about fit only (mood, tempo, language, moment; never facts about the artist, film, awards or dates).

8.5 removed a quiet substitution in the app: when no catalogue result matched a suggestion, the first search hit (a different song) stood in. Now the suggestion is dropped and the catalogue pool, ranked against the request, fills the gap (`services/ai/playlist.ts`; the music expert shares it). AI Playlist shows each pick's reason.

### `POST /api/ai/playlist`

- **Auth:** none. **Rate limit:** shares the `/api/playlist` bucket (6 burst, 3 / minute), so alternating routes never doubles the budget. **Owner switch:** `playlist`.
- **Request:** `{ "prompt": string (1–500), "languages"?: string[], "taste"?: <taste snapshot>, "avoidTitles"?: string[] (≤ 60), "limit"?: 10–30 (default 25) }` — body ≤ 32 KB.
- **Response 200** (the spec's shape, plus display metadata):

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

- **Validation:** every suggestion is looked up in the catalogue on the server (`_lib/playlistResolve.ts`, the app's `matchesProposal` rule: identical canonical title + artist, or a title holding every suggested word whose credits name the suggested artist; dialogue / BGM / jukebox cuts never match). No match → dropped and counted in `dropped`. A language the request names is enforced. Fewer than 12 picks are topped up with catalogue songs for the request's own filters (`source: "catalogue"` on those tracks).
- **Fallback:** AI not configured, switched off, over budget or unusable → `200` with a catalogue playlist (`source: "catalogue"`, a plain title such as "Focus Mix") instead of an error.
- **Errors:** 400 `bad_request`; 413 `too_large`; 429 `rate_limited`; 502 `catalogue_unavailable`; 405 for GET.
- `/api/playlist` (installed builds) still answers `{ name, description, songs: [{ title, artist, reason? }], reading, model }`, resolved on the device.

## 6. AI DJ / personalized queue

The queue is the on-device engine; the DJ (`api/dj.ts`, `services/ai/dj.ts`) refines its order and may propose capped discoveries, each verified in the catalogue before it can play. It reads recent plays and completions, skips, likes, top songs, preferred and avoided artists; keeps one artist from playing twice in a row; places discoveries in the second half with a familiar song at least every fourth; and is rejected when it makes the energy arc worse. Two skips in the automatic tail re-plan it with surer picks; **8.5: a like on the playing song rebuilds the automatic tail right away** (`services/recommendation/adaptive.ts` `noteLikeAndMaybeReplan`; shared 90 s cooldown; hand-queued songs untouched).

**8.5 grounding** (`_lib/grounding.ts`, prompt rule 16): the intro, reasons and segues are removed when they claim something that needs a source (awards, charts, stream / view counts, box office, births, debuts…), hold a number the pool does not carry, or name someone or something mid-sentence that is not a pool title, artist, album or language. Dropping a line is always safe: the set plays without a segue.

### `POST /api/ai/dj` (same handler as `/api/dj`)

- **POST, not GET:** the listening context lives on the device and is sent per request. GET answers 405 (`allow: POST, OPTIONS`).
- **Auth:** none. **Rate limit:** 15 burst, 8 / minute. **Owner switch:** `dj`.
- **Request:** `{ "context": { "recentlyPlayed": [], "recentlyCompleted": [], "skippedSongs": [], "likedSongs": [], "topSongs": [], "preferredArtists": [], "avoidArtists": [], "currentLanguage": "telugu", … }, "pool": [ { "id", "title", "artist", "language"?, "album"?, "year"?, "known"?, "mood"?, "energy"?, "tempo"? } ] (3–60), "count"?: 1–20, "discover"?: boolean, "maxDiscover"?: 0–6, "wantSegues"?: boolean }` — body ≤ 48 KB.
- **Response 200:** `{ "intro": "Easing into something gentler for the late hours.", "songs": [ { "songId": "p1", "title": "…", "artist": "…", "reason": "same warm vocals, smoother tempo", "segue": "", "confidence": 0.8, "fromPool": true } ], "model": "…" }`
- **Errors:** 400 `bad_request` / `empty_context` / `pool_too_small`; 413 `too_large`; 429; 503 `ai_not_configured` / `ai_disabled` / `ai_over_budget` (the app keeps its on-device order); 500 when no engine produced a usable set.

## Safety and reliability summary

| Requirement | Where |
| --- | --- |
| Never fabricate songs | Search: filters only. Playlist: server resolution, no substitution (server and app). DJ: pool picks matched by id / canonical key; discoveries verified in the catalogue. Recommendations: catalogue lists only. |
| Never fabricate metadata | Track fields come from the catalogue answer, never from the model. DJ lines grounded (`_lib/grounding.ts`); playlist reasons are about fit only. |
| No private data exposed to others | History and profile never leave the device except the per-request taste snapshot (not stored). `/api/recommendations` with seeds is `private` cache; the similar route has no personal input. |
| Minimise personal data | No new tables or stored fields on the server. |
| Rate limits | Every route above; per client address (`_lib/ratelimit.ts`), per isolate plus the platform binding tier. |
| AI failures | Lane ladder with cooldowns (`_lib/ai.ts`); `accept` checks send unusable JSON to the next engine; each route has a non-AI answer. |
| Owner control | AI controls switches (`search` is new in 8.5), spend caps, emergency stop. |

## Environment

No new variables or secrets. The routes use the existing lane keys (`VINAX_*`, see [operations.md](operations.md)), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (AI controls and AI event logs), `TELEMETRY_PEPPER` (rate-limit keys) and the `RATE_LIMIT_*` bindings. No database migration.

## Tests

| Area | Tests |
| --- | --- |
| Signals, taste | `services/personalization/updater.test.ts`, `store/libraryStore.test.ts`, `features/taste-profile/useTasteInsights.test.ts` |
| Recommendations | `features/home/useSimilarArtists.test.ts`, `backend … api/recommendations.test.ts` |
| Search | `services/ai/musicIntent.test.ts`, `features/search/semanticSearch.test.ts`, `backend … api/ai/search.test.ts` |
| Playlist | `services/ai/playlist.test.ts`, `backend … api/ai/playlist.test.ts` |
| DJ | `services/recommendation/adaptive.test.ts`, `backend … _lib/grounding.test.ts`, existing `dj.test.ts`, `styleLock.test.ts` |
| Routing | `backend … __tests__/routerCoverage.test.ts` (every handler is routed) |

## After deploying

Probe the new routes on the live Worker before relying on them (a 404 or 405 on a POST route means the deployed Worker predates 8.5):

```sh
curl -s 'https://www.sirimillavinay.online/api/recommendations/similar/<a real song id>?limit=5'
curl -s -X POST https://www.sirimillavinay.online/api/ai/search -H 'content-type: application/json' -d '{"query":"upbeat telugu songs","withTracks":false}'
```

The AI Operations console lists the new `search` switch; its calls are logged under feature `search`.
