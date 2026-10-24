/**
 * 14.0 — the database client: query building, encoding, result shapes,
 * paging and failure names. Every request goes to a mocked fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, dbConfigured, dbErrorCode, like, q } from '../functions/_lib/db';

const ENV = { SUPABASE_URL: 'https://db.example/', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
function stub(answer: (c: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = String(init?.body); }
    const c = { url: String(u), method: init?.method ?? 'GET', headers, body };
    calls.push(c);
    return answer(c);
  }));
  return calls;
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
afterEach(() => vi.unstubAllGlobals());

describe('query builder', () => {
  it('encodes every value and joins filters', () => {
    const s = q().eq('kind', 'play').gte('at', '2026-10-24T00:00:00Z').ilike('name', `*${like('a,b')}*`).select('id,at').order('at', 'desc').limit(50).offset(100).toString();
    expect(s).toBe('kind=eq.play&at=gte.2026-10-24T00%3A00%3A00Z&name=ilike.*a%5C%2Cb*&select=id%2Cat&order=at.desc&limit=50&offset=100');
  });
  it('builds in() and or() with quoting', () => {
    expect(q().in('id', ['a', 'b"c']).toString()).toBe('id=in.(%22a%22,%22b%5C%22c%22)');
    expect(q().or('name.ilike.*x*', 'handle.ilike.*x*').toString()).toBe('or=(name.ilike.*x*,handle.ilike.*x*)');
  });
  it('like() neutralises reserved characters', () => {
    expect(like('50% off (really), "quoted".*')).toBe('50\\% off \\(really\\)\\, \\"quoted\\"\\.\\*');
  });
});

describe('configuration', () => {
  it('knows when the database is not set up, and names it', async () => {
    expect(dbConfigured({})).toBe(false);
    expect(dbConfigured({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: ' ' })).toBe(false);
    expect(dbConfigured(ENV)).toBe(true);
    const r = await db.select({}, 'listeners');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_configured');
    expect(dbErrorCode('not_found')).toBe('db_not_found');
  });
});

describe('calls', () => {
  it('select sends the service key, trims the URL and returns typed rows', async () => {
    const calls = stub(() => json([{ id: 'a' }]));
    const r = await db.select<{ id: string }>(ENV, 'listeners', q().eq('platform', 'web').limit(5));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([{ id: 'a' }]);
    expect(calls[0].url).toBe('https://db.example/rest/v1/listeners?platform=eq.web&limit=5');
    expect(calls[0].headers.apikey).toBe('service-key');
    expect(calls[0].headers.authorization).toBe('Bearer service-key');
  });

  it('pages a limit above 1000 and stops at a short page', async () => {
    const calls = stub((c) => {
      const off = Number(/offset=(\d+)/.exec(c.url)?.[1] ?? 0);
      return json(off === 0 ? Array.from({ length: 1000 }, (_, i) => ({ i })) : [{ i: 1000 }]);
    });
    const r = await db.select<{ i: number }>(ENV, 'events', q().limit(5000));
    expect(r.ok && r.rows.length).toBe(1001);
    expect(calls.map((c) => c.url)).toEqual([
      'https://db.example/rest/v1/events?limit=1000&offset=0',
      'https://db.example/rest/v1/events?limit=1000&offset=1000',
    ]);
  });

  it('names failures: unauthorized, not_found, conflict, bad_request, unavailable, timeout', async () => {
    const seq = [401, 404, 409, 400, 503];
    let i = 0;
    stub(() => json({ code: seq[i] === 409 ? '23505' : 'PGRST', message: 'nope' }, seq[i++]));
    const out: string[] = [];
    for (let n = 0; n < seq.length; n += 1) {
      const r = await db.select(ENV, 't');
      if (!r.ok) out.push(r.error);
    }
    expect(out).toEqual(['unauthorized', 'not_found', 'conflict', 'bad_request', 'unavailable']);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))));
    const r = await db.select(ENV, 't');
    expect(!r.ok && r.error).toBe('unavailable');
  });

  it('insert / upsert / update / remove send the right verbs and Prefer headers', async () => {
    const calls = stub((c) => (c.method === 'POST' && /ignore-duplicates/.test(c.headers.prefer) ? json([]) : c.headers.prefer.includes('representation') ? json([{ id: 1 }]) : new Response(null, { status: 204 })));
    expect((await db.insert(ENV, 'events', { kind: 'play' })).ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.prefer).toBe('return=minimal');
    const dup = await db.insert(ENV, 'rooms', { code: 'A' }, { onConflict: 'code', ignoreDuplicates: true, returning: true });
    expect(dup.ok && dup.rows).toEqual([]);
    expect(calls[1].url).toContain('rooms?on_conflict=code');
    await db.upsert(ENV, 'listeners', { id: 'x' }, 'id');
    expect(calls[2].headers.prefer).toBe('resolution=merge-duplicates,return=minimal');
    const up = await db.update<{ id: number }>(ENV, 'feedback', q().eq('id', 1), { status: 'read' }, { returning: true });
    expect(calls[3].method).toBe('PATCH');
    expect(up.ok && up.rows).toEqual([{ id: 1 }]);
    await db.remove(ENV, 'rooms', q().eq('code', 'A'));
    expect(calls[4].method).toBe('DELETE');
    const unsafe = await db.remove(ENV, 'rooms', '');
    expect(!unsafe.ok && unsafe.error).toBe('bad_request');
    expect(calls.length).toBe(5);
  });

  it('count reads content-range; rpc posts args and parses the answer', async () => {
    const calls = stub((c) => (c.url.includes('/rpc/') ? json({ activeNow: 3 }) : json([{ id: 1 }], 200, { 'content-range': '0-0/42' })));
    const n = await db.count(ENV, 'events', q().eq('kind', 'play'));
    expect(n.ok && n.value).toBe(42);
    expect(calls[0].headers.prefer).toBe('count=exact');
    const r = await db.rpc<{ activeNow: number }>(ENV, 'stats_overview', {});
    expect(r.ok && r.value).toEqual({ activeNow: 3 });
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://db.example/rest/v1/rpc/stats_overview', body: {} });
  });
});
