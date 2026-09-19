/**
 * 7.2.0 — recommendation telemetry `meta` on /api/events: accepted only for
 * rec_served / rec_outcome, whitelisted, clipped, bounded, 1 KB cap, stored
 * in vinax_events.meta, and never allowed to cost an event when the column
 * has not been migrated yet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_MAX_BYTES, onRequestPost, sanitizeEventMeta } from '../functions/api/events';

describe('sanitizeEventMeta', () => {
  it('keeps a well-formed rec_served meta exactly', () => {
    const meta = { alg: 'nextfive-v3', picker: 'ai', fallback: null, latencyMs: 840, n: 5, discovery: 1, languageViolations: 0, relaxed: ['era'], exp: { dj_order: 'b' } };
    expect(sanitizeEventMeta('rec_served', meta)).toEqual(meta);
  });

  it('keeps a well-formed rec_outcome meta exactly', () => {
    const meta = { alg: 'nextfive-v3', picker: 'local', pos: 2, heardSec: 41.5, durationSec: 212, outcome: 'early_skip', liked: false, exp: { k: 'v' } };
    expect(sanitizeEventMeta('rec_outcome', meta)).toEqual(meta);
  });

  it('drops every key outside the whitelist, and fields of the other type', () => {
    const out = sanitizeEventMeta('rec_served', { alg: 'a', deviceId: 'x', html: '<b>', pos: 3, outcome: 'skip', liked: true, song: { title: 't' } });
    expect(out).toEqual({ alg: 'a' });
  });

  it('clips strings and strips control characters', () => {
    const out = sanitizeEventMeta('rec_served', { alg: `ab\u0000c${'x'.repeat(40)}`, relaxed: ['y'.repeat(30), 7, '', 'ok'] }) as { alg: string; relaxed: string[] };
    expect(out.alg).toBe(`abc${'x'.repeat(21)}`);
    expect(out.relaxed).toEqual(['y'.repeat(24), 'ok']);
  });

  it('bounds numbers and rounds them; non-finite numbers are dropped', () => {
    const out = sanitizeEventMeta('rec_served', { latencyMs: 500_000, n: -3, discovery: 12.6, languageViolations: Number.NaN });
    expect(out).toEqual({ latencyMs: 120_000, n: 0, discovery: 13 });
    const outcome = sanitizeEventMeta('rec_outcome', { pos: 99, heardSec: 12.345, durationSec: 9000 });
    expect(outcome).toEqual({ pos: 40, heardSec: 12.3, durationSec: 3600 });
  });

  it('enums must match; fallback null means "no fallback"', () => {
    expect(sanitizeEventMeta('rec_served', { picker: 'model', fallback: 'nope' })).toBeNull();
    expect(sanitizeEventMeta('rec_served', { picker: 'ai', fallback: 'ai_timeout' })).toEqual({ picker: 'ai', fallback: 'ai_timeout' });
    expect(sanitizeEventMeta('rec_served', { fallback: null })).toEqual({ fallback: null });
    expect(sanitizeEventMeta('rec_outcome', { outcome: 'finished', liked: 'yes' })).toBeNull();
  });

  it('caps relaxed at 6 and exp at 4 entries of 40 characters; non-string exp values are dropped', () => {
    const out = sanitizeEventMeta('rec_served', {
      relaxed: Array.from({ length: 10 }, (_, i) => `r${i}`),
      exp: { a: '1', b: 2, ['k'.repeat(50)]: 'v'.repeat(50), c: '3', d: '4', e: '5' },
    }) as { relaxed: string[]; exp: Record<string, string> };
    expect(out.relaxed).toHaveLength(6);
    expect(Object.keys(out.exp)).toHaveLength(4);
    expect(out.exp.b).toBeUndefined();
    expect(out.exp['k'.repeat(40)]).toBe('v'.repeat(40));
  });

  it('refuses meta on any other event type, and non-object meta', () => {
    expect(sanitizeEventMeta('play', { alg: 'a' })).toBeNull();
    expect(sanitizeEventMeta('rec_served', ['alg'])).toBeNull();
    expect(sanitizeEventMeta('rec_served', 'alg')).toBeNull();
    expect(sanitizeEventMeta('rec_served', {})).toBeNull();
  });

  it(`drops a meta whose serialised size is over ${META_MAX_BYTES} bytes`, () => {
    const wide = '界'.repeat(40); // 120 bytes; keys stay distinct within 40 characters
    const key = (i: number) => `${'界'.repeat(39)}${i}`;
    const big = { alg: '界'.repeat(24), relaxed: Array.from({ length: 6 }, () => '界'.repeat(24)), exp: { [key(1)]: wide, [key(2)]: wide, [key(3)]: wide, [key(4)]: wide } };
    expect(sanitizeEventMeta('rec_served', big)).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(sanitizeEventMeta('rec_served', { alg: 'a', exp: { k: 'v' } }))).length).toBeLessThan(META_MAX_BYTES);
  });
});

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', DEVICE_ID_SECRET: 'unit-test-secret' };
interface Call { url: string; method: string; body: string | null }
const calls: Call[] = [];
function db(eventInsert: () => Response = () => new Response(null, { status: 201 })): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? String(init.body) : null });
    if (method === 'POST' && url.endsWith('/rest/v1/vinax_events')) return Promise.resolve(eventInsert());
    return Promise.resolve(new Response('[]', { status: 201 }));
  });
}
const inserts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/vinax_events')).map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>);

let ipSeq = 0;
const post = (body: Record<string, unknown>, consent = true) => {
  ipSeq += 1;
  return onRequestPost({
    request: new Request('https://www.sirimillavinay.online/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.31.0.${ipSeq % 250}`, ...(consent ? { 'x-vinax-consent': 'analytics' } : {}) },
      body: JSON.stringify({ deviceId: 'install-uuid-0001', ...body }),
    }),
    env: ENV,
  });
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('/api/events meta ingestion', () => {
  it('writes the sanitised meta for rec_served', async () => {
    db();
    await post({ type: 'rec_served', meta: { alg: 'nextfive-v3', picker: 'ai', fallback: null, n: 5, secret: 'x' } });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].meta).toEqual({ alg: 'nextfive-v3', picker: 'ai', fallback: null, n: 5 });
  });

  it('an ordinary event never names the meta column, even if the client sent one', async () => {
    db();
    await post({ type: 'play', meta: { alg: 'x' }, song: { id: 's1', title: 'Orbit' } });
    expect(inserts()).toHaveLength(1);
    expect('meta' in inserts()[0]).toBe(false);
  });

  it('retries once without meta when the column is not migrated yet (400 / PGRST204)', async () => {
    let n = 0;
    db(() => {
      n += 1;
      return n === 1
        ? new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'meta' column of 'vinax_events' in the schema cache" }), { status: 400 })
        : new Response(null, { status: 201 });
    });
    await post({ type: 'rec_outcome', meta: { alg: 'a', outcome: 'complete', pos: 1 } });
    const rows = inserts();
    expect(rows).toHaveLength(2);
    expect(rows[0].meta).toEqual({ alg: 'a', outcome: 'complete', pos: 1 });
    expect('meta' in rows[1]).toBe(false);
    expect(rows[1].type).toBe('rec_outcome');
  });

  it('does not retry an outage (5xx) — the retry is only for the missing column', async () => {
    db(() => new Response('{}', { status: 503 }));
    await post({ type: 'rec_served', meta: { alg: 'a' } });
    expect(inserts()).toHaveLength(1);
  });

  it('without analytics consent nothing is written, meta or not', async () => {
    db();
    const res = await post({ type: 'rec_served', meta: { alg: 'a' } }, false);
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(0);
  });
});
