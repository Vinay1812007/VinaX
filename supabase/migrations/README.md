# Supabase migrations

Idempotent SQL to paste into the Supabase SQL Editor, in any order. These
were previously delivered out-of-band and never committed — so a repo clone
could not stand up the admin Engagement panel (experiments), retention
cohorts, or room reactions at all (admin audit D-1).

- `2026-07-vinax-experiments.sql` — A/B experiment definitions (+ RLS deny-all)
- `2026-07-vinax-retention.sql` — `vinax_retention(p_weeks)` cohort function
- `2026-07-vinax-reactions.sql` — Listen-Together reaction columns
- `2026-07-vinax-rls-audit.sql` — RLS posture assertion for every table

⚠ `supabase/schema.sql` drops ALL `vinax_%` functions before recreating its
own set — re-running it removes `vinax_retention`. Re-apply
`2026-07-vinax-retention.sql` after any schema.sql re-run.
