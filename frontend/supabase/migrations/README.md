# Supabase migrations

Idempotent SQL to paste into the Supabase SQL Editor, in any order. These
were previously delivered out-of-band and never committed — so a repo clone
could not stand up the admin Engagement panel (experiments), retention
cohorts, or room reactions at all (admin audit D-1).

- `2026-07-vinax-experiments.sql` — A/B experiment definitions (+ RLS deny-all)
- `2026-07-vinax-retention.sql` — `vinax_retention(p_weeks)` cohort function
- `2026-07-vinax-reactions.sql` — Listen-Together reaction columns
- `2026-07-vinax-rls-audit.sql` — RLS posture assertion for every table
- `2026-08-vinax-rooms-hosttoken.sql` — host token on Listen-Together rooms
- `2026-08-vinax-seo-urls.sql` — the crawled-URL corpus
- `20260825_username.sql` — claimed usernames
- `2026-09-vinax-rollups-and-tokens.sql` — exact admin rollups + AI token columns

7.2 (apply all three before the features that use them are switched on):

- `2026-09-vinax-7.2-events-meta.sql` — `vinax_events.meta` for recommendation telemetry. Until it is applied the Worker retries the insert without `meta`, so events keep flowing and the Recommendation Quality panel says "not provisioned".
- `2026-09-vinax-7.2-ai-controls.sql` — `vinax_ai_usage_since` for the daily AI spend caps. Until it is applied the caps read a bounded sample and say so.
- `2026-09-vinax-7.2-trends.sql` — the verified-trend tables (runs, snapshots, observations, matches, editorial). Apply it **before** enabling the ingestion workflow, or every run fails.

⚠ `supabase/schema.sql` drops ALL `vinax_%` functions before recreating its
own set — re-running it removes `vinax_retention`. Re-apply
`2026-07-vinax-retention.sql` after any schema.sql re-run.
