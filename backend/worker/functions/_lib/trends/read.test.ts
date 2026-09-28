/**
 * The public read: only confident, unexpired matches; every source's status
 * said out loud (ok / stale / unavailable / disabled / not_configured);
 * momentum only from two comparable snapshots and only where the provider's
 * terms allow a derived metric; the exact response shape the app relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRest, type FakeRest } from './fakeRest.testutil';
import { computeMomentum, readPublicTrends } from './read';

const BASE = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', YOUTUBE_API_KEY: 'k' };
const NOW = new Date('2026-09-19T12:00:00Z');
let db: FakeRest;

beforeEach(() => {
  db = createFakeRest();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => db.handle(String(input), init) ?? Promise.resolve(new Response('', { status: 599 })));
});
afterEach(() => vi.unstubAllGlobals());

const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function snapshot(source: string, chart: string, observedHoursAgo: number, ranks: Array<[string, number]>, opts: { expiresInHours?: number } = {}) {
  const at = hoursAgo(observedHoursAgo);
  const s = db.insert('vinax_trend_snapshots', { source, region: 'IN', chart, snapshot_key: `h:${at}`, observed_at: at, fetched_at: at, item_count: ranks.length });
  for (const [id, rank] of ranks) {
    db.insert('vinax_trend_observations', {
      snapshot_id: s.id,
      source,
      source_item_id: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      region: 'IN',
      chart,
      title: `raw ${id}`,
      source_rank: rank,
      observed_at: at,
      fetched_at: at,
      expires_at: new Date(Date.parse(at) + (opts.expiresInHours ?? 72) * 3_600_000).toISOString(),
    });
  }
  return s;
}

function match(source: string, id: string, catalogId: string, status: string, confidence: number, language = 'telugu') {
  db.insert('vinax_trend_matches', { source, source_item_id: id, catalog_id: catalogId, catalog_title: `Song ${catalogId}`, catalog_artist: `Artist ${catalogId}`, catalog_language: language, mapping_confidence: confidence, method: 'title:exact+artist', status, last_seen_at: NOW.toISOString() });
}

function successfulRun(source: string, hours: number) {
  db.insert('vinax_trend_runs', { id: `${source}-${hours}`, source, region: 'IN', ok: true, status: 'ok', started_at: hoursAgo(hours), finished_at: hoursAgo(hours) });
}

describe('computeMomentum', () => {
  const current = [
    { sourceItemId: 'a', sourceRank: 1 },
    { sourceItemId: 'b', sourceRank: 2 },
    { sourceItemId: 'c', sourceRank: 3 },
  ];

  it('one snapshot never implies growth', () => {
    const m = computeMomentum(current, NOW.toISOString(), null);
    expect([...m.values()]).toEqual([
      { momentum: null, newEntry: false },
      { momentum: null, newEntry: false },
      { momentum: null, newEntry: false },
    ]);
  });

  it('two comparable snapshots give rank change and new entries', () => {
    const prev = { observedAt: hoursAgo(12), ranks: new Map([['a', 4], ['b', 2]]) };
    const m = computeMomentum(current, NOW.toISOString(), prev);
    expect(m.get('a')).toEqual({ momentum: { rankDelta: 3, windowHours: 12 }, newEntry: false });
    expect(m.get('b')).toEqual({ momentum: { rankDelta: 0, windowHours: 12 }, newEntry: false });
    expect(m.get('c')).toEqual({ momentum: null, newEntry: true });
  });

  it('snapshots too close together or too far apart are not compared', () => {
    const close = computeMomentum(current, NOW.toISOString(), { observedAt: hoursAgo(2), ranks: new Map([['a', 9]]) });
    const far = computeMomentum(current, NOW.toISOString(), { observedAt: hoursAgo(72), ranks: new Map([['a', 9]]) });
    expect(close.get('a')).toEqual({ momentum: null, newEntry: false });
    expect(far.get('c')).toEqual({ momentum: null, newEntry: false });
  });
});

describe('readPublicTrends', () => {
  it('returns only confident, eligible matches, in the documented shape', async () => {
    snapshot('youtube', 'most-popular-music', 1, [['v1', 1], ['v2', 2], ['v3', 3], ['v4', 4], ['v5', 5]]);
    successfulRun('youtube', 1);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    match('youtube', 'v2', 'c2', 'review', 0.7); // queued for review: never public
    match('youtube', 'v3', 'c3', 'rejected', 0.95);
    match('youtube', 'v4', 'c4', 'corrected', 1);
    match('youtube', 'v5', 'c1', 'accepted', 1); // a second video of the same song: kept once, at the better rank
    const { body } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(body.items.map((i) => [i.catalogId, i.sourceRank])).toEqual([
      ['c1', 1],
      ['c4', 4],
    ]);
    expect(Object.keys(body)).toEqual(['generatedAt', 'sources', 'items']);
    expect(body.items[0]).toEqual({
      catalogId: 'c1',
      title: 'Song c1',
      artist: 'Artist c1',
      language: 'telugu',
      region: 'IN',
      source: 'youtube',
      sourceLabel: 'Public video chart',
      sourceKind: 'public-chart',
      sourceRank: 1,
      sourceUrl: 'https://www.youtube.com/watch?v=v1',
      observedAt: hoursAgo(1),
      expiresAt: new Date(Date.parse(hoursAgo(1)) + 72 * 3_600_000).toISOString(),
      mappingConfidence: 0.92,
      momentum: null,
      newEntry: false,
    });
    expect(body.sources.find((s) => s.id === 'youtube')).toEqual({ id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'ok', lastSuccessAt: hoursAgo(1), region: 'IN' });
  });

  it('labels the short-video source disabled and a keyless video chart not_configured, with no items from either', async () => {
    const { body } = await readPublicTrends({ SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk' }, { region: 'IN', limit: 20, now: NOW });
    const status = Object.fromEntries(body.sources.map((s) => [s.id, s.status]));
    expect(status).toEqual({ youtube: 'not_configured', instagram: 'disabled', web: 'not_configured', editorial: 'unavailable' });
    expect(body.items).toEqual([]);
  });

  it('keeps showing data older than the stale threshold, labelled stale', async () => {
    snapshot('youtube', 'most-popular-music', 20, [['v1', 1]]);
    successfulRun('youtube', 20);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    const { body } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(body.sources.find((s) => s.id === 'youtube')?.status).toBe('stale');
    expect(body.items).toHaveLength(1);
  });

  it('hides expired items but still names the source as stale', async () => {
    snapshot('youtube', 'most-popular-music', 80, [['v1', 1]]);
    successfulRun('youtube', 80);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    const { body } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(body.items).toEqual([]);
    expect(body.sources.find((s) => s.id === 'youtube')).toMatchObject({ status: 'stale', lastSuccessAt: hoursAgo(80) });
  });

  it('a configured source that never succeeded is unavailable', async () => {
    const { body } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(body.sources.find((s) => s.id === 'youtube')?.status).toBe('unavailable');
  });

  it('computes no momentum for the video chart by default, even with two comparable snapshots', async () => {
    snapshot('youtube', 'most-popular-music', 13, [['v1', 5]]);
    snapshot('youtube', 'most-popular-music', 1, [['v1', 1], ['v2', 2]]);
    successfulRun('youtube', 1);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    match('youtube', 'v2', 'c2', 'matched', 0.92);
    const { body } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(body.items.map((i) => [i.momentum, i.newEntry])).toEqual([
      [null, false],
      [null, false],
    ]);
  });

  it('computes rank change and new entries when the owner declares the provider allows it', async () => {
    snapshot('youtube', 'most-popular-music', 13, [['v1', 5]]);
    snapshot('youtube', 'most-popular-music', 1, [['v1', 1], ['v2', 2]]);
    successfulRun('youtube', 1);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    match('youtube', 'v2', 'c2', 'matched', 0.92);
    const { body } = await readPublicTrends({ ...BASE, TRENDS_DERIVED_METRICS_SOURCES: 'youtube' }, { region: 'IN', limit: 20, now: NOW });
    expect(body.items[0]).toMatchObject({ catalogId: 'c1', momentum: { rankDelta: 4, windowHours: 12 }, newEntry: false });
    expect(body.items[1]).toMatchObject({ catalogId: 'c2', momentum: null, newEntry: true });
  });

  it('never compares snapshots from another chart', async () => {
    snapshot('youtube', 'some-other-chart', 13, [['v1', 9]]);
    snapshot('youtube', 'most-popular-music', 1, [['v1', 1]]);
    successfulRun('youtube', 1);
    match('youtube', 'v1', 'c1', 'matched', 0.92);
    const { body } = await readPublicTrends({ ...BASE, TRENDS_DERIVED_METRICS_SOURCES: 'youtube' }, { region: 'IN', limit: 20, now: NOW });
    expect(body.items[0]).toMatchObject({ momentum: null, newEntry: false });
  });

  it('labels editorial entries as editorial and filters by language and source', async () => {
    snapshot('youtube', 'most-popular-music', 1, [['v1', 1]]);
    snapshot('editorial', 'editorial', 1, [['ed-1', 1]], { expiresInHours: 100 });
    successfulRun('youtube', 1);
    successfulRun('editorial', 1);
    match('youtube', 'v1', 'c1', 'matched', 0.92, 'telugu');
    match('editorial', 'ed-1', 'c9', 'matched', 1, 'hindi');
    const all = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(all.body.items.map((i) => [i.source, i.sourceKind, i.sourceLabel])).toEqual([
      ['youtube', 'public-chart', 'Public video chart'],
      ['editorial', 'editorial', 'Editor’s picks'],
    ]);
    const hindi = await readPublicTrends(BASE, { region: 'IN', language: 'hindi', limit: 20, now: NOW });
    expect(hindi.body.items.map((i) => i.catalogId)).toEqual(['c9']);
    const chartOnly = await readPublicTrends(BASE, { region: 'IN', source: 'youtube', limit: 20, now: NOW });
    expect(chartOnly.body.items.map((i) => i.catalogId)).toEqual(['c1']);
  });

  it('reports a failed database read as degraded, never as an empty chart that is fine', async () => {
    db.failing.set('vinax_trend_snapshots', 503);
    const { body, degraded } = await readPublicTrends(BASE, { region: 'IN', limit: 20, now: NOW });
    expect(degraded).toBe(true);
    expect(body.sources.find((s) => s.id === 'youtube')?.status).toBe('unavailable');
  });
});
