-- ============================================================================
-- VinaX — SEO URL corpus (the "infinite catalog" index feed)
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- One row per indexable catalog URL (song / album / artist / playlist).
-- Fed continuously by three producers:
--   1. /api/cron/seo-crawl  — the catalog walker (hourly GitHub Action):
--      expands artists page-by-page into their full song + album lists.
--   2. Entity page renders  — every /song|album|artist|playlist/:id render
--      harvests the entity and everything it links to.
--   3. Legacy live-search sitemaps — each rebuild contributes its finds.
-- Consumed by /sitemaps/<type>-<n>.xml (10k URLs per page, no upper bound)
-- via the /sitemap.xml index. Contains only PUBLIC catalog metadata — no
-- user or device data of any kind.
-- ============================================================================
create table if not exists public.vinax_seo_urls (
  key         text primary key,               -- '<type>:<entity_id>'
  type        text not null,                  -- song | album | artist | playlist
  entity_id   text not null,
  slug        text not null,                  -- url-safe name part
  title       text,
  lang        text,
  added_at    timestamptz not null default now(),
  lastmod     timestamptz not null default now(),
  -- Frontier bookkeeping (artists/albums only): when this entity's own
  -- song/album lists were last expanded, and which page the walk is on.
  expanded_at timestamptz,
  expand_page int not null default 0
);

-- Sitemap pagination reads: stable (type, added_at, key) ordering.
create index if not exists vinax_seo_urls_type_added
  on public.vinax_seo_urls (type, added_at, key);

-- Frontier reads: oldest-expanded (nulls = never) artists first.
create index if not exists vinax_seo_urls_frontier
  on public.vinax_seo_urls (type, expanded_at nulls first);

-- Same deny-all posture as every other vinax table: the service role (which
-- bypasses RLS) is the only reader/writer; the public anon key gets nothing.
alter table public.vinax_seo_urls enable row level security;
alter table public.vinax_seo_urls force row level security;
revoke all on table public.vinax_seo_urls from anon, authenticated;

-- Verify.
select count(*) as seo_urls from public.vinax_seo_urls;
