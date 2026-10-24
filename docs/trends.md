# Charts and trends

This document covers what the word "chart" means in VinaX, what `GET /api/trends` answers, how the app labels its lists, and what the verified-trend pipeline of 7.2 to 13.9.1 did, so that a future store can bring it back with the same contract.

`/api/trending-searches` is unrelated: it served the community search chips under the search bar, and it answers `{ queries: [] }` (search terms are not recorded).

## The rule that still holds

A list reaches a listener labelled as what it is. A **chart** item is a catalogue song matched with confidence to an entry that an outside source reported as popular, carrying the source, its rank, the region, the observation time and an evidence link. An **editorial** entry is labelled editorial, carries an evidence link and expires. A **catalogue list** is labelled as a catalogue list. A source that is switched off, not configured, failing or out of date says so. Trends are metadata only: nothing here downloads, extracts or stores audio.

The 14.0 schema keeps no trend tables, so there is nothing that can hold a chart observation or an editorial entry. The app therefore shows only catalogue lists, labelled as catalogue lists.

## `GET /api/trends`

```text
GET /api/trends            -> 200 { generatedAt, sources: [], items: [] }
OPTIONS /api/trends        -> 204
```

- `generatedAt` is the time of the answer.
- `sources` is always empty: no provider is registered.
- `items` is always empty.
- Cache: `public, max-age=60, s-maxage=300`.

The route accepts and ignores the `?region=` query of earlier releases, so an older app never gets a `400`.

## What the app does with it

`frontend/src/services/trends/present.ts` (`verifiedView`) turns the answer into one of four views. With no sources it answers `not_connected`, and the Charts page (`pages/ChartsPage.tsx`) shows its catalogue lists under a note that no chart source is connected. The recommender (`docs/recommendations.md`, candidate source `verified-trend`) receives no candidates and adds no trend bonus. Neither surface treats this as an error: it is the designed answer for a deployment with no chart store.

| `verifiedView` | When | Charts page |
| --- | --- | --- |
| `unavailable` | The request failed, or every connected source is unavailable | Catalogue lists, "charts could not be loaded" |
| `not_connected` | `sources` is empty, or every source is `not_configured` or `disabled` | Catalogue lists, "no chart source is connected" (the current answer) |
| `empty` | A source is connected and has no items | Catalogue lists, "nothing charted yet" |
| `items` | Confident matches to show | Chart rows with source, rank and evidence |

## What is left in the code

| File | Role |
| --- | --- |
| `backend/worker/functions/api/trends.ts` | The route above |
| `backend/worker/functions/_lib/trends/types.ts` | `RawTrendItem`, the shape a provider adapter would return |
| `backend/worker/functions/_lib/trends/matcher.ts` (+ test) | Pure matching of a raw item to one catalogue recording: normalised title and artist, confidence, method |
| `backend/worker/functions/_lib/trends/catalog.ts` | Catalogue lookups the matcher uses |
| `frontend/src/services/trends/` | `verifiedView` and the Charts presentation |

The matcher and its tests are kept because they are the hard, provider-independent part, and because the app's labelling contract depends on a matched item being a catalogue recording.

## What the pipeline was (7.2 to 13.9.1)

For the record, so the design is not lost. None of this exists in the current code.

- A scheduled workflow (`trends-ingest.yml`, every six hours) called `POST /api/cron/trends-ingest` with a shared secret header. For each registered provider and region it checked the provider's status, skipped when a full run could pass the daily quota ceiling, fetched with three attempts, treated an empty public chart as an error, stored a snapshot with a unique key plus its observations, matched new items (confident ones `matched`, the rest queued for `review`), recorded one run row, then pruned past retention.
- Providers: two public-chart adapters (retired in 13.9.1) and an editorial provider fed from the owner console's import.
- Storage: five tables (`vinax_trend_runs`, `vinax_trend_snapshots`, `vinax_trend_observations`, `vinax_trend_matches`, `vinax_trend_editorial`) with row level security and no client policies; only the Worker wrote to them.
- The read served the newest snapshot per source, confident and accepted matches only, unexpired, cached 5 minutes (15 s while degraded).
- The owner console (`/api/admin/trends`) showed status, quota, freshness, the review queue and recent decisions, and ran ingestion on demand.
- Derived metrics (rank change, new entry) were off unless a provider's terms permitted them (`TRENDS_DERIVED_METRICS_SOURCES`), and the Charts page never showed a figure it could not source.

## Bringing it back

A future store needs, in this order: a place for snapshots and observations with a unique key per source, region, chart and observation time; a registry of providers whose terms allow redistribution of rank metadata with attribution; the ingest loop above with its quota ceiling and retention; and the read's shape, which the app already understands. The `RawTrendItem` type and the matcher are the contract between the fetch and the catalogue.

## Testing

```sh
cd backend
npx vitest run worker/functions/api/trends.test.ts worker/functions/_lib/trends
cd ../frontend
npx vitest run src/services/trends
```
