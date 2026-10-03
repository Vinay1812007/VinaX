# Verified trends

This document covers the 7.2 trend pipeline: what each outside source's documentation says (checked on 2026-09-19, with links), which sources are wired and which are honestly disabled, how the scheduled job stores and matches what the sources report, how momentum is computed and when it is not, the public read and owner console contracts, how the app labels all of this, and what to do when something goes wrong.

Before 7.2, everything the app called "trending" was catalogue search phrases ("trending telugu songs") plus on-device ordering. That is not evidence of anything popular anywhere else. From 7.2:

- A **public chart** item reaches a listener only as a catalogue song matched with confidence to a chart entry, labelled with the source, its rank, the region, when it was observed and an evidence link.
- An **editorial** entry is labelled editorial, carries an evidence link, and expires.
- The catalogue lists are labelled as catalogue lists ("Popular in the catalogue"), never as a chart.
- A source that is switched off, not configured, failing or out of date says so.

Nothing here downloads, extracts or stores audio. Trends are metadata only.

## At a glance

```text
 .github/workflows/trends-ingest.yml   every 6 h, x-cron-secret
            │
            ▼
 POST /api/cron/trends-ingest ──► for each provider × region
            │                       status(env)?  ok → fetch (3 attempts, backoff + jitter, 8 s each)
            │                       quota ceiling? skip when a full run would pass it
            │                       snapshot (unique key) ─► observations (source id + link, rank, evidence)
            │                       new items only ─► matcher ─► vinax_trend_matches (matched | review)
            │                       run record (attempts, items, quota units, error)
            │                       prune past retention
            ▼
 GET /api/trends ──► latest snapshot per source ∩ confident matches ∩ unexpired  ──► app (Charts page)
 /api/admin/trends ◄─► owner console "Trend Operations": status, quota, review queue, imports
```

## What the providers' documentation says

Everything in this section was read on 2026-09-19 from the linked pages. None of it was verified against a live API: this project has no key for any of them.

### The video platform's Data API — adapter `youtube`

**Endpoint** — `videos.list` ([reference](https://developers.google.com/youtube/v3/docs/videos/list)):

- `chart=mostPopular` — "Return the most popular videos for the specified content region and video category."
- `regionCode` — "instructs the API to select a video chart available in the specified region. This parameter can only be used in conjunction with the `chart` parameter. The parameter value is an ISO 3166-1 alpha-2 country code."
- `videoCategoryId` — "identifies the video category for which the chart should be retrieved. This parameter can only be used in conjunction with the `chart` parameter. By default, charts are not restricted to a particular category. The default value is `0`."
- `maxResults` — "Acceptable values are `1` to `50`, inclusive. The default value is `5`." Further pages come from `pageToken`, with `nextPageToken` / `prevPageToken` in the response.
- The response is `{ kind, etag, nextPageToken, prevPageToken, pageInfo, items }`; each item is a `video` resource. The adapter asks for `part=snippet,statistics` and reads `id`, `snippet.title`, `snippet.channelTitle`, `snippet.publishedAt`, `snippet.categoryId`, `snippet.defaultLanguage`, `snippet.defaultAudioLanguage` and `statistics.viewCount/likeCount/commentCount` ([resource](https://developers.google.com/youtube/v3/docs/videos)). Counts arrive as decimal strings.
- A chart that does not exist answers `400 videoChartNotFound`.

**The Music category.** The documentation does not list category ids; they come from `videoCategories.list` for a region ([reference](https://developers.google.com/youtube/v3/docs/videoCategories/list)). The adapter uses `10`, the id commonly returned for Music, and the owner can change it with `TRENDS_VIDEO_CATEGORY_ID`. **Not verified**: confirm it with one `videoCategories.list?regionCode=IN` call (1 unit) before relying on it.

**Quota** ([getting started](https://developers.google.com/youtube/v3/getting-started#quota)):

- "A call to this method has a quota cost of 1 unit." (`videos.list`)
- "All API requests, including invalid requests, incur at least a one-point quota cost."
- "Projects that enable the [Data API] have a default quota allocation of … 10,000 units per day combined for all other endpoints." The default is "subject to change"; the owner's real allocation is in the project's console.
- The reset time of the daily quota was not stated on the pages read. The app's own ceiling (below) is far under the default, so the exact boundary does not matter.

**Developer policies** ([developer policies](https://developers.google.com/youtube/terms/developer-policies)), last updated 2026-09-14:

- *Storage (III.E.4).* Data read without user credentials is "Non-Authorized Data": clients "may temporarily store limited amounts of Non-Authorized Data for as long as is necessary for the purposes of the API Client but not longer than 30 calendar days … after 30 calendar days, the API Client must either delete or refresh the stored data", and "an API Client must not store statistics retrieved as Non-Authorized Data for more than 30 days". Clients "must display the most updated API Data available … although API Clients may display historical API Data provided that it is presented accurately in context of time." → retention of 28 days; every item carries its observation time; the read always uses the newest snapshot.
- *Derived metrics (III.E.4).* "Your API Clients must not (i) replace API Data with similar, independently calculated data, or (ii) access or use API Data to create new or derived data or metrics." Additional metrics are possible only for audited developers with analytics use cases who accept an amendment ([derived-metrics policy](https://developers.google.com/youtube/terms/derived-metrics-policy): "you are generally prohibited from creating metrics that replace or modify the data returned by the [platform's] API Services"). → rank change and "new entry" are **off** for this source by default; see [Momentum](#momentum).
- *Aggregation (III.E.2).* "Do not aggregate API Data except …" for channels of one content owner, and "Do not aggregate API Data or otherwise use API Data … to gain insights into [the platform's] usage, revenue, or any other aspects of [its] business." → this source's data is never combined with another source's, and statistics are stored as returned and never published.
- *Branding (III.F.2).* "Any API Client page or feature that displays [the platform's] content – including, without limitation, search results, [its] videos, channels, playlists, thumbnails, and [its] players – must make clear to the viewer that [the platform] is the source of the relevant content by displaying [its] Brand Features in accordance with … [its] Branding Guidelines" ([branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines)). Content that does not come from the platform "must not be shown in a way that suggests that the content is originating from" it. See [Attribution: an owner decision](#attribution-an-owner-decision).
- *Audiovisual content (III.E.1, III.I).* Clients must not "download, import, backup, cache, or store copies of … audiovisual content", must not "separate, isolate, or modify the audio or video components", and must not "promote separately the audio or video components". → the pipeline stores ids, titles, ranks and links only, and plays the listener's CATALOGUE copy of a matched song, never anything from the platform.
- The [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) page exists and was not reviewed in detail.
- The `statistics.viewCount` definition changed on 24 August 2026 ("viewCount will be updated to count views the moment a video begins to play"), so counts across that date are not comparable. The app does not compare or publish counts.

#### Attribution: an owner decision

Showing a public chart's ranking and an evidence link to the platform's page is, on a plain reading of III.F.2, a feature that displays the platform's content. The policy then asks for the platform's brand features next to it. VinaX's standing rule is the opposite: no third-party brand names in the product. The default label is therefore the neutral "Public video chart", which **very likely does not meet the attribution requirement**. The owner has three options:

1. Set `TRENDS_VIDEO_CHART_LABEL` to a label that names the platform and add its brand features as its branding guidelines require — an exception to the brand rule, for this one attribution.
2. Leave `YOUTUBE_API_KEY` unset. The source reports `not_configured` and the app shows only editorial entries and catalogue lists.
3. Take advice on whether a text label is enough. This document is not legal advice.

### The short-video / photo platform — adapter `instagram` (disabled)

What its documentation offers ([audio API](https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api/)):

- The only documented listing that returns trending audio is `GET /ig_audio?audio_type={original_sound|music}&user_id=…`: "When retrieving audio, if no search query is provided, trending audio is returned."
- It lives under Content Publishing, to "attach [audio] to [short videos] at creation time". It needs a business or creator account, a connected page, the platform's business login, the basic and content-publishing permissions, and a user access token. It "returns audio that has been authorized for third party use", and "the available selection may vary from what appears in the native app".
- The response carries `audio_id`, `title`, `display_artist`, `duration_in_ms`, `audio_type`, cover art and a temporary download link. It carries **no rank, no count and no region**.
- The platform's terms ([platform terms](https://developers.facebook.com/terms/dfc_platform_terms/), updated 3 February 2026): "You may only Process Platform Data as clearly described in your privacy policy and in accordance with all applicable law and regulations, these Terms, and all other applicable terms and policies."

Decision: the adapter is **disabled** and never fetches. A permission granted for publishing short videos is not a verified licence to run a popularity chart in a separate music app, the listing has no rank or region to show, and no licensed partner feed of trending audio was found. The owner features songs that are popular there through an [editorial import](#editorial-imports) with an evidence link a person can check. The listing's download link is never called by anything in this repository.

### The research API of another short-video platform — no adapter

The FAQ at <https://developers.tiktok.com/docs/en/research-api-faq> could not be read directly: the host refused TLS connections from the environment used for this work (both fetch tools). Search results from that official domain quote the eligibility rules: access is for "independent and academic researchers who conduct research on a non-for-profit basis", applicants "must be independent of commercial interests", and "Commercial users are not eligible for access to the Research Tools." It is not a commercial trend feed, eligibility cannot be verified for this app, and no adapter exists. The same platform's ads library is advertising data and is never used as a signal of music popularity.

## The pieces

| File | Role |
| --- | --- |
| `backend/worker/functions/_lib/trends/types.ts` | `TrendProvider`, `RawTrendItem`, env names |
| `…/trends/videoChart.ts` | The video platform's chart adapter (`youtube`) |
| `…/trends/shortVideo.ts` | The disabled short-video adapter (`instagram`) and its reason |
| `…/trends/editorial.ts` | Editorial entries as a provider (`editorial`) |
| `…/trends/registry.ts` | Provider order and every threshold (`TRENDS_POLICY`) |
| `…/trends/retry.ts` | Bounded retries with backoff and jitter |
| `…/trends/ingest.ts` | The scheduled pipeline |
| `…/trends/matcher.ts`, `catalog.ts` | Matching raw items to catalogue recordings |
| `…/trends/read.ts` | The public read and momentum |
| `…/trends/importer.ts`, `review.ts` | Editorial import validation; review decisions |
| `backend/worker/functions/api/trends.ts` | `GET /api/trends` |
| `backend/worker/functions/api/cron/trends-ingest.ts` | `POST /api/cron/trends-ingest` |
| `backend/worker/functions/api/admin/trends.ts` | `GET/POST /api/admin/trends` |
| `frontend/supabase/migrations/2026-09-vinax-7.2-trends.sql` | The five tables (also appended to `schema.sql`) |
| `.github/workflows/trends-ingest.yml` | The schedule |
| `frontend/public/admin/sections/trends.js` | Owner console panel "Trend Operations" (Catalog group) |
| `frontend/src/services/trends/client.ts` | `fetchVerifiedTrends()` for the app |
| `frontend/src/pages/ChartsPage.tsx` | Where listeners see verified charts |

### The provider interface

```ts
interface TrendProvider {
  id: string;                               // 'youtube' | 'instagram' | 'editorial'
  kind: 'public-chart' | 'editorial';
  chart: string;                            // snapshots are compared only within one chart
  snapshotPolicy: 'hourly' | 'content';
  displayHours: number | null;              // chart items: 72; editorial: the entry's own expiry
  status(env): 'ok' | 'not_configured' | 'disabled';
  statusReason(env): string | null;
  maxUnitsPerRun(env): number;              // every attempt of every page
  dailyUnitBudget(env): number | null;
  derivedMetricsAllowed(env): boolean;
  fetch(env, { region, signal, meter }): Promise<RawTrendItem[]>;
}
```

A `RawTrendItem` keeps the source's own item id (a video id, `ed-<n>` for editorial) and its evidence URL. It never carries a catalogue id — a popular video does not prove a known song. The catalogue id lives only on the match.

## Storage

Five tables, all RLS-locked like every other `vinax_` table, written only with the service key:

| Table | One row per | Key facts |
| --- | --- | --- |
| `vinax_trend_runs` | provider × region × run | started, finished, ok, status, error, attempts, items fetched/inserted, matched, queued for review, quota units, snapshot key |
| `vinax_trend_snapshots` | stored snapshot | unique `(source, region, chart, snapshot_key)` |
| `vinax_trend_observations` | item in a snapshot | source id, URL, region, title, credit, language evidence, observed/fetched/expires, rank, statistics (as returned), provenance; unique per snapshot by item and by rank; cascades with its snapshot |
| `vinax_trend_matches` | source item | catalogue id/title/artist/language, `mapping_confidence`, `method`, `status` (`matched`, `review`, `accepted`, `rejected`, `corrected`), reason, candidates, reviewer, review time, `history`, first/last seen |
| `vinax_trend_editorial` | editorial entry | title, artist, catalogue id, region, language, position, evidence URL (https only), note, start, expiry (after the start), status, importer, import time |

Indexes serve the read paths: newest snapshot per region/source/chart, unexpired observations of a snapshot, the review queue by status, recent decisions, active editorial entries per region, and the two retention sweeps.

**Idempotency.** An `hourly` source's snapshot key is `h:<UTC hour of the run>`; the job checks for it before fetching, so a re-run inside the hour spends no quota and inserts nothing. A `content` source (editorial) keys the snapshot by a hash of its items, so an unchanged list inserts nothing and any change — an import, a withdrawal, an expiry — stores a new snapshot. Observations are unique per snapshot, matches per source item: a known item is never matched twice; its `last_seen_at` is refreshed instead.

**Retention.** Snapshots (and their observations) are deleted 28 days after they were fetched; a match not seen again for 28 days is deleted with its history. That keeps the video platform's data inside its 30-day limit with two days of margin for a missed run. Run records and editorial entries that expired more than 90 days ago are deleted too. Deletion runs at the end of every scheduled job: if the job stops, nothing is deleted — the console shows the age of the oldest stored snapshot and warns from 26 days.

## Scheduled ingestion

`POST /api/cron/trends-ingest` with the `x-cron-secret` header (header only; compared in constant time; a `?key=` is ignored). Optional `?source=<id>&region=<CC>` narrow a run. Answers `200` when every attempted run succeeded, `502` when one failed (the workflow retries and opens an issue), `503` without a database. Disabled and unconfigured providers are listed as `notRun` and are not failures.

Per provider × region:

1. **Status.** `status(env)` must be `ok`.
2. **Quota.** For a metered provider, the units already spent today (UTC day, summed from run records) plus `maxUnitsPerRun` must stay within the daily ceiling (`TRENDS_VIDEO_DAILY_UNIT_BUDGET`, default 200). Otherwise the run is recorded as `skipped` (`quota_budget`). If the run log cannot be read the run is skipped (`quota_unknown`) rather than risk the quota.
3. **Fetch** with up to 3 attempts. Each attempt has an 8-second deadline; the delay before retry *n* is `min(4000, 500 × 2^(n−1)) ms + uniform jitter 0–250 ms`. Only timeouts, network errors, `5xx` and `429` are retried; a refused key, an exhausted quota or an unknown chart fails at once. Every request sent is metered (1 unit each for the video chart).
4. **Guard.** A public chart that answers with no entries is an error; the previous snapshot stays.
5. **Store** the snapshot and its observations. If the observations cannot be written, the snapshot is removed again, so an empty snapshot never reads as "the chart is empty".
6. **Match** new items (below) from a per-run budget of 20 catalogue calls shared by every item. Items left over, or items whose catalogue call failed, get no match row and are tried on the next run.
7. **Record** the run.

Cadence: every six hours (`17 */6 * * *`). One page of 50 per region costs 1 unit a request — 4 units a day per region normally, 36 at worst with every retry failing — against a 10,000-unit default and the app's 200-unit ceiling. The chart does not move fast enough for more runs to add information, the stale threshold (18 hours) tolerates two missed runs, and the matching budget keeps each run's catalogue calls bounded.

## Matching

`matcher.ts` decides whether a raw item is confidently ONE catalogue recording.

1. **Parse the title.** Split on `|`, spaced dashes, `: ` and `//`. Drop presentation words ("Full Video Song", "Lyrical", "Lyric Video", "Official Video", "4K", …). Read `(From "X")` or a trailing "from X" as the film. Collect version words (remix, reprise, mix, unplugged, slowed, reverb, lofi, live, acoustic, cover, karaoke, instrumental, male/female, duet, 8D, mashup, …) into a version tag with the same rules as `identityCore.versionTag`. Read a language named in the title ("(Telugu)"). Prefer a segment that calls itself "… Song" as the title. Flag **non-songs** (jukebox, trailer, teaser, glimpse, promo, making-of, interview, reaction, full movie, …) and **short-form reuse** ("#shorts", "original audio", "status video" and similar markers).
2. **Search** the catalogue through the Worker's own catalogue handler (in process, no HTTP): the title with the film or second segment, then the title alone, a romanised form of a native-script title, or the second candidate — at most two calls per item.
3. **Score each candidate.** Title evidence:
   - `exact` — same script, equal after identity normalisation (version decorations and featured credits removed);
   - `phonetic` — same script, equal after folding common romanisation variants ("Naatu" = "Natu", "Zindagi" = "Jindagi", doubled letters);
   - `transliterated` — different scripts, equal on a lossy consonant key after letter-by-letter romanisation of the nine Brahmic scripts;
   - `partial` — bigram similarity of at least 0.75 (0.8 across scripts);
   - `none`.

   Corroboration: a credited name agrees (singer, featured artist, composer, lyricist or cast from the catalogue; any non-title segment, the uploader or the editorial artist from the source), and the film agrees with the candidate's album (a single whose album is named after the song does not count).

   | Title evidence | Artist and film | One of them | Neither |
   | --- | ---: | ---: | ---: |
   | exact | 0.98 | 0.92 | 0.70 |
   | phonetic | 0.90 | 0.85 | 0.60 |
   | transliterated | 0.85 | 0.80 | 0.50 |
   | partial | 0.75 | 0.60 | 0.30 |

   Caps: a version-tag mismatch (a remix trend against the original, or the reverse) caps at 0.45; a language named in the title that differs from the candidate's caps at 0.45 (dubbed versions of a film song are different recordings); short-form reuse caps at 0.5.
4. **Decide.** `matched` when the best candidate scores at least **0.8** (`AUTO_MATCH_THRESHOLD`) and no candidate that could be a different song scores within **0.05** of it. Two candidates are different songs when their work families differ, or when they share a family (same title and lead artist) but their durations differ by more than 5 seconds; a compilation copy of the same recording is not a rival. Everything else is `review`, with a reason: `ambiguous`, `version_mismatch`, `language_mismatch`, `transliteration`, `uncorroborated`, `weak_title`, `short_form_reuse`, `not_a_song`, `no_candidate`. The method is recorded, for example `title:exact+artist+film` or `title:transliterated+artist`.
5. **Editorial entries that name a catalogue id** are confirmed with one catalogue lookup: found and consistent with the title and version → `matched` at 1.0 (`editorial-catalog-id`); unknown id → `review` (`catalog_id_not_found`); a different song → `review` (`catalog_id_title_mismatch` or `version_mismatch`).

Review items never reach the public read, so they never reach a shelf, a queue or autoplay. The owner accepts (confidence 1.0, `admin-accepted`), rejects, or corrects to another catalogue id (verified by lookup; `admin-corrected`). Each decision appends `{ at, by, action, from, to, note }` to the match's history (at most 50 entries).

## Momentum

Momentum exists only where two **comparable** timestamped snapshots exist — same source, region and chart — and only for providers whose terms permit a derived metric.

For each item of the newest snapshot *S₁* (observed at *t₁*), let *S₀* be the newest snapshot of the same source, region and chart observed between 6 and 48 hours before *t₁*:

```text
rankDelta   = rank in S₀ − rank in S₁          (positive = moved up)
windowHours = round((t₁ − t₀) / 1 h)
newEntry    = S₀ exists and the item is not in it
```

With no such *S₀* every item gets `momentum: null` and `newEntry: false`: one snapshot never implies growth. Items are compared by the source's own item id, so a new upload of the same song is a new entry, not a rise. Counts (views, likes) are never used, and nothing from different sources is ever combined.

**Off by default.** The video platform's developer policies forbid derived metrics unless its derived-metrics amendment has been accepted for an analytics use case. `derivedMetricsAllowed` is therefore false for every provider unless the owner lists it in `TRENDS_DERIVED_METRICS_SOURCES` — which should only happen once that provider has permitted it for this use. Editorial entries never have momentum: an editor's order is not an observation of popularity. In practice, until that permission exists, the Charts page shows no "rising" or "new entry" markers at all, and that is correct.

## Public read — `GET /api/trends`

Query: `region` (ISO alpha-2; default the first of `TRENDS_REGIONS`, else `IN`; a region that is not ingested is answered with the first ingested region, which every source and item names), `language` (catalogue language id), `source` (provider id), `limit` (1–50, default 20). Unknown values fall back to defaults. Public, CORS `*`, cached in the edge cache for 300 s and in the browser for 60 s; an answer produced while a database read failed is cached for 30 s.

```json
{
  "generatedAt": "2026-09-19T12:00:00.000Z",
  "sources": [
    { "id": "youtube", "label": "Public video chart", "kind": "public-chart", "status": "ok", "lastSuccessAt": "2026-09-19T11:17:04.000Z", "region": "IN" },
    { "id": "instagram", "label": "Short-video audio", "kind": "public-chart", "status": "disabled", "lastSuccessAt": null, "region": "IN" },
    { "id": "editorial", "label": "Editor’s picks", "kind": "editorial", "status": "ok", "lastSuccessAt": "2026-09-19T11:17:05.000Z", "region": "IN" }
  ],
  "items": [
    {
      "catalogId": "abc123", "title": "Chuttamalle (From \"Devara Part 1\")", "artist": "Shilpa Rao", "language": "telugu",
      "region": "IN", "source": "youtube", "sourceLabel": "Public video chart", "sourceKind": "public-chart",
      "sourceRank": 3, "sourceUrl": "https://www.youtube.com/watch?v=…", "observedAt": "2026-09-19T11:17:00.000Z",
      "expiresAt": "2026-09-22T11:17:00.000Z", "mappingConfidence": 0.98, "momentum": null, "newEntry": false
    }
  ]
}
```

- `sources` always lists every provider. `status`: `ok` (a successful run within 18 hours), `stale` (the last success is older — its unexpired items are still returned, labelled by this status), `unavailable` (configured but never succeeded, or the database read failed), `disabled`, `not_configured`.
- `items` are only matches with status `matched`, `accepted` or `corrected`, confidence ≥ 0.8, from the newest snapshot of each source, not expired (chart items expire 72 hours after observation; editorial items with their entry). One source's two entries of one song (a lyric video and a video song) appear once, at the better rank. Public charts come first, then editorial, each in rank order.
- `newEntry` is an addition to the originally specified item shape; `momentum` is exactly `null | { rankDelta, windowHours }`.

## Owner console — `GET/POST /api/admin/trends`

Behind `isAdmin` like every admin route (401 before any database work). Panel: **Catalog → Trend Operations** (`frontend/public/admin/sections/trends.js`).

`GET` returns `providers` (id, label, kind, status, reason, derived metrics, quota ceiling), `freshness` per source and region (last run, last success, `stale`, last error with attempts, latest snapshot), `quota` used today, `retention` (oldest stored snapshot, limit), `matches` (count by status and a confidence histogram with a bucket edge at 0.8), `reviewQueue` (with candidates and the source's own title, link, rank and region), `recentDecisions`, `editorial` (each with a state: active, upcoming, expiring within 72 h, expired, withdrawn) and `runs`. A missing table answers `503 { error: "db_schema_missing" }`, never zeros.

`POST { action }`:

| Action | Body | Effect |
| --- | --- | --- |
| `review` | `id`, `decision` (`accept`/`reject`/`correct`), `catalogId` for correct, `note`, `reviewer` | Updates the match and appends to its history; audit row |
| `validate-import` | `format` (`csv`/`json`), `data` | Every problem by row and field; writes nothing |
| `import` | same | All-or-nothing; re-importing an entry adds nothing; runs the editorial source at once so the entry is live; audit row |
| `withdraw` | `editorialId` | Stops the entry and runs the editorial source; audit row |
| `run` | optional `source`, `region` | Runs ingestion now; the quota ceiling still applies; audit row |

### Editorial imports

CSV header (any order): `title,artist,catalog_id,region,language,position,evidence_url,starts_at,expires_at,note`; JSON is an array of objects with the same fields. Rules: a title; an artist or a catalogue id; an `https://` evidence link with a real host and no embedded credentials; `expires_at` required, after the start, in the future and at most 90 days after the start; dates as `YYYY-MM-DD` (00:00 UTC) or ISO date-times; region a two-letter code (default `IN`); position 1–100; at most 200 rows. One invalid row and nothing is imported.

## Live web discovery — `GET /api/discover` (9.1)

The charts above are *ingested* on a schedule. Live web discovery is the other
half: a bounded path that asks the owner's metasearch instance what is current
right now, and turns the answer into playable catalogue songs. Before 9.1 the
instance was used only by the chat (`/api/vinaxai`) and the admin health probe —
**no music path used it at all**.

`backend/worker/functions/_lib/discovery.ts`, one run:

1. **Search.** `discoveryQueries` builds up to `MAX_SEARCHES` (3) queries from
   today's date, the region, the language and the intent (`charting`,
   `new-releases`, `trending-songs`), in the words these pages use.
2. **Read.** The merged results go to an AI lane **inside `fenceWebContext`** —
   untrusted data, never instructions — which lists the songs the pages name,
   each citing the `[n]` of the result it came from.
3. **Validate.** `readExtractions` drops a row with no title or artist, an
   out-of-range rank, or a citation to a result we never supplied. That last
   check is what stops a model smuggling in an invented song behind a
   plausible-looking citation.
4. **Resolve.** Every surviving extraction goes through `playlistResolve`, which
   only accepts a catalogue result that IS the suggestion. An unresolved
   extraction is **dropped** — a title nobody can play is not a recommendation.
5. **Attach evidence.** Each item carries the source URL, the kind of source, the
   time we observed it, the publication date **only when the search engine
   reported one**, and a chart period **only when the page's own text stated
   one**.

### What it will never claim

- A `rank` survives only from a **chart-shaped** source that stated a position.
  An editorial list's ordering is not a chart position, and the model's offer of
  one is discarded (`classifySource`, then `sourceType === 'chart'`).
- `classifySource` is deliberately conservative: anything it cannot place is a
  plain `search-result`, the weakest kind, so a misread can only ever
  *understate* the evidence.
- Chart movement, streaming counts, release dates and artist facts are never
  derived or invented. If the evidence does not state it, the field is null.
- The client (`frontend/src/services/discovery/client.ts`) re-validates every
  field and drops a rank on any non-chart source whatever the server sent, so no
  surface can print a position no chart stated.

### Budgets

| Limit | Value |
| --- | --- |
| Searches per run | 3 |
| Catalogue resolutions per run | 14 |
| Whole-run wall clock | 14 s |
| Runs per isolate per hour | 12 |
| Breaker | 3 consecutive failures → 15 minutes' rest |
| Cache window | one UTC day, per (region, language, intent) |
| Evidence freshness | 6 h, after which an answer is labelled `stale` |

**Playback never waits on a web search.** `GET /api/discover` answers from the
cache by default and starts a refresh behind the caller (`waitUntil`), returning
`state: "cold"` with no items. Only a caller the listener is already waiting for
passes `wait=1`. In the app, `services/discovery/signal.ts` answers synchronously
from a snapshot in memory and refreshes in the background, exactly like the trend
signal.

### States, and what the app says for each

| `state` | Meaning | Shown as |
| --- | --- | --- |
| `ok` | fresh evidence, resolved items | nothing extra |
| `stale` | items, evidence older than 6 h | "This evidence is a few hours old." |
| `cold` | nothing cached yet; a refresh has started | "Looking for what is current…" |
| `not_configured` | no search instance on this deployment | "Live web discovery is not set up on this server." |
| `resting` | breaker open, or the hourly quota spent | "Live discovery is resting — showing catalogue picks." |
| `no_reader` | no AI lane configured, so results cannot be read | "No AI engine is configured, so web results cannot be read." |
| `empty` | searched, but nothing resolved to a real recording | "Nothing current could be matched to the catalogue right now." |
| `failed` | the search or the read failed | "Live discovery is unavailable — showing catalogue picks." |

### Environment

`SEARXNG_URL` (and `SEARXNG_TOKEN` if the instance requires one) plus at least
one AI lane key. With no instance the endpoint answers `not_configured` and every
music surface falls back to catalogue lists **labelled as catalogue lists**.

**Not verified live.** As of 9.1 nothing in this path has been run against a real
instance or a real AI lane; it is tested against mocked ones
(`_lib/discovery.test.ts`, `api/discover.test.ts`). Setting the two secrets and
calling `/api/discover?wait=1&region=IN&language=telugu` is the check that
remains.

## In the app

- `frontend/src/services/trends/client.ts` exports `fetchVerifiedTrends({ region, language, limit, signal }): Promise<TrendsSnapshot | null>`. It never throws; `null` means unavailable (offline, timeout, HTTP error, malformed answer). It validates every field it passes on and drops items that fail. It is loaded lazily and is not in the first-load bundle.
- The **Charts** page shows verified public charts with the source label, region, update time and status, per-source filters, "Rising" and "New entry" markers only when the read carries them, and editorial entries marked "Editorial pick". Below, the catalogue lists are headed "Popular in the catalogue" and explained as catalogue search results, not a live chart. With no source configured or the read unavailable, the page says so and the catalogue lists remain.
- On Home, the shelf formerly titled "Trending for you" is "Popular picks for you": popular catalogue songs in the order the listener's taste (or VinaX AI) suggests. It is not a public chart.

## Runbook

**Setting it up.** Run `frontend/supabase/migrations/2026-09-vinax-7.2-trends.sql`. Make sure `CRON_SECRET` is set on the Worker and as a repository secret (the workflow uses it). Editorial works from here with no other secret. For the public chart, first read [Attribution: an owner decision](#attribution-an-owner-decision); then set `YOUTUBE_API_KEY` (`npx wrangler secret put YOUTUBE_API_KEY --config worker/wrangler.toml`), confirm the Music category id for your regions, and run **Trends ingest** by hand or press **Run sources now** in the console.

| What you see | Meaning and fix |
| --- | --- |
| Source `not_configured` | No key (video chart) or no database (editorial). Intended when the owner has not enabled it |
| Source `disabled` | Switched off in `TRENDS_DISABLED_SOURCES`, or the short-video source (always) |
| Source `unavailable` | Configured but never succeeded: read **Last error** in the console |
| Source `stale` | No success for 18 h: check the **Trends ingest** workflow and the last error; `quotaExceeded` means the project's quota, `keyInvalid` / `forbidden` the key |
| Run `skipped` `quota_budget` | Today's ceiling reached; raise `TRENDS_VIDEO_DAILY_UNIT_BUDGET` only if the project's quota allows |
| Many `deferred` items | The matching budget ran out or the catalogue was down; the next runs catch up |
| Retention warning | The job has not deleted old data: the workflow is not running. Run it, or delete snapshots older than 28 days by hand |
| A wrong song on the Charts page | Console → review decisions: correct the match to the right catalogue id (or reject it). The change is live on the next read (up to five minutes of cache) |

## Environment

All optional; documented in `backend/.env.example`: `YOUTUBE_API_KEY`, `TRENDS_REGIONS`, `TRENDS_VIDEO_CHART_LABEL`, `TRENDS_EDITORIAL_LABEL`, `TRENDS_DISABLED_SOURCES`, `TRENDS_VIDEO_DAILY_UNIT_BUDGET`, `TRENDS_VIDEO_CATEGORY_ID`, `TRENDS_VIDEO_PAGES`, `TRENDS_DERIVED_METRICS_SOURCES`. The scheduled job also needs `CRON_SECRET`; storage needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Limits

- Not verified against any live API. The adapters are tested against responses shaped like the documented ones.
- Matching is heuristic: letter-by-letter romanisation is not a dictionary, and titles on a chart are free text. The thresholds are deliberately conservative; expect a review queue.
- The matcher sees only the first 20 catalogue calls of a run; a region with many new entries takes a few runs to settle.
- Retention depends on the scheduled job running.
- The owner console has one shared token, so `reviewer` is whatever name the operator types.
