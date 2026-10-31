# The personal engine

This document covers the personal engine: the account-side recommendation system that builds Home, playlists and radio for a signed-in listener from a taste model kept on the server. It describes what the engine stores, how it learns from listening, how it finds and ranks candidate songs, how the AI composer turns a ranked pool into a Home page or a playlist, what the device sends and when, and how it falls back to the on-device engine in [recommendations.md](recommendations.md). What leaves the device is also listed in [data-and-privacy.md](data-and-privacy.md); the AI providers it borrows are described in [ai.md](ai.md); the tables are in [database.md](database.md).

Server paths are relative to `backend/worker/functions/`, device paths to `frontend/src/`.

## What it is for

The on-device engine answers "what plays next" without an account and without sending listening anywhere. The personal engine is the second tier, for listeners who sign in: it keeps one taste model per account, learns from every device the account uses, draws on what other listeners play, and uses a language model to compose a Home page and to build playlists from a request in plain words. The two tiers share one vocabulary (song identity, exposure, the reasons shown under a shelf) so a listener moving between them sees one app.

It is on by default for signed-in listeners and can be switched off in Settings → Region & privacy → **Personal engine**, which also offers **Erase my taste model**. Signed-out listeners, listeners who switched it off, and any moment the server cannot answer, get the on-device Home exactly as before.

## The model

Everything the engine knows about an account is one row of `personal_taste`, rebuilt from events and refreshed incrementally:

| Field | What it holds |
| --- | --- |
| `vector` | A 1024-dimension taste vector in the embedding model's space: the score-weighted sum of the embeddings of the songs in `songs`, recomputed in the database after each batch of events. |
| `artists` | `{artistId: {name, score, plays, completes, skips, last}}`, at most 300, least recent dropped. |
| `languages` | `{language: {score, plays, completes, skips, last}}`. |
| `facets` | `{moods, genres, decades}` as score maps, and `energy {sum, n}` when the catalogue or the device knew a song's energy. |
| `hours` | 24 counts per language plus `_all`: when this listener plays what. |
| `songs` | `{songId: {score, plays, completes, skips, likes, last}}`, at most 500. This is what the vector is computed from. |
| `summary` | A short digest the composer reads: top artists, top languages, moods, eras, listening habits, in a few lines of prose. Rebuilt with the model. |

Scores move with the same weights the device uses (`services/personalization/eventWeights.ts`): a play is 1, a complete 2, a like 3, a save to a playlist 1, a queue add 0.5, a skip −0.75 (and takes the play back), a dislike −1.5. Positive scores halve every 14 days, skips every 30. The fold is one pure function, `foldEvents(taste, events, now)` in `_lib/personal/taste.ts`, so it is tested without a database and gives the same answer in any order of arrival within a batch.

Songs are kept in `personal_songs`, one row per catalogue song any listener has touched, with the metadata the engine needs to answer without the catalogue (title, artists, album, language, year, duration, artwork), the song's identity key, the facets the device inferred, community counters (plays, completes, skips, likes) and its embedding. A song is embedded when it first arrives, in the same request where possible (`waitUntil`) and otherwise by the half-hourly backlog job. The text embedded is the song's title, artists, album, language, year and facets; the vector space is set by one embedding model named in the engine config, and rows carry the model id so a change of model is a re-embed, never a mix.

Exposure lives in `personal_exposure`: per account and song, how often it was shown, queued, played, completed and skipped, whether it was liked or disliked, and when. The penalties and cooling windows are the device's (`services/recommendation/exposure.ts`), so a song the device just showed is not shown again by the server and the other way round.

## Learning: events

The device reports listening to `POST /api/personal/events` in batches, only while signed in with the engine on. Each event is `{id, kind, at, song, heardSec?, durationSec?, source?, context?}`:

- `kind` is one of `play`, `complete`, `skip`, `like`, `unlike`, `dislike`, `save`, `queue`, `search_play`, `shown`, `radio_start`.
- `song` carries the facts the server keeps in `personal_songs` (`id, title, artists[], album, language, year, duration, image, facets`).
- `source` names the surface (`home:<shelf>`, `radio`, `search`, `playlist`, `nextup`, `ai-playlist`, `library`).
- `context` is `{hour, dow, tz}` and, for a Home shelf, `{shelf, position}`.
- `id` is a device-minted identifier; the server stores it and ignores a repeat, so a retried batch never double-counts.

The route verifies the session, caps a batch at 100 events and 64 KB, validates every field, upserts the songs, inserts the events, folds them into the taste row (optimistic version check; a lost race re-folds from the stored events), recomputes the vector in the database and writes exposure. The device keeps a queue in local storage, flushes every 15 s, at 25 events, and on `pagehide` with `keepalive`, and drops events older than 7 days that never got through.

Anonymous usage events (`/api/events`) are unchanged and still consent-gated separately; the personal engine never reads song ids from them for an account, only for the community co-listening table described next.

## Finding candidates

For a Home page, a playlist or a radio the engine gathers a pool of a few hundred candidates from six sources, each tagged with where it came from:

| Source | How |
| --- | --- |
| `neighbours` | Nearest songs to the taste vector among embedded songs (`personal_neighbours`), excluding anything in this account's exposure within its cooling window. This is where discovery across the whole community pool comes from. |
| `similar` | Catalogue "similar songs" lists for the account's strongest recent seeds (liked or completed in the last fortnight), and `personal_similar_songs` (nearest to a seed's embedding). |
| `artist` | The catalogue's top songs for the account's top-affinity artists that the account has not heard. |
| `colisten` | `personal_colisten`: songs that the same listeners play in the same stretch, built hourly from the last 30 days of personal and anonymous play events (top 50 partners per song, a listener counts once per pair). |
| `trending` | What the community played most in the last 7 days in the account's languages (`personal_trending`). |
| `own` | The account's own `songs` with a high score not played for 21 days (rediscovery) and its liked songs. |

Catalogue lookups go through `_lib/trends/catalog.ts`, the same in-process client the existing recommendation routes use; songs they return are upserted into `personal_songs` so they are embedded for next time.

## Ranking

Every candidate gets an additive score, each term kept as a reason so the shelf can say why:

| Term | Default weight | Measures |
| --- | --- | --- |
| taste fit | 0.30 | Cosine similarity of the song's embedding to the taste vector, mapped to 0–1. |
| artist | 0.22 | Affinity of the song's primary artist, 0–1 after a log squash. |
| language | 0.14 | Affinity of the song's language. |
| co-listen | 0.14 | Co-listening weight with the account's top songs. |
| source | 0.10 | A boost per source (`similar` highest for a seeded request, `neighbours` highest for discovery). |
| agreement | 0.08 | The song arrived from more than one source. |
| hour | 0.06 | How much this language or mood is played at this hour by this account. |
| freshness | 0.05 | Release year and how recently the song entered the pool. |
| community | 0.04 | Log of community plays, so a brand-new song with no plays is not punished. |
| exposure | −1 × penalty | The device's exposure penalty, from `personal_exposure`. |
| skips | −0.20 | Skip affinity for the artist or the song. |
| novelty | ±0.10 | Familiar, Balanced or Discover (the account's setting) leans toward heard artists or unheard ones. |

The weights live in the `personal-config` setting with these defaults in `_lib/personal/config.ts`, clamped to 0.5–2× like the device's `rec-config`. After scoring, a greedy re-rank keeps the list varied (an artist repeats at most three times per shelf, never twice in a row; identity families fold to one recording) and the exposure cooling window moves a song to the back rather than dropping it.

## Composing Home

`GET /api/personal/home` answers a page in two steps.

1. **Deterministic shelves.** `_lib/personal/shelves.ts` builds up to twelve candidate shelves from the ranked pool, each with a key, a working title, the reason it exists and 20 song ids: `made-for-you`, `because:<songId>` (two, from the strongest recent seeds), `artist:<artistId>` (the top artist with unheard songs), `language:<lang>` (the top two languages), `discover`, `rediscover`, `hour` (songs matching this hour's habit), `community` (co-listening picks), `trending`, and `new-this-week` (a weekly-salted subset of discovery that has never been shown). A shelf with fewer than six songs is dropped.
2. **The composer.** The page, the taste summary, the time of day, the day of the week, the active festival if any, and the listener's first name are given to a language model through `_lib/ai/complete.ts`, which runs the existing provider ladder without streaming and returns parsed JSON. The composer may **order** the shelves, **rename** each in the listener's voice with a one-line reason, **merge** two shelves into one themed shelf, and **add** one themed shelf drawn from the pool for the moment ("Rainy evening melodies"), but it may only use song ids that were in the pool: any other id is dropped and a shelf that loses too many songs falls back to its deterministic form. It answers in at most 8 seconds; when it does not, or the JSON cannot be repaired, the deterministic page is served and the failure is logged.

The page is saved in `personal_pages` (`kind = 'home'`), every song on it is marked shown in `personal_exposure` (`personal_mark_shown`), and it is served from the saved copy for 30 minutes, or sooner when the taste row's version moved by more than two folds, or when the device asks for `?fresh=1` (the "Refresh Home" action, limited by the per-account rate tier). The answer is `{generatedAt, expiresAt, greeting, shelves: [{key, title, reason, songs: [Song…]}], model}`, with full song records so the device renders without a catalogue round trip; playback resolves the audio from the catalogue when the song starts, as any shelf does today.

## Building a playlist

`POST /api/personal/playlist {prompt, count?}` builds a playlist from a request in plain words ("wedding dance songs in Telugu and Hindi", "slow songs like the ones I liked last week", "something new, nothing I've heard"). It runs in two model calls around one retrieval:

1. **Plan.** The model turns the prompt and the taste summary into a retrieval plan: `{title, languages[], moods[], artists[], eras[], energy, familiarity: 'known'|'mixed'|'new', queries[]}` where `queries` are up to six catalogue search phrases.
2. **Retrieve.** Catalogue searches for each phrase, top songs for named artists, taste neighbours and co-listening filtered by the plan's languages and eras, the account's own songs when familiarity allows. The pool is ranked as above with the plan's constraints as hard rules (language, era, explicit in Kid mode) and soft lifts (mood, energy).
3. **Curate.** The model picks `count` songs (default 25, at most 50) from the ranked pool in a good order, keeps the title or improves it, writes a one-line description and an optional reason per song. Ids outside the pool are dropped; a short result is topped up from the ranked pool.

The result is saved in `personal_pages` (`kind = 'playlist'`) and returned as `{id, title, description, songs: [Song & {reason?}], plan, model}`. The device shows it with Play, Save as playlist (which creates a local playlist and records `save` events), and Try again. The whole call is budgeted at 25 seconds and limited to six a minute per account.

## Radio and next songs

`GET /api/personal/recommend?seed=<id>&limit=<n>&exclude=<ids>` answers the ranked pool for one seed (or for the taste alone with no seed), as compact song records. The device's Up Next engine uses it as its first source when signed in with the engine on, and keeps its own sources and rules, so a slow or failed call changes nothing a listener can see.

## The device side

| Piece | Path | What it does |
| --- | --- | --- |
| Client | `services/personal/api.ts` | The calls above, with the session header, a 12 s deadline (25 s for a playlist) and typed answers validated before use. |
| Reporter | `services/personal/reporter.ts` | Subscribes to the playback event bus, the library store and the shelf renderer, builds events, queues and flushes them. Off unless signed in and the setting is on. |
| Home | `features/home/personal/*` | `usePersonalHome()` fetches the page; `PersonalShelves` renders it with the existing `Shelf`, `MediaCard` and `SongShelf` so exposure, dedupe and the "why" line work as on any shelf; `PlaylistMaker` is the prompt box and result sheet. `HomePage` shows the personal page as its first block when it is on and loaded, and the on-device blocks after it (and alone otherwise). |
| Setting | `store/settingsStore.ts` `personalEngine` | On by default. Settings → Region & privacy has the toggle, the "what is sent" line and **Erase my taste model** (`DELETE /api/personal/taste`). Kid mode pauses the engine (the kid profile stays on the device). |
| Up Next | `services/nextup/sources.ts` `personal` | One lookup per refill, first in the list, around the newest anchor song; the first six answers are resolved to full songs so the player can preload them. |

Switching the engine off stops the reporter at once and clears the queue; the taste model stays until erased or the account is deleted (`accounts` cascades to every `personal_*` table).

## Jobs

The half-hourly `housekeeping` run gained three steps, logged in `job_runs` like the others: `personal_embed` (embed up to 200 songs that have none), `personal_colisten` (rebuild the co-listening table from the last 30 days, once an hour), and `personal_purge` (events older than a year, pages past their expiry).

## Owner console

`GET /api/admin/personal` reports the engine's health: accounts with a taste model, events in the last day and week, songs known and the embedding backlog per model, pages and playlists built today and how many the model shaped, the active embedding model and whether this Worker can use it, the composer's candidates and the weights after clamping. `POST /api/admin/personal { action }` runs the embed backlog (`embed`) or the co-listening rebuild (`colisten`) now. The console's **Health → Personal engine** tab shows it, with a button for each job.

## Tests

- `backend/worker/__tests__/personalTaste.test.ts`: the fold (weights, decay, caps, order independence, the hours histogram), the summary.
- `personalRank.test.ts`: the exposure penalty and cooling windows, the score terms and their reasons, Familiar / Discover, the re-rank's artist, identity and cooling rules.
- `personalCompose.test.ts`: JSON extraction, the composition's validation and application (order, merge, one themed shelf, unknown ids dropped), the deterministic shelves, the playlist plan and curation validators and hard rules.
- `personalRoutes.test.ts`: every route against the fake database — the gates, batch caps and cleaning, idempotent events, the model's versions, the page and its cache, recommend, the playlist builder with a stubbed catalogue, erase.
- `aiComplete.test.ts`: the non-streaming completion over the ladder with failover, the JSON variant's repair turn, and the composer end to end with a stubbed provider.
- Device: `services/personal/reporter.test.ts` (the gate, queueing, flush, retry, pruning, the switch), `services/personal/api.test.ts` (answers checked, errors, records to songs and back) and `features/home/personal/PersonalHome.test.tsx` (nothing signed out, the shelves and greeting, the fallback).
- `backend/supabase/check.sql` seeds the new tables and calls every new function; `routerCoverage` and `schemaUsage` cover the routes and the columns as for every other table.

## What it does not do yet

It does not read the account's device-side taste profile (the one in the sync backup); the server model starts from the first reported event. It does not yet drive Flow, Blend or Listen Together. It does not learn from skips inside a playlist it built differently from any other skip. These are the next phases.
