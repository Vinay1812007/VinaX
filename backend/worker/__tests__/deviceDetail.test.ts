/**
 * Schema 16 — device detail and time in the app. The Worker reads the system
 * version and phone model from the user agent (Chrome's reduced agent hides
 * both: "Android 10; K"), keeps how the listener runs VinaX (the app, an
 * installed web app, a browser tab) and accepts the app's idle `presence`.
 * A database older than 16 must keep storing presence without the columns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/events';
import { phoneOf } from '../functions/_lib/edge';
import { DB_ENV, fakeDb } from './helpers/fakeDb';

const UA = {
  samsungApp: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  pixelApp: 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  realme: 'Mozilla/5.0 (Linux; Android 13; RMX3741 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  vivo: 'Mozilla/5.0 (Linux; Android 12; V2120) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  redmi: 'Mozilla/5.0 (Linux; Android 13; 23021RAAEG Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36',
  reduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

describe('phoneOf', () => {
  it('reads the Android version, model and maker the agent names', () => {
    expect(phoneOf(UA.samsungApp)).toEqual({ osVersion: '14', model: 'SM-S918B', brand: 'Samsung' });
    expect(phoneOf(UA.pixelApp)).toEqual({ osVersion: '15', model: 'Pixel 8', brand: 'Google' });
    expect(phoneOf(UA.realme)).toEqual({ osVersion: '13', model: 'RMX3741', brand: 'Realme' });
    expect(phoneOf(UA.vivo)).toEqual({ osVersion: '12', model: 'V2120', brand: 'Vivo' });
    expect(phoneOf(UA.redmi)).toEqual({ osVersion: '13', model: '23021RAAEG', brand: 'Xiaomi' });
  });

  it('Chrome’s reduced agent hides the model and the real version', () => {
    expect(phoneOf(UA.reduced)).toEqual({ osVersion: null, model: null, brand: null });
  });

  it('iPhones and iPads give the iOS version and no model; computers give nothing', () => {
    expect(phoneOf(UA.iphone)).toEqual({ osVersion: '18.1', model: null, brand: 'Apple' });
    expect(phoneOf(UA.ipad)).toEqual({ osVersion: '17.0', model: null, brand: 'Apple' });
    expect(phoneOf(UA.mac)).toEqual({ osVersion: null, model: null, brand: null });
    expect(phoneOf(null)).toEqual({ osVersion: null, model: null, brand: null });
  });
});

const ENV = { ...DB_ENV, DEVICE_ID_SECRET: 'test-device-secret-0123456789abcdef' };
let ip = 0;
async function report(ua: string, platform: string, extra: Record<string, unknown> = {}, type = 'heartbeat') {
  ip += 1;
  const waits: Promise<unknown>[] = [];
  await onRequestPost({
    request: new Request('https://www.vinaxmusic.online/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-consent': 'analytics', 'user-agent': ua, 'cf-connecting-ip': `10.41.0.${ip}` },
      body: JSON.stringify({ deviceId: `install-uuid-c-${ip}`, type, platform, ...(type === 'heartbeat' ? { song: { id: 's1', title: 'Orbit' } } : {}), ...extra }),
    }),
    env: ENV,
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  } as never);
  await Promise.all(waits);
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/events keeps device detail and how VinaX runs', () => {
  it('the Android app: model, maker, version, and display "app" whatever it sends', async () => {
    const fake = fakeDb();
    await report(UA.samsungApp, 'android', { display: 'tab' });
    expect(fake.rows('listeners')[0]).toMatchObject({ os: 'android', os_version: '14', device_model: 'SM-S918B', device_brand: 'Samsung', display_mode: 'app' });
  });

  it('a web listener: installed or tab as sent; anything else is not kept', async () => {
    const fake = fakeDb();
    await report(UA.iphone, 'web', { display: 'installed' });
    await report(UA.mac, 'web', { display: 'tab' });
    await report(UA.mac, 'web', { display: 'fullscreen' });
    const rows = fake.rows('listeners');
    expect(rows[0]).toMatchObject({ os: 'ios', os_version: '18.1', device_brand: 'Apple', display_mode: 'installed' });
    expect(rows[1]).toMatchObject({ display_mode: 'tab' });
    expect(rows[1]).not.toHaveProperty('device_model');
    expect(rows[2]).not.toHaveProperty('display_mode');
  });

  it('an idle presence is stored as an event (time in the app) and keeps the device online', async () => {
    const fake = fakeDb();
    await report(UA.mac, 'web', { display: 'tab' }, 'presence');
    expect(fake.rows('events')[0]).toMatchObject({ kind: 'presence' });
    expect(fake.rows('listeners')[0]).toHaveProperty('last_seen');
    expect(fake.rows('listeners')[0]).not.toHaveProperty('is_playing');
  });

  it('a database older than 16 refuses the new columns: stored without them, the schema-13 ones kept', async () => {
    const fake = fakeDb();
    const seen: Array<Record<string, unknown>> = [];
    fake.answer('listeners', (c) => {
      const body = c.body as Record<string, unknown>;
      seen.push(body);
      if ('device_model' in body || 'display_mode' in body) {
        return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'device_model' column of 'listeners'" }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 201 });
    });
    await report(UA.samsungApp, 'android');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ os: 'android' });
    for (const c of ['os_version', 'device_model', 'device_brand', 'display_mode']) expect(seen[1]).not.toHaveProperty(c);
  });

  it('a database on 12 refuses both sets: three tries, presence stored with neither', async () => {
    const fake = fakeDb();
    const seen: Array<Record<string, unknown>> = [];
    fake.answer('listeners', (c) => {
      const body = c.body as Record<string, unknown>;
      seen.push(body);
      if (['os', 'device_model', 'display_mode'].some((k) => k in body)) {
        return new Response(JSON.stringify({ code: 'PGRST204', message: 'unknown column' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 201 });
    });
    await report(UA.samsungApp, 'android');
    expect(seen).toHaveLength(3);
    expect(seen[2]).toMatchObject({ platform: 'android' });
    expect(seen[2]).not.toHaveProperty('os');
  });
});
