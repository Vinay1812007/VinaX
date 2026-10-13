/** 12.2.1 — the FCM self-check: project name only, a validate-only send, never the key. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFcm } from '../functions/_lib/fcm';

afterEach(() => vi.unstubAllGlobals());

async function serviceAccount(): Promise<string> {
  const k = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ project_id: 'vinax-music', client_email: 'sa@vinax-music.iam.gserviceaccount.com', private_key: pem });
}

describe('checkFcm', () => {
  it('ok when Google issues a token and FCM refuses only the fake device; validate_only; no key in the answer', async () => {
    const SA = await serviceAccount();
    const sent: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
      sent.push({ url: String(u), body: String(init?.body ?? '') });
      if (String(u).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } }), { status: 400 });
    }));
    const r = await checkFcm({ FCM_SERVICE_ACCOUNT: SA });
    expect(r).toEqual({ configured: true, project: 'vinax-music', token: true, fcm: 'ok', detail: 'INVALID_ARGUMENT' });
    expect(sent[1].url).toBe('https://fcm.googleapis.com/v1/projects/vinax-music/messages:send');
    expect(JSON.parse(sent[1].body).validate_only).toBe(true);
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });

  it('names a refused account, a denied project and a missing secret', async () => {
    const SA = await serviceAccount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    expect(await checkFcm({ FCM_SERVICE_ACCOUNT: SA })).toMatchObject({ token: false, fcm: 'skipped' });
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => (String(u).includes('oauth2') ? new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }) : new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 }))));
    expect(await checkFcm({ FCM_SERVICE_ACCOUNT: SA })).toMatchObject({ token: true, fcm: 'denied' });
    expect(await checkFcm({})).toMatchObject({ configured: false, fcm: 'skipped' });
    expect(await checkFcm({ FCM_SERVICE_ACCOUNT: 'nope' })).toMatchObject({ detail: 'not valid JSON' });
  });
});
