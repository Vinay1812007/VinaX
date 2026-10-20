/**
 * 13.7.3 — Android notifications: the FCM message carries the app's channel
 * and white small icon, only truly dead tokens are pruned (a malformed
 * message must never deactivate every device), failures say why, and the
 * daily song pick now reaches Android devices too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../functions/_lib/supabase', () => ({
  sbSelect: vi.fn(),
  sbInsert: vi.fn(async () => true),
  sbUpdate: vi.fn(async () => true),
}));
vi.mock('../functions/_lib/ai', () => ({
  chat: vi.fn(async () => {
    throw new Error('no ai in tests');
  }),
}));

import { sbSelect, sbUpdate } from '../functions/_lib/supabase';
import { FCM_CHANNEL_ID, FCM_SMALL_ICON, sendFcm } from '../functions/_lib/fcm';
import { onRequest as songPush } from '../functions/api/cron/song-push';

async function serviceAccount(): Promise<string> {
  const k = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ project_id: 'vinax-music', client_email: 'sa@vinax-music.iam.gserviceaccount.com', private_key: pem });
}

const fcmError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { status: code, message, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }), { status });

let SA = '';
beforeEach(async () => {
  SA ||= await serviceAccount();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('sendFcm', () => {
  it('sends on the VinaX channel with the white small icon', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
      if (String(u).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      bodies.push(String(init?.body ?? ''));
      return new Response('{}', { status: 200 });
    }));
    const r = await sendFcm({ FCM_SERVICE_ACCOUNT: SA }, ['t1'], { title: 'Hi', body: 'There', link: '/song/x-1' });
    expect(r).toEqual({ sent: 1, dead: [], failed: {}, error: null });
    const msg = JSON.parse(bodies[0]).message;
    expect(msg.android.notification).toMatchObject({ channel_id: FCM_CHANNEL_ID, icon: FCM_SMALL_ICON });
    expect(msg.data).toEqual({ link: '/song/x-1' });
  });

  it('prunes only tokens FCM says are gone, and names every other failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
      if (String(u).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      const token = JSON.parse(String(init?.body)).message.token as string;
      switch (token) {
        case 'ok': return new Response('{}', { status: 200 });
        case 'gone': return fcmError(404, 'UNREGISTERED', 'Requested entity was not found.');
        case 'bad-token': return fcmError(400, 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token');
        case 'bad-message': return fcmError(400, 'INVALID_ARGUMENT', "Invalid value at 'message.android.notification.color'");
        default: return fcmError(503, 'UNAVAILABLE', 'try later');
      }
    }));
    const r = await sendFcm({ FCM_SERVICE_ACCOUNT: SA }, ['ok', 'gone', 'bad-token', 'bad-message', 'busy'], { title: 't', body: 'b' });
    expect(r.sent).toBe(1);
    expect(r.dead.sort()).toEqual(['bad-token', 'gone']);
    expect(r.failed).toEqual({ INVALID_ARGUMENT: 1, UNAVAILABLE: 1 });
    expect(r.error).toBeNull();
  });

  it('says why nothing could be sent', async () => {
    expect((await sendFcm({}, ['t'], { title: 't', body: 'b' })).error).toBe('not_configured');
    expect((await sendFcm({ FCM_SERVICE_ACCOUNT: '{nope' }, ['t'], { title: 't', body: 'b' })).error).toBe('bad_service_account_json');
  });
});

describe('daily song push (cron/song-push)', () => {
  it('reaches Android devices even when browser push is not configured', async () => {
    // 19:30 IST: inside the allowed window for a device at UTC+5:30.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T14:00:00Z'));
    vi.mocked(sbSelect).mockImplementation(async (_env, table: string) => {
      if (table === 'vinax_fcm_tokens') {
        return [{ token: 'android-1', country: 'IN', region: 'Telangana', city: 'Hyderabad', lang: 'te', tz_offset: 330, last_pushed_at: null }];
      }
      return []; // no earlier song-push today, no browser subscribers
    });
    const fcmBodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
      const url = String(u);
      if (url.includes('/search/songs')) {
        return new Response(JSON.stringify({ data: { results: [{ id: 'abc', name: 'Song One', primaryArtists: 'Singer', image: [{ url: 'https://c.saavncdn.com/x.jpg' }] }] } }), { status: 200 });
      }
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      if (url.includes('fcm.googleapis.com')) {
        fcmBodies.push(String(init?.body ?? ''));
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));
    const env = { CRON_SECRET: 's3cret', FCM_SERVICE_ACCOUNT: SA, SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'k' };
    const res = await songPush({ request: new Request('https://x/api/cron/song-push', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } }), env: env as never });
    const body = (await res.json()) as { ok: boolean; fcm: number; web: number; sent: number; groups: Array<{ android: number }> };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, fcm: 1, web: 0, sent: 1 });
    expect(body.groups[0].android).toBe(1);
    const msg = JSON.parse(fcmBodies[0]).message;
    expect(msg.token).toBe('android-1');
    expect(msg.data.link).toBe('/song/song-one-abc');
    // Delivered devices get their frequency-cap clock stamped; nothing was pruned.
    const updates = vi.mocked(sbUpdate).mock.calls.map((c) => c[1]);
    expect(updates).toContain('vinax_fcm_tokens');
    expect(vi.mocked(sbUpdate).mock.calls.some((c) => (c[3] as { active?: boolean }).active === false)).toBe(false);
  });

  it('refuses when neither kind of push is set up', async () => {
    const res = await songPush({ request: new Request('https://x/api/cron/song-push', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } }), env: { CRON_SECRET: 's3cret' } as never });
    expect(res.status).toBe(400);
  });
});
