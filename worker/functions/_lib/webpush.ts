/**
 * Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only Web Crypto, so it
 * runs on the Cloudflare Workers runtime with no Node dependencies.
 *
 * NOTE: this path cannot be exercised in CI — it needs real VAPID keys and a
 * live browser subscription. Verify on a device after setting the VAPID_* env
 * vars (see README -> Push notifications).
 */

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string; // base64url, 65-byte uncompressed P-256 point
  VAPID_PRIVATE_KEY?: string; // base64url, 32-byte P-256 scalar
  VAPID_SUBJECT?: string; // mailto: or https: contact
}

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string; // base64url
  auth: string; // base64url
}

export interface PushResult {
  endpoint: string;
  status: number;
  ok: boolean;
  gone: boolean;
}

export function pushConfigured(env: VapidEnv): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Copy bytes into a fresh ArrayBuffer — a clean BufferSource for Web Crypto. */
function src(u: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u.byteLength);
  new Uint8Array(b).set(u);
  return b;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', src(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, src(data)));
}

async function vapidAuthHeader(env: VapidEnv, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(
    utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })),
  );
  const signingInput = `${header}.${payload}`;
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY ?? '');
  const priv = b64urlToBytes(env.VAPID_PRIVATE_KEY ?? '');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(priv),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, src(utf8(signingInput)));
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY ?? ''}`;
}

async function encryptPayload(sub: PushSubscriptionRecord, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const asKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', src(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256),
  );

  // RFC 8291: derive the input keying material.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = (await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))).slice(0, 32);

  // RFC 8188: content-encryption key + nonce.
  const prk = await hmac(salt, ikm);
  const cekBytes = (await hmac(prk, concat(utf8('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const cek = await crypto.subtle.importKey('raw', src(cekBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = last record, no padding
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: src(nonce), tagLength: 128 }, cek, src(plaintext)),
  );

  const rs = new Uint8Array([0, 0, 0x10, 0x00]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export async function sendPush(
  env: VapidEnv,
  sub: PushSubscriptionRecord,
  data: unknown,
  ttl = 86400,
): Promise<PushResult> {
  const body = await encryptPayload(sub, utf8(JSON.stringify(data)));
  const auth = await vapidAuthHeader(env, sub.endpoint);
  // Some push services (notably legacy WNS endpoints) can hang for tens of
  // seconds on a bad subscription. A single stuck request would otherwise
  // stall the whole bounded fan-out (audit finding M19), so enforce a
  // 10 s per-request deadline. Timed-out requests report as !ok, not gone.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency: 'normal',
      },
      body: src(body),
      signal: controller.signal,
    });
    return { endpoint: sub.endpoint, status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === 'AbortError';
    return { endpoint: sub.endpoint, status: aborted ? 0 : -1, ok: false, gone: false };
  } finally {
    clearTimeout(timeoutId);
  }
}
