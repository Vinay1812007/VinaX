/**
 * GET /api/trends — the public contract the app reads: shape, source
 * statuses, cache headers, CORS and tolerant query parsing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRest, type FakeRest } from '../_lib/trends/fakeRest.testutil';
import { onRequestGet, onRequestOptions, parseTrendsQuery } from './trends';

let db: FakeRest;
beforeEach(() => {
  db = createFakeRest();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => db.handle(String(input), init) ?? Promise.resolve(new Response('', { status: 599 })));
});
afterEach(() => vi.unstubAllGlobals());

const get = (qs: string, env: Record<string, string>) => onRequestGet({ request: new Request(`https://www.example.test/api/trends${qs}`), env });

describe('GET /api/trends', () => {
  it('answers the documented shape with every source and its status, edge-cacheable', async () => {
    const now = new Date();
    const at = new Date(now.getTime() - 3_600_000).toISOString();
    const snap = db.insert('vinax_trend_snapshots', { source: 'youtube', region: 'IN', chart: 'most-popular-music', snapshot_key: 'h:x', observed_at: at, fetched_at: at, item_count: 1 });
    db.insert('vinax_trend_observations', { snapshot_id: snap.id, source: 'youtube', source_item_id: 'AbCdEfGhI01', url: 'https://www.youtube.com/watch?v=AbCdEfGhI01', source_rank: 1, observed_at: at, expires_at: new Date(now.getTime() + 3_600_000).toISOString() });
    db.insert('vinax_trend_matches', { source: 'youtube', source_item_id: 'AbCdEfGhI01', catalog_id: 'c1', catalog_title: 'Chuttamalle', catalog_artist: 'Shilpa Rao', catalog_language: 'telugu', mapping_confidence: 0.98, status: 'matched' });
    db.insert('vinax_trend_runs', { id: 'r1', source: 'youtube', region: 'IN', ok: true, status: 'ok', started_at: at, finished_at: at });

    const res = await get('?region=in&limit=5', { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', YOUTUBE_API_KEY: 'k' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { generatedAt: string; sources: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(['generatedAt', 'sources', 'items']);
    expect(body.sources.map((s) => [s.id, s.kind, s.status])).toEqual([
      ['youtube', 'public-chart', 'ok'],
      ['instagram', 'public-chart', 'disabled'],
      ['editorial', 'editorial', 'unavailable'],
    ]);
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ['catalogId', 'title', 'artist', 'language', 'region', 'source', 'sourceLabel', 'sourceKind', 'sourceRank', 'sourceUrl', 'observedAt', 'expiresAt', 'mappingConfidence', 'momentum', 'newEntry'].sort(),
    );
    expect(body.items[0]).toMatchObject({ catalogId: 'c1', region: 'IN', sourceLabel: 'Public video chart', momentum: null });
  });

  it('without a key or a database says so instead of inventing data', async () => {
    const res = await get('', {});
    const body = (await res.json()) as { sources: Array<{ id: string; status: string }>; items: unknown[] };
    expect(body.items).toEqual([]);
    expect(Object.fromEntries(body.sources.map((s) => [s.id, s.status]))).toEqual({ youtube: 'not_configured', instagram: 'disabled', editorial: 'not_configured' });
    // Degraded answers are cached briefly.
    expect(res.headers.get('cache-control')).toBe('public, max-age=15, s-maxage=30');
  });

  it('answers CORS preflight', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});

describe('parseTrendsQuery', () => {
  const q = (s: string, env: Record<string, string> = {}) => parseTrendsQuery(new URL(`https://x.test/api/trends${s}`), env);
  it('falls back to safe defaults for anything unknown', () => {
    expect(q('')).toEqual({ region: 'IN', language: null, source: null, limit: 20 });
    expect(q('?region=zzz&language=<b>&source=nope&limit=900')).toEqual({ region: 'IN', language: null, source: null, limit: 50 });
    expect(q('?region=us&language=Telugu&source=editorial&limit=0', { TRENDS_REGIONS: 'IN,US' })).toEqual({ region: 'US', language: 'telugu', source: 'editorial', limit: 1 });
    expect(q('', { TRENDS_REGIONS: 'US,IN' }).region).toBe('US');
  });

  it('answers a region that is not ingested with the first ingested one, which every line then names', () => {
    expect(q('?region=us').region).toBe('IN');
    expect(q('?region=gb', { TRENDS_REGIONS: 'US,IN' }).region).toBe('US');
  });
});
