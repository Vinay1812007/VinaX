# Discovery Room upgrade

This change redesigns Search, refreshes the listener navigation and desktop player surfaces, and adds an Operations Workspace at `/admin/#workspace`. It builds on the existing player, library, catalog, and authenticated admin APIs. Other routed pages retain their existing page layouts.

## Search engine improvements

- Provider responses with explicitly empty result arrays now produce a proper zero-result state instead of exhausting the provider retry ladder. Unsupported response shapes still fall back.
- An empty combined search can retry once with a relaxed punctuation / repeated-letter query. The normal and relaxed query cache behavior remains bounded.
- Song and album pagination stop when a provider repeats an earlier page. Song pagination measures the raw provider page before local filtering, so muted languages and quality filters cannot prematurely stop discovery.
- Accent-insensitive title ranking preserves Indic vowel signs. Local filtering matches multiple words across title, album, subtitle, and credited artists.
- Quick results pass through the same kid-mode and muted-language ranking rules as full results. Stale quick results cannot start playback.
- Lyrics mode suspends the combined catalog search. Existing abort signals, typing debounce, and repeat-query caches remain in use.
- Quick results and suggestions support keyboard activation. Clearing the query also clears its URL.

## 15 listener additions

1. Browse four designed mood cards directly from Search.
2. Filter loaded songs by release decade.
3. Filter by length: under three, three to five, or over five minutes.
4. Show only tracks with catalog-reported lyrics.
5. Hide tracks flagged explicit by the catalog.
6. Search within local favorites.
7. Exclude tracks in the last 150 local history entries.
8. Save up to 20 named search presets with query, sort, language, and refinements; reopen, rename, or remove them.
9. Toggle a persistent compact results layout.
10. Shuffle the filtered result set.
11. Add filtered results to favorites without toggling existing favorites off.
12. Save filtered results for later without removing existing entries or exceeding the 500-song cap.
13. Create a named library collection from filtered results.
14. Export filtered song metadata as CSV, with formula prefixes neutralized.
15. Collapse listener navigation groups, retaining access to the active route and saving the preference.

Additional refinements include an always-available within-results text filter, visible loaded-result counts, an explicit load-more action, and clear filtered-empty states. Filters and bulk actions apply to loaded results, not the entire remote catalog. Metadata availability affects decade, length, lyrics, and explicit filters.

## 13 admin additions

1. Customize the visible metric tiles in a consolidated audience dashboard.
2. Capture an aggregate metric snapshot and inspect numeric changes since capture.
3. Configure local review thresholds for errors and new feedback, with links to the existing diagnostic tools.
4. Set a daily play goal and track progress against reported plays today.
5. Review and filter a zero-result search recovery queue; open a live listener search to investigate.
6. Keep up to 50 search queries on a local watchlist.
7. Mark a failed query reviewed or reopen it.
8. Create follow-up tasks, assign an owner, choose priority and due date, track overdue items, change status, and filter the task board (100-task cap).
9. Save up to 12 workspace views with the current tab, query/status filter, and metric visibility.
10. Complete a daily operations checklist that resets on the next local calendar day.
11. Save handover notes; unsaved note/task drafts survive workspace tab changes and refresh rendering within the session.
12. Inspect the last 50 local workspace activity entries.
13. Download a timestamped handover report containing source availability, aggregates, thresholds, snapshot, goal, tasks, notes, checklist, watchlist, and activity.

Metrics and search analytics use the existing token-gated APIs. Tasks, owners, goals, snapshots, notes, reviews, and views are stored in the current browser. Assigning an owner sends no notification. Thresholds are checked when the workspace refreshes; they are not a background alert service. The workspace does not run paid AI health probes.

Source failures display as unavailable. Search totals cover at most 3,000 consented events; the displayed zero-result count covers only the reported top 20 failed queries and is explicitly not an overall failure rate. Snapshot differences compare capture times, not equal reporting periods. Changing the global date range reloads the sources.

## Verification

Run from `frontend/`:

```sh
npm run lint
npm test
npm run build
E2E_CHROMIUM_PATH='/path/to/chromium' npx vitest run --config e2e/vitest.config.ts e2e/discovery-workspace.spec.ts
```

The new browser suite covers desktop dark / mobile light layouts, real library mutations, preset restoration, compact view, admin snapshot capture, HTML escaping, watchlists, review status, tasks, saved views, and draft persistence. It uses mocked APIs, so it does not verify live catalog uptime or production credentials. Screenshots are written under `frontend/test-results/`.

This is a source-code upgrade; deployment is a separate step. Existing build warnings about shared dynamic imports and large vendor chunks remain relevant.

### Checked in this workspace

- Frontend unit tests: **513 passed across 79 files**.
- Full browser regression suite: **18 passed across six files**.
- Lint, TypeScript production build, JavaScript syntax, and whitespace checks passed.
- First-load JavaScript: **168.7 KB gzip**, within the existing **170 KB** budget.
- Desktop, mobile light mode, and desktop with the persistent player/queue were visually inspected. The discovery header collapses when a query becomes active to keep results near the top.
