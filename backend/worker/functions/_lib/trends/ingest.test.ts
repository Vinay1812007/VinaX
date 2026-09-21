/**
 * Scheduled ingestion against an in-memory copy of the trend tables that
 * enforces the migration's unique keys. Pins: re-running a job for the same
 * source/region/snapshot inserts nothing (and spends no quota); a known item
 * is never re-matched; retries are bounded and metered; the daily quota
 * ceiling is respected; a catalogue outage defers matching; broken answers
 * never replace a good snapshot; retention deletes what is past its window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRest, type FakeRest } from './fakeRest.testutil';
import { runIngest, type IngestDeps } from './ingest';
import type { CatalogCandidate } from './matcher';
import { TrendFetchError, type RawTrendItem, type TrendProvider } from './types';
import { videoChartProvider } from './videoChart';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', YOUTUBE_API_KEY: 'k', TRENDS_REGIONS: 'IN' };
let db: FakeRest;
let external: (url: string, init?: RequestInit) => Promise<Response> | null;

beforeEach(() => {
  db = createFakeRest();
  external = () => null;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return db.handle(url, init) ?? external(url, init) ?? Promise.resolve(new Response('not stubbed', { status: 599 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

const raw = (id: string, rank: number, title: string, over: Partial<RawTrendItem> = {}): RawTrendItem => ({
  source: 'fake',
  sourceItemId: id,
  sourceUrl: `https://example.test/${id}`,
  title,
  credit: 'Label',
  region: 'IN',
  sourceRank: rank,
  observedAt: '2026-09-19T06:00:00.000Z',
  languageEvidence: {},
  statistics: { viewCount: 10 },
  provenance: { test: true },
  ...over,
});

const CATALOG: CatalogCandidate[] = [
  { id: 'c1', title: 'Chuttamalle (From "Devara Part 1")', primaryArtists: ['Shilpa Rao'], featuredArtists: [], credits: ['Anirudh Ravichander'], album: 'Devara Part 1', language: 'telugu', year: 2024 },
];

function fakeProvider(fetchImpl: TrendProvider['fetch'], over: Partial<TrendProvider> = {}): TrendProvider {
  return {
    id: 'fake',
    kind: 'public-chart',
    chart: 'fake-chart',
    snapshotPolicy: 'hourly',
    displayHours: 72,
    label: () => 'Fake chart',
    status: () => 'ok',
    statusReason: () => null,
    maxUnitsPerRun: () => 3,
    dailyUnitBudget: () => 50,
    derivedMetricsAllowed: () => false,
    fetch: fetchImpl,
    ...over,
  };
}

const ITEMS = [raw('v1', 1, 'Chuttamalle - Lyrical | Devara Part - 1 | Shilpa Rao'), raw('v2', 2, 'Devara Jukebox | All Songs'), raw('v3', 3, 'Totally Unknown | Nobody')];

function deps(provider: TrendProvider, at: string, over: Partial<IngestDeps> = {}): IngestDeps {
  let n = 0;
  return {
    providers: [provider],
    now: () => new Date(at),
    search: vi.fn(async () => CATALOG),
    lookup: vi.fn(async () => null),
    sleep: async () => undefined,
    random: () => 0,
    newId: () => `run-${at}-${++n}`,
    ...over,
  };
}

const metered = (items: RawTrendItem[]): TrendProvider['fetch'] =>
  vi.fn(async (_env, opts) => {
    if (opts.meter) opts.meter.units += 1;
    return items;
  });

describe('runIngest', () => {
  it('stores one snapshot of observations, matches new items and records the run', async () => {
    const provider = fakeProvider(metered(ITEMS));
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z'));
    expect(out.ok).toBe(true);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]).toMatchObject({ source: 'fake', region: 'IN', status: 'ok', fetched: 3, inserted: 3, matched: 1, review: 2, quotaUnits: 1, attempts: 1, snapshotKey: 'h:2026-09-19T06' });
    expect(db.tables.vinax_trend_snapshots).toHaveLength(1);
    expect(db.tables.vinax_trend_observations.map((o) => o.source_item_id)).toEqual(['v1', 'v2', 'v3']);
    const matches = db.tables.vinax_trend_matches;
    expect(matches.find((m) => m.source_item_id === 'v1')).toMatchObject({ status: 'matched', catalog_id: 'c1' });
    expect(matches.find((m) => m.source_item_id === 'v2')).toMatchObject({ status: 'review', reason: 'not_a_song' });
    expect(matches.find((m) => m.source_item_id === 'v3')).toMatchObject({ status: 'review' });
    const run = db.tables.vinax_trend_runs[0];
    expect(run).toMatchObject({ ok: true, status: 'ok', quota_units: 1, items_fetched: 3, items_inserted: 3, matched: 1, queued_for_review: 2 });
    expect(run.finished_at).toBeTruthy();
    // Observations keep the source id and link; the catalogue id lives only on the match.
    expect(db.tables.vinax_trend_observations[0]).toMatchObject({ source_item_id: 'v1', url: 'https://example.test/v1', source_rank: 1 });
    expect(db.tables.vinax_trend_observations[0]).not.toHaveProperty('catalog_id');
  });

  it('re-running inside the same hour inserts nothing and spends no quota', async () => {
    const fetchSpy = metered(ITEMS);
    const provider = fakeProvider(fetchSpy);
    await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z'));
    const again = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:40:00Z'));
    expect(again.runs[0]).toMatchObject({ status: 'ok', duplicateSnapshot: true, inserted: 0, quotaUnits: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db.tables.vinax_trend_snapshots).toHaveLength(1);
    expect(db.tables.vinax_trend_observations).toHaveLength(3);
    expect(db.tables.vinax_trend_matches).toHaveLength(3);
  });

  it('a content-keyed source inserts nothing when its list has not changed', async () => {
    const list = [raw('ed-1', 1, 'Chuttamalle', { source: 'fake', catalogIdHint: null, artistHint: 'Shilpa Rao', expiresAt: '2026-10-01T00:00:00.000Z' })];
    const provider = fakeProvider(vi.fn(async () => list), { kind: 'editorial', snapshotPolicy: 'content', displayHours: null, dailyUnitBudget: () => null, maxUnitsPerRun: () => 0 });
    await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z'));
    const same = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T12:05:00Z'));
    expect(same.runs[0]).toMatchObject({ duplicateSnapshot: true, inserted: 0 });
    list.push(raw('ed-2', 2, 'Monica', { artistHint: 'Sublahshini', expiresAt: '2026-10-01T00:00:00.000Z' }));
    const changed = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T12:10:00Z'));
    expect(changed.runs[0]).toMatchObject({ duplicateSnapshot: false, inserted: 2 });
    expect(db.tables.vinax_trend_snapshots).toHaveLength(2);
    // An editorial observation expires with its entry, not after a chart window.
    expect(db.tables.vinax_trend_observations[0].expires_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('a later snapshot stores new observations but never re-matches a known item', async () => {
    const provider = fakeProvider(metered(ITEMS));
    await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z'));
    const d = deps(provider, '2026-09-19T12:05:00Z');
    const later = await runIngest(ENV, { trigger: 'cron' }, d);
    expect(later.runs[0]).toMatchObject({ inserted: 3, matched: 0, review: 0, duplicateSnapshot: false });
    expect(d.search).not.toHaveBeenCalled();
    expect(db.tables.vinax_trend_snapshots).toHaveLength(2);
    expect(db.tables.vinax_trend_matches).toHaveLength(3);
    expect(db.tables.vinax_trend_matches.every((m) => m.last_seen_at === '2026-09-19T12:05:00.000Z')).toBe(true);
  });

  it('retries a failing provider with backoff, meters every attempt, and records the attempts', async () => {
    let calls = 0;
    const provider = fakeProvider(async (_env, opts) => {
      if (opts.meter) opts.meter.units += 1;
      calls++;
      if (calls < 3) throw new TrendFetchError('http_503', 'down', { retryable: true, httpStatus: 503 });
      return ITEMS;
    });
    const sleep = vi.fn(async () => undefined);
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z', { sleep, random: () => 0.5 }));
    expect(out.runs[0]).toMatchObject({ status: 'ok', attempts: 3, quotaUnits: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(db.tables.vinax_trend_runs[0]).toMatchObject({ attempts: 3, quota_units: 3 });
  });

  it('a provider that times out on every attempt fails the run and leaves no snapshot', async () => {
    const provider = fakeProvider(() => new Promise<RawTrendItem[]>(() => undefined));
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(provider, '2026-09-19T06:05:00Z', { attemptTimeoutMs: 10 }));
    expect(out.ok).toBe(false);
    expect(out.runs[0]).toMatchObject({ status: 'error', attempts: 3 });
    expect(out.runs[0].reason).toMatch(/^timeout/);
    expect(db.tables.vinax_trend_snapshots ?? []).toHaveLength(0);
    expect(db.tables.vinax_trend_runs[0]).toMatchObject({ ok: false, status: 'error' });
  });

  it('a final provider error is not retried', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TrendFetchError('quotaExceeded', 'quota', { retryable: false, httpStatus: 403 });
    });
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(fetchSpy), '2026-09-19T06:05:00Z'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out.runs[0]).toMatchObject({ status: 'error', attempts: 1 });
    expect(out.runs[0].reason).toMatch(/^quotaExceeded/);
  });

  it('skips a metered provider when a full run would pass today’s quota ceiling', async () => {
    db.insert('vinax_trend_runs', { id: 'old', source: 'fake', region: 'IN', started_at: '2026-09-19T01:00:00.000Z', quota_units: 48, ok: true, status: 'ok' });
    const fetchSpy = metered(ITEMS);
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(fetchSpy), '2026-09-19T06:05:00Z'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.runs[0]).toMatchObject({ status: 'skipped', reason: 'quota_budget' });
    expect(out.ok).toBe(true);
  });

  it('yesterday’s usage does not count against today', async () => {
    db.insert('vinax_trend_runs', { id: 'old', source: 'fake', region: 'IN', started_at: '2026-09-18T23:00:00.000Z', quota_units: 48, ok: true, status: 'ok' });
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(metered(ITEMS)), '2026-09-19T06:05:00Z'));
    expect(out.runs[0].status).toBe('ok');
  });

  it('a public chart that answers with no entries keeps the previous snapshot', async () => {
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(async () => []), '2026-09-19T06:05:00Z'));
    expect(out.runs[0]).toMatchObject({ status: 'error' });
    expect(out.runs[0].reason).toMatch(/^empty_chart/);
    expect(db.tables.vinax_trend_snapshots ?? []).toHaveLength(0);
  });

  it('a catalogue outage defers matching: no match rows, retried next run', async () => {
    const d = deps(fakeProvider(metered([ITEMS[0]])), '2026-09-19T06:05:00Z', {
      search: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    const out = await runIngest(ENV, { trigger: 'cron' }, d);
    expect(out.runs[0]).toMatchObject({ status: 'ok', deferred: 1, matched: 0 });
    expect(db.tables.vinax_trend_matches ?? []).toHaveLength(0);
    const next = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(metered([ITEMS[0]])), '2026-09-19T12:05:00Z'));
    expect(next.runs[0]).toMatchObject({ matched: 1, deferred: 0 });
  });

  it('shares one matching budget across the run', async () => {
    const many = Array.from({ length: 6 }, (_, i) => raw(`m${i}`, i + 1, `Song Number ${i} | Film ${i} | Singer ${i}`));
    const search = vi.fn(async () => [] as CatalogCandidate[]);
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(metered(many)), '2026-09-19T06:05:00Z', { search, matchBudget: 4 }));
    expect(search).toHaveBeenCalledTimes(4);
    expect(out.runs[0].deferred).toBeGreaterThan(0);
  });

  it('does not run disabled or unconfigured providers and says why', async () => {
    const off = fakeProvider(vi.fn(), { status: () => 'not_configured', statusReason: () => 'no key' });
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(off, '2026-09-19T06:05:00Z'));
    expect(out.runs).toHaveLength(0);
    expect(out.notRun).toEqual([{ source: 'fake', status: 'not_configured', reason: 'no key' }]);
    expect(db.tables.vinax_trend_runs ?? []).toHaveLength(0);
  });

  it('without a database nothing runs', async () => {
    const fetchSpy = vi.fn();
    const out = await runIngest({ YOUTUBE_API_KEY: 'k' }, { trigger: 'cron' }, deps(fakeProvider(fetchSpy), '2026-09-19T06:05:00Z'));
    expect(out.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('removes a snapshot whose observations could not be written', async () => {
    db.failing.set('vinax_trend_observations', 500);
    const out = await runIngest(ENV, { trigger: 'cron' }, deps(fakeProvider(metered(ITEMS)), '2026-09-19T06:05:00Z'));
    expect(out.runs[0]).toMatchObject({ status: 'error', reason: 'db_write_failed: observations' });
    expect(db.tables.vinax_trend_snapshots).toHaveLength(0);
  });

  it('prunes snapshots, observations and unrefreshed matches past the retention window', async () => {
    const old = db.insert('vinax_trend_snapshots', { source: 'fake', region: 'IN', chart: 'fake-chart', snapshot_key: 'h:old', observed_at: '2026-08-01T00:00:00.000Z', fetched_at: '2026-08-01T00:00:00.000Z', item_count: 1 });
    db.insert('vinax_trend_observations', { snapshot_id: old.id, source: 'fake', source_item_id: 'gone', source_rank: 1 });
    db.insert('vinax_trend_matches', { source: 'fake', source_item_id: 'gone', status: 'matched', last_seen_at: '2026-08-01T00:00:00.000Z' });
    db.insert('vinax_trend_matches', { source: 'fake', source_item_id: 'kept', status: 'matched', last_seen_at: '2026-09-15T00:00:00.000Z' });
    const out = await runIngest(ENV, { trigger: 'cron', prune: true }, deps(fakeProvider(metered(ITEMS)), '2026-09-19T06:05:00Z'));
    expect(out.pruned).toMatchObject({ snapshots: true, matches: true });
    expect(db.tables.vinax_trend_snapshots.map((s) => s.snapshot_key)).toEqual(['h:2026-09-19T06']);
    expect(db.tables.vinax_trend_observations.some((o) => o.source_item_id === 'gone')).toBe(false);
    expect(db.tables.vinax_trend_matches.some((m) => m.source_item_id === 'gone')).toBe(false);
    expect(db.tables.vinax_trend_matches.some((m) => m.source_item_id === 'kept')).toBe(true);
  });

  it('ingests the video chart end to end from a recorded response', async () => {
    external = (url) =>
      url.startsWith('https://www.googleapis.com/')
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                kind: 'youtube#videoListResponse',
                items: [{ kind: 'youtube#video', id: 'AbCdEfGhI01', snippet: { title: 'Chuttamalle - Lyrical | Devara Part - 1 | Anirudh | Shilpa Rao', channelTitle: 'Label', categoryId: '10' }, statistics: { viewCount: '5' } }],
              }),
              { status: 200 },
            ),
          )
        : null;
    const out = await runIngest(ENV, { trigger: 'cron' }, { providers: [videoChartProvider], now: () => new Date('2026-09-19T06:05:00Z'), search: vi.fn(async () => CATALOG), sleep: async () => undefined });
    expect(out.runs[0]).toMatchObject({ source: 'youtube', status: 'ok', fetched: 1, matched: 1, quotaUnits: 1 });
    expect(db.tables.vinax_trend_observations[0]).toMatchObject({ source: 'youtube', source_item_id: 'AbCdEfGhI01', url: 'https://www.youtube.com/watch?v=AbCdEfGhI01', expires_at: '2026-09-22T06:05:00.000Z' });
  });
});
