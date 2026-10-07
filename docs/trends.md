# Verified trends

This document covers the trend pipeline: how the Worker collects what outside sources report as popular, matches each entry to one catalogue recording, stores it with its evidence, and serves it through `GET /api/trends`; what the app does with that answer; and how to configure, observe and change it. The pipeline exists so that the word "chart" in the app always has evidence behind it. A chart item reaches a listener only as a catalogue song matched with confidence to a source entry, labelled with the source, its rank, the region, the observation time and an evidence link. An editorial entry is labelled editorial, carries an evidence link and expires. Catalogue search lists are labelled as catalogue lists. A source that is switched off, not configured, failing or out of date says so. Trends are metadata only: nothing here downloads, extracts or stores audio.

`/api/trending-searches` is unrelated: it serves the community search chips under the search bar.

## The model

```text
 .github/workflows/trends-ingest.yml     every 6 hours, authenticated by the cron secret header
            |
            v
 POST /api/cron/trends-ingest            for each provider x region:
            |                              1 status   provider must be `ok`
            |                              2 quota    skip if a full run could pass the daily ceiling
            |                              3 fetch    3 attempts, 8 s each, backoff + jitter
            |                              4 guard    an empty public chart is an error
            |                              5 store    snapshot (unique key) + observations
            |                              6 match    new items only -> matched | review
            |                              7 record   one run row; then prune past retention
            v
 GET /api/trends                         newest snapshot per source, confident matches, unexpired
            |
            +--> Charts page             labelled chart and editorial rows
            +--> recommender             a capped score bonus and up to 6 candidate songs
 GET/POST /api/admin/trends              owner console: status, quota, review queue, imports
```

There are three providers, registered in display order in `PROVIDERS` (`backend/worker/functions/_lib/trends/registry.ts`). Nothing else in the pipeline is provider-specific.

| Provider (export) | File | Kind | Chart | Snapshot policy | Item lifetime | State |
| --- | --- | --- | --- | --- | --- | --- |
| Video chart (`videoChartProvider`) | `videoChart.ts` | `public-chart` | `most-popular-music` | `hourly` | 72 hours after observation | `ok` when its Data API key is set |
| Short-video audio (`shortVideoProvider`) | `shortVideo.ts` | `public-chart` | `trending-audio` | `hourly` | not applicable | always `disabled`; never fetches |
| Editorial (`editorialProvider`) | `editorial.ts` | `editorial` | `editorial` | `content` | the entry's own expiry | `ok` when the database is configured |

Each provider's `id` string is the `id` field of its export. The two platform adapters use the platform's name as the id, so this document refers to them by role; read the id in the file when you need to type it (for the `source` query parameter or `TRENDS_DISABLED_SOURCES`).

## Files

| File | Role |
| --- | --- |
| `backend/worker/functions/_lib/trends/types.ts` | `TrendProvider`, `RawTrendItem`, `TrendsEnv`, `envList`, `envInt`, `configuredRegions` |
| `backend/worker/functions/_lib/trends/registry.ts` | `PROVIDERS`, `providerById`, `TRENDS_POLICY` |
| `backend/worker/functions/_lib/trends/videoChart.ts`, `shortVideo.ts`, `editorial.ts` | The three adapters |
| `backend/worker/functions/_lib/trends/retry.ts` | `withRetries`, `backoffDelay` |
| `backend/worker/functions/_lib/trends/ingest.ts` | `runIngest`, `snapshotKey`, `quotaUsedToday`, `pruneExpired` |
| `backend/worker/functions/_lib/trends/matcher.ts`, `catalog.ts` | `matchRawItem` and the in-process catalogue calls it uses |
| `backend/worker/functions/_lib/trends/read.ts` | `readPublicTrends`, `computeMomentum` |
| `backend/worker/functions/_lib/trends/importer.ts`, `review.ts` | Editorial import validation; review decisions |
| `backend/worker/functions/api/trends.ts` | `GET /api/trends` |
| `backend/worker/functions/api/cron/trends-ingest.ts` | `POST /api/cron/trends-ingest` |
| `backend/worker/functions/api/admin/trends.ts` | `GET/POST /api/admin/trends` |
| `frontend/supabase/migrations/2026-09-vinax-7.2-trends.sql` | The five tables (also in `frontend/supabase/schema.sql`) |
| `.github/workflows/trends-ingest.yml` | The schedule |
| `frontend/public/admin/sections/trends.js` | Owner console panel "Trend Operations" |
| `frontend/src/services/trends/client.ts` | `fetchVerifiedTrends` |
| `frontend/src/services/trends/present.ts` | Labels and view states for the Charts page |
| `frontend/src/services/trends/signal.ts` | `trendSignalNow`, the recommender's trend signal |
| `frontend/src/pages/ChartsPage.tsx` | Where listeners see verified charts |

## Providers

A provider implements `TrendProvider` (`types.ts`): `id`, `kind`, `chart`, `snapshotPolicy`, `displayHours`, `label(env)`, `status(env)` (`ok`, `not_configured` or `disabled`), `statusReason(env)`, `maxUnitsPerRun(env)`, `dailyUnitBudget(env)`, `derivedMetricsAllowed(env)` and `fetch(env, opts)`. `fetch` returns `RawTrendItem`s. A raw item keeps the source's own item id and evidence URL and never carries a catalogue id: a popular video does not prove a known song. The catalogue id lives only on the match.

### The video chart

`videoChartProvider` reads the video platform's most-popular chart for one region and one category, 50 entries a page (`PAGE_SIZE`), 1 to 4 pages (`TRENDS_VIDEO_PAGES`, default 1). Every request costs one quota unit, including a failed one, and is counted on the run's meter. `maxUnitsPerRun` is pages × 3. The category defaults to `10` and can be changed with `TRENDS_VIDEO_CATEGORY_ID`; the id for "Music" has not been confirmed against a live category listing. The label listeners see is `TRENDS_VIDEO_CHART_LABEL` (first 40 characters) or `VIDEO_CHART_DEFAULT_LABEL`, "Public video chart".

The platform's developer policies, as read on 2026-09-19, shape four things in this code:

| Policy (section) | Consequence here |
| --- | --- |
| Data read without user credentials may be stored for at most 30 calendar days, then deleted or refreshed; the newest data must be shown; historical data must be presented in its context of time (III.E.4) | `TRENDS_POLICY.retentionDays` is 28; every item carries `observedAt`; the read uses only the newest snapshot |
| No new or derived metrics from the data unless a separate amendment has been accepted (III.E.4) | Rank change and "new entry" are off for this source unless the owner opts in; see [Momentum](#momentum) |
| No aggregation of the data, and no use of it to gain insight into the platform's business (III.E.2) | This source's entries are never combined with another source's; statistics are stored as returned and never published |
| No storing, separating or separately promoting audio or video (III.E.1, III.I) | Only ids, titles, ranks and links are stored; playback is the listener's catalogue copy of the matched song |

**Attribution is an open owner decision.** The same policies (III.F.2) ask a client that displays the platform's content to show the platform's brand features next to it. The product's standing rule is that no third-party brand appears in it, so the default label is neutral and very likely does not meet that requirement. The owner can set `TRENDS_VIDEO_CHART_LABEL` and add the brand features as an exception, leave the key unset so the source reports `not_configured`, or take advice. This document is not legal advice.

### The short-video audio source

`shortVideoProvider` always returns `disabled` and its `fetch` is never called. The platform's only documented listing of trending audio belongs to its content-publishing API, needs a business account and publishing permissions, and returns no rank, count or region. That is not a verified licence for a popularity chart in another app. Songs that are popular there are featured through an editorial import with an evidence link. The reasoning is in the header comment of `shortVideo.ts`.

A third platform's research API is limited to non-commercial academic research. No adapter exists, and its advertising library is never used as a popularity signal.

### Editorial

`editorialProvider` turns the active rows of `vinax_trend_editorial` into raw items. It is `not_configured` without a database. Entries arrive through the owner console ([Editorial imports](#editorial-imports)). The label is `TRENDS_EDITORIAL_LABEL` or `EDITORIAL_DEFAULT_LABEL`.

## Scheduled ingestion

`POST /api/cron/trends-ingest` (`api/cron/trends-ingest.ts`) calls `runIngest` with pruning on. The cron secret is read from the `x-cron-secret` header only and compared in constant time. Optional `?source=<id>&region=<CC>` narrow a run.

| Answer | When |
| --- | --- |
| `200` | Every attempted run succeeded. Disabled and unconfigured providers are listed under `notRun` and are not failures |
| `401` | The secret is missing or wrong |
| `502` | At least one run failed; the workflow opens or updates one issue |
| `503` | The database is not configured |

`runIngest` loops over the providers and `configuredRegions(env)`. For each pair, `runOne` does this:

1. **Status.** `status(env)` must be `ok`.
2. **Quota.** For a provider with a daily budget, `quotaUsedToday` sums `quota_units` of the run rows since UTC midnight. If that plus `maxUnitsPerRun` exceeds the budget, the run is recorded as `skipped` (`quota_budget`). If the run log cannot be read, the run is skipped with `quota_unknown`.
3. **Idempotency.** An `hourly` provider's snapshot key is `h:<UTC hour>`. The job looks for that key before fetching, so a second run inside the hour spends no quota. A `content` provider's key is `c:<hash of its items>`, so an unchanged editorial list stores nothing and any import, withdrawal or expiry stores a new snapshot.
4. **Fetch** through `withRetries`: 3 attempts, 8 seconds each. The delay before retry *n* is `min(4000, 500 × 2^(n−1))` ms plus 0–250 ms of uniform jitter (`backoffDelay`). Only timeouts, network errors, `5xx` and `429` are retried; a refused key, an exhausted quota or an unknown chart fails at once.
5. **Guard.** A public chart that answers with no entries is an error (`empty_chart`). The previous snapshot stays.
6. **Store** the snapshot and its observations. An observation expires `displayHours` after it was observed, or at the editorial entry's own expiry. If the observations cannot be written, the snapshot is deleted again, so an empty snapshot never reads as an empty chart.
7. **Match** items that have no match row yet, three at a time (`MATCH_CONCURRENCY`), from a budget of `TRENDS_POLICY.matchBudgetPerRun` catalogue calls shared by the whole job. Items the budget did not reach, or whose catalogue call failed, get no match row, are counted as `deferred` and are tried on the next run. A known item is not matched again; its `last_seen_at` is refreshed.
8. **Record** the run in `vinax_trend_runs`.

After all runs, `pruneExpired` deletes snapshots fetched more than 28 days ago (observations cascade), matches not seen for 28 days, and run rows and editorial entries more than 90 days past. Deletion happens only inside this job: if the schedule stops, nothing is deleted.

The workflow runs at `17 */6 * * *`. With one page, a scheduled run costs 1 unit per region and at most 3, against the app's default ceiling of 200 units a day. `TRENDS_POLICY.staleAfterHours` (18) tolerates two missed runs.

## Matching

`matchRawItem` (`matcher.ts`) decides whether a raw item is confidently one catalogue recording.

1. **Parse the title** (`parseSourceTitle`). Split it into segments, drop presentation words ("Lyrical", "Official Video", "4K" and similar), read a film from `(From "X")` or a trailing "from X", collect version words (remix, reprise, unplugged, slowed, lofi, live, cover, karaoke, instrumental and similar) into a version tag, and read a language named in the title. Flag non-songs (jukebox, trailer, teaser, promo, interview, full movie and similar) and short-form reuse ("#shorts", "original audio", "status video" and similar).
2. **Search** the catalogue in process through `catalog.ts`, at most two distinct queries per item.
3. **Score every candidate** (`scoreCandidate`). Title evidence (`titleEvidence`) is `exact` (same script, equal after identity normalisation), `phonetic` (equal after folding romanisation variants), `transliterated` (different scripts, equal on a consonant key after romanisation), `partial` (bigram similarity of at least 0.75, or 0.8 across scripts) or `none`. Corroboration is a credited name that agrees (`creditsAgree`) and a film that agrees with the candidate's album (`movieAgrees`).

   | Title evidence (`CONFIDENCE`) | Artist and film | One of them | Neither |
   | --- | ---: | ---: | ---: |
   | exact | 0.98 | 0.92 | 0.70 |
   | phonetic | 0.90 | 0.85 | 0.60 |
   | transliterated | 0.85 | 0.80 | 0.50 |
   | partial | 0.75 | 0.60 | 0.30 |

   Caps (`CAP`): a version-tag mismatch 0.45, a language named in the title that differs from the candidate's 0.45, short-form reuse 0.5.
4. **Decide** (`decide`). The item is `matched` when the best candidate scores at least `AUTO_MATCH_THRESHOLD` (0.8) and no candidate that could be a different song scores within `AMBIGUITY_MARGIN` (0.05) of it. Two candidates are different songs (`differentSongs`) when their work families differ, or when they share a family and their durations differ by more than 5 seconds. Everything else is `review`, with a reason such as `ambiguous`, `version_mismatch`, `language_mismatch`, `transliteration`, `uncorroborated`, `weak_title`, `short_form_reuse`, `not_a_song` or `no_candidate`. The method is recorded, for example `title:exact+artist+film`.
5. **Editorial entries that name a catalogue id** are confirmed with one catalogue lookup: found and consistent gives `matched` at 1.0 (`editorial-catalog-id`); an unknown id or a different song gives `review`.

A `review` item never reaches the public read, so it never reaches a shelf, a queue or autoplay. The owner accepts, rejects, or corrects it to another catalogue id in the console (`review.ts`). Each decision is appended to the match's `history`, which keeps at most 50 entries (`MAX_HISTORY`).

## Storage

Five tables, created by `frontend/supabase/migrations/2026-09-vinax-7.2-trends.sql`. Row level security is enabled on all five with no policies for clients; the Worker writes with the service key.

| Table | One row per | Notes |
| --- | --- | --- |
| `vinax_trend_runs` | provider × region × run | `trigger`, start and finish, `status`, `error`, `attempts`, items fetched and inserted, matched, queued for review, `quota_units`, `snapshot_key` |
| `vinax_trend_snapshots` | stored snapshot | unique on `(source, region, chart, snapshot_key)`; `observed_at`, `fetched_at`, `item_count` |
| `vinax_trend_observations` | item in a snapshot | `source_item_id`, `url`, `source_rank`, `observed_at`, `expires_at`; deleted with its snapshot |
| `vinax_trend_matches` | source item | `catalog_id`, catalogue title, artist and language, `mapping_confidence`, method, `status` (`matched`, `review`, `accepted`, `rejected`, `corrected`), `history`, `last_seen_at` |
| `vinax_trend_editorial` | editorial entry | title, artist, catalogue id, region, language, position, evidence URL, start, `expires_at`, status |

The indexes serve the newest snapshot per source, region and chart, unexpired observations, the review queue, recent decisions, active editorial entries and the retention sweeps.

## Public read: `GET /api/trends`

`parseTrendsQuery` (`api/trends.ts`) reads four parameters. Invalid values fall back silently.

| Parameter | Accepted | Default |
| --- | --- | --- |
| `region` | Two letters, and one of the ingested regions | The first ingested region |
| `language` | A catalogue language id, 2–20 letters | No filter |
| `source` | A registered provider id | No filter |
| `limit` | 1–50 | 20 |

The answer is public with CORS `*`. It is stored in the edge cache under the normalised URL `/api/trends?region=…&language=…&source=…&limit=…`.

| Case | `cache-control` |
| --- | --- |
| Normal answer | `public, max-age=60, s-maxage=300` |
| Degraded answer (a database read failed or no database) | `public, max-age=15, s-maxage=30` |
| `readPublicTrends` threw | `503 { "error": "unavailable" }`, `no-store` |

```json
{
  "generatedAt": "2026-09-19T12:00:00.000Z",
  "sources": [
    { "id": "<provider id>", "label": "Public video chart", "kind": "public-chart", "status": "ok", "lastSuccessAt": "2026-09-19T11:17:04.000Z", "region": "IN" }
  ],
  "items": [
    {
      "catalogId": "abc123", "title": "…", "artist": "…", "language": "telugu",
      "region": "IN", "source": "<provider id>", "sourceLabel": "Public video chart", "sourceKind": "public-chart",
      "sourceRank": 3, "sourceUrl": "https://…", "observedAt": "2026-09-19T11:17:00.000Z",
      "expiresAt": "2026-09-22T11:17:00.000Z", "mappingConfidence": 0.98, "momentum": null, "newEntry": false
    }
  ]
}
```

`readPublicTrends` (`read.ts`) builds it as follows.

- `sources` lists every provider. A provider whose own status is `disabled` or `not_configured` keeps that status. A configured provider is `unavailable` until a successful run is found, then `ok`, or `stale` when the last success is older than 18 hours. A stale source's unexpired items are still returned.
- `items` come from the newest snapshot of each source, from observations that have not expired, joined to matches whose status is in `ELIGIBLE_STATUSES` (`matched`, `accepted`, `corrected`) with `mapping_confidence` of at least 0.8.
- Items are ordered by provider order (public charts, then editorial), then by rank. Two entries of one source that map to the same catalogue song appear once, at the better rank.

### Momentum

`computeMomentum` compares the newest snapshot with the newest earlier snapshot of the same source, region and chart observed between 6 and 48 hours before it (`momentumMinWindowHours`, `momentumMaxWindowHours`).

```text
rankDelta   = previous rank − current rank     (positive = moved up)
windowHours = hours between the two observations, rounded
newEntry    = a comparable previous snapshot exists and the item is not in it
```

Without a comparable previous snapshot every item has `momentum: null` and `newEntry: false`. Items are compared by the source's own item id, so a new upload of the same song is a new entry. Counts are never used.

Momentum is computed only for a provider whose `derivedMetricsAllowed(env)` is true, which means its id is listed in `TRENDS_DERIVED_METRICS_SOURCES`. The list is empty by default, because the video platform's policies forbid derived metrics without a separate permission. The editorial and short-video providers return false whatever the setting: an editor's order is not an observation of popularity. With the default configuration the Charts page shows no "Rising" or "New entry" markers, and that is correct.

## In the app

- **Client.** `fetchVerifiedTrends({ region, language, limit, signal })` (`client.ts`) never throws. It resolves `null` when the read is unavailable: offline, an 8-second timeout (`TIMEOUT_MS`), an HTTP error or a malformed answer. It validates every field and drops items that fail. It is imported lazily and is not in the first-load bundle.
- **Charts page.** `ChartsPage.tsx` asks for the listener's region (from `useRegion`, else `IN`) with `limit: 50`, and keeps the answer fresh for 5 minutes. `present.ts` turns it into the view: a status line per source (`sourceLine`), source filter chips (`sourceChips`), "Rising" and "New entry" markers only when the item carries them (`movementMarker`), and a provenance line per item (`provenanceLine`) that marks editorial entries "Editorial pick". Below, the catalogue lists are headed `CATALOGUE_LIST_TITLE` ("Popular in the catalogue") with a note that they are search results, not a live chart. When no source is configured or the read is unavailable, the page says so and the catalogue lists remain.
- **Recommender.** `trendSignalNow` (`signal.ts`) answers from an in-memory snapshot and never waits. When the snapshot is older than 15 minutes (`FRESH_MS`), or was fetched for another region or first pinned language, it starts a background refresh of the top 50 entries for the next round. A failed read is not retried for 10 minutes (`RETRY_MS`). The signal gives a candidate that is also a verified entry a score bonus of at most `TREND_MAX` (0.06) for a chart position and `TREND_EDITORIAL_MAX` (0.03) for an editorial pick. The bonus falls linearly with rank and is scaled by the mapping confidence. `frontend/src/services/recommendation/candidates.ts` also resolves up to `TREND_RESOLVE` (6) verified entries per gather into candidate songs by catalogue id, cached for 30 minutes. The engine (`frontend/src/services/recommendation/engine.ts`) stores each entry's source label as `chart` evidence in the evidence store. See [recommendations.md](recommendations.md).
- **Home.** The shelf "Popular picks for you" (`frontend/src/features/home/blocks/DiscoveryBlocks.tsx`) is a catalogue list ordered by taste. It is not a chart.

## Owner console: `/api/admin/trends`

Every handler checks `isAdminAsync` first. The panel is "Trend Operations" in `frontend/public/admin/sections/trends.js`; see [admin-console.md](admin-console.md).

`GET` returns `providers`, `policy`, `freshness` (per source and region), `quota` (used today, daily budget, units per run), `retention` (age of the oldest stored snapshot), `matches`, `reviewQueue`, `recentDecisions`, `editorial` and `runs`. When a database read fails it answers `503` with an error code, never zeros.

`POST { action }`:

| Action | Body | Effect |
| --- | --- | --- |
| `review` | `id`, `decision` (`accept`, `reject`, `correct`), `catalogId` for correct, `note`, `reviewer` | Updates the match and appends to its history |
| `validate-import` | `format` (`csv` or `json`), `data` | Reports every problem by row and field; writes nothing |
| `import` | same | All or nothing; then runs the editorial source so the entries are live |
| `withdraw` | `editorialId` | Stops the entry and runs the editorial source |
| `run` | optional `source`, `region` | Runs ingestion now; the quota ceiling still applies |

Every mutation leaves an audit row. The console has one shared token, so `reviewer` is whatever name the operator types.

### Editorial imports

`importer.ts` validates the rows. CSV columns, in any order: `title,artist,catalog_id,region,language,position,evidence_url,starts_at,expires_at,note`. JSON is an array of objects with the same fields.

| Rule | Value |
| --- | --- |
| Rows per import | At most 200 (`MAX_IMPORT_ROWS`) |
| Identity | A title, and an artist or a catalogue id |
| Evidence link | `https://`, a real host, no embedded credentials |
| Expiry | Required, after the start, in the future, at most 90 days after the start (`MAX_WINDOW_DAYS`) |
| Region | Two letters, default `IN` |
| Position | 1–100 |

One invalid row and nothing is imported.

## Settings

All are optional Worker variables declared in `TrendsEnv` (`types.ts`) and described in `backend/.env.example`. How to set a Worker secret, and the cron secret and database secrets the job also needs, are in [operations.md](operations.md).

| Setting | Default | Effect |
| --- | --- | --- |
| The Data API key (first field of `TrendsEnv`, read in `videoChart.ts`) | unset | Unset means the video chart is `not_configured` and nothing is fetched |
| `TRENDS_REGIONS` | `IN` | Comma-separated regions to ingest; the first is the read's default |
| `TRENDS_DISABLED_SOURCES` | empty | Provider ids to switch off |
| `TRENDS_VIDEO_DAILY_UNIT_BUDGET` | 200 (1–10000) | The app's own daily quota ceiling for the video chart |
| `TRENDS_VIDEO_PAGES` | 1 (1–4) | Pages of 50 per region per run |
| `TRENDS_VIDEO_CATEGORY_ID` | `10` | Chart category |
| `TRENDS_VIDEO_CHART_LABEL`, `TRENDS_EDITORIAL_LABEL` | built-in labels | What listeners see as the source name (40 characters) |
| `TRENDS_DERIVED_METRICS_SOURCES` | empty | Provider ids for which momentum is computed |

Constants in code (`TRENDS_POLICY` unless noted):

| Constant | Value |
| --- | --- |
| `staleAfterHours` | 18 |
| `retentionDays` | 28 |
| `operationalRetentionDays` | 90 |
| `momentumMinWindowHours` / `momentumMaxWindowHours` | 6 / 48 |
| `matchBudgetPerRun` | 20 |
| `AUTO_MATCH_THRESHOLD` / `AMBIGUITY_MARGIN` (`matcher.ts`) | 0.8 / 0.05 |

## Observing and debugging

Open the console panel first: it shows every provider's status and reason, the last run and last error per source and region, today's quota, the review queue and the run log. It warns when the oldest stored snapshot is within two days of the retention limit.

| What you see | Meaning and fix |
| --- | --- |
| Source `not_configured` | No key (video chart) or no database (editorial) |
| Source `disabled` | Listed in `TRENDS_DISABLED_SOURCES`, or the short-video source (always) |
| Source `unavailable` | Configured but never succeeded; read the last error in the console |
| Source `stale` | No success for 18 hours; check the "Trends ingest" workflow and the last error |
| Run `skipped`, `quota_budget` | Today's ceiling is reached; raise `TRENDS_VIDEO_DAILY_UNIT_BUDGET` only if the project's real quota allows |
| Run `error`, `empty_chart` | The source answered with no entries; the previous snapshot is still served |
| Many `deferred` items | The matching budget ran out or the catalogue was down; later runs catch up |
| Retention warning | The scheduled job is not running; run it |
| A wrong song on the Charts page | Correct or reject the match in the console; the change is live after the cache expires (up to five minutes at the edge) |

To run ingestion by hand, start the "Trends ingest" workflow or press "Run sources now" in the console.

## Changing it safely

- A new source is one adapter added to `PROVIDERS`. Decide its `derivedMetricsAllowed` and retention against the source's own terms before writing `fetch`.
- A change to a threshold in `TRENDS_POLICY`, `CONFIDENCE` or `CAP` changes what listeners see as verified. Update the tables in this document in the same change.
- The first setup needs the migration applied; without the tables the console answers `503`.

Worker tests, from `backend/`:

```sh
npx vitest run worker/functions/_lib/trends worker/functions/api/trends.test.ts worker/functions/api/cron/trends-ingest.test.ts worker/functions/api/admin/trends.test.ts
```

App tests, from `frontend/`:

```sh
npx vitest run src/services/trends
```

A change to the bonus or the candidate lane in `signal.ts` or `candidates.ts` is a ranking change; measure it with `node scripts/eval-recs.mjs` from `frontend/`, as [evaluation.md](evaluation.md) describes.

## Limits

- Nothing here has been verified against a live provider API. The adapters are tested against responses shaped like the documented ones.
- Matching is heuristic. Romanisation is letter by letter, not a dictionary, and chart titles are free text. The thresholds are conservative; expect a review queue.
- A job matches at most 20 catalogue calls' worth of new items; a region with many new entries takes a few runs to settle.

## History that still matters

- The migration file name carries the release in which the tables were introduced. It is the current schema.
- The two platform adapters' ids are platform names. The ids are stored in the `source` column of the run, snapshot, observation and match tables, so renaming them needs a data migration as well as a code change.
