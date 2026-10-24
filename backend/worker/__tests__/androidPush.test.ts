/**
 * 13.7.3 — Android notifications: the FCM message carries the app's channel
 * and white small icon, only truly dead tokens are pruned (a malformed
 * message must never deactivate every device), and failures say why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FCM_CHANNEL_ID, FCM_SMALL_ICON, sendFcm } from '../functions/_lib/fcm';

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
