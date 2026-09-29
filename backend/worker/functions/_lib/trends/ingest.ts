/**
 * Scheduled ingestion: for every provider × region, fetch (with bounded
 * retries), store one snapshot of timestamped observations, match NEW items
 * to catalogue recordings within a per-run budget, and record the run.
 *
 * Idempotency. Every snapshot has a key, unique per source/region/chart:
 *   hourly  — `h:<UTC hour>`: re-running the job inside the same hour
 *             inserts nothing (the snapshot insert is ignored as a duplicate,
 *             and observations are unique per snapshot and item);
 *   content — `c:<hash of the items>`: an unchanged list inserts nothing.
 * Matches are unique per source item, so a known video is never re-matched;
 * its `last_seen_at` is refreshed instead.
 *
 * Retention. The video platform lets data read without user credentials be
 * kept for at most 30 calendar days before it is deleted or refreshed.
 * Snapshots (and, by cascade, their observations) are deleted
 * TRENDS_POLICY.retentionDays after they were fetched, and a match that has
 * not been seen again for that long is deleted too.
 *
 * Metadata only: nothing here downloads, stores or extracts audio.
 */
import { sbDelete, sbInsert, sbInsertIgnore, sbSelectResult, sbUpdate, supabaseConfigured } from '../supabase';
import { lookupCatalogSong, searchCatalogSongs } from './catalog';
import { matchRawItem, type CatalogLookup, type CatalogSearch, type MatchDecision } from './matcher';
import { PROVIDERS, TRENDS_POLICY } from './registry';
import { RetryFailure, withRetries } from './retry';
import { configuredRegions, REGION_RE, type RawTrendItem, type TrendProvider, type TrendsEnv } from './types';

export interface IngestRequest {
  /** Provider ids to run; all when omitted. */
  sources?: string[];
  /** Regions to run; TRENDS_REGIONS when omitted. */
  regions?: string[];
  trigger: 'cron' | 'admin';
  /** Delete data past its retention window (the scheduled job does this). */
  prune?: boolean;
}

export interface IngestDeps {
  now?: () => Date;
  search?: CatalogSearch;
  lookup?: CatalogLookup;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  matchBudget?: number;
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
  providers?: readonly TrendProvider[];
  newId?: () => string;
}

export interface RunSummary {
  source: string;
  region: string;
  status: 'ok' | 'error' | 'skipped';
  reason: string | null;
  attempts: number;
  fetched: number;
  inserted: number;
  duplicateSnapshot: boolean;
  matched: number;
  review: number;
  /** New items whose matching was postponed (budget spent or catalogue unavailable). */
  deferred: number;
  quotaUnits: number;
  snapshotKey: string | null;
}

export interface IngestResult {
  ok: boolean;
  runs: RunSummary[];
  /** Providers not attempted because they are disabled or not configured. */
  notRun: Array<{ source: string; status: string; reason: string | null }>;
  pruned: Record<string, boolean> | null;
}

const MATCH_CONCURRENCY = 3;

function hoursLater(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/** PostgREST `in.(…)` list with every value quoted. */
export function inList(values: string[]): string {
  return `(${values.map((v) => `"${String(v).replace(/["\\]/g, '')}"`).join(',')})`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The snapshot key for a run that started at `at` (see the idempotency note above). */
export async function snapshotKey(provider: TrendProvider, items: RawTrendItem[], at: Date): Promise<string> {
  if (provider.snapshotPolicy === 'hourly') return `h:${at.toISOString().slice(0, 13)}`;
  const content = items.map((i) => [i.sourceItemId, i.sourceRank, i.title, i.credit, i.catalogIdHint ?? '', i.expiresAt ?? '', i.sourceUrl ?? ''].join('\u241f')).join('\u241e');
  return `c:${(await sha256Hex(content)).slice(0, 32)}`;
}

/** Quota units a source has spent since 00:00 UTC, or null when the run log cannot be read. */
export async function quotaUsedToday(env: TrendsEnv, source: string, now: Date): Promise<number | null> {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const res = await sbSelectResult<{ quota_units: number | null }>(env, 'vinax_trend_runs', `select=quota_units&source=eq.${encodeURIComponent(source)}&started_at=gte.${encodeURIComponent(midnight)}&limit=1000`);
  if (!res.ok) return null;
  return res.rows.reduce((n, r) => n + (Number(r.quota_units) || 0), 0);
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function matchRow(item: RawTrendItem, d: MatchDecision, nowIso: string): Record<string, unknown> {
  return {
    source: item.source,
    source_item_id: item.sourceItemId,
    catalog_id: d.catalogId,
    catalog_title: d.catalogTitle,
    catalog_artist: d.catalogArtist,
    catalog_language: d.catalogLanguage,
    mapping_confidence: d.confidence,
    method: d.method,
    status: d.status,
    reason: d.reason,
    candidates: d.candidates.map((c) => ({ id: c.id, title: c.title, artist: c.artist, album: c.album, language: c.language, confidence: c.confidence, method: c.method, reason: c.reason })),
    history: [{ at: nowIso, by: 'matcher', action: d.status === 'matched' ? 'auto-match' : 'queued-for-review', catalogId: d.catalogId, confidence: d.confidence, method: d.method, reason: d.reason }],
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  };
}

interface Ctx {
  env: TrendsEnv;
  deps: IngestDeps;
  now: () => Date;
  budget: { remaining: number };
  trigger: IngestRequest['trigger'];
}

async function finishRun(env: TrendsEnv, id: string, s: RunSummary, now: Date): Promise<void> {
  await sbUpdate(env, 'vinax_trend_runs', `id=eq.${encodeURIComponent(id)}`, {
    finished_at: now.toISOString(),
    ok: s.status === 'ok',
    status: s.status,
    error: s.reason,
    attempts: s.attempts,
    items_fetched: s.fetched,
    items_inserted: s.inserted,
    matched: s.matched,
    queued_for_review: s.review,
    quota_units: s.quotaUnits,
    snapshot_key: s.snapshotKey,
    duplicate_snapshot: s.duplicateSnapshot,
  });
}

async function runOne(ctx: Ctx, provider: TrendProvider, region: string): Promise<RunSummary> {
  const { env, deps } = ctx;
  const summary: RunSummary = { source: provider.id, region, status: 'ok', reason: null, attempts: 0, fetched: 0, inserted: 0, duplicateSnapshot: false, matched: 0, review: 0, deferred: 0, quotaUnits: 0, snapshotKey: null };
  const started = ctx.now();

  // Quota guard: a metered provider runs only when a full run (every retry) fits today's ceiling.
  const budget = provider.dailyUnitBudget(env);
  if (budget !== null) {
    const used = await quotaUsedToday(env, provider.id, started);
    if (used === null) return { ...summary, status: 'skipped', reason: 'quota_unknown' };
    if (used + provider.maxUnitsPerRun(env) > budget) {
      summary.status = 'skipped';
      summary.reason = 'quota_budget';
    }
  }

  const runId = deps.newId ? deps.newId() : crypto.randomUUID();
  const created = await sbInsert(env, 'vinax_trend_runs', { id: runId, source: provider.id, region, trigger: ctx.trigger, started_at: started.toISOString(), status: summary.status === 'skipped' ? 'skipped' : 'running' });
  if (!created) return { ...summary, status: 'error', reason: 'db_unavailable' };
  if (summary.status === 'skipped') {
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }

  // An hourly snapshot's key is known before fetching: a re-run inside the hour spends no quota at all.
  if (provider.snapshotPolicy === 'hourly') {
    const key = await snapshotKey(provider, [], started);
    const seen = await sbSelectResult<{ id: number }>(env, 'vinax_trend_snapshots', `select=id&source=eq.${encodeURIComponent(provider.id)}&region=eq.${encodeURIComponent(region)}&chart=eq.${encodeURIComponent(provider.chart)}&snapshot_key=eq.${encodeURIComponent(key)}&limit=1`);
    if (seen.ok && seen.rows.length) {
      summary.snapshotKey = key;
      summary.duplicateSnapshot = true;
      await finishRun(env, runId, summary, ctx.now());
      return summary;
    }
  }

  const meter = { units: 0 };
  let items: RawTrendItem[];
  try {
    const out = await withRetries((signal) => provider.fetch(env, { region, signal, meter, now: started }), {
      attempts: 3,
      sleep: deps.sleep,
      random: deps.random,
      signal: deps.signal,
      attemptTimeoutMs: deps.attemptTimeoutMs ?? 8_000,
    });
    items = out.value;
    summary.attempts = out.attempts;
  } catch (err) {
    const f = err instanceof RetryFailure ? err : null;
    summary.status = 'error';
    summary.attempts = f?.attempts ?? 1;
    summary.reason = f ? `${f.last.code}: ${f.last.message}`.slice(0, 300) : 'fetch_failed';
    summary.quotaUnits = meter.units;
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }
  summary.quotaUnits = meter.units;
  summary.fetched = items.length;

  // A public chart with no entries is a broken answer, not an empty chart: keep the previous snapshot.
  if (provider.kind === 'public-chart' && items.length === 0) {
    summary.status = 'error';
    summary.reason = 'empty_chart: the source answered with no entries';
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }

  const fetchedAt = ctx.now();
  const key = await snapshotKey(provider, items, started);
  summary.snapshotKey = key;
  const observedAt = items.reduce((min, i) => (i.observedAt < min ? i.observedAt : min), fetchedAt.toISOString());
  const snap = await sbInsertIgnore<{ id: number }>(
    env,
    'vinax_trend_snapshots',
    { source: provider.id, region, chart: provider.chart, snapshot_key: key, observed_at: observedAt, fetched_at: fetchedAt.toISOString(), item_count: items.length, run_id: runId },
    'source,region,chart,snapshot_key',
  );
  if (snap === null) {
    summary.status = 'error';
    summary.reason = 'db_write_failed: snapshot';
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }
  if (snap.length === 0) {
    // Same source/region/chart/snapshot already stored: nothing new to insert.
    summary.duplicateSnapshot = true;
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }
  const snapshotId = snap[0].id;

  const rows = items.map((i) => ({
    snapshot_id: snapshotId,
    source: i.source,
    source_item_id: i.sourceItemId,
    url: i.sourceUrl,
    region: i.region,
    chart: provider.chart,
    title: i.title,
    credit: i.credit,
    language_evidence: i.languageEvidence,
    observed_at: i.observedAt,
    fetched_at: fetchedAt.toISOString(),
    expires_at: provider.displayHours !== null ? hoursLater(i.observedAt, provider.displayHours) : i.expiresAt ?? hoursLater(i.observedAt, 24),
    source_rank: i.sourceRank,
    statistics: i.statistics,
    provenance: i.provenance,
  }));
  const inserted = await sbInsertIgnore<{ id: number }>(env, 'vinax_trend_observations', rows, 'snapshot_id,source_item_id');
  if (inserted === null) {
    // Never leave an empty snapshot behind: it would read as "the chart is empty".
    await sbDelete(env, 'vinax_trend_snapshots', `id=eq.${snapshotId}`);
    summary.status = 'error';
    summary.reason = 'db_write_failed: observations';
    await finishRun(env, runId, summary, ctx.now());
    return summary;
  }
  summary.inserted = inserted.length;

  await matchNewItems(ctx, provider, items, summary);
  await finishRun(env, runId, summary, ctx.now());
  return summary;
}

async function matchNewItems(ctx: Ctx, provider: TrendProvider, items: RawTrendItem[], summary: RunSummary): Promise<void> {
  const { env } = ctx;
  if (!items.length) return;
  const ids = [...new Set(items.map((i) => i.sourceItemId))];
  const existing = await sbSelectResult<{ source_item_id: string }>(env, 'vinax_trend_matches', `select=source_item_id&source=eq.${encodeURIComponent(provider.id)}&source_item_id=in.${encodeURIComponent(inList(ids))}&limit=${ids.length}`);
  if (!existing.ok) {
    summary.deferred = ids.length;
    summary.reason = `match_read_failed: ${existing.error}`;
    return;
  }
  const known = new Set(existing.rows.map((r) => r.source_item_id));
  const nowIso = ctx.now().toISOString();
  if (known.size) {
    // Seen again: refresh, so the retention clock restarts for a mapping that is still in use.
    await sbUpdate(env, 'vinax_trend_matches', `source=eq.${encodeURIComponent(provider.id)}&source_item_id=in.${encodeURIComponent(inList([...known]))}`, { last_seen_at: nowIso });
  }
  const fresh = items.filter((i, idx) => !known.has(i.sourceItemId) && items.findIndex((j) => j.sourceItemId === i.sourceItemId) === idx);
  const search = ctx.deps.search ?? searchCatalogSongs;
  const lookup = ctx.deps.lookup ?? lookupCatalogSong;
  const decisions = await mapLimited(fresh, MATCH_CONCURRENCY, (item) => matchRawItem(item, { search, lookup, budget: ctx.budget }));
  const newRows: Record<string, unknown>[] = [];
  decisions.forEach((d, i) => {
    if (!d) {
      summary.deferred += 1;
      return;
    }
    if (d.status === 'matched') summary.matched += 1;
    else summary.review += 1;
    newRows.push(matchRow(fresh[i], d, nowIso));
  });
  if (newRows.length) {
    const ok = await sbInsertIgnore(env, 'vinax_trend_matches', newRows, 'source,source_item_id');
    if (ok === null) {
      summary.deferred += newRows.length;
      summary.matched = 0;
      summary.review = 0;
      summary.reason = 'db_write_failed: matches';
    }
  }
}

/** Delete what is past its retention window. Each entry says whether that delete succeeded. */
export async function pruneExpired(env: TrendsEnv, now: Date): Promise<Record<string, boolean>> {
  const days = (n: number): string => encodeURIComponent(new Date(now.getTime() - n * 86_400_000).toISOString());
  const [snapshots, matches, runs, editorial] = await Promise.all([
    sbDelete(env, 'vinax_trend_snapshots', `fetched_at=lt.${days(TRENDS_POLICY.retentionDays)}`),
    sbDelete(env, 'vinax_trend_matches', `last_seen_at=lt.${days(TRENDS_POLICY.retentionDays)}`),
    sbDelete(env, 'vinax_trend_runs', `started_at=lt.${days(TRENDS_POLICY.operationalRetentionDays)}`),
    sbDelete(env, 'vinax_trend_editorial', `expires_at=lt.${days(TRENDS_POLICY.operationalRetentionDays)}`),
  ]);
  return { snapshots, matches, runs, editorial };
}

export async function runIngest(env: TrendsEnv, req: IngestRequest, deps: IngestDeps = {}): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const providers = (deps.providers ?? PROVIDERS).filter((p) => !req.sources?.length || req.sources.includes(p.id));
  const regions = req.regions?.length ? req.regions.filter((r) => REGION_RE.test(r)) : configuredRegions(env);
  const ctx: Ctx = { env, deps, now, budget: { remaining: deps.matchBudget ?? TRENDS_POLICY.matchBudgetPerRun }, trigger: req.trigger };
  const result: IngestResult = { ok: true, runs: [], notRun: [], pruned: null };
  if (!supabaseConfigured(env)) return { ...result, ok: false, notRun: providers.map((p) => ({ source: p.id, status: 'unavailable', reason: 'db_not_configured' })) };

  for (const provider of providers) {
    const status = provider.status(env);
    if (status !== 'ok') {
      result.notRun.push({ source: provider.id, status, reason: provider.statusReason(env) });
      continue;
    }
    for (const region of regions) {
      if (deps.signal?.aborted) break;
      result.runs.push(await runOne(ctx, provider, region));
    }
  }
  if (req.prune) result.pruned = await pruneExpired(env, now());
  result.ok = result.runs.every((r) => r.status !== 'error');
  return result;
}
