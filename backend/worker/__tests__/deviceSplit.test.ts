/**
 * Schema 13 — the console tells devices apart: the Android app, Android in a
 * browser, an iPhone, a Mac, a Windows PC… The Worker reads the system and
 * browser from the user agent of every usage report and keeps them on the
 * device's listeners row. A database still on schema 12 has no such columns:
 * presence must keep working there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/events';
import { deviceOf } from '../functions/_lib/edge';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const UA = {
  androidApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('deviceOf', () => {
  it('reads the system and the browser', () => {
    expect(deviceOf(UA.androidApp)).toEqual({ os: 'android', browser: 'Chrome', androidVersion: '14', webView: true });
    expect(deviceOf(UA.androidChrome)).toMatchObject({ os: 'android', browser: 'Chrome', webView: false });
    expect(deviceOf(UA.samsung)).toMatchObject({ os: 'android', browser: 'Samsung Internet' });
    expect(deviceOf(UA.iphone)).toMatchObject({ os: 'ios', browser: 'Safari' });
    expect(deviceOf(UA.iphoneChrome)).toMatchObject({ os: 'ios', browser: 'Chrome' });
    expect(deviceOf(UA.ipad)).toMatchObject({ os: 'ipados', browser: 'Safari' });
    expect(deviceOf(UA.mac)).toMatchObject({ os: 'macos', browser: 'Safari' });
    expect(deviceOf(UA.windowsEdge)).toMatchObject({ os: 'windows', browser: 'Edge' });
    expect(deviceOf(UA.linuxFirefox)).toMatchObject({ os: 'linux', browser: 'Firefox' });
    expect(deviceOf(UA.chromebook)).toMatchObject({ os: 'chromeos', browser: 'Chrome' });
  });

  it('knows nothing about an empty or unknown agent', () => {
    expect(deviceOf(null)).toEqual({ os: null, browser: null, androidVersion: null, webView: false });
    expect(deviceOf('curl/8.0')).toMatchObject({ os: null, browser: null });
  });
});

const ENV = { ...DB_ENV, DEVICE_ID_SECRET: 'test-device-secret-0123456789abcdef' };
let ip = 0;
async function report(ua: string, platform: string) {
  ip += 1;
  const waits: Promise<unknown>[] = [];
  await onRequestPost({
    request: new Request('https://www.vinaxmusic.online/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-consent': 'analytics', 'user-agent': ua, 'cf-connecting-ip': `10.40.0.${ip}` },
      body: JSON.stringify({ deviceId: `install-uuid-${ip}`, type: 'heartbeat', platform, song: { id: 's1', title: 'Orbit' } }),
    }),
    env: ENV,
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  } as never);
  await Promise.all(waits);
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/events keeps the device system and browser', () => {
  it('a browser keeps both; the app keeps its system and no browser', async () => {
    const fake = fakeDb();
    await report(UA.mac, 'web');
    await report(UA.androidApp, 'android');
    const rows = fake.rows('listeners');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ platform: 'web', os: 'macos', browser: 'Safari' });
    expect(rows[1]).toMatchObject({ platform: 'android', os: 'android', browser: null });
  });

  it('an agent with no known system leaves the columns alone', async () => {
    const fake = fakeDb();
    await report('curl/8.0', 'web');
    expect(fake.rows('listeners')[0]).not.toHaveProperty('os');
  });

  it('on a schema-12 database (no os column) it stores the presence without them', async () => {
    const fake = fakeDb();
    let refused = 0;
    fake.answer('listeners', (c) => {
      const body = c.body as Record<string, unknown>;
      if ('os' in body) {
        refused += 1;
        return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'os' column of 'listeners'" }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 201 });
    });
    await report(UA.windowsEdge, 'web');
    const writes = fake.calls.filter((c) => c.table === 'listeners');
    expect(refused).toBe(1);
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toMatchObject({ platform: 'web' });
    expect(writes[1].body).not.toHaveProperty('os');
    expect(writes[1].body).not.toHaveProperty('browser');
  });
});
