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
import { idFromInstall, signId } from '../functions/_lib/identity';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const CLIENT = readFileSync(new URL('../../../frontend/src/services/analytics/telemetry.ts', import.meta.url), 'utf8');

/** The header names the telemetry client puts on its POST. */
function clientHeaders(): string[] {
  const block = /method:\s*'POST',\s*headers:\s*\{([\s\S]*?)\n\s*\},/.exec(CLIENT)?.[1] ?? '';
  return [...block.matchAll(/'([a-z0-9-]+)'\s*:/gi)].map((m) => m[1].toLowerCase());
}

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
    request: new Request('https://www.vinaxmusic.online/api/events', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': requestHeaders.join(',') },
    }),
  });
const post = (headers: Record<string, string>) => {
  ipSeq += 1;
  return onRequestPost({
    request: new Request('https://www.vinaxmusic.online/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.30.0.${ipSeq % 250}`, ...headers },
      body: JSON.stringify({ deviceId: 'install-uuid-0001', type: 'play', song: { id: 's1', title: 'Orbit' } }),
    }),
  });
};
const allowed = (res: Response) => (res.headers.get('access-control-allow-headers') ?? '').split(',').map((h) => h.trim().toLowerCase());

describe('/api/events preflight', () => {
  it('reads the client header list (sanity: the consent header is in it)', () => {
    expect(clientHeaders()).toEqual(expect.arrayContaining(['content-type', 'x-vinax-consent']));
  });

  it.each(['https://localhost', 'capacitor://localhost', 'https://www.vinaxmusic.online', 'http://localhost:5173'])(
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

  it('the POST answer carries the same origin grant', async () => {
    const res = await post({ origin: 'https://localhost', 'x-vinax-consent': 'analytics' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });
});

describe('/api/events writes the event and the device row (14.0)', () => {
  const SECRET = 'device-secret-for-tests';
  const ENV = { ...DB_ENV, DEVICE_ID_SECRET: SECRET };
  const send = (headers: Record<string, string>, body: Record<string, unknown>, env: object = ENV) => {
    ipSeq += 1;
    return onRequestPost({
      request: new Request('https://www.vinaxmusic.online/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://localhost', 'cf-connecting-ip': `10.31.0.${ipSeq % 250}`, 'cf-ipcountry': 'IN', ...headers },
        body: JSON.stringify(body),
      }),
      env,
    });
  };

  it.each<Record<string, string>>([{}, { 'x-vinax-consent': 'none' }])('a post without consent (%o) answers 204 and writes nothing', async (h) => {
    const fake = fakeDb();
    const res = await send(h, { deviceId: 'install-uuid-0001', type: 'play', song: { id: 's1', title: 'Orbit' } });
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(0);
  });

  it('without a database or a signing secret the answer is 204 and nothing is sent', async () => {
    const fake = fakeDb();
    expect((await send({ 'x-vinax-consent': 'analytics' }, { deviceId: 'install-uuid-0001', type: 'play' }, { DEVICE_ID_SECRET: SECRET })).status).toBe(204);
    expect((await send({ 'x-vinax-consent': 'analytics' }, { deviceId: 'install-uuid-0001', type: 'play' }, DB_ENV)).status).toBe(204);
    expect(fake.calls).toHaveLength(0);
  });

  it('first contact: the event and the listener row are written under the derived id, and the signed id is handed back', async () => {
    const fake = fakeDb();
    const res = await send({ 'x-vinax-consent': 'analytics' }, {
      deviceId: 'install-uuid-0001', name: 'Vinay', type: 'play', platform: 'android', appVersion: '14.0.0',
      song: { id: 's1', title: 'Orbit', artist: 'A', language: 'Telugu', image: 'https://i/x.jpg' }, meta: { ignored: true },
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { signed_device_id_next: string };
    const id = await idFromInstall(SECRET, 'install-uuid-0001');
    expect(out.signed_device_id_next.startsWith(`${id}.`)).toBe(true);
    const ev = fake.rows('events')[0];
    expect(ev).toMatchObject({ listener_id: id, kind: 'play', song_id: 's1', song_title: 'Orbit', song_artist: 'A', language: 'telugu', platform: 'android', app_version: '14.0.0', country: 'IN', verified: false });
    expect(ev.meta).toBeUndefined();
    expect(fake.rows('listeners')[0]).toMatchObject({ id, display_name: 'Vinay', platform: 'android', is_playing: true, country: 'IN' });
    expect((fake.rows('listeners')[0].now_playing as { title: string }).title).toBe('Orbit');
  });

  it('a proved signed id answers 204, marks the row verified, and recommendation meta is kept (whitelisted)', async () => {
    const fake = fakeDb();
    const signed = await signId(SECRET, 'd_' + 'cd'.repeat(16));
    const res = await send({ 'x-vinax-consent': 'analytics' }, { signed_device_id: signed, type: 'rec_outcome', meta: { outcome: 'skip', heardSec: 12, liked: false, 'bad key!': 1, deep: { nested: { x: 1 } } } });
    expect(res.status).toBe(204);
    const ev = fake.rows('events')[0];
    expect(ev).toMatchObject({ listener_id: 'd_' + 'cd'.repeat(16), kind: 'rec_outcome', verified: true });
    expect(ev.meta).toEqual({ outcome: 'skip', heardSec: 12, liked: false });
  });

  it('a forged signed id is just a fresh identity; reserved and malformed kinds are dropped with the same 204', async () => {
    const fake = fakeDb();
    const forged = await send({ 'x-vinax-consent': 'analytics' }, { signed_device_id: 'd_' + 'cd'.repeat(16) + '.forged', type: 'open' });
    expect(forged.status).toBe(200); // a new signed id is issued
    expect(fake.rows('events')[0].verified).toBe(false);
    for (const type of ['announcement', 'admin-audit', 'ADMIN', 'Has Space', '']) {
      const before = fake.calls.length;
      expect((await send({ 'x-vinax-consent': 'analytics' }, { deviceId: 'install-uuid-0001', type })).status).toBe(204);
      expect(fake.calls.length).toBe(before);
    }
  });
});

describe('7.2.0 — the other routes a bundled app calls cross-origin', () => {
  it('username and push registration answer a preflight, and the read-only lists are readable', async () => {
    const username = await import('../functions/api/username');
    const fcm = await import('../functions/api/push/fcm-register');
    for (const mod of [username, fcm]) {
      const res = await mod.onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    }
    const voices = await import('../functions/api/voices');
    const models = await import('../functions/api/aimodels');
    const voicesRes = await voices.onRequestGet({ request: new Request('https://x.test/api/voices'), env: {} } as never);
    expect(voicesRes.headers.get('access-control-allow-origin')).toBe('*');
    const modelsRes = await models.onRequestGet({ request: new Request('https://x.test/api/aimodels'), env: {} } as never);
    expect(modelsRes.headers.get('access-control-allow-origin')).toBe('*');
  });
});
