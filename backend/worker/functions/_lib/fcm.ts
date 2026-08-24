/**
 * Firebase Cloud Messaging (HTTP v1) sender — native Android background push,
 * so notifications arrive even when the app is fully closed (unlike the WebView
 * local-notification path, which only fires while the app is open).
 *
 * Requires FCM_SERVICE_ACCOUNT: the Firebase service-account JSON (the whole
 * file, as a string) set as a Cloudflare Pages secret. No-op when unset, so the
 * rest of the app is unaffected until you configure it.
 */
export interface FcmEnv {
  FCM_SERVICE_ACCOUNT?: string;
}

export function fcmConfigured(env: FcmEnv): boolean {
  return !!env.FCM_SERVICE_ACCOUNT;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

let cachedToken: { token: string; exp: number } | null = null;
// Coalesce concurrent JWT-sign + token-exchange requests. Without this, two
// parallel isolate calls would each do the RSA sign + POST to oauth2, double-
// billing the exchange until one finished and populated `cachedToken`
// (audit finding M17). Cleared on completion so a subsequent expiry-driven
// refresh runs again.
let inflightExchange: Promise<string | null> | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str));
}
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** Exchange the service account for a short-lived OAuth2 access token (cached). */
async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  if (inflightExchange) return inflightExchange;
  inflightExchange = (async (): Promise<string | null> => {
    try {
      const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
      const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = b64urlStr(
        JSON.stringify({
          iss: sa.client_email,
          scope: 'https://www.googleapis.com/auth/firebase.messaging',
          aud: tokenUri,
          iat: now,
          exp: now + 3600,
        }),
      );
      const unsigned = `${header}.${claims}`;
      const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToDer(sa.private_key),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
      const jwt = `${unsigned}.${b64url(sig)}`;
      const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!d.access_token) return null;
      cachedToken = { token: d.access_token, exp: now + (d.expires_in ?? 3600) };
      return d.access_token;
    } catch {
      return null;
    } finally {
      inflightExchange = null;
    }
  })();
  return inflightExchange;
}

export interface FcmMessage {
  title: string;
  body: string;
  link?: string;
}

/**
 * Send a notification to the given device tokens. Returns how many were
 * delivered and which tokens are dead (unregistered) so the caller can prune
 * them. Best-effort, never throws.
 *
 * Fan-out runs concurrently with a bounded worker pool (audit finding M-SRV-3
 * — the old sequential loop tripped the Pages Functions 30 s wall clock at
 * scale) and every per-token fetch carries a 10 s abort so one slow upstream
 * can't stall the pool.
 */
export async function sendFcm(env: FcmEnv, tokens: string[], msg: FcmMessage): Promise<{ sent: number; dead: string[] }> {
  const dead: string[] = [];
  if (!env.FCM_SERVICE_ACCOUNT || !tokens.length) return { sent: 0, dead };
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
  } catch {
    return { sent: 0, dead };
  }
  const at = await accessToken(sa);
  if (!at) return { sent: 0, dead };
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  const sendOne = async (token: string): Promise<'ok' | 'dead' | 'skip'> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title.slice(0, 120), body: (msg.body || '').slice(0, 240) },
            data: { link: msg.link || '/' },
            android: { priority: 'high', notification: { default_sound: true } },
          },
        }),
        signal: ctrl.signal,
      });
      if (res.ok) return 'ok';
      if (res.status === 404 || res.status === 400) return 'dead';
      return 'skip';
    } catch {
      return 'skip';
    } finally {
      clearTimeout(timer);
    }
  };

  // Bounded-concurrency worker pool. Duplicated locally so this helper stays
  // self-contained; the same shape lives in cron/song-push.ts and admin/push.ts.
  const limit = Math.min(8, tokens.length);
  let cursor = 0;
  let sent = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= tokens.length) return;
      const outcome = await sendOne(tokens[i]);
      if (outcome === 'ok') sent += 1;
      else if (outcome === 'dead') dead.push(tokens[i]);
    }
  });
  await Promise.all(workers);
  return { sent, dead };
}
