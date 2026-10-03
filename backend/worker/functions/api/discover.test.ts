import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverMusic = vi.fn();
const cachedDiscovery = vi.fn();
vi.mock('../_lib/discovery', async (importActual) => {
  const actual = await importActual<typeof import('../_lib/discovery')>();
  return {
    ...actual,
    discoverMusic: (...a: unknown[]) => discoverMusic(...a),
    cachedDiscovery: (...a: unknown[]) => cachedDiscovery(...a),
    discoveryHealth: () => ({ configured: true, breakerOpen: false, breakerRestMs: 0, consecutiveFailures: 0, quotaUsed: 1, quotaPerHour: 12, cached: 1 }),
  };
});

import { onRequestGet, onRequestPost, parseDiscoverQuery, type DiscoverBody } from './discover';

const ITEM = {
  catalogId: 'cat-1',
  title: 'Nee Kosam',
  artist: 'Sai Kiran',
  language: 'telugu',
  matchConfidence: 1,
  sourceType: 'chart' as const,
  rank: 1,
  evidence: [{ url: 'https://charts.example/x', title: 'Chart', sourceType: 'chart' as const, observedAt: '2026-10-02T12:00:00.000Z', publishedAt: '2026-10-01T00:00:00.000Z', period: '2026-10' }],
};
const OK = { state: 'ok' as const, items: [ITEM], evidenceAt: '2026-10-02T12:00:00.000Z', searches: 3, note: '1 song verified.' };

const get = async (qs = '', waitUntil?: (p: Promise<unknown>) => void): Promise<{ res: Response; body: DiscoverBody }> => {
  const res = await onRequestGet({ request: new Request(`https://x.test/api/discover${qs}`), env: {} as never, waitUntil });
  return { res, body: (await res.json()) as DiscoverBody };
};

beforeEach(() => {
  discoverMusic.mockReset();
  cachedDiscovery.mockReset();
  discoverMusic.mockResolvedValue(OK);
  cachedDiscovery.mockReturnValue(null);
});

describe('parseDiscoverQuery', () => {
  it('reads a valid query', () => {
    expect(parseDiscoverQuery(new URL('https://x/?region=lk&language=TAMIL&intent=new-releases&wait=1'))).toEqual({
      region: 'LK',
      language: 'tamil',
      intent: 'new-releases',
      wait: true,
    });
  });

  it('falls back to safe defaults for anything unknown', () => {
    expect(parseDiscoverQuery(new URL('https://x/?region=nonsense&language=1&intent=hack'))).toEqual({
      region: 'IN',
      language: null,
      intent: 'trending-songs',
      wait: false,
    });
  });

  it('never accepts a crafted language', () => {
    expect(parseDiscoverQuery(new URL('https://x/?language=' + encodeURIComponent('telugu" OR 1=1'))).language).toBeNull();
  });
});

describe('GET /api/discover', () => {
  it('answers from the cache without searching, and starts a refresh on a miss', async () => {
    const started: Promise<unknown>[] = [];
    const { res, body } = await get('?region=IN&language=telugu', (p) => started.push(p));
    expect(body.state).toBe('cold');
    expect(body.items).toEqual([]);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // A refresh was handed to waitUntil — the caller never waited for it.
    expect(started).toHaveLength(1);
    expect(discoverMusic).toHaveBeenCalledTimes(1);
    expect(body.note).toMatch(/refresh has been started/i);
  });

  it('serves a cached answer when there is one, and never searches for it', async () => {
    cachedDiscovery.mockReturnValue(OK);
    const { res, body } = await get('?region=IN&language=telugu');
    expect(body.state).toBe('ok');
    expect(body.items).toHaveLength(1);
    expect(discoverMusic).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toContain('max-age=60');
  });

  it('wait=1 runs the discovery and waits for it', async () => {
    const { body } = await get('?region=IN&language=telugu&wait=1');
    expect(discoverMusic).toHaveBeenCalledTimes(1);
    expect(body.state).toBe('ok');
    expect(body.items[0]).toMatchObject({ catalogId: 'cat-1', sourceType: 'chart', rank: 1 });
    expect(body.items[0].evidence[0].url).toBe('https://charts.example/x');
  });

  it('carries the question back, so a shelf can label itself honestly', async () => {
    const { body } = await get('?region=LK&language=tamil&intent=new-releases&wait=1');
    expect(body).toMatchObject({ region: 'LK', language: 'tamil', intent: 'new-releases' });
  });

  it('reports the stale state and sets the flag', async () => {
    cachedDiscovery.mockReturnValue({ ...OK, state: 'stale', note: 'Evidence is more than six hours old.' });
    const { body } = await get('?wait=0');
    expect(body.state).toBe('stale');
    expect(body.stale).toBe(true);
    expect(body.items).toHaveLength(1);
  });

  it('says plainly when nothing is configured, and does not cache that answer for long', async () => {
    discoverMusic.mockResolvedValue({ state: 'not_configured', items: [], evidenceAt: null, searches: 0, note: 'No web search instance is configured on this deployment.' });
    const { res, body } = await get('?wait=1');
    expect(body.state).toBe('not_configured');
    expect(body.items).toEqual([]);
    expect(body.note).toMatch(/no web search instance/i);
    expect(res.headers.get('cache-control')).toContain('max-age=15');
  });

  it('includes operational health so the console can see why there is nothing', async () => {
    const { body } = await get('?wait=1');
    expect(body.health).toMatchObject({ configured: true, breakerOpen: false, quotaPerHour: 12 });
  });

  it('allows the Android shell to read it', async () => {
    const { res } = await get('?wait=1');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('refuses POST', async () => {
    expect((await onRequestPost()).status).toBe(405);
  });

  it('survives a refresh that rejects on a cache miss', async () => {
    discoverMusic.mockRejectedValue(new Error('down'));
    const started: Promise<unknown>[] = [];
    const { body } = await get('?wait=0', (p) => started.push(p));
    expect(body.state).toBe('cold');
    await expect(Promise.all(started)).resolves.toBeDefined();
  });
});
