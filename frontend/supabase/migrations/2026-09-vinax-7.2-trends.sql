-- ============================================================================
-- VinaX 7.2 — verified trends (docs/trends.md)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent: safe to run
-- again; every object is created only if it is missing.
--
-- Five tables, written only by the Worker with the service-role key:
--   vinax_trend_runs          one row per provider × region × run: started,
--                             finished, ok, error, attempts, items, quota
--                             units used. Last success = newest ok row.
--   vinax_trend_snapshots     one row per stored chart snapshot. The unique
--                             key (source, region, chart, snapshot_key) is
--                             what makes ingestion idempotent: re-running a
--                             job for the same snapshot inserts nothing.
--   vinax_trend_observations  what a source said, item by item: its own id
--                             and link (never a catalogue id), rank, language
--                             evidence, statistics as returned, provenance,
--                             observed / fetched / expires times.
--   vinax_trend_matches       one row per source item: the catalogue song it
--                             maps to (or not), confidence, method, review
--                             status, reviewer and the correction history.
--   vinax_trend_editorial     the owner's editorial imports: evidence link,
--                             start, expiry, who imported them and when.
--
-- Retention. The video platform's developer policies let data read without
-- user credentials be stored for at most 30 calendar days before it is
-- deleted or refreshed. The scheduled job deletes snapshots (observations go
-- with them, ON DELETE CASCADE) 28 days after they were fetched, and matches
-- that have not been seen again for 28 days. See docs/trends.md.
--
-- Metadata only. Nothing here holds audio, and nothing should.
-- ============================================================================

-- ------------------------------------------------------------------- runs ---
create table if not exists public.vinax_trend_runs (
  id                 uuid primary key,
  source             text not null,
  region             text not null,
  trigger            text not null default 'cron',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  ok                 boolean not null default false,
  status             text not null default 'running'
                     check (status in ('running', 'ok', 'error', 'skipped')),
  error              text,
  attempts           int not null default 0,
  items_fetched      int not null default 0,
  items_inserted     int not null default 0,
  matched            int not null default 0,
  queued_for_review  int not null default 0,
  quota_units        int not null default 0,
  snapshot_key       text,
  duplicate_snapshot boolean not null default false
);
-- Last success per source/region, quota used today, the console's run log.
create index if not exists vinax_trend_runs_source_started_idx
  on public.vinax_trend_runs (source, region, started_at desc);
create index if not exists vinax_trend_runs_success_idx
  on public.vinax_trend_runs (region, finished_at desc) where ok;

-- -------------------------------------------------------------- snapshots ---
create table if not exists public.vinax_trend_snapshots (
  id           bigint generated always as identity primary key,
  source       text not null,
  region       text not null,
  chart        text not null,
  snapshot_key text not null,
  observed_at  timestamptz not null,
  fetched_at   timestamptz not null,
  item_count   int not null default 0,
  run_id       uuid,
  constraint vinax_trend_snapshots_key unique (source, region, chart, snapshot_key)
);
-- Newest snapshot per source/region, and the comparable earlier one for momentum.
create index if not exists vinax_trend_snapshots_latest_idx
  on public.vinax_trend_snapshots (region, source, chart, observed_at desc);
-- Retention sweep.
create index if not exists vinax_trend_snapshots_fetched_idx
  on public.vinax_trend_snapshots (fetched_at);

-- ----------------------------------------------------------- observations ---
create table if not exists public.vinax_trend_observations (
  id                bigint generated always as identity primary key,
  snapshot_id       bigint not null references public.vinax_trend_snapshots (id) on delete cascade,
  source            text not null,
  source_item_id    text not null,
  url               text,
  region            text not null,
  chart             text not null,
  title             text not null,
  credit            text,
  language_evidence jsonb not null default '{}'::jsonb,
  observed_at       timestamptz not null,
  fetched_at        timestamptz not null,
  expires_at        timestamptz not null,
  source_rank       int not null check (source_rank > 0),
  statistics        jsonb,
  provenance        jsonb not null default '{}'::jsonb,
  constraint vinax_trend_observations_item unique (snapshot_id, source_item_id),
  constraint vinax_trend_observations_rank unique (snapshot_id, source_rank)
);
-- The public read: one snapshot's unexpired items in rank order
-- (the unique (snapshot_id, source_rank) index already serves it).
create index if not exists vinax_trend_observations_expiry_idx
  on public.vinax_trend_observations (snapshot_id, expires_at);
-- The console: the latest observation of an item under review.
create index if not exists vinax_trend_observations_item_idx
  on public.vinax_trend_observations (source, source_item_id, observed_at desc);

-- ---------------------------------------------------------------- matches ---
create table if not exists public.vinax_trend_matches (
  id                 bigint generated always as identity primary key,
  source             text not null,
  source_item_id     text not null,
  catalog_id         text,
  catalog_title      text,
  catalog_artist     text,
  catalog_language   text,
  mapping_confidence real not null default 0 check (mapping_confidence >= 0 and mapping_confidence <= 1),
  method             text not null,
  status             text not null
                     check (status in ('matched', 'review', 'accepted', 'rejected', 'corrected')),
  reason             text,
  candidates         jsonb not null default '[]'::jsonb,
  reviewed_by        text,
  reviewed_at        timestamptz,
  history            jsonb not null default '[]'::jsonb,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  constraint vinax_trend_matches_item unique (source, source_item_id)
);
-- The review queue and the confidence distribution.
create index if not exists vinax_trend_matches_status_idx
  on public.vinax_trend_matches (status, last_seen_at desc);
-- Recent review decisions.
create index if not exists vinax_trend_matches_reviewed_idx
  on public.vinax_trend_matches (reviewed_at desc) where reviewed_at is not null;
-- Retention sweep.
create index if not exists vinax_trend_matches_seen_idx
  on public.vinax_trend_matches (last_seen_at);

-- -------------------------------------------------------------- editorial ---
create table if not exists public.vinax_trend_editorial (
  id           bigint generated always as identity primary key,
  dedupe_key   text not null,
  title        text not null,
  artist       text,
  catalog_id   text,
  region       text not null default 'IN',
  language     text,
  position     int not null default 1 check (position between 1 and 100),
  evidence_url text not null check (evidence_url ~ '^https://'),
  note         text,
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'withdrawn')),
  imported_by  text,
  imported_at  timestamptz not null default now(),
  import_batch text,
  constraint vinax_trend_editorial_dedupe unique (dedupe_key),
  constraint vinax_trend_editorial_window check (expires_at > starts_at)
);
-- The editorial provider's read: active entries of a region inside their window.
create index if not exists vinax_trend_editorial_active_idx
  on public.vinax_trend_editorial (region, status, expires_at);

-- -------------------------------------------------------------- lock down ---
-- Same posture as every other vinax_ table: RLS on, no policies, no grants
-- for the public roles. The Worker's service-role key bypasses RLS.
alter table public.vinax_trend_runs         enable row level security;
alter table public.vinax_trend_snapshots    enable row level security;
alter table public.vinax_trend_observations enable row level security;
alter table public.vinax_trend_matches      enable row level security;
alter table public.vinax_trend_editorial    enable row level security;
revoke all on table public.vinax_trend_runs         from anon, authenticated;
revoke all on table public.vinax_trend_snapshots    from anon, authenticated;
revoke all on table public.vinax_trend_observations from anon, authenticated;
revoke all on table public.vinax_trend_matches      from anon, authenticated;
revoke all on table public.vinax_trend_editorial    from anon, authenticated;

-- Verify (all empty on a fresh project):
select count(*) as runs from public.vinax_trend_runs;
select count(*) as snapshots from public.vinax_trend_snapshots;
select count(*) as matches from public.vinax_trend_matches;
