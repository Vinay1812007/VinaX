/**
 * GET /api/charts/vinax — "Most played on VinaX this week". stats_trending's
 * answer cut to songs at least five accounts played, public fields only,
 * ranks renumbered, and kept for three hours so the database is asked rarely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_S, MIN_LISTENERS, onRequestGet, publicChart, resetChartMemo } from '../functions/api/charts/vinax';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

const row = (id: string, rank: number, listeners: number, extra: Record<string, unknown> = {}) => ({
  id, title: `Song ${id}`, artist: `Artist ${id}`, image: `https://img.test/${id}.jpg`,
  plays: 100 - rank, prev_plays: 3, listeners, rank, prev_rank: rank + 1, daily: [1, 2, 3], ...extra,
});

let rpcCalls: Array<{ url: string; body: unknown }> = [];
function stubDb(answer: () => Response): void {
  rpcCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    rpcCalls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return answer();
  }));
}
const get = () => onRequestGet({ request: new Request('https://www.vinaxmusic.online/api/charts/vinax'), env: ENV });

beforeEach(() => resetChartMemo());
afterEach(() => vi.unstubAllGlobals());

describe('publicChart', () => {
  it('keeps songs with enough listeners and a catalogue id, renumbers ranks and drops every count', () => {
    const chart = publicChart({
      songs: [
        row('a', 1, 2),
        row('b', 2, MIN_LISTENERS),
        row('', 3, 9),
        row('c', 4, 12, { image: 'http://insecure/c.jpg' }),
        row('b', 5, 8),
      ],
    }, new Date('2026-11-17T00:00:00Z'));
    expect(chart).toEqual({
      updatedAt: '2026-11-17T00:00:00.000Z',
      days: 7,
      minListeners: 5,
      songs: [
        { id: 'b', title: 'Song b', artist: 'Artist b', image: 'https://img.test/b.jpg', rank: 1 },
        { id: 'c', title: 'Song c', artist: 'Artist c', image: null, rank: 2 },
      ],
    });
  });

  it('answers an empty chart for anything that is not stats_trending’s shape', () => {
    expect(publicChart(null).songs).toEqual([]);
    expect(publicChart({ songs: 'nope' }).songs).toEqual([]);
  });
});

describe('the route', () => {
  it('calls stats_trending(7, 100) once and serves the cut list with a three-hour edge cache', async () => {
    stubDb(() => new Response(JSON.stringify({ totals: { plays: 999 }, songs: [row('x', 1, 6), row('y', 2, 1)] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(`public, max-age=1800, s-maxage=${CACHE_S}`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { songs: unknown[] };
    expect(body.songs).toEqual([{ id: 'x', title: 'Song x', artist: 'Artist x', image: 'https://img.test/x.jpg', rank: 1 }]);
    expect(JSON.stringify(body)).not.toMatch(/plays|listeners|prev_rank|daily|totals/);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].url).toBe('https://db.test/rest/v1/rpc/stats_trending');
    expect(rpcCalls[0].body).toEqual({ p_days: 7, p_limit: 100 });

    // The next request inside the window never reaches the database.
    await get();
    expect(rpcCalls).toHaveLength(1);
  });

  it('keeps the answer in the edge cache, so another isolate in the same place skips the database', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
        put: async (key: string, res: Response) => void store.set(key, await res.text()),
      },
    });
    stubDb(() => new Response(JSON.stringify({ songs: [row('x', 1, 6)] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await get();
    expect(rpcCalls).toHaveLength(1);
    expect(store.size).toBe(1);

    // A fresh isolate: no copy of its own, the edge copy answers.
    resetChartMemo();
    const res = await get();
    expect(rpcCalls).toHaveLength(1);
    expect(((await res.json()) as { songs: Array<{ id: string }> }).songs.map((s) => s.id)).toEqual(['x']);

    // An edge copy older than three hours is not used.
    const [key, body] = [...store.entries()][0];
    store.set(key, JSON.stringify({ ...JSON.parse(body), updatedAt: new Date(Date.now() - (CACHE_S + 60) * 1000).toISOString() }));
    resetChartMemo();
    await get();
    expect(rpcCalls).toHaveLength(2);
  });

  it('answers an empty chart, cached a few minutes, when the database fails or is not set up', async () => {
    stubDb(() => new Response('boom', { status: 503 }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    expect(((await res.json()) as { songs: unknown[] }).songs).toEqual([]);

    resetChartMemo();
    const bare = await onRequestGet({ request: new Request('https://www.vinaxmusic.online/api/charts/vinax'), env: {} });
    expect(((await bare.json()) as { songs: unknown[] }).songs).toEqual([]);
  });
});
