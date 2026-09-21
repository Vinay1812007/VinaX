/**
 * 7.2.0 — /api/events preflight contract. Until 7.2.0 the preflight allowed
 * only `content-type` while the app's telemetry client also sends
 * `x-vinax-consent`, so a browser blocked every cross-origin post (reproduced
 * in Chromium: "Request header field x-vinax-consent is not allowed by
 * Access-Control-Allow-Headers in preflight response"). Today the Android
 * shell loads the production origin, so it is same-origin; a bundled-assets
 * build (origin https://localhost) is not.
 *
 * The header list is read from the client source, so adding a header there
 * without allowing it here fails this test.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestOptions, onRequestPost } from '../functions/api/events';

const CLIENT = readFileSync(new URL('../../../frontend/src/services/analytics/telemetry.ts', import.meta.url), 'utf8');

/** The header names the telemetry client puts on its POST. */
function clientHeaders(): string[] {
  const block = /method:\s*'POST',\s*headers:\s*\{([\s\S]*?)\n\s*\},/.exec(CLIENT)?.[1] ?? '';
  return [...block.matchAll(/'([a-z0-9-]+)'\s*:/gi)].map((m) => m[1].toLowerCase());
}

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', DEVICE_ID_SECRET: 'unit-test-secret' };
const calls: Array<{ url: string; method: string }> = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return Promise.resolve(new Response('[]', { status: 201 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

let ipSeq = 0;
const preflight = (origin: string, requestHeaders: string[]) =>
  onRequestOptions({
    request: new Request('https://www.sirimillavinay.online/api/events', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': requestHeaders.join(',') },
    }),
  });
const post = (headers: Record<string, string>) => {
  ipSeq += 1;
  return onRequestPost({
    request: new Request('https://www.sirimillavinay.online/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.30.0.${ipSeq % 250}`, ...headers },
      body: JSON.stringify({ deviceId: 'install-uuid-0001', type: 'play', song: { id: 's1', title: 'Orbit' } }),
    }),
    env: ENV,
  });
};
const allowed = (res: Response) => (res.headers.get('access-control-allow-headers') ?? '').split(',').map((h) => h.trim().toLowerCase());

describe('/api/events preflight', () => {
  it('reads the client header list (sanity: the consent header is in it)', () => {
    expect(clientHeaders()).toEqual(expect.arrayContaining(['content-type', 'x-vinax-consent']));
  });

  it.each(['https://localhost', 'capacitor://localhost', 'https://www.sirimillavinay.online', 'http://localhost:5173'])(
    'allows every header the client sends, for the app origin %s',
    async (origin) => {
      const res = await preflight(origin, clientHeaders());
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect((res.headers.get('access-control-allow-methods') ?? '').toUpperCase()).toContain('POST');
      for (const h of clientHeaders()) expect(allowed(res), h).toContain(h);
      expect(res.headers.get('vary')?.toLowerCase()).toContain('origin');
    },
  );

  it('does not let a third-party page post consented events from its visitors\' browsers', async () => {
    const res = await preflight('https://evil.example', clientHeaders());
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the POST answer carries the same origin grant, so the app can read its signed id', async () => {
    const res = await post({ origin: 'https://localhost', 'x-vinax-consent': 'analytics' });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });
});

describe('/api/events consent gating is unchanged', () => {
  it('a post without x-vinax-consent writes nothing', async () => {
    const res = await post({ origin: 'https://localhost' });
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(0);
  });

  it('a post with any other consent value writes nothing', async () => {
    const res = await post({ origin: 'https://localhost', 'x-vinax-consent': 'none' });
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(0);
  });

  it('a consented post is written', async () => {
    await post({ 'x-vinax-consent': 'analytics' });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/rest/v1/vinax_events'))).toBe(true);
  });
});
